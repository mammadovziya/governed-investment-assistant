import { describe, expect, it } from "vitest";
import { normalizeChartSymbol } from "../public/market-symbols.js";

describe("browser chart symbol selection", () => {
  it("rejects educational and non-instrument tokens", () => {
    expect(normalizeChartSymbol("RSI")).toBeNull();
    expect(normalizeChartSymbol("EPS")).toBeNull();
    expect(normalizeChartSymbol("ETF")).toBeNull();
    expect(normalizeChartSymbol("not a ticker")).toBeNull();
  });

  it("normalizes explicit chart symbols", () => {
    expect(normalizeChartSymbol("nvda")).toBe("NVDA");
    expect(normalizeChartSymbol("$aapl")).toBe("AAPL");
    expect(normalizeChartSymbol("BRK-B")).toBe("BRK-B");
  });
});
