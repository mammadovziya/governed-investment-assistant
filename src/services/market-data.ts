import type { MarketFreshness, MarketSnapshot } from "../domain/types.js";
import {
  isSafeMarketSymbol,
  normalizeMarketSymbol
} from "../domain/market-symbol.js";

export interface MarketDataProvider {
  getSnapshot(symbol: string): Promise<MarketSnapshot>;
}

interface YahooChartMeta {
  symbol?: string;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  instrumentType?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  exchangeDataDelayedBy?: number;
  longName?: string;
  shortName?: string;
  marketState?: string;
  currentTradingPeriod?: {
    pre?: YahooTradingPeriod;
    regular?: YahooTradingPeriod;
    post?: YahooTradingPeriod;
  };
}

interface YahooTradingPeriod {
  start?: number;
  end?: number;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{ meta?: YahooChartMeta }>;
    error?: { code?: string; description?: string } | null;
  };
}

interface CachedQuote {
  snapshot: MarketSnapshot;
  expiresAt: number;
}

export interface YahooProviderOptions {
  cacheMs?: number;
  maxCacheEntries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class YahooMarketDataProvider implements MarketDataProvider {
  private readonly cache = new Map<string, CachedQuote>();
  private readonly cacheMs: number;
  private readonly maxCacheEntries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: YahooProviderOptions = {}) {
    this.cacheMs = options.cacheMs ?? 30_000;
    const configuredCacheEntries = options.maxCacheEntries ?? 500;
    this.maxCacheEntries =
      Number.isFinite(configuredCacheEntries) && configuredCacheEntries >= 1
        ? Math.floor(configuredCacheEntries)
        : 500;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getSnapshot(rawSymbol: string): Promise<MarketSnapshot> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!isSafeMarketSymbol(symbol)) {
      throw new MarketDataError("Unsupported instrument symbol", 400);
    }

    const cached = this.cache.get(symbol);
    if (cached && cached.expiresAt > this.now()) return cached.snapshot;

