import type {
  MarketHistoryInterval,
  MarketHistoryPoint,
  MarketHistoryRange,
  MarketHistorySeries
} from "../domain/market-history.js";
import { isMarketHistoryRange } from "../domain/market-history.js";
import {
  isSafeMarketSymbol,
  normalizeMarketSymbol
} from "../domain/market-symbol.js";
import { MarketDataError } from "./market-data.js";

interface YahooHistoryMeta {
  currency?: unknown;
  exchangeName?: unknown;
  fullExchangeName?: unknown;
  regularMarketTime?: unknown;
}

interface YahooHistoryResult {
  meta?: YahooHistoryMeta;
  timestamp?: unknown;
  indicators?: {
    quote?: Array<{
      close?: unknown;
    }>;
  };
}

interface YahooHistoryResponse {
  chart?: {
    result?: YahooHistoryResult[] | null;
    error?: { code?: string; description?: string } | null;
  };
}

interface YahooRangeConfiguration {
  providerRange: string;
  interval: MarketHistoryInterval;
}

interface CachedHistory {
  series: MarketHistorySeries;
  expiresAt: number;
}

export interface MarketHistoryProvider {
  getHistory(symbol: string, range: MarketHistoryRange): Promise<MarketHistorySeries>;
}

export interface YahooHistoryProviderOptions {
  cacheMs?: number;
  maxCacheEntries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const RANGE_CONFIGURATION: Record<MarketHistoryRange, YahooRangeConfiguration> = {
  "1d": { providerRange: "1d", interval: "5m" },
  "1w": { providerRange: "5d", interval: "15m" },
  "1m": { providerRange: "1mo", interval: "1h" },
  "6m": { providerRange: "6mo", interval: "1d" },
  "1y": { providerRange: "1y", interval: "1d" },
  "5y": { providerRange: "5y", interval: "1wk" },
  "10y": { providerRange: "10y", interval: "1wk" },
  max: { providerRange: "max", interval: "1mo" }
};

const HISTORY_SOURCE = "Yahoo Finance chart endpoint" as const;

export class YahooMarketHistoryProvider implements MarketHistoryProvider {
  private readonly cache = new Map<string, CachedHistory>();
  private readonly cacheMs: number;
  private readonly maxCacheEntries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: YahooHistoryProviderOptions = {}) {
    this.cacheMs = positiveFiniteNumber(options.cacheMs, 60_000);
    const configuredCacheEntries = options.maxCacheEntries ?? 100;
    this.maxCacheEntries =
      Number.isFinite(configuredCacheEntries) && configuredCacheEntries >= 1
        ? Math.floor(configuredCacheEntries)
        : 100;
    this.timeoutMs = positiveFiniteNumber(options.timeoutMs, 7_500);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getHistory(
    rawSymbol: string,
    range: MarketHistoryRange
  ): Promise<MarketHistorySeries> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!isSafeMarketSymbol(symbol)) {
      throw new MarketDataError("Unsupported instrument symbol", 400);
    }
    if (!isMarketHistoryRange(range)) {
      throw new MarketDataError("Unsupported market history range", 400);
    }

