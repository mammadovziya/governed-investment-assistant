import { describe, expect, it, vi } from "vitest";

import type { MarketSnapshot } from "../src/domain/types.js";
import {
  V3DashboardPortfolioAdapter,
  type V3DashboardMarketPort
} from "../src/assistant-v3/dashboard-portfolio.js";
import { mockPortfolioSnapshot } from "../src/assistant-v3/mock-portfolio.js";

const quotePrices = new Map([
  ["AAPL", { price: 230, previousClose: 228, change: 2 }],
  ["NVDA", { price: 170, previousClose: 173, change: -3 }],
  ["BND", { price: 74, previousClose: 73.5, change: 0.5 }]
]);

function marketFixture(): V3DashboardMarketPort & { getSnapshot: ReturnType<typeof vi.fn> } {
  const getSnapshot = vi.fn(async (symbol: string): Promise<MarketSnapshot> => {
    const values = quotePrices.get(symbol);
    if (!values) throw new Error("unsupported test symbol");
    return {
      symbol,
      displayName: mockPortfolioSnapshot.instrumentMetadata.find(
        (metadata) => metadata.symbol === symbol
      )?.displayName ?? symbol,
      currency: "USD",
      exchange: "Test",
      instrumentType: symbol === "BND" ? "ETF" : "EQUITY",
      price: values.price,
      previousClose: values.previousClose,
      change: values.change,
      changePercent: values.change / values.previousClose * 100,
      marketState: "CLOSED",
      freshness: "indicative",
      delayMinutes: 0,
      asOf: "2026-07-22T12:00:00.000Z",
      source: "V3 live market test adapter",
      notice: "Informational snapshot"
    };
  });
  return { getSnapshot };
}

describe("V3 dashboard portfolio adapter", () => {
  it("presents the exact V3 fixture holdings and live-quote summary", async () => {
    const market = marketFixture();
    const adapter = new V3DashboardPortfolioAdapter(market);

    const client = adapter.getClient();
    const summary = await adapter.getSummary();

    expect(client).toMatchObject({
      id: "mock-client-001",
      baseCurrency: mockPortfolioSnapshot.baseCurrency,
      isMock: true
    });
    expect(summary.clientId).toBe("mock-client-001");
    expect(summary.holdings.map(({ symbol, quantity }) => ({ symbol, quantity }))).toEqual([
      { symbol: "AAPL", quantity: 12 },
      { symbol: "NVDA", quantity: 15 },
      { symbol: "BND", quantity: 30 }
    ]);
    expect(summary.cash).toEqual([{ currency: "USD", amount: 2_506 }]);
    expect(summary.positionsValue).toBe(7_530);
    expect(summary.cashValue).toBe(2_506);
    expect(summary.coveredValue).toBe(10_036);
    expect(summary.unrealizedPnl).toBe(1_409);
    expect(summary.dayChangeValue).toBe(-6);
    expect(summary.coverageComplete).toBe(true);
    expect(market.getSnapshot.mock.calls.map(([symbol]) => symbol).sort()).toEqual([
      "AAPL",
      "BND",
      "NVDA"
    ]);
  });

  it("capitalizes the V3 AAPL buy fee into open-lot basis before presentation", async () => {
    const adapter = new V3DashboardPortfolioAdapter(marketFixture());

    const summary = await adapter.getSummary();
    const aapl = summary.holdings.find(({ symbol }) => symbol === "AAPL");

    // 10 × 180 + 2 × 210 + the USD 1 buy fee = USD 2,221.
    expect(aapl).toMatchObject({
      quantity: 12,
      costBasis: 2_221,
      averageCost: 185.08333333,
      marketValue: 2_760,
      unrealizedPnl: 539
    });
    expect(summary.costBasis).toBe(6_121);
    expect(summary.unrealizedPnlPercent).toBe(23.02);
  });

  it("fails closed per quote and reports incomplete covered value", async () => {
    const market = marketFixture();
    market.getSnapshot.mockRejectedValueOnce(new Error("provider unavailable"));
    const adapter = new V3DashboardPortfolioAdapter(market);

    const summary = await adapter.getSummary();

    expect(summary.coverageComplete).toBe(false);
    expect(summary.pricedHoldings).toBe(2);
    expect(summary.holdings.find(({ symbol }) => symbol === "AAPL")?.marketValue).toBeNull();
    expect(summary.coveredValue).toBe(7_276);
    expect(summary.notices.at(-1)).toContain("1 holding(s) could not be priced");
  });
});
