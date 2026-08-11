import type { MarketHistorySeries } from "../domain/market-history.js";
import {
  isSafeMarketSymbol,
  normalizeMarketSymbol
} from "../domain/market-symbol.js";
import type {
  SecurityAnalystConsensus,
  SecurityCatalyst,
  SecurityCompanyProfile,
  SecurityDividends,
  SecurityEarnings,
  SecurityFundCreditQuality,
  SecurityFundCreditRating,
  SecurityFundHolding,
  SecurityFundProfile,
  SecurityFundamentals,
  SecurityNewsAndCatalysts,
  SecurityNewsItem,
  SecurityPriceRisk,
  SecurityResearchIssue,
  SecurityResearchIssueCode,
  SecurityResearchMetric,
  SecurityResearchMetricKey,
  SecurityResearchMetricUnit,
  SecurityResearchProviderId,
  SecurityResearchReport,
  SecurityResearchSection,
  SecurityResearchSource,
  SecurityResearchStatus,
  SecurityValuation
} from "../domain/security-research.js";
import { MarketDataError } from "./market-data.js";
import {
  YahooMarketHistoryProvider,
  type MarketHistoryProvider
} from "./market-history.js";

type UnknownRecord = Record<string, unknown>;

interface CachedResearch {
  report: SecurityResearchReport;
  expiresAt: number;
}

interface YahooSession {
  cookie: string;
  crumb: string;
  expiresAt: number;
}

interface ProviderOutcome<T> {
  value: T | null;
  issue: SecurityResearchIssue | null;
}

interface SeriesDatum {
  value: number;
  currency: string | null;
  period: string;
  asOf: string;
}

interface MetricSpecification {
  type: string;
  key: SecurityResearchMetricKey;
  label: string;
  unit: SecurityResearchMetricUnit;
}

export interface SecurityResearchProvider {
  getResearch(symbol: string): Promise<SecurityResearchReport>;
}

export interface YahooSecurityResearchProviderOptions {
  cacheMs?: number;
  maxCacheEntries?: number;
  timeoutMs?: number;
  sessionCacheMs?: number;
  newsLimit?: number;
  fetchImpl?: typeof fetch;
  historyProvider?: MarketHistoryProvider;
  now?: () => number;
}

const SEARCH_PROVIDER = "yahoo-search" as const;
const SUMMARY_PROVIDER = "yahoo-quote-summary" as const;
const FUNDAMENTALS_PROVIDER = "yahoo-fundamentals" as const;
const HISTORY_PROVIDER = "yahoo-history" as const;
const VALUATION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

const FUNDAMENTAL_TYPES = [
  "quarterlyTotalRevenue",
  "quarterlyNetIncome",
  "quarterlyGrossProfit",
  "quarterlyOperatingIncome",
  "quarterlyOperatingCashFlow",
  "quarterlyFreeCashFlow",
  "quarterlyTotalDebt",
  "quarterlyCashCashEquivalentsAndShortTermInvestments",
  "quarterlyStockholdersEquity",
  "quarterlyDilutedEPS",
  "annualTotalRevenue",
  "annualNetIncome",
  "annualDilutedEPS",
  "trailingMarketCap",
  "trailingEnterpriseValue",
  "trailingPeRatio",
  "trailingForwardPeRatio",
  "trailingPegRatio"
] as const;

const QUOTE_SUMMARY_MODULES = [
  "assetProfile",
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "calendarEvents",
  "fundProfile",
  "topHoldings"
] as const;

const FUNDAMENTAL_METRICS: MetricSpecification[] = [
  {
    type: "quarterlyGrossProfit",
    key: "gross-profit-quarterly",
    label: "Quarterly gross profit",
    unit: "currency"
  },
  {
    type: "quarterlyOperatingIncome",
    key: "operating-income-quarterly",
    label: "Quarterly operating income",
    unit: "currency"
  },
  {
    type: "quarterlyOperatingCashFlow",
    key: "operating-cash-flow-quarterly",
    label: "Quarterly operating cash flow",
    unit: "currency"
  },
  {
    type: "quarterlyFreeCashFlow",
    key: "free-cash-flow-quarterly",
    label: "Quarterly free cash flow",
    unit: "currency"
  },
  {
    type: "quarterlyTotalDebt",
    key: "total-debt-quarterly",
    label: "Quarterly total debt",
    unit: "currency"
  },
  {
    type: "quarterlyCashCashEquivalentsAndShortTermInvestments",
    key: "cash-and-short-term-investments-quarterly",
    label: "Cash and short-term investments",
    unit: "currency"
  },
  {
    type: "quarterlyStockholdersEquity",
    key: "shareholders-equity-quarterly",
    label: "Quarterly shareholders' equity",
    unit: "currency"
  }
];

const EARNINGS_METRICS: MetricSpecification[] = [
  {
    type: "quarterlyTotalRevenue",
    key: "revenue-quarterly",
    label: "Quarterly revenue",
    unit: "currency"
  },
  {
    type: "quarterlyNetIncome",
    key: "net-income-quarterly",
    label: "Quarterly net income",
    unit: "currency"
  },
  {
    type: "quarterlyDilutedEPS",
    key: "diluted-eps-quarterly",
    label: "Quarterly diluted EPS",
    unit: "per-share"
  },
  {
    type: "annualTotalRevenue",
    key: "revenue-annual",
    label: "Annual revenue",
    unit: "currency"
  },
  {
    type: "annualNetIncome",
    key: "net-income-annual",
    label: "Annual net income",
    unit: "currency"
  },
  {
    type: "annualDilutedEPS",
    key: "diluted-eps-annual",
    label: "Annual diluted EPS",
    unit: "per-share"
  }
];

const VALUATION_METRICS: MetricSpecification[] = [
  {
    type: "trailingMarketCap",
    key: "market-cap",
    label: "Market capitalization",
    unit: "currency"
  },
  {
    type: "trailingEnterpriseValue",
    key: "enterprise-value",
    label: "Enterprise value",
    unit: "currency"
  },
  {
    type: "trailingPeRatio",
    key: "trailing-pe",
    label: "Trailing P/E",
    unit: "ratio"
  },
  {
    type: "trailingForwardPeRatio",
    key: "forward-pe",
    label: "Forward P/E",
    unit: "ratio"
  },
  {
    type: "trailingPegRatio",
    key: "peg-ratio",
    label: "PEG ratio",
    unit: "ratio"
  }
];

export class SecurityResearchError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: SecurityResearchIssueCode | "INVALID_SYMBOL",
    public readonly provider: SecurityResearchProviderId | "validation",
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "SecurityResearchError";
  }
}

export class YahooSecurityResearchProvider implements SecurityResearchProvider {
  private readonly cache = new Map<string, CachedResearch>();
  private readonly inFlight = new Map<string, Promise<SecurityResearchReport>>();
  private readonly cacheMs: number;
  private readonly maxCacheEntries: number;
  private readonly timeoutMs: number;
  private readonly sessionCacheMs: number;
  private readonly newsLimit: number;
  private readonly fetchImpl: typeof fetch;
  private readonly historyProvider: MarketHistoryProvider;
  private readonly now: () => number;
  private yahooSession: YahooSession | null = null;
  private yahooSessionPromise: Promise<YahooSession> | null = null;

  constructor(options: YahooSecurityResearchProviderOptions = {}) {
    this.cacheMs = positiveFiniteNumber(options.cacheMs, 5 * 60_000);
    this.maxCacheEntries = positiveInteger(options.maxCacheEntries, 200);
    this.timeoutMs = positiveFiniteNumber(options.timeoutMs, 7_500);
    this.sessionCacheMs = positiveFiniteNumber(options.sessionCacheMs, 15 * 60_000);
    this.newsLimit = positiveInteger(options.newsLimit, 10);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.historyProvider =
      options.historyProvider ??
      new YahooMarketHistoryProvider({
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        now: this.now
      });
  }

