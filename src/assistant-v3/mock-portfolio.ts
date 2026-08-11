import type {
  DecimalString,
  MoneyAmount,
  ToolExecutionEnvelope,
  TrustedRequestContext
} from "./contracts.js";
import { decimal } from "./fixed-decimal.js";
import {
  attachIntegrity,
  canonicalHash,
  type DevHmacSigner
} from "./signing.js";

export type InstrumentType = "EQUITY" | "ETF" | "BOND";

export interface PortfolioLot {
  lotId: string;
  instrumentId: string;
  symbol: string;
  instrumentType: InstrumentType;
  acquiredAt: string;
  quantity: DecimalString;
  unitCost: MoneyAmount;
}

export interface OpeningPosition {
  instrumentId: string;
  symbol: string;
  quantity: DecimalString;
}

export interface PortfolioInstrumentMetadata {
  instrumentId: string;
  symbol: string;
  displayName: string;
  instrumentType: InstrumentType;
  sector: string;
  currency: string;
}

export interface PortfolioTransaction {
  transactionId: string;
  /** Executed transactions are the only trading records allowed to affect positions. */
  executionStatus: "EXECUTED";
  orderRef: string | null;
  side: "BUY" | "SELL";
  instrumentId: string;
  symbol: string;
  tradedAt: string;
  settledAt: string;
  quantity: DecimalString;
  unitPrice: MoneyAmount;
  grossAmount: MoneyAmount;
  feeIds: readonly string[];
}

/**
 * Stock-order lifecycle evidence. Orders are deliberately state-only: even a
 * filled order must be reconciled through its linked executed transaction
 * before it can affect cash, positions, cost basis, or purchase history.
 */
export interface PortfolioStockOrder {
  orderRef: string;
  instrumentId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  timeInForce: "DAY" | "GOOD_TILL_CANCELLED";
  status: "FILLED" | "OPEN" | "CANCELLED";
  submittedAt: string;
  lastUpdatedAt: string;
  requestedQuantity: DecimalString;
  limitPrice: MoneyAmount | null;
  filledQuantity: DecimalString;
  averageFillPrice: MoneyAmount | null;
  linkedTransactionIds: readonly string[];
}

export interface PortfolioPeriodLedgerQuery {
  queryType: "period-ledger";
  periodStart: string;
  periodEnd: string;
}

export type RecentTradingInclude = "executions" | "orders" | "all";

export interface RecentTradingActivityQuery {
  queryType: "recent-trading";
  /** Boundary-enforced page size. It is always an integer from 1 through 10. */
  limit: number;
  include: RecentTradingInclude;
  symbol?: string;
  side?: "BUY" | "SELL";
}

export type PortfolioActivityQuery =
  | PortfolioPeriodLedgerQuery
  | RecentTradingActivityQuery;

export interface RecentTradingExecutionItem {
  kind: "EXECUTION";
  activityRef: string;
  occurredAt: string;
  positionEffect: "AUTHORITATIVE_EXECUTED_TRADE";
  transaction: PortfolioTransaction;
}

export interface RecentTradingOrderItem {
  kind: "ORDER";
  activityRef: string;
  occurredAt: string;
  positionEffect: "NONE_ORDER_STATE_ONLY";
  order: PortfolioStockOrder;
}

export type RecentTradingActivityItem =
  | RecentTradingExecutionItem
  | RecentTradingOrderItem;

export interface RecentTradingActivityResult {
  schemaVersion: "assistant-v3.recent-trading-activity.v1";
  queryType: "recent-trading";
  dataClass: "synthetic";
  asOf: string;
  coverage: {
    status: "complete";
    ledgerPeriodStart: string;
    ledgerPeriodEnd: string;
    matchedCount: number;
    returnedCount: number;
  };
  items: readonly RecentTradingActivityItem[];
  hasMore: boolean;
}

export interface ExternalCashFlow {
  cashFlowId: string;
  direction: "DEPOSIT" | "WITHDRAWAL";
  occurredAt: string;
  amount: MoneyAmount;
}

