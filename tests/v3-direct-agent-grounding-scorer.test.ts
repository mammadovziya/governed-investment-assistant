import type {
  ScorerRunInputForAgent,
  ScorerRunOutputForAgent,
} from "@mastra/core/evals";
import { describe, expect, it } from "vitest";

import {
  V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID,
  V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_METADATA,
  createV3DirectAgentToolGroundingScorer,
} from "../src/assistant-v3/direct-agent-grounding-scorer.js";
import {
  deriveV3DirectPortfolioAllocationArguments
} from "../src/assistant-v3/direct-no-tool.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import {
  attachIntegrity,
  canonicalHash,
  DevHmacSigner,
  unsignedEnvelope,
} from "../src/assistant-v3/signing.js";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const WORKFLOW_RUN_ID = "00000000-0000-4000-8000-000000000002";
const SIGNER = new DevHmacSigner({
  keyId: "direct-agent-scorer-test",
  secret: "direct-agent-scorer-test-secret-at-least-32-bytes",
});
const EVIDENCE = new EvidenceFactory({ signer: SIGNER, now: () => NOW });

function scorer() {
  return createV3DirectAgentToolGroundingScorer({ signer: SIGNER });
}

function signedMarketEnvelope(
  args: Readonly<Record<string, unknown>> = { symbol: "NVDA" },
) {
  const symbol = typeof args.symbol === "string" ? args.symbol : "NVDA";
  return EVIDENCE.toolSuccess({
    requestId: REQUEST_ID,
    workflowRunId: WORKFLOW_RUN_ID,
    toolId: "read-market-snapshot",
    toolVersion: "3.0.0",
    arguments: args,
    result: {
      symbol,
      price: "203.28000000",
      asOf: "2026-07-22T12:00:00.000Z",
    },
    source: {
      provider: "licensed-test-feed",
      sourceId: `quote:${symbol}`,
      sourceUrl: null,
      licenseClass: "licensed",
      observedAt: "2026-07-22T12:00:00.000Z",
      sourceAsOf: "2026-07-22T12:00:00.000Z",
    },
  });
}

function signedResearchEnvelope(input: {
  symbol: string;
  requestId: string;
  workflowRunId: string;
}) {
  return EVIDENCE.toolSuccess({
    requestId: input.requestId,
    workflowRunId: input.workflowRunId,
    toolId: "read-instrument-research",
    toolVersion: "3.0.0",
    arguments: { symbol: input.symbol },
    result: {
      symbol: input.symbol,
      instrumentType: input.symbol === "SPY" ? "ETF" : "EQUITY",
      generatedAt: "2026-07-22T12:00:00.000Z",
    },
    source: {
      provider: "licensed-test-feed",
      sourceId: `research:${input.symbol}`,
      sourceUrl: null,
      licenseClass: "licensed",
      observedAt: "2026-07-22T12:00:00.000Z",
      sourceAsOf: "2026-07-22T12:00:00.000Z",
    },
  });
}

function signedPortfolioConversionEnvelope() {
  const args = {
    scope: "current-portfolio-value" as const,
    targetCurrency: "AZN" as const,
  };
  return {
    args,
    envelope: EVIDENCE.toolSuccess({
      requestId: REQUEST_ID,
      workflowRunId: WORKFLOW_RUN_ID,
      toolId: "convert-currency",
      toolVersion: "3.0.0",
      arguments: args,
      result: {
        scope: "current-portfolio-value",
        sourceCurrency: "USD",
        targetCurrency: "AZN",
        sourceAmount: "11774.14000000",
        convertedAmount: "20016.03800000",
        exchangeRate: "1.70000000",
        effectiveDate: "2026-07-22",
      },
      source: {
        provider: "central-bank-of-azerbaijan",
        sourceId: "currency-rates:2026-07-22",
        sourceUrl: "https://www.cbar.az/currencies/22.07.2026.xml",
        licenseClass: "public-indicative",
        observedAt: "2026-07-22T12:00:00.000Z",
        sourceAsOf: "2026-07-22T00:00:00.000+04:00",
      },
    }),
  };
}

