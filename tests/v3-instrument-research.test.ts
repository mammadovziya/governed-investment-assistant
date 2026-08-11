import { describe, expect, it, vi } from "vitest";
import type {
  SecurityResearchMetric,
  SecurityResearchMetricKey,
  SecurityResearchProviderId,
  SecurityResearchReport
} from "../src/domain/security-research.js";
import type { MarketSnapshot } from "../src/domain/types.js";
import {
  DATA_NOT_AVAILABLE,
  getInstrumentResearch,
  normalizeInstrumentResearch
} from "../src/assistant-v3/instrument-research.js";
import {
  ProviderLicenseError,
  YAHOO_DEVELOPMENT_PROVIDER,
  YahooDevelopmentMarketResearchProvider,
  evaluateYandexProviderConfiguration
} from "../src/assistant-v3/providers.js";

const AS_OF = "2026-07-21T20:00:00.000Z";

function snapshot(instrumentType = "EQUITY"): MarketSnapshot {
  return {
    symbol: "NVDA",
    displayName: "NVIDIA Corporation",
    currency: "USD",
    exchange: "NasdaqGS",
    instrumentType,
    price: 203.28,
    previousClose: 202.81,
    change: 0.47,
    changePercent: 0.23,
    marketState: "CLOSED",
    freshness: "indicative",
    delayMinutes: 0,
    asOf: AS_OF,
    source: "Yahoo Finance chart endpoint",
    notice: "Latest indicative snapshot."
  };
}

function metric(
  key: SecurityResearchMetricKey,
  value: number,
  source: SecurityResearchProviderId = "yahoo-fundamentals"
): SecurityResearchMetric {
  const percentKeys: SecurityResearchMetricKey[] = [
    "dividend-yield",
    "etf-expense-ratio",
    "etf-distribution-yield",
    "annualized-volatility",
    "downside-volatility",
    "maximum-drawdown"
  ];
  const unit = key === "etf-total-assets"
    ? "currency"
    : key === "etf-average-volume"
      ? "shares"
      : key === "etf-bond-duration" || key === "etf-bond-maturity"
        ? "years"
        : percentKeys.includes(key)
          ? "percent"
          : "ratio";
  return {
    key,
    label: key,
    value,
    unit,
    currency: unit === "currency" ? "USD" : null,
    period: "TTM",
    asOf: AS_OF,
    asOfBasis: source === "yahoo-history" ? "history-end" : "provider-period",
    source,
    sourceUrl: `https://finance.yahoo.com/quote/NVDA/${source}`,
    derivation: source === "yahoo-history" ? "computed" : "provider-reported",
    calculation: source === "yahoo-history" ? "historical price calculation" : null
  };
}