  async getResearch(rawSymbol: string): Promise<SecurityResearchReport> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!isSafeMarketSymbol(symbol)) {
      throw new SecurityResearchError(
        "Unsupported instrument symbol",
        400,
        "INVALID_SYMBOL",
        "validation",
        false
      );
    }

    const cached = this.cache.get(symbol);
    if (cached && cached.expiresAt > this.now()) return cached.report;
    if (cached) this.cache.delete(symbol);

    const currentRequest = this.inFlight.get(symbol);
    if (currentRequest) return currentRequest;

    const request = this.loadResearch(symbol).finally(() => {
      this.inFlight.delete(symbol);
    });
    this.inFlight.set(symbol, request);
    return request;
  }

  private async loadResearch(symbol: string): Promise<SecurityResearchReport> {
    const generatedAt = new Date(this.now()).toISOString();
    const [search, summary, fundamentals, history] = await Promise.all([
      this.capture(this.fetchSearch(symbol), SEARCH_PROVIDER),
      this.capture(this.fetchQuoteSummary(symbol), SUMMARY_PROVIDER),
      this.capture(this.fetchFundamentals(symbol), FUNDAMENTALS_PROVIDER),
      this.capture(this.historyProvider.getHistory(symbol, "1y"), HISTORY_PROVIDER)
    ]);

    const researchFundamentalsUrl = fundamentalsUrl(symbol, this.now());
    const series = fundamentals.value ? parseTimeseries(fundamentals.value) : new Map();
    const profile = buildProfileSection(symbol, generatedAt, search, summary);
    const fundamentalsSection = buildFundamentalsSection(
      series,
      fundamentals,
      researchFundamentalsUrl,
      generatedAt
    );
    const valuation = buildValuationSection(
      series,
      fundamentals,
      summary,
      researchFundamentalsUrl,
      quoteStatisticsUrl(symbol),
      generatedAt
    );
    const earnings = buildEarningsSection(
      series,
      fundamentals,
      researchFundamentalsUrl,
      generatedAt
    );
    const dividends = buildDividendsSection(
      symbol,
      generatedAt,
      summary
    );
    const analystConsensus = buildAnalystConsensusSection(
      symbol,
      generatedAt,
      summary
    );
    const fundProfile = isEtfQuoteType(profile.data?.quoteType)
      ? buildFundProfileSection(symbol, generatedAt, summary)
      : undefined;
    const newsAndCatalysts = buildNewsAndCatalystsSection(
      symbol,
      generatedAt,
      this.newsLimit,
      search,
      summary
    );
    const priceRisk = buildPriceRiskSection(symbol, generatedAt, history);

    const sections = [
      profile,
      fundamentalsSection,
      valuation,
      earnings,
      dividends,
      analystConsensus,
      ...(fundProfile ? [fundProfile] : []),
      newsAndCatalysts,
      priceRisk
    ];
    const overallStatus = overallResearchStatus(sections.map(({ status }) => status));
    const report: SecurityResearchReport = {
      symbol,
      generatedAt,
      overallStatus,
      profile,
      fundamentals: fundamentalsSection,
      valuation,
      earnings,
      dividends,
      analystConsensus,
      ...(fundProfile ? { fundProfile } : {}),
      newsAndCatalysts,
      priceRisk,
      notices: [
        "Live external sources are used for security research; mock data is not used in this report.",
        "Provider-reported estimates and headlines are informational and may change after publication.",
        "Price-risk statistics describe historical prices and are not a forecast or suitability assessment."
      ]
    };

    if (overallStatus !== "unavailable") this.cacheReport(symbol, report);
    return report;
  }

  private async capture<T>(
    operation: Promise<T>,
    provider: SecurityResearchProviderId
  ): Promise<ProviderOutcome<T>> {
    try {
      return { value: await operation, issue: null };
    } catch (error) {
      return { value: null, issue: issueFromError(error, provider) };
    }
  }

  private async fetchSearch(symbol: string): Promise<unknown> {
    const url = searchApiUrl(symbol, this.newsLimit);
    return this.fetchJson(url, SEARCH_PROVIDER, {
      headers: yahooHeaders()
    });
  }

  private async fetchFundamentals(symbol: string): Promise<unknown> {
    const url = fundamentalsUrl(symbol, this.now());
    const body = await this.fetchJson(new URL(url), FUNDAMENTALS_PROVIDER, {
      headers: yahooHeaders()
    });
    const error = asRecord(asRecord(body)?.timeseries)?.error;
    if (error) throw providerBodyError(error, FUNDAMENTALS_PROVIDER);
    return body;
  }

  private async fetchQuoteSummary(symbol: string): Promise<unknown> {
    try {
      return await this.fetchQuoteSummaryAttempt(symbol, false);
    } catch (error) {
      if (
        error instanceof SecurityResearchError &&
        error.code === "UNAUTHORIZED"
      ) {
        return this.fetchQuoteSummaryAttempt(symbol, true);
      }
      throw error;
    }
  }

  private async fetchQuoteSummaryAttempt(
    symbol: string,
    refreshSession: boolean
  ): Promise<unknown> {
    const session = await this.getYahooSession(refreshSession);
    const url = new URL(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    );
    url.searchParams.set("modules", QUOTE_SUMMARY_MODULES.join(","));
    url.searchParams.set("crumb", session.crumb);
    const body = await this.fetchJson(url, SUMMARY_PROVIDER, {
      headers: {
        ...yahooHeaders(),
        cookie: session.cookie
      }
    });
    const quoteSummary = asRecord(asRecord(body)?.quoteSummary);
    if (!quoteSummary) {
      throw providerError(
        "Yahoo quote summary returned an invalid response",
        502,
        "INVALID_RESPONSE",
        SUMMARY_PROVIDER,
        false
      );
    }
    if (quoteSummary.error) {
      throw providerBodyError(quoteSummary.error, SUMMARY_PROVIDER);
    }
    const result = Array.isArray(quoteSummary.result) ? quoteSummary.result[0] : null;
    if (!asRecord(result)) {
      throw providerError(
        `Yahoo quote summary found no data for ${symbol}`,
        404,
        "NOT_FOUND",
        SUMMARY_PROVIDER,
        false
      );
    }
    return result;
  }

  private async getYahooSession(forceRefresh: boolean): Promise<YahooSession> {
    if (forceRefresh) {
      this.yahooSession = null;
      this.yahooSessionPromise = null;
    }
    if (this.yahooSession && this.yahooSession.expiresAt > this.now()) {
      return this.yahooSession;
    }
    if (this.yahooSessionPromise) return this.yahooSessionPromise;

    const sessionRequest = this.createYahooSession().finally(() => {
      this.yahooSessionPromise = null;
    });
    this.yahooSessionPromise = sessionRequest;
    return sessionRequest;
  }

  private async createYahooSession(): Promise<YahooSession> {
    const cookieResponse = await this.fetchRaw(new URL("https://fc.yahoo.com/"), {
      headers: yahooHeaders()
    }, SUMMARY_PROVIDER);
    const cookie = extractCookieHeader(cookieResponse);
    if (!cookie) {
      throw providerError(
        "Yahoo session bootstrap returned no cookie",
        502,
        "INVALID_RESPONSE",
        SUMMARY_PROVIDER,
        false
      );
    }

    const crumbResponse = await this.fetchRaw(
      new URL("https://query1.finance.yahoo.com/v1/test/getcrumb"),
      { headers: { ...yahooHeaders(), cookie } },
      SUMMARY_PROVIDER
    );
    assertUsableResponse(crumbResponse, SUMMARY_PROVIDER);
    const crumb = (await crumbResponse.text()).trim();
    if (!crumb || crumb.length > 1_024 || /<html/i.test(crumb)) {
      throw providerError(
        "Yahoo session bootstrap returned an invalid crumb",
        502,
        "INVALID_RESPONSE",
        SUMMARY_PROVIDER,
        false
      );
    }

    const session: YahooSession = {
      cookie,
      crumb,
      expiresAt: this.now() + this.sessionCacheMs
    };
    this.yahooSession = session;
    return session;
  }

  private async fetchJson(
    url: URL,
    provider: SecurityResearchProviderId,
    init: RequestInit
  ): Promise<unknown> {
    const response = await this.fetchRaw(url, init, provider);
    assertUsableResponse(response, provider);
    try {
      return await response.json();
    } catch {
      throw providerError(
        `${providerLabel(provider)} returned invalid JSON`,
        502,
        "INVALID_RESPONSE",
        provider,
        false
      );
    }
  }

  private async fetchRaw(
    url: URL,
    init: RequestInit,
    provider: SecurityResearchProviderId
  ): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw providerError(
        timedOut
          ? `${providerLabel(provider)} request timed out`
          : `${providerLabel(provider)} is unavailable`,
        503,
        timedOut ? "TIMEOUT" : "PROVIDER_UNAVAILABLE",
        provider,
        true
      );
    }
  }

  private cacheReport(symbol: string, report: SecurityResearchReport): void {
    const now = this.now();
    for (const [cachedSymbol, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(cachedSymbol);
    }

    this.cache.delete(symbol);
    while (this.cache.size >= this.maxCacheEntries) {
      const oldestSymbol = this.cache.keys().next().value as string | undefined;
      if (oldestSymbol === undefined) break;
      this.cache.delete(oldestSymbol);
    }
    this.cache.set(symbol, { report, expiresAt: now + this.cacheMs });
  }
}