export interface DividendRecord {
  dividendId: string;
  instrumentId: string;
  symbol: string;
  paidAt: string;
  grossAmount: MoneyAmount;
  withholdingTax: MoneyAmount;
  netAmount: MoneyAmount;
}

export interface FeeRecord {
  feeId: string;
  chargedAt: string;
  category: "trade" | "custody" | "fx" | "other";
  amount: MoneyAmount;
  relatedTransactionId: string | null;
}

export interface CorporateActionRecord {
  corporateActionId: string;
  instrumentId: string;
  symbol: string;
  type: "SPLIT" | "MERGER" | "SPINOFF" | "SYMBOL_CHANGE" | "CASH_IN_LIEU";
  effectiveAt: string;
  status: "APPLIED" | "PENDING";
  quantityRatio: {
    numerator: DecimalString;
    denominator: DecimalString;
  } | null;
  cashAmount: MoneyAmount | null;
  treatment: "already-reflected-in-lots-and-market-evidence" | "requires-processing";
}

/** Value immediately before an external flow; the flow is applied after it. */
export interface PerformanceFlowValuation {
  cashFlowId: string;
  valuedAt: string;
  portfolioValueBeforeFlow: MoneyAmount;
}

export interface MockPortfolioSnapshot {
  schemaVersion: "assistant-v3.mock-portfolio.v1";
  dataClass: "synthetic";
  environment: "demo";
  principalRef: string;
  accountRef: string;
  baseCurrency: string;
  periodStart: string;
  asOf: string;
  costBasisPolicy: {
    version: "open-lot-basis-v1";
    buyTradeFees: "capitalize-pro-rata-to-remaining-lot";
    corporateActions: "authoritative-post-action-lots";
  };
  investorProfile: {
    version: "synthetic-risk-profile-v1";
    riskBand: "MODERATE";
    objective: "LONG_TERM_GROWTH";
    timeHorizonYears: number;
    singleStockTargetMaxAllocationRate: DecimalString;
    rebalancePreference: "GRADUAL";
    reviewedAt: string;
  };
  /**
   * Synthetic client-side reference data used by deterministic allocation
   * calculations. Public prices are deliberately not stored here.
   */
  instrumentMetadata: readonly PortfolioInstrumentMetadata[];
  openingPositions: readonly OpeningPosition[];
  openingCash: MoneyAmount;
  currentLots: readonly PortfolioLot[];
  currentCash: MoneyAmount;
  activity: {
    transactions: readonly PortfolioTransaction[];
    orders: readonly PortfolioStockOrder[];
    externalCashFlows: readonly ExternalCashFlow[];
    dividends: readonly DividendRecord[];
    fees: readonly FeeRecord[];
    corporateActions: readonly CorporateActionRecord[];
    performanceFlowValuations: readonly PerformanceFlowValuation[];
  };
}

export type MockPortfolioActivity = MockPortfolioSnapshot["activity"];
export type MockPortfolioPositionSnapshot = Omit<MockPortfolioSnapshot, "activity">;
export type PortfolioActivityResult = MockPortfolioActivity | RecentTradingActivityResult;

export interface InstrumentMarketObservation {
  instrumentId: string;
  symbol: string;
  instrumentType: InstrumentType;
  displayName: string;
  sector: string;
  currency: string;
  currentPrice: DecimalString;
  currentPriceAsOf: string;
  ytdStartPrice: DecimalString;
  ytdStartPriceAsOf: string;
  oneMonthStartPrice: DecimalString;
  oneMonthStartPriceAsOf: string;
  marketState: "OPEN" | "CLOSED";
  freshness: "live" | "indicative" | "delayed";
}

export interface PortfolioMarketEvidence {
  schemaVersion: "assistant-v3.portfolio-market-evidence.v1";
  dataClass: "synthetic-market-fixture";
  asOf: string;
  observations: readonly InstrumentMarketObservation[];
}

const money = (amount: string): MoneyAmount => ({ amount: decimal(amount), currency: "USD" });