function report(quoteType = "EQUITY"): SecurityResearchReport {
  const fundamentalsMetrics = [
    metric("gross-profit-quarterly", 25_000_000_000),
    metric("gross-margin-quarterly", 72),
    metric("operating-margin-quarterly", 61),
    metric("net-margin-quarterly", 55),
    metric("free-cash-flow-quarterly", 45),
    metric("total-debt-quarterly", 42),
    metric("cash-and-short-term-investments-quarterly", 100),
    metric("shareholders-equity-quarterly", 140),
    metric("debt-to-equity-quarterly", 0.3)
  ];
  const valuationMetrics = [
    metric("market-cap", 4_900_000_000_000),
    metric("trailing-pe", 31),
    metric("forward-pe", 23)
  ];
  const riskMetrics = [
    metric("annualized-volatility", 41, "yahoo-history"),
    metric("downside-volatility", 29, "yahoo-history"),
    metric("maximum-drawdown", -18, "yahoo-history"),
    metric("period-high", 210, "yahoo-history"),
    metric("period-low", 95, "yahoo-history")
  ];
  return {
    symbol: "NVDA",
    generatedAt: AS_OF,
    overallStatus: "partial",
    profile: {
      status: "available",
      data: {
        symbol: "NVDA",
        name: "NVIDIA Corporation",
        quoteType,
        exchange: "NasdaqGS",
        exchangeDisplayName: "NASDAQ",
        sector: "Technology",
        industry: "Semiconductors",
        businessSummary: "Accelerated computing platforms.",
        websiteUrl: "https://www.nvidia.com",
        employeeCount: 42_000,
        headquarters: { city: "Santa Clara", state: "CA", country: "US" },
        asOf: AS_OF
      },
      sources: [
        {
          provider: "yahoo-quote-summary",
          label: "Yahoo Finance profile",
          url: "https://finance.yahoo.com/quote/NVDA/profile",
          retrievedAt: AS_OF
        }
      ],
      unavailableFields: [],
      issues: []
    },
    fundamentals: {
      status: "available",
      data: { metrics: fundamentalsMetrics },
      sources: [
        {
          provider: "yahoo-fundamentals",
          label: "Yahoo Finance fundamentals",
          url: "https://finance.yahoo.com/quote/NVDA/financials",
          retrievedAt: AS_OF
        }
      ],
      unavailableFields: [],
      issues: []
    },
    valuation: {
      status: "partial",
      data: { metrics: valuationMetrics },
      sources: [
        {
          provider: "yahoo-fundamentals",
          label: "Yahoo Finance valuation",
          url: "https://finance.yahoo.com/quote/NVDA/key-statistics",
          retrievedAt: AS_OF
        }
      ],
      unavailableFields: ["price-to-book"],
      issues: []
    },
    earnings: {
      status: "available",
      data: {
        metrics: [
          metric("revenue-quarterly", 35_000_000_000),
          metric("net-income-quarterly", 19_000_000_000),
          metric("revenue-annual", 110_000_000_000),
          metric("net-income-annual", 60_000_000_000)
        ]
      },
      sources: [{
        provider: "yahoo-fundamentals",
        label: "Yahoo Finance earnings",
        url: "https://finance.yahoo.com/quote/NVDA/financials",
        retrievedAt: AS_OF
      }],
      unavailableFields: [],
      issues: []
    },
    dividends: {
      status: "available",
      data: {
        metrics: [metric("dividend-yield", 0.03, "yahoo-quote-summary")],
        lastDividend: {
          amount: 0.01,
          currency: "USD",
          date: "2026-05-10T00:00:00.000Z",
          dateBasis: "provider-reported-last-dividend-date"
        }
      },
      sources: [{
        provider: "yahoo-quote-summary",
        label: "Yahoo Finance dividend statistics",
        url: "https://finance.yahoo.com/quote/NVDA/key-statistics",
        retrievedAt: AS_OF
      }],
      unavailableFields: [],
      issues: []
    },
    analystConsensus: {
      status: "available",
      data: {
        recommendation: "Strong Buy",
        analystCount: 58,
        targetPrice: 225.5,
        currency: "USD",
        asOf: AS_OF
      },
      sources: [{
        provider: "yahoo-quote-summary",
        label: "Yahoo Finance analyst estimates",
        url: "https://finance.yahoo.com/quote/NVDA/analysis",
        retrievedAt: AS_OF
      }],
      unavailableFields: [],
      issues: []
    },
    ...(quoteType === "ETF"
      ? {
          fundProfile: {
            status: "partial" as const,
            data: {
              family: "State Street Investment Management",
              categoryName: "Large Blend",
              legalType: "Exchange Traded Fund",
              objective: null,
              trackedIndex: null,
              metrics: [
                metric("etf-expense-ratio", 0.0945, "yahoo-quote-summary"),
                metric("etf-total-assets", 781_188_857_856, "yahoo-quote-summary"),
                metric("etf-average-volume", 51_977_593, "yahoo-quote-summary"),
                metric("etf-distribution-yield", 1.01, "yahoo-quote-summary"),
                metric("etf-bond-maturity", 9.457, "yahoo-quote-summary")
              ],
              holdings: [
                {
                  symbol: "NVDA",
                  name: "NVIDIA Corp",
                  weightPercent: 7.49971,
                  asOf: AS_OF
                },
                {
                  symbol: "AAPL",
                  name: "Apple Inc",
                  weightPercent: 6.57687,
                  asOf: AS_OF
                }
              ],
              creditQuality: [
                { rating: "AA" as const, weightPercent: 72.61, asOf: AS_OF },
                {
                  rating: "US_GOVERNMENT" as const,
                  weightPercent: 51.86,
                  asOf: AS_OF
                }
              ]
            },
            sources: [{
              provider: "yahoo-quote-summary" as const,
              label: "Yahoo Finance fund profile and holdings",
              url: "https://finance.yahoo.com/quote/NVDA/holdings",
              retrievedAt: AS_OF
            }],
            unavailableFields: [
              "objective",
              "tracked-index",
              "etf-bond-duration",
              "tracking-difference"
            ],
            issues: []
          }
        }
      : {}),
    newsAndCatalysts: {
      status: "available",
      data: { news: [], catalysts: [] },
      sources: [],
      unavailableFields: [],
      issues: []
    },
    priceRisk: {
      status: "available",
      data: {
        methodologyVersion: "single-security-price-risk-v1",
        window: "1y",
        interval: "1d",
        observations: 250,
        returnObservations: 249,
        periodStart: "2025-07-21T20:00:00.000Z",
        periodEnd: AS_OF,
        metrics: riskMetrics,
        methodologyNotes: []
      },
      sources: [
        {
          provider: "yahoo-history",
          label: "Yahoo Finance history",
          url: "https://finance.yahoo.com/quote/NVDA/history",
          retrievedAt: AS_OF
        }
      ],
      unavailableFields: [],
      issues: []
    },
    notices: []
  };
}

