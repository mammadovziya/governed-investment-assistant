import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { KnowledgeQueryContext, KnowledgeToolResult } from "../domain/knowledge.js";
import type { MarketHistoryRange, MarketHistorySeries } from "../domain/market-history.js";
import type { MarketSnapshot } from "../domain/types.js";
import type {
  FinancialEducationQueryContext,
  FinancialEducationRetrievalPort,
  FinancialEducationRetrievalResult
} from "../domain/financial-education.js";
import type {
  DecimalString,
  ToolExecutionEnvelope,
  ToolSource,
  TrustedRequestContext
} from "./contracts.js";
import {
  CurrencyRateProviderError,
  type CurrencyRateQuote,
  type CurrencyRatePort,
  type SupportedCurrencyCode
} from "./currency-rates.js";
import { EvidenceFactory } from "./evidence.js";
import {
  financialEducationQueryHash,
  normalizeFinancialEducationQuery
} from "./financial-education-query.js";
import {
  ONE_FIXED,
  ZERO_FIXED,
  addFixed,
  decimal,
  divideFixed,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal,
  subtractFixed,
  sumFixed
} from "./fixed-decimal.js";
import type { V3ToolGrantAuthority } from "./grants.js";
import {
  getInstrumentResearch,
  type InstrumentFacts
} from "./instrument-research.js";
import {
  marketContentFromResearchReports,
  type MarketContentItem
} from "./market-content.js";
import type {
  MockPortfolioPositionSnapshot,
  PortfolioActivityQuery,
  PortfolioActivityResult,
  RecentTradingActivityResult
} from "./mock-portfolio.js";
import {
  projectPortfolioAllocationAnalysis,
  type CanonicalPortfolioAllocationAnalysisInput,
  type PortfolioAllocationAnalysisArguments,
  type PortfolioAllocationAnalysisResult,
  type PortfolioAllocationInputRow,
  type PortfolioAllocationTheme
} from "./portfolio-allocation-analysis.js";
import type {
  OrderEligibility,
  OrderHandoffStore,
  SignedOrderHandoff
} from "./order-handoff.js";
import type {
  V3ApprovedBoundaryToolId,
  V3PolicyDecision
} from "./policy.js";
import type { PublicMarketResearchPort } from "./providers.js";
import type { V3TrustedSession } from "./sessions.js";
import type { DevHmacSigner } from "./signing.js";

export const V3_BOUNDARY_EXECUTION_CONTEXT_KEY = "v3BoundaryExecution" as const;
export const V3_BOUNDARY_TOOL_VERSION = "3.0.0" as const;

export interface V3BoundaryExecutionContext {
  readonly grantToken: string;
  readonly requestId: string;
  readonly workflowRunId: string;
  readonly policy: V3PolicyDecision;
  readonly session: V3TrustedSession;
  readonly trustedContext: TrustedRequestContext;
}

export interface ResolvedInstrument {
  instrumentId: string;
  symbol: string;
  displayName: string;
  instrumentType: "EQUITY" | "ETF" | "BOND";
  exchange: string;
  currency: string;
  resolvedAt: string;
}

export interface BoundaryMarketSnapshot {
  symbol: string;
  displayName: string;
  currency: string;
  exchange: string;
  instrumentType: string;
  price: DecimalString;
  previousClose: DecimalString | null;
  change: DecimalString | null;
  changePercent: DecimalString | null;
  marketState: MarketSnapshot["marketState"];
  freshness: MarketSnapshot["freshness"];
  delayMinutes: number;
  asOf: string;
  notice: string;
}

export interface BoundaryPriceHistoryPoint {
  timestamp: string;
  close: DecimalString;
}

export interface BoundaryPriceHistory {
  symbol: string;
  range: MarketHistoryRange;
  interval: string;
  currency: string;
  exchange: string;
  asOf: string;
  points: BoundaryPriceHistoryPoint[];
}

export type CurrencyConversionArguments =
  | {
      readonly scope: "provided-amount";
      readonly amount: DecimalString;
      readonly sourceCurrency: SupportedCurrencyCode;
      readonly targetCurrency: SupportedCurrencyCode;
    }
  | {
      readonly scope: "current-market-price";
      readonly symbol: string;
      readonly targetCurrency: SupportedCurrencyCode;
    }
  | {
      readonly scope: "current-portfolio-value";
      readonly targetCurrency: SupportedCurrencyCode;
    };

export interface CurrencyConversionResult {
  readonly schemaVersion: "assistant-v3.currency-conversion.v1";
  readonly scope: CurrencyConversionArguments["scope"];
  readonly sourceCurrency: SupportedCurrencyCode;
  readonly targetCurrency: SupportedCurrencyCode;
  readonly sourceAmount: DecimalString;
  /** Target-currency units for one source-currency unit. */
  readonly exchangeRate: DecimalString;
  readonly convertedAmount: DecimalString;
  readonly rateEffectiveDate: string;
  readonly rateAsOf: string;
  readonly rateSourceUrl: string;
  readonly portfolioDataClass: "synthetic" | null;
  readonly portfolioAsOf: string | null;
  readonly marketAsOf: readonly {
    readonly symbol: string;
    readonly asOf: string;
  }[];
  /** Present only when converting one freshly retrieved market price. */
  readonly symbol: string | null;
  readonly displayName: string | null;
  readonly marketSnapshot: BoundaryMarketSnapshot | null;
  readonly marketSource: ToolSource | null;
}

export interface InstrumentResolverPort {
  readonly source: ToolSource;
  resolve(symbol: string): Promise<ResolvedInstrument>;
}

export interface PriceHistoryPort {
  readonly source: ToolSource;
  getHistory(symbol: string, range: MarketHistoryRange): Promise<MarketHistorySeries>;
}

export interface PrivatePortfolioScope {
  readonly requestId: string;
  readonly workflowRunId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly principalId: string;
}

export interface PortfolioBoundaryPort {
  readonly source: ToolSource;
  readSnapshot(scope: PrivatePortfolioScope): Promise<MockPortfolioPositionSnapshot>;
  readActivity(
    scope: PrivatePortfolioScope,
    query: PortfolioActivityQuery
  ): Promise<PortfolioActivityResult>;
}

export interface ApprovedKnowledgeBoundaryPort {
  readonly source: ToolSource;
  retrieve(query: string, context: KnowledgeQueryContext): Promise<KnowledgeToolResult>;
}

export interface FinancialEducationBoundaryPort
  extends FinancialEducationRetrievalPort {
  readonly source: ToolSource;
}

export interface OrderEligibilityBoundaryPort {
  readonly source: ToolSource;
  readEligibility(input: {
    context: TrustedRequestContext;
    symbol: string;
    side: "BUY";
    requestedNotional: DecimalString;
  }): Promise<OrderEligibility>;
}

export interface SignedOrderHandoffBoundaryPort {
  readonly source: ToolSource;
  confirm: OrderHandoffStore["confirm"];
}