export const mockTrustedRequestContext: TrustedRequestContext = {
  schemaVersion: "assistant-v3.request-context.v1",
  requestId: "req-v3-portfolio-001",
  sessionId: "session-v3-001",
  conversationId: "conversation-v3-001",
  principalRef: "principal:mock-client-001",
  tenantRef: "tenant:demo-invest",
  locale: "en-US",
  jurisdiction: "AZ",
  channel: "test",
  environment: "test",
  requestedAt: "2026-07-21T20:00:05.000Z",
  authentication: {
    strength: "authenticated",
    authContextRef: "auth-context:test"
  },
  consentVersion: "demo-consent-v1",
  consentScopes: ["assistant_use", "portfolio_data", "public_market_data"],
  entitlementVersion: "demo-entitlements-v1",
  entitlements: ["assistant_access", "portfolio_read", "market_read"],
  policyVersion: "assistant-policy-v3",
  capabilities: ["portfolio-read", "market-read"],
  featureSnapshot: {
    version: "features-test-v1",
    flags: { portfolio: true, market: true, orderHandoff: true }
  }
};

export const mockPortfolioSnapshot: MockPortfolioSnapshot = {
  schemaVersion: "assistant-v3.mock-portfolio.v1",
  dataClass: "synthetic",
  environment: "demo",
  principalRef: mockTrustedRequestContext.principalRef,
  accountRef: "account:mock-brokerage-001",
  baseCurrency: "USD",
  periodStart: "2026-01-01T00:00:00.000Z",
  asOf: "2026-07-21T20:00:00.000Z",
  costBasisPolicy: {
    version: "open-lot-basis-v1",
    buyTradeFees: "capitalize-pro-rata-to-remaining-lot",
    corporateActions: "authoritative-post-action-lots"
  },
  investorProfile: {
    version: "synthetic-risk-profile-v1",
    riskBand: "MODERATE",
    objective: "LONG_TERM_GROWTH",
    timeHorizonYears: 7,
    singleStockTargetMaxAllocationRate: decimal("0.20"),
    rebalancePreference: "GRADUAL",
    reviewedAt: "2026-07-01T09:00:00.000Z"
  },
  instrumentMetadata: [
    {
      instrumentId: "US:AAPL",
      symbol: "AAPL",
      displayName: "Apple Inc.",
      instrumentType: "EQUITY",
      sector: "Technology",
      currency: "USD"
    },
    {
      instrumentId: "US:NVDA",
      symbol: "NVDA",
      displayName: "NVIDIA Corporation",
      instrumentType: "EQUITY",
      sector: "Technology",
      currency: "USD"
    },
    {
      instrumentId: "US:BND",
      symbol: "BND",
      displayName: "Vanguard Total Bond Market ETF",
      instrumentType: "ETF",
      sector: "Fixed Income",
      currency: "USD"
    }
  ],
  openingPositions: [
    { instrumentId: "US:AAPL", symbol: "AAPL", quantity: decimal("10") },
    { instrumentId: "US:NVDA", symbol: "NVDA", quantity: decimal("20") },
    { instrumentId: "US:BND", symbol: "BND", quantity: decimal("30") }
  ],
  openingCash: money("1000"),
  currentLots: [
    {
      lotId: "lot-aapl-opening",
      instrumentId: "US:AAPL",
      symbol: "AAPL",
      instrumentType: "EQUITY",
      acquiredAt: "2025-06-10T14:30:00.000Z",
      quantity: decimal("10"),
      unitCost: money("180")
    },
    {
      lotId: "lot-aapl-20260215",
      instrumentId: "US:AAPL",
      symbol: "AAPL",
      instrumentType: "EQUITY",
      acquiredAt: "2026-02-15T15:00:00.000Z",
      quantity: decimal("2"),
      unitCost: money("210")
    },
    {
      lotId: "lot-nvda-opening-remaining",
      instrumentId: "US:NVDA",
      symbol: "NVDA",
      instrumentType: "EQUITY",
      acquiredAt: "2025-04-01T14:30:00.000Z",
      quantity: decimal("15"),
      unitCost: money("120")
    },
    {
      lotId: "lot-bnd-opening",
      instrumentId: "US:BND",
      symbol: "BND",
      instrumentType: "ETF",
      acquiredAt: "2025-08-20T14:30:00.000Z",
      quantity: decimal("30"),
      unitCost: money("70")
    }
  ],
  currentCash: money("2506"),
  activity: {
    transactions: [
      {
        transactionId: "txn-buy-aapl-20260215",
        executionStatus: "EXECUTED",
        orderRef: "order-buy-aapl-20260215",
        side: "BUY",
        instrumentId: "US:AAPL",
        symbol: "AAPL",
        tradedAt: "2026-02-15T15:00:00.000Z",
        settledAt: "2026-02-17T15:00:00.000Z",
        quantity: decimal("2"),
        unitPrice: money("210"),
        grossAmount: money("420"),
        feeIds: ["fee-buy-aapl"]
      },
      {
        transactionId: "txn-sell-nvda-20260310",
        executionStatus: "EXECUTED",
        orderRef: "order-sell-nvda-20260310",
        side: "SELL",
        instrumentId: "US:NVDA",
        symbol: "NVDA",
        tradedAt: "2026-03-10T15:00:00.000Z",
        settledAt: "2026-03-12T15:00:00.000Z",
        quantity: decimal("5"),
        unitPrice: money("180"),
        grossAmount: money("900"),
        feeIds: ["fee-sell-nvda"]
      }
    ],
    orders: [
      {
        orderRef: "order-buy-aapl-20260215",
        instrumentId: "US:AAPL",
        symbol: "AAPL",
        side: "BUY",
        orderType: "MARKET",
        timeInForce: "DAY",
        status: "FILLED",
        submittedAt: "2026-02-15T14:59:55.000Z",
        lastUpdatedAt: "2026-02-15T15:00:00.000Z",
        requestedQuantity: decimal("2"),
        limitPrice: null,
        filledQuantity: decimal("2"),
        averageFillPrice: money("210"),
        linkedTransactionIds: ["txn-buy-aapl-20260215"]
      },
      {
        orderRef: "order-sell-nvda-20260310",
        instrumentId: "US:NVDA",
        symbol: "NVDA",
        side: "SELL",
        orderType: "LIMIT",
        timeInForce: "DAY",
        status: "FILLED",
        submittedAt: "2026-03-10T14:58:00.000Z",
        lastUpdatedAt: "2026-03-10T15:00:00.000Z",
        requestedQuantity: decimal("5"),
        limitPrice: money("180"),
        filledQuantity: decimal("5"),
        averageFillPrice: money("180"),
        linkedTransactionIds: ["txn-sell-nvda-20260310"]
      },
      {
        orderRef: "order-buy-nvda-cancelled-20260720",
        instrumentId: "US:NVDA",
        symbol: "NVDA",
        side: "BUY",
        orderType: "LIMIT",
        timeInForce: "GOOD_TILL_CANCELLED",
        status: "CANCELLED",
        submittedAt: "2026-07-20T12:00:00.000Z",
        lastUpdatedAt: "2026-07-20T12:05:00.000Z",
        requestedQuantity: decimal("3"),
        limitPrice: money("150"),
        filledQuantity: decimal("0"),
        averageFillPrice: null,
        linkedTransactionIds: []
      },
      {
        orderRef: "order-buy-aapl-open-20260721",
        instrumentId: "US:AAPL",
        symbol: "AAPL",
        side: "BUY",
        orderType: "LIMIT",
        timeInForce: "GOOD_TILL_CANCELLED",
        status: "OPEN",
        submittedAt: "2026-07-21T18:00:00.000Z",
        lastUpdatedAt: "2026-07-21T18:00:00.000Z",
        requestedQuantity: decimal("1"),
        limitPrice: money("205"),
        filledQuantity: decimal("0"),
        averageFillPrice: null,
        linkedTransactionIds: []
      }
    ],
    externalCashFlows: [
      {
        cashFlowId: "cash-flow-deposit-20260210",
        direction: "DEPOSIT",
        occurredAt: "2026-02-10T09:00:00.000Z",
        amount: money("1000")
      }
    ],
    dividends: [
      {
        dividendId: "dividend-bnd-20260415",
        instrumentId: "US:BND",
        symbol: "BND",
        paidAt: "2026-04-15T20:00:00.000Z",
        grossAmount: money("30"),
        withholdingTax: money("0"),
        netAmount: money("30")
      }
    ],
    fees: [
      {
        feeId: "fee-buy-aapl",
        chargedAt: "2026-02-15T15:00:00.000Z",
        category: "trade",
        amount: money("1"),
        relatedTransactionId: "txn-buy-aapl-20260215"
      },
      {
        feeId: "fee-sell-nvda",
        chargedAt: "2026-03-10T15:00:00.000Z",
        category: "trade",
        amount: money("1"),
        relatedTransactionId: "txn-sell-nvda-20260310"
      },
      {
        feeId: "fee-custody-20260501",
        chargedAt: "2026-05-01T09:00:00.000Z",
        category: "custody",
        amount: money("2"),
        relatedTransactionId: null
      }
    ],
    corporateActions: [
      {
        corporateActionId: "ca-nvda-split-2024",
        instrumentId: "US:NVDA",
        symbol: "NVDA",
        type: "SPLIT",
        effectiveAt: "2024-06-10T13:30:00.000Z",
        status: "APPLIED",
        quantityRatio: { numerator: decimal("10"), denominator: decimal("1") },
        cashAmount: null,
        treatment: "already-reflected-in-lots-and-market-evidence"
      }
    ],
    performanceFlowValuations: [
      {
        cashFlowId: "cash-flow-deposit-20260210",
        valuedAt: "2026-02-10T08:59:59.999Z",
        portfolioValueBeforeFlow: money("8300")
      }
    ]
  }
};

