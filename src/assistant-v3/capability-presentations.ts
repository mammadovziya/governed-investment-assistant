import type { SecurityNewsItem } from "../domain/security-research.js";
import type {
  FinancialEducationCitation,
  FinancialEducationRetrievalResult
} from "../domain/financial-education.js";
import { analyzeNewsSentiment } from "../services/news-sentiment.js";
import { calculateTechnicalIndicators } from "../services/technical-indicators.js";
import type {
  BoundaryMarketSnapshot,
  BoundaryPriceHistory,
  CurrencyConversionResult,
  ResolvedInstrument
} from "./boundary-tools.js";
import type {
  AssistantCard,
  AssistantChart,
  AssistantCitation,
  AssistantFreshness,
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
  FIXED_DECIMAL_FACTOR,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal,
  subtractFixed,
  sumFixed
} from "./fixed-decimal.js";
import type {
  AnalystConsensusFacts,
  DataFact,
  EtfCreditQualityFacts,
  EtfFacts,
  InstrumentFacts,
  InstrumentMetric,
  EtfConcentrationFacts
} from "./instrument-research.js";
import type { MarketContentItem } from "./market-content.js";
import type { MockPortfolioPositionSnapshot } from "./mock-portfolio.js";
import {
  formatDecimalExact,
  formatMoneyExact,
  formatPercentRateExact
} from "./presentation.js";
import type {
  ProjectedApprovedKnowledgeEvidence
} from "./approved-knowledge.js";
import type { RenderableCitation, RenderableFact } from "./rendering.js";
import type { V3Function, V3ResearchFacet } from "./routing.js";
import { canonicalHash, type DevHmacSigner } from "./signing.js";

type PublicRoute = Extract<V3Function,
  | "market_quote"
  | "market_history"
  | "market_event"
  | "company_research"
  | "technical_analysis"
  | "news_sentiment"
  | "market_move_explanation"
  | "security_risk"
  | "etf_explanation_risk">;

interface PublicPresentationItem {
  fact: FactEnvelope<unknown>;
  display: string;
  renderableFacts?: RenderableFact[];
  fallback?: ClaimDraft[];
  card: AssistantCard;
  chart: AssistantChart | null;
  freshness: AssistantFreshness | null;
  partial: boolean;
  notices: string[];
}

export interface CapabilityPresentation {
  status: "complete" | "partial" | "unavailable";
  facts: FactEnvelope<unknown>[];
  renderableFacts: RenderableFact[];
  citations: AssistantCitation[];
  renderableCitations: RenderableCitation[];
  cards: AssistantCard[];
  charts: AssistantChart[];
  freshness: AssistantFreshness[];
  notices: string[];
  fallback: ClaimDraft[];
  writerGoal: string;
}

