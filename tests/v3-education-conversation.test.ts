import type { Agent } from "@mastra/core/agent";
import { describe, expect, it, vi } from "vitest";

import type {
  AssistantResponse,
  ClaimDraft,
  TrustedRequestContext
} from "../src/assistant-v3/contracts.js";
import type {
  FinancialEducationRetrievalResult
} from "../src/domain/financial-education.js";
import {
  buildReviewedEducationCapabilityPresentation
} from "../src/assistant-v3/capability-presentations.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { routeV3Request } from "../src/assistant-v3/routing.js";
import { sealRenderableFact } from "../src/assistant-v3/rendering.js";
import { scoreV3ResponseForDelivery } from "../src/assistant-v3/response-scorers.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";
import {
  createAssistantV3Workflows,
  type V3CapabilityBundle,
  type V3PreparedResponse,
  type V3WorkflowDependencies,
  type V3WorkflowInvocation
} from "../src/assistant-v3/workflows.js";
import {
  createApprovedFinancialEducationRegistry
} from "../src/data/approved-financial-education.js";
import {
  ApprovedFinancialEducationService
} from "../src/services/financial-education-retrieval.js";

const NOW = Date.parse("2026-08-01T08:00:00.000Z");
const QUERY = "TWR nədir?";

function trustedContext(): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-education-conversation",
    sessionId: "session-education-conversation",
    conversationId: "conversation-education",
    principalRef: "principal:test",
    tenantRef: "tenant:test",
    locale: "az-AZ",
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
    capabilities: ["education-read"],
    featureSnapshot: { version: "feature-v1", flags: {} }
  };
}

