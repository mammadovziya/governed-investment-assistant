import type { Agent } from "@mastra/core/agent";
import { describe, expect, it, vi } from "vitest";

import {
  reviewedGenericClarificationDefinition
} from "../src/assistant-v3/conversation.js";
import type {
  AssistantResponse,
  SupportedLocale,
  TrustedRequestContext
} from "../src/assistant-v3/contracts.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { sealRenderableFact } from "../src/assistant-v3/rendering.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";
import {
  createAssistantV3Workflows,
  type V3PreparedResponse,
  type V3WorkflowDependencies,
  type V3WorkflowInvocation
} from "../src/assistant-v3/workflows.js";

const NOW = Date.parse("2026-07-23T12:00:00.000Z");

function context(locale: SupportedLocale): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: `request-generic-clarification-${locale}`,
    sessionId: `session-generic-clarification-${locale}`,
    conversationId: `conversation-generic-clarification-${locale}`,
    principalRef: "principal:test",
    tenantRef: "tenant:test",
    locale,
    jurisdiction: "AZ",
    channel: "test",
    environment: "test",
    requestedAt: new Date(NOW).toISOString(),
    authentication: {
      strength: "authenticated",
      authContextRef: "auth:test"
    },
    consentVersion: "consent-v1",
    consentScopes: ["assistant_use"],
    entitlementVersion: "entitlement-v1",
    entitlements: ["assistant_access"],
    policyVersion: "3.0.0",
    capabilities: [],
    featureSnapshot: { version: "feature-v1", flags: {} }
  };
}

async function runGenericClarification(input: {
  locale: SupportedLocale;
  generate: ReturnType<typeof vi.fn>;
}) {
  const signer = new DevHmacSigner({
    keyId: `generic-clarification-${input.locale}`,
    secret: "generic-clarification-test-secret-is-long-enough"
  });
  const evidence = new EvidenceFactory({ signer, now: () => NOW });
  const trustedContext = context(input.locale);
  const invocation = {
    message: input.locale === "az-AZ"
      ? "Buna baxa bilərsən?"
      : "Can you check this for me?",
    context: trustedContext,
    session: {},
    policy: {},
    route: {
      kind: "clarify",
      route: null,
      mvpFunction: null,
      researchFacet: null,
      boundary: null,
      locale: input.locale,
      symbols: [],
      confidence: 0.45,
      reasonCodes: ["no_deterministic_route"],
      requiresPortfolio: false,
      requiresMarketData: false,
      requiresKnowledge: false,
      readOnly: true
    }
  } as unknown as V3WorkflowInvocation;
  const definition = reviewedGenericClarificationDefinition(input.locale);
  const agent = { generate: input.generate } as unknown as Agent;
  const deterministicBoundary = async (
    received: V3WorkflowInvocation,
    workflowRunId: string
  ): Promise<V3PreparedResponse> => {
    const fact = evidence.fact({
      requestId: trustedContext.requestId,
      workflowRunId,
      kind: "assistant.reviewed-clarification",
      subject: { type: "product", ref: "ASSISTANT_GENERIC_CLARIFICATION" },
      asOf: new Date(NOW).toISOString(),
      value: definition,
      provenance: {
        toolExecutionIds: [],
        inputFactIds: [],
        calculation: {
          id: "deterministic-clarification-catalog",
          version: "1.0.0",
          formulaId: "reviewed-generic-clarification-lookup"
        }
      }
    });
    const fallback = [{
      claimId: "generic-clarification",
      locale: input.locale,
      textTemplate: definition.answer,
      factRefs: definition.statements.map(({ alias }) => alias),
      citationRefs: [],
      limitations: []
    }];
    return {
      invocation: received,
      workflowId: "assistant-request-v3",
      workflowRunId,
      status: "clarification-required",
      tools: [],
      toolArguments: [],
      facts: [fact],
      citations: [],
      cards: [],
      charts: [],
      actions: [],
      notices: [],
      freshness: [],
      renderableFacts: definition.statements.map((statement) =>
        sealRenderableFact({
          alias: statement.alias,
          fact,
          meaning: statement.meaning,
          required: statement.required,
          display: statement.text
        }, evidence)
      ),
      renderableCitations: [],
      fallback,
      writerGoal:
        "ask one natural clarification using every reviewed semantic slot",
      deterministicMessage: null,
      message: definition.answer,
      claims: fallback,
      generationMode: "deterministic-fallback"
    };
  };
  const unused = vi.fn(async (): Promise<never> => {
    throw new Error("generic clarification must not execute a tool workflow");
  });
  const dependencies: V3WorkflowDependencies = {
    evidence,
    writers: {
      publicResearchWriter: agent,
      portfolioInsightWriter: agent,
      approvedKnowledgeWriter: agent
    },
    modelTimeoutMs: 1_000,
    authorize: async () => invocation,
    acquirePublic: unused,
    acquirePortfolio: unused,
    acquireKnowledge: unused,
    prepareOrder: unused,
    confirmOrder: unused,
    deterministicBoundary,
    finalize: async (prepared) => prepared as unknown as AssistantResponse,
    rememberOrderRun: () => {}
  };
  const workflow = createAssistantV3Workflows(dependencies).assistantRequest;
  const run = await workflow.createRun({
    resourceId: trustedContext.principalRef
  });
  const result = await run.start({
    inputData: {
      message: invocation.message,
      contextToken: "generic-clarification-context-token"
    }
  });
  expect(result.status).toBe("success");
  if (result.status !== "success") throw new Error("workflow failed");
  return { result: result.result, unused };
}

