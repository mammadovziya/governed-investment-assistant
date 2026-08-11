import type { Agent } from "@mastra/core/agent";
import { describe, expect, it, vi } from "vitest";

import type { TrustedRequestContext } from "../src/assistant-v3/contracts.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import { sealRenderableFact } from "../src/assistant-v3/rendering.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";
import {
  createAssistantV3Workflows,
  type V3CapabilityBundle,
  type V3WorkflowDependencies,
  type V3WorkflowInvocation
} from "../src/assistant-v3/workflows.js";

const NOW = Date.parse("2026-07-22T08:00:00.000Z");

function context(): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-conversation-slots",
    sessionId: "session-conversation-slots",
    conversationId: "conversation-slots",
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
    consentScopes: ["assistant_use", "public_market_data"],
    entitlementVersion: "entitlement-v1",
    entitlements: ["assistant_access", "market_read", "research_read"],
    policyVersion: "3.0.0",
    capabilities: ["market-read", "research-read"],
    featureSnapshot: { version: "feature-v1", flags: {} }
  };
}

describe("V3 conversational workflow composition", () => {
  it("runs the writer for a narrow research facet and permits optional slots to be omitted", async () => {
    const serviceSigner = new DevHmacSigner({
      keyId: "conversation-slots",
      secret: "conversation-slot-test-secret-is-long-enough"
    });
    const evidence = new EvidenceFactory({ signer: serviceSigner, now: () => NOW });
    const trustedContext = context();
    const invocation = {
      message: "What is NVDA's P/E?",
      context: trustedContext,
      session: {},
      policy: {},
      route: {
        kind: "capability",
        route: "company_research",
        mvpFunction: null,
        researchFacet: "pe",
        boundary: null,
        locale: "en-US",
        symbols: ["NVDA"],
        confidence: 1,
        reasonCodes: ["test"],
        requiresPortfolio: false,
        requiresMarketData: true,
        requiresKnowledge: false,
        readOnly: true
      }
    } as unknown as V3WorkflowInvocation;
    const generate = vi.fn(async () => ({
      object: {
        claims: [{
          claimId: "natural-pe-answer",
          textTemplate: "The key valuation measure is {{REQUIRED_PE}}.",
          factRefs: ["REQUIRED_PE"],
          citationRefs: [] as string[],
          limitations: []
        }]
      }
    }));
    const agent = { generate } as unknown as Agent;
    const acquirePublic = async (
      received: V3WorkflowInvocation,
      workflowRunId: string
    ): Promise<V3CapabilityBundle> => {
      const tool = evidence.toolSuccess({
        requestId: trustedContext.requestId,
        workflowRunId,
        toolId: "read-instrument-research",
        toolVersion: "1.0.0",
        arguments: { symbol: "NVDA" },
        result: {
          symbol: "NVDA",
          trailingPe: decimal("42.50"),
          forwardPe: decimal("35.25")
        },
        source: {
          provider: "test",
          sourceId: "research:NVDA",
          sourceUrl: null,
          licenseClass: "synthetic",
          observedAt: new Date(NOW).toISOString(),
          sourceAsOf: new Date(NOW).toISOString()
        }
      });
      const signedFact = evidence.fact({
        requestId: trustedContext.requestId,
        workflowRunId,
        kind: "market.company-research.pe",
        subject: { type: "instrument", ref: "NVDA" },
        asOf: new Date(NOW).toISOString(),
        value: {
          trailingPe: decimal("42.50"),
          forwardPe: decimal("35.25")
        },
        provenance: {
          toolExecutionIds: [tool.executionId],
          inputFactIds: [],
          calculation: null
        }
      });
      return {
        invocation: received,
        workflowId: "public-research-v3",
        workflowRunId,
        status: "complete",
        tools: [tool],
        toolArguments: [{
          executionId: tool.executionId,
          arguments: { symbol: "NVDA" }
        }],
        facts: [signedFact],
        citations: [
          {
            citationId: "optional-citation",
            sourceId: "optional-source",
            title: "Optional source",
            url: "https://example.test/optional",
            sourceAsOf: new Date(NOW).toISOString(),
            effectiveFrom: null,
            effectiveTo: null,
            contentHash: "a".repeat(64)
          },
          {
            citationId: "optional-citation-2",
            sourceId: "optional-source-2",
            title: "Second optional source",
            url: "https://example.test/optional-2",
            sourceAsOf: new Date(NOW).toISOString(),
            effectiveFrom: null,
            effectiveTo: null,
            contentHash: "b".repeat(64)
          }
        ],
        cards: [{
          cardId: "card-pe",
          kind: "research",
          title: "NVDA valuation",
          factRefs: [signedFact.factId],
          data: signedFact.value
        }],
        charts: [],
        actions: [],
        notices: [],
        freshness: [],
        renderableFacts: [
          sealRenderableFact({
            alias: "REQUIRED_PE",
            fact: signedFact,
            meaning: "the verified trailing valuation multiple",
            required: true,
            display: "trailing P/E 42.50"
          }, evidence),
          sealRenderableFact({
            alias: "OPTIONAL_FORWARD_PE",
            fact: signedFact,
            meaning: "the verified forward valuation multiple",
            required: false,
            display: "forward P/E 35.25"
          }, evidence)
        ],
        renderableCitations: [
          {
            alias: "OPTIONAL_CITATION",
            citation: {
              citationId: "optional-citation",
              sourceId: "optional-source",
              title: "Optional source",
              url: "https://example.test/optional",
              sourceAsOf: new Date(NOW).toISOString(),
              effectiveFrom: null,
              effectiveTo: null,
              contentHash: "a".repeat(64)
            },
            required: false
          },
          {
            alias: "OPTIONAL_CITATION_2",
            citation: {
              citationId: "optional-citation-2",
              sourceId: "optional-source-2",
              title: "Second optional source",
              url: "https://example.test/optional-2",
              sourceAsOf: new Date(NOW).toISOString(),
              effectiveFrom: null,
              effectiveTo: null,
              contentHash: "b".repeat(64)
            },
            required: false
          }
        ],
        fallback: [{
          claimId: "fallback-pe",
          locale: "en-US",
          textTemplate: "{{REQUIRED_PE}} and {{OPTIONAL_FORWARD_PE}}.",
          factRefs: ["REQUIRED_PE", "OPTIONAL_FORWARD_PE"],
          citationRefs: [],
          limitations: []
        }],
        writerGoal: "explain the requested valuation measure",
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
      authorize: unused,
      acquirePublic,
      acquirePortfolio: unused,
      acquireKnowledge: unused,
      prepareOrder: unused,
      confirmOrder: unused,
      deterministicBoundary: unused,
      finalize: unused,
      rememberOrderRun: () => {}
    };
    const workflow = createAssistantV3Workflows(dependencies).publicResearch;
    const run = await workflow.createRun({ resourceId: trustedContext.principalRef });
    const result = await run.start({ inputData: invocation });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("workflow did not complete");
    expect(generate).toHaveBeenCalledOnce();
    expect(result.result.generationMode).toBe("gpt-4o");
    expect(result.result.message).toBe(
      "The key valuation measure is trailing P/E 42.50."
    );
    expect(result.result.claims[0]?.factRefs).toEqual([
      result.result.facts[0]?.factId
    ]);
    expect(result.result.citations).toEqual([]);
    expect(result.result.renderableCitations).toEqual([]);

    generate.mockResolvedValueOnce({
      object: {
        claims: [{
          claimId: "reordered-citations",
          textTemplate:
            "{{REQUIRED_PE}} {{OPTIONAL_CITATION_2}} then {{OPTIONAL_CITATION}}",
          factRefs: ["REQUIRED_PE"],
          citationRefs: ["OPTIONAL_CITATION", "OPTIONAL_CITATION_2"],
          limitations: []
        }]
      }
    });
    const citationRun = await workflow.createRun({
      resourceId: trustedContext.principalRef
    });
    const citationResult = await citationRun.start({ inputData: invocation });
    expect(citationResult.status).toBe("success");
    if (citationResult.status !== "success") {
      throw new Error("citation workflow did not complete");
    }
    expect(citationResult.result.message).toBe(
      "trailing P/E 42.50 [1] then [2]"
    );
    expect(citationResult.result.citations.map(({ citationId }) => citationId)).toEqual([
      "optional-citation-2",
      "optional-citation"
    ]);

    generate.mockResolvedValueOnce({
      object: {
        claims: [{
          claimId: "missing-required-slot",
          textTemplate: "A secondary measure is {{OPTIONAL_FORWARD_PE}}.",
          factRefs: ["OPTIONAL_FORWARD_PE"],
          citationRefs: [],
          limitations: []
        }]
      }
    });
    const fallbackRun = await workflow.createRun({
      resourceId: trustedContext.principalRef
    });
    const fallbackResult = await fallbackRun.start({ inputData: invocation });

    expect(fallbackResult.status).toBe("success");
    if (fallbackResult.status !== "success") {
      throw new Error("fallback workflow did not complete");
    }
    expect(fallbackResult.result.generationMode).toBe("deterministic-fallback");
    expect(fallbackResult.result.message).toBe(
      "trailing P/E 42.50 and forward P/E 35.25."
    );
  });
});
