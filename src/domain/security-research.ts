export type SecurityResearchStatus = "available" | "partial" | "unavailable";

export type SecurityResearchProviderId =
  | "synthetic-demo"
  | "yahoo-search"
  | "yahoo-quote-summary"
  | "yahoo-fundamentals"
  | "yahoo-history";

export type SecurityResearchIssueCode =
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE"
  | "INSUFFICIENT_DATA";

export interface SecurityResearchIssue {
  provider: SecurityResearchProviderId;
  code: SecurityResearchIssueCode;
  message: string;
  retryable: boolean;
  httpStatus: number | null;
}

export interface SecurityResearchSource {
  provider: SecurityResearchProviderId;
  label: string;
  url: string | null;
  retrievedAt: string;
}

export interface SecurityResearchSection<T> {
  status: SecurityResearchStatus;
  data: T | null;
  sources: SecurityResearchSource[];
  unavailableFields: string[];
  issues: SecurityResearchIssue[];
}

export interface SecurityCompanyProfile {
  symbol: string;
  name: string;
  quoteType: string | null;
  exchange: string | null;
  exchangeDisplayName: string | null;
  sector: string | null;
  industry: string | null;
  businessSummary: string | null;
  websiteUrl: string | null;
  employeeCount: number | null;
  headquarters: {
    city: string | null;
    state: string | null;
    country: string | null;
  };
  asOf: string;
}

export type SecurityResearchMetricKey =
  | "revenue-quarterly"
  | "net-income-quarterly"
  | "gross-profit-quarterly"
  | "operating-income-quarterly"
  | "operating-cash-flow-quarterly"
  | "free-cash-flow-quarterly"
  | "total-debt-quarterly"
  | "cash-and-short-term-investments-quarterly"
  | "shareholders-equity-quarterly"
  | "revenue-annual"
  | "net-income-annual"
  | "diluted-eps-annual"
  | "diluted-eps-quarterly"
  | "gross-margin-quarterly"
  | "operating-margin-quarterly"
  | "net-margin-quarterly"
  | "free-cash-flow-margin-quarterly"
  | "debt-to-equity-quarterly"
  | "revenue-growth-yoy-quarterly"
  | "net-income-growth-yoy-quarterly"
  | "diluted-eps-growth-yoy-quarterly"
  | "market-cap"
  | "enterprise-value"
  | "trailing-pe"
  | "forward-pe"
  | "peg-ratio"
  | "price-to-book"
  | "price-to-sales"
  | "enterprise-value-to-revenue"
  | "enterprise-value-to-ebitda"
  | "dividend-yield"
  | "etf-expense-ratio"
  | "etf-total-assets"
  | "etf-average-volume"
  | "etf-distribution-yield"
  | "etf-bond-duration"
  | "etf-bond-maturity"
  | "total-return"
  | "annualized-volatility"
  | "downside-volatility"
  | "maximum-drawdown"
  | "best-period-return"
  | "worst-period-return"
  | "period-high"
  | "period-low";

export type SecurityResearchMetricUnit =
  | "currency"
  | "percent"
  | "ratio"
  | "per-share"
  | "shares"
  | "years";

export interface SecurityResearchMetric {
  key: SecurityResearchMetricKey;
  label: string;
  value: number;
  unit: SecurityResearchMetricUnit;
  currency: string | null;
  period: string;
  asOf: string;
  asOfBasis:
    | "provider-period"
    | "provider-market-time"
    | "provider-retrieved-at"
    | "history-end";
  source: SecurityResearchProviderId;
  sourceUrl: string;
  derivation: "provider-reported" | "computed";
  calculation: string | null;
}

export interface SecurityFundamentals {
  metrics: SecurityResearchMetric[];
}

export interface SecurityValuation {
  metrics: SecurityResearchMetric[];
}

export interface SecurityEarnings {
  metrics: SecurityResearchMetric[];
}

export interface SecurityLastDividend {
  amount: number;
  currency: string;
  date: string;
  dateBasis: "provider-reported-last-dividend-date";
}

export interface SecurityDividends {
  metrics: SecurityResearchMetric[];
  lastDividend: SecurityLastDividend | null;
}

export interface SecurityAnalystConsensus {
  recommendation: "Strong Buy" | "Buy" | "Hold" | "Underperform" | "Sell";
  analystCount: number;
  targetPrice: number;
  currency: string;
  asOf: string;
}

export interface SecurityFundHolding {
  symbol: string;
  name: string;
  weightPercent: number;
  asOf: string;
}

export type SecurityFundCreditRating =
  | "AAA"
  | "AA"
  | "A"
  | "BBB"
  | "BB"
  | "B"
  | "BELOW_B"
  | "US_GOVERNMENT"
  | "OTHER";

export interface SecurityFundCreditQuality {
  rating: SecurityFundCreditRating;
  weightPercent: number;
  asOf: string;
}

/**
 * Yahoo quoteSummary fields that are explicitly typed and reviewed for funds.
 * Objective and tracked index remain nullable because the configured modules
 * do not provide either field; callers must preserve that unavailability.
 */
export interface SecurityFundProfile {
  family: string | null;
  categoryName: string | null;
  legalType: string | null;
  objective: null;
  trackedIndex: null;
  metrics: SecurityResearchMetric[];
  holdings: SecurityFundHolding[];
  creditQuality: SecurityFundCreditQuality[];
}

export interface SecurityNewsItem {
  id: string;
  headline: string;
  publisher: string | null;
  publishedAt: string;
  url: string;
  relatedSymbols: string[];
  source: "yahoo-search";
}

export type SecurityCatalystType =
  | "earnings-date"
  | "ex-dividend-date"
  | "dividend-payment-date";

export interface SecurityCatalyst {
  id: string;
  type: SecurityCatalystType;
  title: string;
  scheduledAt: string;
  estimated: boolean | null;
  source: "yahoo-quote-summary";
  sourceUrl: string;
}

export interface SecurityNewsAndCatalysts {
  news: SecurityNewsItem[];
  catalysts: SecurityCatalyst[];
}

export interface SecurityPriceRisk {
  methodologyVersion: "single-security-price-risk-v1";
  window: "1y";
  interval: string;
  observations: number;
  returnObservations: number;
  periodStart: string;
  periodEnd: string;
  metrics: SecurityResearchMetric[];
  methodologyNotes: string[];
}

export interface SecurityResearchReport {
  symbol: string;
  generatedAt: string;
  overallStatus: SecurityResearchStatus;
  profile: SecurityResearchSection<SecurityCompanyProfile>;
  fundamentals: SecurityResearchSection<SecurityFundamentals>;
  valuation: SecurityResearchSection<SecurityValuation>;
  earnings: SecurityResearchSection<SecurityEarnings>;
  /**
   * Optional only for compatibility with previously persisted provider reports.
   * The active Yahoo provider always emits this governed section.
   */
  dividends?: SecurityResearchSection<SecurityDividends>;
  /**
   * Optional only for compatibility with previously persisted provider reports.
   * The active Yahoo provider always emits this governed section.
   */
  analystConsensus?: SecurityResearchSection<SecurityAnalystConsensus>;
  /**
   * Present only when Yahoo identifies the instrument as an ETF. Existing
   * persisted equity reports remain compatible by omitting this section.
   */
  fundProfile?: SecurityResearchSection<SecurityFundProfile>;
  newsAndCatalysts: SecurityResearchSection<SecurityNewsAndCatalysts>;
  priceRisk: SecurityResearchSection<SecurityPriceRisk>;
  notices: string[];
}