export interface V3BoundaryToolDependencies {
  grantAuthority: V3ToolGrantAuthority;
  signer: DevHmacSigner;
  instrumentResolver: InstrumentResolverPort;
  market: PublicMarketResearchPort;
  priceHistory: PriceHistoryPort;
  /** Optional only for legacy tests; runtime bootstraps always provide it. */
  currencyRates?: CurrencyRatePort;
  portfolio: PortfolioBoundaryPort;
  approvedKnowledge: ApprovedKnowledgeBoundaryPort;
  /** Optional only for legacy tests; application and Studio bootstraps provide it. */
  financialEducation?: FinancialEducationBoundaryPort;
  orderEligibility: OrderEligibilityBoundaryPort;
  orderHandoff: SignedOrderHandoffBoundaryPort;
  /**
   * Optional loopback-only Studio harness. Production bootstraps omit it.
   * The broker must still issue a policy- and argument-bound one-use grant;
   * it is never a substitute for boundary authorization.
   */
  privateStudioExecutionBroker?: V3PrivateStudioExecutionBrokerPort;
  now?: () => number;
}

export interface V3PrivateStudioExecutionBrokerPort {
  issue(input: {
    toolId: V3ApprovedBoundaryToolId;
    args: unknown;
  }): Promise<V3BoundaryExecutionContext | V3PrivateStudioExecutionDenial> |
    V3BoundaryExecutionContext |
    V3PrivateStudioExecutionDenial;
  isTrusted(context: V3BoundaryExecutionContext): boolean;
  isDenied(value: unknown): value is V3PrivateStudioExecutionDenial;
}

export interface V3PrivateStudioExecutionDenial {
  readonly denied: true;
  readonly requestId: string;
  readonly workflowRunId: string;
  readonly toolId: V3ApprovedBoundaryToolId;
  readonly code: string;
  readonly message: string;
  readonly requestedAt: string;
}

export class V3BoundaryToolAuthorizationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "V3BoundaryToolAuthorizationError";
  }
}

export class V3BoundaryPortError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "V3BoundaryPortError";
  }
}

interface BoundaryOperationResult<TResult> {
  result: TResult;
  sourceAsOf: string;
}

interface RequestContextLike {
  get(key: string): unknown;
}

interface ToolRuntimeContextLike {
  requestContext?: RequestContextLike;
}

const MASTRA_STUDIO_CONTEXT_KEY = "mastra__isStudio" as const;

const symbolSchema = z.string().regex(/^[A-Z]{1,5}(?:\.[A-Z])?$/u);
const timestampSchema = z.string().datetime({ offset: true });
const decimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)\.\d{8}$/u, "Expected a positive canonical 8-place decimal string.")
  .refine((value) => parseFixedDecimal(value) > 0n, "Expected a positive decimal value.");
const nonNegativeDecimalStringSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.\d{8}$/u,
    "Expected a non-negative canonical 8-place decimal string."
  );
const supportedCurrencySchema = z.enum(["USD", "AZN"]);
const currencyConversionSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("provided-amount"),
    amount: nonNegativeDecimalStringSchema,
    sourceCurrency: supportedCurrencySchema,
    targetCurrency: supportedCurrencySchema
  }).strict(),
  z.object({
    scope: z.literal("current-market-price"),
    symbol: symbolSchema,
    targetCurrency: supportedCurrencySchema
  }).strict(),
  z.object({
    scope: z.literal("current-portfolio-value"),
    targetCurrency: supportedCurrencySchema
  }).strict()
]);
const allocationRateSchema = nonNegativeDecimalStringSchema.refine(
  (value) => parseFixedDecimal(value) <= ONE_FIXED,
  "Expected an allocation rate between zero and one."
);
const allocationLabelSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\p{L}\p{N} .&()_-]+$/u);
const portfolioAllocationRowSchema = z.object({
  label: allocationLabelSchema,
  symbol: symbolSchema.nullable(),
  category: allocationLabelSchema,
  theme: z.enum([
    "technology",
    "technology-dependent",
    "cash",
    "unclassified"
  ]),
  allocationRate: allocationRateSchema,
  amount: nonNegativeDecimalStringSchema.nullable()
}).strict();
const portfolioAllocationAnalysisSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("current") }).strict(),
  z.object({
    scope: z.literal("hypothetical"),
    currency: z.literal("USD"),
    totalValue: decimalStringSchema.nullable(),
    allocations: z.array(portfolioAllocationRowSchema).min(2).max(8)
  }).strict()
]);
const priceHistoryRangeSchema = z.enum(["1d", "1w", "1m", "6m", "1y", "5y", "10y", "max"]);
const boundaryRequestContextSchema = z
  .object({ [V3_BOUNDARY_EXECUTION_CONTEXT_KEY]: z.unknown() })
  .passthrough();
const toolExecutionOutputSchema = z.custom<ToolExecutionEnvelope<unknown>>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === "assistant-v3.tool-execution.v1"
);

function privateScope(context: V3BoundaryExecutionContext): PrivatePortfolioScope {
  return {
    requestId: context.requestId,
    workflowRunId: context.workflowRunId,
    sessionId: context.session.claims.sessionId,
    tenantId: context.session.claims.tenantId,
    principalId: context.session.claims.principalId
  };
}

async function runtimeExecutionContext(
  dependencies: V3BoundaryToolDependencies,
  toolId: V3ApprovedBoundaryToolId,
  args: unknown,
  runtime: ToolRuntimeContextLike | undefined
): Promise<unknown> {
  const requestContext = runtime?.requestContext;
  // Mastra derives this reserved value from x-mastra-client-type: studio and
  // strips body attempts to inject reserved request-context keys. The header
  // is client-selectable, not authentication; it is safe here only because the
  // Studio server is loopback-only and the broker exposes public/synthetic
  // component data. The broker still mints a one-use exact-argument grant.
  if (
    requestContext?.get(MASTRA_STUDIO_CONTEXT_KEY) === true &&
    dependencies.privateStudioExecutionBroker !== undefined
  ) {
    return dependencies.privateStudioExecutionBroker.issue({ toolId, args });
  }
  return requestContext?.get(V3_BOUNDARY_EXECUTION_CONTEXT_KEY);
}

function requireExecutionContext(
  value: unknown,
  privateStudioExecutionBroker: V3PrivateStudioExecutionBrokerPort | undefined
): V3BoundaryExecutionContext {
  if (typeof value !== "object" || value === null) {
    throw new V3BoundaryToolAuthorizationError(
      "internal_grant_required",
      "This boundary tool requires a server-issued internal grant."
    );
  }
  const context = value as Partial<V3BoundaryExecutionContext>;
  if (
    typeof context.grantToken !== "string" ||
    context.grantToken.length < 16 ||
    typeof context.requestId !== "string" ||
    typeof context.workflowRunId !== "string" ||
    context.policy === undefined ||
    context.session === undefined ||
    context.trustedContext === undefined
  ) {
    throw new V3BoundaryToolAuthorizationError(
      "invalid_internal_context",
      "Boundary execution context is incomplete."
    );
  }
  if (
    context.trustedContext.channel === "mastra-studio" &&
    !privateStudioExecutionBroker?.isTrusted(context as V3BoundaryExecutionContext)
  ) {
    throw new V3BoundaryToolAuthorizationError(
      "studio_direct_execution_forbidden",
      "Mastra Studio requires the isolated synthetic/development execution broker."
    );
  }
  if (
    context.trustedContext.requestId !== context.requestId ||
    context.trustedContext.sessionId !== context.session.claims.sessionId ||
    context.trustedContext.principalRef !== context.session.claims.principalId ||
    context.trustedContext.tenantRef !== context.session.claims.tenantId ||
    context.trustedContext.policyVersion !== context.policy.policyVersion ||
    context.trustedContext.authentication.strength !== context.session.claims.authLevel ||
    context.trustedContext.authentication.authContextRef !==
      context.session.claims.authContextId ||
    context.trustedContext.consentVersion !== context.session.claims.consentVersion ||
    context.trustedContext.entitlementVersion !==
      context.session.claims.entitlementVersion
  ) {
    throw new V3BoundaryToolAuthorizationError(
      "trusted_context_mismatch",
      "Trusted request context does not match the grant principal or policy."
    );
  }
  return context as V3BoundaryExecutionContext;
}