function buildProfileSection(
  symbol: string,
  generatedAt: string,
  search: ProviderOutcome<unknown>,
  summary: ProviderOutcome<unknown>
): SecurityResearchSection<SecurityCompanyProfile> {
  const searchQuote = findSearchQuote(search.value, symbol);
  const summaryRoot = asRecord(summary.value);
  const assetProfile = asRecord(summaryRoot?.assetProfile);
  const price = asRecord(summaryRoot?.price);
  const name =
    nonEmptyString(price?.longName) ??
    nonEmptyString(price?.shortName) ??
    nonEmptyString(searchQuote?.longname) ??
    nonEmptyString(searchQuote?.shortname);
  const sources: SecurityResearchSource[] = [];
  if (search.value && searchQuote) {
    sources.push(source(SEARCH_PROVIDER, "Yahoo Finance symbol search", quotePageUrl(symbol), generatedAt));
  }
  if (summary.value) {
    sources.push(source(SUMMARY_PROVIDER, "Yahoo Finance company profile", quoteProfileUrl(symbol), generatedAt));
  }
  const issues = compactIssues(search.issue, summary.issue);

  if (!name) {
    return unavailableSection(
      ["companyProfile"],
      issues.length > 0
        ? issues
        : [insufficientIssue(SUMMARY_PROVIDER, `No company profile was found for ${symbol}`)],
      sources
    );
  }

  const profile: SecurityCompanyProfile = {
    symbol,
    name,
    quoteType:
      nonEmptyString(price?.quoteType) ?? nonEmptyString(searchQuote?.quoteType),
    exchange:
      nonEmptyString(price?.exchangeName) ?? nonEmptyString(searchQuote?.exchange),
    exchangeDisplayName: nonEmptyString(searchQuote?.exchDisp),
    sector:
      nonEmptyString(assetProfile?.sector) ?? nonEmptyString(searchQuote?.sector),
    industry:
      nonEmptyString(assetProfile?.industry) ?? nonEmptyString(searchQuote?.industry),
    businessSummary: nonEmptyString(assetProfile?.longBusinessSummary),
    websiteUrl: validHttpUrl(assetProfile?.website),
    employeeCount: positiveFiniteInteger(assetProfile?.fullTimeEmployees),
    headquarters: {
      city: nonEmptyString(assetProfile?.city),
      state: nonEmptyString(assetProfile?.state),
      country: nonEmptyString(assetProfile?.country)
    },
    asOf: generatedAt
  };
  const unavailableFields = [
    ["quoteType", profile.quoteType],
    ["exchange", profile.exchange],
    ["sector", profile.sector],
    ["industry", profile.industry],
    ["businessSummary", profile.businessSummary],
    ["websiteUrl", profile.websiteUrl],
    ["employeeCount", profile.employeeCount],
    ["headquarters.country", profile.headquarters.country]
  ].flatMap(([field, value]) => (value === null ? [String(field)] : []));

  return {
    status: unavailableFields.length === 0 && issues.length === 0 ? "available" : "partial",
    data: profile,
    sources,
    unavailableFields,
    issues
  };
}

function buildFundamentalsSection(
  series: Map<string, SeriesDatum[]>,
  outcome: ProviderOutcome<unknown>,
  sourceUrl: string,
  retrievedAt: string
): SecurityResearchSection<SecurityFundamentals> {
  if (!outcome.value) {
    return unavailableSection(
      FUNDAMENTAL_METRICS.map(({ key }) => key),
      compactIssues(outcome.issue),
      []
    );
  }

  const metrics = FUNDAMENTAL_METRICS.flatMap((specification) => {
    const metric = latestProviderMetric(series, specification, sourceUrl);
    return metric ? [metric] : [];
  });
  const computed = [
    ratioMetric(
      series,
      "quarterlyGrossProfit",
      "quarterlyTotalRevenue",
      "gross-margin-quarterly",
      "Quarterly gross margin",
      sourceUrl,
      "gross profit / revenue"
    ),
    ratioMetric(
      series,
      "quarterlyOperatingIncome",
      "quarterlyTotalRevenue",
      "operating-margin-quarterly",
      "Quarterly operating margin",
      sourceUrl,
      "operating income / revenue"
    ),
    ratioMetric(
      series,
      "quarterlyNetIncome",
      "quarterlyTotalRevenue",
      "net-margin-quarterly",
      "Quarterly net margin",
      sourceUrl,
      "net income / revenue"
    ),
    ratioMetric(
      series,
      "quarterlyFreeCashFlow",
      "quarterlyTotalRevenue",
      "free-cash-flow-margin-quarterly",
      "Quarterly free-cash-flow margin",
      sourceUrl,
      "free cash flow / revenue"
    ),
    ratioMetric(
      series,
      "quarterlyTotalDebt",
      "quarterlyStockholdersEquity",
      "debt-to-equity-quarterly",
      "Quarterly debt to equity",
      sourceUrl,
      "total debt / shareholders' equity",
      "ratio"
    )
  ].filter((metric): metric is SecurityResearchMetric => metric !== null);
  metrics.push(...computed);

  const expectedKeys: SecurityResearchMetricKey[] = [
    ...FUNDAMENTAL_METRICS.map(({ key }) => key),
    "gross-margin-quarterly",
    "operating-margin-quarterly",
    "net-margin-quarterly",
    "free-cash-flow-margin-quarterly",
    "debt-to-equity-quarterly"
  ];
  return metricSection(
    { metrics },
    metrics,
    expectedKeys,
    FUNDAMENTALS_PROVIDER,
    source(FUNDAMENTALS_PROVIDER, "Yahoo Finance fundamentals timeseries", sourceUrl, retrievedAt),
    compactIssues(outcome.issue)
  );
}

function buildValuationSection(
  series: Map<string, SeriesDatum[]>,
  fundamentals: ProviderOutcome<unknown>,
  summary: ProviderOutcome<unknown>,
  fundamentalsSourceUrl: string,
  summarySourceUrl: string,
  retrievedAt: string
): SecurityResearchSection<SecurityValuation> {
  const providerMetrics = VALUATION_METRICS.flatMap((specification) => {
    const metric = latestProviderMetric(series, specification, fundamentalsSourceUrl);
    return metric ? [metric] : [];
  });
  const staleProviderMetrics = providerMetrics.filter(
    (metric) => !isCurrentValuationMetric(metric, retrievedAt)
  );
  const metrics = providerMetrics.filter((metric) =>
    isCurrentValuationMetric(metric, retrievedAt)
  );
  const summaryRoot = asRecord(summary.value);
  const summaryDetail = asRecord(summaryRoot?.summaryDetail);
  const statistics = asRecord(summaryRoot?.defaultKeyStatistics);
  const price = asRecord(summaryRoot?.price);
  const asOf = epochSecondsToIso(rawNumber(price?.regularMarketTime));
  const summaryCurrency = nonEmptyString(price?.currency);

  if (asOf) {
    const additions = [
      summaryMetric(
        statistics?.priceToBook,
        "price-to-book",
        "Price to book",
        "ratio",
        null,
        asOf,
        summarySourceUrl
      ),
      summaryMetric(
        summaryDetail?.priceToSalesTrailing12Months,
        "price-to-sales",
        "Price to sales (TTM)",
        "ratio",
        null,
        asOf,
        summarySourceUrl
      ),
      summaryMetric(
        statistics?.enterpriseToRevenue,
        "enterprise-value-to-revenue",
        "Enterprise value to revenue",
        "ratio",
        null,
        asOf,
        summarySourceUrl
      ),
      summaryMetric(
        statistics?.enterpriseToEbitda,
        "enterprise-value-to-ebitda",
        "Enterprise value to EBITDA",
        "ratio",
        null,
        asOf,
        summarySourceUrl
      ),
      summaryMetric(
        summaryDetail?.marketCap,
        "market-cap",
        "Market capitalization",
        "currency",
        summaryCurrency,
        asOf,
        summarySourceUrl
      )
    ];
    for (const addition of additions) {
      if (addition && !metrics.some(({ key }) => key === addition.key)) metrics.push(addition);
    }
  }

  const expectedKeys: SecurityResearchMetricKey[] = [
    ...VALUATION_METRICS.map(({ key }) => key),
    "price-to-book",
    "price-to-sales",
    "enterprise-value-to-revenue",
    "enterprise-value-to-ebitda"
  ];
  const sources: SecurityResearchSource[] = [];
  if (metrics.some(({ source }) => source === FUNDAMENTALS_PROVIDER)) {
    sources.push(
      source(FUNDAMENTALS_PROVIDER, "Yahoo Finance valuation timeseries", fundamentalsSourceUrl, retrievedAt)
    );
  }
  if (metrics.some(({ source }) => source === SUMMARY_PROVIDER)) {
    sources.push(
      source(SUMMARY_PROVIDER, "Yahoo Finance key statistics", summarySourceUrl, retrievedAt)
    );
  }
  const issues = compactIssues(fundamentals.issue, summary.issue);
  if (staleProviderMetrics.length > 0) {
    issues.push(
      insufficientIssue(
        FUNDAMENTALS_PROVIDER,
        `Omitted ${staleProviderMetrics.length} valuation metric(s) older than 14 days`
      )
    );
  }
  return metricSectionWithSources(
    { metrics },
    metrics,
    expectedKeys,
    FUNDAMENTALS_PROVIDER,
    sources,
    issues
  );
}

