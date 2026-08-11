import type {
  MarketHistoryInterval,
  MarketHistoryRange,
  MarketHistorySeries
} from "../domain/market-history.js";
import { isMarketHistoryRange } from "../domain/market-history.js";
import {
  isSafeMarketSymbol,
  normalizeMarketSymbol
} from "../domain/market-symbol.js";
import type {
  SecurityCompanyProfile,
  SecurityNewsAndCatalysts,
  SecurityResearchIssue,
  SecurityResearchReport,
  SecurityResearchSection
} from "../domain/security-research.js";
import type { MarketSnapshot } from "../domain/types.js";
import { MarketDataError } from "../services/market-data.js";
import type { MarketHistoryProvider } from "../services/market-history.js";
import type {
  PublicMarketResearchPort,
  PublicProviderDescriptor
} from "./providers.js";

const SYNTHETIC_SOURCE = "Synthetic offline demo market (not live)" as const;
const SYNTHETIC_RESEARCH_PROVIDER = "synthetic-demo" as const;

/**
 * This provider is project-authored test data. It is deliberately classified
 * as synthetic rather than production-approved so readiness can never mistake
 * a successful demo quote for licensed customer market data.
 */
export const SYNTHETIC_OFFLINE_MARKET_PROVIDER: PublicProviderDescriptor =
  Object.freeze({
    id: "synthetic-offline-market",
    displayName: "Synthetic offline demo market",
    licenseClass: "synthetic",
    allowedEnvironments: Object.freeze(["development", "test"] as const),
    attributionRequired: false
  });

interface SyntheticInstrumentDefinition {
  readonly displayName: string;
  readonly instrumentType: "EQUITY" | "ETF" | "BOND";
  readonly currency: string;
  readonly exchange: string;
  readonly referencePrice: number;
}

const SYNTHETIC_INSTRUMENTS: Readonly<
  Record<string, SyntheticInstrumentDefinition>
> = Object.freeze({
  AAPL: {
    displayName: "Apple Inc. · synthetic demo",
    instrumentType: "EQUITY",
    currency: "USD",
    exchange: "Synthetic US",
    referencePrice: 212.45
  },
  BND: {
    displayName: "US Bond Market ETF · synthetic demo",
    instrumentType: "ETF",
    currency: "USD",
    exchange: "Synthetic US",
    referencePrice: 73.18
  },
  MSFT: {
    displayName: "Microsoft Corporation · synthetic demo",
    instrumentType: "EQUITY",
    currency: "USD",
    exchange: "Synthetic US",
    referencePrice: 487.32
  },
  NVDA: {
    displayName: "NVIDIA Corporation · synthetic demo",
    instrumentType: "EQUITY",
    currency: "USD",
    exchange: "Synthetic US",
    referencePrice: 174.66
  },
  QQQ: {
    displayName: "Nasdaq-100 ETF · synthetic demo",
    instrumentType: "ETF",
    currency: "USD",
    exchange: "Synthetic US",
    referencePrice: 552.14
  },
  SPY: {
    displayName: "Large-cap US ETF · synthetic demo",
    instrumentType: "ETF",
    currency: "USD",
    exchange: "Synthetic US",
    referencePrice: 628.41
  },
  TSLA: {
    displayName: "Tesla, Inc. · synthetic demo",
    instrumentType: "EQUITY",
    currency: "USD",
    exchange: "Synthetic US",
    referencePrice: 321.77
  },
  VOO: {
    displayName: "Large-cap US index ETF · synthetic demo",
    instrumentType: "ETF",
    currency: "USD",
    exchange: "Synthetic US",
    referencePrice: 578.62
  }
});

interface SyntheticProviderOptions {
  now?: () => number;
}