    const cacheKey = `${symbol}:${range}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.expiresAt && cached.expiresAt > this.now()) return cached.series;
    if (cached) this.cache.delete(cacheKey);

    const configuration = RANGE_CONFIGURATION[range];
    const url = new URL(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    );
    url.searchParams.set("range", configuration.providerRange);
    url.searchParams.set("interval", configuration.interval);
    url.searchParams.set("includePrePost", "false");
    url.searchParams.set("events", "div,splits");

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: "application/json",
          // Yahoo currently rate-limits its chart endpoint for some long browser
          // signatures while accepting this minimal, truthful browser family token.
          "user-agent": "Mozilla/5.0"
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new MarketDataError(
        timedOut
          ? "Market history request timed out"
          : "Market history provider is unavailable",
        503
      );
    }

    if (response.status === 404) {
      throw new MarketDataError(`No market history was found for ${symbol}`, 404);
    }
    if (response.status === 429) {
      throw new MarketDataError("Market history provider rate limit was reached", 503);
    }
    if (!response.ok) {
      throw new MarketDataError(
        `Market history provider returned ${response.status}`,
        502
      );
    }

    let body: YahooHistoryResponse;
    try {
      body = (await response.json()) as YahooHistoryResponse;
    } catch {
      throw new MarketDataError("Market history provider returned invalid data", 502);
    }

    const providerError = body.chart?.error;
    if (providerError) {
      const description = providerError.description || "Market history provider error";
      const notFound = /not found|no data/i.test(
        `${providerError.code ?? ""} ${description}`
      );
      throw new MarketDataError(description, notFound ? 404 : 502);
    }

    const result = body.chart?.result?.[0];
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
      ? result.indicators.quote[0].close
      : [];
    const points = normalizePoints(timestamps, closes);

    if (points.length === 0) {
      throw new MarketDataError(`No market history was found for ${symbol}`, 404);
    }

    const finalPoint = points.at(-1);
    if (!finalPoint) {
      throw new MarketDataError(`No market history was found for ${symbol}`, 404);
    }

    const series: MarketHistorySeries = {
      symbol,
      range,
      interval: configuration.interval,
      currency: nonEmptyString(result?.meta?.currency) ?? "Unknown",
      exchange:
        nonEmptyString(result?.meta?.fullExchangeName) ??
        nonEmptyString(result?.meta?.exchangeName) ??
        "Unknown exchange",
      asOf: resolveSeriesAsOf(
        result?.meta?.regularMarketTime,
        finalPoint.timestamp,
        this.now()
      ),
      source: HISTORY_SOURCE,
      points
    };

    this.cacheSeries(cacheKey, series);
    return series;
  }

  private cacheSeries(cacheKey: string, series: MarketHistorySeries): void {
    const now = this.now();
    for (const [cachedKey, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(cachedKey);
    }

    this.cache.delete(cacheKey);
    while (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, { series, expiresAt: now + this.cacheMs });
  }
}

function normalizePoints(timestamps: unknown[], closes: unknown[]): MarketHistoryPoint[] {
  const pointsByTimestamp = new Map<number, MarketHistoryPoint>();

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const close = closes[index];
    if (
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      typeof close !== "number" ||
      !Number.isFinite(close) ||
      close <= 0
    ) {
      continue;
    }

    const timestampMs = timestamp * 1_000;
    if (!Number.isFinite(timestampMs)) continue;
    const date = new Date(timestampMs);
    if (!Number.isFinite(date.getTime())) continue;

    pointsByTimestamp.set(timestamp, {
      timestamp: date.toISOString(),
      close
    });
  }

  return [...pointsByTimestamp.entries()]
    .sort(([leftTimestamp], [rightTimestamp]) => leftTimestamp - rightTimestamp)
    .map(([, point]) => point);
}

function resolveSeriesAsOf(
  rawRegularMarketTime: unknown,
  finalPointTimestamp: string,
  nowMs: number
): string {
  if (
    typeof rawRegularMarketTime !== "number" ||
    !Number.isFinite(rawRegularMarketTime) ||
    rawRegularMarketTime <= 0
  ) {
    return finalPointTimestamp;
  }
  const providerMs = rawRegularMarketTime * 1_000;
  const finalPointMs = Date.parse(finalPointTimestamp);
  if (
    !Number.isFinite(providerMs) ||
    !Number.isFinite(finalPointMs) ||
    providerMs < finalPointMs ||
    providerMs > nowMs + 5 * 60_000
  ) {
    return finalPointTimestamp;
  }
  return new Date(providerMs).toISOString();
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveFiniteNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export const marketHistoryData = new YahooMarketHistoryProvider();