export const mockPortfolioMarketEvidence: PortfolioMarketEvidence = {
  schemaVersion: "assistant-v3.portfolio-market-evidence.v1",
  dataClass: "synthetic-market-fixture",
  asOf: mockPortfolioSnapshot.asOf,
  observations: [
    {
      instrumentId: "US:AAPL",
      symbol: "AAPL",
      instrumentType: "EQUITY",
      displayName: "Apple Inc.",
      sector: "Technology",
      currency: "USD",
      currentPrice: decimal("230"),
      currentPriceAsOf: mockPortfolioSnapshot.asOf,
      ytdStartPrice: decimal("200"),
      ytdStartPriceAsOf: "2025-12-31T21:00:00.000Z",
      oneMonthStartPrice: decimal("220"),
      oneMonthStartPriceAsOf: "2026-06-21T20:00:00.000Z",
      marketState: "CLOSED",
      freshness: "indicative"
    },
    {
      instrumentId: "US:NVDA",
      symbol: "NVDA",
      instrumentType: "EQUITY",
      displayName: "NVIDIA Corporation",
      sector: "Technology",
      currency: "USD",
      currentPrice: decimal("170"),
      currentPriceAsOf: mockPortfolioSnapshot.asOf,
      ytdStartPrice: decimal("150"),
      ytdStartPriceAsOf: "2025-12-31T21:00:00.000Z",
      oneMonthStartPrice: decimal("190"),
      oneMonthStartPriceAsOf: "2026-06-21T20:00:00.000Z",
      marketState: "CLOSED",
      freshness: "indicative"
    },
    {
      instrumentId: "US:BND",
      symbol: "BND",
      instrumentType: "ETF",
      displayName: "Vanguard Total Bond Market ETF",
      sector: "Fixed Income",
      currency: "USD",
      currentPrice: decimal("74"),
      currentPriceAsOf: mockPortfolioSnapshot.asOf,
      ytdStartPrice: decimal("72"),
      ytdStartPriceAsOf: "2025-12-31T21:00:00.000Z",
      oneMonthStartPrice: decimal("73"),
      oneMonthStartPriceAsOf: "2026-06-21T20:00:00.000Z",
      marketState: "CLOSED",
      freshness: "indicative"
    }
  ]
};

