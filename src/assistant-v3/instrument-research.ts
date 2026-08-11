import type {
  SecurityResearchMetric,
  SecurityResearchMetricKey,
  SecurityResearchReport,
  SecurityResearchSection,
  SecurityResearchSource
} from "../domain/security-research.js";
import type { MarketSnapshot } from "../domain/types.js";
import type { DecimalString } from "./contracts.js";
import { decimal } from "./fixed-decimal.js";
import type {
  ProviderLicenseClass,
  PublicMarketResearchPort,
  PublicProviderDescriptor
} from "./providers.js";

export const DATA_NOT_AVAILABLE = "DATA_NOT_AVAILABLE" as const;

export type DataUnavailableReason =
  | "SOURCE_FIELD_NOT_PROVIDED"
  | "PROVIDER_SECTION_UNAVAILABLE"
  | "PROVIDER_REQUEST_FAILED"
  | "NOT_APPLICABLE_TO_INSTRUMENT";

export interface FactAttribution {
  providerId: string;
  sourceId: string;
  label: string;
  url: string | null;
  retrievedAt: string;
  licenseClass: ProviderLicenseClass;
}

export interface AvailableFact<T> {
  status: "AVAILABLE";
  value: T;
  sources: FactAttribution[];
}

export interface UnavailableFact {
  status: typeof DATA_NOT_AVAILABLE;
  reason: DataUnavailableReason;
  detail: string;
  unavailableFields: string[];
  issueCodes: string[];
  sources: FactAttribution[];
}

export type DataFact<T> = AvailableFact<T> | UnavailableFact;

export interface InstrumentMetric {
  key: SecurityResearchMetricKey;
  label: string;
  value: DecimalString;
  unit: SecurityResearchMetric["unit"];
  currency: string | null;
  period: string;
  asOf: string;
  derivation: SecurityResearchMetric["derivation"];
  calculation: string | null;
}

export interface ValuationFacts {
  marketCapitalization: DataFact<InstrumentMetric>;
  enterpriseValue: DataFact<InstrumentMetric>;
  trailingPe: DataFact<InstrumentMetric>;
  forwardPe: DataFact<InstrumentMetric>;
  pegRatio: DataFact<InstrumentMetric>;
  priceToBook: DataFact<InstrumentMetric>;
  priceToSales: DataFact<InstrumentMetric>;
  enterpriseValueToRevenue: DataFact<InstrumentMetric>;
  enterpriseValueToEbitda: DataFact<InstrumentMetric>;
}

export interface FinancialHealthFacts {
  freeCashFlow: DataFact<InstrumentMetric>;
  totalDebt: DataFact<InstrumentMetric>;
  cashAndShortTermInvestments: DataFact<InstrumentMetric>;
  shareholdersEquity: DataFact<InstrumentMetric>;
  debtToEquity: DataFact<InstrumentMetric>;
}

export interface ProfitabilityFacts {
  quarterlyRevenue: DataFact<InstrumentMetric>;
  quarterlyNetIncome: DataFact<InstrumentMetric>;
  annualRevenue: DataFact<InstrumentMetric>;
  annualNetIncome: DataFact<InstrumentMetric>;
  quarterlyGrossProfit: DataFact<InstrumentMetric>;
  quarterlyGrossMargin: DataFact<InstrumentMetric>;
  quarterlyOperatingMargin: DataFact<InstrumentMetric>;
  quarterlyNetMargin: DataFact<InstrumentMetric>;
}

export interface AnalystConsensusFacts {
  recommendation: string;
  analystCount: number;
  targetPrice: DecimalString;
  currency: string;
  asOf: string;
}

export interface LastDividendFacts {
  amount: DecimalString;
  currency: string;
  date: string;
  dateBasis: "provider-reported-last-dividend-date";
}

export interface HolderEntry {
  name: string;
  ownershipPercent: DecimalString;
  asOf: string;
}

export interface HolderFacts {
  kind: "security-holders" | "fund-holdings";
  entries: HolderEntry[];
}

export interface HistoricalPriceRiskFacts {
  annualizedVolatility: DataFact<InstrumentMetric>;
  downsideVolatility: DataFact<InstrumentMetric>;
  maximumDrawdown: DataFact<InstrumentMetric>;
  periodHigh: DataFact<InstrumentMetric>;
  periodLow: DataFact<InstrumentMetric>;
}

export interface EquityRiskFacts extends HistoricalPriceRiskFacts {
  leverage: DataFact<InstrumentMetric>;
}

export interface EtfConcentrationFacts {
  largestHoldingPercent: DecimalString;
  topTenHoldingsPercent: DecimalString;
  asOf: string;
}

