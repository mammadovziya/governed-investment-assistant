import type {
  BoundaryMarketSnapshot,
  ResolvedInstrument
} from "./boundary-tools.js";
import type { CapabilityPresentation } from "./capability-presentations.js";
import type {
  ClaimDraft,
  DecimalString,
  FactEnvelope,
  SupportedLocale,
  ToolExecutionEnvelope,
  TrustedRequestContext
} from "./contracts.js";
import { EvidenceFactory } from "./evidence.js";
import {
  ZERO_FIXED,
  addFixed,
  decimal,
  divideFixed,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal,
  subtractFixed,
  sumFixed
} from "./fixed-decimal.js";
import {
  formatDecimalExact,
  formatMoneyExact,
  formatPercentRateExact
} from "./presentation.js";
import type { RenderableFact } from "./rendering.js";
import type {
  PortfolioAllocationAnalysisResult,
  PortfolioAllocationRiskSignalCode
} from "./portfolio-allocation-analysis.js";
import { canonicalHash, type DevHmacSigner } from "./signing.js";

const ONE = parseFixedDecimal("1");
const ONE_HUNDRED = parseFixedDecimal("100");
const MAX_SCENARIO_POSITIONS = 8;

const REVIEWED_ASSET_CATALOG = Object.freeze({
  AAPL: {
    label: "Apple",
    category: "Technology",
    theme: "technology"
  },
  MSFT: {
    label: "Microsoft",
    category: "Technology",
    theme: "technology"
  },
  NVDA: {
    label: "NVIDIA",
    category: "Technology",
    theme: "technology"
  },
  TSLA: {
    label: "Tesla",
    category: "Consumer discretionary",
    theme: "technology-dependent"
  }
} as const);

const COMPANY_ALIASES: Readonly<Record<string, keyof typeof REVIEWED_ASSET_CATALOG>> =
  Object.freeze({
    aapl: "AAPL",
    apple: "AAPL",
    "apple inc": "AAPL",
    msft: "MSFT",
    microsoft: "MSFT",
    "microsoft corporation": "MSFT",
    nvda: "NVDA",
    nvidia: "NVDA",
    "nvidia corporation": "NVDA",
    tsla: "TSLA",
    tesla: "TSLA",
    "tesla inc": "TSLA"
  });

export interface HypotheticalPortfolioAllocation {
  readonly label: string;
  readonly symbol: string | null;
  readonly category: string;
  readonly theme: "technology" | "technology-dependent" | "cash" | "unclassified";
  readonly allocationRate: DecimalString;
  readonly amount: DecimalString | null;
}

export interface HypotheticalPortfolioScenario {
  readonly schemaVersion: "assistant-v3.hypothetical-portfolio-input.v1";
  readonly dataClass: "user-supplied-hypothetical";
  readonly currency: "USD";
  readonly totalValue: DecimalString | null;
  readonly allocations: readonly HypotheticalPortfolioAllocation[];
}

export type HypotheticalPortfolioParseResult =
  | {
      readonly status: "supported";
      readonly scenario: HypotheticalPortfolioScenario;
    }
  | {
      readonly status: "not-present" | "invalid";
      readonly reason: string;
    };

export interface HypotheticalPositionScenario {
  readonly schemaVersion: "assistant-v3.hypothetical-position-input.v1";
  readonly dataClass: "user-supplied-hypothetical";
  readonly symbol: string;
  readonly quantity: DecimalString;
  readonly unitCost: DecimalString;
  readonly currency: "USD";
}

export type HypotheticalPositionParseResult =
  | {
      readonly status: "supported";
      readonly scenario: HypotheticalPositionScenario;
    }
  | {
      readonly status: "not-present" | "invalid";
      readonly reason: string;
    };

function normalizedAssetLabel(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\b(?:shares?|stock|equity)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[,:;.\s]+$/gu, "")
    .toLocaleLowerCase("en-US");
}

function scenarioAsset(
  rawLabel: string
): Omit<HypotheticalPortfolioAllocation, "allocationRate" | "amount"> | null {
  const normalized = normalizedAssetLabel(rawLabel);
  if (/^(?:cash|nağd(?:\s+(?:vəsait|pul))?)$/u.test(normalized)) {
    return {
      label: "Cash",
      symbol: null,
      category: "Cash",
      theme: "cash"
    };
  }
  const alias = COMPANY_ALIASES[normalized];
  const ticker = alias ??
    (/^[a-z]{1,5}(?:\.[a-z])?$/u.test(normalized)
      ? normalized.toUpperCase()
      : null);
  if (ticker === null) return null;
  const reviewed = REVIEWED_ASSET_CATALOG[
    ticker as keyof typeof REVIEWED_ASSET_CATALOG
  ];
  return {
    label: reviewed?.label ?? ticker,
    symbol: ticker,
    category: reviewed?.category ?? "Individual security",
    theme: reviewed?.theme ?? "unclassified"
  };
}

