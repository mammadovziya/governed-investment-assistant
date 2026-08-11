import type { SupportedLocale } from "./contracts.js";
import {
  classifyV3ConversationalTurn,
  renderReviewedConversationAnswer,
  reviewedConversationDefinition,
  safeStudioConversationalReply,
  type V3ConversationalTurnKind
} from "./conversation.js";
import { v3DirectTargetCurrency } from "./direct-currency.js";
import type { V3DirectRenderableToolId } from
  "./direct-evidence-output-processor.js";
import { v3DirectTickerCandidates } from "./direct-symbols.js";
import { parseHypotheticalPortfolioScenario } from "./portfolio-scenarios.js";
import { routeV3Request } from "./routing.js";
import { analyzeV3SemanticFrame } from "./semantic-frame.js";

export type V3ReviewedNoToolKind =
  | "allocation_clarification"
  | "instrument_clarification"
  | "investment_selection_clarification"
  | V3ConversationalTurnKind;

/**
 * Derives the complete, reviewed input for the direct allocation-analysis
 * boundary. Hypothetical values are accepted only through the same strict
 * parser used by the application workflow; current-portfolio reviews never
 * accept caller-supplied identifiers or positions.
 */
export function deriveV3DirectPortfolioAllocationArguments(
  query: string
): Readonly<Record<string, unknown>> | null {
  const hypothetical = parseHypotheticalPortfolioScenario(query);
  if (hypothetical.status === "supported") {
    return Object.freeze({
      scope: "hypothetical",
      currency: hypothetical.scenario.currency,
      totalValue: hypothetical.scenario.totalValue,
      allocations: Object.freeze(
        hypothetical.scenario.allocations.map((allocation) => Object.freeze({
          label: allocation.label,
          symbol: allocation.symbol,
          category: allocation.category,
          theme: allocation.theme,
          allocationRate: allocation.allocationRate,
          amount: allocation.amount
        }))
      )
    });
  }

  const normalized = query
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  const portfolioRiskReview =
    /\b(?:biggest|largest|main|key|primary)\s+(?:portfolio\s+)?risks?\b/iu
      .test(normalized) &&
    /\bportfolio\b/iu.test(normalized);
  const portfolioAdvisorReview =
    /\bif\s+you\s+were\s+my\s+(?:investment\s+)?advis(?:er|or)\b/iu
      .test(normalized) &&
    /\bportfolio\b/iu.test(normalized);
  return portfolioRiskReview || portfolioAdvisorReview
    ? Object.freeze({ scope: "current" })
    : null;
}

export function classifyV3ReviewedNoToolTurn(
  query: string
): V3ReviewedNoToolKind | null {
  const normalized = query
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  const conversationalTurn = classifyV3ConversationalTurn(query);
  if (conversationalTurn !== null) return conversationalTurn;
  const semanticFrame = analyzeV3SemanticFrame(query);
  if (
    semanticFrame.investmentSelection &&
    v3DirectTickerCandidates(query).length === 0
  ) {
    return "investment_selection_clarification";
  }
  if (
    /\b(?:what\s+allocation|how\s+should\s+i\s+allocate|allocation\s+should\s+i|growth\s+but\s+not\s+too\s+volatile)\b|(?:necə\s+bölüşdür|hansı\s+allokasiya|çox\s+dəyişkən\s+olmayan\s+artım)/u
      .test(normalized)
  ) {
    return "allocation_clarification";
  }
  if (
    /\b(?:this|that|the)\s+(?:company|stock|share|bond\s+fund|fund|etf|bond)\b|(?:bu|həmin)\s+(?:şirkət|səhm|fond|etf|istiqraz)/u
      .test(normalized)
  ) {
    return "instrument_clarification";
  }
  return null;
}

/**
 * Reviewed semantic dispatch policy for one direct Studio turn. The function
 * consumes only the current query and never accepts recalled context.
 */