describe("V3 generic clarification conversation", () => {
  it.each([
    {
      locale: "en-US" as const,
      template:
        "Of course—could you {{CLARIFICATION_REQUEST}}? I’m here to help with {{CLARIFICATION_SCOPE}}.",
      expected:
        "Of course—could you tell me a little more about what you’d like me to check? I’m here to help with portfolio value, performance, fees, or a named ticker’s price or analysis."
    },
    {
      locale: "az-AZ" as const,
      template:
        "Əlbəttə — {{CLARIFICATION_REQUEST}}. Məsələn, {{CLARIFICATION_SCOPE}}.",
      expected:
        "Əlbəttə — nəyə baxmağımı istədiyinizi bir az daha dəqiq deyin. Məsələn, portfel dəyəri, nəticələr, komissiyalar və ya konkret ticker üzrə qiymət və təhlil soruşa bilərsiniz."
    }
  ])("uses the healthy writer first in $locale", async ({
    locale,
    template,
    expected
  }) => {
    const generate = vi.fn(async () => ({
      object: {
        claims: [{
          claimId: "natural-generic-clarification",
          textTemplate: template,
          factRefs: ["CLARIFICATION_REQUEST", "CLARIFICATION_SCOPE"],
          citationRefs: [] as string[],
          limitations: [] as string[]
        }]
      }
    }));

    const { result, unused } = await runGenericClarification({
      locale,
      generate
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(unused).not.toHaveBeenCalled();
    expect(result.status).toBe("clarification-required");
    expect(result.generationMode).toBe("gpt-4o");
    expect(result.message).toBe(expected);
  });

  it.each([
    {
      locale: "en-US" as const,
      expected:
        "Could you tell me a little more about what you’d like me to check? I can help with portfolio value, performance, fees, or a named ticker’s price or analysis."
    },
    {
      locale: "az-AZ" as const,
      expected:
        "nəyə baxmağımı istədiyinizi bir az daha dəqiq deyin. Məsələn, portfel dəyəri, nəticələr, komissiyalar və ya konkret ticker üzrə qiymət və təhlil soruşa bilərsiniz."
    }
  ])("uses the reviewed safe fallback in $locale", async ({
    locale,
    expected
  }) => {
    const generate = vi.fn(async () => {
      throw new Error("injected model outage");
    });

    const { result, unused } = await runGenericClarification({
      locale,
      generate
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(unused).not.toHaveBeenCalled();
    expect(result.status).toBe("clarification-required");
    expect(result.generationMode).toBe("deterministic-fallback");
    expect(result.message).toBe(expected);
  });

  it.each([
    {
      kind: "clarify" as const,
      boundary: null,
      reasonCodes: ["order_preview_sell_not_supported"]
    },
    {
      kind: "boundary" as const,
      boundary: "prompt_injection" as const,
      reasonCodes: ["prompt_injection_detected"]
    }
  ])("keeps $reasonCodes deterministic", async ({
    kind,
    boundary,
    reasonCodes
  }) => {
    const signer = new DevHmacSigner({
      keyId: "non-generic-boundary",
      secret: "non-generic-boundary-test-secret-is-long-enough"
    });
    const evidence = new EvidenceFactory({ signer, now: () => NOW });
    const trustedContext = context("en-US");
    const invocation = {
      message: "adversarial or unsupported request",
      context: trustedContext,
      session: {},
      policy: {},
      route: {
        kind,
        route: null,
        mvpFunction: null,
        researchFacet: null,
        boundary,
        locale: "en-US",
        symbols: [],
        confidence: 1,
        reasonCodes,
        requiresPortfolio: false,
        requiresMarketData: false,
        requiresKnowledge: false,
        readOnly: true
      }
    } as unknown as V3WorkflowInvocation;
    const generate = vi.fn(async () => {
      throw new Error("the writer must not be called");
    });
    const agent = { generate } as unknown as Agent;
    const unused = vi.fn(async (): Promise<never> => {
      throw new Error("a boundary must not execute a tool workflow");
    });
    const deterministicMessage = "Reviewed deterministic boundary response.";
    const dependencies: V3WorkflowDependencies = {
      evidence,
      writers: {
        publicResearchWriter: agent,
        portfolioInsightWriter: agent,
        approvedKnowledgeWriter: agent
      },
      modelTimeoutMs: 1_000,
      authorize: async () => invocation,
      acquirePublic: unused,
      acquirePortfolio: unused,
      acquireKnowledge: unused,
      prepareOrder: unused,
      confirmOrder: unused,
      deterministicBoundary: async (received, workflowRunId) => ({
        invocation: received,
        workflowId: "assistant-request-v3",
        workflowRunId,
        status: kind === "clarify"
          ? "clarification-required"
          : "unavailable",
        tools: [],
        toolArguments: [],
        facts: [],
        citations: [],
        cards: [],
        charts: [],
        actions: [],
        notices: [],
        freshness: [],
        renderableFacts: [],
        renderableCitations: [],
        fallback: [],
        writerGoal: "deterministic safety boundary",
        deterministicMessage,
        message: deterministicMessage,
        claims: [],
        generationMode: "deterministic"
      }),
      finalize: async (prepared) => prepared as unknown as AssistantResponse,
      rememberOrderRun: () => {}
    };
    const workflow = createAssistantV3Workflows(dependencies).assistantRequest;
    const run = await workflow.createRun({
      resourceId: trustedContext.principalRef
    });
    const result = await run.start({
      inputData: {
        message: invocation.message,
        contextToken: "non-generic-boundary-context-token"
      }
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("workflow failed");
    expect(generate).not.toHaveBeenCalled();
    expect(unused).not.toHaveBeenCalled();
    expect(result.result.message).toBe(deterministicMessage);
    expect(result.result.generationMode).toBe("deterministic");
  });
});