    const url = new URL(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    );
    url.searchParams.set("interval", "1m");
    url.searchParams.set("range", "1d");

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: "application/json",
          "user-agent": "Governed-Investment-Assistant/0.1"
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new MarketDataError(
        error instanceof Error && error.name === "TimeoutError"
          ? "Market data request timed out"
          : "Market data provider is unavailable",
        503
      );
    }

    if (response.status === 404) {
      throw new MarketDataError(`No current quote was found for ${symbol}`, 404);
    }
    if (response.status === 429) {
      throw new MarketDataError("Market data provider rate limit was reached", 503);
    }
    if (!response.ok) {
      throw new MarketDataError(`Market data provider returned ${response.status}`, 502);
    }

    let body: YahooChartResponse;
    try {
      body = (await response.json()) as YahooChartResponse;
    } catch {
      throw new MarketDataError("Market data provider returned invalid data", 502);
    }
    const providerError = body.chart?.error;
    if (providerError) {
      const description = providerError.description || "Market data error";
      const notFound = /not found|no data/i.test(
        `${providerError.code ?? ""} ${description}`
      );
      throw new MarketDataError(description, notFound ? 404 : 502);
    }

    const meta = body.chart?.result?.[0]?.meta;
    if (
      !meta ||
      typeof meta.regularMarketPrice !== "number" ||
      !Number.isFinite(meta.regularMarketPrice) ||
      meta.regularMarketPrice <= 0
    ) {
      throw new MarketDataError(`No current quote was found for ${symbol}`, 404);
    }

    if (
      typeof meta.regularMarketTime !== "number" ||
      !Number.isFinite(meta.regularMarketTime) ||
      meta.regularMarketTime <= 0
    ) {
      throw new MarketDataError("Market data provider returned no valid quote timestamp", 502);
    }

    const rawPreviousClose = meta.previousClose ?? meta.chartPreviousClose;
    const previousClose =
      typeof rawPreviousClose === "number" &&
      Number.isFinite(rawPreviousClose) &&
      rawPreviousClose > 0
        ? rawPreviousClose
        : null;
    const change = previousClose === null ? null : meta.regularMarketPrice - previousClose;
    const changePercent =
      change === null || previousClose === null || previousClose === 0
        ? null
        : (change / previousClose) * 100;
    const delayMinutes =
      typeof meta.exchangeDataDelayedBy === "number" &&
      Number.isFinite(meta.exchangeDataDelayedBy)
        ? Math.max(0, meta.exchangeDataDelayedBy)
        : 0;
    const asOfMs = meta.regularMarketTime * 1_000;
    const ageMinutes = Math.max(0, Math.floor((this.now() - asOfMs) / 60_000));
    const freshness = this.resolveFreshness(delayMinutes, ageMinutes);
    const marketState = this.resolveMarketState(meta);

    const snapshot: MarketSnapshot = {
      symbol: meta.symbol ?? symbol,
      displayName: meta.longName ?? meta.shortName ?? meta.symbol ?? symbol,
      currency: nonEmptyString(meta.currency) ?? "Unknown",
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? "Unknown exchange",
      instrumentType: meta.instrumentType ?? "Unknown",
      price: meta.regularMarketPrice,
      previousClose,
      change,
      changePercent,
      marketState,
      freshness,
      delayMinutes,
      asOf: new Date(asOfMs).toISOString(),
      source: "Yahoo Finance chart endpoint",
      notice: this.noticeFor(freshness, delayMinutes)
    };

    this.cacheSnapshot(symbol, snapshot);
    return snapshot;
  }

  private cacheSnapshot(symbol: string, snapshot: MarketSnapshot): void {
    const now = this.now();
    for (const [cachedSymbol, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(cachedSymbol);
    }

    // Keep arbitrary-but-valid requests from growing the process cache without bound.
    this.cache.delete(symbol);
    while (this.cache.size >= this.maxCacheEntries) {
      const oldestSymbol = this.cache.keys().next().value as string | undefined;
      if (oldestSymbol === undefined) break;
      this.cache.delete(oldestSymbol);
    }
    this.cache.set(symbol, { snapshot, expiresAt: now + this.cacheMs });
  }

  private resolveFreshness(delayMinutes: number, ageMinutes: number): MarketFreshness {
    if (ageMinutes > 24 * 60) return "stale";
    if (delayMinutes > 0) return "delayed";
    if (ageMinutes <= 15) return "live";
    return "indicative";
  }

  private resolveMarketState(meta: YahooChartMeta): MarketSnapshot["marketState"] {
    const providerState = nonEmptyString(meta.marketState)?.toUpperCase();
    if (providerState === "REGULAR" || providerState === "OPEN") return "OPEN";
    if (
      providerState === "PRE" ||
      providerState === "PREPRE" ||
      providerState === "POST" ||
      providerState === "POSTPOST" ||
      providerState === "CLOSED"
    ) {
      return "CLOSED";
    }

    const regular = meta.currentTradingPeriod?.regular;
    if (
      typeof regular?.start !== "number" ||
      !Number.isFinite(regular.start) ||
      typeof regular.end !== "number" ||
      !Number.isFinite(regular.end) ||
      regular.end <= regular.start
    ) {
      return "UNKNOWN";
    }
    const nowSeconds = this.now() / 1_000;
    return nowSeconds >= regular.start && nowSeconds < regular.end ? "OPEN" : "CLOSED";
  }

  private noticeFor(freshness: MarketFreshness, delayMinutes: number): string {
    if (freshness === "live") return "Current indicative market snapshot; not an executable quote.";
    if (freshness === "delayed") {
      return `Market data is delayed by approximately ${delayMinutes} minute(s).`;
    }
    if (freshness === "stale") return "The latest available market snapshot is stale.";
    return "Latest indicative snapshot; the market may be closed.";
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}