export function expectedV3DirectToolForQuery(
  query: string
): V3DirectRenderableToolId | null {
  const normalized = query
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  if (normalized.length === 0) return null;
  const routed = routeV3Request(query);
  if (routed.route === "education") {
    return "retrieve-reviewed-investment-education";
  }
  if (routed.route === "ytd_gain_loss_twr") {
    return "read-portfolio-snapshot";
  }
  if (deriveV3DirectPortfolioAllocationArguments(query) !== null) {
    return "analyze-portfolio-allocation";
  }
  if (classifyV3ReviewedNoToolTurn(query) !== null) return null;
  const semanticFrame = analyzeV3SemanticFrame(query);
  if (
    /\bdemo\s+invest\b.{0,80}\b(?:fees?|commissions?|tariffs?|polic(?:y|ies)|disclosures?|support|market\s+hours?|tax(?:es)?|custody|insurance|orders?|products?)\b|(?:komissiya|tarif|qayda|açıqlama|dəstək|bazar\s+saat|vergi|saxlanma|sığorta).{0,80}\bdemo\s+invest\b/u
      .test(normalized)
  ) {
    return "retrieve-approved-product-knowledge";
  }
  if (
    v3DirectTargetCurrency(normalized) !== null &&
    /\b(?:current|latest|now|price|quote|worth|cost)\b|(?:cari|hazırkı|son\s+qiymət|qiyməti)/u
      .test(normalized)
  ) {
    return "convert-currency";
  }
  if (
    v3DirectTargetCurrency(normalized) !== null &&
    (
      /\b(?:portfolio|holdings?|it|that|value|amount)\b|(?:portfel|onu|bunu|dəyəri|məbləği)/u
        .test(normalized) ||
      /\b(?:usd|azn)\s+\d+(?:[.,]\d{1,8})?\b|\b\d+(?:[.,]\d{1,8})?\s*(?:usd|azn)\b/u
        .test(normalized)
    )
  ) {
    return "convert-currency";
  }
  if (
    /\b(?:my\s+)?(?:activity|transactions?|trades?|orders?|bought|sold|purchases?|dividends?|fees?|cash\s*flows?)\b|(?:əməliyyat|sifariş|alış|satış|komissiya|dividend)/u
      .test(normalized)
  ) {
    return "read-portfolio-activity";
  }
  if (
    /\b(?:my\s+portfolio|portfolio|holdings?|cash\s+balance|average\s+cost|cost\s+basis|unrealized|ytd|sector\s+allocation)\b|(?:portfel|orta\s+alış|maya\s+dəyəri|reallaşmamış|sektor\s+bölgüsü)/u
      .test(normalized)
  ) {
    return "read-portfolio-snapshot";
  }
  if (semanticFrame.marketMoveExplanation) {
    return "read-market-content";
  }
  if (
    /\b(?:news|headline|sentiment|catalyst)\b|(?:xəbər|sentiment|əhval)/u
      .test(normalized)
  ) {
    return "read-market-content";
  }
  if (
    /\b(?:chart|history|historical|return|performance|indicator|technical|trend|1d|1w|1m|6m|1y|5y|10y|\d+\s*(?:days?|weeks?|months?|years?))\b|(?:qrafik|tarix|göstərici|texniki|trend|\d+\s*(?:gün|həftə|ay|il))/u
      .test(normalized)
  ) {
    return "read-price-history";
  }
  if (
    /\b(?:listed|listing|exchange|resolve|identify|instrument\s+type)\b|(?:birja|listinq|aləti\s+tap)/u
      .test(normalized)
  ) {
    return "resolve-instrument";
  }
  if (
    semanticFrame.securityComparison ||
    /\b(?:market\s+cap(?:italization)?|p\/?e|price[\s-]?to[\s-]?earnings|dividend|yield|analyst|rating|consensus|52[\s-]?week|fundamental|valuation|financial|margin|revenue|income|roe|holder|risk|volatility|drawdown|compare|compared|versus|vs\.?)\b|(?:bazar\s+kapital|dividend|gəlirlilik|analitik|reytinq|fundamental|marja|gəlir|risk|volatillik|müqayisə)/u
      .test(normalized)
  ) {
    return "read-instrument-research";
  }
  if (
    /\b(?:current|latest|now|price|quote|worth|cost)\b|(?:cari|hazırkı|son\s+qiymət|qiyməti)/u
      .test(normalized)
  ) {
    return "read-market-snapshot";
  }
  return "read-instrument-research";
}