function canonicalDecimal(value: number): DecimalString {
  if (!Number.isFinite(value)) {
    throw new V3BoundaryPortError(
      "INVALID_PROVIDER_NUMBER",
      "The provider returned a non-finite financial value.",
      false
    );
  }
  return decimal(value.toFixed(8));
}

function boundaryMarketSnapshot(snapshot: MarketSnapshot): BoundaryMarketSnapshot {
  return {
    symbol: snapshot.symbol,
    displayName: snapshot.displayName,
    currency: snapshot.currency,
    exchange: snapshot.exchange,
    instrumentType: snapshot.instrumentType,
    price: canonicalDecimal(snapshot.price),
    previousClose:
      snapshot.previousClose === null ? null : canonicalDecimal(snapshot.previousClose),
    change: snapshot.change === null ? null : canonicalDecimal(snapshot.change),
    changePercent:
      snapshot.changePercent === null ? null : canonicalDecimal(snapshot.changePercent),
    marketState: snapshot.marketState,
    freshness: snapshot.freshness,
    delayMinutes: snapshot.delayMinutes,
    asOf: snapshot.asOf,
    notice: snapshot.notice
  };
}

function boundaryPriceHistory(history: MarketHistorySeries): BoundaryPriceHistory {
  return {
    symbol: history.symbol,
    range: history.range,
    interval: history.interval,
    currency: history.currency,
    exchange: history.exchange,
    asOf: history.asOf,
    points: history.points.map((point) => ({
      timestamp: point.timestamp,
      close: canonicalDecimal(point.close)
    }))
  };
}

function publicMarketSource(
  dependencies: V3BoundaryToolDependencies,
  sourceId: string,
  sourceAsOf: string
): ToolSource {
  return {
    provider: dependencies.market.descriptor.id,
    sourceId,
    sourceUrl: null,
    licenseClass:
      dependencies.market.descriptor.licenseClass === "synthetic"
        ? "synthetic"
        : dependencies.market.descriptor.licenseClass === "development-only"
          ? "public-indicative"
          : "licensed",
    observedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
    sourceAsOf
  };
}

function currencyRateSource(dependencies: V3BoundaryToolDependencies): ToolSource {
  return dependencies.currencyRates?.source ?? {
    provider: "currency-rate-unavailable",
    sourceId: "official-currency-rates",
    sourceUrl: "https://www.cbar.az/currency/rates?language=en",
    licenseClass: "public-indicative",
    observedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
    sourceAsOf: new Date((dependencies.now ?? Date.now)()).toISOString()
  };
}

async function currencyRate(
  dependencies: V3BoundaryToolDependencies,
  sourceCurrency: SupportedCurrencyCode,
  targetCurrency: SupportedCurrencyCode
): Promise<CurrencyRateQuote> {
  if (dependencies.currencyRates === undefined) {
    throw new V3BoundaryPortError(
      "CURRENCY_RATE_DEPENDENCY_UNAVAILABLE",
      "The official currency-rate service is not configured.",
      true
    );
  }
  let rate: CurrencyRateQuote;
  try {
    rate = await dependencies.currencyRates.getRate(sourceCurrency, targetCurrency);
  } catch (error) {
    if (error instanceof CurrencyRateProviderError) {
      throw new V3BoundaryPortError(error.code, error.message, error.retryable);
    }
    throw new V3BoundaryPortError(
      "CURRENCY_RATE_DEPENDENCY_UNAVAILABLE",
      "The official currency-rate service is temporarily unavailable.",
      true
    );
  }
  let parsedRate: bigint;
  let approvedUrl = false;
  try {
    parsedRate = parseFixedDecimal(rate.exchangeRate);
    const sourceUrl = new URL(rate.sourceUrl);
    approvedUrl =
      sourceUrl.protocol === "https:" &&
      (sourceUrl.hostname === "www.cbar.az" || sourceUrl.hostname === "cbar.az") &&
      (
        sourceUrl.pathname.startsWith("/currencies/") ||
        sourceUrl.pathname === "/currency/rates"
      );
  } catch {
    throw new V3BoundaryPortError(
      "CURRENCY_RATE_EVIDENCE_INVALID",
      "The official currency-rate service returned invalid evidence.",
      false
    );
  }
  if (
    rate.sourceCurrency !== sourceCurrency ||
    rate.targetCurrency !== targetCurrency ||
    parsedRate <= ZERO_FIXED ||
    rate.exchangeRate !== formatFixedDecimal(parsedRate) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(rate.effectiveDate) ||
    !Number.isFinite(Date.parse(rate.asOf)) ||
    !approvedUrl
  ) {
    throw new V3BoundaryPortError(
      "CURRENCY_RATE_EVIDENCE_INVALID",
      "The official currency-rate service returned invalid evidence.",
      false
    );
  }
  return rate;
}

interface CurrencyAmountEvidence {
  readonly sourceCurrency: SupportedCurrencyCode;
  readonly sourceAmount: DecimalString;
  readonly portfolioAsOf: string | null;
  readonly marketAsOf: readonly { symbol: string; asOf: string }[];
  readonly symbol: string | null;
  readonly displayName: string | null;
  readonly marketSnapshot: BoundaryMarketSnapshot | null;
  readonly marketSource: ToolSource | null;
}

async function currentMarketPriceAmount(input: {
  dependencies: V3BoundaryToolDependencies;
  symbol: string;
}): Promise<CurrencyAmountEvidence> {
  const snapshot = await input.dependencies.market.getSnapshot(input.symbol);
  if (snapshot.symbol !== input.symbol) {
    throw new V3BoundaryPortError(
      "MARKET_SYMBOL_MISMATCH",
      "Market evidence did not match the requested symbol.",
      false
    );
  }
  if (snapshot.currency !== "USD" && snapshot.currency !== "AZN") {
    throw new V3BoundaryPortError(
      "CURRENCY_PAIR_UNSUPPORTED",
      "The market price currency is not supported by the currency converter.",
      false
    );
  }
  const normalized = boundaryMarketSnapshot(snapshot);
  return {
    sourceCurrency: snapshot.currency,
    sourceAmount: normalized.price,
    portfolioAsOf: null,
    marketAsOf: Object.freeze([
      Object.freeze({ symbol: snapshot.symbol, asOf: snapshot.asOf })
    ]),
    symbol: snapshot.symbol,
    displayName: snapshot.displayName,
    marketSnapshot: Object.freeze(normalized),
    marketSource: Object.freeze(
      publicMarketSource(input.dependencies, "market-snapshot", snapshot.asOf)
    )
  };
}

