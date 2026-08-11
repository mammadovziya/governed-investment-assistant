import type { Agent } from "@mastra/core/agent";
import { describe, expect, it, vi } from "vitest";

import {
  reviewedConversationDefinition
} from "../src/assistant-v3/conversation.js";
import type {
  AssistantResponse,
  TrustedRequestContext
} from "../src/assistant-v3/contracts.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import { sealRenderableFact } from "../src/assistant-v3/rendering.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";
import {
  createAssistantV3Workflows,
  type V3PreparedResponse,
  type V3WorkflowDependencies,
  type V3WorkflowInvocation
} from "../src/assistant-v3/workflows.js";

const NOW = Date.parse("2026-07-23T10:00:00.000Z");

function context(): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-casual-conversation",
    sessionId: "session-casual-conversation",
    conversationId: "conversation-casual",
    principalRef: "principal:test",
    tenantRef: "tenant:test",
    locale: "en-US",
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

describe("V3 model-authored casual conversation", () => {
  it("varies the greeting around a reviewed slot without invoking a boundary tool", async () => {
    const signer = new DevHmacSigner({
      keyId: "casual-conversation",
      secret: "casual-conversation-test-secret-is-long-enough"
    });
    const evidence = new EvidenceFactory({ signer, now: () => NOW });
    const trustedContext = context();
    const invocation = {
      message: "Hello!",
      context: trustedContext,
      session: {},
      policy: {},
      route: {
        kind: "capability",
        route: "conversation",
        mvpFunction: null,
        researchFacet: null,
        boundary: null,
        locale: "en-US",
        symbols: [],
        confidence: 1,
        reasonCodes: ["conversation:greeting"],
        requiresPortfolio: false,
        requiresMarketData: false,
        requiresKnowledge: false,
        readOnly: true
      }
    } as unknown as V3WorkflowInvocation;
    const definition = reviewedConversationDefinition(
      invocation.message,
      "en-US"
    )!;
    const generate = vi.fn(async () => ({
      object: {
        claims: [{
          claimId: "natural-greeting",
          textTemplate:
            "Hi—nice to meet you. I’m here to help with {{CONVERSATION_SCOPE}}.",
          factRefs: ["CONVERSATION_SCOPE"],
          citationRefs: [],
          limitations: []
        }]
      }
    }));
    const agent = { generate } as unknown as Agent;
    const deterministicBoundary = async (
      received: V3WorkflowInvocation,
      workflowRunId: string
    ): Promise<V3PreparedResponse> => {
      const fact = evidence.fact({
        requestId: trustedContext.requestId,
        workflowRunId,
        kind: "assistant.reviewed-conversation",
        subject: { type: "product", ref: "ASSISTANT_CONVERSATION" },
        asOf: new Date(NOW).toISOString(),
        value: definition,
        provenance: {
          toolExecutionIds: [],
          inputFactIds: [],
          calculation: {
            id: "deterministic-conversation-catalog",
            version: "1.0.0",
            formulaId: "reviewed-conversation-lookup"
          }
        },
        quality: {
          status: "complete",
          coverage: decimal("1"),
          flags: ["REVIEWED_CONVERSATION", "en-US"]
        }
      });
      const fallback = [{
        claimId: "conversation-fallback",
        locale: "en-US" as const,
        textTemplate: definition.answer,
        factRefs: definition.statements.map(({ alias }) => alias),
        citationRefs: [],
        limitations: []
      }];
      return {
        invocation: received,
        workflowId: "assistant-request-v3",
        workflowRunId,
        status: "complete",
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
        writerGoal: "respond naturally to the greeting",
        deterministicMessage: null,
        message: definition.answer,
        claims: fallback,
        generationMode: "deterministic-fallback"
      };
    };
    const unused = vi.fn(async (): Promise<never> => {
      throw new Error("a conversational turn must not execute a tool workflow");
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
        contextToken: "casual-context-token-is-long-enough"
      }
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("workflow failed");
    expect(unused).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledOnce();
    expect(result.result.generationMode).toBe("gpt-4o");
    expect(result.result.provenance?.toolExecutionIds ?? []).toEqual([]);
    expect(result.result.message).toBe(
      "Hi—nice to meet you. I’m here to help with portfolio, public-market, and investment-education questions."
    );
  });
});