export function reviewedV3StudioNoToolResponse(input: {
  readonly query: string;
  readonly locale: SupportedLocale;
  readonly modelText?: string;
}): string | null {
  const kind = classifyV3ReviewedNoToolTurn(input.query);
  if (kind === null) return null;
  if (([
    "greeting",
    "gratitude",
    "capability_overview",
    "simplify_follow_up"
  ] as const satisfies readonly V3ConversationalTurnKind[]).includes(
    kind as V3ConversationalTurnKind
  )) {
    const generated = input.modelText === undefined
      ? null
      : safeStudioConversationalReply({
          message: input.query,
          locale: input.locale,
          modelText: input.modelText
        });
    if (generated !== null) return generated;
    const definition = reviewedConversationDefinition(input.query, input.locale);
    return definition === null
      ? null
      : renderReviewedConversationAnswer(definition);
  }
  if (input.locale === "az-AZ") {
    switch (kind) {
      case "allocation_clarification":
        return "Sizin üçün fərdi aktiv bölgüsü təyin edə bilmərəm. Müddətinizi, qəbul edə biləcəyiniz zərəri, likvidlik ehtiyacınızı və bunun bütün portfeliniz olub-olmadığını yazsanız, seçim amillərini izah edə bilərəm.";
      case "instrument_clarification":
        return "Zəhmət olmasa dəqiq tickeri qeyd edin. “Bu şirkət/fond/ETF” bir aləti müəyyən etmir və mən əvvəlki mesajdakı tickeri yenidən istifadə etməyəcəyəm.";
      case "investment_selection_clarification": {
        const semanticFrame = analyzeV3SemanticFrame(input.query);
        const horizon = semanticFrame.includedHorizonMonths.at(-1);
        const horizonText = horizon === undefined
          ? ""
          : horizon % 12 === 0
            ? `${String(horizon / 12)} illik üfüqü nəzərə aldım. `
            : `${String(horizon)} aylıq üfüqü nəzərə aldım. `;
        return `${horizonText}ETF uyğunluğunu təxmin etmədən qiymətləndirmək üçün itkiyə dözümlülüyünüzü, likvidlik ehtiyacınızı və mövcud portfelinizin əsas bölgüsünü yazın. İki dəqiq ticker versəniz, onları yoxlanmış alət məlumatları ilə müqayisə edə bilərəm.`;
      }
    }
  }
  switch (kind) {
    case "allocation_clarification":
      return "I can’t set a personal asset allocation for you. Share your time horizon, loss tolerance, liquidity needs, and whether this is your whole portfolio, and I can explain the decision factors.";
    case "instrument_clarification":
      return "Please name the exact ticker. “This company/fund/ETF” does not identify an instrument, and I won’t reuse a ticker from an earlier message.";
    case "investment_selection_clarification": {
      const semanticFrame = analyzeV3SemanticFrame(input.query);
      const horizon = semanticFrame.includedHorizonMonths.at(-1);
      const horizonText = horizon === undefined
        ? ""
        : horizon % 12 === 0
          ? `I noted the ${String(horizon / 12)}-year horizon. `
          : `I noted the ${String(horizon)}-month horizon. `;
      return `${horizonText}To assess ETF fit without guessing, provide your loss tolerance, liquidity needs, and the main allocation of your existing portfolio. If you name two exact tickers, I can compare them using verified tool evidence.`;
    }
  }
  return null;
}