export interface EtfCreditQualityEntry {
  rating: string;
  weightPercent: DecimalString;
  asOf: string;
}

export interface EtfCreditQualityFacts {
  entries: EtfCreditQualityEntry[];
}

export interface EtfProfileFacts {
  objective: DataFact<string>;
  trackedIndex: DataFact<string>;
  category: DataFact<string>;
  fundFamily: DataFact<string>;
  legalType: DataFact<string>;
  expenseRatio: DataFact<InstrumentMetric>;
  totalAssets: DataFact<InstrumentMetric>;
  averageDailyVolume: DataFact<InstrumentMetric>;
  distributionYield: DataFact<InstrumentMetric>;
}

export interface InstrumentQuoteFacts {
  price: DecimalString;
  previousClose: DataFact<DecimalString>;
  change: DataFact<DecimalString>;
  changePercent: DataFact<DecimalString>;
  marketState: MarketSnapshot["marketState"];
  freshness: MarketSnapshot["freshness"];
  delayMinutes: number;
  asOf: string;
  notice: string;
}

export interface CompanyProfileFacts {
  sector: string | null;
  industry: string | null;
  businessSummary: string | null;
  asOf: string;
}

export interface EtfRiskFacts extends HistoricalPriceRiskFacts {
  concentration: DataFact<EtfConcentrationFacts>;
  trackingDifference: DataFact<InstrumentMetric>;
  expenseRatio: DataFact<InstrumentMetric>;
  liquidity: DataFact<InstrumentMetric>;
  duration: DataFact<InstrumentMetric>;
  maturity: DataFact<InstrumentMetric>;
  creditQuality: DataFact<EtfCreditQualityFacts>;
}

export interface BondRiskFacts extends HistoricalPriceRiskFacts {
  creditRating: DataFact<string>;
  duration: DataFact<InstrumentMetric>;
  yieldToMaturity: DataFact<InstrumentMetric>;
  maturityDate: DataFact<string>;
  couponRate: DataFact<InstrumentMetric>;
  liquidity: DataFact<InstrumentMetric>;
}

interface CommonInstrumentFacts {
  schemaVersion: "3.0.0";
  symbol: string;
  displayName: string;
  exchange: string;
  currency: string;
  generatedAt: string;
  provider: PublicProviderDescriptor;
  profile: DataFact<CompanyProfileFacts>;
  quote: DataFact<InstrumentQuoteFacts>;
  valuation: ValuationFacts;
  dividendYield: DataFact<InstrumentMetric>;
  lastDividend: DataFact<LastDividendFacts>;
  financialHealth: FinancialHealthFacts;
  profitability: ProfitabilityFacts;
  returnOnEquity: DataFact<InstrumentMetric>;
  analystConsensus: DataFact<AnalystConsensusFacts>;
  holders: DataFact<HolderFacts>;
  notices: string[];
}

export interface EquityFacts extends CommonInstrumentFacts {
  instrumentType: "EQUITY";
  instrumentSpecificRisks: EquityRiskFacts;
}

export interface EtfFacts extends CommonInstrumentFacts {
  instrumentType: "ETF";
  fund: EtfProfileFacts;
  instrumentSpecificRisks: EtfRiskFacts;
}

export interface BondFacts extends CommonInstrumentFacts {
  instrumentType: "BOND";
  instrumentSpecificRisks: BondRiskFacts;
}

export type InstrumentFacts = EquityFacts | EtfFacts | BondFacts;
export type SupportedInstrumentType = InstrumentFacts["instrumentType"];

export class InstrumentResearchNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstrumentResearchNormalizationError";
  }
}

export interface NormalizeInstrumentResearchInput {
  snapshot: MarketSnapshot;
  report?: SecurityResearchReport;
  provider: PublicProviderDescriptor;
  researchFailed?: boolean;
}

function unavailableFact(
  reason: DataUnavailableReason,
  field: string,
  detail: string,
  sources: FactAttribution[] = [],
  unavailableFields: string[] = [field],
  issueCodes: string[] = []
): UnavailableFact {
  return {
    status: DATA_NOT_AVAILABLE,
    reason,
    detail,
    unavailableFields,
    issueCodes,
    sources
  };
}

function availableFact<T>(value: T, sources: FactAttribution[]): AvailableFact<T> {
  return { status: "AVAILABLE", value, sources };
}

