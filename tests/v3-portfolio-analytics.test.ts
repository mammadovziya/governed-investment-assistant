import { describe, expect, it } from "vitest";
import type { ToolExecutionEnvelope } from "../src/assistant-v3/contracts.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import {
  createMockMarketToolExecution,
  createMockPortfolioActivityToolExecution,
  createMockPortfolioToolExecution,
  mockPortfolioSnapshot,
  mockPortfolioMarketEvidence,
  mockTrustedRequestContext,
  type MockPortfolioPositionSnapshot,
  type PortfolioMarketEvidence
} from "../src/assistant-v3/mock-portfolio.js";
import {
  calculatePortfolioAnalytics,
  PortfolioAnalyticsError
} from "../src/assistant-v3/portfolio-analytics.js";
import {
  attachIntegrity,
  canonicalHash,
  DevHmacSigner,
  unsignedEnvelope,
  verifyEnvelope
} from "../src/assistant-v3/signing.js";

function signer(): DevHmacSigner {
  return new DevHmacSigner({
    keyId: "test-portfolio-key",
    secret: "abcdef0123456789abcdef0123456789"
  });
}

function analytics(service = signer()) {
  return calculatePortfolioAnalytics({
    context: mockTrustedRequestContext,
    portfolioExecution: createMockPortfolioToolExecution(mockTrustedRequestContext, service),
    activityExecution: createMockPortfolioActivityToolExecution(mockTrustedRequestContext, service),
    marketExecution: createMockMarketToolExecution(mockTrustedRequestContext, service),
    signer: service
  });
}

function containsNumber(value: unknown): boolean {
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(containsNumber);
  if (value && typeof value === "object") return Object.values(value).some(containsNumber);
  return false;
}