async function currentPortfolioAmount(input: {
  dependencies: V3BoundaryToolDependencies;
  context: V3BoundaryExecutionContext;
}): Promise<CurrencyAmountEvidence> {
  const snapshot = await input.dependencies.portfolio.readSnapshot(
    privateScope(input.context)
  );
  if (snapshot.principalRef !== input.context.session.claims.principalId) {
    throw new V3BoundaryPortError(
      "PORTFOLIO_PRINCIPAL_MISMATCH",
      "Portfolio evidence belongs to a different principal.",
      false
    );
  }
  if (snapshot.baseCurrency !== "USD" && snapshot.baseCurrency !== "AZN") {
    throw new V3BoundaryPortError(
      "CURRENCY_PAIR_UNSUPPORTED",
      "The portfolio base currency is not supported by the currency converter.",
      false
    );
  }
  if (snapshot.currentCash.currency !== snapshot.baseCurrency) {
    throw new V3BoundaryPortError(
      "PORTFOLIO_CURRENCY_MISMATCH",
      "Portfolio cash did not match the portfolio base currency.",
      false
    );
  }

  const quantities = new Map<string, bigint>();
  for (const lot of snapshot.currentLots) {
    if (lot.unitCost.currency !== snapshot.baseCurrency) {
      throw new V3BoundaryPortError(
        "PORTFOLIO_CURRENCY_MISMATCH",
        "A portfolio lot did not match the portfolio base currency.",
        false
      );
    }
    quantities.set(
      lot.symbol,
      addFixed(
        quantities.get(lot.symbol) ?? ZERO_FIXED,
        parseFixedDecimal(lot.quantity)
      )
    );
  }
  const symbols = [...quantities.keys()].sort();
  const observations = await Promise.all(
    symbols.map(async (symbol) => {
      const market = await input.dependencies.market.getSnapshot(symbol);
      if (
        market.symbol !== symbol ||
        market.currency !== snapshot.baseCurrency
      ) {
        throw new V3BoundaryPortError(
          "MARKET_SCOPE_MISMATCH",
          "Market evidence did not match the portfolio instrument and currency.",
          false
        );
      }
      return market;
    })
  );

  let total = parseFixedDecimal(snapshot.currentCash.amount);
  for (const market of observations) {
    const quantity = quantities.get(market.symbol);
    if (quantity === undefined) {
      throw new V3BoundaryPortError(
        "MARKET_SCOPE_MISMATCH",
        "Market evidence did not match an open portfolio position.",
        false
      );
    }
    total = addFixed(
      total,
      multiplyFixed(quantity, parseFixedDecimal(canonicalDecimal(market.price)))
    );
  }
  return {
    sourceCurrency: snapshot.baseCurrency,
    sourceAmount: formatFixedDecimal(total),
    portfolioAsOf: snapshot.asOf,
    marketAsOf: Object.freeze(observations.map(({ symbol, asOf }) =>
      Object.freeze({ symbol, asOf })
    )),
    symbol: null,
    displayName: null,
    marketSnapshot: null,
    marketSource: null
  };
}

function reviewedAllocationTheme(input: {
  symbol: string;
  sector: string;
}): PortfolioAllocationTheme {
  if (input.sector.toLocaleLowerCase("en-US") === "technology") {
    return "technology";
  }
  if (input.symbol === "TSLA") return "technology-dependent";
  return "unclassified";
}

async function currentPortfolioAllocationInput(input: {
  dependencies: V3BoundaryToolDependencies;
  context: V3BoundaryExecutionContext;
}): Promise<CanonicalPortfolioAllocationAnalysisInput> {
  const snapshot = await input.dependencies.portfolio.readSnapshot(
    privateScope(input.context)
  );
  if (snapshot.principalRef !== input.context.session.claims.principalId) {
    throw new V3BoundaryPortError(
      "PORTFOLIO_PRINCIPAL_MISMATCH",
      "Portfolio evidence belongs to a different principal.",
      false
    );
  }
  if (snapshot.currentCash.currency !== snapshot.baseCurrency) {
    throw new V3BoundaryPortError(
      "PORTFOLIO_CURRENCY_MISMATCH",
      "Portfolio cash did not match the portfolio base currency.",
      false
    );
  }

  const quantities = new Map<string, bigint>();
  for (const lot of snapshot.currentLots) {
    if (lot.unitCost.currency !== snapshot.baseCurrency) {
      throw new V3BoundaryPortError(
        "PORTFOLIO_CURRENCY_MISMATCH",
        "A portfolio lot did not match the portfolio base currency.",
        false
      );
    }
    quantities.set(
      lot.symbol,
      addFixed(
        quantities.get(lot.symbol) ?? ZERO_FIXED,
        parseFixedDecimal(lot.quantity)
      )
    );
  }
  if (quantities.size === 0) {
    throw new V3BoundaryPortError(
      "PORTFOLIO_ALLOCATION_UNAVAILABLE",
      "The portfolio does not contain an investment position to analyze.",
      false
    );
  }

  const pricedPositions = await Promise.all(
    [...quantities.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([symbol, quantity]) => {
        const metadata = snapshot.instrumentMetadata.find(
          (item) => item.symbol === symbol
        );
        if (metadata === undefined || metadata.currency !== snapshot.baseCurrency) {
          throw new V3BoundaryPortError(
            "PORTFOLIO_METADATA_MISMATCH",
            "Portfolio instrument metadata is incomplete or uses another currency.",
            false
          );
        }
        const market = await input.dependencies.market.getSnapshot(symbol);
        if (
          market.symbol !== symbol ||
          market.currency !== snapshot.baseCurrency
        ) {
          throw new V3BoundaryPortError(
            "MARKET_SCOPE_MISMATCH",
            "Market evidence did not match the portfolio instrument and currency.",
            false
          );
        }
        const amount = multiplyFixed(
          quantity,
          parseFixedDecimal(canonicalDecimal(market.price))
        );
        return {
          metadata,
          amount
        };
      })
  );

  const cashAmount = parseFixedDecimal(snapshot.currentCash.amount);
  const totalValue = sumFixed([
    cashAmount,
    ...pricedPositions.map(({ amount }) => amount)
  ]);
  if (totalValue <= ZERO_FIXED) {
    throw new V3BoundaryPortError(
      "PORTFOLIO_ALLOCATION_UNAVAILABLE",
      "The portfolio value is not positive.",
      false
    );
  }

  const investmentRows: PortfolioAllocationInputRow[] = pricedPositions.map(
    ({ metadata, amount }) => ({
      label: metadata.displayName,
      symbol: metadata.symbol,
      category: metadata.sector,
      theme: reviewedAllocationTheme(metadata),
      allocationRate: formatFixedDecimal(divideFixed(amount, totalValue)),
      amount: formatFixedDecimal(amount)
    })
  );
  const investmentRate = sumFixed(
    investmentRows.map(({ allocationRate }) =>
      parseFixedDecimal(allocationRate)
    )
  );
  const cashRate = subtractFixed(ONE_FIXED, investmentRate);
  if (cashRate < ZERO_FIXED) {
    throw new V3BoundaryPortError(
      "PORTFOLIO_ALLOCATION_RECONCILIATION_FAILED",
      "Portfolio allocation rates could not be reconciled.",
      false
    );
  }

  return {
    scope: "current",
    dataClass: "synthetic",
    currency: snapshot.baseCurrency,
    asOf: input.context.trustedContext.requestedAt,
    totalValue: formatFixedDecimal(totalValue),
    allocations: Object.freeze([
      ...investmentRows,
      Object.freeze({
        label: "Cash",
        symbol: null,
        category: "Cash",
        theme: "cash" as const,
        allocationRate: formatFixedDecimal(cashRate),
        amount: snapshot.currentCash.amount
      })
    ]),
    riskProfile: Object.freeze({
      riskBand: snapshot.investorProfile.riskBand,
      objective: snapshot.investorProfile.objective,
      timeHorizonYears: snapshot.investorProfile.timeHorizonYears,
      singleStockTargetMaxAllocationRate:
        snapshot.investorProfile.singleStockTargetMaxAllocationRate,
      rebalancePreference: snapshot.investorProfile.rebalancePreference,
      reviewedAt: snapshot.investorProfile.reviewedAt
    })
  };
}