function signedMarketConversionEnvelope(input: {
  symbol?: string;
  targetCurrency?: "USD" | "AZN";
} = {}) {
  const args = {
    scope: "current-market-price" as const,
    symbol: input.symbol ?? "NVDA",
    targetCurrency: input.targetCurrency ?? "AZN",
  };
  return {
    args,
    envelope: EVIDENCE.toolSuccess({
      requestId: REQUEST_ID,
      workflowRunId: WORKFLOW_RUN_ID,
      toolId: "convert-currency",
      toolVersion: "3.0.0",
      arguments: args,
      result: {
        scope: "current-market-price",
        symbol: args.symbol,
        sourceCurrency: "USD",
        targetCurrency: args.targetCurrency,
        sourceAmount: "203.28000000",
        convertedAmount: "345.57600000",
        exchangeRate: "1.70000000",
        effectiveDate: "2026-07-22",
      },
      source: {
        provider: "central-bank-of-azerbaijan",
        sourceId: "currency-rates:2026-07-22",
        sourceUrl: "https://www.cbar.az/currencies/22.07.2026.xml",
        licenseClass: "public-indicative",
        observedAt: "2026-07-22T12:00:00.000Z",
        sourceAsOf: "2026-07-22T00:00:00.000+04:00",
      },
    }),
  };
}

function signedAllocationEnvelope(args: Readonly<Record<string, unknown>>) {
  return EVIDENCE.toolSuccess({
    requestId: REQUEST_ID,
    workflowRunId: WORKFLOW_RUN_ID,
    toolId: "analyze-portfolio-allocation",
    toolVersion: "3.0.0",
    arguments: args,
    result: {
      schemaVersion: "assistant-v3.portfolio-allocation-analysis.v1",
      scope: args.scope,
      recommendationAllowed: false
    },
    source: {
      provider: "portfolio-allocation-analysis",
      sourceId: "portfolio-allocation-analysis-v1",
      sourceUrl: null,
      licenseClass: "synthetic",
      observedAt: "2026-07-22T12:00:00.000Z",
      sourceAsOf: "2026-07-22T12:00:00.000Z",
    },
  });
}

function signedEducationEnvelope(query: string) {
  const args = { query };
  return {
    args,
    envelope: EVIDENCE.toolSuccess({
      requestId: REQUEST_ID,
      workflowRunId: WORKFLOW_RUN_ID,
      toolId: "retrieve-reviewed-investment-education",
      toolVersion: "3.0.0",
      arguments: args,
      result: {
        schemaVersion: "assistant-v3.financial-education-retrieval.v1",
        status: "grounded",
        queryHash: canonicalHash(query)
      },
      source: {
        provider: "approved-financial-education",
        sourceId: "approved-financial-education-query",
        sourceUrl: null,
        licenseClass: "public-indicative",
        observedAt: "2026-07-22T12:00:00.000Z",
        sourceAsOf: "2026-07-22T12:00:00.000Z",
      },
    }),
  };
}

function message(input: {
  id: string;
  role: "user" | "assistant";
  parts: readonly unknown[];
}) {
  return {
    id: input.id,
    role: input.role,
    createdAt: new Date("2026-07-22T12:00:00.000Z"),
    content: {
      format: 2 as const,
      parts: [...input.parts],
    },
  };
}

function runInput(query: string): ScorerRunInputForAgent {
  return {
    inputMessages: [
      message({
        id: "input-1",
        role: "user",
        parts: [{ type: "text", text: query }],
      }),
    ] as ScorerRunInputForAgent["inputMessages"],
    rememberedMessages: [],
    systemMessages: [],
    taggedSystemMessages: {},
  };
}

function textOutput(text: string): ScorerRunOutputForAgent {
  return [
    message({
      id: "output-text-1",
      role: "assistant",
      parts: [{ type: "text", text }],
    }),
  ] as ScorerRunOutputForAgent;
}