function buildEarningsSection(
  series: Map<string, SeriesDatum[]>,
  outcome: ProviderOutcome<unknown>,
  sourceUrl: string,
  retrievedAt: string
): SecurityResearchSection<SecurityEarnings> {
  if (!outcome.value) {
    return unavailableSection(
      EARNINGS_METRICS.map(({ key }) => key),
      compactIssues(outcome.issue),
      []
    );
  }
  const metrics = EARNINGS_METRICS.flatMap((specification) => {
    const metric = latestProviderMetric(series, specification, sourceUrl);
    return metric ? [metric] : [];
  });
  const growth = [
    yearOverYearMetric(
      series,
      "quarterlyTotalRevenue",
      "revenue-growth-yoy-quarterly",
      "Quarterly revenue growth (YoY)",
      sourceUrl
    ),
    yearOverYearMetric(
      series,
      "quarterlyNetIncome",
      "net-income-growth-yoy-quarterly",
      "Quarterly net-income growth (YoY)",
      sourceUrl
    ),
    yearOverYearMetric(
      series,
      "quarterlyDilutedEPS",
      "diluted-eps-growth-yoy-quarterly",
      "Quarterly diluted-EPS growth (YoY)",
      sourceUrl
    )
  ].filter((metric): metric is SecurityResearchMetric => metric !== null);
  metrics.push(...growth);
  const expectedKeys: SecurityResearchMetricKey[] = [
    ...EARNINGS_METRICS.map(({ key }) => key),
    "revenue-growth-yoy-quarterly",
    "net-income-growth-yoy-quarterly",
    "diluted-eps-growth-yoy-quarterly"
  ];
  return metricSection(
    { metrics },
    metrics,
    expectedKeys,
    FUNDAMENTALS_PROVIDER,
    source(FUNDAMENTALS_PROVIDER, "Yahoo Finance earnings timeseries", sourceUrl, retrievedAt),
    compactIssues(outcome.issue)
  );
}

function buildDividendsSection(
  symbol: string,
  retrievedAt: string,
  outcome: ProviderOutcome<unknown>
): SecurityResearchSection<SecurityDividends> {
  const sourceUrl = quoteStatisticsUrl(symbol);
  const sources = outcome.value
    ? [source(SUMMARY_PROVIDER, "Yahoo Finance dividend statistics", sourceUrl, retrievedAt)]
    : [];
  if (!outcome.value) {
    return unavailableSection(
      ["dividend-yield", "last-dividend"],
      compactIssues(outcome.issue),
      sources
    );
  }

  const root = asRecord(outcome.value);
  const summaryDetail = asRecord(root?.summaryDetail);
  const statistics = asRecord(root?.defaultKeyStatistics);
  const price = asRecord(root?.price);
  const asOf = epochSecondsToIso(rawNumber(price?.regularMarketTime));
  const currency = normalizedCurrency(price?.currency);
  const rawYield = rawNumber(asRecord(summaryDetail?.dividendYield)?.raw);
  const normalizedYield =
    rawYield !== null && rawYield >= 0 && Number.isFinite(rawYield * 100)
      ? rawYield * 100
      : null;
  const dividendYield =
    asOf !== null && normalizedYield !== null
      ? {
          key: "dividend-yield" as const,
          label: "Dividend yield",
          value: normalizedYield,
          unit: "percent" as const,
          currency: null,
          period: "TTM",
          asOf,
          asOfBasis: "provider-market-time" as const,
          source: SUMMARY_PROVIDER,
          sourceUrl,
          derivation: "provider-reported" as const,
          calculation: "provider decimal yield × 100"
        }
      : null;

  const lastAmount = rawNumber(asRecord(statistics?.lastDividendValue)?.raw);
  const lastDate = epochSecondsToIso(
    rawNumber(asRecord(statistics?.lastDividendDate)?.raw)
  );
  const lastDividend =
    lastAmount !== null && lastAmount > 0 && lastDate !== null && currency !== null
      ? {
          amount: lastAmount,
          currency,
          date: lastDate,
          dateBasis: "provider-reported-last-dividend-date" as const
        }
      : null;
  const unavailableFields = [
    ...(dividendYield === null ? ["dividend-yield"] : []),
    ...(lastDividend === null ? ["last-dividend"] : [])
  ];

  if (dividendYield === null && lastDividend === null) {
    return unavailableSection(
      unavailableFields,
      [
        ...compactIssues(outcome.issue),
        insufficientIssue(
          SUMMARY_PROVIDER,
          `Yahoo quote summary returned no usable dividend fields for ${symbol}`
        )
      ],
      sources
    );
  }

  return {
    status: unavailableFields.length === 0 ? "available" : "partial",
    data: {
      metrics: dividendYield === null ? [] : [dividendYield],
      lastDividend
    },
    sources,
    unavailableFields,
    issues: compactIssues(outcome.issue)
  };
}

const YAHOO_RECOMMENDATIONS: Readonly<
  Record<string, SecurityAnalystConsensus["recommendation"] | undefined>
> = {
  strong_buy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  underperform: "Underperform",
  sell: "Sell"
};

function normalizedYahooRecommendation(value: unknown):
  | SecurityAnalystConsensus["recommendation"]
  | null {
  const key = nonEmptyString(value)
    ?.toLocaleLowerCase("en-US")
    .replace(/[\s-]+/gu, "_");
  return key ? YAHOO_RECOMMENDATIONS[key] ?? null : null;
}

function buildAnalystConsensusSection(
  symbol: string,
  retrievedAt: string,
  outcome: ProviderOutcome<unknown>
): SecurityResearchSection<SecurityAnalystConsensus> {
  const sourceUrl = quoteAnalysisUrl(symbol);
  const sources = outcome.value
    ? [source(SUMMARY_PROVIDER, "Yahoo Finance analyst estimates", sourceUrl, retrievedAt)]
    : [];
  if (!outcome.value) {
    return unavailableSection(
      ["recommendation", "analyst-count", "target-price"],
      compactIssues(outcome.issue),
      sources
    );
  }

  const root = asRecord(outcome.value);
  const financialData = asRecord(root?.financialData);
  const price = asRecord(root?.price);
  const recommendation = normalizedYahooRecommendation(
    financialData?.recommendationKey
  );
  const rawAnalystCount = rawNumber(
    asRecord(financialData?.numberOfAnalystOpinions)?.raw
  );
  const analystCount =
    rawAnalystCount !== null &&
    Number.isSafeInteger(rawAnalystCount) &&
    rawAnalystCount > 0
      ? rawAnalystCount
      : null;
  const targetPrice = rawNumber(asRecord(financialData?.targetMeanPrice)?.raw);
  const currency = normalizedCurrency(price?.currency);
  const asOf = epochSecondsToIso(rawNumber(price?.regularMarketTime));
  const unavailableFields = [
    ...(recommendation === null ? ["recommendation"] : []),
    ...(analystCount === null ? ["analyst-count"] : []),
    ...(targetPrice === null || targetPrice <= 0 ? ["target-price"] : []),
    ...(currency === null ? ["currency"] : []),
    ...(asOf === null ? ["as-of"] : [])
  ];

  if (
    recommendation === null ||
    analystCount === null ||
    targetPrice === null ||
    targetPrice <= 0 ||
    currency === null ||
    asOf === null
  ) {
    return unavailableSection(
      unavailableFields,
      [
        ...compactIssues(outcome.issue),
        insufficientIssue(
          SUMMARY_PROVIDER,
          `Yahoo quote summary returned an incomplete analyst consensus for ${symbol}`
        )
      ],
      sources
    );
  }

  return {
    status: "available",
    data: {
      recommendation,
      analystCount,
      targetPrice,
      currency,
      asOf
    },
    sources,
    unavailableFields: [],
    issues: compactIssues(outcome.issue)
  };
}

const FUND_METRIC_KEYS = [
  "etf-expense-ratio",
  "etf-total-assets",
  "etf-average-volume",
  "etf-distribution-yield",
  "etf-bond-duration",
  "etf-bond-maturity"
] as const satisfies readonly SecurityResearchMetricKey[];

const FUND_CREDIT_RATING_KEYS: Readonly<
  Record<string, SecurityFundCreditRating | undefined>