function refreshedSource(
  source: ToolSource,
  sourceAsOf: string,
  now: () => number
): ToolSource {
  return {
    ...source,
    observedAt: new Date(now()).toISOString(),
    sourceAsOf
  };
}

function knowledgeContext(
  context: V3BoundaryExecutionContext
): KnowledgeQueryContext {
  return {
    locale: context.trustedContext.locale,
    jurisdiction: "AZ",
    productScopes: ["DEMO_INVEST"],
    channel: "customer_chat",
    asOf: context.trustedContext.requestedAt,
    requestId: context.requestId
  };
}

function validateKnowledgeResult(
  result: KnowledgeToolResult,
  expected: KnowledgeQueryContext
): void {
  const filter = result.retrieval.trustedFilter;
  if (
    result.locale !== expected.locale ||
    result.jurisdiction !== "AZ" ||
    filter.locale !== expected.locale ||
    filter.jurisdiction !== "AZ" ||
    filter.approvalStatus !== "approved" ||
    filter.channel !== "customer_chat" ||
    filter.asOf !== expected.asOf ||
    filter.productScopes.length !== 1 ||
    filter.productScopes[0] !== "DEMO_INVEST"
  ) {
    throw new V3BoundaryPortError(
      "KNOWLEDGE_SCOPE_MISMATCH",
      "Approved knowledge evidence did not match the server-owned scope.",
      false
    );
  }
  if (result.status !== "grounded") {
    throw new V3BoundaryPortError(
      `KNOWLEDGE_${result.status.toUpperCase()}`,
      result.status === "dependency_unavailable"
        ? "Approved product knowledge is temporarily unavailable."
        : "No unambiguous eligible product evidence was available.",
      result.status === "dependency_unavailable"
    );
  }
}

function financialEducationContext(
  context: V3BoundaryExecutionContext
): FinancialEducationQueryContext {
  return {
    requestId: context.requestId,
    locale: context.trustedContext.locale,
    jurisdiction: "AZ",
    channel: "customer_chat",
    asOf: context.trustedContext.requestedAt
  };
}

function validateFinancialEducationResult(
  result: FinancialEducationRetrievalResult,
  expected: FinancialEducationQueryContext,
  query: string
): void {
  const expectedHash = financialEducationQueryHash(query);
  if (
    expectedHash === null ||
    result.requestId !== expected.requestId ||
    result.queryHash !== expectedHash ||
    result.retrieval.queryHash !== expectedHash ||
    result.locale !== expected.locale ||
    result.retrieval.locale !== expected.locale ||
    result.propositions.some(({ locale }) => locale !== expected.locale) ||
    result.citations.some(({ locale, jurisdiction }) =>
      locale !== expected.locale || jurisdiction !== "AZ"
    )
  ) {
    throw new V3BoundaryPortError(
      "EDUCATION_SCOPE_MISMATCH",
      "Approved financial-education evidence did not match the server-owned scope.",
      false
    );
  }
  if (result.status !== "grounded") {
    throw new V3BoundaryPortError(
      `EDUCATION_${result.status.toUpperCase()}`,
      result.status === "dependency_unavailable"
        ? "Approved financial education is temporarily unavailable."
        : result.status === "not_permitted"
          ? "The requested personalized recommendation is outside this education boundary."
          : "No sufficiently relevant approved financial-education evidence was available.",
      result.status === "dependency_unavailable"
    );
  }
  if (
    result.propositions.length < 1 ||
    result.propositions.length > result.retrieval.topK ||
    result.citations.length !== result.propositions.length ||
    result.propositions.some((proposition) =>
      !result.citations.some((citation) =>
        citation.citationId === proposition.citationId &&
        citation.propositionId === proposition.propositionId &&
        citation.sourceId === proposition.sourceId &&
        citation.version === proposition.sourceVersion &&
        citation.excerpt === proposition.text
      )
    )
  ) {
    throw new V3BoundaryPortError(
      "EDUCATION_EVIDENCE_INVALID",
      "Approved financial-education evidence was incomplete.",
      false
    );
  }
}

function normalizedError(error: unknown): V3BoundaryPortError {
  return error instanceof V3BoundaryPortError
    ? error
    : new V3BoundaryPortError(
        "BOUNDARY_DEPENDENCY_UNAVAILABLE",
        "The boundary dependency is temporarily unavailable.",
        true
      );
}

function createGrantedExecutor(dependencies: V3BoundaryToolDependencies) {
  const now = dependencies.now ?? Date.now;
  const evidence = new EvidenceFactory({ signer: dependencies.signer, now });

  return async function executeGranted<TArgs, TResult>(input: {
    toolId: V3ApprovedBoundaryToolId;
    args: TArgs;
    internalContext: unknown;
    source: ToolSource;
    operation: (
      context: V3BoundaryExecutionContext
    ) => Promise<BoundaryOperationResult<TResult>>;
  }): Promise<ToolExecutionEnvelope<TResult> | ToolExecutionEnvelope<never>> {
    if (dependencies.privateStudioExecutionBroker?.isDenied(input.internalContext)) {
      const denial = input.internalContext;
      if (denial.toolId !== input.toolId) {
        throw new V3BoundaryToolAuthorizationError(
          "studio_denial_scope_mismatch",
          "Private Studio denial scope does not match the requested tool."
        );
      }
      return evidence.toolUnavailable({
        requestId: denial.requestId,
        workflowRunId: denial.workflowRunId,
        toolId: input.toolId,
        toolVersion: V3_BOUNDARY_TOOL_VERSION,
        arguments: input.args,
        source: refreshedSource(input.source, denial.requestedAt, now),
        code: denial.code,
        message: denial.message,
        retryable: false,
        startedAt: new Date(now()).toISOString()
      });
    }
    const context = requireExecutionContext(
      input.internalContext,
      dependencies.privateStudioExecutionBroker
    );
    dependencies.grantAuthority.consume(context.grantToken, {
      requestId: context.requestId,
      workflowRunId: context.workflowRunId,
      policy: context.policy,
      session: context.session,
      toolId: input.toolId,
      args: input.args
    });

    const startedAt = new Date(now()).toISOString();
    try {
      const operation = await input.operation(context);
      return evidence.toolSuccess({
        requestId: context.requestId,
        workflowRunId: context.workflowRunId,
        toolId: input.toolId,
        toolVersion: V3_BOUNDARY_TOOL_VERSION,
        arguments: input.args,
        result: operation.result,
        source: refreshedSource(input.source, operation.sourceAsOf, now),
        startedAt
      });
    } catch (error) {
      const failure = normalizedError(error);
      return evidence.toolUnavailable({
        requestId: context.requestId,
        workflowRunId: context.workflowRunId,
        toolId: input.toolId,
        toolVersion: V3_BOUNDARY_TOOL_VERSION,
        arguments: input.args,
        source: refreshedSource(
          input.source,
          context.trustedContext.requestedAt,
          now
        ),
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        startedAt
      });
    }
  };
}

