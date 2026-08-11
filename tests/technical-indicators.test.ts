import { describe, expect, it } from "vitest";
import type { MarketHistorySeries } from "../src/domain/market-history.js";
import { calculateTechnicalIndicators } from "../src/services/technical-indicators.js";

function series(values: number[], range: MarketHistorySeries["range"] = "1y"): MarketHistorySeries {
  return {
    symbol: "TEST",
    range,
    interval: "1d",
    currency: "USD",
    exchange: "Test",
    asOf: new Date(Date.UTC(2026, 0, values.length)).toISOString(),
    source: "Yahoo Finance chart endpoint",
    points: values.map((close, index) => ({
      timestamp: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
      close
    }))
  };
}

describe("calculateTechnicalIndicators", () => {
  it("calculates source-traceable moving averages, RSI, return, volatility, and drawdown", () => {
    const values = Array.from({ length: 220 }, (_, index) => 100 + index * 0.5);
    const report = calculateTechnicalIndicators(series(values));

    expect(report.currency).toBe("USD");
    expect(report.observations).toBe(220);
    expect(report.indicators.find((item) => item.id === "sma20")?.value).toBe(204.75);
    expect(report.indicators.find((item) => item.id === "sma200")?.value).toBe(159.75);
    expect(report.indicators.find((item) => item.id === "rsi14")?.value).toBe(100);
    expect(report.indicators.every((item) => item.source === "computed-from-yahoo-history")).toBe(true);
  });

  it("reports unavailable long-window indicators instead of fabricating them", () => {
    const report = calculateTechnicalIndicators(series([100, 90, 95]));

    expect(report.indicators.find((item) => item.id === "sma20")?.value).toBeNull();
    expect(report.indicators.find((item) => item.id === "annualizedVolatility")?.value).toBeNull();
    expect(report.indicators.find((item) => item.id === "maximumDrawdown")?.value).toBe(10);
    expect(report.indicators.find((item) => item.id === "oneYearReturn")?.label).toBe("Period price return");
  });

  it("rejects an incompatible history range", () => {
    expect(() => calculateTechnicalIndicators(series([1, 2], "10y"))).toThrow(/one-year/i);
  });
});