interface RangeShape {
  readonly interval: MarketHistoryInterval;
  readonly points: number;
  readonly stepMs: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const RANGE_SHAPES: Readonly<Record<MarketHistoryRange, RangeShape>> =
  Object.freeze({
    "1d": { interval: "5m", points: 79, stepMs: 5 * MINUTE_MS },
    "1w": { interval: "15m", points: 131, stepMs: 15 * MINUTE_MS },
    "1m": { interval: "1h", points: 143, stepMs: 60 * MINUTE_MS },
    "6m": { interval: "1d", points: 130, stepMs: DAY_MS },
    "1y": { interval: "1d", points: 252, stepMs: DAY_MS },
    "5y": { interval: "1wk", points: 260, stepMs: 7 * DAY_MS },
    "10y": { interval: "1wk", points: 520, stepMs: 7 * DAY_MS },
    max: { interval: "1mo", points: 360, stepMs: 30 * DAY_MS }
  });

function normalizedSymbol(rawSymbol: string): string {
  const symbol = normalizeMarketSymbol(rawSymbol);
  if (!isSafeMarketSymbol(symbol)) {
    throw new MarketDataError("Unsupported instrument symbol", 400);
  }
  return symbol;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function generatedInstrument(symbol: string): SyntheticInstrumentDefinition {
  const known = SYNTHETIC_INSTRUMENTS[symbol];
  if (known) return known;
  return {
    displayName: `${symbol} demo instrument · synthetic`,
    instrumentType: "EQUITY",
    currency: "USD",
    exchange: "Synthetic Market",
    referencePrice: roundPrice(25 + (stableHash(symbol) % 47_500) / 100)
  };
}

function roundedAsOf(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Synthetic provider clock returned an invalid timestamp.");
  }
  return Math.floor(value / MINUTE_MS) * MINUTE_MS;
}

function syntheticChangePercent(symbol: string): number {
  const basisPoints = (stableHash(`${symbol}:change`) % 501) - 250;
  return basisPoints === 0 ? 0.17 : basisPoints / 100;
}

function unavailableIssue(): SecurityResearchIssue {
  return {
    provider: SYNTHETIC_RESEARCH_PROVIDER,
    code: "INSUFFICIENT_DATA",
    message:
      "The offline demo provider does not contain current issuer research, fundamentals, estimates, or news.",
    retryable: false,
    httpStatus: null
  };
}

function unavailableSection<T>(
  unavailableFields: string[]
): SecurityResearchSection<T> {
  return {
    status: "unavailable",
    data: null,
    sources: [],
    unavailableFields,
    issues: [unavailableIssue()]
  };
}

export class SyntheticOfflineMarketResearchProvider
  implements PublicMarketResearchPort
{
  readonly descriptor = SYNTHETIC_OFFLINE_MARKET_PROVIDER;
  readonly #now: () => number;

  constructor(options: SyntheticProviderOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  async getSnapshot(rawSymbol: string): Promise<MarketSnapshot> {
    const symbol = normalizedSymbol(rawSymbol);
    const instrument = generatedInstrument(symbol);
    const price = instrument.referencePrice;
    const changePercent = syntheticChangePercent(symbol);
    const previousClose = roundPrice(price / (1 + changePercent / 100));
    const change = roundPrice(price - previousClose);
    const asOf = new Date(roundedAsOf(this.#now)).toISOString();

    return {
      symbol,
      displayName: instrument.displayName,
      currency: instrument.currency,
      exchange: instrument.exchange,
      instrumentType: instrument.instrumentType,
      price,
      previousClose,
      change,
      changePercent: roundPrice((change / previousClose) * 100),
      marketState: "UNKNOWN",
      freshness: "indicative",
      delayMinutes: 0,
      asOf,
      source: SYNTHETIC_SOURCE,
      notice:
        "Synthetic offline demo data generated locally; this is not current market data or an executable quote."
    };
  }

  async getResearch(rawSymbol: string): Promise<SecurityResearchReport> {
    const symbol = normalizedSymbol(rawSymbol);
    const instrument = generatedInstrument(symbol);
    const generatedAt = new Date(roundedAsOf(this.#now)).toISOString();
    const profile: SecurityResearchSection<SecurityCompanyProfile> = {
      status: "partial",
      data: {
        symbol,
        name: instrument.displayName,
        quoteType: instrument.instrumentType,
        exchange: instrument.exchange,
        exchangeDisplayName: instrument.exchange,
        sector: null,
        industry: null,
        businessSummary: null,
        websiteUrl: null,
        employeeCount: null,
        headquarters: {
          city: null,
          state: null,
          country: null
        },
        asOf: generatedAt
      },
      sources: [{
        provider: SYNTHETIC_RESEARCH_PROVIDER,
        label: SYNTHETIC_SOURCE,
        url: null,
        retrievedAt: generatedAt
      }],
      unavailableFields: [
        "sector",
        "industry",
        "businessSummary",
        "websiteUrl",
        "employeeCount",
        "headquarters"
      ],
      issues: [unavailableIssue()]
    };
    const newsAndCatalysts: SecurityResearchSection<SecurityNewsAndCatalysts> = {
      status: "available",
      data: { news: [], catalysts: [] },
      sources: [{
        provider: SYNTHETIC_RESEARCH_PROVIDER,
        label: SYNTHETIC_SOURCE,
        url: null,
        retrievedAt: generatedAt
      }],
      unavailableFields: [],
      issues: []
    };

    return {
      symbol,
      generatedAt,
      overallStatus: "partial",
      profile,
      fundamentals: unavailableSection(["fundamentals"]),
      valuation: unavailableSection(["valuation"]),
      earnings: unavailableSection(["earnings"]),
      dividends: unavailableSection(["dividends"]),
      analystConsensus: unavailableSection(["analystConsensus"]),
      newsAndCatalysts,
      priceRisk: unavailableSection(["priceRisk"]),
      notices: [
        "This report uses project-authored synthetic demo data and makes no claim about current issuer facts.",
        "Current fundamentals, estimates, events, and headlines are intentionally unavailable offline.",
        "Select a properly licensed provider adapter before using market data outside the demo."
      ]
    };
  }
}

export class SyntheticOfflineMarketHistoryProvider
  implements MarketHistoryProvider
{
  readonly #now: () => number;

  constructor(options: SyntheticProviderOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  async getHistory(
    rawSymbol: string,
    range: MarketHistoryRange
  ): Promise<MarketHistorySeries> {
    const symbol = normalizedSymbol(rawSymbol);
    if (!isMarketHistoryRange(range)) {
      throw new MarketDataError("Unsupported market history range", 400);
    }

    const instrument = generatedInstrument(symbol);
    const shape = RANGE_SHAPES[range];
    const asOfMs = roundedAsOf(this.#now);
    const seed = stableHash(`${symbol}:${range}:history`);
    const longMove = ((seed % 61) - 30) / 100;
    const phase = (seed % 628) / 100;
    const points = Array.from({ length: shape.points }, (_, index) => {
      const progress = index / (shape.points - 1);
      const remaining = 1 - progress;
      const trend = 1 - longMove * remaining;
      const wave =
        Math.sin(phase + index * 0.23) * 0.035 * remaining;
      const close =
        index === shape.points - 1
          ? instrument.referencePrice
          : roundPrice(
              Math.max(0.01, instrument.referencePrice * (trend + wave))
            );
      return {
        timestamp: new Date(
          asOfMs - (shape.points - 1 - index) * shape.stepMs
        ).toISOString(),
        close
      };
    });

    return {
      symbol,
      range,
      interval: shape.interval,
      currency: instrument.currency,
      exchange: instrument.exchange,
      asOf: new Date(asOfMs).toISOString(),
      source: SYNTHETIC_SOURCE,
      points
    };
  }
}
