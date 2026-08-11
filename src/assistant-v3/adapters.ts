import type { KnowledgeQueryContext, KnowledgeToolResult } from "../domain/knowledge.js";
import type { MarketHistoryProvider } from "../services/market-history.js";
import type {
  ApprovedKnowledgeServicePort
} from "./approved-knowledge.js";
import type {
  ApprovedKnowledgeBoundaryPort,
  InstrumentResolverPort,
  OrderEligibilityBoundaryPort,
  PortfolioBoundaryPort,
  PriceHistoryPort,
  PrivatePortfolioScope,
  ResolvedInstrument,
  SignedOrderHandoffBoundaryPort
} from "./boundary-tools.js";
import type { DecimalString, ToolSource } from "./contracts.js";
import { decimal, parseFixedDecimal } from "./fixed-decimal.js";
import {
  mockPortfolioSnapshot,
  type MockPortfolioActivity,
  type MockPortfolioPositionSnapshot,
  type PortfolioActivityQuery,
  type PortfolioActivityResult,
  type RecentTradingActivityItem,
  type RecentTradingActivityQuery,
  type RecentTradingActivityResult
} from "./mock-portfolio.js";
import {
  OrderHandoffStore,
  type OrderEligibility
} from "./order-handoff.js";
import type { PublicMarketResearchPort } from "./providers.js";

function source(input: {
  provider: string;
  sourceId: string;
  licenseClass: ToolSource["licenseClass"];
  now: () => number;
}): ToolSource {
  const observedAt = new Date(input.now()).toISOString();
  return {
    provider: input.provider,
    sourceId: input.sourceId,
    sourceUrl: null,
    licenseClass: input.licenseClass,
    observedAt,
    sourceAsOf: observedAt
  };
}

function instrumentType(value: string): ResolvedInstrument["instrumentType"] {
  const normalized = value.trim().toUpperCase().replace(/[ -]+/gu, "_");
  if (normalized === "ETF" || normalized === "EXCHANGE_TRADED_FUND") return "ETF";
  if (normalized.includes("BOND") || normalized === "FIXED_INCOME") return "BOND";
  if (normalized === "EQUITY" || normalized === "STOCK") return "EQUITY";
  throw new Error("The provider did not return a supported instrument type.");
}

export class LiveInstrumentResolver implements InstrumentResolverPort {
  readonly source: ToolSource;

  constructor(
    private readonly market: PublicMarketResearchPort,
    now: () => number = Date.now
  ) {
    this.source = source({
      provider: market.descriptor.id,
      sourceId: "instrument-resolution-v3",
      licenseClass:
        market.descriptor.licenseClass === "synthetic"
          ? "synthetic"
          : market.descriptor.licenseClass === "development-only"
            ? "public-indicative"
            : "licensed",
      now
    });
  }

  async resolve(symbol: string): Promise<ResolvedInstrument> {
    const snapshot = await this.market.getSnapshot(symbol);
    if (snapshot.symbol !== symbol) throw new Error("Resolved ticker did not match the request.");
    return {
      instrumentId: `${snapshot.exchange}:${snapshot.symbol}`,
      symbol: snapshot.symbol,
      displayName: snapshot.displayName,
      instrumentType: instrumentType(snapshot.instrumentType),
      exchange: snapshot.exchange,
      currency: snapshot.currency,
      resolvedAt: snapshot.asOf
    };
  }
}

export class LivePriceHistoryPort implements PriceHistoryPort {
  readonly source: ToolSource;

  constructor(
    private readonly history: MarketHistoryProvider,
    provider: {
      id: string;
      licenseClass: "synthetic" | "development-only" | "production-approved";
    } = {
      id: "yahoo-finance",
      licenseClass: "development-only"
    },
    now: () => number = Date.now
  ) {
    this.source = source({
      provider: provider.id,
      sourceId: "price-history-v3",
      licenseClass:
        provider.licenseClass === "synthetic"
          ? "synthetic"
          : provider.licenseClass === "development-only"
            ? "public-indicative"
            : "licensed",
      now
    });
  }

  getHistory: PriceHistoryPort["getHistory"] = (symbol, range) =>
    this.history.getHistory(symbol, range);
}

/** Synthetic private adapter. It never accepts an account/client identifier. */
export class SyntheticPortfolioPort implements PortfolioBoundaryPort {
  readonly source: ToolSource;
  readonly #tenantRef: string;
  readonly #principalRef: string;