export function createMockPortfolioToolExecution(
  context: TrustedRequestContext,
  signer: DevHmacSigner
): ToolExecutionEnvelope<MockPortfolioPositionSnapshot> {
  const { activity: _activity, ...snapshot } = mockPortfolioSnapshot;
  const payload: Omit<ToolExecutionEnvelope<MockPortfolioPositionSnapshot>, "integrity"> = {
    schemaVersion: "assistant-v3.tool-execution.v1",
    executionId: "tool-run-read-portfolio-001",
    requestId: context.requestId,
    workflowRunId: "workflow-run-portfolio-v3-001",
    toolId: "read-portfolio-snapshot",
    toolVersion: "1.0.0",
    status: "success",
    startedAt: "2026-07-21T20:00:01.000Z",
    completedAt: "2026-07-21T20:00:01.010Z",
    argumentsHash: canonicalHash({ principalRef: context.principalRef }),
    resultHash: canonicalHash(snapshot),
    result: snapshot,
    error: null,
    source: {
      provider: "mock-client-adapter",
      sourceId: "mock-client-portfolio-v1",
      sourceUrl: null,
      licenseClass: "synthetic",
      observedAt: "2026-07-21T20:00:01.010Z",
      sourceAsOf: mockPortfolioSnapshot.asOf
    }
  };
  return attachIntegrity(payload, signer);
}