describe("V3 query-grounded conversational education", () => {
  it("composes retrieved TWR propositions and fails closed when the writer omits evidence", async () => {
    const signer = new DevHmacSigner({
      keyId: "education-conversation",
      secret: "education-conversation-test-secret-is-long-enough"
    });
    const evidence = new EvidenceFactory({ signer, now: () => NOW });
    const context = trustedContext();
    const invocation = {
      message: QUERY,
      context,
      session: {},
      policy: {},
      route: routeV3Request(QUERY)
    } as unknown as V3WorkflowInvocation;
    expect(invocation.route).toMatchObject({
      route: "education",
      locale: "az-AZ",
      requiresKnowledge: true,
      requiresPortfolio: false
    });

    const financialEducation = new ApprovedFinancialEducationService({
      registry: createApprovedFinancialEducationRegistry(),
      minimumScore: 0.2,
      topK: 3
    });
    const retrieve = vi.fn((input: Parameters<
      ApprovedFinancialEducationService["retrieve"]
    >[0]) => financialEducation.retrieve(input));
    let completeClaims: ClaimDraft[] = [];
    const generate = vi.fn(async () => ({
      object: {
        claims: completeClaims
      }
    }));
    const agent = { generate } as unknown as Agent;
    const acquireKnowledge = async (
      received: V3WorkflowInvocation,
      workflowRunId: string
    ): Promise<V3CapabilityBundle> => {
      const result = await retrieve({
        query: received.message,
        context: {
          requestId: received.context.requestId,
          locale: received.context.locale,
          jurisdiction: "AZ",
          channel: "customer_chat",
          asOf: received.context.requestedAt
        }
      });
      completeClaims = result.propositions.map((_, index) => {
        const number = index + 1;
        return {
          claimId: `twr-proposition-${number}`,
          locale: "az-AZ",
          textTemplate: `{{E${number}}} {{C${number}}}`,
          factRefs: [`E${number}`],
          citationRefs: [`C${number}`],
          limitations: []
        };
      });
      const tool = evidence.toolSuccess({
        requestId: context.requestId,
        workflowRunId,
        toolId: "retrieve-reviewed-investment-education",
        toolVersion: "3.0.0",
        arguments: { query: received.message },
        result,
        source: {
          provider: "approved-financial-education-registry",
          sourceId: "approved-financial-education-2026-07",
          sourceUrl: null,
          licenseClass: "project-internal",
          observedAt: new Date(NOW).toISOString(),
          sourceAsOf: result.citations
            .map(({ reviewedAt }) => reviewedAt)
            .sort()
            .at(-1) ?? new Date(NOW).toISOString()
        }
      });
      const presentation = buildReviewedEducationCapabilityPresentation({
        context,
        workflowRunId,
        tool,
        signer
      });
      return {
        invocation: received,
        workflowId: "approved-knowledge-v3",
        workflowRunId,
        status: presentation.status,
        tools: [tool],
        toolArguments: [{
          executionId: tool.executionId,
          arguments: { query: received.message }
        }],
        facts: presentation.facts,
        citations: presentation.citations,
        cards: presentation.cards,
        charts: presentation.charts,
        actions: [],
        notices: presentation.notices,
        freshness: presentation.freshness,
        renderableFacts: presentation.renderableFacts.map((item) =>
          sealRenderableFact(item, evidence)
        ),
        renderableCitations: presentation.renderableCitations,
        fallback: presentation.fallback,
        writerGoal: presentation.writerGoal,
        deterministicMessage: null
      };
    };
    const unused = async (): Promise<never> => {
      throw new Error("unused dependency");
    };
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
      acquireKnowledge,
      prepareOrder: unused,
      confirmOrder: unused,
      deterministicBoundary: unused,
      finalize: async (prepared) => prepared as unknown as AssistantResponse,
      rememberOrderRun: () => {}
    };
    const workflow = createAssistantV3Workflows(dependencies).assistantRequest;
    const run = await workflow.createRun({ resourceId: context.principalRef });
    const result = await run.start({
      inputData: {
        message: invocation.message,
        contextToken: "education-context-token-is-long-enough"
      }
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("education workflow failed");
    expect(retrieve).toHaveBeenCalledWith({
      query: QUERY,
      context: {
        requestId: context.requestId,
        locale: "az-AZ",
        jurisdiction: "AZ",
        channel: "customer_chat",
        asOf: context.requestedAt
      }
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(result.result).toMatchObject({
      status: "complete",
      generationMode: "gpt-4o",
      facts: [{
        kind: "education.approved-retrieval",
        subject: {
          type: "product",
          ref: expect.stringMatching(
            /^GENERAL_FINANCIAL_EDUCATION:[a-f0-9]{64}$/u
          )
        },
        value: {
          schemaVersion: "assistant-v3.financial-education-retrieval.v1",
          status: "grounded",
          requestId: context.requestId,
          locale: "az-AZ"
        }
      }]
    });
    expect(result.result.citations).toHaveLength(1);
    const educationValue = result.result.facts[0]
      ?.value as FinancialEducationRetrievalResult;
    const approvedProposition = educationValue.propositions[0]?.text;
    if (approvedProposition === undefined) {
      throw new Error("approved TWR proposition is missing");
    }
    expect(result.result.message).toContain(approvedProposition);
    expect(result.result.message).toContain("[1]");
    expect(result.result.message).not.toMatch(
      /The key point is|Əsas məqam budur ki/iu
    );

    const prepared = result.result as unknown as V3PreparedResponse;
    const completedTool = prepared.tools[0];
    if (completedTool === undefined) {
      throw new Error("education tool execution is missing");
    }
    const response: AssistantResponse = {
      schemaVersion: "assistant-v3.response.v1",
      requestId: context.requestId,
      conversationId: context.conversationId,
      status: prepared.status,
      message: prepared.message,
      claims: prepared.claims,
      facts: prepared.facts,
      citations: prepared.citations,
      cards: prepared.cards,
      charts: prepared.charts,
      actions: prepared.actions,
      notices: prepared.notices,
      freshness: prepared.freshness,
      evaluations: [],
      deliveryGate: "pass",
      generationMode: prepared.generationMode,
      provenance: {
        workflowId: prepared.workflowId,
        workflowVersion: "3.0.0",
        workflowRunId: prepared.workflowRunId,
        model: "gpt-4o",
        toolExecutionIds: [completedTool.executionId],
        factIds: prepared.facts.map(({ factId }) => factId),
        policyVersion: context.policyVersion
      }
    };
    const scoring = scoreV3ResponseForDelivery({
      route: invocation.route,
      context,
      requestMessage: QUERY,
      response,
      tools: [{
        envelope: completedTool,
        arguments: { query: QUERY }
      }],
      factDisplays: prepared.renderableFacts.map(({
        alias,
        fact,
        display,
        meaning,
        required,
        semanticRoles,
        requiredCitationAlias,
        projectionIntegrity
      }) => {
        if (projectionIntegrity === undefined) {
          throw new Error("projection signature is missing");
        }
        return {
          alias,
          factId: fact.factId,
          display,
          meaning,
          required,
          semanticRoles: semanticRoles ?? [],
          ...(requiredCitationAlias === undefined
            ? {}
            : { requiredCitationAlias }),
          projectionIntegrity
        };
      }),
      signer,
      evaluatedAt: NOW
    });
    if (!scoring.passed) {
      throw new Error(JSON.stringify(scoring.results));
    }

    generate.mockResolvedValueOnce({
      object: {
        claims: [{
          claimId: "missing-required-education-evidence",
          locale: "az-AZ",
          textTemplate: "{{E1}}",
          factRefs: ["E1"],
          citationRefs: [],
          limitations: []
        }]
      }
    });
    const incompleteRun = await workflow.createRun({
      resourceId: context.principalRef
    });
    const incompleteResult = await incompleteRun.start({
      inputData: {
        message: invocation.message,
        contextToken: "education-context-token-is-long-enough"
      }
    });

    expect(incompleteResult.status).toBe("success");
    if (incompleteResult.status !== "success") {
      throw new Error("education fail-closed workflow failed");
    }
    expect(incompleteResult.result).toMatchObject({
      status: "unavailable",
      generationMode: "deterministic-fallback",
      facts: [],
      citations: [],
      claims: []
    });
    expect(incompleteResult.result.message).toContain(
      "izahı təhlükəsiz şəkildə yarada bilmədim"
    );
    expect(incompleteResult.result.message).not.toContain(approvedProposition);
  });
});