function decimalFromText(value: string): DecimalString | null {
  const normalized = value.replaceAll(",", "");
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/u.test(normalized)) return null;
  try {
    const parsed = parseFixedDecimal(decimal(normalized));
    return parsed > ZERO_FIXED ? formatFixedDecimal(parsed) : null;
  } catch {
    return null;
  }
}

function scenarioTotalValue(message: string): DecimalString | null {
  const match =
    /\b(?:portfolio\s+(?:worth|value(?:d)?\s+at)|portfolio\s+(?:of|is)|worth)\s*(?:USD\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)/iu
      .exec(message);
  return match?.[1] ? decimalFromText(match[1]) : null;
}

export function parseHypotheticalPortfolioScenario(
  message: string
): HypotheticalPortfolioParseResult {
  const normalized = message.normalize("NFKC");
  const matches = [...normalized.matchAll(
    /(?<![\p{L}\p{N}])((?:100|[1-9]?\d)(?:\.\d{1,2})?)\s*%\s*(?:in\s+)?([\p{L}][\p{L}\p{N} .&-]{0,36}?)(?=\s*(?:,|;|\band\b|(?<!\p{L})və(?!\p{L})|\.|$))/giu
  )];
  if (matches.length < 2) {
    return { status: "not-present", reason: "fewer_than_two_allocations" };
  }
  if (matches.length > MAX_SCENARIO_POSITIONS) {
    return { status: "invalid", reason: "too_many_allocations" };
  }

  const totalValue = scenarioTotalValue(normalized);
  const allocations: HypotheticalPortfolioAllocation[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const percentage = match[1];
    const rawLabel = match[2];
    if (!percentage || !rawLabel) {
      return { status: "invalid", reason: "allocation_shape_invalid" };
    }
    const asset = scenarioAsset(rawLabel);
    const percent = decimalFromText(percentage);
    if (asset === null || percent === null) {
      return { status: "invalid", reason: "allocation_asset_or_rate_invalid" };
    }
    const key = asset.symbol ?? "CASH";
    if (seen.has(key)) {
      return { status: "invalid", reason: "duplicate_allocation" };
    }
    seen.add(key);
    const allocationRate = formatFixedDecimal(
      divideFixed(parseFixedDecimal(percent), ONE_HUNDRED)
    );
    const amount = totalValue === null
      ? null
      : formatFixedDecimal(
          multiplyFixed(
            parseFixedDecimal(totalValue),
            parseFixedDecimal(allocationRate)
          )
        );
    allocations.push({ ...asset, allocationRate, amount });
  }
  const totalRate = sumFixed(
    allocations.map(({ allocationRate }) => parseFixedDecimal(allocationRate))
  );
  if (totalRate !== ONE) {
    return { status: "invalid", reason: "allocations_must_total_100_percent" };
  }
  if (!allocations.some(({ theme }) => theme === "cash")) {
    return { status: "invalid", reason: "cash_allocation_missing" };
  }
  return {
    status: "supported",
    scenario: {
      schemaVersion: "assistant-v3.hypothetical-portfolio-input.v1",
      dataClass: "user-supplied-hypothetical",
      currency: "USD",
      totalValue,
      allocations
    }
  };
}

export function parseHypotheticalPositionScenario(
  message: string,
  symbol: string
): HypotheticalPositionParseResult {
  const normalized = message.normalize("NFKC");
  const quantityMatch =
    /(?<![\p{L}\p{N}])(\d+(?:\.\d{1,8})?)\s+(?:[A-Z]{1,5}\s+)?(?:shares?|s[əe]hm\p{L}*)(?!\p{L})/iu
      .exec(normalized);
  const costMatch = (
    /\b(?:bought|purchased|acquired)\b[^$0-9]{0,36}(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,8})?)(?:\s*(?:each|per\s+share))?/iu
      .exec(normalized) ??
    /(?<!\p{L})al[ıi][şs]\s+qiym[əe]ti[^$0-9]{0,36}(?:s[əe]hm\s+ba[şs][ıi]na\s+)?(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,8})?)/iu
      .exec(normalized)
  );
  if (!quantityMatch?.[1] || !costMatch?.[1]) {
    return { status: "not-present", reason: "quantity_or_unit_cost_missing" };
  }
  const quantity = decimalFromText(quantityMatch[1]);
  const unitCost = decimalFromText(costMatch[1]);
  if (
    quantity === null ||
    unitCost === null ||
    !/^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(symbol)
  ) {
    return { status: "invalid", reason: "position_values_invalid" };
  }
  return {
    status: "supported",
    scenario: {
      schemaVersion: "assistant-v3.hypothetical-position-input.v1",
      dataClass: "user-supplied-hypothetical",
      symbol,
      quantity,
      unitCost,
      currency: "USD"
    }
  };
}