> = {
  aaa: "AAA",
  aa: "AA",
  a: "A",
  bbb: "BBB",
  bb: "BB",
  b: "B",
  below_b: "BELOW_B",
  us_government: "US_GOVERNMENT",
  other: "OTHER"
};

function fundMetric(input: {
  rawValue: unknown;
  key: (typeof FUND_METRIC_KEYS)[number];
  label: string;
  unit: SecurityResearchMetricUnit;
  currency: string | null;
  asOf: string;
  sourceUrl: string;
  multiplier?: number;
  calculation?: string;
}): SecurityResearchMetric | null {
  const raw = rawNumber(asRecord(input.rawValue)?.raw);
  if (raw === null || raw < 0) return null;
  const multiplier = input.multiplier ?? 1;
  const value = raw * multiplier;
  if (!Number.isFinite(value)) return null;
  return {
    key: input.key,
    label: input.label,
    value: round(value),
    unit: input.unit,
    currency: input.currency,
    period: "provider-current",
    asOf: input.asOf,
    asOfBasis: "provider-retrieved-at",
    source: SUMMARY_PROVIDER,
    sourceUrl: input.sourceUrl,
    derivation: input.multiplier === undefined ? "provider-reported" : "computed",
    calculation: input.calculation ?? null
  };
}

function parseFundHoldings(
  value: unknown,
  asOf: string
): SecurityFundHolding[] {
  if (!Array.isArray(value)) return [];
  const holdings: SecurityFundHolding[] = [];
  for (const rawHolding of value.slice(0, 25)) {
    const holding = asRecord(rawHolding);
    const symbol = nonEmptyString(holding?.symbol);
    const name = nonEmptyString(holding?.holdingName);
    const weight = rawNumber(asRecord(holding?.holdingPercent)?.raw);
    if (
      !symbol ||
      !name ||
      weight === null ||
      weight < 0 ||
      weight > 1
    ) continue;
    holdings.push({
      symbol: normalizeMarketSymbol(symbol),
      name,
      weightPercent: round(weight * 100),
      asOf
    });
  }
  return holdings;
}

function parseFundCreditQuality(
  value: unknown,
  asOf: string
): SecurityFundCreditQuality[] {
  if (!Array.isArray(value)) return [];
  const ratings: SecurityFundCreditQuality[] = [];
  for (const rawRating of value) {
    const record = asRecord(rawRating);
    if (!record) continue;
    for (const [providerKey, wrappedWeight] of Object.entries(record)) {
      const rating = FUND_CREDIT_RATING_KEYS[providerKey];
      const weight = rawNumber(asRecord(wrappedWeight)?.raw);
      if (
        rating === undefined ||
        weight === null ||
        weight < 0 ||
        weight > 1
      ) continue;
      ratings.push({
        rating,
        weightPercent: round(weight * 100),
        asOf
      });
    }
  }
  return ratings;
}

function buildFundProfileSection(
  symbol: string,
  retrievedAt: string,
  outcome: ProviderOutcome<unknown>
): SecurityResearchSection<SecurityFundProfile> {
  const sourceUrl = quoteHoldingsUrl(symbol);
  const sources = outcome.value
    ? [source(SUMMARY_PROVIDER, "Yahoo Finance fund profile and holdings", sourceUrl, retrievedAt)]
    : [];
  const expectedFields = [
    "objective",
    "tracked-index",
    "fund-family",
    "fund-category",
    "legal-type",
    ...FUND_METRIC_KEYS,
    "holdings-concentration",
    "credit-quality"
  ];
  if (!outcome.value) {
    return unavailableSection(
      expectedFields,
      compactIssues(outcome.issue),
      sources
    );
  }

  const root = asRecord(outcome.value);
  const profile = asRecord(root?.fundProfile);
  const fees = asRecord(profile?.feesExpensesInvestment);
  const summary = asRecord(root?.summaryDetail);
  const topHoldings = asRecord(root?.topHoldings);
  const bondHoldings = asRecord(topHoldings?.bondHoldings);
  const price = asRecord(root?.price);
  const currency = normalizedCurrency(price?.currency);
  const family = nonEmptyString(profile?.family);
  const categoryName = nonEmptyString(profile?.categoryName);
  const legalType = nonEmptyString(profile?.legalType);

  const metrics = [
    fundMetric({
      rawValue: fees?.annualReportExpenseRatio,
      key: "etf-expense-ratio",
      label: "Annual report expense ratio",
      unit: "percent",
      currency: null,
      asOf: retrievedAt,
      sourceUrl,
      multiplier: 100,
      calculation: "provider decimal ratio × 100"
    }),
    fundMetric({
      rawValue: summary?.totalAssets,
      key: "etf-total-assets",
      label: "Fund total assets",
      unit: "currency",
      currency,
      asOf: retrievedAt,
      sourceUrl
    }),
    fundMetric({
      rawValue: summary?.averageVolume,
      key: "etf-average-volume",
      label: "Average daily trading volume",
      unit: "shares",
      currency: null,
      asOf: retrievedAt,
      sourceUrl
    }),
    fundMetric({
      rawValue: summary?.yield,
      key: "etf-distribution-yield",
      label: "Fund distribution yield",
      unit: "percent",
      currency: null,
      asOf: retrievedAt,
      sourceUrl,
      multiplier: 100,
      calculation: "provider decimal yield × 100"
    }),
    fundMetric({
      rawValue: bondHoldings?.duration,
      key: "etf-bond-duration",
      label: "Bond portfolio duration",
      unit: "years",
      currency: null,
      asOf: retrievedAt,
      sourceUrl
    }),
    fundMetric({
      rawValue: bondHoldings?.maturity,
      key: "etf-bond-maturity",
      label: "Bond portfolio maturity",
      unit: "years",
      currency: null,
      asOf: retrievedAt,
      sourceUrl
    })
  ].filter((metric): metric is SecurityResearchMetric => metric !== null);
  const holdings = parseFundHoldings(topHoldings?.holdings, retrievedAt);
  const creditQuality = parseFundCreditQuality(topHoldings?.bondRatings, retrievedAt);
  const presentKeys = new Set(metrics.map(({ key }) => key));
  const unavailableFields = [
    // These quoteSummary modules do not expose an objective or tracked index.
    "objective",
    "tracked-index",
    ...(family === null ? ["fund-family"] : []),
    ...(categoryName === null ? ["fund-category"] : []),
    ...(legalType === null ? ["legal-type"] : []),
    ...FUND_METRIC_KEYS.filter((key) => !presentKeys.has(key)),
    ...(holdings.length === 0 ? ["holdings-concentration"] : []),
    ...(creditQuality.length === 0 ? ["credit-quality"] : [])
  ];
  const hasUsableData =
    family !== null ||
    categoryName !== null ||
    legalType !== null ||
    metrics.length > 0 ||
    holdings.length > 0 ||
    creditQuality.length > 0;
  if (!hasUsableData) {
    return unavailableSection(
      unavailableFields,
      [
        ...compactIssues(outcome.issue),
        insufficientIssue(
          SUMMARY_PROVIDER,
          `Yahoo quote summary returned no usable fund fields for ${symbol}`
        )
      ],
      sources
    );
  }

  return {
    status: "partial",
    data: {
      family,
      categoryName,
      legalType,
      objective: null,
      trackedIndex: null,
      metrics,
      holdings,
      creditQuality
    },
    sources,
    unavailableFields,
    issues: compactIssues(outcome.issue)
  };
}

function buildNewsAndCatalystsSection(
  symbol: string,
  generatedAt: string,
  newsLimit: number,
  search: ProviderOutcome<unknown>,
  summary: ProviderOutcome<unknown>
): SecurityResearchSection<SecurityNewsAndCatalysts> {
  const news = parseNews(search.value, symbol, newsLimit);
  const catalysts = parseCatalysts(summary.value, symbol, generatedAt);
  const sources: SecurityResearchSource[] = [];
  if (search.value) {
    sources.push(source(SEARCH_PROVIDER, "Yahoo Finance recent news", quoteNewsUrl(symbol), generatedAt));
  }
  if (summary.value) {
    sources.push(source(SUMMARY_PROVIDER, "Yahoo Finance corporate calendar", quoteCalendarUrl(symbol), generatedAt));
  }
  const issues = compactIssues(search.issue, summary.issue);
  if (!search.value && !summary.value) {
    return unavailableSection(["news", "catalysts"], issues, sources);
  }
  if (news.length === 0 && catalysts.length === 0) {
    return unavailableSection(
      ["news", "catalysts"],
      issues.length > 0
        ? issues
        : [
            insufficientIssue(
              SEARCH_PROVIDER,
              `No title-verified news or dated corporate catalysts were found for ${symbol}`
            )
          ],
      sources
    );
  }
  const unavailableFields = [
    ...(news.length === 0 ? ["news"] : []),
    ...(catalysts.length === 0 ? ["catalysts"] : [])
  ];
  return {
    status:
      unavailableFields.length === 0 && issues.length === 0
        ? "available"
        : "partial",
    data: { news, catalysts },
    sources,
    unavailableFields,
    issues
  };
}

