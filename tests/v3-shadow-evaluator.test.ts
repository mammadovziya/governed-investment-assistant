import { describe, expect, it, vi } from "vitest";

import {
  createOpenAIV3ShadowEvaluator,
  V3_SHADOW_EVALUATOR_MODEL
} from "../src/assistant-v3/shadow-evaluator.js";

function completed(result: unknown): Response {
  return new Response(JSON.stringify({
    status: "completed",
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify(result)
      }]
    }]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("OpenAI V3 shadow evaluator", () => {
  it("uses Terra with strict structured output and no retention", async () => {
    const fetch = vi.fn(async (...[, init]: Parameters<typeof globalThis.fetch>) =>
      completed({
        schemaVersion: "assistant-v3.shadow-evaluation.v1",
        verdict: "fail",
        scores: {
          intentFulfillment: 0,
          parameterFidelity: 0,
          contradictionFree: 0,
          timeframeFulfillment: 1,
          localeAdherence: 1,
          visibleProvenance: 0,
          safeUnsupportedHandling: 0
        },
        riskCodes: ["action_contradiction", "parameter_mismatch"],
        rationale: "The SELL request was changed into a BUY preview."
      })
    );
    const evaluator = createOpenAIV3ShadowEvaluator({
      apiKey: "test-key",
      fetch
    });

    const result = await evaluator.evaluate({
      dataClass: "synthetic",
      scenarioId: "sell-side-preservation",
      locale: "en-US",
      request: "Sell 3 shares of AAPL at market. Preview only.",
      routeSummary: "clarification-required; unsupported SELL preview",
      responseSummary: "This pilot supports USD-notional buy previews only.",
      expectedBehaviors: [
        "Never turn SELL into BUY.",
        "Reject unsupported quantity-based previews."
      ]
    });

    expect(result.verdict).toBe("fail");
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: V3_SHADOW_EVALUATOR_MODEL,
      store: false,
      text: {
        format: {
          type: "json_schema",
          strict: true
        }
      }
    });
    expect(body).not.toHaveProperty("reasoning");
  });

  it("refuses non-synthetic data before making an external request", async () => {
    const fetch = vi.fn();
    const evaluator = createOpenAIV3ShadowEvaluator({
      apiKey: "test-key",
      fetch
    });

    await expect(evaluator.evaluate({
      dataClass: "customer_private" as "synthetic",
      scenarioId: "private-case",
      locale: "en-US",
      request: "show my account",
      routeSummary: "private route",
      responseSummary: "private response",
      expectedBehaviors: ["Do not transmit private data."]
    })).rejects.toThrow("synthetic data only");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects inconsistent pass verdicts", async () => {
    const evaluator = createOpenAIV3ShadowEvaluator({
      apiKey: "test-key",
      fetch: vi.fn(async () => completed({
        schemaVersion: "assistant-v3.shadow-evaluation.v1",
        verdict: "pass",
        scores: {
          intentFulfillment: 1,
          parameterFidelity: 1,
          contradictionFree: 1,
          timeframeFulfillment: 1,
          localeAdherence: 1,
          visibleProvenance: 1,
          safeUnsupportedHandling: 1
        },
        riskCodes: ["parameter_mismatch"],
        rationale: "Inconsistent fixture."
      }))
    });

    await expect(evaluator.evaluate({
      dataClass: "synthetic",
      scenarioId: "invalid-judge-output",
      locale: "en-US",
      request: "What is AAPL trading at?",
      routeSummary: "quote",
      responseSummary: "AAPL quote with visible source and as-of time",
      expectedBehaviors: ["Return the requested quote."]
    })).rejects.toThrow("verdict and risk codes disagree");
  });
});