  constructor(input: {
    tenantRef: string;
    principalRef: string;
    now?: () => number;
  }) {
    this.#tenantRef = input.tenantRef;
    this.#principalRef = input.principalRef;
    this.source = source({
      provider: "synthetic-client-ledger",
      sourceId: "synthetic-primary-portfolio-v3",
      licenseClass: "synthetic",
      now: input.now ?? Date.now
    });
  }

  #authorize(scope: PrivatePortfolioScope): void {
    if (scope.tenantId !== this.#tenantRef || scope.principalId !== this.#principalRef) {
      throw new Error("Portfolio scope is not entitled for this principal.");
    }
  }

  async readSnapshot(scope: PrivatePortfolioScope): Promise<MockPortfolioPositionSnapshot> {
    this.#authorize(scope);
    const { activity: _activity, ...snapshot } = structuredClone(mockPortfolioSnapshot);
    snapshot.principalRef = this.#principalRef;
    return snapshot;
  }

  async readActivity(
    scope: PrivatePortfolioScope,
    query: PortfolioActivityQuery
  ): Promise<PortfolioActivityResult> {
    this.#authorize(scope);
    if (query.queryType === "period-ledger") {
      const periodStart = Date.parse(query.periodStart);
      const periodEnd = Date.parse(query.periodEnd);
      const ledgerStart = Date.parse(mockPortfolioSnapshot.periodStart);
      const ledgerEnd = Date.parse(mockPortfolioSnapshot.asOf);
      if (
        !Number.isFinite(periodStart) ||
        !Number.isFinite(periodEnd) ||
        periodStart > periodEnd ||
        periodStart < ledgerStart ||
        periodEnd > ledgerEnd
      ) {
        throw new Error("Requested activity period is outside the synthetic ledger window.");
      }
      return selectPortfolioPeriodActivity({
        activity: mockPortfolioSnapshot.activity,
        periodStart,
        periodEnd
      });
    }
    return selectRecentTradingActivity({
      activity: mockPortfolioSnapshot.activity,
      query,
      ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
      ledgerPeriodEnd: mockPortfolioSnapshot.asOf
    });
  }
}

function selectPortfolioPeriodActivity(input: {
  activity: MockPortfolioActivity;
  periodStart: number;
  periodEnd: number;
}): MockPortfolioActivity {
  const within = (value: string): boolean => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) &&
      timestamp >= input.periodStart &&
      timestamp <= input.periodEnd;
  };
  const transactions = input.activity.transactions.filter(({ tradedAt }) => within(tradedAt));
  const orders = input.activity.orders.filter(({ lastUpdatedAt }) => within(lastUpdatedAt));
  const externalCashFlows = input.activity.externalCashFlows.filter(({ occurredAt }) =>
    within(occurredAt)
  );
  const selectedCashFlowIds = new Set(
    externalCashFlows.map(({ cashFlowId }) => cashFlowId)
  );

  return structuredClone({
    transactions,
    orders,
    externalCashFlows,
    dividends: input.activity.dividends.filter(({ paidAt }) => within(paidAt)),
    fees: input.activity.fees.filter(({ chargedAt }) => within(chargedAt)),
    corporateActions: input.activity.corporateActions.filter(({ effectiveAt }) =>
      within(effectiveAt)
    ),
    // A pre-flow valuation is part of the selected cash-flow event even when
    // its timestamp is one tick before the requested subperiod boundary.
    performanceFlowValuations: input.activity.performanceFlowValuations.filter(
      ({ cashFlowId }) => selectedCashFlowIds.has(cashFlowId)
    )
  });
}

function validateRecentTradingQuery(query: RecentTradingActivityQuery): void {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 10) {
    throw new Error("Recent trading activity limit must be an integer from 1 through 10.");
  }
  if (!["executions", "orders", "all"].includes(query.include)) {
    throw new Error("Recent trading activity include value is invalid.");
  }
  if (query.symbol !== undefined && !/^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(query.symbol)) {
    throw new Error("Recent trading activity symbol must be canonical uppercase ticker text.");
  }
  if (query.side !== undefined && query.side !== "BUY" && query.side !== "SELL") {
    throw new Error("Recent trading activity side must be BUY or SELL.");
  }
}

function compareRecentActivity(
  left: RecentTradingActivityItem,
  right: RecentTradingActivityItem
): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt > right.occurredAt ? -1 : 1;
  }
  if (left.activityRef === right.activityRef) return 0;
  return left.activityRef < right.activityRef ? -1 : 1;
}

/**
 * Deterministic, bounded projection used by the private portfolio boundary.
 * Orders never become executions here; only ledger transactions are marked as
 * position-affecting evidence.
 */