describe("V3 deterministic portfolio analytics", () => {
  it("calculates current value, lot-weighted average cost, and unrealized P&L", () => {
    const result = analytics();

    expect(result.facts.currentValue.value).toMatchObject({
      positionsValue: "7530.00000000",
      cashValue: "2506.00000000",
      totalValue: "10036.00000000"
    });
    expect(result.facts.averageCost.value.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: "AAPL",
          quantity: "12.00000000",
          costBasis: "2221.00000000",
          averageUnitCost: "185.08333333"
        })
      ])
    );
    expect(result.facts.unrealizedPnl.value).toMatchObject({
      costBasis: "6121.00000000",
      marketValue: "7530.00000000",
      unrealizedPnl: "1409.00000000",
      unrealizedReturnRate: "0.23019115"
    });
  });

  it("reconciles YTD NAV P&L to activity components and adjusts TWR for deposits", () => {
    const result = analytics();

    expect(result.facts.ytdPnl.value).toEqual({
      currency: "USD",
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-07-21T20:00:00.000Z",
      beginningPortfolioValue: "8160.00000000",
      endingPortfolioValue: "10036.00000000",
      netExternalCashFlow: "1000.00000000",
      navMethodPnl: "876.00000000",
      realizedPricePnl: "150.00000000",
      unrealizedPricePnl: "700.00000000",
      income: "30.00000000",
      fees: "4.00000000",
      fxImpact: "0.00000000",
      componentMethodPnl: "876.00000000",
      reconciliationDifference: "0.00000000",
      endingCashExpected: "2506.00000000",
      endingCashActual: "2506.00000000",
      cashReconciliationDifference: "0.00000000",
      reconciled: true
    });
    expect(result.facts.timeWeightedReturn.value).toMatchObject({
      returnRate: "0.09765443",
      subperiodCount: "2",
      externalFlowCount: "1",
      methodology: "geometrically-linked-pre-flow-valuations-v1"
    });
  });

  it("calculates both invested and total portfolio sector allocations", () => {
    const allocation = analytics().facts.sectorAllocation.value;

    expect(allocation.cashTotalPortfolioAllocationRate).toBe("0.24970108");
    expect(allocation.sectors).toEqual([
      {
        sector: "Fixed Income",
        marketValue: "2220.00000000",
        investedAllocationRate: "0.29482072",
        totalPortfolioAllocationRate: "0.22120367"
      },
      {
        sector: "Technology",
        marketValue: "5310.00000000",
        investedAllocationRate: "0.70517928",
        totalPortfolioAllocationRate: "0.52909526"
      }
    ]);
  });

  it("selects the largest absolute 1M mover and calculates its contribution", () => {
    expect(analytics().facts.oneMonthMover.value).toMatchObject({
      largestAbsolutePriceReturn: {
        symbol: "NVDA",
        startPrice: "190.00000000",
        endPrice: "170.00000000",
        returnRate: "-0.10526316",
        changeValue: "-300.00000000",
        contributionToPortfolioRate: "-0.02945219"
      },
      largestAbsolutePortfolioContribution: {
        symbol: "NVDA",
        changeValue: "-300.00000000",
        contributionToPortfolioRate: "-0.02945219"
      },
      portfolioStartValue: "10186.00000000",
      portfolioPriceChange: "-150.00000000",
      portfolioPriceChangeRate: "-0.01472609"
    });
  });

  it("reports price mover and portfolio contributor separately when they differ", () => {
    const service = signer();
    const original = createMockMarketToolExecution(mockTrustedRequestContext, service);
    const market: PortfolioMarketEvidence = {
      ...structuredClone(mockPortfolioMarketEvidence),
      observations: mockPortfolioMarketEvidence.observations.map((observation) =>
        observation.symbol === "AAPL"
          ? { ...observation, oneMonthStartPrice: decimal("400"), currentPrice: decimal("440") }
          : observation
      )
    };
    const marketExecution = attachIntegrity({
      ...unsignedEnvelope(original),
      result: market,
      resultHash: canonicalHash(market)
    }, service);
    const result = calculatePortfolioAnalytics({
      context: mockTrustedRequestContext,
      portfolioExecution: createMockPortfolioToolExecution(mockTrustedRequestContext, service),
      activityExecution: createMockPortfolioActivityToolExecution(mockTrustedRequestContext, service),
      marketExecution,
      signer: service
    });

    expect(result.facts.oneMonthMover.value.largestAbsolutePriceReturn.symbol).toBe("NVDA");
    expect(result.facts.oneMonthMover.value.largestAbsolutePortfolioContribution.symbol).toBe("AAPL");
  });

  it("signs every fact and emits no JavaScript number in authoritative facts", () => {
    const service = signer();
    const result = analytics(service);

    for (const fact of Object.values(result.facts)) {
      expect(verifyEnvelope(fact, service)).toBe(true);
      expect(containsNumber(fact.value)).toBe(false);
      expect(fact.quality.coverage).toBe("1.00000000");
    }
  });

  it("fails closed when a correctly signed ledger no longer reconciles cash", () => {
    const service = signer();
    const original = createMockPortfolioToolExecution(mockTrustedRequestContext, service);
    const { activity: _activity, ...positionSnapshot } = structuredClone(mockPortfolioSnapshot);
    const changedPortfolio: MockPortfolioPositionSnapshot = positionSnapshot;
    changedPortfolio.currentCash = { amount: decimal("2507"), currency: "USD" };
    const changedPayload: Omit<ToolExecutionEnvelope<MockPortfolioPositionSnapshot>, "integrity"> = {
      ...unsignedEnvelope(original),
      result: changedPortfolio,
      resultHash: canonicalHash(changedPortfolio)
    };
    const changedExecution = attachIntegrity(changedPayload, service);

    expect(() => calculatePortfolioAnalytics({
      context: mockTrustedRequestContext,
      portfolioExecution: changedExecution,
      activityExecution: createMockPortfolioActivityToolExecution(mockTrustedRequestContext, service),
      marketExecution: createMockMarketToolExecution(mockTrustedRequestContext, service),
      signer: service
    })).toThrowError(expect.objectContaining<Partial<PortfolioAnalyticsError>>({
      code: "CASH_RECONCILIATION_FAILED"
    }));
  });

  it("rejects a tool result changed after signing", () => {
    const service = signer();
    const execution = createMockPortfolioToolExecution(mockTrustedRequestContext, service);
    const tampered: ToolExecutionEnvelope<MockPortfolioPositionSnapshot> = {
      ...execution,
      result: {
        ...mockPortfolioSnapshot,
        currentCash: { amount: decimal("999999"), currency: "USD" }
      }
    };

    expect(() => calculatePortfolioAnalytics({
      context: mockTrustedRequestContext,
      portfolioExecution: tampered,
      activityExecution: createMockPortfolioActivityToolExecution(mockTrustedRequestContext, service),
      marketExecution: createMockMarketToolExecution(mockTrustedRequestContext, service),
      signer: service
    })).toThrowError(expect.objectContaining<Partial<PortfolioAnalyticsError>>({
      code: "INVALID_TOOL_ENVELOPE"
    }));
  });
});