export function createMockPortfolioActivityToolExecution(
  context: TrustedRequestContext,
  signer: DevHmacSigner
): ToolExecutionEnvelope<MockPortfolioActivity> {
  const activity = mockPortfolioSnapshot.activity;
  const payload: Omit<ToolExecutionEnvelope<MockPortfolioActivity>, "integrity"> = {
    schemaVersion: "assistant-v3.tool-execution.v1",
    executionId: "tool-run-read-portfolio-activity-001",
    requestId: context.requestId,
    workflowRunId: "workflow-run-portfolio-v3-001",
    toolId: "read-portfolio-activity",
    toolVersion: "1.0.0",
    status: "success",
    startedAt: "2026-07-21T20:00:01.005Z",
    completedAt: "2026-07-21T20:00:01.015Z",
    argumentsHash: canonicalHash({
      principalRef: context.principalRef,
      periodStart: mockPortfolioSnapshot.periodStart,
      periodEnd: mockPortfolioSnapshot.asOf
    }),
    resultHash: canonicalHash(activity),
    result: activity,
    error: null,
    source: {
      provider: "mock-client-adapter",
      sourceId: "mock-client-activity-v1",
      sourceUrl: null,
      licenseClass: "synthetic",
      observedAt: "2026-07-21T20:00:01.015Z",
      sourceAsOf: mockPortfolioSnapshot.asOf
    }
  };
  return attachIntegrity(payload, signer);
}

export function createMockMarketToolExecution(
  context: TrustedRequestContext,
  signer: DevHmacSigner
): ToolExecutionEnvelope<PortfolioMarketEvidence> {
  const symbols = mockPortfolioMarketEvidence.observations.map(({ symbol }) => symbol);
  const payload: Omit<ToolExecutionEnvelope<PortfolioMarketEvidence>, "integrity"> = {
    schemaVersion: "assistant-v3.tool-execution.v1",
    executionId: "tool-run-read-market-001",
    requestId: context.requestId,
    workflowRunId: "workflow-run-portfolio-v3-001",
    toolId: "read-portfolio-market-evidence",
    toolVersion: "1.0.0",
    status: "success",
    startedAt: "2026-07-21T20:00:01.011Z",
    completedAt: "2026-07-21T20:00:01.030Z",
    argumentsHash: canonicalHash({ symbols, ranges: ["ytd", "1m", "current"] }),
    resultHash: canonicalHash(mockPortfolioMarketEvidence),
    result: mockPortfolioMarketEvidence,
    error: null,
    source: {
      provider: "mock-live-market-adapter",
      sourceId: "mock-portfolio-market-evidence-v1",
      sourceUrl: null,
      licenseClass: "synthetic",
      observedAt: "2026-07-21T20:00:01.030Z",
      sourceAsOf: mockPortfolioMarketEvidence.asOf
    }
  };
  return attachIntegrity(payload, signer);
}