function requireResult<TResult>(input: {
  envelope: ToolExecutionEnvelope<unknown> | undefined;
  toolId: string;
  context: TrustedRequestContext;
  workflowRunId: string;
  signer: DevHmacSigner;
}): TResult {
  const evidence = new EvidenceFactory({ signer: input.signer });
  const envelope = input.envelope;
  if (
    !envelope ||
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

function claim(input: {
  id: string;
  locale: SupportedLocale;
  template: string;
  factRefs: string[];
  citationRefs?: string[];
}): ClaimDraft {
  return {
    claimId: input.id,
    locale: input.locale,
    textTemplate: input.template,
    factRefs: input.factRefs,
    citationRefs: input.citationRefs ?? [],
    limitations: []
  };
}

function fact<T>(input: {
  context: TrustedRequestContext;
  workflowRunId: string;
  signer: DevHmacSigner;
  kind: string;
  symbol: string;
  asOf: string;
  value: T;
  tools: readonly ToolExecutionEnvelope<unknown>[];
  formulaId: string | null;
  partial?: boolean;
}): FactEnvelope<T> {
  const requestedAt = Date.parse(input.context.requestedAt);
  if (!Number.isFinite(requestedAt)) {
    throw new Error("The trusted request timestamp is invalid.");
  }
  return new EvidenceFactory({
    signer: input.signer,
    now: () => requestedAt
  }).fact({
    requestId: input.context.requestId,
    workflowRunId: input.workflowRunId,
    kind: input.kind,
    subject: { type: "instrument", ref: input.symbol },
    asOf: input.asOf,
    value: input.value,
    provenance: {
      toolExecutionIds: input.tools.map(({ executionId }) => executionId),
      inputFactIds: [],
      calculation: input.formulaId === null ? null : {
        id: "public-market-deterministic-services",
        version: "3.0.0",
        formulaId: input.formulaId
      }
    },
    quality: {
      status: input.partial ? "partial" : "complete",
      coverage: decimal(input.partial ? "0.75" : "1"),
      flags: ["PUBLIC_DEVELOPMENT_MARKET_FEED", ...(input.partial ? ["DATA_GAPS"] : [])]
    }
  });
}

function signedDecimal(value: number): DecimalString {
  if (!Number.isFinite(value)) throw new Error("A deterministic metric is not finite.");
  return decimal(value.toFixed(8));
}

function asLegacyHistory(history: BoundaryPriceHistory) {
  return {
    symbol: history.symbol,
    range: history.range,
    interval: history.interval as "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo",
    currency: history.currency,
    exchange: history.exchange,
    asOf: history.asOf,
    source: "Configured market-history adapter",
    points: history.points.map(({ timestamp, close }) => ({
      timestamp,
      close: Number(close)
    }))
  };
}

function chart(history: BoundaryPriceHistory): AssistantChart {
  return {
    chartId: `chart-${history.symbol}-${history.range}`,
    symbol: history.symbol,
    range: history.range,
    currency: history.currency,
    asOf: history.asOf,
    source: "Configured market-history adapter",
    points: history.points
  };
}

function freshness(snapshot: BoundaryMarketSnapshot): AssistantFreshness {
  return {
    sourceId: "market-snapshot",
    asOf: snapshot.asOf,
    status: snapshot.freshness,
    delayMinutes: String(snapshot.delayMinutes)
  };
}

function signedPercentValue(value: DecimalString | null, locale: SupportedLocale): string {
  if (value === null) return locale === "az-AZ" ? "dəyişiklik mövcud deyil" : "change unavailable";
  const formatted = formatDecimalExact(value, locale, 2);
  return `${value.startsWith("-") || value.startsWith("0") ? "" : "+"}${formatted}%`;
}

function availableMetric(
  candidate: { status: string; value?: InstrumentMetric }
): InstrumentMetric | null {
  return candidate.status === "AVAILABLE" && candidate.value ? candidate.value : null;
}

function metricDisplay(metric: InstrumentMetric | null, locale: SupportedLocale): string {
  if (!metric) return locale === "az-AZ" ? "mövcud deyil" : "unavailable";
  if (metric.unit === "currency") {
    return formatMoneyExact(metric.value, metric.currency ?? "USD", locale);
  }
  const suffix = metric.unit === "percent"
    ? "%"
    : metric.unit === "shares"
      ? locale === "az-AZ" ? " səhm" : " shares"
      : metric.unit === "years"
        ? locale === "az-AZ" ? " il" : " years"
        : "";
  return `${formatDecimalExact(metric.value, locale, 2)}${suffix}`;
}

const CUSTOMER_EXCHANGE_LABELS: Readonly<Record<string, string | undefined>> = {
  NasdaqGS: "Nasdaq Global Select Market",
  NasdaqGM: "Nasdaq Global Market",
  NasdaqCM: "Nasdaq Capital Market",
  NYSEArca: "NYSE Arca",
  NYSE: "New York Stock Exchange"
};

function customerExchangeLabel(exchange: string): string {
  return CUSTOMER_EXCHANGE_LABELS[exchange] ?? exchange;
}

/**
 * Produces a conversational magnitude without converting an authoritative
 * decimal to a JavaScript number. The complete exact value remains in the
 * signed fact and structured card.
 */
function compactMarketCapitalization(
  metric: InstrumentMetric,
  locale: SupportedLocale
): string {
  const units = parseFixedDecimal(metric.value);
  const absolute = units < 0n ? -units : units;
  const magnitude = [
    { threshold: 1_000_000_000_000n, suffix: "T" },
    { threshold: 1_000_000_000n, suffix: "B" },
    { threshold: 1_000_000n, suffix: "M" }
  ].find(({ threshold }) => absolute >= threshold * FIXED_DECIMAL_FACTOR);
  if (magnitude === undefined) {
    return formatMoneyExact(metric.value, metric.currency ?? "USD", locale);
  }

  const denominator = magnitude.threshold * FIXED_DECIMAL_FACTOR;
  const hundredths = (absolute * 100n + denominator / 2n) / denominator;
  const integer = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, "0");
  const separator = locale === "az-AZ" ? "," : ".";
  const amount = `${integer.toString()}${separator}${fraction}${magnitude.suffix}`;
  const currency = metric.currency ?? "USD";
  const prefixed = currency === "USD" ? `$${amount}` : `${currency} ${amount}`;
  return `${units < 0n ? "−" : ""}${prefixed}`;
}

function researchSourceSuffix(input: {
  researchTool: ToolExecutionEnvelope<unknown>;
  research: InstrumentFacts;
  locale: SupportedLocale;
}): string {
  const source = input.research.provider.displayName ||
    input.researchTool.source.provider ||
    input.researchTool.source.sourceId;
  return input.locale === "az-AZ"
    ? ` ${input.research.symbol} məlumatı ${input.research.generatedAt} tarixinədir; mənbə: ${source}.`
    : ` Data as of ${input.research.generatedAt} for ${input.research.symbol}; source: ${source}.`;
}

function unavailableField(locale: SupportedLocale): string {
  return locale === "az-AZ" ? "mövcud deyil" : "unavailable";
}

function groundedSlot(input: {
  alias: string;
  fact: FactEnvelope<unknown>;
  display: string;
  meaning: string;
  required?: boolean;
  semanticRoles?: RenderableFact["semanticRoles"];
}): RenderableFact {
  return {
    alias: input.alias,
    fact: input.fact,
    display: input.display,
    meaning: input.meaning,
    required: input.required ?? true,
    ...(input.semanticRoles === undefined
      ? {}
      : { semanticRoles: input.semanticRoles })
  };
}

function metricValue(
  candidate: DataFact<InstrumentMetric>,
  locale: SupportedLocale
): string {
  const metric = availableMetric(candidate);
  return metric === null
    ? unavailableField(locale)
    : metricDisplay(metric, locale);
}

function analystValue(
  candidate: DataFact<AnalystConsensusFacts>,
  locale: SupportedLocale
): string {
  if (candidate.status !== "AVAILABLE") return unavailableField(locale);
  const consensus = candidate.value;
  return locale === "az-AZ"
    ? `“${consensus.recommendation}”, ${String(consensus.analystCount)} analitik, hədəf ${formatMoneyExact(consensus.targetPrice, consensus.currency, locale)}`
    : `“${consensus.recommendation},” based on ${String(consensus.analystCount)} analysts, with a ${formatMoneyExact(consensus.targetPrice, consensus.currency, locale)} target`;
}

function lastDividendValue(
  candidate: InstrumentFacts["lastDividend"],
  locale: SupportedLocale
): string {
  if (candidate.status !== "AVAILABLE") return unavailableField(locale);
  const dividend = candidate.value;
  const amount = formatMoneyExact(dividend.amount, dividend.currency, locale);
  return locale === "az-AZ"
    ? `səhm başına ${amount}, provayderin bildirdiyi tarix ${dividend.date.slice(0, 10)}`
    : `${amount} per share, with provider-reported date ${dividend.date.slice(0, 10)}`;
}

function availableString(candidate: DataFact<string>): string | null {
  return candidate.status === "AVAILABLE" ? candidate.value : null;
}

/**
 * Provider prose is preserved in the signed ETF fact and card. The chat
 * summary intentionally uses a bounded, single-sentence excerpt so a long
 * objective cannot make an otherwise valid financial answer fail delivery.
 */
function boundedEvidenceText(value: string | null, maximumCharacters = 96): string | null {
  if (value === null) return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    // Keep embedded dots in publisher names and abbreviations (for example,
    // `Example.com`) while still flattening actual sentence boundaries.
    .replace(/[.!?]+(?=\s|$)/gu, ";")
    .trim()
    .replace(/[;,:\s]+$/gu, "");
  if (normalized.length <= maximumCharacters) return normalized;
  const candidate = normalized.slice(0, maximumCharacters - 1).trimEnd();
  const wordBoundary = candidate.lastIndexOf(" ");
  const excerpt = wordBoundary >= Math.floor(maximumCharacters * 0.6)
    ? candidate.slice(0, wordBoundary)
    : candidate;
  return `${excerpt.replace(/[;,:\s]+$/gu, "")}…`;
}

const REVIEWED_COMPANY_OVERVIEWS: Readonly<Record<
  string,
  Readonly<Record<SupportedLocale, string>> | undefined
>> = Object.freeze({
  NVDA: Object.freeze({
    "az-AZ":
      "AI hesablamaları və yarımkeçiricilərə fokuslanır; yüksək artım potensialı sektor və təchizat riskini də artırır",
    "en-US":
      "focuses on AI computing and semiconductors; higher growth potential also raises sector and supply-chain risk"
  }),
  AAPL: Object.freeze({
    "az-AZ":
      "cihazlar və rəqəmsal xidmətlər ekosisteminə əsaslanır; geniş istifadəçi bazası nisbətən sabit profil yaradır",
    "en-US":
      "is built around a device and services ecosystem; its broad user base supports a relatively steady profile"
  })
});

const AZERBAIJANI_SECTOR_LABELS: Readonly<Record<string, string | undefined>> =
  Object.freeze({
    Technology: "texnologiya",
    "Financial Services": "maliyyə xidmətləri",
    Healthcare: "səhiyyə",
    "Consumer Cyclical": "istehlak malları",
    "Communication Services": "kommunikasiya xidmətləri",
    Industrials: "sənaye",
    Energy: "enerji",
    Utilities: "kommunal xidmətlər",
    "Real Estate": "daşınmaz əmlak"
  });

function companyOverviewDisplay(
  research: InstrumentFacts,
  locale: SupportedLocale
): string {
  const reviewed = REVIEWED_COMPANY_OVERVIEWS[research.symbol]?.[locale];
  if (reviewed !== undefined) return reviewed;

  if (research.profile.status !== "AVAILABLE") {
    return locale === "az-AZ"
      ? "açıq bazarda ticarət olunan şirkətdir; biznes amilləri və risk profili şirkətə xasdır"
      : "is a publicly traded company with company-specific business drivers and risks";
  }

  const profile = research.profile.value;
  if (locale === "en-US") {
    const summary = boundedEvidenceText(profile.businessSummary, 132);
    if (summary !== null) return summary;
    const classification = [profile.sector, profile.industry]
      .filter((value): value is string => value !== null)
      .join(" / ");
    return classification.length > 0
      ? `operates in ${classification}; its growth and risk profile depends on company and market conditions`
      : "is a publicly traded company with company-specific business drivers and risks";
  }

  const sector = profile.sector === null
    ? null
    : AZERBAIJANI_SECTOR_LABELS[profile.sector] ?? null;
  return sector === null
    ? "açıq bazarda ticarət olunan şirkətdir; biznes amilləri və risk profili şirkətə xasdır"
    : `${sector} sektorunda fəaliyyət göstərir; artım və risk profili gəlir mənbələrindən və bazar şərtlərindən asılıdır`;
}

function comparisonInvestingBoundary(locale: SupportedLocale): string {
  return locale === "az-AZ"
    ? "Vacib hüquqi xatırlatma: bu execution-only köməkçi ümumi məlumat verir, fərdi maliyyə məsləhəti və ya “hansını almaq” tövsiyəsi vermir; uyğunluq məqsəd, müddət və risk dözümlülüyündən asılıdır; kapitalınız risk altındadır və dəyər azala və ya arta bilər; cari məlumat üçün İnvestisiya bölməsində səhmi axtarın."
    : "Important legal reminder: this execution-only assistant gives general information, not personal financial advice or a recommendation on which stock to buy; suitability depends on your goals, time horizon, and risk tolerance; your capital is at risk and values may fall or rise; search for each stock in the Invest section for current information.";
}

function etfConcentrationValue(
  candidate: DataFact<EtfConcentrationFacts>,
  locale: SupportedLocale
): string {
  if (candidate.status !== "AVAILABLE") return unavailableField(locale);
  const concentration = candidate.value;
  return locale === "az-AZ"
    ? `ən böyük mövqe ${formatDecimalExact(concentration.largestHoldingPercent, locale, 2)}%, ilk on mövqe ${formatDecimalExact(concentration.topTenHoldingsPercent, locale, 2)}%`
    : `largest holding ${formatDecimalExact(concentration.largestHoldingPercent, locale, 2)}%, top ten holdings ${formatDecimalExact(concentration.topTenHoldingsPercent, locale, 2)}%`;
}

function etfCreditQualityValue(
  candidate: DataFact<EtfCreditQualityFacts>,
  locale: SupportedLocale
): string {
  if (candidate.status !== "AVAILABLE") return unavailableField(locale);
  const labels: Readonly<Record<string, string | undefined>> = {
    BELOW_B: "below B",
    US_GOVERNMENT: locale === "az-AZ" ? "ABŞ dövlət kağızları" : "US government",
    OTHER: locale === "az-AZ" ? "digər" : "other"
  };
  const entries = candidate.value.entries
    .filter(({ weightPercent }) => parseFixedDecimal(weightPercent) > 0n)
    .sort((left, right) => {
      const leftWeight = parseFixedDecimal(left.weightPercent);
      const rightWeight = parseFixedDecimal(right.weightPercent);
      return leftWeight === rightWeight ? 0 : leftWeight > rightWeight ? -1 : 1;
    })
    .slice(0, 2)
    .map(({ rating, weightPercent }) =>
      `${labels[rating] ?? rating} ${formatDecimalExact(weightPercent, locale, 2)}%`
    );
  return entries.length > 0 ? entries.join(", ") : unavailableField(locale);
}

function etfPresentation(input: {
  research: EtfFacts;
  resolved: ResolvedInstrument;
  locale: SupportedLocale;
}): {
  display: string;
  data: Record<string, unknown>;
  partial: boolean;
} {
  const { research, resolved, locale } = input;
  const category = availableString(research.fund.category);
  const family = availableString(research.fund.fundFamily);
  const objective = boundedEvidenceText(availableString(research.fund.objective));
  const trackedIndex = boundedEvidenceText(availableString(research.fund.trackedIndex));
  const expense = availableMetric(research.fund.expenseRatio);
  const totalAssets = availableMetric(research.fund.totalAssets);
  const averageVolume = availableMetric(research.fund.averageDailyVolume);
  const distributionYield = availableMetric(research.fund.distributionYield);
  const duration = availableMetric(research.instrumentSpecificRisks.duration);
  const maturity = availableMetric(research.instrumentSpecificRisks.maturity);
  const volatility = availableMetric(
    research.instrumentSpecificRisks.annualizedVolatility
  );
  const drawdown = availableMetric(research.instrumentSpecificRisks.maximumDrawdown);
  const concentration = etfConcentrationValue(
    research.instrumentSpecificRisks.concentration,
    locale
  );
  const creditQuality = etfCreditQualityValue(
    research.instrumentSpecificRisks.creditQuality,
    locale
  );
  const objectiveUnavailable = objective === null;
  const indexUnavailable = trackedIndex === null;
  const trackingUnavailable =
    research.instrumentSpecificRisks.trackingDifference.status !== "AVAILABLE";
  const totalAssetsText = totalAssets === null
    ? unavailableField(locale)
    : compactMarketCapitalization(totalAssets, locale);
  const compactCategory = boundedEvidenceText(category, 64);
  const compactFamily = boundedEvidenceText(family, 64);
  const identityText = locale === "az-AZ"
    ? `${resolved.displayName} (${research.symbol}) ETF-dir${compactCategory ? `; kateqoriya: ${compactCategory}` : ""}${compactFamily ? `; fond ailəsi: ${compactFamily}` : ""}.`
    : `${resolved.displayName} (${research.symbol}) is an ETF${compactCategory ? `; category: ${compactCategory}` : ""}${compactFamily ? `; fund family: ${compactFamily}` : ""}.`;
  const scaleText = locale === "az-AZ"
    ? `Xərc və likvidlik: illik xərc nisbəti ${metricDisplay(expense, locale)}, aktivlər ${totalAssetsText}, orta gündəlik həcm ${metricDisplay(averageVolume, locale)}, bölüşdürmə gəlirliliyi ${metricDisplay(distributionYield, locale)}.`
    : `Cost and liquidity: expense ratio ${metricDisplay(expense, locale)}, assets ${totalAssetsText}, average daily volume ${metricDisplay(averageVolume, locale)}, distribution yield ${metricDisplay(distributionYield, locale)}.`;
  const riskText = locale === "az-AZ"
    ? `Risk göstəriciləri: 1 illik volatillik ${metricDisplay(volatility, locale)}, maksimum eniş ${metricDisplay(drawdown, locale)}, müddət ${metricDisplay(duration, locale)}, orta ödəmə müddəti ${metricDisplay(maturity, locale)}; konsentrasiya ${concentration}; əsas kredit kateqoriyaları ${creditQuality}`
    : `Risk indicators: 1Y volatility ${metricDisplay(volatility, locale)}, maximum drawdown ${metricDisplay(drawdown, locale)}, duration ${metricDisplay(duration, locale)}, maturity ${metricDisplay(maturity, locale)}; concentration ${concentration}; largest credit buckets ${creditQuality}`;
  const scopeText = locale === "az-AZ"
    ? `Məqsəd ${objective ?? "mövcud deyil"}; izlənən indeks ${trackedIndex ?? "mövcud deyil"}; izləmə fərqi ${trackingUnavailable ? "mövcud deyil" : metricValue(research.instrumentSpecificRisks.trackingDifference, locale)}.`
    : `Objective ${objective ?? "unavailable"}; tracked index ${trackedIndex ?? "unavailable"}; tracking difference ${trackingUnavailable ? "unavailable" : metricValue(research.instrumentSpecificRisks.trackingDifference, locale)}.`;
  const requiredFacts = [
    research.fund.expenseRatio,
    research.fund.totalAssets,
    research.fund.averageDailyVolume,
    research.fund.distributionYield,
    research.instrumentSpecificRisks.concentration,
    research.instrumentSpecificRisks.trackingDifference,
    research.instrumentSpecificRisks.duration,
    research.instrumentSpecificRisks.creditQuality
  ];
  return {
    display: `${identityText} ${scaleText} ${riskText}; ${scopeText.charAt(0).toLocaleLowerCase(locale)}${scopeText.slice(1)}`,
    data: {
      schemaVersion: "assistant-v3.etf-risk.v1",
      symbol: research.symbol,
      displayName: research.displayName,
      exchange: research.exchange,
      currency: research.currency,
      generatedAt: research.generatedAt,
      research,
      fund: research.fund,
      distributions: {
        distributionYield: research.fund.distributionYield,
        lastDistribution: research.lastDividend
      },
      risks: research.instrumentSpecificRisks
    },
    partial:
      objectiveUnavailable ||
      indexUnavailable ||
      requiredFacts.some(({ status }) => status !== "AVAILABLE")
  };
}

const REVIEWED_RESEARCH_WRITER_GOALS: Readonly<Record<V3ResearchFacet, string>> = {
  listing: "explain only the verified exchange listing and trading currency",
  market_cap: "explain only the verified market capitalization or its explicit unavailability",
  pe: "explain only trailing TTM and forward P/E, preserving unavailable fields",
  dividend: "explain only verified dividend yield and last-reported-dividend fields",
  price_range: "explain only verified one-year high and low closing prices",
  analyst_consensus: "explain only verified analyst consensus or its explicit unavailability",
  risk_comparison: "compare only verified historical risk measures for the routed instruments",
  general: "explain the verified public company research"
};

function findForSymbol(
  tools: readonly ToolExecutionEnvelope<unknown>[],
  toolId: string,
  symbol: string,
  range?: string
): ToolExecutionEnvelope<unknown> | undefined {
  return tools.find((tool) => {
    if (tool.toolId !== toolId || tool.status !== "success" || tool.result === null) return false;
    if (Array.isArray(tool.result)) {
      return tool.result.some((item) =>
        typeof item === "object" &&
        item !== null &&
        "symbols" in item &&
        Array.isArray(item.symbols) &&
        item.symbols.includes(symbol)
      );
    }
    const result = tool.result as { symbol?: unknown; range?: unknown };
    return result.symbol === symbol && (range === undefined || result.range === range);
  });
}

function publicSymbolPresentation(input: {
  route: PublicRoute;
  researchFacet: V3ResearchFacet | null;
  symbol: string;
  locale: SupportedLocale;
  context: TrustedRequestContext;
  workflowRunId: string;
  tools: readonly ToolExecutionEnvelope<unknown>[];
  signer: DevHmacSigner;
  alias: string;
  comparison: boolean;
}): PublicPresentationItem {
  const resolveTool = findForSymbol(input.tools, "resolve-instrument", input.symbol);
  const resolved = requireResult<ResolvedInstrument>({
    envelope: resolveTool,
    toolId: "resolve-instrument",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  const commonTools = [resolveTool!];

  if (input.route === "company_research" && input.researchFacet === "listing") {
    const value = {
      schemaVersion: "assistant-v3.research-facet.v1" as const,
      facet: "listing" as const,
      symbol: input.symbol,
      displayName: resolved.displayName,
      exchange: resolved.exchange,
      currency: resolved.currency,
      asOf: resolved.resolvedAt,
      source: {
        provider: resolveTool!.source.provider,
        sourceId: resolveTool!.source.sourceId,
        sourceAsOf: resolveTool!.source.sourceAsOf
      }
    };
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: "market.company-research.listing",
      symbol: input.symbol,
      asOf: resolved.resolvedAt,
      value,
      tools: commonTools,
      formulaId: null
    });
    const exchangeLabel = customerExchangeLabel(resolved.exchange);
    const display = input.locale === "az-AZ"
      ? `${resolved.displayName} (${input.symbol}) ${exchangeLabel} birjasında siyahıya alınıb və ${resolved.currency} ilə ticarət olunur. Məlumat ${resolved.resolvedAt} tarixinədir; mənbə: ${resolveTool!.source.provider}.`
      : `${resolved.displayName} (${input.symbol}) is listed on ${exchangeLabel} and trades in ${resolved.currency}. Data as of ${resolved.resolvedAt}; source: ${resolveTool!.source.provider}.`;
    return {
      fact: output,
      display,
      renderableFacts: [
        groundedSlot({
          alias: `${input.alias}_IDENTITY`,
          fact: output,
          display: `${resolved.displayName} (${input.symbol})`,
          meaning: "verified company name and ticker"
        }),
        groundedSlot({
          alias: `${input.alias}_EXCHANGE`,
          fact: output,
          display: exchangeLabel,
          meaning: "verified exchange listing"
        }),
        groundedSlot({
          alias: `${input.alias}_CURRENCY`,
          fact: output,
          display: resolved.currency,
          meaning: "verified trading currency"
        }),
        groundedSlot({
          alias: `${input.alias}_SOURCE`,
          fact: output,
          display: input.locale === "az-AZ"
            ? `Məlumat ${resolved.resolvedAt} tarixinədir; mənbə: ${resolveTool!.source.provider}.`
            : `Data as of ${resolved.resolvedAt}; source: ${resolveTool!.source.provider}.`,
          meaning: "verified observation time and source"
        })
      ],
      fallback: [claim({
        id: `fallback-listing-${input.symbol}`,
        locale: input.locale,
        template: input.locale === "az-AZ"
          ? `{{${input.alias}_IDENTITY}} {{${input.alias}_EXCHANGE}} birjasında siyahıya alınıb və {{${input.alias}_CURRENCY}} ilə ticarət olunur. {{${input.alias}_SOURCE}}`
          : `{{${input.alias}_IDENTITY}} is listed on {{${input.alias}_EXCHANGE}} and trades in {{${input.alias}_CURRENCY}}. {{${input.alias}_SOURCE}}`,
        factRefs: [
          `${input.alias}_IDENTITY`,
          `${input.alias}_EXCHANGE`,
          `${input.alias}_CURRENCY`,
          `${input.alias}_SOURCE`
        ]
      })],
      card: {
        cardId: `card-research-listing-${input.symbol}`,
        kind: "research",
        title: `${input.symbol} · ${resolved.displayName}`,
        factRefs: [output.factId],
        data: value
      },
      chart: null,
      freshness: null,
      partial: false,
      notices: []
    };
  }

  if (input.route === "market_move_explanation") {
    const snapshotTool = findForSymbol(
      input.tools,
      "read-market-snapshot",
      input.symbol
    );
    const snapshot = requireResult<BoundaryMarketSnapshot>({
      envelope: snapshotTool,
      toolId: "read-market-snapshot",
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer
    });
    const historyTool = findForSymbol(
      input.tools,
      "read-price-history",
      input.symbol,
      "1d"
    );
    const history = requireResult<BoundaryPriceHistory>({
      envelope: historyTool,
      toolId: "read-price-history",
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer
    });
    const contentTool = input.tools.find((tool) =>
      tool.toolId === "read-market-content" &&
      tool.status === "success" &&
      Array.isArray(tool.result)
    );
    const content = requireResult<MarketContentItem[]>({
      envelope: contentTool,
      toolId: "read-market-content",
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer
    });
    if (
      snapshot.symbol !== input.symbol ||
      history.symbol !== input.symbol ||
      history.range !== "1d" ||
      history.currency !== snapshot.currency
    ) {
      throw new Error("Market-move evidence scopes do not match.");
    }
    const first = history.points[0];
    const last = history.points.at(-1);
    if (!first || !last || history.points.length < 2) {
      throw new Error("At least two verified intraday history points are required.");
    }
    const firstClose = parseFixedDecimal(first.close);
    const lastClose = parseFixedDecimal(last.close);
    if (firstClose <= 0n) {
      throw new Error("The first verified intraday price is invalid.");
    }
    const intradayReturnRate = formatFixedDecimal(
      divideFixed(subtractFixed(lastClose, firstClose), firstClose)
    );
    const attributableHeadlines = [...content]
      .filter((item) =>
        item.kind === "NEWS" &&
        item.symbols.includes(input.symbol) &&
        item.attributions.length > 0
      )
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, 2)
      .map((item) => ({
        id: item.id,
        title: boundedEvidenceText(item.title, 120) ?? item.title,
        publisher:
          boundedEvidenceText(
            item.attributions[0]?.publisher ??
              item.attributions[0]?.label ??
              null,
            48
          ),
        publishedAt: item.publishedAt,
        url: item.canonicalUrl ?? item.url,
        occurrenceCount: String(item.occurrenceCount)
      }));
    const partial =
      snapshot.previousClose === null ||
      snapshot.change === null ||
      snapshot.changePercent === null ||
      attributableHeadlines.length === 0;
    const value = {
      schemaVersion: "assistant-v3.market-move-explanation.v1" as const,
      symbol: input.symbol,
      displayName: resolved.displayName,
      observedMove: {
        currency: snapshot.currency,
        price: snapshot.price,
        previousClose: snapshot.previousClose,
        change: snapshot.change,
        changePercent: snapshot.changePercent,
        marketState: snapshot.marketState,
        freshness: snapshot.freshness,
        delayMinutes: String(snapshot.delayMinutes),
        asOf: snapshot.asOf
      },
      intradayEvidence: {
        range: history.range,
        interval: history.interval,
        periodStart: first.timestamp,
        periodEnd: last.timestamp,
        firstClose: first.close,
        lastClose: last.close,
        returnRate: intradayReturnRate,
        observationCount: String(history.points.length),
        asOf: history.asOf
      },
      possibleContext: {
        items: attributableHeadlines,
        sourceAsOf: contentTool!.source.sourceAsOf
      },
      causalityEstablished: false as const,
      sources: {
        snapshot: {
          provider: snapshotTool!.source.provider,
          sourceId: snapshotTool!.source.sourceId,
          sourceAsOf: snapshotTool!.source.sourceAsOf
        },
        history: {
          provider: historyTool!.source.provider,
          sourceId: historyTool!.source.sourceId,
          sourceAsOf: historyTool!.source.sourceAsOf
        },
        content: {
          provider: contentTool!.source.provider,
          sourceId: contentTool!.source.sourceId,
          sourceAsOf: contentTool!.source.sourceAsOf
        }
      }
    };
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: "market.move-explanation",
      symbol: input.symbol,
      asOf: snapshot.asOf,
      value,
      tools: [
        ...commonTools,
        snapshotTool!,
        historyTool!,
        contentTool!
      ],
      formulaId: "verified-market-move-context-v1",
      partial
    });
    const slotAlias = (suffix: string) => `${input.alias}_${suffix}`;
    const moveDisplay = input.locale === "az-AZ"
      ? snapshot.change === null || snapshot.changePercent === null
        ? `qiymət ${formatMoneyExact(snapshot.price, snapshot.currency, input.locale)}; əvvəlki bağlanışa qarşı dəyişiklik mövcud deyil`
        : `qiymət ${formatMoneyExact(snapshot.price, snapshot.currency, input.locale)}; əvvəlki bağlanış ${snapshot.previousClose === null ? unavailableField(input.locale) : formatMoneyExact(snapshot.previousClose, snapshot.currency, input.locale)}; dəyişiklik ${formatMoneyExact(snapshot.change, snapshot.currency, input.locale)} (${signedPercentValue(snapshot.changePercent, input.locale)})`
      : snapshot.change === null || snapshot.changePercent === null
        ? `price ${formatMoneyExact(snapshot.price, snapshot.currency, input.locale)}; previous-close change unavailable`
        : `price ${formatMoneyExact(snapshot.price, snapshot.currency, input.locale)}; previous close ${snapshot.previousClose === null ? unavailableField(input.locale) : formatMoneyExact(snapshot.previousClose, snapshot.currency, input.locale)}; change ${formatMoneyExact(snapshot.change, snapshot.currency, input.locale)} (${signedPercentValue(snapshot.changePercent, input.locale)})`;
    const intradayDisplay = input.locale === "az-AZ"
      ? `1 günlük ilk bağlanış ${formatMoneyExact(first.close, history.currency, input.locale)}, son bağlanış ${formatMoneyExact(last.close, history.currency, input.locale)}, dəyişiklik ${formatPercentRateExact(intradayReturnRate, input.locale, true)}`
      : `1-day first close ${formatMoneyExact(first.close, history.currency, input.locale)}, latest close ${formatMoneyExact(last.close, history.currency, input.locale)}, return ${formatPercentRateExact(intradayReturnRate, input.locale, true)}`;
    const contextDisplay = attributableHeadlines.length === 0
      ? input.locale === "az-AZ"
        ? "istinad edilə bilən başlıq tapılmadı"
        : "no attributable headline was returned"
      : attributableHeadlines.map((item) =>
          `“${item.title}”${item.publisher === null ? "" : ` — ${item.publisher}`} (${item.publishedAt})`
        ).join("; ");
    const causalityDisplay = input.locale === "az-AZ"
      ? "səbəb əlaqəsi bu mənbələrlə müəyyən edilməyib; başlıqlar yalnız mümkün kontekstdir"
      : "causality is not established by these sources; the headlines are possible context only";
    const sourceDisplay = input.locale === "az-AZ"
      ? `kotirovka: ${snapshotTool!.source.provider}, ${snapshot.asOf}; tarixçə: ${historyTool!.source.provider}, ${history.asOf}; məzmun: ${contentTool!.source.provider}, ${contentTool!.source.sourceAsOf}`
      : `quote: ${snapshotTool!.source.provider}, as of ${snapshot.asOf}; history: ${historyTool!.source.provider}, as of ${history.asOf}; content: ${contentTool!.source.provider}, as of ${contentTool!.source.sourceAsOf}`;
    const slots = [
      groundedSlot({
        alias: slotAlias("IDENTITY"),
        fact: output,
        display: `${resolved.displayName} (${input.symbol})`,
        meaning: "verified instrument identity"
      }),
      groundedSlot({
        alias: slotAlias("MOVE"),
        fact: output,
        display: moveDisplay,
        meaning: "verified current price and previous-close move",
        semanticRoles: ["market.price", "market.change"]
      }),
      groundedSlot({
        alias: slotAlias("INTRADAY"),
        fact: output,
        display: intradayDisplay,
        meaning: "verified one-day first-to-last close movement",
        semanticRoles: ["market.close", "market.change", "source.time"]
      }),
      groundedSlot({
        alias: slotAlias("CONTEXT"),
        fact: output,
        display: contextDisplay,
        meaning: "latest attributable headlines offered only as possible context",
        semanticRoles: ["market.context"]
      }),
      groundedSlot({
        alias: slotAlias("CAUSALITY"),
        fact: output,
        display: causalityDisplay,
        meaning: "required limitation that the evidence does not establish causality",
        semanticRoles: ["source.limitation"]
      }),
      groundedSlot({
        alias: slotAlias("SOURCE"),
        fact: output,
        display: sourceDisplay,
        meaning: "verified observation times for quote, history, and content",
        semanticRoles: ["source.identity", "source.time", "source.freshness"]
      })
    ];
    return {
      fact: output,
      display: slots.map(({ display }) => display).join(" "),
      renderableFacts: slots,
      fallback: [claim({
        id: `fallback-market-move-${input.symbol}`,
        locale: input.locale,
        template: [
          `{{${slotAlias("IDENTITY")}}}`,
          `{{${slotAlias("MOVE")}}}`,
          `{{${slotAlias("INTRADAY")}}}`,
          `{{${slotAlias("CONTEXT")}}}`,
          `{{${slotAlias("CAUSALITY")}}}`,
          `{{${slotAlias("SOURCE")}}}`
        ].join(" "),
        factRefs: slots.map(({ alias }) => alias)
      })],
      card: {
        cardId: `card-market-move-${input.symbol}`,
        kind: "research",
        title: input.locale === "az-AZ"
          ? `${input.symbol} qiymət hərəkəti`
          : `${input.symbol} price move`,
        factRefs: [output.factId],
        data: value
      },
      chart: chart(history),
      freshness: freshness(snapshot),
      partial,
      notices: [
        snapshot.notice,
        input.locale === "az-AZ"
          ? "Xəbər başlıqları mümkün kontekst kimi göstərilir; bu sübut səbəb əlaqəsini təsdiqləmir."
          : "Headlines are shown as possible context; this evidence does not establish causality."
      ]
    };
  }

  if (input.route === "news_sentiment") {
    const contentTool = findForSymbol(input.tools, "read-market-content", input.symbol);
    const content = requireResult<MarketContentItem[]>({
      envelope: contentTool,
      toolId: "read-market-content",
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer
    });
    const news: SecurityNewsItem[] = content
      .filter((item) => item.kind === "NEWS" && item.url !== null)
      .map((item) => ({
        id: item.id,
        headline: item.title,
        publisher: item.attributions[0]?.publisher ?? null,
        publishedAt: item.publishedAt,
        url: item.url!,
        relatedSymbols: item.symbols,
        source: "yahoo-search"
      }));
    const sentiment = analyzeNewsSentiment(news);
    const value = {
      symbol: input.symbol,
      displayName: resolved.displayName,
      sentiment: {
        methodologyVersion: sentiment.methodologyVersion,
        label: sentiment.label,
        normalizedScore: signedDecimal(sentiment.normalizedScore),
        confidence: sentiment.confidence,
        articleCount: String(sentiment.articleCount),
        counts: {
          positive: String(sentiment.counts.positive),
          neutral: String(sentiment.counts.neutral),
          negative: String(sentiment.counts.negative)
        },
        windowStart: sentiment.windowStart,
        windowEnd: sentiment.windowEnd
      },
      content
    };
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: "market.news-sentiment",
      symbol: input.symbol,
      asOf: content[0]?.publishedAt ?? input.context.requestedAt,
      value,
      tools: [...commonTools, contentTool!],
      formulaId: "deduplicated-headline-lexicon-sentiment-v1",
      partial: content.length === 0
    });
    const display = input.locale === "az-AZ"
      ? `${input.symbol} üzrə başlıq sentimenti ${sentiment.label}; etibar ${sentiment.confidence}; ${sentiment.articleCount} unikal xəbər.`
      : `${input.symbol} headline sentiment is ${sentiment.label}, with ${sentiment.confidence} confidence across ${sentiment.articleCount} unique items.`;
    return {
      fact: output,
      display,
      renderableFacts: [
        groundedSlot({
          alias: `${input.alias}_IDENTITY`,
          fact: output,
          display: input.symbol,
          meaning: "verified instrument ticker"
        }),
        groundedSlot({
          alias: `${input.alias}_SENTIMENT`,
          fact: output,
          display: sentiment.label,
          meaning: "deterministically scored headline sentiment label"
        }),
        groundedSlot({
          alias: `${input.alias}_CONFIDENCE`,
          fact: output,
          display: sentiment.confidence,
          meaning: "sentiment confidence classification"
        }),
        groundedSlot({
          alias: `${input.alias}_SAMPLE`,
          fact: output,
          display: input.locale === "az-AZ"
            ? `${sentiment.articleCount} unikal xəbər`
            : `${sentiment.articleCount} unique items`,
          meaning: "deduplicated headline sample size"
        }),
        groundedSlot({
          alias: `${input.alias}_SOURCE`,
          fact: output,
          display: input.locale === "az-AZ"
            ? `Mənbə: ${contentTool!.source.provider}; məlumat ${contentTool!.source.sourceAsOf} tarixinədir.`
            : `Source: ${contentTool!.source.provider}; data as of ${contentTool!.source.sourceAsOf}.`,
          meaning: "verified source and observation time"
        })
      ],
      fallback: [claim({
        id: `fallback-news-${input.symbol}`,
        locale: input.locale,
        template: input.locale === "az-AZ"
          ? `{{${input.alias}_IDENTITY}} üzrə başlıq sentimenti {{${input.alias}_SENTIMENT}}; etibar {{${input.alias}_CONFIDENCE}}; {{${input.alias}_SAMPLE}}. {{${input.alias}_SOURCE}}`
          : `{{${input.alias}_IDENTITY}} headline sentiment is {{${input.alias}_SENTIMENT}}, with {{${input.alias}_CONFIDENCE}} confidence across {{${input.alias}_SAMPLE}}. {{${input.alias}_SOURCE}}`,
        factRefs: [
          `${input.alias}_IDENTITY`,
          `${input.alias}_SENTIMENT`,
          `${input.alias}_CONFIDENCE`,
          `${input.alias}_SAMPLE`,
          `${input.alias}_SOURCE`
        ]
      })],
      card: {
        cardId: `card-news-${input.symbol}`,
        kind: "research",
        title: `${input.symbol} news & sentiment`,
        factRefs: [output.factId],
        data: value
      },
      chart: null,
      freshness: null,
      partial: content.length === 0,
      notices: sentiment.notices
    };
  }

  if (input.route === "market_event") {
    const contentTool = findForSymbol(input.tools, "read-market-content", input.symbol);
    const content = requireResult<MarketContentItem[]>({
      envelope: contentTool,
      toolId: "read-market-content",
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer
    });
    const event = content
      .filter((item) => item.kind === "MARKET_EVENT")
      .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt))[0];
    if (!event) throw new Error("No verified upcoming market event is available.");
    const displayTimeZone = "Asia/Baku";
    const scheduled = new Intl.DateTimeFormat(input.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: displayTimeZone
    }).format(new Date(event.publishedAt));
    const value = {
      schemaVersion: "assistant-v3.market-event.v1" as const,
      symbol: input.symbol,
      displayName: resolved.displayName,
      eventId: event.id,
      title: event.title,
      scheduledAt: event.publishedAt,
      displayTime: scheduled,
      displayTimeZone,
      sourceUrl: event.canonicalUrl ?? event.url,
      source: {
        provider: contentTool!.source.provider,
        sourceId: contentTool!.source.sourceId,
        sourceAsOf: contentTool!.source.sourceAsOf
      }
    };
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: "market.event",
      symbol: input.symbol,
      asOf: contentTool!.source.sourceAsOf,
      value,
      tools: [...commonTools, contentTool!],
      formulaId: null
    });
    return {
      fact: output,
      display: input.locale === "az-AZ"
        ? `${input.symbol} üçün növbəti təsdiqlənmiş hadisə “${event.title}” — ${scheduled}.`
        : `The next verified event for ${input.symbol} is “${event.title}” on ${scheduled}.`,
      renderableFacts: [
        groundedSlot({
          alias: `${input.alias}_IDENTITY`,
          fact: output,
          display: `${resolved.displayName} (${input.symbol})`,
          meaning: "verified instrument identity"
        }),
        groundedSlot({
          alias: `${input.alias}_EVENT`,
          fact: output,
          display: event.title,
          meaning: "verified market-event title"
        }),
        groundedSlot({
          alias: `${input.alias}_TIME`,
          fact: output,
          display: scheduled,
          meaning: "localized verified market-event time"
        }),
        groundedSlot({
          alias: `${input.alias}_SOURCE`,
          fact: output,
          display: input.locale === "az-AZ"
            ? `Mənbə: ${contentTool!.source.provider}; məlumat ${contentTool!.source.sourceAsOf} tarixinədir.`
            : `Source: ${contentTool!.source.provider}; data as of ${contentTool!.source.sourceAsOf}.`,
          meaning: "verified event source and observation time"
        })
      ],
      fallback: [claim({
        id: `fallback-event-${input.symbol}`,
        locale: input.locale,
        template: input.locale === "az-AZ"
          ? `{{${input.alias}_IDENTITY}} üçün növbəti təsdiqlənmiş hadisə {{${input.alias}_EVENT}} — {{${input.alias}_TIME}}. {{${input.alias}_SOURCE}}`
          : `The next verified event for {{${input.alias}_IDENTITY}} is {{${input.alias}_EVENT}} on {{${input.alias}_TIME}}. {{${input.alias}_SOURCE}}`,
        factRefs: [
          `${input.alias}_IDENTITY`,
          `${input.alias}_EVENT`,
          `${input.alias}_TIME`,
          `${input.alias}_SOURCE`
        ]
      })],
      card: {
        cardId: `card-event-${input.symbol}`,
        kind: "research",
        title: input.locale === "az-AZ"
          ? `${input.symbol} bazar hadisəsi`
          : `${input.symbol} market event`,
        factRefs: [output.factId],
        data: value
      },
      chart: null,
      freshness: {
        sourceId: contentTool!.source.sourceId,
        asOf: contentTool!.source.sourceAsOf,
        status: "indicative",
        delayMinutes: null
      },
      partial: false,
      notices: [
        input.locale === "az-AZ"
          ? "Hadisə vaxtı provayder tərəfindən dəyişdirilə bilər."
          : "The provider may revise the scheduled event time."
      ]
    };
  }

  if (input.route === "market_history") {
    const historyTool = findForSymbol(input.tools, "read-price-history", input.symbol);
    const history = requireResult<BoundaryPriceHistory>({
      envelope: historyTool,
      toolId: "read-price-history",
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer
    });
    const first = history.points[0];
    const last = history.points.at(-1);
    if (!first || !last || history.points.length < 2) {
      throw new Error("At least two verified history points are required.");
    }
    const firstClose = parseFixedDecimal(first.close);
    const lastClose = parseFixedDecimal(last.close);
    if (firstClose <= 0n) throw new Error("The first verified history price is invalid.");
    const returnRate = formatFixedDecimal(
      divideFixed(subtractFixed(lastClose, firstClose), firstClose)
    );
    const value = {
      schemaVersion: "assistant-v3.market-history.v1" as const,
      symbol: input.symbol,
      displayName: resolved.displayName,
      range: history.range,
      interval: history.interval,
      currency: history.currency,
      periodStart: first.timestamp,
      periodEnd: last.timestamp,
      firstClose: first.close,
      lastClose: last.close,
      returnRate,
      observationCount: String(history.points.length),
      asOf: history.asOf,
      source: {
        provider: historyTool!.source.provider,
        sourceId: historyTool!.source.sourceId,
        sourceAsOf: historyTool!.source.sourceAsOf
      }
    };
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: "market.price-history",
      symbol: input.symbol,
      asOf: history.asOf,
      value,
      tools: [...commonTools, historyTool!],
      formulaId: "verified-period-close-return-v1"
    });
    const period = `${first.timestamp.slice(0, 10)} – ${last.timestamp.slice(0, 10)}`;
    return {
      fact: output,
      display: input.locale === "az-AZ"
        ? `${input.symbol} üçün ${history.range} dövründə bağlanış ${formatMoneyExact(first.close, history.currency, input.locale)}-dan ${formatMoneyExact(last.close, history.currency, input.locale)}-a dəyişib; gəlir ${formatPercentRateExact(returnRate, input.locale, true)}.`
        : `Over ${history.range}, ${input.symbol} moved from a ${formatMoneyExact(first.close, history.currency, input.locale)} close to ${formatMoneyExact(last.close, history.currency, input.locale)}, a ${formatPercentRateExact(returnRate, input.locale, true)} return.`,
      renderableFacts: [
        groundedSlot({
          alias: `${input.alias}_IDENTITY`,
          fact: output,
          display: `${resolved.displayName} (${input.symbol})`,
          meaning: "verified instrument identity",
          semanticRoles: ["instrument.identity"]
        }),
        groundedSlot({
          alias: `${input.alias}_RANGE`,
          fact: output,
          display: `${history.range} (${period})`,
          meaning: "requested and verified history range",
          semanticRoles: ["source.time"]
        }),
        groundedSlot({
          alias: `${input.alias}_START`,
          fact: output,
          display: formatMoneyExact(first.close, history.currency, input.locale),
          meaning: "first verified closing price in the requested range",
          semanticRoles: ["market.close"]
        }),
        groundedSlot({
          alias: `${input.alias}_END`,
          fact: output,
          display: formatMoneyExact(last.close, history.currency, input.locale),
          meaning: "last verified closing price in the requested range",
          semanticRoles: ["market.close"]
        }),
        groundedSlot({
          alias: `${input.alias}_RETURN`,
          fact: output,
          display: formatPercentRateExact(returnRate, input.locale, true),
          meaning: "deterministically calculated close-to-close return",
          semanticRoles: ["market.change"]
        }),
        groundedSlot({
          alias: `${input.alias}_SOURCE`,
          fact: output,
          display: input.locale === "az-AZ"
            ? `Məlumat ${history.asOf} tarixinədir; mənbə: ${historyTool!.source.provider}.`
            : `Data as of ${history.asOf}; source: ${historyTool!.source.provider}.`,
          meaning: "verified history source and observation time",
          semanticRoles: ["source.identity", "source.time"]
        })
      ],
      fallback: [claim({
        id: `fallback-history-${input.symbol}-${history.range}`,
        locale: input.locale,
        template: input.locale === "az-AZ"
          ? `{{${input.alias}_IDENTITY}} üçün {{${input.alias}_RANGE}} dövründə ilk bağlanış {{${input.alias}_START}}, son bağlanış {{${input.alias}_END}}, dövr üzrə gəlir isə {{${input.alias}_RETURN}} olub. {{${input.alias}_SOURCE}}`
          : `For {{${input.alias}_IDENTITY}} over {{${input.alias}_RANGE}}, the first closing price was {{${input.alias}_START}}, the last closing price was {{${input.alias}_END}}, and the close-to-close return was {{${input.alias}_RETURN}}. {{${input.alias}_SOURCE}}`,
        factRefs: [
          `${input.alias}_IDENTITY`,
          `${input.alias}_RANGE`,
          `${input.alias}_START`,
          `${input.alias}_END`,
          `${input.alias}_RETURN`,
          `${input.alias}_SOURCE`
        ]
      })],
      card: {
        cardId: `card-history-${input.symbol}-${history.range}`,
        kind: "market",
        title: input.locale === "az-AZ"
          ? `${input.symbol} qiymət tarixçəsi`
          : `${input.symbol} price history`,
        factRefs: [output.factId],
        data: value
      },
      chart: chart(history),
      freshness: {
        sourceId: historyTool!.source.sourceId,
        asOf: history.asOf,
        status: "indicative",
        delayMinutes: null
      },
      partial: false,
      notices: [
        input.locale === "az-AZ"
          ? "Gəlir ilk və son mövcud bağlanış qiymətləri əsasında hesablanıb."
          : "Return is calculated from the first and last available closing prices."
      ]
    };
  }

  const oneYearTool = findForSymbol(input.tools, "read-price-history", input.symbol, "1y");
  const tenYearTool = findForSymbol(input.tools, "read-price-history", input.symbol, "10y");
  const selectedHistoryTool = tenYearTool ?? oneYearTool;
  const selectedHistory = selectedHistoryTool
    ? requireResult<BoundaryPriceHistory>({
        envelope: selectedHistoryTool,
        toolId: "read-price-history",
        context: input.context,
        workflowRunId: input.workflowRunId,
        signer: input.signer
      })
    : null;

  if (input.route === "technical_analysis") {
    const history = requireResult<BoundaryPriceHistory>({
      envelope: oneYearTool,
      toolId: "read-price-history",
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer
    });
    const indicators = calculateTechnicalIndicators(asLegacyHistory(history));
    const normalized = {
      symbol: indicators.symbol,
      currency: indicators.currency,
      asOf: indicators.asOf,
      observations: String(indicators.observations),
      latestClose: signedDecimal(indicators.latestClose),
      periodHigh: signedDecimal(indicators.periodHigh),
      periodLow: signedDecimal(indicators.periodLow),
      indicators: indicators.indicators.map((item) => ({
        ...item,
        value: item.value === null ? null : signedDecimal(item.value)
      })),
      methodologyVersion: indicators.methodologyVersion,
      notices: indicators.notices
    };
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: "market.technical-indicators",
      symbol: input.symbol,
      asOf: history.asOf,
      value: normalized,
      tools: [...commonTools, oneYearTool!, ...(tenYearTool ? [tenYearTool] : [])],
      formulaId: "technical-indicators-v1"
    });
    const rsi = normalized.indicators.find(({ id }) => id === "rsi14")?.value;
    const volatility = normalized.indicators.find(({ id }) => id === "annualizedVolatility")?.value;
    const display = input.locale === "az-AZ"
      ? `${input.symbol}: son bağlanış ${formatMoneyExact(normalized.latestClose, normalized.currency, input.locale)}, RSI ${rsi ? formatDecimalExact(rsi, input.locale, 2) : "mövcud deyil"}, illik volatillik ${volatility ? `${formatDecimalExact(volatility, input.locale, 2)}%` : "mövcud deyil"}.`
      : `${input.symbol}: latest close ${formatMoneyExact(normalized.latestClose, normalized.currency, input.locale)}, RSI ${rsi ? formatDecimalExact(rsi, input.locale, 2) : "unavailable"}, annualized volatility ${volatility ? `${formatDecimalExact(volatility, input.locale, 2)}%` : "unavailable"}.`;
    return {
      fact: output,
      display,
      renderableFacts: [
        groundedSlot({
          alias: `${input.alias}_IDENTITY`,
          fact: output,
          display: input.symbol,
          meaning: "verified instrument ticker"
        }),
        groundedSlot({
          alias: `${input.alias}_LATEST_CLOSE`,
          fact: output,
          display: formatMoneyExact(
            normalized.latestClose,
            normalized.currency,
            input.locale
          ),
          meaning: "latest verified closing price"
        }),
        groundedSlot({
          alias: `${input.alias}_RSI`,
          fact: output,
          display: rsi ? formatDecimalExact(rsi, input.locale, 2) : unavailableField(input.locale),
          meaning: "deterministically calculated RSI indicator"
        }),
        groundedSlot({
          alias: `${input.alias}_VOLATILITY`,
          fact: output,
          display: volatility
            ? `${formatDecimalExact(volatility, input.locale, 2)}%`
            : unavailableField(input.locale),
          meaning: "deterministically calculated annualized historical volatility"
        }),
        groundedSlot({
          alias: `${input.alias}_SOURCE`,
          fact: output,
          display: input.locale === "az-AZ"
            ? `Məlumat ${history.asOf} tarixinədir; mənbə: ${oneYearTool!.source.provider}.`
            : `Data as of ${history.asOf}; source: ${oneYearTool!.source.provider}.`,
          meaning: "verified history time and source"
        })
      ],
      fallback: [claim({
        id: `fallback-technical-${input.symbol}`,
        locale: input.locale,
        template: input.locale === "az-AZ"
          ? `{{${input.alias}_IDENTITY}} üçün son bağlanış {{${input.alias}_LATEST_CLOSE}}, RSI {{${input.alias}_RSI}}, illik volatillik {{${input.alias}_VOLATILITY}}. {{${input.alias}_SOURCE}}`
          : `For {{${input.alias}_IDENTITY}}, the latest close is {{${input.alias}_LATEST_CLOSE}}, RSI is {{${input.alias}_RSI}}, and annualized volatility is {{${input.alias}_VOLATILITY}}. {{${input.alias}_SOURCE}}`,
        factRefs: [
          `${input.alias}_IDENTITY`,
          `${input.alias}_LATEST_CLOSE`,
          `${input.alias}_RSI`,
          `${input.alias}_VOLATILITY`,
          `${input.alias}_SOURCE`
        ]
      })],
      card: {
        cardId: `card-technical-${input.symbol}`,
        kind: "research",
        title: `${input.symbol} technical indicators`,
        factRefs: [output.factId],
        data: normalized
      },
      chart: selectedHistory ? chart(selectedHistory) : null,
      freshness: null,
      partial: false,
      notices: indicators.notices
    };
  }

  const snapshotTool = findForSymbol(input.tools, "read-market-snapshot", input.symbol);
  const conversionTool = findForSymbol(input.tools, "convert-currency", input.symbol);
  const conversion = conversionTool
    ? requireResult<CurrencyConversionResult>({
        envelope: conversionTool,
        toolId: "convert-currency",
        context: input.context,
        workflowRunId: input.workflowRunId,
        signer: input.signer
      })
    : null;
  if (
    conversion !== null &&
    (
      conversion.scope !== "current-market-price" ||
      conversion.symbol !== input.symbol ||
      conversion.targetCurrency !== "AZN" ||
      conversionTool === undefined ||
      conversionTool.argumentsHash !== canonicalHash({
        scope: "current-market-price",
        symbol: input.symbol,
        targetCurrency: "AZN"
      }) ||
      conversion.marketSnapshot === null ||
      conversion.marketSource === null ||
      conversion.marketAsOf.length !== 1 ||
      conversion.marketAsOf[0]?.symbol !== input.symbol ||
      conversion.marketSnapshot.symbol !== input.symbol ||
      conversion.marketSnapshot.displayName !== conversion.displayName ||
      conversion.marketSnapshot.currency !== conversion.sourceCurrency ||
      conversion.marketSnapshot.price !== conversion.sourceAmount ||
      conversion.marketSnapshot.asOf !== conversion.marketAsOf[0]?.asOf ||
      conversion.marketSource.sourceAsOf !== conversion.marketSnapshot.asOf ||
      parseFixedDecimal(conversion.exchangeRate) <= 0n ||
      conversion.convertedAmount !== formatFixedDecimal(
        multiplyFixed(
          parseFixedDecimal(conversion.sourceAmount),
          parseFixedDecimal(conversion.exchangeRate)
        )
      )
    )
  ) {
    throw new Error("Converted market quote did not match its signed source evidence.");
  }
  const snapshot = snapshotTool
    ? requireResult<BoundaryMarketSnapshot>({
        envelope: snapshotTool,
        toolId: "read-market-snapshot",
        context: input.context,
        workflowRunId: input.workflowRunId,
        signer: input.signer
      })
    : conversion?.marketSnapshot ?? null;

  if (input.route === "market_quote") {
    const quoteTool = conversionTool ?? snapshotTool;
    const quoteSource = conversion?.marketSource ?? snapshotTool?.source;
    if (
      !snapshot ||
      !quoteTool ||
      !quoteSource ||
      !selectedHistory ||
      !selectedHistoryTool
    ) {
      throw new Error("A quote and long-term history are required.");
    }
    const requestedPrice = conversion === null
      ? {
          amount: snapshot.price,
          currency: snapshot.currency,
          converted: false as const
        }
      : {
          amount: conversion.convertedAmount,
          currency: conversion.targetCurrency,
          converted: true as const,
          sourceAmount: conversion.sourceAmount,
          sourceCurrency: conversion.sourceCurrency,
          exchangeRate: conversion.exchangeRate,
          rateEffectiveDate: conversion.rateEffectiveDate,
          rateAsOf: conversion.rateAsOf
        };
    const priceDisplay = formatMoneyExact(
      requestedPrice.amount,
      requestedPrice.currency,
      input.locale
    );
    const priceEvidenceDisplay = conversion === null
      ? priceDisplay
      : input.locale === "az-AZ"
        ? `${formatMoneyExact(
            conversion.sourceAmount,
            conversion.sourceCurrency,
            input.locale
          )} kotirovkasının 1 ${conversion.sourceCurrency} = ${formatDecimalExact(
            conversion.exchangeRate,
            input.locale,
            8
          )} ${conversion.targetCurrency} məzənnəsi ilə ${priceDisplay} ekvivalenti`
        : `${priceDisplay} equivalent of ${formatMoneyExact(
            conversion.sourceAmount,
            conversion.sourceCurrency,
            input.locale
          )} at 1 ${conversion.sourceCurrency} = ${formatDecimalExact(
            conversion.exchangeRate,
            input.locale,
            8
          )} ${conversion.targetCurrency}`;
    const value = {
      ...snapshot,
      priceHistory: selectedHistory,
      requestedPrice
    };
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: "market.quote",
      symbol: input.symbol,
      asOf: snapshot.asOf,
      value,
      tools: [...commonTools, quoteTool, selectedHistoryTool],
      formulaId: null
    });
    const conversionContext = conversion === null
      ? ""
      : input.locale === "az-AZ"
        ? ` İlkin kotirovka ${formatMoneyExact(conversion.sourceAmount, conversion.sourceCurrency, input.locale)}, rəsmi məzənnə 1 ${conversion.sourceCurrency} = ${formatDecimalExact(conversion.exchangeRate, input.locale, 8)} ${conversion.targetCurrency}, ${conversion.rateEffectiveDate} tarixindən qüvvədədir.`
        : ` The source quote is ${formatMoneyExact(conversion.sourceAmount, conversion.sourceCurrency, input.locale)}, using the official rate 1 ${conversion.sourceCurrency} = ${formatDecimalExact(conversion.exchangeRate, input.locale, 8)} ${conversion.targetCurrency}, effective ${conversion.rateEffectiveDate}.`;
    const display = `${snapshot.displayName} (${snapshot.symbol}) ${priceEvidenceDisplay}, ${signedPercentValue(snapshot.changePercent, input.locale)} ${input.locale === "az-AZ" ? "əvvəlki bağlanışa qarşı" : "versus the previous close"}; ${snapshot.marketState.toLowerCase()}, ${snapshot.freshness}, ${snapshot.asOf}.${conversionContext}`;
    const sourceDisplay = input.locale === "az-AZ"
      ? conversion === null
        ? `${snapshot.asOf} tarixinə; mənbə: ${quoteSource.provider}.`
        : `${snapshot.asOf} tarixinə bazar mənbəyi: ${quoteSource.provider}; məzənnə ${conversion.rateEffectiveDate} tarixindən qüvvədədir, mənbə: ${conversionTool!.source.provider}.`
      : conversion === null
        ? `As of ${snapshot.asOf}; source: ${quoteSource.provider}.`
        : `Market data as of ${snapshot.asOf} from ${quoteSource.provider}; rate effective ${conversion.rateEffectiveDate}, source: ${conversionTool!.source.provider}.`;
    return {
      fact: output,
      display,
      renderableFacts: [
        groundedSlot({
          alias: `${input.alias}_IDENTITY`,
          fact: output,
          display: `${snapshot.displayName} (${snapshot.symbol})`,
          meaning: "verified instrument name and ticker"
        }),
        groundedSlot({
          alias: `${input.alias}_PRICE`,
          fact: output,
          display: priceEvidenceDisplay,
          meaning: conversion === null
            ? "latest verified market price"
            : "latest verified market-price equivalent in the requested currency"
        }),
        groundedSlot({
          alias: `${input.alias}_CHANGE`,
          fact: output,
          display: signedPercentValue(snapshot.changePercent, input.locale),
          meaning: "verified change versus the previous close"
        }),
        groundedSlot({
          alias: `${input.alias}_MARKET_CONTEXT`,
          fact: output,
          display: input.locale === "az-AZ"
            ? `bazar ${snapshot.marketState.toLowerCase()}, məlumat ${snapshot.freshness}`
            : `market ${snapshot.marketState.toLowerCase()}, ${snapshot.freshness} data`,
          meaning: "market state and freshness classification",
          required: false
        }),
        groundedSlot({
          alias: `${input.alias}_SOURCE`,
          fact: output,
          display: sourceDisplay,
          meaning: conversion === null
            ? "verified quote timestamp and source"
            : "verified quote and official exchange-rate timestamps and sources"
        })
      ],
      fallback: [claim({
        id: `fallback-quote-${input.symbol}`,
        locale: input.locale,
        template: input.locale === "az-AZ"
          ? conversion === null
            ? `{{${input.alias}_IDENTITY}} üçün cari qiymət {{${input.alias}_PRICE}}-dır; əvvəlki bağlanışa qarşı dəyişiklik {{${input.alias}_CHANGE}}. {{${input.alias}_MARKET_CONTEXT}}; {{${input.alias}_SOURCE}}`
            : `{{${input.alias}_IDENTITY}} üçün son yoxlanmış qiymət {{${input.alias}_PRICE}}-dir; əvvəlki bağlanışa qarşı dəyişiklik {{${input.alias}_CHANGE}}. {{${input.alias}_MARKET_CONTEXT}}; {{${input.alias}_SOURCE}}`
          : conversion === null
            ? `{{${input.alias}_IDENTITY}} is currently {{${input.alias}_PRICE}}, a {{${input.alias}_CHANGE}} move from the previous close. {{${input.alias}_MARKET_CONTEXT}}; {{${input.alias}_SOURCE}}`
            : `{{${input.alias}_IDENTITY}}'s latest verified quote is {{${input.alias}_PRICE}}, with a {{${input.alias}_CHANGE}} move from the previous close. {{${input.alias}_MARKET_CONTEXT}}; {{${input.alias}_SOURCE}}`,
        factRefs: [
          `${input.alias}_IDENTITY`,
          `${input.alias}_PRICE`,
          `${input.alias}_CHANGE`,
          `${input.alias}_MARKET_CONTEXT`,
          `${input.alias}_SOURCE`
        ]
      })],
      card: {
        cardId: `card-market-${input.symbol}`,
        kind: "market",
        title: `${snapshot.symbol} · ${snapshot.displayName}`,
        factRefs: [output.factId],
        data: value
      },
      chart: chart(selectedHistory),
      freshness: freshness(snapshot),
      partial: false,
      notices: [
        snapshot.notice,
        ...(conversion === null
          ? []
          : [
              input.locale === "az-AZ"
                ? `Qiymət ${conversion.targetCurrency} ekvivalentidir; qrafik ${selectedHistory.currency} ilə qalır.`
                : `The price is shown as a ${conversion.targetCurrency} equivalent; the chart remains in ${selectedHistory.currency}.`
            ])
      ]
    };
  }

  const researchTool = findForSymbol(input.tools, "read-instrument-research", input.symbol);
  const research = requireResult<InstrumentFacts>({
    envelope: researchTool,
    toolId: "read-instrument-research",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  const facet = input.researchFacet ?? "general";
  const isNarrowCompanyFacet = input.route === "company_research" &&
    facet !== "general" &&
    facet !== "risk_comparison";
  const isRiskComparisonFacet = input.route === "security_risk" &&
    facet === "risk_comparison";
  if (isNarrowCompanyFacet || isRiskComparisonFacet) {
    const source = {
      provider: research.provider.displayName,
      sourceId: researchTool!.source.sourceId,
      sourceAsOf: researchTool!.source.sourceAsOf
    };
    let data: Record<string, unknown>;
    let display: string;
    let partial = false;

    if (facet === "market_cap") {
      const marketCapitalization = availableMetric(
        research.valuation.marketCapitalization
      );
      data = { marketCapitalization: research.valuation.marketCapitalization };
      partial = marketCapitalization === null;
      display = input.locale === "az-AZ"
        ? marketCapitalization === null
          ? `${input.symbol} şirkətinin bazar kapitallaşması mövcud deyil.`
          : `${input.symbol} şirkətinin bazar kapitallaşması təxminən ${compactMarketCapitalization(marketCapitalization, input.locale)}-dir.`
        : marketCapitalization === null
          ? `${input.symbol}’s market cap is unavailable.`
          : `${input.symbol}’s market cap is about ${compactMarketCapitalization(marketCapitalization, input.locale)}.`;
    } else if (facet === "pe") {
      data = {
        trailingTtmPe: research.valuation.trailingPe,
        forwardPe: research.valuation.forwardPe
      };
      partial = research.valuation.trailingPe.status !== "AVAILABLE" ||
        research.valuation.forwardPe.status !== "AVAILABLE";
      display = input.locale === "az-AZ"
        ? `${input.symbol} üçün TTM P/E ${metricValue(research.valuation.trailingPe, input.locale)}, proqnoz P/E isə ${metricValue(research.valuation.forwardPe, input.locale)}.`
        : `${input.symbol}’s trailing (TTM) P/E is ${metricValue(research.valuation.trailingPe, input.locale)}; its forward P/E is ${metricValue(research.valuation.forwardPe, input.locale)}.`;
    } else if (facet === "dividend") {
      data = {
        dividendYield: research.dividendYield,
        lastDividend: research.lastDividend
      };
      partial = research.dividendYield.status !== "AVAILABLE" ||
        research.lastDividend.status !== "AVAILABLE";
      display = input.locale === "az-AZ"
        ? `${input.symbol} üzrə dividend gəlirliliyi ${metricValue(research.dividendYield, input.locale)}; son bildirilmiş dividend ${lastDividendValue(research.lastDividend, input.locale)} olub.`
        : `${input.symbol}’s dividend yield is ${metricValue(research.dividendYield, input.locale)}; its last reported dividend was ${lastDividendValue(research.lastDividend, input.locale)}.`;
    } else if (facet === "price_range") {
      const periodHigh = research.instrumentSpecificRisks.periodHigh;
      const periodLow = research.instrumentSpecificRisks.periodLow;
      data = { periodHigh, periodLow, priceBasis: "closing-prices-not-intraday" };
      partial = periodHigh.status !== "AVAILABLE" || periodLow.status !== "AVAILABLE";
      display = input.locale === "az-AZ"
        ? `Son bir ildə ${input.symbol} üçün ən yüksək bağlanış ${metricValue(periodHigh, input.locale)}, ən aşağı bağlanış isə ${metricValue(periodLow, input.locale)} olub. Bunlar gün ərzindəki maksimum və minimum deyil.`
        : `Over one year, ${input.symbol}’s highest close was ${metricValue(periodHigh, input.locale)} and its lowest close was ${metricValue(periodLow, input.locale)}. These are closing-price levels, not intraday highs and lows.`;
    } else if (facet === "analyst_consensus") {
      data = { analystConsensus: research.analystConsensus };
      partial = research.analystConsensus.status !== "AVAILABLE";
      display = input.locale === "az-AZ"
        ? `${input.symbol} üzrə analitik konsensusu ${analystValue(research.analystConsensus, input.locale)}.`
        : `${input.symbol}’s analyst consensus is ${analystValue(research.analystConsensus, input.locale)}.`;
    } else {
      const risks = {
        annualizedVolatility: research.instrumentSpecificRisks.annualizedVolatility,
        downsideVolatility: research.instrumentSpecificRisks.downsideVolatility,
        maximumDrawdown: research.instrumentSpecificRisks.maximumDrawdown
      };
      data = risks;
      partial = Object.values(risks).some(({ status }) => status !== "AVAILABLE");
      display = input.locale === "az-AZ"
        ? input.alias === "F1"
          ? `${input.symbol} üzrə tarixi illik volatillik ${metricValue(risks.annualizedVolatility, input.locale)}, maksimum eniş isə ${metricValue(risks.maximumDrawdown, input.locale)} olub.`
          : `${input.symbol} üzrə həmin göstəricilər müvafiq olaraq ${metricValue(risks.annualizedVolatility, input.locale)} və ${metricValue(risks.maximumDrawdown, input.locale)} olub.`
        : input.alias === "F1"
          ? `${input.symbol}’s historical annualized volatility was ${metricValue(risks.annualizedVolatility, input.locale)}, with a maximum drawdown of ${metricValue(risks.maximumDrawdown, input.locale)}.`
          : `For ${input.symbol}, those measures were ${metricValue(risks.annualizedVolatility, input.locale)} and ${metricValue(risks.maximumDrawdown, input.locale)}, respectively.`;
    }

    const value = {
      schemaVersion: "assistant-v3.research-facet.v1" as const,
      facet,
      symbol: input.symbol,
      displayName: resolved.displayName,
      instrumentType: research.instrumentType,
      exchange: research.exchange,
      currency: research.currency,
      generatedAt: research.generatedAt,
      source,
      data
    };
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: facet === "risk_comparison"
        ? "market.security-risk"
        : `market.company-research.${facet}`,
      symbol: input.symbol,
      asOf: research.generatedAt,
      value,
      tools: [...commonTools, researchTool!],
      formulaId: facet === "risk_comparison" ? "historical-price-risk-v1" : null,
      partial
    });
    const slotAlias = (suffix: string) => `${input.alias}_${suffix}`;
    const identity = groundedSlot({
      alias: slotAlias("IDENTITY"),
      fact: output,
      display: `${resolved.displayName} (${input.symbol})`,
      meaning: "verified instrument name and ticker"
    });
    const sourceSlot = groundedSlot({
      alias: slotAlias("SOURCE"),
      fact: output,
      display: researchSourceSuffix({
        researchTool: researchTool!,
        research,
        locale: input.locale
      }).trim(),
      meaning: "verified research time and source"
    });
    let facetSlots: RenderableFact[];
    let fallbackTemplate: string;

    if (facet === "market_cap") {
      const marketCapitalization = availableMetric(
        research.valuation.marketCapitalization
      );
      facetSlots = [identity, groundedSlot({
        alias: slotAlias("MARKET_CAP"),
        fact: output,
        display: marketCapitalization === null
          ? unavailableField(input.locale)
          : compactMarketCapitalization(marketCapitalization, input.locale),
        meaning: "verified market capitalization or explicit unavailability"
      }), sourceSlot];
      fallbackTemplate = input.locale === "az-AZ"
        ? marketCapitalization === null
          ? `{{${slotAlias("IDENTITY")}}} şirkətinin bazar kapitallaşması {{${slotAlias("MARKET_CAP")}}}. {{${slotAlias("SOURCE")}}}`
          : `{{${slotAlias("IDENTITY")}}} şirkətinin bazar kapitallaşması təxminən {{${slotAlias("MARKET_CAP")}}}-dir. {{${slotAlias("SOURCE")}}}`
        : marketCapitalization === null
          ? `{{${slotAlias("IDENTITY")}}}'s market cap is {{${slotAlias("MARKET_CAP")}}}. {{${slotAlias("SOURCE")}}}`
          : `{{${slotAlias("IDENTITY")}}}'s market cap is about {{${slotAlias("MARKET_CAP")}}}. {{${slotAlias("SOURCE")}}}`;
    } else if (facet === "pe") {
      facetSlots = [
        identity,
        groundedSlot({
          alias: slotAlias("TRAILING_PE"),
          fact: output,
          display: metricValue(research.valuation.trailingPe, input.locale),
          meaning: "verified trailing TTM price-to-earnings ratio"
        }),
        groundedSlot({
          alias: slotAlias("FORWARD_PE"),
          fact: output,
          display: metricValue(research.valuation.forwardPe, input.locale),
          meaning: "verified forward price-to-earnings ratio"
        }),
        sourceSlot
      ];
      fallbackTemplate = input.locale === "az-AZ"
        ? `{{${slotAlias("IDENTITY")}}} üçün TTM P/E {{${slotAlias("TRAILING_PE")}}}, proqnoz P/E isə {{${slotAlias("FORWARD_PE")}}}. {{${slotAlias("SOURCE")}}}`
        : `{{${slotAlias("IDENTITY")}}}'s trailing TTM P/E is {{${slotAlias("TRAILING_PE")}}}, while forward P/E is {{${slotAlias("FORWARD_PE")}}}. {{${slotAlias("SOURCE")}}}`;
    } else if (facet === "dividend") {
      facetSlots = [
        identity,
        groundedSlot({
          alias: slotAlias("DIVIDEND_YIELD"),
          fact: output,
          display: metricValue(research.dividendYield, input.locale),
          meaning: "verified dividend yield"
        }),
        groundedSlot({
          alias: slotAlias("LAST_DIVIDEND"),
          fact: output,
          display: lastDividendValue(research.lastDividend, input.locale),
          meaning: "last provider-reported dividend amount and date"
        }),
        sourceSlot
      ];
      fallbackTemplate = input.locale === "az-AZ"
        ? `{{${slotAlias("IDENTITY")}}} üzrə dividend gəlirliliyi {{${slotAlias("DIVIDEND_YIELD")}}}; son bildirilmiş dividend {{${slotAlias("LAST_DIVIDEND")}}} olub. {{${slotAlias("SOURCE")}}}`
        : `{{${slotAlias("IDENTITY")}}}'s dividend yield is {{${slotAlias("DIVIDEND_YIELD")}}}; its last reported dividend was {{${slotAlias("LAST_DIVIDEND")}}}. {{${slotAlias("SOURCE")}}}`;
    } else if (facet === "price_range") {
      facetSlots = [
        identity,
        groundedSlot({
          alias: slotAlias("PERIOD_HIGH"),
          fact: output,
          display: metricValue(
            research.instrumentSpecificRisks.periodHigh,
            input.locale
          ),
          meaning: "verified highest closing price over one year"
        }),
        groundedSlot({
          alias: slotAlias("PERIOD_LOW"),
          fact: output,
          display: metricValue(
            research.instrumentSpecificRisks.periodLow,
            input.locale
          ),
          meaning: "verified lowest closing price over one year"
        }),
        groundedSlot({
          alias: slotAlias("PRICE_BASIS"),
          fact: output,
          display: input.locale === "az-AZ"
            ? "bağlanış qiymətləri, gün ərzindəki maksimum və minimum deyil"
            : "closing prices, not intraday highs and lows",
          meaning: "methodology limitation for the one-year range",
          required: false
        }),
        sourceSlot
      ];
      fallbackTemplate = input.locale === "az-AZ"
        ? `Son bir ildə {{${slotAlias("IDENTITY")}}} üçün ən yüksək bağlanış {{${slotAlias("PERIOD_HIGH")}}}, ən aşağı bağlanış isə {{${slotAlias("PERIOD_LOW")}}} olub. Bunlar {{${slotAlias("PRICE_BASIS")}}}. {{${slotAlias("SOURCE")}}}`
        : `Over one year, {{${slotAlias("IDENTITY")}}}'s highest close was {{${slotAlias("PERIOD_HIGH")}}} and its lowest close was {{${slotAlias("PERIOD_LOW")}}}. These are {{${slotAlias("PRICE_BASIS")}}}. {{${slotAlias("SOURCE")}}}`;
    } else if (facet === "analyst_consensus") {
      facetSlots = [
        identity,
        groundedSlot({
          alias: slotAlias("CONSENSUS"),
          fact: output,
          display: analystValue(research.analystConsensus, input.locale),
          meaning: "verified analyst recommendation, coverage count, and target"
        }),
        sourceSlot
      ];
      fallbackTemplate = input.locale === "az-AZ"
        ? `{{${slotAlias("IDENTITY")}}} üzrə analitik konsensusu {{${slotAlias("CONSENSUS")}}}. {{${slotAlias("SOURCE")}}}`
        : `{{${slotAlias("IDENTITY")}}}'s analyst consensus is {{${slotAlias("CONSENSUS")}}}. {{${slotAlias("SOURCE")}}}`;
    } else {
      facetSlots = [
        identity,
        groundedSlot({
          alias: slotAlias("VOLATILITY"),
          fact: output,
          display: metricValue(
            research.instrumentSpecificRisks.annualizedVolatility,
            input.locale
          ),
          meaning: "verified historical annualized volatility"
        }),
        groundedSlot({
          alias: slotAlias("DRAWDOWN"),
          fact: output,
          display: metricValue(
            research.instrumentSpecificRisks.maximumDrawdown,
            input.locale
          ),
          meaning: "verified historical maximum drawdown"
        }),
        groundedSlot({
          alias: slotAlias("DOWNSIDE_VOLATILITY"),
          fact: output,
          display: metricValue(
            research.instrumentSpecificRisks.downsideVolatility,
            input.locale
          ),
          meaning: "verified historical downside volatility",
          required: false
        }),
        sourceSlot
      ];
      fallbackTemplate = input.locale === "az-AZ"
        ? `{{${slotAlias("IDENTITY")}}} üzrə tarixi illik volatillik {{${slotAlias("VOLATILITY")}}}, maksimum eniş isə {{${slotAlias("DRAWDOWN")}}} olub. {{${slotAlias("SOURCE")}}}`
        : `{{${slotAlias("IDENTITY")}}}'s historical annualized volatility was {{${slotAlias("VOLATILITY")}}}, with a maximum drawdown of {{${slotAlias("DRAWDOWN")}}}. {{${slotAlias("SOURCE")}}}`;
    }
    const fallbackRefs = [
      ...facetSlots
        .filter(({ required }) => required)
        .map(({ alias }) => alias),
      ...(facet === "price_range" ? [slotAlias("PRICE_BASIS")] : [])
    ];
    return {
      fact: output,
      display: `${display}${researchSourceSuffix({
        researchTool: researchTool!,
        research,
        locale: input.locale
      })}`,
      renderableFacts: facetSlots,
      fallback: [claim({
        id: `fallback-${facet}-${input.symbol}`,
        locale: input.locale,
        template: fallbackTemplate,
        factRefs: fallbackRefs
      })],
      card: {
        cardId: `card-research-${facet}-${input.symbol}`,
        kind: "research",
        title: `${input.symbol} · ${resolved.displayName}`,
        factRefs: [output.factId],
        data: value
      },
      chart: null,
      freshness: null,
      partial,
      notices: research.notices
    };
  }
  const toolSet = [
    ...commonTools,
    ...(snapshotTool ? [snapshotTool] : []),
    researchTool!,
    ...(oneYearTool ? [oneYearTool] : []),
    ...(tenYearTool && tenYearTool !== oneYearTool ? [tenYearTool] : [])
  ];
  const companyEtfResearch =
    input.route === "company_research" &&
    input.researchFacet === "general" &&
    research.instrumentType === "ETF";
  if (input.route === "etf_explanation_risk" || companyEtfResearch) {
    if (
      research.instrumentType !== "ETF" ||
      resolved.instrumentType !== "ETF" ||
      snapshot === null ||
      snapshotTool === undefined ||
      selectedHistory === null
    ) {
      throw new Error("Verified ETF identity, quote, research, and history are required.");
    }
    const presented = etfPresentation({
      research,
      resolved,
      locale: input.locale
    });
    const output = fact({
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer,
      kind: companyEtfResearch ? "market.etf-research" : "market.etf-risk",
      symbol: input.symbol,
      asOf: research.generatedAt,
      value: presented.data,
      tools: toolSet,
      formulaId: "etf-risk-profile-v1",
      partial: presented.partial
    });
    const slotAlias = (suffix: string) => `${input.alias}_${suffix}`;
    const expense = availableMetric(research.fund.expenseRatio);
    const totalAssets = availableMetric(research.fund.totalAssets);
    const averageVolume = availableMetric(research.fund.averageDailyVolume);
    const distributionYield = availableMetric(research.fund.distributionYield);
    const volatility = availableMetric(
      research.instrumentSpecificRisks.annualizedVolatility
    );
    const drawdown = availableMetric(
      research.instrumentSpecificRisks.maximumDrawdown
    );
    const duration = availableMetric(research.instrumentSpecificRisks.duration);
    const maturity = availableMetric(research.instrumentSpecificRisks.maturity);
    const category = boundedEvidenceText(availableString(research.fund.category), 64);
    const family = boundedEvidenceText(availableString(research.fund.fundFamily), 64);
    const objective = boundedEvidenceText(availableString(research.fund.objective));
    const trackedIndex = boundedEvidenceText(availableString(research.fund.trackedIndex));
    const trackingDifference = metricValue(
      research.instrumentSpecificRisks.trackingDifference,
      input.locale
    );
    const concentration = etfConcentrationValue(
      research.instrumentSpecificRisks.concentration,
      input.locale
    );
    const creditQuality = etfCreditQualityValue(
      research.instrumentSpecificRisks.creditQuality,
      input.locale
    );
    const slots = [
      groundedSlot({
        alias: slotAlias("IDENTITY"),
        fact: output,
        display: `${resolved.displayName} (${research.symbol})`,
        meaning: "verified ETF name and ticker",
        semanticRoles: ["instrument.identity"]
      }),
      groundedSlot({
        alias: slotAlias("CLASSIFICATION"),
        fact: output,
        display: input.locale === "az-AZ"
          ? `ETF-dir${category ? `; kateqoriya: ${category}` : ""}${family ? `; fond ailəsi: ${family}` : ""}`
          : `is an ETF${category ? `; category: ${category}` : ""}${family ? `; fund family: ${family}` : ""}`,
        meaning: "verified ETF classification and fund family",
        required: false,
        semanticRoles: ["instrument.type"]
      }),
      groundedSlot({
        alias: slotAlias("EXPENSE"),
        fact: output,
        display: metricDisplay(expense, input.locale),
        meaning: "verified annual expense ratio",
        semanticRoles: ["knowledge.fee"]
      }),
      groundedSlot({
        alias: slotAlias("ASSETS"),
        fact: output,
        display: totalAssets === null
          ? unavailableField(input.locale)
          : compactMarketCapitalization(totalAssets, input.locale),
        meaning: "verified total fund assets",
        required: false
      }),
      groundedSlot({
        alias: slotAlias("LIQUIDITY"),
        fact: output,
        display: metricDisplay(averageVolume, input.locale),
        meaning: "verified average daily trading volume",
        required: false
      }),
      groundedSlot({
        alias: slotAlias("DISTRIBUTION"),
        fact: output,
        display: metricDisplay(distributionYield, input.locale),
        meaning: "verified distribution yield",
        semanticRoles: ["fundamental.dividend_yield"]
      }),
      groundedSlot({
        alias: slotAlias("HISTORICAL_RISK"),
        fact: output,
        display: input.locale === "az-AZ"
          ? `1 illik volatillik ${metricDisplay(volatility, input.locale)}, maksimum eniş ${metricDisplay(drawdown, input.locale)}`
          : `1Y volatility ${metricDisplay(volatility, input.locale)}, maximum drawdown ${metricDisplay(drawdown, input.locale)}`,
        meaning: "verified one-year historical volatility and maximum drawdown",
        semanticRoles: ["risk.generic", "risk.volatility", "risk.drawdown"]
      }),
      groundedSlot({
        alias: slotAlias("RATE_RISK"),
        fact: output,
        display: input.locale === "az-AZ"
          ? `müddət ${metricDisplay(duration, input.locale)}, orta ödəmə müddəti ${metricDisplay(maturity, input.locale)}`
          : `duration ${metricDisplay(duration, input.locale)}, maturity ${metricDisplay(maturity, input.locale)}`,
        meaning: "verified duration and maturity indicators for rate risk",
        semanticRoles: ["risk.generic", "risk.duration", "risk.maturity"]
      }),
      groundedSlot({
        alias: slotAlias("CONCENTRATION"),
        fact: output,
        display: concentration,
        meaning: "verified holdings concentration or explicit unavailability",
        required: false,
        semanticRoles: ["risk.concentration"]
      }),
      groundedSlot({
        alias: slotAlias("CREDIT"),
        fact: output,
        display: creditQuality,
        meaning: "largest verified credit-quality buckets",
        required: false,
        semanticRoles: ["risk.credit"]
      }),
      groundedSlot({
        alias: slotAlias("OBJECTIVE_TRACKING"),
        fact: output,
        display: input.locale === "az-AZ"
          ? `məqsəd ${objective ?? "mövcud deyil"}; izlənən indeks ${trackedIndex ?? "mövcud deyil"}; izləmə fərqi ${trackingDifference}`
          : `objective ${objective ?? "unavailable"}; tracked index ${trackedIndex ?? "unavailable"}; tracking difference ${trackingDifference}`,
        meaning: "verified objective, tracked index, and tracking difference or their explicit unavailability",
        required: false
      }),
      groundedSlot({
        alias: slotAlias("SOURCE"),
        fact: output,
        display: researchSourceSuffix({
          researchTool: researchTool!,
          research,
          locale: input.locale
        }).trim(),
        meaning: "verified ETF research time and source",
        semanticRoles: ["source.identity", "source.time"]
      })
    ];
    return {
      fact: output,
      display: `${presented.display}${researchSourceSuffix({
        researchTool: researchTool!,
        research,
        locale: input.locale
      })}`,
      renderableFacts: slots,
      fallback: [
        claim({
          id: `fallback-etf-profile-${input.symbol}`,
          locale: input.locale,
          template: input.locale === "az-AZ"
            ? `{{${slotAlias("IDENTITY")}}} {{${slotAlias("CLASSIFICATION")}}}. İllik xərc nisbəti {{${slotAlias("EXPENSE")}}}, aktivlər {{${slotAlias("ASSETS")}}}, orta gündəlik həcm {{${slotAlias("LIQUIDITY")}}}, bölüşdürmə gəlirliliyi {{${slotAlias("DISTRIBUTION")}}}.`
            : `{{${slotAlias("IDENTITY")}}} {{${slotAlias("CLASSIFICATION")}}}. Its expense ratio is {{${slotAlias("EXPENSE")}}}, assets are {{${slotAlias("ASSETS")}}}, average daily volume is {{${slotAlias("LIQUIDITY")}}}, and distribution yield is {{${slotAlias("DISTRIBUTION")}}}.`,
          factRefs: [
            slotAlias("IDENTITY"),
            slotAlias("CLASSIFICATION"),
            slotAlias("EXPENSE"),
            slotAlias("ASSETS"),
            slotAlias("LIQUIDITY"),
            slotAlias("DISTRIBUTION")
          ]
        }),
        claim({
          id: `fallback-etf-risk-${input.symbol}`,
          locale: input.locale,
          template: input.locale === "az-AZ"
            ? `Risk göstəriciləri: {{${slotAlias("HISTORICAL_RISK")}}}; {{${slotAlias("RATE_RISK")}}}; konsentrasiya {{${slotAlias("CONCENTRATION")}}}; əsas kredit kateqoriyaları {{${slotAlias("CREDIT")}}}; {{${slotAlias("OBJECTIVE_TRACKING")}}}. {{${slotAlias("SOURCE")}}}`
            : `Risk indicators: {{${slotAlias("HISTORICAL_RISK")}}}; {{${slotAlias("RATE_RISK")}}}; concentration {{${slotAlias("CONCENTRATION")}}}; largest credit buckets {{${slotAlias("CREDIT")}}}; {{${slotAlias("OBJECTIVE_TRACKING")}}}. {{${slotAlias("SOURCE")}}}`,
          factRefs: [
            slotAlias("HISTORICAL_RISK"),
            slotAlias("RATE_RISK"),
            slotAlias("CONCENTRATION"),
            slotAlias("CREDIT"),
            slotAlias("OBJECTIVE_TRACKING"),
            slotAlias("SOURCE")
          ]
        })
      ],
      card: {
        cardId: companyEtfResearch
          ? `card-etf-research-${input.symbol}`
          : `card-etf-risk-${input.symbol}`,
        kind: "research",
        title: `${input.symbol} · ${resolved.displayName}`,
        factRefs: [output.factId],
        data: presented.data
      },
      chart: chart(selectedHistory),
      freshness: freshness(snapshot),
      partial: presented.partial,
      notices: [...research.notices, snapshot.notice]
    };
  }
  const marketCap = availableMetric(research.valuation.marketCapitalization);
  const trailingPe = availableMetric(research.valuation.trailingPe);
  const roe = availableMetric(research.returnOnEquity);
  const quarterlyNetIncome = availableMetric(research.profitability.quarterlyNetIncome);
  const grossMargin = availableMetric(research.profitability.quarterlyGrossMargin);
  const netMargin = availableMetric(research.profitability.quarterlyNetMargin);
  const volatility = availableMetric(research.instrumentSpecificRisks.annualizedVolatility);
  const drawdown = availableMetric(research.instrumentSpecificRisks.maximumDrawdown);
  const companyOverview = companyOverviewDisplay(research, input.locale);
  const gaps = [marketCap, trailingPe, roe, volatility, drawdown].filter((item) => item === null).length;
  const value = {
    symbol: input.symbol,
    resolved,
    snapshot,
    research,
    priceHistory: selectedHistory,
    summaryMetrics: {
      companyProfile: research.profile,
      marketCapitalization: marketCap,
      trailingPe,
      returnOnEquity: roe,
      quarterlyNetIncome,
      quarterlyGrossMargin: grossMargin,
      quarterlyNetMargin: netMargin,
      annualizedVolatility: volatility,
      maximumDrawdown: drawdown
    }
  };
  const kind = input.route === "security_risk"
    ? "market.security-risk"
    : "market.company-research";
  const output = fact({
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer,
    kind,
    symbol: input.symbol,
    asOf: research.generatedAt,
    value,
    tools: toolSet,
    formulaId: input.route === "security_risk" ? "historical-price-risk-v1" : null,
    partial: gaps > 0
  });
  const quoteText = snapshot
    ? `${formatMoneyExact(snapshot.price, snapshot.currency, input.locale)} (${signedPercentValue(snapshot.changePercent, input.locale)})`
    : input.locale === "az-AZ" ? "qiymət mövcud deyil" : "price unavailable";
  const display = input.locale === "az-AZ"
    ? `${resolved.displayName} (${input.symbol}): ${quoteText}; bazar kapitallaşması ${metricDisplay(marketCap, input.locale)}, P/E ${metricDisplay(trailingPe, input.locale)}, ROE ${metricDisplay(roe, input.locale)}, illik volatillik ${metricDisplay(volatility, input.locale)}, maksimum eniş ${metricDisplay(drawdown, input.locale)}`
    : `${resolved.displayName} (${input.symbol}): ${quoteText}; market cap ${metricDisplay(marketCap, input.locale)}, trailing P/E ${metricDisplay(trailingPe, input.locale)}, ROE ${metricDisplay(roe, input.locale)}, annualized volatility ${metricDisplay(volatility, input.locale)}, maximum drawdown ${metricDisplay(drawdown, input.locale)}`;
  const slotAlias = (suffix: string) => `${input.alias}_${suffix}`;
  const researchSlots = [
    groundedSlot({
      alias: slotAlias("IDENTITY"),
      fact: output,
      display: `${resolved.displayName} (${input.symbol})`,
      meaning: "verified instrument name and ticker"
    }),
    groundedSlot({
      alias: slotAlias("PROFILE"),
      fact: output,
      display: companyOverview,
      meaning: "reviewed general company business model, growth, and risk profile",
      required: input.comparison,
      semanticRoles: ["instrument.identity", "risk.generic"]
    }),
    groundedSlot({
      alias: slotAlias("QUOTE"),
      fact: output,
      display: quoteText,
      meaning: "verified current price and previous-close change",
      required: input.route !== "security_risk" && !input.comparison
    }),
    groundedSlot({
      alias: slotAlias("MARKET_CAP"),
      fact: output,
      display: metricDisplay(marketCap, input.locale),
      meaning: "verified market capitalization",
      required: input.route !== "security_risk" && !input.comparison
    }),
    groundedSlot({
      alias: slotAlias("TRAILING_PE"),
      fact: output,
      display: metricDisplay(trailingPe, input.locale),
      meaning: "verified trailing price-to-earnings ratio",
      required: input.route !== "security_risk" && !input.comparison
    }),
    groundedSlot({
      alias: slotAlias("ROE"),
      fact: output,
      display: metricDisplay(roe, input.locale),
      meaning: "verified return on equity",
      required: false
    }),
    groundedSlot({
      alias: slotAlias("VOLATILITY"),
      fact: output,
      display: metricDisplay(volatility, input.locale),
      meaning: "verified historical annualized volatility",
      required: input.route === "security_risk"
    }),
    groundedSlot({
      alias: slotAlias("DRAWDOWN"),
      fact: output,
      display: metricDisplay(drawdown, input.locale),
      meaning: "verified historical maximum drawdown",
      required: input.route === "security_risk"
    }),
    groundedSlot({
      alias: slotAlias("SOURCE"),
      fact: output,
      display: researchSourceSuffix({
        researchTool: researchTool!,
        research,
        locale: input.locale
      }).trim(),
      meaning: "verified research time and source"
    })
  ];
  const fallbackRefs = input.route === "security_risk"
    ? [
        slotAlias("IDENTITY"),
        slotAlias("VOLATILITY"),
        slotAlias("DRAWDOWN"),
        slotAlias("SOURCE")
      ]
    : [
        slotAlias("IDENTITY"),
        slotAlias("QUOTE"),
        slotAlias("MARKET_CAP"),
        slotAlias("TRAILING_PE"),
        slotAlias("SOURCE")
      ];
  return {
    fact: output,
    display,
    renderableFacts: researchSlots,
    fallback: [claim({
      id: `fallback-${input.route}-${input.symbol}`,
      locale: input.locale,
      template: input.route === "security_risk"
        ? input.locale === "az-AZ"
          ? `{{${slotAlias("IDENTITY")}}} üçün illik volatillik {{${slotAlias("VOLATILITY")}}}, maksimum eniş isə {{${slotAlias("DRAWDOWN")}}}; {{${slotAlias("SOURCE")}}}`
          : `For {{${slotAlias("IDENTITY")}}}, annualized volatility is {{${slotAlias("VOLATILITY")}}} and maximum drawdown is {{${slotAlias("DRAWDOWN")}}}; {{${slotAlias("SOURCE")}}}`
        : input.locale === "az-AZ"
          ? `{{${slotAlias("IDENTITY")}}} — kotirovka: {{${slotAlias("QUOTE")}}}; bazar kapitallaşması: {{${slotAlias("MARKET_CAP")}}}; P/E: {{${slotAlias("TRAILING_PE")}}}; {{${slotAlias("SOURCE")}}}`
          : `{{${slotAlias("IDENTITY")}}} is at {{${slotAlias("QUOTE")}}}, with market cap {{${slotAlias("MARKET_CAP")}}} and trailing P/E {{${slotAlias("TRAILING_PE")}}}; {{${slotAlias("SOURCE")}}}`,
      factRefs: fallbackRefs
    })],
    card: {
      cardId: `card-research-${input.symbol}`,
      kind: "research",
      title: `${input.symbol} · ${resolved.displayName}`,
      factRefs: [output.factId],
      data: value
    },
    chart: selectedHistory ? chart(selectedHistory) : null,
    freshness: snapshot ? freshness(snapshot) : null,
    partial: gaps > 0,
    notices: research.notices
  };
}

