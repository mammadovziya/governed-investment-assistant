import { z } from "zod";

export const MARKET_SYMBOL_MAX_LENGTH = 15;

// Covers the public-symbol forms used by Yahoo's chart endpoint, including
// BRK-B, ^GSPC, BTC-USD, EURUSD=X, and exchange suffixes such as VOD.L.
// Requiring an alphanumeric character also rejects punctuation-only inputs.
export const MARKET_SYMBOL_PATTERN = /^(?=.*[A-Z0-9])[A-Z0-9.^=-]+$/;

export function normalizeMarketSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function isSafeMarketSymbol(symbol: string): boolean {
  const normalized = normalizeMarketSymbol(symbol);
  return (
    normalized.length >= 1 &&
    normalized.length <= MARKET_SYMBOL_MAX_LENGTH &&
    MARKET_SYMBOL_PATTERN.test(normalized)
  );
}

export const marketSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(MARKET_SYMBOL_MAX_LENGTH)
  .regex(MARKET_SYMBOL_PATTERN, {
    message: "Symbol may only use letters, numbers, '.', '^', '=', or '-'"
  })
  .describe("Public instrument ticker such as INTC, BRK-B, ^GSPC, or EURUSD=X");
