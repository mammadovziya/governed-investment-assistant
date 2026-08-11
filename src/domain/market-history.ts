export const MARKET_HISTORY_RANGES = [
  "1d",
  "1w",
  "1m",
  "6m",
  "1y",
  "5y",
  "10y",
  "max"
] as const;

export type MarketHistoryRange = (typeof MARKET_HISTORY_RANGES)[number];

export type MarketHistoryInterval = "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";

export interface MarketHistoryPoint {
  timestamp: string;
  close: number;
}

export interface MarketHistorySeries {
  symbol: string;
  range: MarketHistoryRange;
  interval: MarketHistoryInterval;
  currency: string;
  exchange: string;
  asOf: string;
  /** Human-readable provenance label supplied by the selected provider. */
  source: string;
  points: MarketHistoryPoint[];
}

export function isMarketHistoryRange(value: unknown): value is MarketHistoryRange {
  return (
    typeof value === "string" &&
    (MARKET_HISTORY_RANGES as readonly string[]).includes(value)
  );
}
