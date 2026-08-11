import { describe, expect, it } from "vitest";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";

describe("V3 evidence chain", () => {
  const signer = new DevHmacSigner({ keyId: "test-key", secret: "e".repeat(32) });
  const factory = new EvidenceFactory({
    signer,
    now: () => Date.parse("2026-07-22T08:00:00.000Z")
  });

  it("binds canonical arguments, exact results, and derived facts", () => {
    const tool = factory.toolSuccess({
      requestId: "request-1",
      workflowRunId: "run-1",
      toolId: "read-market-snapshot",
      toolVersion: "1.0.0",
      arguments: { symbol: "AAPL" },
      result: { symbol: "AAPL", price: decimal("200") },
      source: {
        provider: "yahoo",
        sourceId: "chart:AAPL",
        sourceUrl: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        licenseClass: "public-indicative",
        observedAt: "2026-07-22T08:00:00.000Z",
        sourceAsOf: "2026-07-22T08:00:00.000Z"
      }
    });
    const fact = factory.fact({
      requestId: "request-1",
      workflowRunId: "run-1",
      kind: "market.price",
      subject: { type: "instrument", ref: "AAPL" },
      asOf: "2026-07-22T08:00:00.000Z",
      value: { amount: decimal("200"), currency: "USD" },
      provenance: {
        toolExecutionIds: [tool.executionId],
        inputFactIds: [],
        calculation: null
      }
    });
    expect(factory.verifyTool(tool)).toBe(true);
    expect(factory.verifyFact(fact, [tool])).toBe(true);
  });

  it("rejects tampered results and cross-run provenance", () => {
    const tool = factory.toolSuccess({
      requestId: "request-1",
      workflowRunId: "run-1",
      toolId: "read-market-snapshot",
      toolVersion: "1.0.0",
      arguments: { symbol: "AAPL" },
      result: { price: decimal("200") },
      source: {
        provider: "test",
        sourceId: "quote",
        sourceUrl: null,
        licenseClass: "synthetic",
        observedAt: "2026-07-22T08:00:00.000Z",
        sourceAsOf: "2026-07-22T08:00:00.000Z"
      }
    });
    const tampered = { ...tool, result: { price: decimal("999") } };
    expect(factory.verifyTool(tampered)).toBe(false);

    const fact = factory.fact({
      requestId: "request-1",
      workflowRunId: "run-2",
      kind: "market.price",
      subject: { type: "instrument", ref: "AAPL" },
      asOf: "2026-07-22T08:00:00.000Z",
      value: decimal("200"),
      provenance: {
        toolExecutionIds: [tool.executionId],
        inputFactIds: [],
        calculation: null
      }
    });
    expect(factory.verifyFact(fact, [tool])).toBe(false);
  });
});