export function buildPublicCapabilityPresentation(input: {
  route: PublicRoute;
  researchFacet: V3ResearchFacet | null;
  symbols: readonly string[];
  context: TrustedRequestContext;
  workflowRunId: string;
  tools: readonly ToolExecutionEnvelope<unknown>[];
  signer: DevHmacSigner;
}): CapabilityPresentation {
  if (input.symbols.length === 0) throw new Error("A ticker symbol is required.");
  const items = input.symbols.map((symbol, index) => publicSymbolPresentation({
    ...input,
    symbol,
    locale: input.context.locale,
    alias: `F${index + 1}`,
    comparison:
      input.route === "company_research" &&
      input.researchFacet === "general" &&
      input.symbols.length > 1
  }));
  const aliases = items.map((_, index) => `F${index + 1}`);
  const etfComparison =
    items.length > 1 &&
    items.every(({ fact: itemFact }) =>
      itemFact.kind === "market.etf-research" ||
      itemFact.kind === "market.etf-risk"
    );
  const companyComparison =
    input.route === "company_research" &&
    input.researchFacet === "general" &&
    items.length > 1 &&
    !etfComparison;
  const itemRenderableFacts = items.flatMap((item, index) =>
    item.renderableFacts ?? [{
      alias: aliases[index]!,
      fact: item.fact,
      display: item.display,
      meaning: `verified ${item.fact.kind.replaceAll(".", " ")} evidence for ${item.fact.subject.ref}`,
      required: true
    }]
  );
  const comparisonBoundaryFact = companyComparison
    ? groundedSlot({
        alias: "COMPARISON_BOUNDARY",
        fact: items[0]!.fact,
        display: comparisonInvestingBoundary(input.context.locale),
        meaning:
          "required execution-only non-advisory boundary, capital-risk warning, suitability factors, and Invest-section direction",
        semanticRoles: [
          "instrument.type",
          "risk.generic",
          "knowledge.disclosure",
          "knowledge.product"
        ]
      })
    : null;
  const renderableFacts = comparisonBoundaryFact === null
    ? itemRenderableFacts
    : [...itemRenderableFacts, comparisonBoundaryFact];
  const deterministicResearchFacet =
    input.researchFacet !== null && input.researchFacet !== "general";
  const baseTemplate = deterministicResearchFacet
    ? aliases.map((alias) => `{{${alias}}}`).join(" ")
    : items.length > 1
      ? input.context.locale === "az-AZ"
        ? `Yan-yana müqayisə: ${aliases.map((alias) => `{{${alias}}}`).join(" ")}`
        : `Here is the side-by-side comparison: ${aliases.map((alias) => `{{${alias}}}`).join(" ")}`
    : input.context.locale === "az-AZ"
      ? `Baxdığım cari sübutlara əsasən, {{${aliases[0]}}}`
      : `Based on the current evidence I checked, {{${aliases[0]}}}`;
  const needsDecisionFactorNotice = (
    !companyComparison &&
    input.route === "company_research" &&
    input.researchFacet === "general"
  ) ||
    input.route === "security_risk" ||
    input.route === "etf_explanation_risk";
  const decisionFactorNotice = needsDecisionFactorNotice
    ? input.context.locale === "az-AZ"
      ? "Bunlar qərar amilləridir, fərdi alış/satış tövsiyəsi deyil."
      : "These are decision factors, not a personalized buy or sell recommendation."
    : null;
  const template = decisionFactorNotice === null
    ? baseTemplate
    : `${baseTemplate} ${decisionFactorNotice}`;
  const fallback = companyComparison
    ? items.map((_, index) => {
        const alias = `F${index + 1}`;
        const isLast = index === items.length - 1;
        const factRefs = [
          `${alias}_IDENTITY`,
          `${alias}_PROFILE`,
          `${alias}_SOURCE`,
          ...(isLast ? ["COMPARISON_BOUNDARY"] : [])
        ];
        return claim({
          id: `fallback-company-comparison-${index + 1}`,
          locale: input.context.locale,
          template: input.context.locale === "az-AZ"
            ? `${index === 0 ? "Yan-yana baxış: " : ""}{{${alias}_IDENTITY}} — {{${alias}_PROFILE}}; {{${alias}_SOURCE}}${isLast ? " {{COMPARISON_BOUNDARY}}" : ""}`
            : `${index === 0 ? "Side-by-side overview: " : ""}{{${alias}_IDENTITY}} — {{${alias}_PROFILE}}; {{${alias}_SOURCE}}${isLast ? " {{COMPARISON_BOUNDARY}}" : ""}`,
          factRefs
        });
      })
    : etfComparison
      ? items.map((_, index) => {
        const alias = `F${index + 1}`;
        const factRefs = [
          `${alias}_IDENTITY`,
          `${alias}_CLASSIFICATION`,
          `${alias}_EXPENSE`,
          `${alias}_DISTRIBUTION`,
          `${alias}_HISTORICAL_RISK`,
          `${alias}_CONCENTRATION`,
          `${alias}_SOURCE`
        ];
        return claim({
          id: `fallback-etf-comparison-${index + 1}`,
          locale: input.context.locale,
          template: input.context.locale === "az-AZ"
            ? `{{${alias}_IDENTITY}}: {{${alias}_CLASSIFICATION}}; illik xərc {{${alias}_EXPENSE}}; bölüşdürmə gəlirliliyi {{${alias}_DISTRIBUTION}}; {{${alias}_HISTORICAL_RISK}}; konsentrasiya {{${alias}_CONCENTRATION}}; {{${alias}_SOURCE}}`
            : `{{${alias}_IDENTITY}}: {{${alias}_CLASSIFICATION}}; annual expense {{${alias}_EXPENSE}}; distribution yield {{${alias}_DISTRIBUTION}}; {{${alias}_HISTORICAL_RISK}}; concentration {{${alias}_CONCENTRATION}}; {{${alias}_SOURCE}}`,
          factRefs
        });
      })
      : items.flatMap((item) => item.fallback ?? []);
  const reviewedFallback = fallback.length > 0
    ? fallback.map((draft, index) =>
        index === fallback.length - 1 && decisionFactorNotice !== null
          ? { ...draft, textTemplate: `${draft.textTemplate} ${decisionFactorNotice}` }
          : draft
      )
    : [claim({
        id: `fallback-${input.route}`,
        locale: input.context.locale,
        template,
        factRefs: aliases
      })];
  return {
    status: items.some(({ partial }) => partial) ? "partial" : "complete",
    facts: items.map(({ fact }) => fact),
    renderableFacts,
    citations: [],
    renderableCitations: [],
    cards: items.map(({ card }) => card),
    charts: items.flatMap(({ chart: item }) => item ? [item] : []),
    freshness: items.flatMap(({ freshness: item }) => item ? [item] : []),
    notices: [...new Set(items.flatMap(({ notices }) => notices))],
    fallback: reviewedFallback,
    writerGoal: input.route === "market_move_explanation"
      ? "explain the verified price move and present attributable headlines only as possible context while stating that causality is not established"
      : companyComparison
        ? "compare the reviewed company business models, growth dynamics, and risk profiles; include the required execution-only non-advisory boundary, capital-risk warning, suitability factors, and Invest-section direction without selecting a winner"
      : etfComparison
        ? "compare the verified ETF classification, costs, distribution yield, historical volatility, drawdown, concentration, and source freshness without selecting a winner or making a suitability conclusion"
      : input.researchFacet === null
        ? input.route.replaceAll("_", " ")
        : REVIEWED_RESEARCH_WRITER_GOALS[input.researchFacet]
  };
}

