import { describe, expect, it, vi } from "vitest";
import type { MarketHistorySeries } from "../src/domain/market-history.js";
import type { MarketHistoryProvider } from "../src/services/market-history.js";
import { MarketDataError } from "../src/services/market-data.js";
import {
  SecurityResearchError,
  YahooSecurityResearchProvider
} from "../src/services/security-research.js";

const NOW = Date.parse("2026-07-21T08:00:00.000Z");

function historyFor(symbol: string, count = 30): MarketHistorySeries {
  const points = Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(Date.parse("2026-06-01T20:00:00.000Z") + index * 86_400_000).toISOString(),
    close: index === 15 ? 96 : 100 + index * 1.5
  }));
  return {
    symbol,
    range: "1y",
    interval: "1d",
    currency: "USD",
    exchange: "NasdaqGS",
    asOf: points.at(-1)?.timestamp ?? new Date(NOW).toISOString(),
    source: "Yahoo Finance chart endpoint",
    points
  };
}

function historyProvider(): MarketHistoryProvider & {
  getHistory: ReturnType<typeof vi.fn>;
} {
  return {
    getHistory: vi.fn(async (symbol: string) => historyFor(symbol))
  };
}

function quoteSummary(symbol = "NVDA"): unknown {
  return {
    quoteSummary: {
      result: [
        {
          assetProfile: {
            city: "Santa Clara",
            state: "CA",
            country: "United States",
            website: "https://www.nvidia.com",
            industry: "Semiconductors",
            sector: "Technology",
            longBusinessSummary: "NVIDIA builds accelerated-computing platforms.",
            fullTimeEmployees: 42_000
          },
          price: {
            symbol,
            quoteType: "EQUITY",
            exchangeName: "NasdaqGS",
            longName: symbol === "NVDA" ? "NVIDIA Corporation" : `${symbol} Corporation`,
            currency: "USD",
            regularMarketTime: 1_784_577_601
          },
          summaryDetail: {
            marketCap: { raw: 4_900_000_000_000 },
            priceToSalesTrailing12Months: { raw: 19.4 },
            dividendYield: { raw: 0.0003 }
          },
          defaultKeyStatistics: {
            priceToBook: { raw: 25.2 },
            enterpriseToRevenue: { raw: 19.2 },
            enterpriseToEbitda: { raw: 29.5 },
            lastDividendValue: { raw: 0.01 },
            lastDividendDate: { raw: 1_778_457_600 }
          },
          financialData: {
            recommendationKey: "strong_buy",
            numberOfAnalystOpinions: { raw: 58 },
            targetMeanPrice: { raw: 225.5 }
          },
          calendarEvents: {
            earnings: {
              earningsDate: [{ raw: 1_787_774_400 }],
              isEarningsDateEstimate: false
            },
            exDividendDate: { raw: 1_780_531_200 },
            dividendDate: { raw: 1_782_432_000 }
          }
        }
      ],
      error: null
    }
  };
}

function etfQuoteSummary(symbol = "SPY"): unknown {
  const body = quoteSummary(symbol) as {
    quoteSummary: { result: Array<Record<string, unknown>> };
  };
  const result = body.quoteSummary.result[0]!;
  result.price = {
    symbol,
    quoteType: "ETF",
    exchangeName: "NYSEArca",
    longName: "State Street SPDR S&P 500 ETF Trust",
    currency: "USD",
    regularMarketTime: 1_784_577_601
  };
  result.summaryDetail = {
    totalAssets: { raw: 781_188_857_856 },
    averageVolume: { raw: 51_977_593 },
    yield: { raw: 0.0101 }
  };
  result.fundProfile = {
    family: "State Street Investment Management",
    categoryName: "Large Blend",
    legalType: "Exchange Traded Fund",
    feesExpensesInvestment: {
      annualReportExpenseRatio: { raw: 0.000945 }
    }
  };
  result.topHoldings = {
    holdings: [
      {
        symbol: "NVDA",
        holdingName: "NVIDIA Corp",
        holdingPercent: { raw: 0.0749971 }
      },
      {
        symbol: "AAPL",
        holdingName: "Apple Inc",
        holdingPercent: { raw: 0.0657687 }
      }
    ],
    bondHoldings: {
      duration: {},
      maturity: {}
    },
    bondRatings: []
  };
  return body;
}