function buildPriceRiskSection(
  symbol: string,
  retrievedAt: string,
  history: ProviderOutcome<MarketHistorySeries>
): SecurityResearchSection<SecurityPriceRisk> {
  if (!history.value) {
    return unavailableSection(
      ["priceRisk"],
      compactIssues(history.issue),
      []
    );
  }
  const series = history.value;
  const points = series.points.filter(({ close }) => close > 0);
  const first = points[0];
  const last = points.at(-1);
  const sourceUrl = historyApiUrl(symbol);
  const researchSource = source(HISTORY_PROVIDER, series.source, sourceUrl, retrievedAt);
  if (!first || !last || points.length < 2) {
    return unavailableSection(
      ["priceRisk"],
      [insufficientIssue(HISTORY_PROVIDER, `At least two price observations are required for ${symbol}`)],
      [researchSource]
    );
  }

  const simpleReturns: number[] = [];
  const logReturns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const prior = points[index - 1];
    const current = points[index];
    if (!prior || !current || prior.close <= 0 || current.close <= 0) continue;
    simpleReturns.push(current.close / prior.close - 1);
    logReturns.push(Math.log(current.close / prior.close));
  }
  if (simpleReturns.length === 0) {
    return unavailableSection(
      ["priceRisk"],
      [insufficientIssue(HISTORY_PROVIDER, `No usable returns were available for ${symbol}`)],
      [researchSource]
    );
  }

  const metric = (
    key: SecurityResearchMetricKey,
    label: string,
    value: number,
    unit: SecurityResearchMetricUnit,
    calculation: string
  ): SecurityResearchMetric => ({
    key,
    label,
    value: round(value),
    unit,
    currency: unit === "currency" ? series.currency : null,
    period: "1Y",
    asOf: series.asOf,
    asOfBasis: "history-end",
    source: HISTORY_PROVIDER,
    sourceUrl,
    derivation: "computed",
    calculation
  });

  const closes = points.map(({ close }) => close);
  const metrics: SecurityResearchMetric[] = [
    metric(
      "total-return",
      "One-year price return",
      (last.close / first.close - 1) * 100,
      "percent",
      "(ending close / starting close - 1) × 100; dividends are excluded"
    ),
    metric(
      "maximum-drawdown",
      "Maximum drawdown",
      maximumDrawdown(closes) * 100,
      "percent",
      "largest peak-to-trough close-price decline, reported as a positive loss magnitude"
    ),
    metric(
      "best-period-return",
      `Best ${series.interval} return`,
      Math.max(...simpleReturns) * 100,
      "percent",
      "largest adjacent close-to-close simple return"
    ),
    metric(
      "worst-period-return",
      `Worst ${series.interval} return`,
      Math.min(...simpleReturns) * 100,
      "percent",
      "smallest adjacent close-to-close simple return"
    ),
    metric(
      "period-high",
      "One-year high close",
      Math.max(...closes),
      "currency",
      "highest close in the returned one-year history"
    ),
    metric(
      "period-low",
      "One-year low close",
      Math.min(...closes),
      "currency",
      "lowest close in the returned one-year history"
    )
  ];
  const unavailableFields: string[] = [];
  const issues: SecurityResearchIssue[] = [];
  if (series.interval === "1d" && logReturns.length >= 20) {
    metrics.push(
      metric(
        "annualized-volatility",
        "Annualized historical volatility",
        sampleStandardDeviation(logReturns) * Math.sqrt(252) * 100,
        "percent",
        "sample standard deviation of log returns × √252"
      ),
      metric(
        "downside-volatility",
        "Annualized downside volatility",
        downsideDeviation(logReturns) * Math.sqrt(252) * 100,
        "percent",
        "root mean square of negative log returns across all observations × √252"
      )
    );
  } else {
    unavailableFields.push("annualized-volatility", "downside-volatility");
    issues.push(
      insufficientIssue(
        HISTORY_PROVIDER,
        series.interval === "1d"
          ? "At least 20 return observations are required for annualized volatility"
          : "Daily history is required for 252-period annualized volatility"
      )
    );
  }

  return {
    status: unavailableFields.length === 0 ? "available" : "partial",
    data: {
      methodologyVersion: "single-security-price-risk-v1",
      window: "1y",
      interval: series.interval,
      observations: points.length,
      returnObservations: simpleReturns.length,
      periodStart: first.timestamp,
      periodEnd: series.asOf,
      metrics,
      methodologyNotes: [
        "Statistics use the Yahoo chart close series as returned; no separate local corporate-action adjustment is applied.",
        "Annualization assumes 252 trading periods and is only emitted with at least 20 returns.",
        "Price return excludes dividends and other distributions, is not total return, and does not predict future results."
      ]
    },
    sources: [researchSource],
    unavailableFields,
    issues
  };
}

function parseTimeseries(body: unknown): Map<string, SeriesDatum[]> {
  const parsed = new Map<string, SeriesDatum[]>();
  const result = asRecord(asRecord(body)?.timeseries)?.result;
  if (!Array.isArray(result)) return parsed;

  for (const rawSeries of result) {
    const series = asRecord(rawSeries);
    const meta = asRecord(series?.meta);
    const types = Array.isArray(meta?.type) ? meta.type : [];
    const type = types.find((value): value is string => typeof value === "string");
    if (!series || !type) continue;
    const rawEntries = Array.isArray(series[type]) ? series[type] : [];
    const timestamps = Array.isArray(series.timestamp) ? series.timestamp : [];
    const entries: SeriesDatum[] = [];
    for (let index = 0; index < rawEntries.length; index += 1) {
      const entry = asRecord(rawEntries[index]);
      const reportedValue = asRecord(entry?.reportedValue);
      const value = rawNumber(reportedValue?.raw);
      const period = nonEmptyString(entry?.periodType);
      const asOf =
        dateStringToIso(nonEmptyString(entry?.asOfDate)) ??
        epochSecondsToIso(rawNumber(timestamps[index]));
      if (value === null || !period || !asOf) continue;
      entries.push({
        value,
        currency: nonEmptyString(entry?.currencyCode),
        period,
        asOf
      });
    }
    entries.sort((left, right) => left.asOf.localeCompare(right.asOf));
    if (entries.length > 0) parsed.set(type, entries);
  }
  return parsed;
}

function latestProviderMetric(
  series: Map<string, SeriesDatum[]>,
  specification: MetricSpecification,
  sourceUrl: string
): SecurityResearchMetric | null {
  const datum = series.get(specification.type)?.at(-1);
  if (!datum) return null;
  return {
    key: specification.key,
    label: specification.label,
    value: datum.value,
    unit: specification.unit,
    currency: specification.unit === "currency" || specification.unit === "per-share"
      ? datum.currency
      : null,
    period: datum.period,
    asOf: datum.asOf,
    asOfBasis: "provider-period",
    source: FUNDAMENTALS_PROVIDER,
    sourceUrl,
    derivation: "provider-reported",
    calculation: null
  };
}

function isCurrentValuationMetric(
  metric: SecurityResearchMetric,
  retrievedAt: string
): boolean {
  const metricTime = Date.parse(metric.asOf);
  const retrievalTime = Date.parse(retrievedAt);
  if (!Number.isFinite(metricTime) || !Number.isFinite(retrievalTime)) return false;
  const ageMs = retrievalTime - metricTime;
  return ageMs >= -24 * 60 * 60 * 1_000 && ageMs <= VALUATION_MAX_AGE_MS;
}

function ratioMetric(
  series: Map<string, SeriesDatum[]>,
  numeratorType: string,
  denominatorType: string,
  key: SecurityResearchMetricKey,
  label: string,
  sourceUrl: string,
  calculation: string,
  unit: "percent" | "ratio" = "percent"
): SecurityResearchMetric | null {
  const numerator = series.get(numeratorType)?.at(-1);
  const denominator = series.get(denominatorType)?.at(-1);
  if (
    !numerator ||
    !denominator ||
    numerator.asOf !== denominator.asOf ||
    numerator.period !== denominator.period ||
    denominator.value === 0
  ) {
    return null;
  }
  const multiplier = unit === "percent" ? 100 : 1;
  return {
    key,
    label,
    value: round((numerator.value / denominator.value) * multiplier),
    unit,
    currency: null,
    period: numerator.period,
    asOf: numerator.asOf,
    asOfBasis: "provider-period",
    source: FUNDAMENTALS_PROVIDER,
    sourceUrl,
    derivation: "computed",
    calculation
  };
}