export function buildSecurityDecisionSupportPresentation(input: {
  symbol: string;
  context: TrustedRequestContext;
  workflowRunId: string;
  tools: readonly ToolExecutionEnvelope<unknown>[];
  signer: DevHmacSigner;
}): CapabilityPresentation {
  const locale = input.context.locale;
  const portfolioTool = input.tools.find(({ toolId }) =>
    toolId === "read-portfolio-snapshot"
  );
  const portfolio = requireResult<MockPortfolioPositionSnapshot>({
    envelope: portfolioTool,
    toolId: "read-portfolio-snapshot",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  const resolvedTool = findForSymbol(input.tools, "resolve-instrument", input.symbol);
  const resolved = requireResult<ResolvedInstrument>({
    envelope: resolvedTool,
    toolId: "resolve-instrument",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  const researchTool = findForSymbol(
    input.tools,
    "read-instrument-research",
    input.symbol
  );
  const research = requireResult<InstrumentFacts>({
    envelope: researchTool,
    toolId: "read-instrument-research",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  const contentTool = input.tools.find(({ toolId }) =>
    toolId === "read-market-content"
  );
  const content = requireResult<MarketContentItem[]>({
    envelope: contentTool,
    toolId: "read-market-content",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });

  const lotsBySymbol = new Map<string, MockPortfolioPositionSnapshot["currentLots"][number][]>();
  for (const lot of portfolio.currentLots) {
    const lots = lotsBySymbol.get(lot.symbol) ?? [];
    lots.push(lot);
    lotsBySymbol.set(lot.symbol, lots);
  }
  const marketBySymbol = new Map<string, BoundaryMarketSnapshot>();
  for (const symbol of [...lotsBySymbol.keys()].sort()) {
    const marketTool = findForSymbol(input.tools, "read-market-snapshot", symbol);
    const market = requireResult<BoundaryMarketSnapshot>({
      envelope: marketTool,
      toolId: "read-market-snapshot",
      context: input.context,
      workflowRunId: input.workflowRunId,
      signer: input.signer
    });
    marketBySymbol.set(symbol, market);
  }

  const targetLots = lotsBySymbol.get(input.symbol);
  const targetMarket = marketBySymbol.get(input.symbol);
  if (!targetLots?.length || !targetMarket) {
    throw new Error(`${input.symbol} is not a priced holding in the current portfolio.`);
  }
  const positions = [...lotsBySymbol.entries()].map(([symbol, lots]) => {
    const market = marketBySymbol.get(symbol);
    if (!market) throw new Error(`Market evidence is unavailable for ${symbol}.`);
    const quantity = sumFixed(lots.map(({ quantity }) => parseFixedDecimal(quantity)));
    return {
      symbol,
      quantity,
      marketValue: multiplyFixed(quantity, parseFixedDecimal(market.price))
    };
  });
  const positionsValue = sumFixed(positions.map(({ marketValue }) => marketValue));
  const cashValue = parseFixedDecimal(portfolio.currentCash.amount);
  const totalValue = addFixed(positionsValue, cashValue);
  const targetPosition = positions.find(({ symbol }) => symbol === input.symbol);
  if (!targetPosition || totalValue <= ZERO_FIXED || positionsValue <= ZERO_FIXED) {
    throw new Error("The target holding could not be valued.");
  }
  const allocationRate = divideFixed(targetPosition.marketValue, totalValue);
  const investedAllocationRate = divideFixed(targetPosition.marketValue, positionsValue);
  const cashAllocationRate = divideFixed(cashValue, totalValue);
  const profileTargetRate = parseFixedDecimal(
    portfolio.investorProfile.singleStockTargetMaxAllocationRate
  );
  const targetExceeded = allocationRate > profileTargetRate;
  const targetQuantity = sumFixed(
    targetLots.map(({ quantity }) => parseFixedDecimal(quantity))
  );
  const targetCostBasis = sumFixed(targetLots.map((lot) =>
    multiplyFixed(
      parseFixedDecimal(lot.quantity),
      parseFixedDecimal(lot.unitCost.amount)
    )
  ));
  const averageCost = divideFixed(targetCostBasis, targetQuantity);
  const appreciationRate = averageCost === ZERO_FIXED
    ? ZERO_FIXED
    : divideFixed(
        subtractFixed(parseFixedDecimal(targetMarket.price), averageCost),
        averageCost
      );

  const news: SecurityNewsItem[] = content
    .filter((item) => item.kind === "NEWS" && item.url !== null)
    .map((item) => ({
      id: item.id,
      headline: item.title,
      publisher: item.attributions[0]?.publisher ?? null,
      publishedAt: item.publishedAt,
      url: item.url!,
      relatedSymbols: item.symbols,
      source: "yahoo-search"
    }));
  const sentiment = analyzeNewsSentiment(news);
  const trailingPe = availableMetric(research.valuation.trailingPe);
  const returnOnEquity = availableMetric(research.returnOnEquity);
  const volatility = availableMetric(
    research.instrumentSpecificRisks.annualizedVolatility
  );
  const drawdown = availableMetric(
    research.instrumentSpecificRisks.maximumDrawdown
  );
  const headlines = content
    .filter((item) => item.kind === "NEWS")
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 3)
    .map((item) => ({
      title: boundedEvidenceText(item.title, 120) ?? item.title,
      publisher: boundedEvidenceText(
        item.attributions[0]?.publisher ?? item.attributions[0]?.label ?? null,
        48
      ),
      publishedAt: item.publishedAt
    }));
  const allocation = formatFixedDecimal(allocationRate);
  const investedAllocation = formatFixedDecimal(investedAllocationRate);
  const profileTarget = formatFixedDecimal(profileTargetRate);
  const appreciation = formatFixedDecimal(appreciationRate);
  const value = {
    schemaVersion: "assistant-v3.security-decision-support.v1" as const,
    dataClass: "synthetic-client-and-public-indicative" as const,
    symbol: input.symbol,
    displayName: resolved.displayName,
    profile: {
      riskBand: portfolio.investorProfile.riskBand,
      objective: portfolio.investorProfile.objective,
      timeHorizonYears: String(portfolio.investorProfile.timeHorizonYears),
      singleStockTargetMaxAllocationRate: profileTarget,
      rebalancePreference: portfolio.investorProfile.rebalancePreference,
      reviewedAt: portfolio.investorProfile.reviewedAt
    },
    portfolio: {
      currency: portfolio.baseCurrency,
      quantity: formatFixedDecimal(targetQuantity),
      marketValue: formatFixedDecimal(targetPosition.marketValue),
      totalValue: formatFixedDecimal(totalValue),
      allocationRate: allocation,
      investedAllocationRate: investedAllocation,
      cashValue: formatFixedDecimal(cashValue),
      cashAllocationRate: formatFixedDecimal(cashAllocationRate),
      averageOpenLotCost: formatFixedDecimal(averageCost),
      appreciationSinceAverageOpenLotCostRate: appreciation,
      targetExceeded
    },
    market: {
      price: targetMarket.price,
      changePercent: targetMarket.changePercent,
      asOf: targetMarket.asOf,
      freshness: targetMarket.freshness,
      trailingPe: trailingPe?.value ?? null,
      returnOnEquity: returnOnEquity?.value ?? null,
      annualizedVolatility: volatility?.value ?? null,
      maximumDrawdown: drawdown?.value ?? null
    },
    news: {
      sentiment: sentiment.label,
      confidence: sentiment.confidence,
      articleCount: String(sentiment.articleCount),
      headlines
    },
    assessment: {
      targetStatus: targetExceeded ? "ABOVE_PROFILE_TARGET" as const : "WITHIN_PROFILE_TARGET" as const,
      headline: locale === "az-AZ"
        ? "Bu mövqenin portfelinizə necə uyğunlaşdığını nəzərdən keçirin"
        : "Review how this position fits your portfolio",
      rationale: targetExceeded
        ? locale === "az-AZ"
          ? "Almaq, saxlamaq və ya satmaq barədə tövsiyə verə bilmərəm; cari mövqe orta risk profili üçün tək səhm hədəfini aşır və əsas mülahizələr konsentrasiya, artım ekspozisiyası, likvidlik, xərclər və vergilərdir."
          : "I cannot recommend buying, holding, or selling; the position exceeds the single-stock target for the moderate-risk profile, and relevant trade-offs include concentration, continued growth exposure, liquidity, costs, and taxes."
        : locale === "az-AZ"
          ? "Almaq, saxlamaq və ya satmaq barədə tövsiyə verə bilmərəm; cari mövqe orta risk profili üçün tək səhm hədəfi daxilindədir və qərar yenə də məqsədlərdən, müddətdən, likvidlikdən, xərclərdən və vergilərdən asılıdır."
          : "I cannot recommend buying, holding, or selling; the position is within the single-stock target for the moderate-risk profile, and the decision still depends on goals, time horizon, liquidity, costs, and taxes.",
      options: [
        {
          id: "ADD_EXPOSURE",
          label: locale === "az-AZ" ? "Ekspozisiyanı artırmaq" : "Buy / add",
          detail: locale === "az-AZ"
            ? "Əlavə alış mövqenin çəkisini və həm mümkün artımı, həm də tək şirkət üzrə eniş riskini artırar."
            : "Adding shares would increase the position’s weight, potential upside, and exposure to company-specific losses."
        },
        {
          id: "KEEP_EXPOSURE",
          label: locale === "az-AZ" ? "Ekspozisiyanı saxlamaq" : "Hold",
          detail: locale === "az-AZ"
            ? "Saxlama mövcud artım və eniş ekspozisiyasını qoruyur; çəki nisbi qiymət dəyişiklikləri ilə dəyişməyə davam edər."
            : "Holding would retain the existing upside and downside exposure while the portfolio weight continues to move with relative prices."
        },
        {
          id: "REDUCE_EXPOSURE",
          label: locale === "az-AZ" ? "Ekspozisiyanı azaltmaq" : "Sell / reduce",
          detail: locale === "az-AZ"
            ? "Qismən və ya tam satış mövqenin çəkisini azaldar və yenidən istifadə edilənədək nağd vəsaiti artırar; vergi və xərclər burada hesablanmayıb."
            : "Selling some or all shares would lower the position’s weight and raise cash until redeployed; taxes and transaction costs are not assessed here."
        }
      ]
    },
    sources: {
      portfolioAsOf: portfolio.asOf,
      marketProvider: targetMarket.freshness,
      researchProvider: research.provider.displayName,
      newsProvider: contentTool!.source.provider
    }
  };
  const partial = content.length === 0 ||
    trailingPe === null ||
    volatility === null ||
    drawdown === null;
  const requestedAt = Date.parse(input.context.requestedAt);
  if (!Number.isFinite(requestedAt)) throw new Error("Invalid trusted request time.");
  const output = new EvidenceFactory({
    signer: input.signer,
    now: () => requestedAt
  }).fact({
    requestId: input.context.requestId,
    workflowRunId: input.workflowRunId,
    kind: "portfolio.security-decision-support",
    subject: { type: "portfolio", ref: `portfolio:primary:${input.symbol}` },
    asOf: targetMarket.asOf,
    value,
    provenance: {
      toolExecutionIds: input.tools.map(({ executionId }) => executionId),
      inputFactIds: [],
      calculation: {
        id: "portfolio-aware-security-decision-support",
        version: "1.0.0",
        formulaId: "allocation-profile-market-news-assessment-v1"
      }
    },
    quality: {
      status: partial ? "partial" : "complete",
      coverage: decimal(partial ? "0.80" : "1"),
      flags: [
        "SYNTHETIC_CLIENT_PROFILE",
        "PUBLIC_DEVELOPMENT_MARKET_FEED",
        ...(partial ? ["DATA_GAPS"] : [])
      ]
    }
  });

  // Legal issuer names commonly end in abbreviations such as "Inc.". Keep the
  // exact provider value in the signed fact/card, but normalize punctuation in
  // the inline prose so it cannot create a false sentence boundary in the
  // bounded-response safety gate.
  const inlineDisplayName = boundedEvidenceText(resolved.displayName, 80) ??
    input.symbol;
  const positionText = locale === "az-AZ"
    ? `${inlineDisplayName} (${input.symbol}) portfelin ${formatPercentRateExact(allocation, locale)}-ni və investisiya edilmiş aktivlərin ${formatPercentRateExact(investedAllocation, locale)}-ni təşkil edir.`
    : `${inlineDisplayName} (${input.symbol}) represents ${formatPercentRateExact(allocation, locale)} of the total portfolio and ${formatPercentRateExact(investedAllocation, locale)} of invested assets.`;
  const profileText = locale === "az-AZ"
    ? `Seçilmiş profil Orta Riskdir; tək səhm hədəfi ${formatPercentRateExact(profileTarget, locale)}, məqsəd isə uzunmüddətli artımdır.`
    : `The selected profile is Moderate Risk, with a ${formatPercentRateExact(profileTarget, locale)} single-stock target and a long-term growth objective.`;
  const performanceText = locale === "az-AZ"
    ? `Cari qiymət ${formatMoneyExact(targetMarket.price, targetMarket.currency, locale)}, qalan lotların orta dəyərindən dəyişmə ${formatPercentRateExact(appreciation, locale, true)}-dir.`
    : `The current price is ${formatMoneyExact(targetMarket.price, targetMarket.currency, locale)}; the change from the remaining lots’ average cost is ${formatPercentRateExact(appreciation, locale, true)}.`;
  const researchText = locale === "az-AZ"
    ? `Bazar konteksti: P/E ${metricDisplay(trailingPe, locale)}, ROE ${metricDisplay(returnOnEquity, locale)}, illik volatillik ${metricDisplay(volatility, locale)}, maksimum eniş ${metricDisplay(drawdown, locale)}.`
    : `Market context: trailing P/E ${metricDisplay(trailingPe, locale)}, ROE ${metricDisplay(returnOnEquity, locale)}, annualized volatility ${metricDisplay(volatility, locale)}, and maximum drawdown ${metricDisplay(drawdown, locale)}.`;
  const newsText = locale === "az-AZ"
    ? `Son başlıq sentimenti ${sentiment.label}; etibar ${sentiment.confidence}; ${String(sentiment.articleCount)} unikal xəbər.`
    : `Recent headline sentiment is ${sentiment.label}, with ${sentiment.confidence} confidence across ${String(sentiment.articleCount)} unique items.`;

  const slots: RenderableFact[] = [
    {
      alias: "F1_POSITION",
      fact: output,
      display: positionText,
      meaning: "verified holding weight in the total portfolio and invested assets",
      required: true,
      semanticRoles: ["portfolio.identity", "portfolio.holding_value", "portfolio.allocation"]
    },
    {
      alias: "F1_PROFILE",
      fact: output,
      display: profileText,
      meaning: "verified synthetic client risk band, concentration target, and objective",
      required: false,
      semanticRoles: ["risk.concentration", "portfolio.allocation"]
    },
    {
      alias: "F1_PERFORMANCE",
      fact: output,
      display: performanceText,
      meaning: "verified current price and change from remaining-lot average cost",
      required: true,
      semanticRoles: ["market.price", "portfolio.cost", "portfolio.return"]
    },
    {
      alias: "F1_RESEARCH",
      fact: output,
      display: researchText,
      meaning: "verified valuation, profitability, volatility, and drawdown context",
      required: true,
      semanticRoles: [
        "valuation.pe",
        "fundamental.roe",
        "risk.volatility",
        "risk.drawdown"
      ]
    },
    {
      alias: "F1_NEWS",
      fact: output,
      display: newsText,
      meaning: "deterministically scored recent headline context",
      required: true,
      semanticRoles: ["source.identity", "source.time"]
    },
    {
      alias: "F1_ASSESSMENT",
      fact: output,
      display: `${value.assessment.headline} — ${value.assessment.rationale}`,
      meaning: "non-advisory concentration summary and unranked trade-off boundary based on signed allocation and client context",
      required: true,
      semanticRoles: ["risk.concentration", "portfolio.allocation"]
    }
  ];

  return {
    status: partial ? "partial" : "complete",
    facts: [output],
    renderableFacts: slots,
    citations: [],
    renderableCitations: [],
    cards: [{
      cardId: `card-decision-support-${input.symbol}`,
      kind: "decision-support",
      title: locale === "az-AZ"
        ? `${input.symbol} qərar dəstəyi`
        : `${input.symbol} decision support`,
      factRefs: [output.factId],
      data: value
    }],
    charts: [],
    freshness: [
      ...marketBySymbol.values()
    ].map((market) => ({
      sourceId: `market-${market.symbol}`,
      asOf: market.asOf,
      status: market.freshness,
      delayMinutes: String(market.delayMinutes)
    })),
    notices: [
      locale === "az-AZ"
        ? "Müştəri portfeli və risk profili sintetikdir; bazar və xəbər məlumatları indikativdir."
        : "Client portfolio and risk-profile data are synthetic; market and news inputs are indicative.",
      locale === "az-AZ"
        ? "Bu məlumat alış, saxlama və ya satış tövsiyəsi deyil; heç bir əməliyyat başlamır."
        : "This information is not a recommendation to buy, hold, or sell, and no trade is started."
    ],
    fallback: [{
      claimId: `fallback-security-decision-support-${input.symbol}`,
      locale,
      textTemplate: "{{F1_POSITION}} {{F1_PERFORMANCE}} {{F1_RESEARCH}} {{F1_NEWS}} {{F1_ASSESSMENT}}",
      factRefs: [
        "F1_POSITION",
        "F1_PERFORMANCE",
        "F1_RESEARCH",
        "F1_NEWS",
        "F1_ASSESSMENT"
      ],
      citationRefs: [],
      limitations: []
    }],
    writerGoal: "explain portfolio concentration and neutral buy, hold, and sell perspectives from signed evidence without recommending a trade"
  };
}

export function buildKnowledgeCapabilityPresentation(input: {
  context: TrustedRequestContext;
  projected: ProjectedApprovedKnowledgeEvidence;
  route: "fees_tariff" | "approved_knowledge" | "etf_explanation_risk";
  maxFacts?: number;
  maxPropositionsPerFact?: number;
}): CapabilityPresentation {
  if (input.projected.facts.length === 0) throw new Error("Approved evidence is unavailable.");
  const maxFacts = input.maxFacts ?? 2;
  if (!Number.isSafeInteger(maxFacts) || maxFacts < 1 || maxFacts > 4) {
    throw new Error("Approved knowledge presentation fact count is invalid.");
  }
  const selectedFacts = input.projected.facts.slice(0, maxFacts);
  const maxPropositionsPerFact = input.maxPropositionsPerFact ?? 8;
  if (
    !Number.isSafeInteger(maxPropositionsPerFact) ||
    maxPropositionsPerFact < 1 ||
    maxPropositionsPerFact > 8
  ) {
    throw new Error("Approved knowledge proposition count is invalid.");
  }
  const selectedCitations = input.projected.citations.slice(0, selectedFacts.length);
  if (selectedCitations.length !== selectedFacts.length) {
    throw new Error("Every approved knowledge fact requires exactly one citation.");
  }

  const propositionGroups = selectedFacts.map((fact, factIndex) => {
    const propositions = approvedKnowledgePropositions(fact.value.text)
      .slice(0, maxPropositionsPerFact);
    return propositions.map((display, propositionIndex): RenderableFact => ({
      alias: `K${factIndex + 1}P${propositionIndex + 1}`,
      fact,
      display,
      meaning:
        `source-faithful approved product ${fact.value.documentType} proposition ` +
        `${propositionIndex + 1} from ${fact.value.section}, supported by citation C${factIndex + 1}`,
      required: true,
      requiredCitationAlias: `C${factIndex + 1}`
    }));
  });
  const renderableFacts = propositionGroups.flat();
  const renderableCitations = selectedCitations.map((citation, index): RenderableCitation => ({
    alias: `C${index + 1}`,
    citation,
    required: true
  }));
  const fallback = propositionGroups.map((items, index) => {
    const citation = renderableCitations[index];
    if (citation === undefined) {
      throw new Error("Approved knowledge proposition/citation pairing is incomplete.");
    }
    return claim({
      id: `knowledge-source-${index + 1}`,
      locale: input.context.locale,
      template: [
        ...items.map(({ alias }) => `{{${alias}}}`),
        `{{${citation.alias}}}`
      ].join(" "),
      factRefs: items.map(({ alias }) => alias),
      citationRefs: [citation.alias]
    });
  });
  return {
    status: "complete",
    facts: [...selectedFacts],
    renderableFacts,
    citations: [...selectedCitations],
    renderableCitations,
    cards: [{
      cardId: `card-${input.route}`,
      kind: input.route === "fees_tariff" ? "fee" : "knowledge",
      title: input.context.locale === "az-AZ" ? "Təsdiqlənmiş məhsul məlumatı" : "Approved product information",
      factRefs: selectedFacts.map(({ factId }) => factId),
      data: selectedFacts.map(({ value }) => ({
        sourceId: value.sourceId,
        title: value.title,
        section: value.section,
        contentAsOf: value.contentAsOf
      }))
    }],
    charts: [],
    freshness: selectedFacts.map((fact) => ({
      sourceId: fact.value.sourceId,
      asOf: fact.value.contentAsOf,
      status: "document-effective",
      delayMinutes: null
    })),
    notices: [],
    fallback,
    writerGoal: input.route === "fees_tariff"
      ? "explain the approved fee propositions naturally and cite every source once"
      : "answer naturally from the approved product propositions and cite every source once"
  };
}

export function buildReviewedEducationCapabilityPresentation(input: {
  context: TrustedRequestContext;
  workflowRunId: string;
  tool: ToolExecutionEnvelope<unknown>;
  signer: DevHmacSigner;
}): CapabilityPresentation {
  const value = requireResult<FinancialEducationRetrievalResult>({
    envelope: input.tool,
    toolId: "retrieve-reviewed-investment-education",
    context: input.context,
    workflowRunId: input.workflowRunId,
    signer: input.signer
  });
  if (
    value.schemaVersion !== "assistant-v3.financial-education-retrieval.v1" ||
    value.status !== "grounded" ||
    value.requestId !== input.context.requestId ||
    value.locale !== input.context.locale ||
    !/^[a-f0-9]{64}$/u.test(value.queryHash) ||
    value.retrieval.queryHash !== value.queryHash ||
    value.retrieval.locale !== input.context.locale ||
    value.propositions.length < 1 ||
    value.propositions.length > 5 ||
    value.propositions.length > value.retrieval.topK ||
    value.citations.length !== value.propositions.length
  ) {
    throw new Error("Reviewed investment-education evidence is invalid.");
  }
  const citationsById = new Map(
    value.citations.map((citation) => [citation.citationId, citation])
  );
  const validCitation = (
    citation: FinancialEducationCitation | undefined,
    proposition: FinancialEducationRetrievalResult["propositions"][number]
  ): citation is FinancialEducationCitation =>
    citation !== undefined &&
    citation.propositionId === proposition.propositionId &&
    citation.sourceId === proposition.sourceId &&
    citation.version === proposition.sourceVersion &&
    citation.locale === input.context.locale &&
    citation.jurisdiction === "AZ" &&
    citation.excerpt === proposition.text &&
    citation.title.trim().length > 0 &&
    citation.section.trim().length > 0 &&
    /^https:\/\//u.test(citation.sourceUrl) &&
    /^[a-f0-9]{64}$/u.test(citation.contentSha256) &&
    Number.isFinite(Date.parse(citation.reviewedAt)) &&
    Number.isFinite(Date.parse(citation.effectiveFrom)) &&
    Number.isFinite(Date.parse(citation.reviewDueAt));
  if (
    new Set(value.propositions.map(({ citationId }) => citationId)).size !==
      value.propositions.length ||
    value.propositions.some((proposition) =>
      proposition.locale !== input.context.locale ||
      proposition.text.trim() !== proposition.text ||
      proposition.text.length < 20 ||
      proposition.text.length > 1_000 ||
      !validCitation(citationsById.get(proposition.citationId), proposition)
    )
  ) {
    throw new Error("Reviewed investment-education proposition lineage is invalid.");
  }
  const requestedAt = Date.parse(input.context.requestedAt);
  if (!Number.isFinite(requestedAt)) {
    throw new Error("The trusted request timestamp is invalid.");
  }
  const educationFact = new EvidenceFactory({
    signer: input.signer,
    now: () => requestedAt
  }).fact({
    requestId: input.context.requestId,
    workflowRunId: input.workflowRunId,
    kind: "education.approved-retrieval",
    subject: {
      type: "product",
      ref: `GENERAL_FINANCIAL_EDUCATION:${value.queryHash}`
    },
    asOf: input.tool.source.sourceAsOf,
    value,
    provenance: {
      toolExecutionIds: [input.tool.executionId],
      inputFactIds: [],
      calculation: null
    },
    quality: {
      status: "complete",
      coverage: decimal("1"),
      flags: [
        "APPROVED_FINANCIAL_EDUCATION",
        value.retrieval.authorityId,
        value.locale
      ]
    }
  });
  const renderableFacts = value.propositions.map(
    (proposition, index): RenderableFact => ({
      alias: `E${index + 1}`,
      fact: educationFact,
      display: proposition.text,
      meaning:
        `exact approved financial-education proposition ${proposition.propositionId} ` +
        `from source ${proposition.sourceId} version ${proposition.sourceVersion}`,
      required: true,
      semanticRoles: ["knowledge.education"],
      requiredCitationAlias: `C${index + 1}`
    })
  );
  const citations = value.propositions.map((proposition): AssistantCitation => {
    const citation = citationsById.get(proposition.citationId);
    if (!validCitation(citation, proposition)) {
      throw new Error("Reviewed investment-education citation is invalid.");
    }
    return {
      citationId: citation.citationId,
      sourceId: `${citation.sourceId}@${citation.version}`,
      title: citation.title,
      url: citation.sourceUrl,
      sourceAsOf: citation.reviewedAt,
      effectiveFrom: citation.effectiveFrom,
      effectiveTo: citation.effectiveTo,
      contentHash: citation.contentSha256
    };
  });
  const renderableCitations = citations.map(
    (citation, index): RenderableCitation => ({
      alias: `C${index + 1}`,
      citation,
      required: true
    })
  );
  return {
    status: "complete",
    facts: [educationFact],
    renderableFacts,
    citations,
    renderableCitations,
    cards: [{
      cardId: `card-education-${value.queryHash.slice(0, 16)}`,
      kind: "knowledge",
      title: input.context.locale === "az-AZ"
        ? "Təsdiqlənmiş maliyyə təhsili"
        : "Approved financial education",
      factRefs: [educationFact.factId],
      data: {
        queryHash: value.queryHash,
        authorityId: value.retrieval.authorityId,
        propositionCount: value.propositions.length,
        sourceIds: [...new Set(value.propositions.map(({ sourceId }) => sourceId))]
      }
    }],
    charts: [],
    freshness: citations.map((citation) => ({
      sourceId: citation.sourceId,
      asOf: citation.sourceAsOf,
      status: "document-effective",
      delayMinutes: null
    })),
    notices: [],
    // Education is useful only when the constrained writer successfully
    // explains retrieved evidence. There is deliberately no substantive
    // deterministic answer template.
    fallback: [],
    writerGoal:
      "answer the financial-education question naturally using every approved proposition and its paired citation, without personalizing advice or suitability"
  };
}

/**
 * Turns one verified retrieval chunk into bounded, source-faithful semantic
 * propositions. There is no generative extraction here: every returned value
 * is an exact normalized substring of the signed chunk. Unsupported chunk
 * shapes fail closed instead of being truncated into an incomplete claim.
 */
export function approvedKnowledgePropositions(text: string): string[] {
  if (/…|\.\.\./u.test(text)) {
    throw new Error("Approved knowledge evidence cannot be projected into safe propositions.");
  }
  const normalized = text.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0 || normalized.length > 4_000) {
    throw new Error("Approved knowledge evidence has an invalid bounded length.");
  }
  const propositions = normalized
    .split(/(?<=[.!?])\s+|;\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    propositions.length === 0 ||
    propositions.length > 8 ||
    propositions.some((item) =>
      item.length > 600 ||
      !normalized.includes(item)
    )
  ) {
    throw new Error("Approved knowledge evidence cannot be projected into safe propositions.");
  }
  return propositions;
}