function toolOutput(input: {
  state: "call" | "result" | "output-error";
  result?: unknown;
  errorText?: string;
  toolName?: string;
  args?: Readonly<Record<string, unknown>>;
}): ScorerRunOutputForAgent {
  return [
    message({
      id: "output-tool-1",
      role: "assistant",
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            state: input.state,
            toolCallId: "call-1",
            toolName: input.toolName ?? "read-market-snapshot",
            args: input.args ?? { symbol: "NVDA" },
            ...(Object.prototype.hasOwnProperty.call(input, "result")
              ? { result: input.result }
              : {}),
            ...(input.errorText === undefined
              ? {}
              : { errorText: input.errorText }),
          },
        },
      ],
    }),
  ] as ScorerRunOutputForAgent;
}

describe("direct specialist-agent tool grounding scorer", () => {
  it("scores a factual no-tool hallucination as 0", async () => {
    const result = await scorer().run({
      input: runInput("What is the current NVDA price?"),
      output: textOutput("NVDA is $240.00."),
    });

    expect(result.score).toBe(0);
    expect(result.analyzeStepResult).toEqual({
      adapterVersion: "2.1.0",
      scorerId: V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID,
      status: "fail",
      applicable: true,
      passed: false,
      toolCallCount: 0,
      successfulToolResultCount: 0,
      successfulToolNames: [],
      reasonCodes: ["factual_query_tool_not_called"],
      implementation: "deterministic-function",
      authoritativeDeliveryGate: false,
    });
  });

  it("scores only a cryptographically and semantically verified tool envelope as 1", async () => {
    const result = await scorer().run({
      input: runInput("What is the current NVDA price?"),
      output: toolOutput({
        state: "result",
        result: { envelope: signedMarketEnvelope() },
      }),
    });

    expect(result.score).toBe(1);
    expect(result.analyzeStepResult).toMatchObject({
      status: "pass",
      applicable: true,
      passed: true,
      toolCallCount: 1,
      successfulToolResultCount: 1,
      successfulToolNames: ["read-market-snapshot"],
      reasonCodes: ["signed_tool_envelope_verified"],
    });
  });

  it.each([
    "Portfelimin AZN ilə cari dəyəri nə qədərdir?",
    "Portfelimin cari dəyərini manatla göstər",
    "Portfelimin cari dəyərini manat ilə göstər",
    "Portfelimin dəyərini Azərbaycan manatı ilə göstər",
    "Portfelimin AZN ekvivalentini göstər",
  ])("accepts a signed portfolio conversion requested as: %s", async (query) => {
    const conversion = signedPortfolioConversionEnvelope();
    const result = await scorer().run({
      input: runInput(query),
      output: toolOutput({
        state: "result",
        toolName: "convert-currency",
        args: conversion.args,
        result: { envelope: conversion.envelope },
      }),
    });

    expect(result.score).toBe(1);
    expect(result.analyzeStepResult).toMatchObject({
      status: "pass",
      applicable: true,
      passed: true,
      successfulToolNames: ["convert-currency"],
      reasonCodes: ["signed_tool_envelope_verified"],
    });
  });

  it("accepts only the exact signed symbol and target for a current quote conversion", async () => {
    const conversion = signedMarketConversionEnvelope();
    const accepted = await scorer().run({
      input: runInput("What is the current NVDA price in AZN?"),
      output: toolOutput({
        state: "result",
        toolName: "convert-currency",
        args: conversion.args,
        result: { envelope: conversion.envelope },
      }),
    });
    expect(accepted.score).toBe(1);
    expect(accepted.analyzeStepResult).toMatchObject({
      status: "pass",
      successfulToolNames: ["convert-currency"],
      reasonCodes: ["signed_tool_envelope_verified"],
    });

    for (const candidate of [
      signedMarketConversionEnvelope({ symbol: "AAPL" }),
      signedMarketConversionEnvelope({ targetCurrency: "USD" }),
    ]) {
      const rejected = await scorer().run({
        input: runInput("What is the current NVDA price in AZN?"),
        output: toolOutput({
          state: "result",
          toolName: "convert-currency",
          args: candidate.args,
          result: { envelope: candidate.envelope },
        }),
      });
      expect(rejected.score).toBe(0);
      expect(rejected.analyzeStepResult).toMatchObject({
        status: "fail",
        reasonCodes: ["tool_not_semantically_authorized_for_current_query"],
      });
    }
  });

  it("accepts concept and rebalancing education only when the signed query matches the current turn", async () => {
    for (const query of [
      "What does bond duration mean?",
      "Should I rebalance this quarter or annually?",
    ]) {
      const acceptedEvidence = signedEducationEnvelope(query);
      const accepted = await scorer().run({
        input: runInput(query),
        output: toolOutput({
          state: "result",
          toolName: "retrieve-reviewed-investment-education",
          args: acceptedEvidence.args,
          result: { envelope: acceptedEvidence.envelope },
        }),
      });
      expect(accepted.score).toBe(1);
      expect(accepted.analyzeStepResult).toMatchObject({
        status: "pass",
        successfulToolNames: ["retrieve-reviewed-investment-education"],
        reasonCodes: ["signed_tool_envelope_verified"],
      });
    }

    const query = "What does bond duration mean?";
    const mismatchedEvidence = signedEducationEnvelope(
      "What is tracking error?"
    );
    const rejected = await scorer().run({
      input: runInput(query),
      output: toolOutput({
        state: "result",
        toolName: "retrieve-reviewed-investment-education",
        args: mismatchedEvidence.args,
        result: { envelope: mismatchedEvidence.envelope },
      }),
    });
    expect(rejected.score).toBe(0);
    expect(rejected.analyzeStepResult).toMatchObject({
      status: "fail",
      reasonCodes: ["tool_not_semantically_authorized_for_current_query"],
    });
  });

  it("requires the exact reviewed scope and hypothetical allocation arguments", async () => {
    const prompts = [
      "What are the biggest risks in this portfolio?",
      "If you were my investment advisor, what would you change in this portfolio?",
      "Lets assume I have a portfolio worth $20,000: 40% Tesla, 30% NVIDIA, 20% Microsoft, 10% cash. Analyze my allocation."
    ] as const;

    for (const query of prompts) {
      const args = deriveV3DirectPortfolioAllocationArguments(query);
      if (args === null) throw new Error("Expected reviewed allocation arguments.");
      const accepted = await scorer().run({
        input: runInput(query),
        output: toolOutput({
          state: "result",
          toolName: "analyze-portfolio-allocation",
          args,
          result: { envelope: signedAllocationEnvelope(args) }
        })
      });
      expect(accepted.score).toBe(1);
      expect(accepted.analyzeStepResult).toMatchObject({
        status: "pass",
        successfulToolNames: ["analyze-portfolio-allocation"],
        reasonCodes: ["signed_tool_envelope_verified"]
      });
    }

    const hypothetical = prompts[2];
    const expectedArgs = deriveV3DirectPortfolioAllocationArguments(hypothetical);
    if (expectedArgs === null || !Array.isArray(expectedArgs.allocations)) {
      throw new Error("Expected hypothetical allocation arguments.");
    }
    const wrongArgs = {
      ...expectedArgs,
      allocations: expectedArgs.allocations.map((allocation, index) =>
        index === 0 && typeof allocation === "object" && allocation !== null
          ? { ...allocation, allocationRate: "0.39000000" }
          : allocation
      )
    };
    const rejected = await scorer().run({
      input: runInput(hypothetical),
      output: toolOutput({
        state: "result",
        toolName: "analyze-portfolio-allocation",
        args: wrongArgs,
        result: { envelope: signedAllocationEnvelope(wrongArgs) }
      })
    });
    expect(rejected.score).toBe(0);
    expect(rejected.analyzeStepResult).toMatchObject({
      status: "fail",
      reasonCodes: ["tool_not_semantically_authorized_for_current_query"]
    });
  });

  it("rejects a signed stale symbol and a signed wrong tool for the current query", async () => {
    const staleSymbol = await scorer().run({
      input: runInput("What is the current NVDA price?"),
      output: toolOutput({
        state: "result",
        args: { symbol: "A" },
        result: {
          envelope: signedMarketEnvelope({ symbol: "A" }),
        },
      }),
    });
    expect(staleSymbol.score).toBe(0);
    expect(staleSymbol.analyzeStepResult).toMatchObject({
      status: "fail",
      successfulToolResultCount: 1,
      reasonCodes: ["tool_not_semantically_authorized_for_current_query"],
    });

    const researchEnvelope = signedResearchEnvelope({
      symbol: "NVDA",
      requestId: "00000000-0000-4000-8000-000000000021",
      workflowRunId: "00000000-0000-4000-8000-000000000022",
    });
    const wrongTool = await scorer().run({
      input: runInput("What is the current NVDA price?"),
      output: toolOutput({
        state: "result",
        toolName: "read-instrument-research",
        args: { symbol: "NVDA" },
        result: { envelope: researchEnvelope },
      }),
    });
    expect(wrongTool.score).toBe(0);
    expect(wrongTool.analyzeStepResult).toMatchObject({
      status: "fail",
      successfulToolResultCount: 1,
      reasonCodes: ["tool_not_semantically_authorized_for_current_query"],
    });
  });

  it.each([
    [
      "unsigned partial envelope",
      { envelope: { schemaVersion: "assistant-v3.tool-execution.v1", status: "success" } },
      "read-market-snapshot",
      { symbol: "NVDA" },
      "tool_envelope_or_request_run_binding_invalid",
    ],
    [
      "tool identity mismatch",
      { envelope: signedMarketEnvelope() },
      "read-price-history",
      { symbol: "NVDA" },
      "tool_identity_not_allowed_or_mismatched",
    ],
    [
      "argument hash mismatch",
      { envelope: signedMarketEnvelope() },
      "read-market-snapshot",
      { symbol: "AAPL" },
      "tool_arguments_hash_invalid",
    ],
  ] as const)("rejects %s", async (_case, result, toolName, args, reasonCode) => {
    const score = await scorer().run({
      input: runInput("What is the current NVDA price?"),
      output: toolOutput({ state: "result", result, toolName, args }),
    });

    expect(score.score).toBe(0);
    expect(score.analyzeStepResult).toMatchObject({
      status: "fail",
      passed: false,
      successfulToolResultCount: 0,
      reasonCodes: [reasonCode],
    });
  });

  it("rejects a tampered signed result and malformed request/run binding", async () => {
    const envelope = signedMarketEnvelope();
    const tampered = {
      ...envelope,
      result: { ...envelope.result, price: "999.00000000" },
    };
    const malformedBinding = {
      ...envelope,
      requestId: "caller-controlled-request",
    };
    for (const [candidate, reasonCode] of [
      [tampered, "tool_envelope_signature_invalid"],
      [malformedBinding, "tool_envelope_or_request_run_binding_invalid"],
    ] as const) {
      const result = await scorer().run({
        input: runInput("What is the current NVDA price?"),
        output: toolOutput({ state: "result", result: { envelope: candidate } }),
      });
      expect(result.score).toBe(0);
      expect(result.analyzeStepResult).toMatchObject({ reasonCodes: [reasonCode] });
    }
  });

  it("rejects a signer-valid envelope whose canonical result hash is false", async () => {
    const envelope = signedMarketEnvelope();
    const payload = unsignedEnvelope(envelope);
    const signerValidButHashInvalid = attachIntegrity({
      ...payload,
      resultHash: canonicalHash({ symbol: "NVDA", price: "1.00000000" }),
    }, SIGNER);
    const result = await scorer().run({
      input: runInput("What is the current NVDA price?"),
      output: toolOutput({
        state: "result",
        result: { envelope: signerValidButHashInvalid },
      }),
    });

    expect(result.score).toBe(0);
    expect(result.analyzeStepResult).toMatchObject({
      reasonCodes: ["tool_result_hash_invalid"],
    });
  });

  it("rejects an unsupported multi-quote plan even when both results are signed", async () => {
    const second = EVIDENCE.toolSuccess({
      requestId: "00000000-0000-4000-8000-000000000003",
      workflowRunId: "00000000-0000-4000-8000-000000000004",
      toolId: "read-market-snapshot",
      toolVersion: "3.0.0",
      arguments: { symbol: "AAPL" },
      result: { symbol: "AAPL", price: "326.59000000" },
      source: {
        provider: "licensed-test-feed",
        sourceId: "quote:AAPL",
        sourceUrl: null,
        licenseClass: "licensed",
        observedAt: "2026-07-22T12:00:00.000Z",
        sourceAsOf: "2026-07-22T12:00:00.000Z",
      },
    });
    const output = [
      message({
        id: "output-tool-multiple",
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              state: "result",
              toolCallId: "call-1",
              toolName: "read-market-snapshot",
              args: { symbol: "NVDA" },
              result: { envelope: signedMarketEnvelope() },
            },
          },
          {
            type: "tool-invocation",
            toolInvocation: {
              state: "result",
              toolCallId: "call-2",
              toolName: "read-market-snapshot",
              args: { symbol: "AAPL" },
              result: { envelope: second },
            },
          },
        ],
      }),
    ] as ScorerRunOutputForAgent;
    const result = await scorer().run({
      input: runInput("What are the current prices for NVDA and AAPL?"),
      output,
    });

    expect(result.score).toBe(0);
    expect(result.analyzeStepResult).toMatchObject({
      successfulToolResultCount: 2,
      reasonCodes: ["tool_not_semantically_authorized_for_current_query"],
    });
  });

  it("accepts exactly two signed research results for two explicit comparison symbols", async () => {
    const tools = [
      {
        symbol: "NVDA",
        requestId: "00000000-0000-4000-8000-000000000011",
        workflowRunId: "00000000-0000-4000-8000-000000000012",
      },
      {
        symbol: "SPY",
        requestId: "00000000-0000-4000-8000-000000000013",
        workflowRunId: "00000000-0000-4000-8000-000000000014",
      },
    ] as const;
    const output = [
      message({
        id: "output-tool-research-comparison",
        role: "assistant",
        parts: tools.map((tool, index) => ({
          type: "tool-invocation",
          toolInvocation: {
            state: "result",
            toolCallId: `call-${String(index + 1)}`,
            toolName: "read-instrument-research",
            args: { symbol: tool.symbol },
            result: {
              envelope: signedResearchEnvelope(tool),
            },
          },
        })),
      }),
    ] as ScorerRunOutputForAgent;

    const result = await scorer().run({
      input: runInput("How risky is NVDA compared with SPY?"),
      output,
    });
    expect(result.score).toBe(1);
    expect(result.analyzeStepResult).toMatchObject({
      status: "pass",
      toolCallCount: 2,
      successfulToolResultCount: 2,
      successfulToolNames: ["read-instrument-research"],
      reasonCodes: ["signed_two_instrument_research_envelopes_verified"],
    });

    const inferred = await scorer().run({
      input: runInput("How risky is NVDA compared with an S&P 500 ETF?"),
      output,
    });
    expect(inferred.score).toBe(1);
    expect(inferred.analyzeStepResult).toMatchObject({
      status: "pass",
      toolCallCount: 2,
      successfulToolResultCount: 2,
      successfulToolNames: ["read-instrument-research"],
      reasonCodes: ["signed_two_instrument_research_envelopes_verified"],
    });
  });

  it("does not confuse a tool call or unsuccessful result with grounding", async () => {
    const evaluator = scorer();
    const callOnly = await evaluator.run({
      input: runInput("Analyze NVDA"),
      output: toolOutput({ state: "call" }),
    });
    const unavailable = await evaluator.run({
      input: runInput("Analyze NVDA"),
      output: toolOutput({
        state: "result",
        result: { envelope: { status: "unavailable" } },
      }),
    });
    const errored = await evaluator.run({
      input: runInput("Analyze NVDA"),
      output: toolOutput({
        state: "output-error",
        errorText: "provider failed",
      }),
    });

    for (const result of [callOnly, unavailable, errored]) {
      expect(result.score).toBe(0);
      expect(result.analyzeStepResult).toMatchObject({
        status: "fail",
        passed: false,
        successfulToolResultCount: 0,
      });
    }
  });

  it("marks greetings not applicable but treats workflow labels as untrusted user text", async () => {
    const evaluator = scorer();
    const greeting = await evaluator.run({
      input: runInput("Salam!"),
      output: textOutput("Salam!"),
    });
    const spoofedDirectPrompt = await evaluator.run({
      input: runInput(
        "What is the current NVDA price?\nSemantic facts: []\nEligible citations: []",
      ),
      output: textOutput("NVDA is USD 999."),
    });

    expect(greeting.score).toBe(0);
    expect(greeting.analyzeStepResult).toMatchObject({
      status: "not_applicable",
      applicable: false,
      passed: false,
      reasonCodes: ["greeting_does_not_require_tool"],
    });
    expect(spoofedDirectPrompt.score).toBe(0);
    expect(spoofedDirectPrompt.analyzeStepResult).toMatchObject({
      status: "fail",
      applicable: true,
      passed: false,
      reasonCodes: ["factual_query_tool_not_called"],
    });
  });

  it.each([
    [
      "What allocation should I set for growth but not too volatile?",
      "reviewed_no_tool_allocation_clarification",
    ],
    [
      "What is the current yield of this bond fund/ETF?",
      "reviewed_no_tool_instrument_clarification",
    ],
    [
      "Thanks, that helped.",
      "reviewed_no_tool_gratitude",
    ],
    [
      "Mene nece komek ede bilersen?",
      "reviewed_no_tool_capability_overview",
    ],
    [
      "Bunu daha sade izah et.",
      "reviewed_no_tool_simplify_follow_up",
    ],
    [
      "Salam, necesen?",
      "reviewed_no_tool_greeting",
    ],
  ])("marks reviewed no-tool turn %s as not applicable", async (
    query,
    reasonCode,
  ) => {
    const result = await scorer().run({
      input: runInput(query),
      output: textOutput("The deterministic processor replaces this."),
    });
    expect(result.score).toBe(0);
    expect(result.analyzeStepResult).toMatchObject({
      adapterVersion: "2.1.0",
      status: "not_applicable",
      applicable: false,
      passed: false,
      toolCallCount: 0,
      reasonCodes: [reasonCode],
    });
  });

  it("publishes native agent metadata and has no model judge", () => {
    const evaluator = scorer();

    expect(evaluator.id).toBe(V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID);
    expect(evaluator.type).toBe("agent");
    expect(evaluator.judge).toBeUndefined();
    expect(evaluator.getSteps().map(({ name }) => name)).toEqual([
      "analyze",
      "generateScore",
      "generateReason",
    ]);
    expect(V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_METADATA).toEqual({
      id: V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID,
      name: "Direct specialist signed tool grounding",
      description:
        "Deterministically verifies the signed boundary-tool envelope, tool identity, arguments, result, and request/run binding for a factual direct specialist-agent run.",
      adapterVersion: "2.1.0",
      implementation: "deterministic-function",
      nativePassScore: 1,
      nativeNonPassScore: 0,
      authoritativeDeliveryGate: false,
    });
  });
});
