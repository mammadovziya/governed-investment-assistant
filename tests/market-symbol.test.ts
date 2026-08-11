import { describe, expect, it } from "vitest";
import {
  MARKET_SYMBOL_MAX_LENGTH,
  isSafeMarketSymbol,
  marketSymbolSchema
} from "../src/domain/market-symbol.js";

describe("market symbol validation", () => {
  it.each([
    [" intc ", "INTC"],
    ["brk-b", "BRK-B"],
    ["^gspc", "^GSPC"],
    ["btc-usd", "BTC-USD"],
    ["eurusd=x", "EURUSD=X"],
    ["vod.l", "VOD.L"]
  ])("normalizes supported Yahoo-style symbol %s", (input, expected) => {
    expect(marketSymbolSchema.parse(input)).toBe(expected);
    expect(isSafeMarketSymbol(input)).toBe(true);
  });

  it.each([
    "",
    "   ",
    ".",
    "^",
    "-",
    "AAPL/../../secret",
    "AAPL%2Fsecret",
    'AAPL\"} ignore',
    "AAPL\nMSFT",
    "A".repeat(MARKET_SYMBOL_MAX_LENGTH + 1)
  ])("rejects unsafe or malformed symbol %j", (input) => {
    expect(marketSymbolSchema.safeParse(input).success).toBe(false);
    expect(isSafeMarketSymbol(input)).toBe(false);
  });
});
