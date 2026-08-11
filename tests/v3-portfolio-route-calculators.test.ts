import { describe, expect, it } from "vitest";
import type {
  BoundaryMarketSnapshot,
  BoundaryPriceHistory,
  CurrencyConversionArguments,
  CurrencyConversionResult
} from "../src/assistant-v3/boundary-tools.js";
import type { ToolSource } from "../src/assistant-v3/contracts.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import {
  createMockPortfolioActivityToolExecution,
  createMockPortfolioToolExecution,
  mockPortfolioMarketEvidence,
  mockTrustedRequestContext
} from "../src/assistant-v3/mock-portfolio.js";
import type {
  AverageCostFact,
  CurrentPortfolioValueFact,
  OneMonthMoverFact,
  SectorAllocationFact,
  TimeWeightedReturnFact,
  YtdPnlFact
} from "../src/assistant-v3/portfolio-analytics.js";
import { calculatePortfolioRoute } from "../src/assistant-v3/portfolio-route-calculators.js";
import { DevHmacSigner, verifyEnvelope } from "../src/assistant-v3/signing.js";

const signer = new DevHmacSigner({
  keyId: "portfolio-route-test",
  secret: "portfolio-route-test-secret-with-32-bytes-minimum"
});
const workflowRunId = "workflow-run-portfolio-v3-001";
const evidence = new EvidenceFactory({
  signer,
  now: () => Date.parse(mockTrustedRequestContext.requestedAt)
});
const source: ToolSource = {
  provider: "live-test-provider",
  sourceId: "signed-live-test",
  sourceUrl: null,
  licenseClass: "public-indicative",
  observedAt: mockTrustedRequestContext.requestedAt,
  sourceAsOf: mockPortfolioMarketEvidence.asOf
};

function marketExecutions() {
  return mockPortfolioMarketEvidence.observations.map((observation) => {
    const result: BoundaryMarketSnapshot = {
      symbol: observation.symbol,
      displayName: observation.displayName,
      currency: observation.currency,
      exchange: "TEST",
      instrumentType: observation.instrumentType,
      price: observation.currentPrice,
      previousClose: null,
      change: null,
      changePercent: null,
      marketState: observation.marketState,
      freshness: observation.freshness,
      delayMinutes: 0,
      asOf: observation.currentPriceAsOf,
      notice: "Test fixture"
    };
    return evidence.toolSuccess({
      requestId: mockTrustedRequestContext.requestId,
      workflowRunId,
      toolId: "read-market-snapshot",
      toolVersion: "3.0.0",
      arguments: { symbol: observation.symbol },
      result,
      source: { ...source, sourceAsOf: result.asOf }
    });
  });
}

function historyExecutions(range: "1y" | "1m") {
  return mockPortfolioMarketEvidence.observations.map((observation) => {
    const startPrice = range === "1y"
      ? observation.ytdStartPrice
      : observation.oneMonthStartPrice;
    const startAt = range === "1y"
      ? observation.ytdStartPriceAsOf
      : observation.oneMonthStartPriceAsOf;
    const result: BoundaryPriceHistory = {
      symbol: observation.symbol,
      range,
      interval: "1d",
      currency: observation.currency,
      exchange: "TEST",
      asOf: observation.currentPriceAsOf,
      points: [
        { timestamp: startAt, close: startPrice },
        { timestamp: observation.currentPriceAsOf, close: observation.currentPrice }
      ]
    };
    return evidence.toolSuccess({
      requestId: mockTrustedRequestContext.requestId,
      workflowRunId,
      toolId: "read-price-history",
      toolVersion: "3.0.0",
      arguments: { symbol: observation.symbol, range },
      result,
      source: { ...source, sourceAsOf: result.asOf }
    });
  });
}

const portfolioExecution = () => createMockPortfolioToolExecution(mockTrustedRequestContext, signer);
const activityExecution = () => createMockPortfolioActivityToolExecution(mockTrustedRequestContext, signer);
const conversionArguments: CurrencyConversionArguments = {
  scope: "provided-amount",
  amount: decimal("10036"),
  sourceCurrency: "USD",
  targetCurrency: "AZN"
};

function conversionExecution(
  overrides: Partial<CurrencyConversionResult> = {}
) {
  const result: CurrencyConversionResult = {
    schemaVersion: "assistant-v3.currency-conversion.v1",
    scope: "provided-amount",
    sourceCurrency: "USD",
    targetCurrency: "AZN",
    sourceAmount: decimal("10036"),
    exchangeRate: decimal("1.7"),
    convertedAmount: decimal("17061.2"),
    rateEffectiveDate: "2026-07-21",
    rateAsOf: "2026-07-21T00:00:00+04:00",
    rateSourceUrl: "https://www.cbar.az/currencies/21.07.2026.xml",
    portfolioDataClass: null,
    portfolioAsOf: null,
    marketAsOf: [],
    symbol: null,
    displayName: null,
    marketSnapshot: null,
    marketSource: null,
    ...overrides
  };
  return evidence.toolSuccess({
    requestId: mockTrustedRequestContext.requestId,
    workflowRunId,
    toolId: "convert-currency",
    toolVersion: "3.0.0",
    arguments: conversionArguments,
    result,
    source: {
      ...source,
      provider: "central-bank-of-azerbaijan",
      sourceId: "official-currency-rates",
      sourceUrl: "https://www.cbar.az/currency/rates?language=en",
      sourceAsOf: result.rateAsOf
    }
  });
}

