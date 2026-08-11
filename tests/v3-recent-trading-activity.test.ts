import { describe, expect, it } from "vitest";

import {
  SyntheticPortfolioPort,
  selectRecentTradingActivity
} from "../src/assistant-v3/adapters.js";
import type { ToolSource } from "../src/assistant-v3/contracts.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import {
  mockPortfolioSnapshot,
  mockTrustedRequestContext,
  type MockPortfolioActivity,
  type PortfolioStockOrder,
  type RecentTradingActivityResult
} from "../src/assistant-v3/mock-portfolio.js";
import {
  buildPortfolioActivityPresentation,
  portfolioActivityToolArguments,
  projectPortfolioActivityFact,
  type PortfolioActivityToolArguments
} from "../src/assistant-v3/portfolio-activity.js";
import {
  renderClaimDrafts,
  sealRenderableFact
} from "../src/assistant-v3/rendering.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";

const scope = {
  requestId: "request-recent-1",
  workflowRunId: "workflow-recent-1",
  sessionId: "session-recent-1",
  tenantId: "tenant-recent-1",
  principalId: "principal-recent-1"
};

const workflowRunId = "workflow-recent-integrity-1";
const activitySigner = new DevHmacSigner({
  keyId: "recent-activity-integrity-test",
  secret: "recent-activity-integrity-test-secret-at-least-32-bytes"
});
const activitySource: ToolSource = {
  provider: "synthetic-client-ledger",
  sourceId: "recent-activity-integrity-test",
  sourceUrl: null,
  licenseClass: "synthetic",
  observedAt: mockTrustedRequestContext.requestedAt,
  sourceAsOf: mockPortfolioSnapshot.asOf
};

function recentResult(
  query: PortfolioActivityToolArguments = portfolioActivityToolArguments({
    route: "recent_trading_activity",
    symbols: []
  })
): RecentTradingActivityResult {
  return selectRecentTradingActivity({
    activity: mockPortfolioSnapshot.activity,
    query,
    ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
    ledgerPeriodEnd: mockPortfolioSnapshot.asOf
  });
}

function signedActivity(
  result: RecentTradingActivityResult,
  args: PortfolioActivityToolArguments
) {
  return new EvidenceFactory({
    signer: activitySigner,
    now: () => Date.parse(mockTrustedRequestContext.requestedAt)
  }).toolSuccess({
    requestId: mockTrustedRequestContext.requestId,
    workflowRunId,
    toolId: "read-portfolio-activity",
    toolVersion: "3.0.0",
    arguments: args,
    result,
    source: { ...activitySource, sourceAsOf: result.asOf }
  });
}

function projectRecent(
  result: RecentTradingActivityResult,
  expectedArguments: PortfolioActivityToolArguments,
  signedArguments: PortfolioActivityToolArguments = expectedArguments
) {
  return projectPortfolioActivityFact({
    context: mockTrustedRequestContext,
    workflowRunId,
    route: expectedArguments.include === "executions"
      ? "purchase_history"
      : "recent_trading_activity",
    expectedArguments,
    activityExecution: signedActivity(result, signedArguments),
    signer: activitySigner
  });
}

function portfolio() {
  return new SyntheticPortfolioPort({
    tenantRef: scope.tenantId,
    principalRef: scope.principalId,
    now: () => Date.parse("2026-07-22T12:00:00.000Z")
  });
}

function order(index: number, timestamp: string): PortfolioStockOrder {
  const template = mockPortfolioSnapshot.activity.orders[0];
  if (!template) throw new Error("Expected a synthetic order template.");
  return {
    ...structuredClone(template),
    orderRef: `stable-order-${String(index).padStart(2, "0")}`,
    submittedAt: timestamp,
    lastUpdatedAt: timestamp,
    requestedQuantity: decimal("1"),
    filledQuantity: decimal("0"),
    averageFillPrice: null,
    linkedTransactionIds: [],
    status: index % 2 === 0 ? "OPEN" : "CANCELLED"
  };
}

function activityWithOrders(orders: PortfolioStockOrder[]): MockPortfolioActivity {
  return {
    ...structuredClone(mockPortfolioSnapshot.activity),
    transactions: [],
    orders
  };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)])
      .map((tail) => [item, ...tail])
  );
}

