import { describe, expect, it, vi } from "vitest";
import { MarketDataError, YahooMarketDataProvider } from "../src/services/market-data.js";

describe("YahooMarketDataProvider", () => {
  it("normalizes a current quote and caches it", async () => {
    const now = 1_700_000_600_000;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: {
                  symbol: "AAPL",
                  longName: "Apple Inc.",
                  currency: "USD",
                  fullExchangeName: "NasdaqGS",
                  instrumentType: "EQUITY",
                  regularMarketPrice: 200,
                  previousClose: 196,
                  regularMarketTime: 1_700_000_000,
                  currentTradingPeriod: {
                    regular: { start: 1_699_999_000, end: 1_700_001_000 }
                  },
                  exchangeDataDelayedBy: 0
                }
              }
            ],
            error: null
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const provider = new YahooMarketDataProvider({
      fetchImpl: fetchMock,
      now: () => now,
      cacheMs: 30_000
    });

    const first = await provider.getSnapshot("aapl");
    const second = await provider.getSnapshot("AAPL");

    expect(first).toMatchObject({
      symbol: "AAPL",
      price: 200,
      previousClose: 196,
      change: 4,
      freshness: "live",
      marketState: "OPEN"
    });
    expect(first.changePercent).toBeCloseTo(2.0408, 3);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe symbols before making a request", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const provider = new YahooMarketDataProvider({ fetchImpl: fetchMock });

    await expect(provider.getSnapshot("AAPL/../../secret")).rejects.toBeInstanceOf(
      MarketDataError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches an arbitrary safe ticker such as INTC after normalization", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(new URL(String(input)).pathname).toBe("/v8/finance/chart/INTC");
      return new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: {
                  symbol: "INTC",
                  longName: "Intel Corporation",
                  currency: "USD",
                  fullExchangeName: "NasdaqGS",
                  instrumentType: "EQUITY",
                  regularMarketPrice: 97.06,
                  previousClose: 95.04,
                  regularMarketTime: 1_700_000_000,
                  exchangeDataDelayedBy: 0
                }
              }
            ],
            error: null
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const provider = new YahooMarketDataProvider({
      fetchImpl: fetchMock,
      now: () => 1_700_000_600_000
    });

    await expect(provider.getSnapshot(" intc ")).resolves.toMatchObject({
      symbol: "INTC",
      displayName: "Intel Corporation",
      price: 97.06
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds the successful-quote cache for arbitrary ticker requests", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const symbol = new URL(String(input)).pathname.split("/").at(-1) as string;
      return new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: {
                  symbol,
                  regularMarketPrice: 100,
                  regularMarketTime: 1_700_000_000
                }
              }
            ],
            error: null
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    const provider = new YahooMarketDataProvider({
      fetchImpl: fetchMock,
      now: () => 1_700_000_600_000,
      cacheMs: 30_000,
      maxCacheEntries: 1
    });

    await provider.getSnapshot("INTC");
    await provider.getSnapshot("MSFT");
    await provider.getSnapshot("INTC");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not fabricate a timestamp, currency, or market state", async () => {
    const missingTimestamp = new YahooMarketDataProvider({
      fetchImpl: vi.fn(async () => Response.json({
        chart: {
          result: [{ meta: { symbol: "INTC", regularMarketPrice: 97.06 } }],
          error: null
        }
      })) as unknown as typeof fetch
    });
    await expect(missingTimestamp.getSnapshot("INTC")).rejects.toMatchObject({
      message: "Market data provider returned no valid quote timestamp",
      statusCode: 502
    });

    const unknownMetadata = new YahooMarketDataProvider({
      fetchImpl: vi.fn(async () => Response.json({
        chart: {
          result: [{
            meta: {
              symbol: "INTC",
              regularMarketPrice: 97.06,
              regularMarketTime: 1_700_000_000
            }
          }],
          error: null
        }
      })) as unknown as typeof fetch,
      now: () => 1_700_000_600_000
    });
    await expect(unknownMetadata.getSnapshot("INTC")).resolves.toMatchObject({
      currency: "Unknown",
      marketState: "UNKNOWN"
    });
  });

  it("maps provider not-found, rate-limit, and invalid JSON responses explicitly", async () => {
    const notFound = new YahooMarketDataProvider({
      fetchImpl: vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch
    });
    const rateLimited = new YahooMarketDataProvider({
      fetchImpl: vi.fn(async () => new Response(null, { status: 429 })) as unknown as typeof fetch
    });
    const invalidJson = new YahooMarketDataProvider({
      fetchImpl: vi.fn(async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch
    });

    await expect(notFound.getSnapshot("ZZZZ")).rejects.toMatchObject({ statusCode: 404 });
    await expect(rateLimited.getSnapshot("INTC")).rejects.toMatchObject({ statusCode: 503 });
    await expect(invalidJson.getSnapshot("INTC")).rejects.toMatchObject({
      message: "Market data provider returned invalid data",
      statusCode: 502
    });
  });
});