function normalizeInstrumentType(value: string | null | undefined): SupportedInstrumentType | null {
  const normalized = value?.trim().toUpperCase().replace(/[ -]+/gu, "_");
  if (!normalized) return null;
  if (normalized === "ETF" || normalized === "EXCHANGE_TRADED_FUND") return "ETF";
  if (
    normalized === "BOND" ||
    normalized === "FIXED_INCOME" ||
    normalized === "CORPORATE_BOND" ||
    normalized === "GOVERNMENT_BOND"
  ) {
    return "BOND";
  }
  if (normalized === "EQUITY" || normalized === "STOCK" || normalized === "COMMON_STOCK") {
    return "EQUITY";
  }
  return null;
}

function resolveInstrumentType(
  snapshot: MarketSnapshot,
  report: SecurityResearchReport | undefined
): SupportedInstrumentType {
  const declaredTypes = [
    normalizeInstrumentType(snapshot.instrumentType),
    normalizeInstrumentType(report?.profile.data?.quoteType)
  ].filter((value): value is SupportedInstrumentType => value !== null);
  const uniqueTypes = [...new Set(declaredTypes)];
  if (uniqueTypes.length > 1) {
    throw new InstrumentResearchNormalizationError(
      `Conflicting instrument classifications for ${snapshot.symbol}.`
    );
  }
  const instrumentType = uniqueTypes[0];
  if (!instrumentType) {
    throw new InstrumentResearchNormalizationError(
      `Unsupported or unavailable instrument classification for ${snapshot.symbol}.`
    );
  }
  return instrumentType;
}

function sectionAttributions(
  sources: readonly SecurityResearchSource[],
  provider: PublicProviderDescriptor
): FactAttribution[] {
  return deduplicateAttributions(
    sources.map((source) => ({
      providerId: provider.id,
      sourceId: source.provider,
      label: source.label,
      url: source.url,
      retrievedAt: source.retrievedAt,
      licenseClass: provider.licenseClass
    }))
  );
}

function quoteAttribution(
  snapshot: MarketSnapshot,
  provider: PublicProviderDescriptor
): FactAttribution {
  return {
    providerId: provider.id,
    sourceId: "market-snapshot",
    label: snapshot.source,
    url: null,
    retrievedAt: snapshot.asOf,
    licenseClass: provider.licenseClass
  };
}

function metricAttribution(
  metric: SecurityResearchMetric,
  section: SecurityResearchSection<{ metrics: SecurityResearchMetric[] }>,
  provider: PublicProviderDescriptor
): FactAttribution {
  const matchingSource = section.sources.find((source) => source.provider === metric.source);
  return {
    providerId: provider.id,
    sourceId: metric.source,
    label: matchingSource?.label ?? metric.source,
    url: metric.sourceUrl,
    retrievedAt: matchingSource?.retrievedAt ?? metric.asOf,
    licenseClass: provider.licenseClass
  };
}