function inlineEvidenceText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .replace(/[.!?]+/gu, ";")
    .trim()
    .replace(/[;,:\s]+$/gu, "")
    .slice(0, 80);
}

function formatQuantityExact(
  value: DecimalString,
  locale: SupportedLocale
): string {
  return formatDecimalExact(value, locale, 8)
    .replace(/([.,]\d*?[1-9])0+$/u, "$1")
    .replace(/[.,]0+$/u, "");
}

function claim(input: {
  id: string;
  locale: SupportedLocale;
  aliases: readonly string[];
}): ClaimDraft {
  return {
    claimId: input.id,
    locale: input.locale,
    textTemplate: input.aliases.map((alias) => `{{${alias}}}`).join(" "),
    factRefs: [...input.aliases],
    citationRefs: [],
    limitations: []
  };
}

function createScenarioFact<T>(input: {
  context: TrustedRequestContext;
  workflowRunId: string;
  signer: DevHmacSigner;
  kind: string;
  subject: FactEnvelope<T>["subject"];
  value: T;
  tools?: readonly ToolExecutionEnvelope<unknown>[];
  calculationId: string;
  formulaId: string;
  flags: readonly string[];
  asOf?: string;
}): FactEnvelope<T> {
  const requestedAt = Date.parse(input.context.requestedAt);
  if (!Number.isFinite(requestedAt)) throw new Error("Invalid trusted request time.");
  const tools = input.tools ?? [];
  return new EvidenceFactory({
    signer: input.signer,
    now: () => requestedAt
  }).fact({
    requestId: input.context.requestId,
    workflowRunId: input.workflowRunId,
    kind: input.kind,
    subject: input.subject,
    asOf: input.asOf ?? input.context.requestedAt,
    value: input.value,
    provenance: {
      toolExecutionIds: tools.map(({ executionId }) => executionId),
      inputFactIds: [],
      calculation: {
        id: input.calculationId,
        version: "1.0.0",
        formulaId: input.formulaId
      }
    },
    quality: {
      status: "complete",
      coverage: decimal("1"),
      flags: [...input.flags]
    }
  });
}

function renderable(
  fact: FactEnvelope<unknown>,
  alias: string,
  display: string,
  meaning: string,
  semanticRoles: RenderableFact["semanticRoles"]
): RenderableFact {
  return {
    alias,
    fact,
    display,
    meaning,
    required: true,
    ...(semanticRoles === undefined ? {} : { semanticRoles })
  };
}

export function projectHypotheticalPortfolioAnalysis(
  scenario: HypotheticalPortfolioScenario
) {
  const sortedInvestments = scenario.allocations
    .filter(({ theme }) => theme !== "cash")
    .sort((left, right) => {
      const leftRate = parseFixedDecimal(left.allocationRate);
      const rightRate = parseFixedDecimal(right.allocationRate);
      return leftRate === rightRate ? 0 : leftRate > rightRate ? -1 : 1;
    });
  const cash = scenario.allocations.find(({ theme }) => theme === "cash");
  const largest = sortedInvestments[0];
  if (cash === undefined || largest === undefined) {
    throw new Error("A hypothetical portfolio requires cash and an investment.");
  }
  const topTwoRate = formatFixedDecimal(sumFixed(
    sortedInvestments
      .slice(0, 2)
      .map(({ allocationRate }) => parseFixedDecimal(allocationRate))
  ));
  const technologyRelatedRate = formatFixedDecimal(sumFixed(
    sortedInvestments
      .filter(({ theme }) =>
        theme === "technology" || theme === "technology-dependent"
      )
      .map(({ allocationRate }) => parseFixedDecimal(allocationRate))
  ));
  return {
    ...scenario,
    analysis: {
      largestPosition: largest.symbol ?? largest.label,
      largestAllocationRate: largest.allocationRate,
      topTwoAllocationRate: topTwoRate,
      technologyAndTechnologyDependentRate: technologyRelatedRate,
      cashAllocationRate: cash.allocationRate,
      recommendationAllowed: false as const
    },
    sectors: scenario.allocations.map((allocation) => ({
      sector: allocation.symbol === null
        ? allocation.label
        : `${allocation.label} (${allocation.symbol})`,
      marketValue: allocation.amount,
      totalPortfolioAllocationRate: allocation.allocationRate
    }))
  };
}