describe("route-scoped V3 portfolio calculations", () => {
  it("calculates current value and sector allocation only from signed snapshot prices", () => {
    const current = calculatePortfolioRoute({
      context: mockTrustedRequestContext,
      route: "current_portfolio_value",
      portfolioExecution: portfolioExecution(),
      marketExecutions: marketExecutions(),
      signer
    }).facts[0]!;
    const currentValue = current.value as CurrentPortfolioValueFact;
    expect(currentValue).toMatchObject({
      positionsValue: "7530.00000000",
      cashValue: "2506.00000000",
      totalValue: "10036.00000000"
    });
    expect(current.provenance.toolExecutionIds).toHaveLength(4);
    expect(verifyEnvelope(current, signer)).toBe(true);

    const sector = calculatePortfolioRoute({
      context: mockTrustedRequestContext,
      route: "sector_allocation",
      portfolioExecution: portfolioExecution(),
      marketExecutions: marketExecutions(),
      signer
    }).facts[0]!;
    const sectorValue = sector.value as SectorAllocationFact;
    expect(sectorValue.sectors.find(({ sector }) => sector === "Technology")).toMatchObject({
      marketValue: "5310.00000000",
      investedAllocationRate: "0.70517928",
      totalPortfolioAllocationRate: "0.52909526"
    });
  });

  it("uses remaining lots and capitalized buy fees for average cost", () => {
    const fact = calculatePortfolioRoute({
      context: mockTrustedRequestContext,
      route: "holding_average_cost",
      portfolioExecution: portfolioExecution(),
      activityExecution: activityExecution(),
      signer
    }).facts[0]!;
    const value = fact.value as AverageCostFact;
    expect(value.positions.find(({ symbol }) => symbol === "AAPL")).toMatchObject({
      quantity: "12.00000000",
      costBasis: "2221.00000000",
      averageUnitCost: "185.08333333"
    });
    expect(fact.provenance.toolExecutionIds).toHaveLength(2);
  });

  it("attaches a verified fixed-decimal AZN conversion to current value provenance", () => {
    const fact = calculatePortfolioRoute({
      context: mockTrustedRequestContext,
      route: "current_portfolio_value",
      portfolioExecution: portfolioExecution(),
      marketExecutions: marketExecutions(),
      currencyConversionExecution: conversionExecution(),
      currencyConversionArguments: conversionArguments,
      signer
    }).facts[0]!;

    expect(fact.value).toMatchObject({
      currency: "USD",
      totalValue: "10036.00000000",
      conversion: {
        sourceCurrency: "USD",
        targetCurrency: "AZN",
        exchangeRate: "1.70000000",
        convertedAmount: "17061.20000000"
      }
    });
    expect(fact.provenance.toolExecutionIds).toHaveLength(5);
    expect(verifyEnvelope(fact, signer)).toBe(true);
  });

  it("rejects a signed conversion that does not match the calculated source amount", () => {
    expect(() => calculatePortfolioRoute({
      context: mockTrustedRequestContext,
      route: "current_portfolio_value",
      portfolioExecution: portfolioExecution(),
      marketExecutions: marketExecutions(),
      currencyConversionExecution: conversionExecution({
        sourceAmount: decimal("10035"),
        convertedAmount: decimal("17059.5")
      }),
      currencyConversionArguments: conversionArguments,
      signer
    })).toThrow(/did not match the calculated portfolio value/u);
  });

  it("reconciles YTD components and cash-flow-adjusted TWR from signed live history", () => {
    const result = calculatePortfolioRoute({
      context: mockTrustedRequestContext,
      route: "ytd_gain_loss_twr",
      portfolioExecution: portfolioExecution(),
      activityExecution: activityExecution(),
      marketExecutions: marketExecutions(),
      historyExecutions: historyExecutions("1y"),
      signer
    });
    const pnl = result.facts.find(({ kind }) => kind === "portfolio.ytd-pnl")!
      .value as YtdPnlFact;
    const twr = result.facts.find(({ kind }) => kind === "portfolio.time-weighted-return")!
      .value as TimeWeightedReturnFact;
    expect(pnl).toMatchObject({
      realizedPricePnl: "150.00000000",
      unrealizedPricePnl: "700.00000000",
      income: "30.00000000",
      fees: "4.00000000",
      componentMethodPnl: "876.00000000",
      reconciliationDifference: "0.00000000",
      reconciled: true
    });
    expect(twr.returnRate).toBe("0.09765443");
    expect(result.facts.every((fact) => fact.provenance.toolExecutionIds.length === 8)).toBe(true);
  });

  it("reports price mover and portfolio contributor as separate measures", () => {
    const fact = calculatePortfolioRoute({
      context: mockTrustedRequestContext,
      route: "one_month_mover_contribution",
      portfolioExecution: portfolioExecution(),
      activityExecution: activityExecution(),
      historyExecutions: historyExecutions("1m"),
      signer
    }).facts[0]!;
    const value = fact.value as OneMonthMoverFact;
    expect(value.largestAbsolutePriceReturn.symbol).toBe("NVDA");
    expect(value.largestAbsolutePortfolioContribution.symbol).toBe("NVDA");
    expect(value.portfolioPriceChange).toBe("-150.00000000");
    expect(fact.provenance.toolExecutionIds).toHaveLength(5);
  });

  it("rejects an unsigned or mismatched market shortcut", () => {
    const markets = marketExecutions();
    const tampered = structuredClone(markets[0]!);
    if (tampered.result) tampered.result.price = "999.00000000" as never;
    expect(() => calculatePortfolioRoute({
      context: mockTrustedRequestContext,
      route: "current_portfolio_value",
      portfolioExecution: portfolioExecution(),
      marketExecutions: [tampered, ...markets.slice(1)],
      signer
    })).toThrow(/valid signed evidence/u);
  });
});
