const TICKER_STOPWORDS = new Set([
  "A",
  "AI",
  "ABB",
  "API",
  "BUY",
  "CAN",
  "DETERMINISTIC",
  "EPS",
  "ETF",
  "ETFS",
  "EUR",
  "GBP",
  "HOLD",
  "I",
  "LLM",
  "MAX",
  "MVP",
  "NASDAQ",
  "NYSE",
  "PE",
  "PNL",
  "RSI",
  "SELL",
  "USD"
]);

export function normalizeChartSymbol(value) {
  const symbol = String(value || "").trim().replace(/^\$/, "").toUpperCase();
  if (
    symbol.length < 1 ||
    symbol.length > 15 ||
    TICKER_STOPWORDS.has(symbol) ||
    !/[A-Z0-9]/.test(symbol) ||
    !/^[A-Z0-9.^=-]+$/.test(symbol)
  ) {
    return null;
  }
  return symbol;
}