function searchResponse(symbol = "NVDA"): unknown {
  return {
    quotes: [
      {
        symbol,
        quoteType: "EQUITY",
        longname: symbol === "NVDA" ? "NVIDIA Corporation" : `${symbol} Corporation`,
        exchange: "NMS",
        exchDisp: "NASDAQ",
        sector: "Technology",
        industry: "Semiconductors"
      }
    ],
    news: [
      {
        uuid: `${symbol}-news-1`,
        title: `${symbol} announces a new platform`,
        publisher: "Example Wire",
        link: `https://finance.yahoo.com/news/${symbol.toLowerCase()}-platform`,
        providerPublishTime: 1_784_620_000,
        relatedTickers: [symbol]
      },
      {
        uuid: `${symbol}-news-company-name`,
        title: `${symbol === "NVDA" ? "NVIDIA" : `${symbol} Corporation`} launches a new data-center product`,
        publisher: "Industry Wire",
        link: `https://finance.yahoo.com/news/${symbol.toLowerCase()}-launch`,
        providerPublishTime: 1_784_619_500,
        relatedTickers: [symbol, "AMD"]
      },
      {
        uuid: `${symbol}-metadata-only`,
        title: "Federal Reserve testimony sends the broader bond market higher",
        publisher: "Macro Wire",
        link: "https://finance.yahoo.com/news/federal-reserve-bonds",
        providerPublishTime: 1_784_619_250,
        relatedTickers: [symbol, "^DJI", "^GSPC"]
      },
      {
        uuid: "unrelated",
        title: "Unrelated company update",
        publisher: "Example Wire",
        link: "https://finance.yahoo.com/news/unrelated",
        providerPublishTime: 1_784_619_000,
        relatedTickers: ["MSFT"]
      }
    ]
  };
}

function series(
  type: string,
  values: number[],
  dates: string[],
  periodType: string,
  currencyCode: string | null = "USD"
): unknown {
  return {
    meta: { symbol: ["NVDA"], type: [type] },
    timestamp: dates.map((date) => Date.parse(`${date}T00:00:00.000Z`) / 1_000),
    [type]: values.map((raw, index) => ({
      asOfDate: dates[index],
      periodType,
      ...(currencyCode ? { currencyCode } : {}),
      reportedValue: { raw }
    }))
  };
}

function fundamentalsResponse(): unknown {
  const quarterDates = [
    "2025-04-30",
    "2025-07-31",
    "2025-10-31",
    "2026-01-31",
    "2026-04-30"
  ];
  const annualDates = ["2024-01-31", "2025-01-31", "2026-01-31"];
  return {
    timeseries: {
      result: [
        series("quarterlyTotalRevenue", [100, 120, 140, 160, 180], quarterDates, "3M"),
        series("quarterlyNetIncome", [20, 24, 28, 32, 45], quarterDates, "3M"),
        series("quarterlyGrossProfit", [60, 72, 84, 96, 108], quarterDates, "3M"),
        series("quarterlyOperatingIncome", [30, 36, 42, 48, 54], quarterDates, "3M"),
        series("quarterlyOperatingCashFlow", [25, 30, 35, 40, 50], quarterDates, "3M"),
        series("quarterlyFreeCashFlow", [20, 25, 30, 35, 45], quarterDates, "3M"),
        series("quarterlyTotalDebt", [50, 48, 46, 44, 42], quarterDates, "3M"),
        series(
          "quarterlyCashCashEquivalentsAndShortTermInvestments",
          [80, 85, 90, 95, 100],
          quarterDates,
          "3M"
        ),
        series("quarterlyStockholdersEquity", [100, 110, 120, 130, 140], quarterDates, "3M"),
        series("quarterlyDilutedEPS", [1, 1.2, 1.4, 1.6, 2], quarterDates, "3M"),
        series("annualTotalRevenue", [300, 500, 700], annualDates, "12M"),
        series("annualNetIncome", [60, 100, 140], annualDates, "12M"),
        series("annualDilutedEPS", [3, 5, 7], annualDates, "12M"),
        series("trailingMarketCap", [4_900_000_000_000], ["2026-07-20"], "TTM"),
        series("trailingEnterpriseValue", [4_850_000_000_000], ["2026-07-20"], "TTM"),
        series("trailingPeRatio", [31], ["2026-07-17"], "TTM", null),
        series("trailingForwardPeRatio", [23], ["2026-07-17"], "TTM", null),
        series("trailingPegRatio", [0.56], ["2026-07-17"], "TTM", null)
      ],
      error: null
    }
  };
}

interface FetchFixtureOptions {
  searchStatus?: number;
  searchBody?: unknown;
  fundamentalsBody?: unknown;
  summaryBodies?: unknown[];
}