export function buildHypotheticalPortfolioPresentation(input: {
  scenario: HypotheticalPortfolioScenario;
  context: TrustedRequestContext;
  workflowRunId: string;
  tools: readonly ToolExecutionEnvelope<unknown>[];
  signer: DevHmacSigner;
}): CapabilityPresentation {
  const presentation = buildPortfolioAllocationAnalysisPresentation({
    scope: "hypothetical",
    context: input.context,
    workflowRunId: input.workflowRunId,
    tools: input.tools,
    signer: input.signer,
    writerGoal:
      "Explain the user-supplied allocation, observed concentration, correlated theme exposure, cash role, and neutral review dimensions. Do not recommend a trade, target weight, or portfolio change."
  });
  const factValue = presentation.facts[0]?.value;
  if (
    typeof factValue !== "object" ||
    factValue === null ||
    canonicalHash({
      currency: (factValue as PortfolioAllocationAnalysisResult).currency,
      totalValue: (factValue as PortfolioAllocationAnalysisResult).totalValue,
      allocations: (factValue as PortfolioAllocationAnalysisResult).allocations.map(
        ({ isCash: _isCash, ...allocation }) => allocation
      )
    }) !== canonicalHash({
      currency: input.scenario.currency,
      totalValue: input.scenario.totalValue,
      allocations: input.scenario.allocations
    })
  ) {
    throw new Error("Signed allocation analysis does not match the supplied scenario.");
  }
  return presentation;
}

function riskBand(
  result: PortfolioAllocationAnalysisResult,
  code: PortfolioAllocationRiskSignalCode
): PortfolioAllocationAnalysisResult["riskSignals"][number]["band"] {
  const signal = result.riskSignals.find((item) => item.code === code);
  if (signal === undefined) throw new Error(`Missing allocation risk signal: ${code}`);
  return signal.band;
}

function localizedRiskBand(
  band: PortfolioAllocationAnalysisResult["riskSignals"][number]["band"],
  locale: SupportedLocale
): string {
  if (locale !== "az-AZ") return band;
  return {
    low: "aşağı",
    moderate: "orta",
    elevated: "yüksək"
  }[band];
}

function localizedReviewDimension(
  dimension: PortfolioAllocationAnalysisResult["reviewDimensions"][number],
  locale: SupportedLocale
): string {
  if (locale !== "az-AZ") {
    return dimension.toLocaleLowerCase("en-US").replaceAll("_", " ");
  }
  return {
    COMPANY_CONCENTRATION: "şirkət konsentrasiyası",
    SECTOR_DIVERSIFICATION: "sektor diversifikasiyası",
    INDIVIDUAL_STOCK_VOLATILITY: "fərdi səhm riski",
    VALUATION_SENSITIVITY: "qiymətləndirmə riski",
    LIQUIDITY_NEEDS: "likvidlik ehtiyacı",
    TIME_HORIZON: "investisiya müddəti",
    LOSS_CAPACITY: "zərər qabiliyyəti",
    FEES_TAXES: "komissiyalar və vergilər"
  }[dimension];
}