describe("recent trading activity projection", () => {
  it("binds the signed tool arguments and projects valid semantic evidence", () => {
    const expectedArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: []
    });
    const fact = projectRecent(recentResult(expectedArguments), expectedArguments);

    expect(fact.value).toMatchObject({
      route: "recent_trading_activity",
      limit: 10,
      matchedCount: 6,
      returnedCount: 6,
      hasMore: false
    });
    expect(fact.provenance.calculation).toMatchObject({
      id: "portfolio-activity-projection",
      version: "portfolio-activity-projection-v3.2.0"
    });
    expect(fact.value.coverage).toEqual({
      status: "complete",
      ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
      ledgerPeriodEnd: mockPortfolioSnapshot.asOf
    });
  });

  it("exposes one signed parent as small model-composable activity slots", () => {
    const expectedArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: []
    });
    const result = recentResult(expectedArguments);
    const activityExecution = signedActivity(result, expectedArguments);
    const fact = projectPortfolioActivityFact({
      context: mockTrustedRequestContext,
      workflowRunId,
      route: "recent_trading_activity",
      expectedArguments,
      activityExecution,
      signer: activitySigner
    });
    const presentation = buildPortfolioActivityPresentation({
      fact,
      locale: "en-US"
    });

    expect(presentation.renderableFacts.map(({ alias, required }) => ({
      alias,
      required
    }))).toEqual([
      { alias: "ACTIVITY_SUMMARY", required: true },
      { alias: "ACTIVITY_ITEM_01", required: true },
      { alias: "ACTIVITY_ITEM_02", required: true },
      { alias: "ACTIVITY_ITEM_03", required: true },
      { alias: "ACTIVITY_ITEM_04", required: false },
      { alias: "ACTIVITY_ITEM_05", required: false },
      { alias: "ACTIVITY_ITEM_06", required: false },
      { alias: "ACTIVITY_COVERAGE", required: false }
    ]);
    expect(new Set(
      presentation.renderableFacts.map(({ fact: parent }) => parent.factId)
    )).toEqual(new Set([fact.factId]));
    expect(presentation.renderableFacts[0]).toMatchObject({
      display: "all 6 matching trading records, newest first",
      meaning:
        "the verified number of matching portfolio activity records found, their newest-first ordering, and that the complete returned page is in the structured activity card"
    });
    expect(
      presentation.renderableFacts
        .filter(({ alias }) => alias.startsWith("ACTIVITY_ITEM_"))
        .every(({ display }) => !display.includes("\n"))
    ).toBe(true);
    expect(presentation.renderableFacts.at(-1)).toMatchObject({
      alias: "ACTIVITY_COVERAGE",
      required: false,
      meaning: "the verified complete portfolio activity record coverage window"
    });
  });

  it("lets the model connect granular slots while exact activity stays server-injected", () => {
    const expectedArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: []
    });
    const result = recentResult(expectedArguments);
    const activityExecution = signedActivity(result, expectedArguments);
    const fact = projectPortfolioActivityFact({
      context: mockTrustedRequestContext,
      workflowRunId,
      route: "recent_trading_activity",
      expectedArguments,
      activityExecution,
      signer: activitySigner
    });
    const presentation = buildPortfolioActivityPresentation({
      fact,
      locale: "en-US"
    });
    const itemAliases = presentation.renderableFacts
      .filter(({ alias }) => alias.startsWith("ACTIVITY_ITEM_"))
      .slice(0, 3)
      .map(({ alias }) => alias);
    const writerAliases = ["ACTIVITY_SUMMARY", ...itemAliases];
    const writerTemplate =
      `I found {{ACTIVITY_SUMMARY}}. The details are ${itemAliases
        .map((alias) => `{{${alias}}}`)
        .join("; ")}.`;

    expect(writerTemplate).not.toMatch(/\$|\b2026\b|\bAAPL\b|\bNVDA\b/u);
    const rendered = renderClaimDrafts({
      drafts: [{
        claimId: "natural-recent-activity",
        locale: "en-US",
        textTemplate: writerTemplate,
        factRefs: writerAliases,
        citationRefs: [],
        limitations: []
      }],
      facts: presentation.renderableFacts.map((item) =>
        sealRenderableFact(item, new EvidenceFactory({ signer: activitySigner }))
      ),
      citations: [],
      tools: [activityExecution],
      evidence: new EvidenceFactory({ signer: activitySigner }),
      fallback: [...presentation.fallback],
      locale: "en-US"
    });

    expect(rendered.generationMode).toBe("writer");
    expect(rendered.usedFactAliases).toEqual(writerAliases);
    expect(rendered.usedFactIds).toEqual([fact.factId]);
    expect(rendered.message).toContain("$205.00");
    expect(rendered.message).toContain("AAPL");
    expect(rendered.message).not.toContain("ACTIVITY_ITEM");
    expect(rendered.message).not.toContain("complete record coverage");
  });

  it("keeps empty history conversational without inventing activity items", () => {
    const expectedArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: []
    });
    const result = selectRecentTradingActivity({
      activity: activityWithOrders([]),
      query: expectedArguments,
      ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
      ledgerPeriodEnd: mockPortfolioSnapshot.asOf
    });
    const activityExecution = signedActivity(result, expectedArguments);
    const fact = projectPortfolioActivityFact({
      context: mockTrustedRequestContext,
      workflowRunId,
      route: "recent_trading_activity",
      expectedArguments,
      activityExecution,
      signer: activitySigner
    });

    for (const locale of ["en-US", "az-AZ"] as const) {
      const presentation = buildPortfolioActivityPresentation({ fact, locale });
      expect(presentation.renderableFacts.map(({ alias, required }) => ({
        alias,
        required
      }))).toEqual([
        { alias: "ACTIVITY_SUMMARY", required: true },
        { alias: "ACTIVITY_COVERAGE", required: false }
      ]);
      expect((presentation.cards[0]?.data as { records: unknown[] }).records)
        .toEqual([]);
      const rendered = renderClaimDrafts({
        drafts: [],
        facts: presentation.renderableFacts.map((item) =>
          sealRenderableFact(item, new EvidenceFactory({ signer: activitySigner }))
        ),
        citations: [],
        tools: [activityExecution],
        evidence: new EvidenceFactory({ signer: activitySigner }),
        fallback: [...presentation.fallback],
        locale
      });
      expect(rendered.generationMode).toBe("deterministic-fallback");
      expect(rendered.usedFactAliases).toEqual([
        "ACTIVITY_SUMMARY",
        "ACTIVITY_COVERAGE"
      ]);
    }
  });

  it("keeps a bounded complete deterministic fallback for a full ten-record page", () => {
    const expectedArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: []
    });
    const orders = Array.from({ length: 12 }, (_, index) =>
      order(index, new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString())
    );
    const result = selectRecentTradingActivity({
      activity: activityWithOrders(orders),
      query: expectedArguments,
      ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
      ledgerPeriodEnd: mockPortfolioSnapshot.asOf
    });
    const activityExecution = signedActivity(result, expectedArguments);
    const fact = projectPortfolioActivityFact({
      context: mockTrustedRequestContext,
      workflowRunId,
      route: "recent_trading_activity",
      expectedArguments,
      activityExecution,
      signer: activitySigner
    });
    const presentation = buildPortfolioActivityPresentation({
      fact,
      locale: "en-US"
    });

    expect(presentation.renderableFacts.find(({ alias }) =>
      alias === "ACTIVITY_HAS_MORE"
    )).toMatchObject({
      display: "older matching records are also available",
      required: false
    });
    expect(presentation.fallback).toHaveLength(3);
    expect(presentation.fallback.every(({ factRefs }) => factRefs.length <= 3))
      .toBe(true);
    expect(presentation.cards[0]?.data).toMatchObject({
      returnedCount: 10,
      records: expect.arrayContaining([
        expect.objectContaining({ recordType: "order" })
      ])
    });
    expect((presentation.cards[0]?.data as { records: unknown[] }).records)
      .toHaveLength(10);

    const rendered = renderClaimDrafts({
      drafts: [],
      facts: presentation.renderableFacts.map((item) =>
        sealRenderableFact(item, new EvidenceFactory({ signer: activitySigner }))
      ),
      citations: [],
      tools: [activityExecution],
      evidence: new EvidenceFactory({ signer: activitySigner }),
      fallback: [...presentation.fallback],
      locale: "en-US"
    });

    expect(rendered.generationMode).toBe("deterministic-fallback");
    expect(rendered.message).toContain(
      "I found the latest 10 of 12 matching trading records, newest first."
    );
    expect(rendered.message).toContain(
      "The activity card contains the complete returned page."
    );
    expect(rendered.message).toContain("older matching records are also available");
    expect(rendered.message).toContain("complete record coverage");
    expect(rendered.usedFactAliases.filter((alias) =>
      alias.startsWith("ACTIVITY_ITEM_")
    )).toEqual([
      "ACTIVITY_ITEM_01",
      "ACTIVITY_ITEM_02",
      "ACTIVITY_ITEM_03"
    ]);

    const azPresentation = buildPortfolioActivityPresentation({
      fact,
      locale: "az-AZ"
    });
    const azRendered = renderClaimDrafts({
      drafts: [],
      facts: azPresentation.renderableFacts.map((item) =>
        sealRenderableFact(item, new EvidenceFactory({ signer: activitySigner }))
      ),
      citations: [],
      tools: [activityExecution],
      evidence: new EvidenceFactory({ signer: activitySigner }),
      fallback: [...azPresentation.fallback],
      locale: "az-AZ"
    });
    expect(azRendered.generationMode).toBe("deterministic-fallback");
    expect(azRendered.message).toContain("12 uyğun qeyddən ən yeni 10-u");
    expect(azRendered.message).toContain("daha köhnə uyğun qeydlər də mövcuddur");
  });

  it("rejects a validly signed envelope whose arguments do not match the routed scope", () => {
    const expectedArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: ["NVDA"]
    });
    const unscopedArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: []
    });

    expect(() => projectRecent(
      recentResult(unscopedArguments),
      expectedArguments,
      unscopedArguments
    )).toThrow(/valid signed evidence/u);
  });

  it.each([
    {
      name: "execution gross arithmetic",
      tamper: (result: RecentTradingActivityResult) => {
        const execution = result.items.find((item) => item.kind === "EXECUTION");
        if (execution?.kind !== "EXECUTION") throw new Error("Expected an execution fixture.");
        execution.transaction.grossAmount.amount = decimal("421");
      }
    },
    {
      name: "execution currency consistency",
      tamper: (result: RecentTradingActivityResult) => {
        const execution = result.items.find((item) => item.kind === "EXECUTION");
        if (execution?.kind !== "EXECUTION") throw new Error("Expected an execution fixture.");
        execution.transaction.unitPrice.currency = "EUR";
      }
    },
    {
      name: "order lifecycle state",
      tamper: (result: RecentTradingActivityResult) => {
        const order = result.items.find((item) =>
          item.kind === "ORDER" && item.order.status === "FILLED"
        );
        if (order?.kind !== "ORDER") throw new Error("Expected a filled order fixture.");
        order.order.status = "OPEN";
      }
    },
    {
      name: "bounded complete coverage",
      tamper: (result: RecentTradingActivityResult) => {
        result.coverage.matchedCount += 1;
        result.hasMore = true;
      }
    },
    {
      name: "ledger time coverage",
      tamper: (result: RecentTradingActivityResult) => {
        const execution = result.items.find((item) => item.kind === "EXECUTION");
        if (execution?.kind !== "EXECUTION") throw new Error("Expected an execution fixture.");
        execution.occurredAt = "2025-12-31T23:59:59.000Z";
        execution.transaction.tradedAt = execution.occurredAt;
      }
    }
  ])("rejects re-signed semantic tampering: $name", ({ tamper }) => {
    const expectedArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: []
    });
    const result = structuredClone(recentResult(expectedArguments));
    tamper(result);

    // The tampered result gets a fresh valid signature. Projection must still
    // reject its semantics instead of treating signature validity as truth.
    expect(() => projectRecent(result, expectedArguments)).toThrow(/inconsistent|reconcile|coverage/u);
  });

  it("rejects re-signed results that escape the requested symbol and record-type scope", () => {
    const symbolArguments = portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: ["NVDA"]
    });
    expect(() => projectRecent(recentResult(), symbolArguments)).toThrow(
      /requested symbol scope/u
    );

    const purchaseArguments = portfolioActivityToolArguments({
      route: "purchase_history",
      symbols: []
    });
    expect(() => projectRecent(recentResult(), purchaseArguments)).toThrow(
      /order-state record is inconsistent/u
    );
  });

  it("is bounded to 10 and reports complete coverage plus hasMore", () => {
    const orders = Array.from({ length: 12 }, (_, index) =>
      order(index, new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString())
    );
    const result = selectRecentTradingActivity({
      activity: activityWithOrders(orders),
      query: { queryType: "recent-trading", limit: 10, include: "orders" },
      ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
      ledgerPeriodEnd: mockPortfolioSnapshot.asOf
    });

    expect(result.items).toHaveLength(10);
    expect(result.coverage).toEqual({
      status: "complete",
      ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
      ledgerPeriodEnd: mockPortfolioSnapshot.asOf,
      matchedCount: 12,
      returnedCount: 10
    });
    expect(result.hasMore).toBe(true);
  });

  it("has permutation-independent newest-first order with a stable reference tie-break", () => {
    const orders = [
      order(3, "2026-07-21T18:00:00.000Z"),
      order(1, "2026-07-21T18:00:00.000Z"),
      order(2, "2026-07-20T18:00:00.000Z"),
      order(0, "2026-07-22T18:00:00.000Z")
    ];
    const references = permutations(orders).map((candidate) =>
      selectRecentTradingActivity({
        activity: activityWithOrders(candidate),
        query: { queryType: "recent-trading", limit: 10, include: "orders" },
        ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
        ledgerPeriodEnd: mockPortfolioSnapshot.asOf
      }).items.map(({ activityRef }) => activityRef)
    );

    expect(references[0]).toEqual([
      "order:stable-order-00",
      "order:stable-order-01",
      "order:stable-order-03",
      "order:stable-order-02"
    ]);
    expect(references).toHaveLength(24);
    expect(references.every((candidate) =>
      JSON.stringify(candidate) === JSON.stringify(references[0])
    )).toBe(true);
  });

  it("treats only BUY executions as purchase history, never open or cancelled orders", async () => {
    const adapter = portfolio();
    const snapshotBefore = await adapter.readSnapshot(scope);
    const result = await adapter.readActivity(scope, {
      queryType: "recent-trading",
      limit: 10,
      include: "executions",
      side: "BUY"
    });
    if (!("queryType" in result)) throw new Error("Expected recent trading evidence.");

    expect(result.items).toHaveLength(1);
    expect(result.items.every(({ kind }) => kind === "EXECUTION")).toBe(true);
    expect(result.items[0]).toMatchObject({
      kind: "EXECUTION",
      positionEffect: "AUTHORITATIVE_EXECUTED_TRADE",
      transaction: {
        executionStatus: "EXECUTED",
        side: "BUY",
        symbol: "AAPL",
        quantity: "2.00000000",
        grossAmount: { amount: "420.00000000", currency: "USD" }
      }
    });
    expect(result.items.some((item) =>
      item.kind === "ORDER" && ["OPEN", "CANCELLED"].includes(item.order.status)
    )).toBe(false);
    expect(await adapter.readSnapshot(scope)).toEqual(snapshotBefore);
  });

  it("filters optional symbol and side before applying the page limit", async () => {
    const result = await portfolio().readActivity(scope, {
      queryType: "recent-trading",
      limit: 1,
      include: "all",
      symbol: "NVDA",
      side: "SELL"
    });
    if (!("queryType" in result)) throw new Error("Expected recent trading evidence.");

    expect(result.coverage.matchedCount).toBe(2);
    expect(result.coverage.returnedCount).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(result.items[0]).toMatchObject({
      kind: "EXECUTION",
      activityRef: "execution:txn-sell-nvda-20260310"
    });
  });

  it("preserves the full period ledger and rejects cross-principal access", async () => {
    const adapter = portfolio();
    const period = await adapter.readActivity(scope, {
      queryType: "period-ledger",
      periodStart: mockPortfolioSnapshot.periodStart,
      periodEnd: mockPortfolioSnapshot.asOf
    });
    expect("transactions" in period ? period.transactions : []).toHaveLength(2);
    expect("orders" in period ? period.orders : []).toHaveLength(4);

    await expect(adapter.readActivity(
      { ...scope, principalId: "principal-other" },
      { queryType: "recent-trading", limit: 10, include: "all" }
    )).rejects.toThrow("not entitled");
  });

  it("filters every period-ledger collection to the requested subperiod", async () => {
    const adapter = portfolio();
    const tradeDay = await adapter.readActivity(scope, {
      queryType: "period-ledger",
      periodStart: "2026-02-15T00:00:00.000Z",
      periodEnd: "2026-02-15T23:59:59.999Z"
    });
    if (!("transactions" in tradeDay)) throw new Error("Expected a period ledger.");

    expect(tradeDay).toMatchObject({
      transactions: [{ transactionId: "txn-buy-aapl-20260215" }],
      orders: [{ orderRef: "order-buy-aapl-20260215" }],
      fees: [{ feeId: "fee-buy-aapl" }],
      externalCashFlows: [],
      dividends: [],
      corporateActions: [],
      performanceFlowValuations: []
    });

    const flowWindow = await adapter.readActivity(scope, {
      queryType: "period-ledger",
      periodStart: "2026-02-10T09:00:00.000Z",
      periodEnd: "2026-02-10T09:00:00.000Z"
    });
    if (!("transactions" in flowWindow)) throw new Error("Expected a period ledger.");
    expect(flowWindow.externalCashFlows).toHaveLength(1);
    expect(flowWindow.performanceFlowValuations).toEqual([
      expect.objectContaining({ cashFlowId: "cash-flow-deposit-20260210" })
    ]);
  });

  it.each([0, 11, 1.5])("rejects invalid limit %s even below the schema boundary", (limit) => {
    expect(() => selectRecentTradingActivity({
      activity: mockPortfolioSnapshot.activity,
      query: { queryType: "recent-trading", limit, include: "all" },
      ledgerPeriodStart: mockPortfolioSnapshot.periodStart,
      ledgerPeriodEnd: mockPortfolioSnapshot.asOf
    })).toThrow("integer from 1 through 10");
  });
});
