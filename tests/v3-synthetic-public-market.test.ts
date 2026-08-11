import { describe, expect, it, vi } from "vitest";

import { MarketDataError } from "../src/services/market-data.js";
import {
  LiveInstrumentResolver,
  LivePriceHistoryPort
} from "../src/assistant-v3/adapters.js";
import {
  SYNTHETIC_OFFLINE_MARKET_PROVIDER,
  SyntheticOfflineMarketHistoryProvider,
  SyntheticOfflineMarketResearchProvider
} from "../src/assistant-v3/synthetic-public-market.js";

const NOW = Date.parse("2026-07-29T12:34:56.789Z");

describe("synthetic offline public-market provider", () => {
  it("returns clearly labelled deterministic quotes without network access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new SyntheticOfflineMarketResearchProvider({
      now: () => NOW
    });

    const first = await provider.getSnapshot(" nvda ");
    const second = await provider.getSnapshot("NVDA");

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      symbol: "NVDA",
      currency: "USD",
      exchange: "Synthetic US",
      instrumentType: "EQUITY",
      freshness: "indicative",
      marketState: "UNKNOWN",
      asOf: "2026-07-29T12:34:00.000Z",
      source: "Synthetic offline demo market (not live)"
    });
    expect(first.notice).toContain("not current market data");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("supports bounded generic symbols without pretending they are live", async () => {
    const provider = new SyntheticOfflineMarketResearchProvider({
      now: () => NOW
    });
    const first = await provider.getSnapshot("ACME");
    const second = await provider.getSnapshot("ACME");

    expect(first).toEqual(second);
    expect(first.displayName).toContain("synthetic");
    expect(first.price).toBeGreaterThan(0);
    await expect(provider.getSnapshot("not a ticker")).rejects.toBeInstanceOf(
      MarketDataError
    );
  });

  it("generates ordered offline history whose final point matches the quote", async () => {
    const market = new SyntheticOfflineMarketResearchProvider({
      now: () => NOW
    });
    const history = new SyntheticOfflineMarketHistoryProvider({
      now: () => NOW
    });
    const [snapshot, series] = await Promise.all([
      market.getSnapshot("AAPL"),
      history.getHistory("AAPL", "1y")
    ]);

    expect(series).toMatchObject({
      symbol: "AAPL",
      range: "1y",
      interval: "1d",
      asOf: snapshot.asOf,
      source: snapshot.source
    });
    expect(series.points).toHaveLength(252);
    expect(series.points.at(-1)?.close).toBe(snapshot.price);
    expect(
      series.points.every((point, index) =>
        index === 0 ||
        Date.parse(point.timestamp) >
          Date.parse(series.points[index - 1]!.timestamp)
      )
    ).toBe(true);
  });

  it("marks current research as unavailable instead of inventing it", async () => {
    const provider = new SyntheticOfflineMarketResearchProvider({
      now: () => NOW
    });
    const report = await provider.getResearch("QQQ");

    expect(provider.descriptor).toBe(SYNTHETIC_OFFLINE_MARKET_PROVIDER);
    expect(provider.descriptor.licenseClass).toBe("synthetic");
    expect(report.overallStatus).toBe("partial");
    expect(report.profile.sources).toEqual([
      expect.objectContaining({
        provider: "synthetic-demo",
        url: null
      })
    ]);
    expect(report.fundamentals.status).toBe("unavailable");
    expect(report.valuation.status).toBe("unavailable");
    expect(report.newsAndCatalysts.data).toEqual({
      news: [],
      catalysts: []
    });
    expect(report.notices.join(" ")).toContain("synthetic demo data");
  });

  it("preserves synthetic provenance at the boundary-tool adapters", () => {
    const market = new SyntheticOfflineMarketResearchProvider({
      now: () => NOW
    });
    const history = new SyntheticOfflineMarketHistoryProvider({
      now: () => NOW
    });
    const instrumentResolver = new LiveInstrumentResolver(market, () => NOW);
    const priceHistory = new LivePriceHistoryPort(
      history,
      market.descriptor,
      () => NOW
    );

    expect(instrumentResolver.source).toMatchObject({
      provider: "synthetic-offline-market",
      licenseClass: "synthetic"
    });
    expect(priceHistory.source).toMatchObject({
      provider: "synthetic-offline-market",
      licenseClass: "synthetic"
    });
  });
});