function yearOverYearMetric(
  series: Map<string, SeriesDatum[]>,
  type: string,
  key: SecurityResearchMetricKey,
  label: string,
  sourceUrl: string
): SecurityResearchMetric | null {
  const entries = series.get(type);
  const latest = entries?.at(-1);
  const priorYear = latest && entries ? closestYearAgoDatum(entries, latest) : null;
  // A percentage-growth rate is not economically meaningful when its base is
  // zero/negative or when the current period is negative. In those cases the
  // surrounding earnings section marks this metric unavailable instead of
  // presenting a sign-flipped percentage (for example, profit to loss).
  if (!latest || !priorYear || priorYear.value <= 0 || latest.value < 0) return null;
  return {
    key,
    label,
    value: round((latest.value / priorYear.value - 1) * 100),
    unit: "percent",
    currency: null,
    period: "YoY (quarterly)",
    asOf: latest.asOf,
    asOfBasis: "provider-period",
    source: FUNDAMENTALS_PROVIDER,
    sourceUrl,
    derivation: "computed",
    calculation: `latest quarter / quarter ended ${priorYear.asOf.slice(0, 10)} - 1`
  };
}

function closestYearAgoDatum(
  entries: SeriesDatum[],
  latest: SeriesDatum
): SeriesDatum | null {
  const latestTime = new Date(latest.asOf).getTime();
  if (!Number.isFinite(latestTime)) return null;
  const targetTime = latestTime - 365.25 * 86_400_000;
  const minimumAge = 300 * 86_400_000;
  const maximumAge = 430 * 86_400_000;
  return (
    entries
      .filter((entry) => {
        const time = new Date(entry.asOf).getTime();
        const age = latestTime - time;
        return Number.isFinite(time) && age >= minimumAge && age <= maximumAge;
      })
      .sort(
        (left, right) =>
          Math.abs(new Date(left.asOf).getTime() - targetTime) -
          Math.abs(new Date(right.asOf).getTime() - targetTime)
      )[0] ?? null
  );
}

function summaryMetric(
  rawValue: unknown,
  key: SecurityResearchMetricKey,
  label: string,
  unit: SecurityResearchMetricUnit,
  currency: string | null,
  asOf: string,
  sourceUrl: string
): SecurityResearchMetric | null {
  const value = rawNumber(asRecord(rawValue)?.raw);
  if (value === null) return null;
  return {
    key,
    label,
    value,
    unit,
    currency,
    period: "TTM",
    asOf,
    asOfBasis: "provider-market-time",
    source: SUMMARY_PROVIDER,
    sourceUrl,
    derivation: "provider-reported",
    calculation: null
  };
}

function parseNews(body: unknown, symbol: string, newsLimit: number): SecurityNewsItem[] {
  const rawNews = asRecord(body)?.news;
  if (!Array.isArray(rawNews)) return [];
  const deduplicated = new Map<string, SecurityNewsItem>();
  for (const rawItem of rawNews) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const relatedSymbols = Array.isArray(item.relatedTickers)
      ? item.relatedTickers
          .filter((value): value is string => typeof value === "string")
          .map(normalizeMarketSymbol)
          .filter(isSafeMarketSymbol)
      : [];
    if (!relatedSymbols.includes(symbol)) continue;
    const headline = nonEmptyString(item.title);
    const url = validHttpUrl(item.link);
    const publishedAt = epochSecondsToIso(rawNumber(item.providerPublishTime));
    if (!headline || !url || !publishedAt) continue;
    if (!isMateriallyRelevantHeadline(body, symbol, headline)) continue;
    const id = nonEmptyString(item.uuid) ?? url;
    if (deduplicated.has(id)) continue;
    deduplicated.set(id, {
      id,
      headline,
      publisher: nonEmptyString(item.publisher),
      publishedAt,
      url,
      relatedSymbols,
      source: SEARCH_PROVIDER
    });
    if (deduplicated.size >= newsLimit) break;
  }
  return [...deduplicated.values()].sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt)
  );
}

const COMPANY_NAME_SUFFIXES = new Set([
  "a",
  "class",
  "co",
  "company",
  "common",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "limited",
  "ltd",
  "new",
  "ordinary",
  "plc",
  "shares",
  "stock"
]);

function normalizedNewsText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function companyHeadlineAliases(body: unknown, symbol: string): string[] {
  const quote = findSearchQuote(body, symbol);
  const names = [nonEmptyString(quote?.longname), nonEmptyString(quote?.shortname)]
    .filter((name): name is string => name !== null);
  const aliases = new Set<string>();
  for (const name of names) {
    const meaningfulTokens = normalizedNewsText(name)
      .split(/\s+/u)
      .filter((token) => token.length >= 2 && !COMPANY_NAME_SUFFIXES.has(token));
    if (meaningfulTokens.length === 0) continue;
    aliases.add(meaningfulTokens.join(" "));
    // One- and two-word company names are typically strong brand aliases
    // (NVIDIA, Apple, Meta Platforms, Goldman Sachs). Longer legal names must
    // match as a phrase to avoid treating generic words as company evidence.
    if (meaningfulTokens.length <= 2) {
      for (const token of meaningfulTokens) {
        if (token.length >= 4) aliases.add(token);
      }
    }
  }
  return [...aliases];
}

function headlineContainsTicker(headline: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = symbol.length <= 2 ? "u" : "iu";
  return new RegExp(`(?:^|[^A-Za-z0-9])\\$?${escaped}(?:$|[^A-Za-z0-9])`, flags).test(
    headline
  );
}

function isMateriallyRelevantHeadline(
  body: unknown,
  symbol: string,
  headline: string
): boolean {
  if (headlineContainsTicker(headline, symbol)) return true;
  const normalizedHeadline = ` ${normalizedNewsText(headline)} `;
  return companyHeadlineAliases(body, symbol).some((alias) =>
    normalizedHeadline.includes(` ${alias} `)
  );
}

function parseCatalysts(
  body: unknown,
  symbol: string,
  generatedAt: string
): SecurityCatalyst[] {
  const root = asRecord(body);
  const calendar = asRecord(root?.calendarEvents);
  const earnings = asRecord(calendar?.earnings);
  const nowMs = new Date(generatedAt).getTime();
  const sourceUrl = quoteCalendarUrl(symbol);
  const catalysts: SecurityCatalyst[] = [];
  const addCatalyst = (
    rawEvent: unknown,
    type: SecurityCatalyst["type"],
    title: string,
    estimated: boolean | null
  ): void => {
    const timestamp = rawNumber(asRecord(rawEvent)?.raw);
    const scheduledAt = epochSecondsToIso(timestamp);
    if (!scheduledAt || new Date(scheduledAt).getTime() < nowMs) return;
    catalysts.push({
      id: `${symbol}:${type}:${scheduledAt}`,
      type,
      title,
      scheduledAt,
      estimated,
      source: SUMMARY_PROVIDER,
      sourceUrl
    });
  };

  const earningsDates = Array.isArray(earnings?.earningsDate) ? earnings.earningsDate : [];
  for (const earningsDate of earningsDates) {
    addCatalyst(
      earningsDate,
      "earnings-date",
      `${symbol} earnings date`,
      typeof earnings?.isEarningsDateEstimate === "boolean"
        ? earnings.isEarningsDateEstimate
        : null
    );
  }
  addCatalyst(calendar?.exDividendDate, "ex-dividend-date", `${symbol} ex-dividend date`, null);
  addCatalyst(calendar?.dividendDate, "dividend-payment-date", `${symbol} dividend payment date`, null);
  return catalysts.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
}

function findSearchQuote(body: unknown, symbol: string): UnknownRecord | null {
  const quotes = asRecord(body)?.quotes;
  if (!Array.isArray(quotes)) return null;
  return (
    quotes.map(asRecord).find((quote) => {
      const quoteSymbol = nonEmptyString(quote?.symbol);
      return quoteSymbol ? normalizeMarketSymbol(quoteSymbol) === symbol : false;
    }) ?? null
  );
}

function metricSection<T extends SecurityFundamentals | SecurityEarnings>(
  data: T,
  metrics: SecurityResearchMetric[],
  expectedKeys: SecurityResearchMetricKey[],
  provider: SecurityResearchProviderId,
  researchSource: SecurityResearchSource,
  issues: SecurityResearchIssue[]
): SecurityResearchSection<T> {
  return metricSectionWithSources(
    data,
    metrics,
    expectedKeys,
    provider,
    [researchSource],
    issues
  );
}