export function selectRecentTradingActivity(input: {
  activity: MockPortfolioActivity;
  query: RecentTradingActivityQuery;
  ledgerPeriodStart: string;
  ledgerPeriodEnd: string;
}): RecentTradingActivityResult {
  validateRecentTradingQuery(input.query);
  const matches = (symbol: string, side: "BUY" | "SELL"): boolean =>
    (input.query.symbol === undefined || symbol === input.query.symbol) &&
    (input.query.side === undefined || side === input.query.side);
  const items: RecentTradingActivityItem[] = [];

  if (input.query.include === "executions" || input.query.include === "all") {
    for (const transaction of input.activity.transactions) {
      if (!matches(transaction.symbol, transaction.side)) continue;
      items.push({
        kind: "EXECUTION",
        activityRef: `execution:${transaction.transactionId}`,
        occurredAt: transaction.tradedAt,
        positionEffect: "AUTHORITATIVE_EXECUTED_TRADE",
        transaction: structuredClone(transaction)
      });
    }
  }

  if (input.query.include === "orders" || input.query.include === "all") {
    for (const order of input.activity.orders) {
      if (!matches(order.symbol, order.side)) continue;
      items.push({
        kind: "ORDER",
        activityRef: `order:${order.orderRef}`,
        occurredAt: order.lastUpdatedAt,
        positionEffect: "NONE_ORDER_STATE_ONLY",
        order: structuredClone(order)
      });
    }
  }

  items.sort(compareRecentActivity);
  const selected = items.slice(0, input.query.limit);
  return {
    schemaVersion: "assistant-v3.recent-trading-activity.v1",
    queryType: "recent-trading",
    dataClass: "synthetic",
    asOf: input.ledgerPeriodEnd,
    coverage: {
      status: "complete",
      ledgerPeriodStart: input.ledgerPeriodStart,
      ledgerPeriodEnd: input.ledgerPeriodEnd,
      matchedCount: items.length,
      returnedCount: selected.length
    },
    items: selected,
    hasMore: items.length > selected.length
  };
}

export class ApprovedKnowledgeBoundaryAdapter implements ApprovedKnowledgeBoundaryPort {
  readonly source: ToolSource;

  constructor(
    private readonly service: ApprovedKnowledgeServicePort,
    now: () => number = Date.now
  ) {
    this.source = source({
      provider: "demo-invest-approved-knowledge",
      sourceId: service.indexGeneration,
      licenseClass: "synthetic",
      now
    });
  }

  retrieve(query: string, context: KnowledgeQueryContext): Promise<KnowledgeToolResult> {
    return this.service.retrieve(query, context);
  }
}

export class InternalPilotOrderEligibilityPort implements OrderEligibilityBoundaryPort {
  readonly source: ToolSource;
  readonly #now: () => number;
  readonly #maximumNotional: DecimalString;

  constructor(input: { now?: () => number; maximumNotional?: DecimalString } = {}) {
    this.#now = input.now ?? Date.now;
    this.#maximumNotional = input.maximumNotional ?? decimal("2500");
    this.source = source({
      provider: "internal-pilot-order-policy",
      sourceId: "preview-eligibility-v3",
      licenseClass: "project-internal",
      now: this.#now
    });
  }

  async readEligibility(input: {
    symbol: string;
    side: "BUY";
    requestedNotional: DecimalString;
  }): Promise<OrderEligibility> {
    const requested = parseFixedDecimal(input.requestedNotional);
    const maximum = parseFixedDecimal(this.#maximumNotional);
    const eligible = requested > 0n && requested <= maximum;
    return {
      eligible,
      currency: "USD",
      maximumNotional: this.#maximumNotional,
      tariffId: "investor",
      requiredDisclosureCodes: ["PUBLIC_MARKET_RISK", "PRICE_MOVEMENT"],
      checkedAt: new Date(this.#now()).toISOString(),
      reasonCodes: eligible ? [] : ["NOTIONAL_OUTSIDE_PREVIEW_LIMIT"]
    };
  }
}

export class SignedOrderHandoffAdapter implements SignedOrderHandoffBoundaryPort {
  readonly source: ToolSource;
  readonly confirm: OrderHandoffStore["confirm"];

  constructor(store: OrderHandoffStore, now: () => number = Date.now) {
    this.source = source({
      provider: "assistant-owned-handoff-store",
      sourceId: "signed-order-handoff-v3",
      licenseClass: "project-internal",
      now
    });
    this.confirm = store.confirm.bind(store);
  }
}