function deduplicateAttributions(sources: readonly FactAttribution[]): FactAttribution[] {
  const unique = new Map<string, FactAttribution>();
  for (const source of sources) {
    const key = [source.providerId, source.sourceId, source.url ?? "", source.retrievedAt].join("|");
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
}

function instrumentMetric(metric: SecurityResearchMetric): InstrumentMetric {
  return {
    key: metric.key,
    label: metric.label,
    value: decimalFromNumber(metric.value),
    unit: metric.unit,
    currency: metric.currency,
    period: metric.period,
    asOf: metric.asOf,
    derivation: metric.derivation,
    calculation: metric.calculation
  };
}

function decimalFromNumber(value: number): DecimalString {
  if (!Number.isFinite(value)) {
    throw new InstrumentResearchNormalizationError("Provider returned a non-finite numeric fact.");
  }
  return decimal(value.toFixed(8));
}

function optionalQuoteNumber(
  value: number | null,
  field: string,
  sources: FactAttribution[]
): DataFact<DecimalString> {
  return value === null
    ? unavailableFact(
        "SOURCE_FIELD_NOT_PROVIDED",
        field,
        `The market snapshot did not include ${field}.`,
        sources
      )
    : availableFact(decimalFromNumber(value), sources);
}

function instrumentQuote(
  snapshot: MarketSnapshot,
  provider: PublicProviderDescriptor
): DataFact<InstrumentQuoteFacts> {
  const sources = [quoteAttribution(snapshot, provider)];
  return availableFact(
    {
      price: decimalFromNumber(snapshot.price),
      previousClose: optionalQuoteNumber(snapshot.previousClose, "previous close", sources),
      change: optionalQuoteNumber(snapshot.change, "price change", sources),
      changePercent: optionalQuoteNumber(snapshot.changePercent, "price change percent", sources),
      marketState: snapshot.marketState,
      freshness: snapshot.freshness,
      delayMinutes: snapshot.delayMinutes,
      asOf: snapshot.asOf,
      notice: snapshot.notice
    },
    sources
  );
}

type MetricSection = SecurityResearchSection<{ metrics: SecurityResearchMetric[] }>;

function metricFact(
  section: MetricSection | undefined,
  key: SecurityResearchMetricKey,
  field: string,
  provider: PublicProviderDescriptor,
  fallbackReason: DataUnavailableReason
): DataFact<InstrumentMetric> {
  const metric = section?.data?.metrics.find((candidate) => candidate.key === key);
  if (metric && section) {
    return availableFact(instrumentMetric(metric), [metricAttribution(metric, section, provider)]);
  }

  const sources = section ? sectionAttributions(section.sources, provider) : [];
  const issueCodes =
    section?.issues.map((issue) => `${issue.provider}:${issue.code}`) ?? [];
  const unavailableFields = section?.unavailableFields.includes(key)
    ? [key]
    : [field];
  const reason = section?.data
    ? fallbackReason
    : section
      ? "PROVIDER_SECTION_UNAVAILABLE"
      : fallbackReason;
  return unavailableFact(
    reason,
    field,
    `No sourced ${field} value was returned by the configured provider.`,
    sources,
    unavailableFields,
    issueCodes
  );
}

function stringFact(
  section: SecurityResearchSection<unknown> | undefined,
  value: string | null | undefined,
  field: string,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): DataFact<string> {
  if (typeof value === "string" && value.trim().length > 0 && section) {
    return availableFact(value.trim(), sectionAttributions(section.sources, provider));
  }
  return sectionUnavailableFact(field, section, provider, researchFailed);
}

function notApplicableMetric(field: string): UnavailableFact {
  return unavailableFact(
    "NOT_APPLICABLE_TO_INSTRUMENT",
    field,
    `${field} is not represented as a valid fact for this instrument type.`
  );
}

function noResearchMetric(field: string, researchFailed: boolean): UnavailableFact {
  return unavailableFact(
    researchFailed ? "PROVIDER_REQUEST_FAILED" : "SOURCE_FIELD_NOT_PROVIDED",
    field,
    researchFailed
      ? `The configured research provider did not return ${field}.`
      : `The configured provider contract does not expose a sourced ${field} value.`
  );
}

function buildValuationFacts(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  instrumentType: SupportedInstrumentType,
  researchFailed: boolean
): ValuationFacts {
  if (instrumentType !== "EQUITY") {
    return {
      marketCapitalization: notApplicableMetric("market capitalization"),
      enterpriseValue: notApplicableMetric("enterprise value"),
      trailingPe: notApplicableMetric("trailing P/E"),
      forwardPe: notApplicableMetric("forward P/E"),
      pegRatio: notApplicableMetric("PEG ratio"),
      priceToBook: notApplicableMetric("price to book"),
      priceToSales: notApplicableMetric("price to sales"),
      enterpriseValueToRevenue: notApplicableMetric("enterprise value to revenue"),
      enterpriseValueToEbitda: notApplicableMetric("enterprise value to EBITDA")
    };
  }
  const section = report?.valuation;
  const missingReason = researchFailed ? "PROVIDER_REQUEST_FAILED" : "SOURCE_FIELD_NOT_PROVIDED";
  return {
    marketCapitalization: metricFact(section, "market-cap", "market capitalization", provider, missingReason),
    enterpriseValue: metricFact(section, "enterprise-value", "enterprise value", provider, missingReason),
    trailingPe: metricFact(section, "trailing-pe", "trailing P/E", provider, missingReason),
    forwardPe: metricFact(section, "forward-pe", "forward P/E", provider, missingReason),
    pegRatio: metricFact(section, "peg-ratio", "PEG ratio", provider, missingReason),
    priceToBook: metricFact(section, "price-to-book", "price to book", provider, missingReason),
    priceToSales: metricFact(section, "price-to-sales", "price to sales", provider, missingReason),
    enterpriseValueToRevenue: metricFact(
      section,
      "enterprise-value-to-revenue",
      "enterprise value to revenue",
      provider,
      missingReason
    ),
    enterpriseValueToEbitda: metricFact(
      section,
      "enterprise-value-to-ebitda",
      "enterprise value to EBITDA",
      provider,
      missingReason
    )
  };
}

function buildFinancialHealthFacts(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  instrumentType: SupportedInstrumentType,
  researchFailed: boolean
): FinancialHealthFacts {
  if (instrumentType !== "EQUITY") {
    return {
      freeCashFlow: notApplicableMetric("free cash flow"),
      totalDebt: notApplicableMetric("total debt"),
      cashAndShortTermInvestments: notApplicableMetric("cash and short-term investments"),
      shareholdersEquity: notApplicableMetric("shareholders' equity"),
      debtToEquity: notApplicableMetric("debt to equity")
    };
  }
  const section = report?.fundamentals;
  const missingReason = researchFailed ? "PROVIDER_REQUEST_FAILED" : "SOURCE_FIELD_NOT_PROVIDED";
  return {
    freeCashFlow: metricFact(
      section,
      "free-cash-flow-quarterly",
      "free cash flow",
      provider,
      missingReason
    ),
    totalDebt: metricFact(section, "total-debt-quarterly", "total debt", provider, missingReason),
    cashAndShortTermInvestments: metricFact(
      section,
      "cash-and-short-term-investments-quarterly",
      "cash and short-term investments",
      provider,
      missingReason
    ),
    shareholdersEquity: metricFact(
      section,
      "shareholders-equity-quarterly",
      "shareholders' equity",
      provider,
      missingReason
    ),
    debtToEquity: metricFact(
      section,
      "debt-to-equity-quarterly",
      "debt to equity",
      provider,
      missingReason
    )
  };
}

function buildProfitabilityFacts(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  instrumentType: SupportedInstrumentType,
  researchFailed: boolean
): ProfitabilityFacts {
  const fields = {
    quarterlyRevenue: "quarterly revenue",
    quarterlyNetIncome: "quarterly net income",
    annualRevenue: "annual revenue",
    annualNetIncome: "annual net income",
    quarterlyGrossProfit: "quarterly gross profit",
    quarterlyGrossMargin: "quarterly gross margin",
    quarterlyOperatingMargin: "quarterly operating margin",
    quarterlyNetMargin: "quarterly net margin"
  } as const;
  if (instrumentType !== "EQUITY") {
    return Object.fromEntries(
      Object.entries(fields).map(([key, label]) => [key, notApplicableMetric(label)])
    ) as unknown as ProfitabilityFacts;
  }
  const missingReason = researchFailed ? "PROVIDER_REQUEST_FAILED" : "SOURCE_FIELD_NOT_PROVIDED";
  return {
    quarterlyRevenue: metricFact(
      report?.earnings,
      "revenue-quarterly",
      fields.quarterlyRevenue,
      provider,
      missingReason
    ),
    quarterlyNetIncome: metricFact(
      report?.earnings,
      "net-income-quarterly",
      fields.quarterlyNetIncome,
      provider,
      missingReason
    ),
    annualRevenue: metricFact(
      report?.earnings,
      "revenue-annual",
      fields.annualRevenue,
      provider,
      missingReason
    ),
    annualNetIncome: metricFact(
      report?.earnings,
      "net-income-annual",
      fields.annualNetIncome,
      provider,
      missingReason
    ),
    quarterlyGrossProfit: metricFact(
      report?.fundamentals,
      "gross-profit-quarterly",
      fields.quarterlyGrossProfit,
      provider,
      missingReason
    ),
    quarterlyGrossMargin: metricFact(
      report?.fundamentals,
      "gross-margin-quarterly",
      fields.quarterlyGrossMargin,
      provider,
      missingReason
    ),
    quarterlyOperatingMargin: metricFact(
      report?.fundamentals,
      "operating-margin-quarterly",
      fields.quarterlyOperatingMargin,
      provider,
      missingReason
    ),
    quarterlyNetMargin: metricFact(
      report?.fundamentals,
      "net-margin-quarterly",
      fields.quarterlyNetMargin,
      provider,
      missingReason
    )
  };
}

function buildHistoricalPriceRisk(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): HistoricalPriceRiskFacts {
  const section = report?.priceRisk;
  const missingReason = researchFailed ? "PROVIDER_REQUEST_FAILED" : "SOURCE_FIELD_NOT_PROVIDED";
  return {
    annualizedVolatility: metricFact(
      section,
      "annualized-volatility",
      "annualized volatility",
      provider,
      missingReason
    ),
    downsideVolatility: metricFact(
      section,
      "downside-volatility",
      "downside volatility",
      provider,
      missingReason
    ),
    maximumDrawdown: metricFact(
      section,
      "maximum-drawdown",
      "maximum drawdown",
      provider,
      missingReason
    ),
    periodHigh: metricFact(section, "period-high", "period high", provider, missingReason),
    periodLow: metricFact(section, "period-low", "period low", provider, missingReason)
  };
}

function researchFieldUnavailable(
  field: string,
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean,
  notApplicable: boolean
): UnavailableFact {
  if (notApplicable) return notApplicableMetric(field);
  const sources = report
    ? sectionAttributions(
        [
          ...report.profile.sources,
          ...report.fundamentals.sources,
          ...report.valuation.sources
        ],
        provider
      )
    : [];
  const fact = noResearchMetric(field, researchFailed);
  return { ...fact, sources };
}

function sectionUnavailableFact(
  field: string,
  section: SecurityResearchSection<unknown> | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): UnavailableFact {
  const reason: DataUnavailableReason = researchFailed
    ? "PROVIDER_REQUEST_FAILED"
    : section?.data === null
      ? "PROVIDER_SECTION_UNAVAILABLE"
      : "SOURCE_FIELD_NOT_PROVIDED";
  return unavailableFact(
    reason,
    field,
    `No sourced ${field} value was returned by the configured provider.`,
    section ? sectionAttributions(section.sources, provider) : [],
    section?.unavailableFields.length
      ? [...section.unavailableFields]
      : [field],
    section?.issues.map((issue) => `${issue.provider}:${issue.code}`) ?? []
  );
}

function lastDividendFact(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean,
  notApplicable: boolean
): DataFact<LastDividendFacts> {
  if (notApplicable) return notApplicableMetric("last dividend");
  const section = report?.dividends;
  const lastDividend = section?.data?.lastDividend;
  if (
    lastDividend &&
    Number.isFinite(lastDividend.amount) &&
    lastDividend.amount > 0 &&
    /^[A-Z]{3}$/u.test(lastDividend.currency) &&
    isCanonicalIsoTimestamp(lastDividend.date) &&
    lastDividend.dateBasis === "provider-reported-last-dividend-date"
  ) {
    return availableFact(
      {
        amount: decimalFromNumber(lastDividend.amount),
        currency: lastDividend.currency,
        date: lastDividend.date,
        dateBasis: lastDividend.dateBasis
      },
      sectionAttributions(section.sources, provider)
    );
  }
  return sectionUnavailableFact(
    "last dividend",
    section,
    provider,
    researchFailed
  );
}

const VALID_ANALYST_RECOMMENDATIONS = new Set([
  "Strong Buy",
  "Buy",
  "Hold",
  "Underperform",
  "Sell"
]);

function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function analystConsensusFact(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean,
  notApplicable: boolean
): DataFact<AnalystConsensusFacts> {
  if (notApplicable) return notApplicableMetric("analyst consensus");
  const section = report?.analystConsensus;
  const consensus = section?.data;
  if (
    consensus &&
    VALID_ANALYST_RECOMMENDATIONS.has(consensus.recommendation) &&
    Number.isSafeInteger(consensus.analystCount) &&
    consensus.analystCount > 0 &&
    Number.isFinite(consensus.targetPrice) &&
    consensus.targetPrice > 0 &&
    /^[A-Z]{3}$/u.test(consensus.currency) &&
    isCanonicalIsoTimestamp(consensus.asOf)
  ) {
    return availableFact(
      {
        recommendation: consensus.recommendation,
        analystCount: consensus.analystCount,
        targetPrice: decimalFromNumber(consensus.targetPrice),
        currency: consensus.currency,
        asOf: consensus.asOf
      },
      sectionAttributions(section.sources, provider)
    );
  }
  return sectionUnavailableFact(
    "analyst consensus",
    section,
    provider,
    researchFailed
  );
}

function etfHolderFact(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): DataFact<HolderFacts> {
  const section = report?.fundProfile;
  const holdings = section?.data?.holdings ?? [];
  if (section && holdings.length > 0) {
    return availableFact(
      {
        kind: "fund-holdings",
        entries: holdings.map((holding) => ({
          name: `${holding.name} (${holding.symbol})`,
          ownershipPercent: decimalFromNumber(holding.weightPercent),
          asOf: holding.asOf
        }))
      },
      sectionAttributions(section.sources, provider)
    );
  }
  return sectionUnavailableFact("fund holdings", section, provider, researchFailed);
}

function companyProfileFact(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): DataFact<CompanyProfileFacts> {
  const section = report?.profile;
  if (section?.data !== null && section?.data !== undefined) {
    return availableFact(
      {
        sector: section.data.sector,
        industry: section.data.industry,
        businessSummary: section.data.businessSummary,
        asOf: section.data.asOf
      },
      sectionAttributions(section.sources, provider)
    );
  }
  return sectionUnavailableFact(
    "company profile",
    section,
    provider,
    researchFailed
  );
}

function buildCommonFacts(
  snapshot: MarketSnapshot,
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  instrumentType: SupportedInstrumentType,
  researchFailed: boolean
): CommonInstrumentFacts {
  const nonEquity = instrumentType !== "EQUITY";
  return {
    schemaVersion: "3.0.0",
    symbol: snapshot.symbol,
    displayName: snapshot.displayName,
    exchange: snapshot.exchange,
    currency: snapshot.currency,
    generatedAt: report?.generatedAt ?? snapshot.asOf,
    provider,
    profile: companyProfileFact(report, provider, researchFailed),
    quote: instrumentQuote(snapshot, provider),
    valuation: buildValuationFacts(report, provider, instrumentType, researchFailed),
    dividendYield: instrumentType === "BOND"
      ? notApplicableMetric("dividend yield")
      : metricFact(
          report?.dividends,
          "dividend-yield",
          "dividend yield",
          provider,
          researchFailed ? "PROVIDER_REQUEST_FAILED" : "SOURCE_FIELD_NOT_PROVIDED"
        ),
    lastDividend: lastDividendFact(
      report,
      provider,
      researchFailed,
      instrumentType === "BOND"
    ),
    financialHealth: buildFinancialHealthFacts(
      report,
      provider,
      instrumentType,
      researchFailed
    ),
    profitability: buildProfitabilityFacts(
      report,
      provider,
      instrumentType,
      researchFailed
    ),
    returnOnEquity: researchFieldUnavailable(
      "return on equity",
      report,
      provider,
      researchFailed,
      nonEquity
    ),
    analystConsensus: analystConsensusFact(
      report,
      provider,
      researchFailed,
      instrumentType !== "EQUITY"
    ),
    holders: instrumentType === "ETF"
      ? etfHolderFact(report, provider, researchFailed)
      : researchFieldUnavailable(
          "security holders",
          report,
          provider,
          researchFailed,
          instrumentType === "BOND"
        ),
    notices: [
      `${provider.displayName} is classified as ${provider.licenseClass}.`,
      "Unavailable facts are returned explicitly and are never completed from model memory."
    ]
  };
}

function buildEquityRisks(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  financialHealth: FinancialHealthFacts,
  researchFailed: boolean
): EquityRiskFacts {
  return {
    ...buildHistoricalPriceRisk(report, provider, researchFailed),
    leverage: financialHealth.debtToEquity
  };
}

function buildEtfProfile(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): EtfProfileFacts {
  const section = report?.fundProfile;
  const missingReason = researchFailed ? "PROVIDER_REQUEST_FAILED" : "SOURCE_FIELD_NOT_PROVIDED";
  return {
    objective: stringFact(
      section,
      section?.data?.objective,
      "ETF objective",
      provider,
      researchFailed
    ),
    trackedIndex: stringFact(
      section,
      section?.data?.trackedIndex,
      "ETF tracked index",
      provider,
      researchFailed
    ),
    category: stringFact(
      section,
      section?.data?.categoryName,
      "ETF category",
      provider,
      researchFailed
    ),
    fundFamily: stringFact(
      section,
      section?.data?.family,
      "ETF fund family",
      provider,
      researchFailed
    ),
    legalType: stringFact(
      section,
      section?.data?.legalType,
      "ETF legal type",
      provider,
      researchFailed
    ),
    expenseRatio: metricFact(
      section,
      "etf-expense-ratio",
      "ETF expense ratio",
      provider,
      missingReason
    ),
    totalAssets: metricFact(
      section,
      "etf-total-assets",
      "ETF total assets",
      provider,
      missingReason
    ),
    averageDailyVolume: metricFact(
      section,
      "etf-average-volume",
      "ETF average daily volume",
      provider,
      missingReason
    ),
    distributionYield: metricFact(
      section,
      "etf-distribution-yield",
      "ETF distribution yield",
      provider,
      missingReason
    )
  };
}

function etfConcentrationFact(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): DataFact<EtfConcentrationFacts> {
  const section = report?.fundProfile;
  const holdings = section?.data?.holdings ?? [];
  if (section && holdings.length > 0) {
    const sorted = [...holdings].sort(
      (left, right) => right.weightPercent - left.weightPercent
    );
    const largest = sorted[0]!;
    const topTenWeight = sorted
      .slice(0, 10)
      .reduce((sum, holding) => sum + holding.weightPercent, 0);
    return availableFact(
      {
        largestHoldingPercent: decimalFromNumber(largest.weightPercent),
        topTenHoldingsPercent: decimalFromNumber(topTenWeight),
        asOf: largest.asOf
      },
      sectionAttributions(section.sources, provider)
    );
  }
  return sectionUnavailableFact(
    "ETF holdings concentration",
    section,
    provider,
    researchFailed
  );
}

function etfCreditQualityFact(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): DataFact<EtfCreditQualityFacts> {
  const section = report?.fundProfile;
  const entries = section?.data?.creditQuality ?? [];
  if (section && entries.length > 0) {
    return availableFact(
      {
        entries: entries.map((entry) => ({
          rating: entry.rating,
          weightPercent: decimalFromNumber(entry.weightPercent),
          asOf: entry.asOf
        }))
      },
      sectionAttributions(section.sources, provider)
    );
  }
  return sectionUnavailableFact(
    "ETF credit quality",
    section,
    provider,
    researchFailed
  );
}

function buildEtfRisks(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): EtfRiskFacts {
  const section = report?.fundProfile;
  const missingReason = researchFailed ? "PROVIDER_REQUEST_FAILED" : "SOURCE_FIELD_NOT_PROVIDED";
  return {
    ...buildHistoricalPriceRisk(report, provider, researchFailed),
    concentration: etfConcentrationFact(report, provider, researchFailed),
    trackingDifference: sectionUnavailableFact(
      "ETF tracking difference",
      section,
      provider,
      researchFailed
    ),
    expenseRatio: metricFact(
      section,
      "etf-expense-ratio",
      "ETF expense ratio",
      provider,
      missingReason
    ),
    liquidity: metricFact(
      section,
      "etf-average-volume",
      "ETF average daily volume",
      provider,
      missingReason
    ),
    duration: metricFact(
      section,
      "etf-bond-duration",
      "ETF bond duration",
      provider,
      missingReason
    ),
    maturity: metricFact(
      section,
      "etf-bond-maturity",
      "ETF bond maturity",
      provider,
      missingReason
    ),
    creditQuality: etfCreditQualityFact(report, provider, researchFailed)
  };
}

function buildBondRisks(
  report: SecurityResearchReport | undefined,
  provider: PublicProviderDescriptor,
  researchFailed: boolean
): BondRiskFacts {
  return {
    ...buildHistoricalPriceRisk(report, provider, researchFailed),
    creditRating: noResearchMetric("bond credit rating", researchFailed),
    duration: noResearchMetric("bond duration", researchFailed),
    yieldToMaturity: noResearchMetric("bond yield to maturity", researchFailed),
    maturityDate: noResearchMetric("bond maturity date", researchFailed),
    couponRate: noResearchMetric("bond coupon rate", researchFailed),
    liquidity: noResearchMetric("bond liquidity", researchFailed)
  };
}

/** Normalize already-sourced provider output without inventing absent fields. */
export function normalizeInstrumentResearch(
  input: NormalizeInstrumentResearchInput
): InstrumentFacts {
  const snapshotSymbol = input.snapshot.symbol.trim().toUpperCase();
  const reportSymbol = input.report?.symbol.trim().toUpperCase();
  if (reportSymbol && reportSymbol !== snapshotSymbol) {
    throw new InstrumentResearchNormalizationError(
      `Quote/research symbol mismatch: ${snapshotSymbol} versus ${reportSymbol}.`
    );
  }

  const instrumentType = resolveInstrumentType(input.snapshot, input.report);
  const researchFailed = input.researchFailed ?? false;
  const common = buildCommonFacts(
    input.snapshot,
    input.report,
    input.provider,
    instrumentType,
    researchFailed
  );

  if (instrumentType === "EQUITY") {
    return {
      ...common,
      instrumentType,
      instrumentSpecificRisks: buildEquityRisks(
        input.report,
        input.provider,
        common.financialHealth,
        researchFailed
      )
    };
  }
  if (instrumentType === "ETF") {
    return {
      ...common,
      instrumentType,
      fund: buildEtfProfile(
        input.report,
        input.provider,
        researchFailed
      ),
      instrumentSpecificRisks: buildEtfRisks(
        input.report,
        input.provider,
        researchFailed
      )
    };
  }
  return {
    ...common,
    instrumentType,
    instrumentSpecificRisks: buildBondRisks(input.report, input.provider, researchFailed)
  };
}

/** Fetch quote and research concurrently; a research outage becomes explicit missing data. */
export async function getInstrumentResearch(
  provider: PublicMarketResearchPort,
  symbol: string
): Promise<InstrumentFacts> {
  const [snapshotResult, reportResult] = await Promise.allSettled([
    provider.getSnapshot(symbol),
    provider.getResearch(symbol)
  ]);
  if (snapshotResult.status === "rejected") throw snapshotResult.reason;

  return normalizeInstrumentResearch({
    snapshot: snapshotResult.value,
    ...(reportResult.status === "fulfilled" ? { report: reportResult.value } : {}),
    provider: provider.descriptor,
    researchFailed: reportResult.status === "rejected"
  });
}