function fixtureFetch(options: FetchFixtureOptions = {}) {
  let summaryIndex = 0;
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.host === "fc.yahoo.com") {
      return new Response("", {
        status: 404,
        headers: { "set-cookie": "A3=test-session; Path=/; Secure" }
      });
    }
    if (url.pathname === "/v1/test/getcrumb") return new Response("test-crumb");
    if (url.pathname === "/v1/finance/search") {
      const status = options.searchStatus ?? 200;
      return new Response(status === 200 ? JSON.stringify(options.searchBody ?? searchResponse(url.searchParams.get("q") ?? "NVDA")) : null, {
        status,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.pathname.includes("/ws/fundamentals-timeseries/")) {
      return Response.json(options.fundamentalsBody ?? fundamentalsResponse());
    }
    if (url.pathname.includes("/v10/finance/quoteSummary/")) {
      const configured = options.summaryBodies?.[summaryIndex];
      summaryIndex += 1;
      return Response.json(configured ?? quoteSummary(url.pathname.split("/").at(-1) ?? "NVDA"));
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  });
}

describe("YahooSecurityResearchProvider", () => {
  it("normalizes reviewed Yahoo ETF profile, scale, liquidity, distribution, and holding fields", async () => {
    const search = searchResponse("SPY") as { quotes: Array<Record<string, unknown>> };
    Object.assign(search.quotes[0]!, {
      quoteType: "ETF",
      longname: "State Street SPDR S&P 500 ETF Trust",
      exchange: "PCX",
      exchDisp: "NYSEArca"
    });
    const fetchMock = fixtureFetch({
      searchBody: search,
      summaryBodies: [etfQuoteSummary()]
    });
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      historyProvider: historyProvider(),
      now: () => NOW
    });

    const report = await provider.getResearch("SPY");

    expect(report.fundProfile).toMatchObject({
      status: "partial",
      data: {
        family: "State Street Investment Management",
        categoryName: "Large Blend",
        legalType: "Exchange Traded Fund",
        objective: null,
        trackedIndex: null,
        metrics: expect.arrayContaining([
          expect.objectContaining({
            key: "etf-expense-ratio",
            value: 0.0945,
            unit: "percent",
            calculation: "provider decimal ratio × 100"
          }),
          expect.objectContaining({
            key: "etf-total-assets",
            value: 781_188_857_856,
            unit: "currency",
            currency: "USD"
          }),
          expect.objectContaining({
            key: "etf-average-volume",
            value: 51_977_593,
            unit: "shares"
          }),
          expect.objectContaining({
            key: "etf-distribution-yield",
            value: 1.01,
            unit: "percent"
          })
        ]),
        holdings: [
          expect.objectContaining({
            symbol: "NVDA",
            weightPercent: 7.49971
          }),
          expect.objectContaining({
            symbol: "AAPL",
            weightPercent: 6.57687
          })
        ],
        creditQuality: []
      },
      unavailableFields: expect.arrayContaining([
        "objective",
        "tracked-index",
        "etf-bond-duration",
        "credit-quality"
      ])
    });
    const summaryUrl = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .find(({ pathname }) => pathname.includes("/v10/finance/quoteSummary/"));
    expect(summaryUrl?.searchParams.get("modules")).toContain("fundProfile");
    expect(summaryUrl?.searchParams.get("modules")).toContain("topHoldings");
  });

  it("builds a sourced live-research bundle with fundamentals, catalysts, and price risk", async () => {
    const fetchMock = fixtureFetch();
    const history = historyProvider();
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      historyProvider: history,
      now: () => NOW
    });

    const report = await provider.getResearch(" nvda ");

    expect(report.symbol).toBe("NVDA");
    expect(report.overallStatus).toBe("available");
    expect(report.profile).toMatchObject({
      status: "available",
      data: {
        name: "NVIDIA Corporation",
        sector: "Technology",
        industry: "Semiconductors",
        employeeCount: 42_000
      }
    });
    expect(report.fundamentals.data?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "free-cash-flow-quarterly", value: 45, period: "3M" }),
        expect.objectContaining({ key: "gross-margin-quarterly", value: 60, derivation: "computed" }),
        expect.objectContaining({ key: "debt-to-equity-quarterly", value: 0.3 })
      ])
    );
    expect(report.valuation.data?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "market-cap",
          value: 4_900_000_000_000,
          asOf: "2026-07-20T00:00:00.000Z",
          source: "yahoo-fundamentals"
        }),
        expect.objectContaining({ key: "price-to-book", value: 25.2 })
      ])
    );
    expect(report.earnings.data?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "revenue-growth-yoy-quarterly", value: 80 }),
        expect.objectContaining({ key: "diluted-eps-growth-yoy-quarterly", value: 100 })
      ])
    );
    expect(report.dividends).toMatchObject({
      status: "available",
      data: {
        metrics: [
          {
            key: "dividend-yield",
            value: 0.03,
            unit: "percent",
            derivation: "provider-reported"
          }
        ],
        lastDividend: {
          amount: 0.01,
          currency: "USD",
          date: new Date(1_778_457_600_000).toISOString(),
          dateBasis: "provider-reported-last-dividend-date"
        }
      }
    });
    expect(report.analystConsensus).toMatchObject({
      status: "available",
      data: {
        recommendation: "Strong Buy",
        analystCount: 58,
        targetPrice: 225.5,
        currency: "USD",
        asOf: "2026-07-20T20:00:01.000Z"
      }
    });
    expect(report.newsAndCatalysts.data?.news).toHaveLength(2);
    expect(report.newsAndCatalysts.data?.news).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "NVDA-news-1", relatedSymbols: ["NVDA"] }),
        expect.objectContaining({ id: "NVDA-news-company-name" })
      ])
    );
    expect(report.newsAndCatalysts.data?.news.map(({ id }) => id)).not.toContain(
      "NVDA-metadata-only"
    );
    expect(report.newsAndCatalysts.data?.catalysts).toEqual([
      expect.objectContaining({
        type: "earnings-date",
        scheduledAt: new Date(1_787_774_400_000).toISOString(),
        estimated: false
      })
    ]);
    expect(report.priceRisk).toMatchObject({
      status: "available",
      data: { methodologyVersion: "single-security-price-risk-v1", observations: 30 }
    });
    expect(report.priceRisk.data?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "annualized-volatility", derivation: "computed" }),
        expect.objectContaining({ key: "maximum-drawdown", unit: "percent" })
      ])
    );
    expect(report.valuation.data?.metrics.every(({ sourceUrl }) => sourceUrl.startsWith("https://"))).toBe(true);
    expect(history.getHistory).toHaveBeenCalledWith("NVDA", "1y");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("crumb=test-crumb"))).toBe(true);
  });

  it("preserves usable sections and maps a Yahoo rate limit to a retryable section issue", async () => {
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fixtureFetch({ searchStatus: 429 }) as unknown as typeof fetch,
      historyProvider: historyProvider(),
      now: () => NOW
    });

    const report = await provider.getResearch("NVDA");

    expect(report.overallStatus).toBe("partial");
    expect(report.profile.data?.businessSummary).toContain("accelerated-computing");
    expect(report.profile.status).toBe("partial");
    expect(report.profile.issues).toContainEqual(
      expect.objectContaining({
        provider: "yahoo-search",
        code: "RATE_LIMITED",
        retryable: true,
        httpStatus: 503
      })
    );
    expect(report.newsAndCatalysts).toMatchObject({
      status: "partial",
      unavailableFields: ["news"]
    });
    expect(report.fundamentals.data?.metrics.length).toBeGreaterThan(0);
    expect(report.priceRisk.data?.metrics.length).toBeGreaterThan(0);
  });

  it("refreshes the Yahoo session once when the provider rejects a stale crumb", async () => {
    const invalidCrumb = {
      quoteSummary: {
        result: null,
        error: { code: "Unauthorized", description: "Invalid Crumb" }
      }
    };
    const fetchMock = fixtureFetch({ summaryBodies: [invalidCrumb, quoteSummary()] });
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      historyProvider: historyProvider(),
      now: () => NOW
    });

    const report = await provider.getResearch("NVDA");

    expect(report.profile.data?.businessSummary).toBeTruthy();
    const calledPaths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(calledPaths.filter((path) => path === "/v1/test/getcrumb")).toHaveLength(2);
    expect(calledPaths.filter((path) => path.includes("/v10/finance/quoteSummary/"))).toHaveLength(2);
  });

  it("fails closed instead of fabricating an incomplete analyst consensus", async () => {
    const incomplete = quoteSummary() as {
      quoteSummary: {
        result: Array<{ financialData: Record<string, unknown> }>;
      };
    };
    delete incomplete.quoteSummary.result[0]!.financialData.numberOfAnalystOpinions;
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fixtureFetch({ summaryBodies: [incomplete] }) as unknown as typeof fetch,
      historyProvider: historyProvider(),
      now: () => NOW
    });

    const report = await provider.getResearch("NVDA");

    expect(report.analystConsensus).toMatchObject({
      status: "unavailable",
      data: null,
      unavailableFields: ["analyst-count"],
      sources: [
        expect.objectContaining({
          provider: "yahoo-quote-summary",
          label: "Yahoo Finance analyst estimates"
        })
      ],
      issues: [
        expect.objectContaining({
          provider: "yahoo-quote-summary",
          code: "INSUFFICIENT_DATA"
        })
      ]
    });
    expect(report.dividends?.status).toBe("available");
  });

  it("marks catalyst-only research partial when no title-verified news is available", async () => {
    const search = searchResponse() as { quotes: unknown[]; news: unknown[] };
    search.news = [];
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fixtureFetch({ searchBody: search }) as unknown as typeof fetch,
      historyProvider: historyProvider(),
      now: () => NOW
    });

    const report = await provider.getResearch("NVDA");

    expect(report.newsAndCatalysts).toMatchObject({
      status: "partial",
      unavailableFields: ["news"]
    });
    expect(report.newsAndCatalysts.data?.news).toEqual([]);
    expect(report.newsAndCatalysts.data?.catalysts.length).toBeGreaterThan(0);
  });

  it("maps request timeouts without discarding independently available research", async () => {
    const normalFetch = fixtureFetch();
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/finance/search") throw timeout;
      return normalFetch(input);
    });
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      historyProvider: historyProvider(),
      now: () => NOW
    });

    const report = await provider.getResearch("NVDA");

    expect(report.overallStatus).toBe("partial");
    expect(report.profile.data?.name).toBe("NVIDIA Corporation");
    expect(report.newsAndCatalysts.issues).toContainEqual(
      expect.objectContaining({
        provider: "yahoo-search",
        code: "TIMEOUT",
        retryable: true,
        httpStatus: 503
      })
    );
    expect(report.valuation.data?.metrics.length).toBeGreaterThan(0);
    expect(report.priceRisk.data?.metrics.length).toBeGreaterThan(0);
  });

  it("returns explicit unavailable sections without fabricated defaults when providers have no data", async () => {
    const emptySearch = { quotes: [], news: [] };
    const fetchMock = fixtureFetch({
      fundamentalsBody: { timeseries: { result: [], error: null } },
      summaryBodies: [
        { quoteSummary: { result: null, error: { code: "Not Found", description: "No data found" } } }
      ]
    });
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/finance/search") return Response.json(emptySearch);
      if (url.host === "fc.yahoo.com") {
        return new Response("", { status: 404, headers: { "set-cookie": "A3=test; Path=/" } });
      }
      if (url.pathname === "/v1/test/getcrumb") return new Response("test-crumb");
      if (url.pathname.includes("fundamentals-timeseries")) {
        return Response.json({ timeseries: { result: [], error: null } });
      }
      if (url.pathname.includes("quoteSummary")) {
        return Response.json({
          quoteSummary: { result: null, error: { code: "Not Found", description: "No data found" } }
        });
      }
      throw new Error(`Unexpected URL ${url.toString()}`);
    });
    const unavailableHistory: MarketHistoryProvider = {
      getHistory: vi.fn(async () => {
        throw new MarketDataError("No market history was found", 404);
      })
    };
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      historyProvider: unavailableHistory,
      now: () => NOW
    });

    const report = await provider.getResearch("ZZZZ");

    expect(report.profile.data).toBeNull();
    expect(report.fundamentals.data).toBeNull();
    expect(report.valuation.data).toBeNull();
    expect(report.earnings.data).toBeNull();
    expect(report.priceRisk.data).toBeNull();
    expect(report.newsAndCatalysts).toMatchObject({
      status: "unavailable",
      data: null,
      unavailableFields: ["news", "catalysts"]
    });
    expect(report.overallStatus).toBe("unavailable");
    expect(report.fundamentals.issues).toContainEqual(
      expect.objectContaining({ code: "INSUFFICIENT_DATA" })
    );
    expect(report.priceRisk.issues).toContainEqual(
      expect.objectContaining({ code: "NOT_FOUND", httpStatus: 404 })
    );
  });

  it("omits misleading YoY percentages when earnings cross zero or remain negative", async () => {
    const body = fundamentalsResponse() as {
      timeseries: { result: Array<Record<string, unknown>>; error: null };
    };
    const replaceValues = (type: string, values: number[]): void => {
      const target = body.timeseries.result.find((candidate) => {
        const meta = candidate.meta as { type?: string[] } | undefined;
        return meta?.type?.[0] === type;
      });
      if (!target) throw new Error(`Missing fixture series ${type}`);
      const entries = target[type] as Array<{ reportedValue: { raw: number } }>;
      values.forEach((value, index) => {
        const entry = entries[index];
        if (entry) entry.reportedValue.raw = value;
      });
    };
    replaceValues("quarterlyNetIncome", [20, 24, 28, 32, -5]);
    replaceValues("quarterlyDilutedEPS", [-1, -0.8, -0.5, -0.2, -0.1]);
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fixtureFetch({ fundamentalsBody: body }) as unknown as typeof fetch,
      historyProvider: historyProvider(),
      now: () => NOW
    });

    const report = await provider.getResearch("NVDA");
    const earningsMetrics = report.earnings.data?.metrics ?? [];

    expect(earningsMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "revenue-growth-yoy-quarterly", value: 80 })
      ])
    );
    expect(earningsMetrics.some(({ key }) => key === "net-income-growth-yoy-quarterly")).toBe(false);
    expect(earningsMetrics.some(({ key }) => key === "diluted-eps-growth-yoy-quarterly")).toBe(false);
    expect(report.earnings.status).toBe("partial");
    expect(report.earnings.unavailableFields).toEqual(
      expect.arrayContaining([
        "net-income-growth-yoy-quarterly",
        "diluted-eps-growth-yoy-quarterly"
      ])
    );
  });

  it("omits stale valuation ratios instead of presenting them as current", async () => {
    const body = fundamentalsResponse() as {
      timeseries: { result: Array<Record<string, unknown>>; error: null };
    };
    for (const type of [
      "trailingPeRatio",
      "trailingForwardPeRatio",
      "trailingPegRatio"
    ]) {
      const target = body.timeseries.result.find((candidate) => {
        const meta = candidate.meta as { type?: string[] } | undefined;
        return meta?.type?.[0] === type;
      });
      const entries = target?.[type] as Array<Record<string, unknown>> | undefined;
      if (entries?.[0]) entries[0].asOfDate = "2024-09-19";
    }
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fixtureFetch({ fundamentalsBody: body }) as unknown as typeof fetch,
      historyProvider: historyProvider(),
      now: () => NOW
    });

    const report = await provider.getResearch("INTC");
    const valuationKeys = report.valuation.data?.metrics.map(({ key }) => key) ?? [];

    expect(valuationKeys).not.toContain("trailing-pe");
    expect(valuationKeys).not.toContain("forward-pe");
    expect(valuationKeys).not.toContain("peg-ratio");
    expect(valuationKeys).toContain("market-cap");
    expect(report.valuation.status).toBe("partial");
    expect(report.valuation.issues).toContainEqual(
      expect.objectContaining({
        code: "INSUFFICIENT_DATA",
        message: expect.stringContaining("older than 14 days")
      })
    );
  });

  it("deduplicates concurrent work, caches successful reports, and bounds cache entries", async () => {
    const fetchMock = fixtureFetch();
    const history = historyProvider();
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      historyProvider: history,
      maxCacheEntries: 1,
      cacheMs: 60_000,
      now: () => NOW
    });

    const [first, concurrent] = await Promise.all([
      provider.getResearch("NVDA"),
      provider.getResearch("NVDA")
    ]);
    await expect(provider.getResearch("NVDA")).resolves.toBe(first);
    expect(concurrent).toBe(first);
    expect(history.getHistory).toHaveBeenCalledTimes(1);

    await provider.getResearch("AAPL");
    await provider.getResearch("NVDA");

    expect(history.getHistory).toHaveBeenCalledTimes(3);
    const searchSymbols = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter(({ pathname }) => pathname === "/v1/finance/search")
      .map((url) => url.searchParams.get("q"));
    expect(searchSymbols).toEqual(["NVDA", "AAPL", "NVDA"]);
  });

  it("rejects unsafe symbols before making any external request", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const history = historyProvider();
    const provider = new YahooSecurityResearchProvider({
      fetchImpl: fetchMock,
      historyProvider: history
    });

    await expect(provider.getResearch("NVDA/../../secret")).rejects.toEqual(
      expect.objectContaining<Partial<SecurityResearchError>>({
        code: "INVALID_SYMBOL",
        statusCode: 400,
        provider: "validation"
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(history.getHistory).not.toHaveBeenCalled();
  });
});