/**
 * Creates exactly the grant-gated Mastra tools approved by the V3 policy.
 * Grant material is read only from server-owned RequestContext, never tool args.
 */
export function createV3BoundaryTools(dependencies: V3BoundaryToolDependencies) {
  const executeGranted = createGrantedExecutor(dependencies);
  const financialEducation: FinancialEducationBoundaryPort =
    dependencies.financialEducation ?? {
      source: {
        provider: "approved-financial-education-unavailable",
        sourceId: "approved-financial-education-unavailable",
        sourceUrl: null,
        licenseClass: "project-internal",
        observedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
        sourceAsOf: new Date((dependencies.now ?? Date.now)()).toISOString()
      },
      retrieve: async () => {
        throw new V3BoundaryPortError(
          "EDUCATION_DEPENDENCY_UNAVAILABLE",
          "Approved financial education is temporarily unavailable.",
          true
        );
      }
    };
  const requestContextSchema = dependencies.privateStudioExecutionBroker === undefined
    ? boundaryRequestContextSchema
    : z.object({
        [V3_BOUNDARY_EXECUTION_CONTEXT_KEY]: z.unknown().optional()
      }).passthrough();
  const description = (
    toolId: V3ApprovedBoundaryToolId,
    base: string
  ): string => {
    if (dependencies.privateStudioExecutionBroker === undefined) return base;
    if (toolId === "create-signed-order-handoff") {
      return `${base} Private Studio keeps this write boundary disabled; use the application preview/confirmation flow.`;
    }
    if (toolId === "read-portfolio-snapshot" || toolId === "read-portfolio-activity") {
      return `${base} Private Studio returns synthetic client fixtures only.`;
    }
    if (toolId === "convert-currency") {
      return `${base} Private Studio uses synthetic portfolio fixtures, a development-only live market feed, and the official public CBA rate.`;
    }
    if (toolId === "analyze-portfolio-allocation") {
      return `${base} Private Studio uses a synthetic client portfolio and development-only public prices for connected-portfolio analysis.`;
    }
    if (toolId === "retrieve-approved-product-knowledge") {
      return `${base} Private Studio uses a process-memory approved-document index and stores no customer query.`;
    }
    if (toolId === "retrieve-reviewed-investment-education") {
      return `${base} Private Studio uses the same approved, versioned bilingual education corpus as the application.`;
    }
    if (toolId === "read-order-eligibility") {
      return `${base} Private Studio evaluates the synthetic internal-pilot policy only.`;
    }
    return `${base} Private Studio uses a development-only live public feed.`;
  };
  const publicSource = (sourceId: string): ToolSource =>
    publicMarketSource(
      dependencies,
      sourceId,
      new Date((dependencies.now ?? Date.now)()).toISOString()
    );
  const allocationAnalysisSource = (): ToolSource => ({
    provider: "assistant-v3-allocation-engine",
    sourceId: "portfolio-allocation-analysis-v1",
    sourceUrl: null,
    licenseClass: "synthetic",
    observedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
    sourceAsOf: new Date((dependencies.now ?? Date.now)()).toISOString()
  });
  const resolveInstrument = createTool({
    id: "resolve-instrument",
    description: description(
      "resolve-instrument",
      "Resolve one exact public ticker to a governed instrument identity."
    ),
    inputSchema: z.object({ symbol: symbolSchema }).strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted({
        toolId: "resolve-instrument",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "resolve-instrument",
          args,
          runtime
        ),
        source: dependencies.instrumentResolver.source,
        operation: async () => {
          const result = await dependencies.instrumentResolver.resolve(args.symbol);
          if (result.symbol !== args.symbol) {
            throw new V3BoundaryPortError(
              "INSTRUMENT_SYMBOL_MISMATCH",
              "Resolved instrument did not match the requested symbol.",
              false
            );
          }
          return { result, sourceAsOf: result.resolvedAt };
        }
      })
  });

  const readMarketSnapshot = createTool({
    id: "read-market-snapshot",
    description: description(
      "read-market-snapshot",
      "Read one informational market snapshot from the configured public provider."
    ),
    inputSchema: z.object({ symbol: symbolSchema }).strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted({
        toolId: "read-market-snapshot",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "read-market-snapshot",
          args,
          runtime
        ),
        source: publicSource("market-snapshot"),
        operation: async () => {
          const snapshot = await dependencies.market.getSnapshot(args.symbol);
          if (snapshot.symbol !== args.symbol) {
            throw new V3BoundaryPortError(
              "MARKET_SYMBOL_MISMATCH",
              "Market evidence did not match the requested symbol.",
              false
            );
          }
          return { result: boundaryMarketSnapshot(snapshot), sourceAsOf: snapshot.asOf };
        }
      })
  });

  const readPriceHistory = createTool({
    id: "read-price-history",
    description: description(
      "read-price-history",
      "Read bounded closing-price history for one exact ticker and range."
    ),
    inputSchema: z.object({ symbol: symbolSchema, range: priceHistoryRangeSchema }).strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted({
        toolId: "read-price-history",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "read-price-history",
          args,
          runtime
        ),
        source: dependencies.priceHistory.source,
        operation: async () => {
          const history = await dependencies.priceHistory.getHistory(args.symbol, args.range);
          if (history.symbol !== args.symbol || history.range !== args.range) {
            throw new V3BoundaryPortError(
              "HISTORY_SCOPE_MISMATCH",
              "Price history did not match the requested symbol and range.",
              false
            );
          }
          return { result: boundaryPriceHistory(history), sourceAsOf: history.asOf };
        }
      })
  });

  const readInstrumentResearch = createTool({
    id: "read-instrument-research",
    description: description(
      "read-instrument-research",
      "Read sourced normalized equity, ETF, or bond facts without memory fallback."
    ),
    inputSchema: z.object({ symbol: symbolSchema }).strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted<
        { symbol: string },
        InstrumentFacts
      >({
        toolId: "read-instrument-research",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "read-instrument-research",
          args,
          runtime
        ),
        source: publicSource("instrument-research"),
        operation: async () => {
          const result = await getInstrumentResearch(dependencies.market, args.symbol);
          if (result.symbol !== args.symbol) {
            throw new V3BoundaryPortError(
              "RESEARCH_SYMBOL_MISMATCH",
              "Research evidence did not match the requested symbol.",
              false
            );
          }
          return { result, sourceAsOf: result.generatedAt };
        }
      })
  });

  const readMarketContent = createTool({
    id: "read-market-content",
    description: description(
      "read-market-content",
      "Read deduplicated ticker news and market events with preserved attribution."
    ),
    inputSchema: z.object({ symbol: symbolSchema }).strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted<
        { symbol: string },
        MarketContentItem[]
      >({
        toolId: "read-market-content",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "read-market-content",
          args,
          runtime
        ),
        source: publicSource("market-content"),
        operation: async () => {
          const report = await dependencies.market.getResearch(args.symbol);
          if (report.symbol !== args.symbol) {
            throw new V3BoundaryPortError(
              "CONTENT_SYMBOL_MISMATCH",
              "Market content did not match the requested symbol.",
              false
            );
          }
          return {
            result: marketContentFromResearchReports(
              [report],
              dependencies.market.descriptor
            ),
            sourceAsOf: report.generatedAt
          };
        }
      })
  });

  const convertCurrency = createTool({
    id: "convert-currency",
    description: description(
      "convert-currency",
      "Convert a canonical USD/AZN amount using the official Central Bank of Azerbaijan rate. The current-market-price scope retrieves one fresh public quote before conversion, and the current-portfolio scope performs a fresh server-scoped portfolio valuation."
    ),
    inputSchema: currencyConversionSchema,
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted<CurrencyConversionArguments, CurrencyConversionResult>({
        toolId: "convert-currency",
        args: args as CurrencyConversionArguments,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "convert-currency",
          args,
          runtime
        ),
        source: currencyRateSource(dependencies),
        operation: async (context) => {
          const amount: CurrencyAmountEvidence =
            args.scope === "provided-amount"
              ? {
                  sourceCurrency: args.sourceCurrency,
                  sourceAmount: args.amount as DecimalString,
                  portfolioAsOf: null,
                  marketAsOf: Object.freeze([]),
                  symbol: null,
                  displayName: null,
                  marketSnapshot: null,
                  marketSource: null
                }
              : args.scope === "current-market-price"
                ? await currentMarketPriceAmount({
                    dependencies,
                    symbol: args.symbol
                  })
                : await currentPortfolioAmount({ dependencies, context });
          const rate = await currencyRate(
            dependencies,
            amount.sourceCurrency,
            args.targetCurrency
          );
          const convertedAmount = formatFixedDecimal(
            multiplyFixed(
              parseFixedDecimal(amount.sourceAmount),
              parseFixedDecimal(rate.exchangeRate)
            )
          );
          return {
            result: Object.freeze({
              schemaVersion: "assistant-v3.currency-conversion.v1" as const,
              scope: args.scope,
              sourceCurrency: amount.sourceCurrency,
              targetCurrency: args.targetCurrency,
              sourceAmount: amount.sourceAmount,
              exchangeRate: rate.exchangeRate,
              convertedAmount,
              rateEffectiveDate: rate.effectiveDate,
              rateAsOf: rate.asOf,
              rateSourceUrl: rate.sourceUrl,
              portfolioDataClass:
                args.scope === "current-portfolio-value" ? "synthetic" as const : null,
              portfolioAsOf: amount.portfolioAsOf,
              marketAsOf: amount.marketAsOf,
              symbol: amount.symbol,
              displayName: amount.displayName,
              marketSnapshot: amount.marketSnapshot,
              marketSource: amount.marketSource
            }),
            sourceAsOf: rate.asOf
          };
        }
      })
  });

  const analyzePortfolioAllocation = createTool({
    id: "analyze-portfolio-allocation",
    description: description(
      "analyze-portfolio-allocation",
      "Calculate signed portfolio allocation, concentration, theme, cash, and non-advisory review metrics. The result is structured evidence only and never selects a trade or target allocation."
    ),
    inputSchema: portfolioAllocationAnalysisSchema,
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (rawArgs, runtime) => {
      const args = portfolioAllocationAnalysisSchema.parse(
        rawArgs
      ) as PortfolioAllocationAnalysisArguments;
      return executeGranted<
        PortfolioAllocationAnalysisArguments,
        PortfolioAllocationAnalysisResult
      >({
        toolId: "analyze-portfolio-allocation",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "analyze-portfolio-allocation",
          args,
          runtime
        ),
        source: allocationAnalysisSource(),
        operation: async (context) => {
          const expectedRoute = args.scope === "current"
            ? "portfolio_allocation_analysis"
            : "hypothetical_portfolio_analysis";
          if (context.policy.route !== expectedRoute) {
            throw new V3BoundaryPortError(
              "ALLOCATION_ANALYSIS_SCOPE_MISMATCH",
              "The requested allocation scope does not match the authorized route.",
              false
            );
          }
          try {
            const canonicalInput: CanonicalPortfolioAllocationAnalysisInput =
              args.scope === "current"
                ? await currentPortfolioAllocationInput({
                    dependencies,
                    context
                  })
                : {
                    scope: "hypothetical",
                    dataClass: "user-supplied-hypothetical",
                    currency: args.currency,
                    asOf: context.trustedContext.requestedAt,
                    totalValue: args.totalValue,
                    allocations: args.allocations,
                    riskProfile: null
                  };
            const result = projectPortfolioAllocationAnalysis(canonicalInput);
            return { result, sourceAsOf: result.asOf };
          } catch (error) {
            if (error instanceof V3BoundaryPortError) throw error;
            throw new V3BoundaryPortError(
              "ALLOCATION_ANALYSIS_INPUT_INVALID",
              "The portfolio allocation could not be validated for analysis.",
              false
            );
          }
        }
      });
    }
  });

  const readPortfolioSnapshot = createTool({
    id: "read-portfolio-snapshot",
    description: description(
      "read-portfolio-snapshot",
      "Read the authenticated principal's portfolio snapshot from server-owned scope."
    ),
    inputSchema: z.object({}).strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted<
        Record<string, never>,
        MockPortfolioPositionSnapshot
      >({
        toolId: "read-portfolio-snapshot",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "read-portfolio-snapshot",
          args,
          runtime
        ),
        source: dependencies.portfolio.source,
        operation: async (context) => {
          const result = await dependencies.portfolio.readSnapshot(privateScope(context));
          if (result.principalRef !== context.session.claims.principalId) {
            throw new V3BoundaryPortError(
              "PORTFOLIO_PRINCIPAL_MISMATCH",
              "Portfolio evidence belongs to a different principal.",
              false
            );
          }
          return { result, sourceAsOf: result.asOf };
        }
      })
  });

  const legacyPeriodActivitySchema = z
    .object({ periodStart: timestampSchema, periodEnd: timestampSchema })
    .strict()
    .refine(
      ({ periodStart, periodEnd }) => Date.parse(periodStart) <= Date.parse(periodEnd),
      { message: "periodStart must not be later than periodEnd." }
    );
  const periodLedgerActivitySchema = z
    .object({
      queryType: z.literal("period-ledger"),
      periodStart: timestampSchema,
      periodEnd: timestampSchema
    })
    .strict();
  const recentTradingActivitySchema = z.object({
    queryType: z.literal("recent-trading"),
    limit: z.number().int().min(1).max(10),
    include: z.enum(["executions", "orders", "all"]),
    symbol: symbolSchema.optional(),
    side: z.enum(["BUY", "SELL"]).optional()
  }).strict();
  const discriminatedActivitySchema = z
    .discriminatedUnion("queryType", [
      periodLedgerActivitySchema,
      recentTradingActivitySchema
    ])
    .refine(
      (args) => args.queryType !== "period-ledger" ||
        Date.parse(args.periodStart) <= Date.parse(args.periodEnd),
      { message: "periodStart must not be later than periodEnd." }
    );
  /** Compatibility branch for the active period-ledger workflow during V3 cutover. */
  const activitySchema = z.union([
    discriminatedActivitySchema,
    legacyPeriodActivitySchema
  ]);
  type ActivityArguments = z.infer<typeof activitySchema>;
  const activityQuery = (args: ActivityArguments): PortfolioActivityQuery => {
    if (!("queryType" in args)) {
      return {
        queryType: "period-ledger",
        periodStart: args.periodStart,
        periodEnd: args.periodEnd
      };
    }
    if (args.queryType === "period-ledger") return args;
    return {
      queryType: "recent-trading",
      limit: args.limit,
      include: args.include,
      ...(args.symbol === undefined ? {} : { symbol: args.symbol }),
      ...(args.side === undefined ? {} : { side: args.side })
    };
  };
  const readPortfolioActivity = createTool({
    id: "read-portfolio-activity",
    description: description(
      "read-portfolio-activity",
      "Read either a bounded period ledger or up to 10 recent executions/orders for the authenticated principal, without accepting account IDs."
    ),
    inputSchema: activitySchema,
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (rawArgs, runtime) => {
      const args = activitySchema.parse(rawArgs);
      return executeGranted<
        ActivityArguments,
        PortfolioActivityResult
      >({
        toolId: "read-portfolio-activity",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "read-portfolio-activity",
          args,
          runtime
        ),
        source: dependencies.portfolio.source,
        operation: async (context) => {
          const query = activityQuery(args);
          const result = await dependencies.portfolio.readActivity(
            privateScope(context),
            query
          );
          return {
            result,
            sourceAsOf: query.queryType === "period-ledger"
              ? query.periodEnd
              : (result as RecentTradingActivityResult).asOf
          };
        }
      });
    }
  });

  const retrieveApprovedKnowledge = createTool({
    id: "retrieve-approved-product-knowledge",
    description: description(
      "retrieve-approved-product-knowledge",
      "Retrieve configured product evidence using only server-derived locale, jurisdiction, scope, channel, and as-of filters."
    ),
    inputSchema: z.object({ query: z.string().min(1).max(2_000) }).strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted<
        { query: string },
        KnowledgeToolResult
      >({
        toolId: "retrieve-approved-product-knowledge",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "retrieve-approved-product-knowledge",
          args,
          runtime
        ),
        source: dependencies.approvedKnowledge.source,
        operation: async (context) => {
          const expected = knowledgeContext(context);
          const result = await dependencies.approvedKnowledge.retrieve(
            args.query.normalize("NFKC").trim(),
            expected
          );
          validateKnowledgeResult(result, expected);
          return { result, sourceAsOf: result.retrieval.trustedFilter.asOf };
        }
      })
  });

  const retrieveReviewedInvestmentEducation = createTool({
    id: "retrieve-reviewed-investment-education",
    description: description(
      "retrieve-reviewed-investment-education",
      "Retrieve relevant propositions from the approved bilingual financial-education corpus for a normalized query; this returns structured evidence, never a ready-written answer."
    ),
    inputSchema: z.object({ query: z.string().min(1).max(2_000) }).strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted<
        { query: string },
        FinancialEducationRetrievalResult
      >({
        toolId: "retrieve-reviewed-investment-education",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "retrieve-reviewed-investment-education",
          args,
          runtime
        ),
        source: financialEducation.source,
        operation: async (context) => {
          const query = normalizeFinancialEducationQuery(args.query);
          if (
            query === null ||
            query !== args.query ||
            context.policy.route !== "education" ||
            !context.policy.allowedToolIds.includes(
              "retrieve-reviewed-investment-education"
            )
          ) {
            throw new V3BoundaryPortError(
              "EDUCATION_SCOPE_MISMATCH",
              "Reviewed education retrieval is outside the authorized route.",
              false
            );
          }
          const expected = financialEducationContext(context);
          const result = await financialEducation.retrieve({
            query,
            context: expected
          });
          validateFinancialEducationResult(result, expected, query);
          return {
            result,
            sourceAsOf:
              result.citations
                .map(({ reviewedAt }) => reviewedAt)
                .sort()
                .at(-1) ?? context.trustedContext.requestedAt
          };
        }
      })
  });

  const readOrderEligibility = createTool({
    id: "read-order-eligibility",
    description: description(
      "read-order-eligibility",
      "Read order-preview eligibility; this never submits or reserves an order."
    ),
    inputSchema: z
      .object({
        symbol: symbolSchema,
        side: z.literal("BUY"),
        requestedNotional: decimalStringSchema
      })
      .strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted<
        { symbol: string; side: "BUY"; requestedNotional: string },
        OrderEligibility
      >({
        toolId: "read-order-eligibility",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "read-order-eligibility",
          args,
          runtime
        ),
        source: dependencies.orderEligibility.source,
        operation: async (context) => {
          const result = await dependencies.orderEligibility.readEligibility({
            context: context.trustedContext,
            symbol: args.symbol,
            side: args.side,
            requestedNotional: args.requestedNotional as DecimalString
          });
          return { result, sourceAsOf: result.checkedAt };
        }
      })
  });

  const createSignedOrderHandoff = createTool({
    id: "create-signed-order-handoff",
    description: description(
      "create-signed-order-handoff",
      "Create a one-use signed deep link only after explicit confirmation; never execute an order."
    ),
    inputSchema: z
      .object({ intentId: z.string().uuid(), explicitConfirmation: z.literal(true) })
      .strict(),
    requestContextSchema,
    outputSchema: toolExecutionOutputSchema,
    strict: true,
    execute: async (args, runtime) =>
      executeGranted<
        { intentId: string; explicitConfirmation: true },
        SignedOrderHandoff
      >({
        toolId: "create-signed-order-handoff",
        args,
        internalContext: await runtimeExecutionContext(
          dependencies,
          "create-signed-order-handoff",
          args,
          runtime
        ),
        source: dependencies.orderHandoff.source,
        operation: async (context) => {
          const result = await Promise.resolve(
            dependencies.orderHandoff.confirm({
              intentId: args.intentId,
              context: context.trustedContext,
              explicitConfirmation: args.explicitConfirmation
            })
          );
          return { result, sourceAsOf: result.payload.issuedAt };
        }
      })
  });

  return Object.freeze({
    "resolve-instrument": resolveInstrument,
    "read-market-snapshot": readMarketSnapshot,
    "read-price-history": readPriceHistory,
    "read-instrument-research": readInstrumentResearch,
    "read-market-content": readMarketContent,
    "convert-currency": convertCurrency,
    "analyze-portfolio-allocation": analyzePortfolioAllocation,
    "read-portfolio-snapshot": readPortfolioSnapshot,
    "read-portfolio-activity": readPortfolioActivity,
    "retrieve-reviewed-investment-education":
      retrieveReviewedInvestmentEducation,
    "retrieve-approved-product-knowledge": retrieveApprovedKnowledge,
    "read-order-eligibility": readOrderEligibility,
    "create-signed-order-handoff": createSignedOrderHandoff
  });
}

export type V3BoundaryTools = ReturnType<typeof createV3BoundaryTools>;