describe("V3 instrument research normalization", () => {
  it("normalizes sourced equity, dividend, and analyst facts while keeping unsupported facets unavailable", () => {
    const facts = normalizeInstrumentResearch({
      snapshot: snapshot(),
      report: report(),
      provider: YAHOO_DEVELOPMENT_PROVIDER
    });

    expect(facts.instrumentType).toBe("EQUITY");
    expect(facts.valuation.trailingPe).toMatchObject({
      status: "AVAILABLE",
      value: { value: "31.00000000" }
    });
    expect(facts.financialHealth.debtToEquity).toMatchObject({
      status: "AVAILABLE",
      value: { value: "0.30000000" }
    });
    expect(facts.profitability.quarterlyNetIncome).toMatchObject({
      status: "AVAILABLE",
      value: { value: "19000000000.00000000" }
    });
    expect(facts.profitability.quarterlyGrossMargin).toMatchObject({
      status: "AVAILABLE",
      value: { value: "72.00000000" }
    });
    expect(facts.dividendYield).toMatchObject({
      status: "AVAILABLE",
      value: {
        key: "dividend-yield",
        value: "0.03000000",
        unit: "percent"
      },
      sources: [{
        sourceId: "yahoo-quote-summary",
        licenseClass: "development-only"
      }]
    });
    expect(facts.lastDividend).toMatchObject({
      status: "AVAILABLE",
      value: {
        amount: "0.01000000",
        currency: "USD",
        date: "2026-05-10T00:00:00.000Z",
        dateBasis: "provider-reported-last-dividend-date"
      }
    });
    expect(facts.returnOnEquity.status).toBe(DATA_NOT_AVAILABLE);
    expect(facts.analystConsensus).toMatchObject({
      status: "AVAILABLE",
      value: {
        recommendation: "Strong Buy",
        analystCount: 58,
        targetPrice: "225.50000000",
        currency: "USD",
        asOf: AS_OF
      },
      sources: [{
        sourceId: "yahoo-quote-summary",
        licenseClass: "development-only"
      }]
    });
    expect(facts.holders.status).toBe(DATA_NOT_AVAILABLE);
    expect(facts.instrumentSpecificRisks.maximumDrawdown).toMatchObject({
      status: "AVAILABLE",
      value: { value: "-18.00000000" }
    });
    expect(facts.valuation.trailingPe.sources[0]).toMatchObject({
      providerId: "yahoo-finance",
      licenseClass: "development-only"
    });
  });

  it("uses the discriminated ETF and bond risk contracts without applying equity facts", () => {
    const etf = normalizeInstrumentResearch({
      snapshot: snapshot("ETF"),
      report: report("ETF"),
      provider: YAHOO_DEVELOPMENT_PROVIDER
    });
    expect(etf.instrumentType).toBe("ETF");
    if (etf.instrumentType !== "ETF") throw new Error("Expected ETF facts");
    expect(etf.fund).toMatchObject({
      objective: {
        status: DATA_NOT_AVAILABLE,
        reason: "SOURCE_FIELD_NOT_PROVIDED"
      },
      trackedIndex: {
        status: DATA_NOT_AVAILABLE,
        reason: "SOURCE_FIELD_NOT_PROVIDED"
      },
      category: {
        status: "AVAILABLE",
        value: "Large Blend"
      },
      expenseRatio: {
        status: "AVAILABLE",
        value: {
          key: "etf-expense-ratio",
          value: "0.09450000",
          unit: "percent"
        }
      },
      totalAssets: {
        status: "AVAILABLE",
        value: {
          key: "etf-total-assets",
          value: "781188857856.00000000",
          unit: "currency"
        }
      },
      averageDailyVolume: {
        status: "AVAILABLE",
        value: {
          key: "etf-average-volume",
          value: "51977593.00000000",
          unit: "shares"
        }
      },
      distributionYield: {
        status: "AVAILABLE",
        value: {
          key: "etf-distribution-yield",
          value: "1.01000000",
          unit: "percent"
        }
      }
    });
    expect(etf.instrumentSpecificRisks.concentration).toMatchObject({
      status: "AVAILABLE",
      value: {
        largestHoldingPercent: "7.49971000",
        topTenHoldingsPercent: "14.07658000",
        asOf: AS_OF
      }
    });
    expect(etf.instrumentSpecificRisks.trackingDifference).toMatchObject({
      status: DATA_NOT_AVAILABLE,
      reason: "SOURCE_FIELD_NOT_PROVIDED"
    });
    expect(etf.instrumentSpecificRisks.duration.status).toBe(DATA_NOT_AVAILABLE);
    expect(etf.instrumentSpecificRisks.maturity).toMatchObject({
      status: "AVAILABLE",
      value: { value: "9.45700000", unit: "years" }
    });
    expect(etf.instrumentSpecificRisks.creditQuality).toMatchObject({
      status: "AVAILABLE",
      value: {
        entries: [
          { rating: "AA", weightPercent: "72.61000000", asOf: AS_OF },
          {
            rating: "US_GOVERNMENT",
            weightPercent: "51.86000000",
            asOf: AS_OF
          }
        ]
      }
    });
    expect(etf.holders).toMatchObject({
      status: "AVAILABLE",
      value: {
        kind: "fund-holdings",
        entries: [
          { name: "NVIDIA Corp (NVDA)", ownershipPercent: "7.49971000" },
          { name: "Apple Inc (AAPL)", ownershipPercent: "6.57687000" }
        ]
      }
    });
    expect(etf.valuation.marketCapitalization).toMatchObject({
      status: DATA_NOT_AVAILABLE,
      reason: "NOT_APPLICABLE_TO_INSTRUMENT"
    });
    expect(etf.financialHealth.totalDebt).toMatchObject({
      status: DATA_NOT_AVAILABLE,
      reason: "NOT_APPLICABLE_TO_INSTRUMENT"
    });
    expect(etf.profitability.quarterlyNetIncome).toMatchObject({
      status: DATA_NOT_AVAILABLE,
      reason: "NOT_APPLICABLE_TO_INSTRUMENT"
    });

    const bond = normalizeInstrumentResearch({
      snapshot: snapshot("BOND"),
      report: report("BOND"),
      provider: YAHOO_DEVELOPMENT_PROVIDER
    });
    expect(bond.instrumentType).toBe("BOND");
    if (bond.instrumentType !== "BOND") throw new Error("Expected bond facts");
    expect(bond.valuation.trailingPe).toMatchObject({
      status: DATA_NOT_AVAILABLE,
      reason: "NOT_APPLICABLE_TO_INSTRUMENT"
    });
    expect(bond.instrumentSpecificRisks.creditRating.status).toBe(DATA_NOT_AVAILABLE);
    expect(bond.instrumentSpecificRisks.yieldToMaturity.status).toBe(DATA_NOT_AVAILABLE);
  });

  it("fails closed for conflicting classifications and degrades a research outage", async () => {
    expect(() =>
      normalizeInstrumentResearch({
        snapshot: snapshot("ETF"),
        report: report("EQUITY"),
        provider: YAHOO_DEVELOPMENT_PROVIDER
      })
    ).toThrow(/Conflicting instrument classifications/u);

    const provider = {
      descriptor: YAHOO_DEVELOPMENT_PROVIDER,
      getSnapshot: vi.fn(async () => snapshot()),
      getResearch: vi.fn(async () => {
        throw new Error("upstream unavailable");
      })
    };
    const facts = await getInstrumentResearch(provider, "NVDA");
    expect(facts.quote.status).toBe("AVAILABLE");
    expect(facts.dividendYield).toMatchObject({
      status: DATA_NOT_AVAILABLE,
      reason: "PROVIDER_REQUEST_FAILED"
    });
    expect(facts.lastDividend).toMatchObject({
      status: DATA_NOT_AVAILABLE,
      reason: "PROVIDER_REQUEST_FAILED"
    });
    expect(facts.analystConsensus.status).toBe(DATA_NOT_AVAILABLE);
  });
});

