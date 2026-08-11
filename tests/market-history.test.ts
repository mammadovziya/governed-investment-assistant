import { describe, expect, it, vi } from "vitest";
import type { MarketHistoryRange } from "../src/domain/market-history.js";
import type { MarketDataError } from "../src/services/market-data.js";
import { YahooMarketHistoryProvider } from "../src/services/market-history.js";

function yahooHistoryResponse(
  timestamps: unknown[] = [1_700_000_000],
  closes: unknown[] = [50],
  meta: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      chart: {
        result: [
          {
            meta: {
              currency: "USD",
              fullExchangeName: "NasdaqGS",
              ...meta
            },
            timestamp: timestamps,
            indicators: { quote: [{ close: closes }] }
          }
        ],
        error: null
      }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("YahooMarketHistoryProvider", () => {
  it("requests a practical weekly 10-year series and normalizes partial data", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.host).toBe("query2.finance.yahoo.com");
      expect(url.pathname).toBe("/v8/finance/chart/INTC");
      expect(url.searchParams.get("range")).toBe("10y");
      expect(url.searchParams.get("interval")).toBe("1wk");
      expect(url.searchParams.get("includePrePost")).toBe("false");
      expect(url.searchParams.get("events")).toBe("div,splits");
      expect(url.searchParams.has("includeAdjustedClose")).toBe(false);
      expect(new Headers(init?.headers).get("user-agent")).toBe("Mozilla/5.0");
      return yahooHistoryResponse(
        [1_700_000_200, 1_700_000_000, 1_700_000_100, 1_700_000_100, null, "bad"],
        [52, 50, null, 51, 55, 56],
        { regularMarketTime: 1_700_000_300 }
      );
    }) as unknown as typeof fetch;
    const provider = new YahooMarketHistoryProvider({ fetchImpl: fetchMock });

    const history = await provider.getHistory(" intc ", "10y");

    expect(history).toEqual({
      symbol: "INTC",
      range: "10y",
      interval: "1wk",
      currency: "USD",
      exchange: "NasdaqGS",
      asOf: new Date(1_700_000_300_000).toISOString(),
      source: "Yahoo Finance chart endpoint",
      points: [
        { timestamp: new Date(1_700_000_000_000).toISOString(), close: 50 },
        { timestamp: new Date(1_700_000_100_000).toISOString(), close: 51 },
        { timestamp: new Date(1_700_000_200_000).toISOString(), close: 52 }
      ]
    });
  });

  it.each([
    ["1d", "1d", "5m"],
    ["1w", "5d", "15m"],
    ["1m", "1mo", "1h"],
    ["6m", "6mo", "1d"],
    ["1y", "1y", "1d"],
    ["5y", "5y", "1wk"],
    ["10y", "10y", "1wk"],
    ["max", "max", "1mo"]
  ] as const)(
    "maps the %s range to Yahoo range=%s and interval=%s",
    async (range, providerRange, interval) => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("range")).toBe(providerRange);
        expect(url.searchParams.get("interval")).toBe(interval);
        return yahooHistoryResponse();
      }) as unknown as typeof fetch;
      const provider = new YahooMarketHistoryProvider({ fetchImpl: fetchMock });

      await expect(provider.getHistory("AAPL", range)).resolves.toMatchObject({
        range,
        interval
      });
    }
  );

  it("rejects unsafe symbols and unsupported ranges before fetching", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const provider = new YahooMarketHistoryProvider({ fetchImpl: fetchMock });

    await expect(provider.getHistory("AAPL/../../secret", "10y")).rejects.toMatchObject({
      statusCode: 400
    });
    await expect(
      provider.getHistory("AAPL", "2y" as MarketHistoryRange)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an explicit not-found error when all chart values are null", async () => {
    const fetchMock = vi.fn(async () =>
      yahooHistoryResponse([1_700_000_000, 1_700_000_100], [null, null])
    ) as unknown as typeof fetch;
    const provider = new YahooMarketHistoryProvider({ fetchImpl: fetchMock });

    await expect(provider.getHistory("INTC", "10y")).rejects.toEqual(
      expect.objectContaining<Partial<MarketDataError>>({
        message: "No market history was found for INTC",
        statusCode: 404
      })
    );
  });

  it("uses explicit unknown currency instead of assuming USD", async () => {
    const fetchMock = vi.fn(async () =>
      yahooHistoryResponse([1_700_000_000], [50], { currency: null })
    ) as unknown as typeof fetch;
    const provider = new YahooMarketHistoryProvider({ fetchImpl: fetchMock });

    await expect(provider.getHistory("INTC", "1y")).resolves.toMatchObject({
      currency: "Unknown"
    });
  });

  it("maps rate limits and timeouts to explicit service errors", async () => {
    const rateLimitedProvider = new YahooMarketHistoryProvider({
      fetchImpl: vi.fn(async () => new Response(null, { status: 429 })) as unknown as typeof fetch
    });
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const timedOutProvider = new YahooMarketHistoryProvider({
      fetchImpl: vi.fn(async () => {
        throw timeout;
      }) as unknown as typeof fetch
    });

    await expect(rateLimitedProvider.getHistory("INTC", "10y")).rejects.toMatchObject({
      message: "Market history provider rate limit was reached",
      statusCode: 503
    });
    await expect(timedOutProvider.getHistory("INTC", "10y")).rejects.toMatchObject({
      message: "Market history request timed out",
      statusCode: 503
    });
  });

  it("caches successful series and bounds arbitrary symbol-range entries", async () => {
    const fetchMock = vi.fn(async () => yahooHistoryResponse()) as unknown as typeof fetch;
    const provider = new YahooMarketHistoryProvider({
      fetchImpl: fetchMock,
      cacheMs: 60_000,
      maxCacheEntries: 1,
      now: () => 1_700_000_500_000
    });

    const first = await provider.getHistory("AAPL", "10y");
    await expect(provider.getHistory("AAPL", "10y")).resolves.toBe(first);
    await provider.getHistory("MSFT", "10y");
    await provider.getHistory("AAPL", "10y");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