function metricSectionWithSources<T extends SecurityFundamentals | SecurityValuation | SecurityEarnings>(
  data: T,
  metrics: SecurityResearchMetric[],
  expectedKeys: SecurityResearchMetricKey[],
  provider: SecurityResearchProviderId,
  sources: SecurityResearchSource[],
  issues: SecurityResearchIssue[]
): SecurityResearchSection<T> {
  const presentKeys = new Set(metrics.map(({ key }) => key));
  const unavailableFields = expectedKeys.filter((key) => !presentKeys.has(key));
  if (metrics.length === 0) {
    return unavailableSection(
      unavailableFields,
      issues.length > 0
        ? issues
        : [insufficientIssue(provider, "The provider returned no usable metrics")],
      sources
    );
  }
  return {
    status: unavailableFields.length === 0 && issues.length === 0 ? "available" : "partial",
    data,
    sources,
    unavailableFields,
    issues
  };
}

function unavailableSection<T>(
  unavailableFields: string[],
  issues: SecurityResearchIssue[],
  sources: SecurityResearchSource[]
): SecurityResearchSection<T> {
  return {
    status: "unavailable",
    data: null,
    sources,
    unavailableFields,
    issues
  };
}

function overallResearchStatus(statuses: SecurityResearchStatus[]): SecurityResearchStatus {
  if (statuses.every((status) => status === "available")) return "available";
  if (statuses.every((status) => status === "unavailable")) return "unavailable";
  return "partial";
}

function issueFromError(
  error: unknown,
  fallbackProvider: SecurityResearchProviderId
): SecurityResearchIssue {
  if (error instanceof SecurityResearchError) {
    return {
      provider: error.provider === "validation" ? fallbackProvider : error.provider,
      code: error.code === "INVALID_SYMBOL" ? "INVALID_RESPONSE" : error.code,
      message: error.message,
      retryable: error.retryable,
      httpStatus: error.statusCode
    };
  }
  if (error instanceof MarketDataError) {
    const code: SecurityResearchIssueCode =
      error.statusCode === 404
        ? "NOT_FOUND"
        : /timed out/i.test(error.message)
          ? "TIMEOUT"
          : error.statusCode === 503
            ? "PROVIDER_UNAVAILABLE"
            : "UPSTREAM_ERROR";
    return {
      provider: fallbackProvider,
      code,
      message: error.message,
      retryable: error.statusCode >= 500,
      httpStatus: error.statusCode
    };
  }
  return {
    provider: fallbackProvider,
    code: "PROVIDER_UNAVAILABLE",
    message: error instanceof Error ? error.message : `${providerLabel(fallbackProvider)} failed`,
    retryable: true,
    httpStatus: 503
  };
}

function assertUsableResponse(
  response: Response,
  provider: SecurityResearchProviderId
): void {
  if (response.ok) return;
  if (response.status === 404) {
    throw providerError(
      `${providerLabel(provider)} returned no data`,
      404,
      "NOT_FOUND",
      provider,
      false
    );
  }
  if (response.status === 429) {
    throw providerError(
      `${providerLabel(provider)} rate limit was reached`,
      503,
      "RATE_LIMITED",
      provider,
      true
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw providerError(
      `${providerLabel(provider)} rejected the request`,
      502,
      "UNAUTHORIZED",
      provider,
      false
    );
  }
  if (response.status >= 500) {
    throw providerError(
      `${providerLabel(provider)} returned ${response.status}`,
      503,
      "PROVIDER_UNAVAILABLE",
      provider,
      true
    );
  }
  throw providerError(
    `${providerLabel(provider)} returned ${response.status}`,
    502,
    "UPSTREAM_ERROR",
    provider,
    false
  );
}

function providerBodyError(
  rawError: unknown,
  provider: SecurityResearchProviderId
): SecurityResearchError {
  const error = asRecord(rawError);
  const code = nonEmptyString(error?.code) ?? "ProviderError";
  const description = nonEmptyString(error?.description) ?? `${providerLabel(provider)} error`;
  const combined = `${code} ${description}`;
  if (/crumb|unauthori[sz]ed|forbidden/i.test(combined)) {
    return providerError(description, 502, "UNAUTHORIZED", provider, false);
  }
  if (/not found|no data|invalid symbol/i.test(combined)) {
    return providerError(description, 404, "NOT_FOUND", provider, false);
  }
  if (/rate|too many/i.test(combined)) {
    return providerError(description, 503, "RATE_LIMITED", provider, true);
  }
  return providerError(description, 502, "UPSTREAM_ERROR", provider, false);
}

function providerError(
  message: string,
  statusCode: number,
  code: SecurityResearchIssueCode,
  provider: SecurityResearchProviderId,
  retryable: boolean
): SecurityResearchError {
  return new SecurityResearchError(message, statusCode, code, provider, retryable);
}

function insufficientIssue(
  provider: SecurityResearchProviderId,
  message: string
): SecurityResearchIssue {
  return {
    provider,
    code: "INSUFFICIENT_DATA",
    message,
    retryable: false,
    httpStatus: null
  };
}

function compactIssues(
  ...issues: Array<SecurityResearchIssue | null>
): SecurityResearchIssue[] {
  return issues.filter((issue): issue is SecurityResearchIssue => issue !== null);
}

function source(
  provider: SecurityResearchProviderId,
  label: string,
  url: string,
  retrievedAt: string
): SecurityResearchSource {
  return { provider, label, url, retrievedAt };
}

function yahooHeaders(): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "user-agent": "Mozilla/5.0"
  };
}

function extractCookieHeader(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [];
  const rawValues = values.length > 0
    ? values
    : response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie") as string]
      : [];
  const cookies = rawValues
    .map((value) => value.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean);
  return cookies.length > 0 ? cookies.join("; ") : null;
}

function searchApiUrl(symbol: string, newsLimit: number): URL {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", symbol);
  url.searchParams.set("quotesCount", "5");
  // Yahoo's relatedTickers metadata is intentionally broad. Request a bounded
  // candidate pool so title-level relevance filtering can still return up to
  // the configured number of genuinely company-specific articles.
  url.searchParams.set("newsCount", String(Math.min(30, newsLimit * 3)));
  url.searchParams.set("listsCount", "0");
  url.searchParams.set("enableFuzzyQuery", "false");
  return url;
}

function fundamentalsUrl(symbol: string, now: number): string {
  const url = new URL(
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
  );
  const period2 = Math.floor(now / 1_000) + 86_400;
  const period1 = period2 - 5 * 366 * 86_400;
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("type", FUNDAMENTAL_TYPES.join(","));
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  return url.toString();
}

function quotePageUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`;
}

function quoteProfileUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/profile/`;
}

function quoteStatisticsUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/key-statistics/`;
}

function quoteNewsUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/news/`;
}

function quoteCalendarUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis/`;
}

function quoteAnalysisUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis/`;
}

function quoteHoldingsUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/holdings/`;
}

function historyApiUrl(symbol: string): string {
  const url = new URL(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
  );
  url.searchParams.set("range", "1y");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");
  return url.toString();
}

function providerLabel(provider: SecurityResearchProviderId): string {
  const labels: Record<SecurityResearchProviderId, string> = {
    "synthetic-demo": "Synthetic offline demo data",
    "yahoo-search": "Yahoo Finance search",
    "yahoo-quote-summary": "Yahoo Finance quote summary",
    "yahoo-fundamentals": "Yahoo Finance fundamentals",
    "yahoo-history": "Yahoo Finance history"
  };
  return labels[provider];
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isEtfQuoteType(value: string | null | undefined): boolean {
  return value?.trim().toUpperCase().replace(/[ -]+/gu, "_") === "ETF" ||
    value?.trim().toUpperCase().replace(/[ -]+/gu, "_") === "EXCHANGE_TRADED_FUND";
}

function normalizedCurrency(value: unknown): string | null {
  const currency = nonEmptyString(value)?.toUpperCase();
  return currency && /^[A-Z]{3}$/u.test(currency) ? currency : null;
}

function rawNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveFiniteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function validHttpUrl(value: unknown): string | null {
  const stringValue = nonEmptyString(value);
  if (!stringValue) return null;
  try {
    const url = new URL(stringValue);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function dateStringToIso(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function epochSecondsToIso(value: number | null): string | null {
  if (value === null || value <= 0) return null;
  const date = new Date(value * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function maximumDrawdown(prices: number[]): number {
  let peak = prices[0] ?? 0;
  let largestLoss = 0;
  for (const price of prices) {
    if (price > peak) peak = price;
    if (peak <= 0) continue;
    largestLoss = Math.max(largestLoss, 1 - price / peak);
  }
  return largestLoss;
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function downsideDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const meanSquareDownside =
    values.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, meanSquareDownside));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function positiveFiniteNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}