describe("V3 public provider controls", () => {
  it("adapts existing Yahoo ports in development and blocks production", async () => {
    const marketData = { getSnapshot: vi.fn(async () => snapshot()) };
    const securityResearch = { getResearch: vi.fn(async () => report()) };
    const provider = new YahooDevelopmentMarketResearchProvider({
      environment: "test",
      marketData,
      securityResearch
    });

    await expect(provider.getSnapshot("NVDA")).resolves.toMatchObject({ symbol: "NVDA" });
    await expect(provider.getResearch("NVDA")).resolves.toMatchObject({ symbol: "NVDA" });
    expect(provider.descriptor.licenseClass).toBe("development-only");
    expect(
      () =>
        new YahooDevelopmentMarketResearchProvider({
          environment: "production",
          marketData,
          securityResearch
        })
    ).toThrow(ProviderLicenseError);
  });

  it("keeps Yandex disabled until contract, credentials, licensing, and enablement exist", () => {
    expect(
      evaluateYandexProviderConfiguration({
        enabled: true,
        apiContract: {
          baseUrl: "https://api.example.yandex.invalid",
          version: "v1",
          quoteEndpoint: "/quotes",
          researchEndpoint: "/research"
        }
      })
    ).toMatchObject({
      enabled: false,
      missingRequirements: expect.arrayContaining(["credentials", "licensing"])
    });

    expect(
      evaluateYandexProviderConfiguration({
        enabled: true,
        apiContract: {
          baseUrl: "https://api.example.yandex.invalid",
          version: "v1",
          quoteEndpoint: "/quotes",
          researchEndpoint: "/research"
        },
        credentials: { apiKey: "test-only-key" },
        licensing: {
          agreementId: "test-license",
          attributionLabel: "Yandex Market Data",
          customerDisplayPermitted: true,
          automatedRetrievalPermitted: true
        }
      })
    ).toMatchObject({ enabled: true, missingRequirements: [] });
  });
});