function buildPortfolioAllocationAnalysisPresentation(input: {
  scope: "current" | "hypothetical";
  context: TrustedRequestContext;
  workflowRunId: string;
  tools: readonly ToolExecutionEnvelope<unknown>[];
  signer: DevHmacSigner;
  writerGoal: string;
}): CapabilityPresentation {
  const tool = input.tools.find(
    ({ toolId }) => toolId === "analyze-portfolio-allocation"
  );
  const value = requireSignedToolResult<PortfolioAllocationAnalysisResult>({
    envelope: tool,
    toolId: "analyze-portfolio-allocation",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  if (
    value.schemaVersion !== "assistant-v3.portfolio-allocation-analysis.v1" ||
    value.scope !== input.scope ||
    value.recommendationAllowed !== false
  ) {
    throw new Error("Signed allocation analysis result has an invalid scope.");
  }
  const fact = createScenarioFact({
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer,
    kind: input.scope === "current"
      ? "portfolio.allocation-risk-analysis"
      : "portfolio.hypothetical-allocation-analysis",
    subject: {
      type: "portfolio",
      ref: input.scope === "current"
        ? "portfolio:primary"
        : "portfolio:hypothetical:user-supplied"
    },
    value,
    tools: [tool!],
    calculationId: "signed-portfolio-allocation-analysis",
    formulaId: "signed-allocation-analysis-tool-result-v1",
    flags: input.scope === "current"
      ? ["SYNTHETIC_CLIENT_DATA", "NON_ADVISORY"]
      : [
          "USER_SUPPLIED_HYPOTHETICAL",
          "REVIEWED_ASSET_CLASSIFICATION",
          "NON_ADVISORY"
        ],
    asOf: value.asOf
  });
  const locale = input.context.locale;
  const allocationItems = value.allocations.map((allocation) => {
    const identity = allocation.symbol === null
      ? locale === "az-AZ" ? "Nağd vəsait" : "Cash"
      : allocation.symbol;
    const rate = formatPercentRateExact(allocation.allocationRate, locale);
    return allocation.amount === null
      ? `${identity} — ${rate}`
      : `${identity} — ${rate} (${formatMoneyExact(
          allocation.amount,
          value.currency,
          locale
        )})`;
  });
  const allocationDisplay = locale === "az-AZ"
    ? `Portfelin cari bölgüsü belədir: ${allocationItems.join(", ")}.`
    : `The current portfolio allocation is: ${allocationItems.join(", ")}.`;
  const largestRate = formatPercentRateExact(
    value.metrics.largestAllocationRate,
    locale
  );
  const topTwoRate = formatPercentRateExact(
    value.metrics.topTwoAllocationRate,
    locale
  );
  const singleCompanyBand = localizedRiskBand(
    riskBand(value, "SINGLE_COMPANY_CONCENTRATION"),
    locale
  );
  const topTwoBand = localizedRiskBand(
    riskBand(value, "TOP_TWO_CONCENTRATION"),
    locale
  );
  const profileComparison = value.riskProfile === null
    ? ""
    : locale === "az-AZ"
      ? `; profil üzrə tək səhm həddi ${formatPercentRateExact(
          value.riskProfile.singleStockTargetMaxAllocationRate,
          locale
        )}-dir və ən böyük mövqe ${
          value.largestPositionExceedsProfileTarget === true
            ? "həddən yuxarıdır"
            : "hədd daxilindədir"
        }`
      : `; the profile’s single-stock limit is ${formatPercentRateExact(
          value.riskProfile.singleStockTargetMaxAllocationRate,
          locale
        )}, and the largest position is ${
          value.largestPositionExceedsProfileTarget === true
            ? "above that limit"
            : "within that limit"
        }`;
  const concentrationDisplay = locale === "az-AZ"
    ? `Konsentrasiya baxımından ən böyük mövqe ${value.metrics.largestPosition}-dır (${largestRate}); ilk iki mövqe birlikdə ${topTwoRate} təşkil edir; tək şirkət konsentrasiyası ${singleCompanyBand}, ilk iki mövqenin konsentrasiyası isə ${topTwoBand} səviyyədədir${profileComparison}.`
    : `On concentration, the largest position is ${value.metrics.largestPosition} at ${largestRate}; the top two total ${topTwoRate}; their bands are ${singleCompanyBand} and ${topTwoBand}${profileComparison}.`;
  const technologyRate = formatPercentRateExact(
    value.metrics.technologyAndTechnologyDependentRate,
    locale
  );
  const themeBand = localizedRiskBand(
    riskBand(value, "THEME_CORRELATION"),
    locale
  );
  const themeDisplay = locale === "az-AZ"
    ? `Texnologiya ilə əlaqəli mövqelərin çəkisi ${technologyRate}-dir və əlaqəlilik riski ${themeBand} səviyyədədir.`
    : `Technology-related positions make up ${technologyRate} of the portfolio, with a ${themeBand} correlation band.`;
  const cashRate = formatPercentRateExact(
    value.metrics.cashAllocationRate,
    locale
  );
  const cashBand = localizedRiskBand(
    riskBand(value, "CASH_PURCHASING_POWER"),
    locale
  );
  const cashDisplay = locale === "az-AZ"
    ? `Nağd vəsaitin çəkisi ${cashRate}-dir və alıcılıq qabiliyyəti ${cashBand} səviyyədədir.`
    : `Cash represents ${cashRate} of the portfolio, with a ${cashBand} purchasing-power band.`;
  const reviewDimensions = value.reviewDimensions
    .filter((item) => item !== "COMPANY_CONCENTRATION")
    .map((item) => localizedReviewDimension(item, locale))
    .join(", ");
  const reviewDisplay = locale === "az-AZ"
    ? `Daha geniş baxışda ${reviewDimensions} də birlikdə nəzərdən keçirilməlidir.`
    : `A broader review should consider ${reviewDimensions} together.`;
  const slots = [
    renderable(
      fact,
      "ALLOCATION",
      allocationDisplay,
      "signed portfolio allocations and derived values",
      ["portfolio.identity", "portfolio.allocation"]
    ),
    renderable(
      fact,
      "CONCENTRATION",
      concentrationDisplay,
      "signed largest-position and top-two concentration observations and bands",
      ["risk.concentration", "portfolio.allocation"]
    ),
    renderable(
      fact,
      "THEME",
      themeDisplay,
      "signed technology and technology-dependent exposure and correlation band",
      ["risk.concentration", "portfolio.allocation"]
    ),
    renderable(
      fact,
      "CASH",
      cashDisplay,
      "signed cash allocation and purchasing-power review band",
      ["portfolio.cash", "portfolio.allocation"]
    ),
    renderable(
      fact,
      "REVIEW_DIMENSIONS",
      reviewDisplay,
      "neutral dimensions to consider without selecting an action",
      ["risk.generic", "portfolio.allocation"]
    )
  ];
  return {
    status: "complete",
    facts: [fact],
    renderableFacts: slots,
    citations: [],
    renderableCitations: [],
    cards: [{
      cardId: `card-${fact.factId}`,
      kind: "allocation",
      title: input.scope === "current"
        ? locale === "az-AZ"
          ? "Portfel bölgüsü üzrə risk baxışı"
          : "Portfolio allocation risk review"
        : locale === "az-AZ"
          ? "Hipotetik portfel bölgüsü"
          : "Hypothetical portfolio allocation",
      factRefs: [fact.factId],
      data: value
    }],
    charts: [],
    freshness: [{
      sourceId: tool!.source.sourceId,
      asOf: tool!.source.sourceAsOf,
      status: "indicative",
      delayMinutes: null
    }],
    notices: [
      input.scope === "current"
        ? locale === "az-AZ"
          ? "Bağlı müştəri portfeli sintetikdir və bölgü cari inkişaf bazarı qiymətləri ilə hesablanır."
          : "The connected client portfolio is synthetic and allocation uses current development-market prices."
        : locale === "az-AZ"
          ? "Təhlil yalnız yazdığınız hipotetik rəqəmlərdən istifadə edir."
          : "The analysis uses only the hypothetical figures you supplied.",
      locale === "az-AZ"
        ? "Bu köməkçi investisiya məsləhətçisi deyil və konkret alqı, saxlama, satış və ya portfel bölgüsü tövsiyə etmir."
        : "This assistant is not an investment adviser and does not recommend a specific purchase, hold, sale, or portfolio allocation.",
      locale === "az-AZ"
        ? "Bütün investisiyalar risk daşıyır və kapitalınız risk altındadır."
        : "All investing carries risk, and your capital is at risk."
    ],
    // The fallback remains fully signed, but each projection is a complete
    // reader-facing sentence so a model timeout never degrades into a slot dump.
    fallback: [claim({
      id: input.scope === "current"
        ? "fallback-current-allocation-tool-evidence"
        : "fallback-hypothetical-allocation-tool-evidence",
      locale,
      aliases: input.scope === "current"
        ? [
            "CONCENTRATION",
            "THEME",
            "CASH",
            "ALLOCATION",
            "REVIEW_DIMENSIONS"
          ]
        : slots.map(({ alias }) => alias)
    })],
    writerGoal: input.writerGoal
  };
}

export function buildCurrentPortfolioAllocationPresentation(input: {
  context: TrustedRequestContext;
  workflowRunId: string;
  tools: readonly ToolExecutionEnvelope<unknown>[];
  signer: DevHmacSigner;
  lens: "risk" | "nonadvisory-review";
}): CapabilityPresentation {
  return buildPortfolioAllocationAnalysisPresentation({
    scope: "current",
    context: input.context,
    workflowRunId: input.workflowRunId,
    tools: input.tools,
    signer: input.signer,
    writerGoal: input.lens === "risk"
      ? "Give a concise, natural-language portfolio risk explanation. Start with the most material signed observation, explain why it matters, then connect the other measured signals and neutral review dimensions without recommending an action."
      : "Give a concise, natural-language review of the signed allocation observations and the factors a professional review would cover. State the non-advisory boundary without recommending changes, trades, or target weights."
  });
}

function requireSignedToolResult<TResult>(input: {
  envelope: ToolExecutionEnvelope<unknown> | undefined;
  toolId: string;
  context: TrustedRequestContext;
  workflowRunId: string;
  signer: DevHmacSigner;
}): TResult {
  const evidence = new EvidenceFactory({ signer: input.signer });
  const envelope = input.envelope;
  if (
    envelope === undefined ||
    envelope.toolId !== input.toolId ||
    envelope.requestId !== input.context.requestId ||
    envelope.workflowRunId !== input.workflowRunId ||
    envelope.status !== "success" ||
    envelope.result === null ||
    !evidence.verifyTool(envelope)
  ) {
    throw new Error(`${input.toolId} did not return valid signed evidence.`);
  }
  return envelope.result as TResult;
}

export function projectHypotheticalPositionAnalysis(input: {
  scenario: HypotheticalPositionScenario;
  resolved: ResolvedInstrument;
  market: BoundaryMarketSnapshot;
}) {
  if (
    input.resolved.symbol !== input.scenario.symbol ||
    input.market.symbol !== input.scenario.symbol ||
    input.market.currency !== input.scenario.currency
  ) {
    throw new Error("Hypothetical position evidence does not match the supplied symbol.");
  }
  const quantity = parseFixedDecimal(input.scenario.quantity);
  const unitCost = parseFixedDecimal(input.scenario.unitCost);
  const currentPrice = parseFixedDecimal(input.market.price);
  const initialInvestment = multiplyFixed(quantity, unitCost);
  const currentValue = multiplyFixed(quantity, currentPrice);
  const gainLoss = subtractFixed(currentValue, initialInvestment);
  const returnRate = divideFixed(gainLoss, initialInvestment);
  return {
    schemaVersion: "assistant-v3.hypothetical-position-analysis.v1" as const,
    dataClass: input.scenario.dataClass,
    symbol: input.scenario.symbol,
    displayName: input.resolved.displayName,
    currency: input.scenario.currency,
    quantity: input.scenario.quantity,
    unitCost: input.scenario.unitCost,
    initialInvestment: formatFixedDecimal(initialInvestment),
    currentPrice: input.market.price,
    currentValue: formatFixedDecimal(currentValue),
    gainLoss: formatFixedDecimal(gainLoss),
    returnRate: formatFixedDecimal(returnRate),
    marketAsOf: input.market.asOf,
    marketFreshness: input.market.freshness,
    recommendationAllowed: false as const,
    perspectives: [
      {
        id: "ADD_EXPOSURE",
        label: "Buying more",
        detail: "would raise the position size, company-specific risk, and average cost when the new price is above the original cost"
      },
      {
        id: "KEEP_EXPOSURE",
        label: "Holding",
        detail: "would preserve the current upside and downside exposure without realizing the current gain or loss"
      },
      {
        id: "REDUCE_EXPOSURE",
        label: "Selling some or all",
        detail: "would lower the position exposure and realize some or all of the current gain or loss before unassessed taxes and costs"
      }
    ]
  };
}

export function buildHypotheticalPositionPresentation(input: {
  scenario: HypotheticalPositionScenario;
  context: TrustedRequestContext;
  workflowRunId: string;
  tools: readonly ToolExecutionEnvelope<unknown>[];
  signer: DevHmacSigner;
}): CapabilityPresentation {
  const resolvedTool = input.tools.find(({ toolId }) => toolId === "resolve-instrument");
  const marketTool = input.tools.find(({ toolId }) => toolId === "read-market-snapshot");
  const resolved = requireSignedToolResult<ResolvedInstrument>({
    envelope: resolvedTool,
    toolId: "resolve-instrument",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  const market = requireSignedToolResult<BoundaryMarketSnapshot>({
    envelope: marketTool,
    toolId: "read-market-snapshot",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  const value = projectHypotheticalPositionAnalysis({
    scenario: input.scenario,
    resolved,
    market
  });
  const fact = createScenarioFact({
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer,
    kind: "portfolio.hypothetical-position-analysis",
    subject: { type: "instrument", ref: input.scenario.symbol },
    value,
    tools: input.tools,
    calculationId: "reviewed-hypothetical-position-analysis",
    formulaId: "user-supplied-position-current-market-comparison-v1",
    flags: [
      "USER_SUPPLIED_HYPOTHETICAL",
      "PUBLIC_DEVELOPMENT_MARKET_FEED",
      "NON_ADVISORY"
    ]
  });
  const locale = input.context.locale;
  const name = inlineEvidenceText(resolved.displayName);
  const quantityDisplay = formatQuantityExact(input.scenario.quantity, locale);
  const basisText = locale === "az-AZ"
    ? `Hipotetik giriş: ${quantityDisplay} ədəd ${name} (${input.scenario.symbol}) səhmi, hər biri ${formatMoneyExact(input.scenario.unitCost, input.scenario.currency, locale)}; ilkin məbləğ ${formatMoneyExact(value.initialInvestment, value.currency, locale)}.`
    : `Hypothetical input: ${quantityDisplay} shares of ${name} (${input.scenario.symbol}) at ${formatMoneyExact(input.scenario.unitCost, input.scenario.currency, locale)} each; initial investment ${formatMoneyExact(value.initialInvestment, value.currency, locale)}.`;
  const marketText = locale === "az-AZ"
    ? `İndikativ qiymət ${formatMoneyExact(market.price, market.currency, locale)}, dəyər ${formatMoneyExact(value.currentValue, value.currency, locale)}, dəyişmə ${formatMoneyExact(value.gainLoss, value.currency, locale)} və ya ${formatPercentRateExact(value.returnRate, locale, true)}; məlumat ${market.asOf} tarixinədir.`
    : `Indicative price ${formatMoneyExact(market.price, market.currency, locale)}, value ${formatMoneyExact(value.currentValue, value.currency, locale)}, change ${formatMoneyExact(value.gainLoss, value.currency, locale)} or ${formatPercentRateExact(value.returnRate, locale, true)}; data as of ${market.asOf}.`;
  const perspectiveText = locale === "az-AZ"
    ? "Ümumi yanaşmalar: əlavə alış ekspozisiyanı və orta dəyəri artıra bilər; saxlama artım və eniş ekspozisiyasını qoruyar; satış ekspozisiyanı azaldar və nəticəni reallaşdırar."
    : "Common perspectives: buying more raises exposure and may raise average cost; holding preserves upside and downside exposure; selling reduces exposure and realizes the result.";
  const riskText = locale === "az-AZ"
    ? "Şirkətə xas və bazar itkiləri mümkündür; digər aktivlər, likvidlik ehtiyacları, vergilər və xərclər daxil deyil."
    : "Company-specific and market losses remain possible; other holdings, liquidity needs, taxes, and costs are excluded.";
  const boundaryText = locale === "az-AZ"
    ? "Bu rəqəmləri və yanaşmaları izah edə bilərəm, lakin daha çox almaq, saxlamaq və ya satmaq barədə tövsiyə verə bilmərəm."
    : "I can explain these figures and perspectives, but I cannot recommend buying more, holding, or selling.";
  const slots = [
    renderable(fact, "POS_BASIS", basisText,
      "user-supplied hypothetical position quantity, unit cost, and initial investment",
      ["portfolio.identity", "portfolio.cost", "portfolio.holding_value"]),
    renderable(fact, "POS_MARKET", marketText,
      "verified current price and deterministic hypothetical gain or loss",
      ["market.price", "portfolio.holding_value", "portfolio.return"]),
    renderable(fact, "POS_PERSPECTIVES", perspectiveText,
      "unranked buy, hold, and sell trade-off descriptions",
      ["portfolio.allocation", "risk.concentration"]),
    renderable(fact, "POS_RISKS", riskText,
      "single-company risk and calculation limitations",
      ["risk.generic", "risk.concentration"]),
    renderable(fact, "POS_BOUNDARY", boundaryText,
      "explicit non-advisory buy, hold, and sell boundary",
      ["risk.generic"])
  ];
  return {
    status: "complete",
    facts: [fact],
    renderableFacts: slots,
    citations: [],
    renderableCitations: [],
    cards: [{
      cardId: `card-${fact.factId}`,
      kind: "position-analysis",
      title: locale === "az-AZ"
        ? `${input.scenario.symbol} hipotetik mövqe təhlili`
        : `${input.scenario.symbol} hypothetical position`,
      factRefs: [fact.factId],
      data: value
    }],
    charts: [],
    freshness: [{
      sourceId: marketTool!.source.sourceId,
      asOf: market.asOf,
      status: market.freshness,
      delayMinutes: String(market.delayMinutes)
    }],
    notices: [
      locale === "az-AZ"
        ? "Mövqe ölçüsü və alış qiyməti sizin yazdığınız hipotetik rəqəmlərdir; cari qiymət indikativ bazar məlumatıdır."
        : "The share count and purchase price are user-supplied hypothetical figures; the current price is indicative market data.",
      locale === "az-AZ"
        ? "Keçmiş nəticələr gələcək nəticələrin etibarlı göstəricisi deyil və kapitalınız risk altındadır."
        : "Past performance is not a reliable indicator of future results, and your capital is at risk."
    ],
    fallback: [claim({
      id: `fallback-hypothetical-position-${input.scenario.symbol}`,
      locale,
      aliases: slots.map(({ alias }) => alias)
    })],
    writerGoal: "explain a user-supplied hypothetical position, current market comparison, and unranked buy, hold, and sell perspectives without recommending an action"
  };
}
