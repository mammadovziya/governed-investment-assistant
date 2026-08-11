import { analyzeV3SemanticFrame } from "./semantic-frame.js";

const V3_DIRECT_TICKER_STOP_WORDS = new Set([
  "A", "ABOUT", "ALL", "AN", "AND", "ANY", "APPLE", "AS", "AT", "AZ",
  "ABB", "BUY", "BY", "CASH", "CHART", "CURRENT", "ETF", "FOR", "FROM",
  "HISTORY", "HOW", "I", "IN", "INTO", "INVEST", "IS", "IT", "LAST",
  "LATEST", "MAX", "ME", "MY", "NEWS", "NOW", "OF", "ON", "ORDER",
  "ORDERS", "PORTFOLIO", "PRICE", "QUOTE", "RESOLVE", "RISK", "SELL",
  "SHARE", "SHARES", "SHOW", "STOCK", "THE", "TO", "TRADE", "TRADES",
  "TRANSACTION", "TRANSACTIONS", "USD", "AZN", "VALUE", "WHAT", "WITH", "YTD",
  // Finance vocabulary and initialisms adjacent to real tickers.
  "E", "P", "S", "SEC", "TTM", "TWR"
]);

const V3_DIRECT_SP500_ETF_ALIAS =
  /\b(?:s\s*&\s*p|standard\s*&\s*poor(?:'s)?)\s*500\s+(?:index\s+)?ETF\b/iu;

export function v3DirectTickerCandidates(query: string): readonly string[] {
  const tagged = [
    ...query.matchAll(
      /\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)(?![\p{L}\p{N}_])/gu
    )
  ].map((match) => match[1]!.toUpperCase());
  const upper = [
    ...query.matchAll(
      /(?<![\p{L}\p{N}_])([A-Z]{1,5}(?:\.[A-Z])?)(?![\p{L}\p{N}_])/gu
    )
  ]
    .map((match) => match[1]!)
    .filter((candidate) => !V3_DIRECT_TICKER_STOP_WORDS.has(candidate));
  const explicitA =
    /^(?:resolve|analy[sz]e|research)\s+A\b/u.test(query) ||
    /\b(?:ticker|symbol)\s*(?::|is)?\s*A\b/u.test(query) ||
    /\bA(?:['’]s)?\s+(?:price|quote|stock|share|market\s+cap|p\/?e|dividend|yield|risk|volatility|listing|exchange)\b/u
      .test(query) ||
    /\b(?:is|does)\s+A\s+(?:listed|trade|pay)\b/u.test(query);
  return Object.freeze([
    ...new Set([...tagged, ...upper, ...(explicitA ? ["A"] : [])])
  ]);
}

/**
 * Resolves the deliberately narrow aliases permitted by direct Studio
 * two-instrument research comparisons. `SPY` is the reviewed development
 * proxy for an explicitly named S&P 500 ETF, matching the customer router.
 *
 * This does not perform general entity resolution: the comparison marker,
 * exact benchmark phrase, and exactly two distinct resulting symbols are all
 * required. Extra or unresolved instruments therefore fail closed.
 */
export function v3DirectResearchComparisonSymbols(
  query: string
): readonly string[] | null {
  const normalized = query.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    normalized.length === 0 ||
    !analyzeV3SemanticFrame(normalized).securityComparison
  ) {
    return null;
  }
  const hasReviewedBenchmarkAlias = V3_DIRECT_SP500_ETF_ALIAS.test(normalized);
  const explicitSymbols = [
    ...v3DirectTickerCandidates(
      hasReviewedBenchmarkAlias
        ? normalized.replace(V3_DIRECT_SP500_ETF_ALIAS, " ")
        : normalized
    )
  ];
  if (hasReviewedBenchmarkAlias) {
    if (explicitSymbols.length !== 1 || explicitSymbols[0] === "SPY") {
      return null;
    }
    return Object.freeze([explicitSymbols[0]!, "SPY"]);
  }
  return explicitSymbols.length === 2
    ? Object.freeze(explicitSymbols)
    : null;
}

export function v3ExactDirectTicker(query: string): string | null {
  const candidates = v3DirectTickerCandidates(query);
  return candidates.length === 1 ? candidates[0]! : null;
}
