import { Mastra } from "@mastra/core/mastra";
import { describe, expect, it } from "vitest";

import type {
  AssistantResponse,
  TrustedRequestContext,
} from "../src/assistant-v3/contracts.js";
import {
  V3_MASTRA_RESPONSE_SCORER_METADATA,
  createV3MastraResponseScorers,
  v3MastraAssistantResponseSchema,
  v3MastraResponseScorerInputSchema,
  type V3MastraResponseScorerInput,
} from "../src/assistant-v3/mastra-scorers.js";
import {
  V3_BLOCKING_RESPONSE_SCORER_IDS,
  scoreV3CitationIntegrity,
  scoreV3ConversationalQuality,
  scoreV3FactDerivation,
  scoreV3MaterialClaimLineage,
  scoreV3NavigationIntegrity,
  scoreV3NumericDateGrounding,
  scoreV3RequiredToolSet,
  scoreV3ToolEnvelopeIntegrity,
  type V3BlockingResponseScorerId,
  type V3ResponseScoringInput,
} from "../src/assistant-v3/response-scorers.js";
import { routeKnownV3Capability } from "../src/assistant-v3/routing.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";

const EVALUATED_AT = "2026-07-22T12:00:01.000Z";

function signer(): DevHmacSigner {
  return new DevHmacSigner({
    keyId: "native-mastra-scorer-test-key",
    secret: "native-mastra-scorer-test-secret-is-long-enough",
  });
}

function context(): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-native-scorer-1",
    sessionId: "session-native-scorer-1",
    conversationId: "conversation-native-scorer-1",
    principalRef: "principal:native-scorer-test",
    tenantRef: "tenant:demo-invest-test",
    locale: "en-US",
    jurisdiction: "AZ",
    channel: "test",
    environment: "test",
    requestedAt: "2026-07-22T12:00:00.000Z",
    authentication: {
      strength: "authenticated",
      authContextRef: "auth:native-scorer-test",
    },
    consentVersion: "consent-v1",
    consentScopes: ["assistant_use"],
    entitlementVersion: "entitlement-v1",
    entitlements: ["assistant_access"],
    policyVersion: "3.0.0",
    capabilities: ["education-read"],
    featureSnapshot: {
      version: "features-v1",
      flags: {},
    },
  };
}

function response(): AssistantResponse {
  const request = context();
  return {
    schemaVersion: "assistant-v3.response.v1",
    requestId: request.requestId,
    conversationId: request.conversationId,
    status: "unavailable",
    message: "I can explain diversification once the education source is available.",
    claims: [],
    facts: [],
    citations: [],
    cards: [],
    charts: [],
    actions: [],
    notices: [],
    freshness: [],
    evaluations: [],
    deliveryGate: "pass",
    generationMode: "deterministic",
    provenance: {
      workflowId: "assistant-request-v3",
      workflowVersion: "3.0.0",
      workflowRunId: "workflow-native-scorer-1",
      model: null,
      toolExecutionIds: [],
      factIds: [],
      policyVersion: "3.0.0",
    },
  };
}

function nativeInput(): V3MastraResponseScorerInput {
  return {
    route: routeKnownV3Capability({
      route: "conversation",
      locale: "en-US",
      reasonCode: "native_scorer_test_route",
    }),
    context: context(),
    tools: [],
    inputFacts: [],
    factDisplays: [],
    evaluatedAt: EVALUATED_AT,
  };
}

const DIRECT_EVALUATORS = {
  "v3.response.required-tool-set": scoreV3RequiredToolSet,
  "v3.response.tool-envelope-integrity": scoreV3ToolEnvelopeIntegrity,
  "v3.response.fact-derivation": scoreV3FactDerivation,
  "v3.response.material-claim-lineage": scoreV3MaterialClaimLineage,
  "v3.response.navigation-integrity": scoreV3NavigationIntegrity,
  "v3.response.citation-integrity": scoreV3CitationIntegrity,
  "v3.response.numeric-date-grounding": scoreV3NumericDateGrounding,
  "v3.response.conversational-quality": scoreV3ConversationalQuality,
} as const satisfies Readonly<
  Record<
    V3BlockingResponseScorerId,
    (input: V3ResponseScoringInput) => ReturnType<typeof scoreV3RequiredToolSet>
  >
>;

describe("native Mastra V3 response scorer adapters", () => {
  it("publishes exactly the deterministic P0 scorer catalog with useful metadata", () => {
    const adapters = createV3MastraResponseScorers({ signer: signer() });

    expect(Object.keys(adapters)).toEqual(V3_BLOCKING_RESPONSE_SCORER_IDS);
    expect(V3_MASTRA_RESPONSE_SCORER_METADATA.map(({ id }) => id)).toEqual(
      V3_BLOCKING_RESPONSE_SCORER_IDS,
    );
    for (const metadata of V3_MASTRA_RESPONSE_SCORER_METADATA) {
      const scorer = adapters[metadata.id];
      expect(scorer.id).toBe(metadata.id);
      expect(scorer.name).toBe(metadata.name);
      expect(scorer.description).toBe(metadata.description);
      expect(scorer.judge).toBeUndefined();
      expect(scorer.getSteps().map(({ name }) => name)).toEqual([
        "analyze",
        "generateScore",
        "generateReason",
      ]);
      expect(metadata).toMatchObject({
        scorerVersion: "3.0.0",
        adapterVersion: "1.0.0",
        implementation: "deterministic-function",
        priority: "P0",
        nativePassScore: 1,
        nativeNonPassScore: 0,
        authoritativeDeliveryGate: false,
      });
    }
  });

  it("matches every authoritative deterministic function without treating N/A as pass", async () => {
    const serviceSigner = signer();
    const adapters = createV3MastraResponseScorers({ signer: serviceSigner });
    const input = nativeInput();
    const output = response();
    const authoritativeInput = {
      ...input,
      response: output,
      signer: serviceSigner,
    } as unknown as V3ResponseScoringInput;

    for (const scorerId of V3_BLOCKING_RESPONSE_SCORER_IDS) {
      const expected = DIRECT_EVALUATORS[scorerId](authoritativeInput);
      const result = await adapters[scorerId].run({ input, output });

      expect(result.analyzeStepResult).toMatchObject({
        adapterVersion: "1.0.0",
        scorerId,
        scorerVersion: expected.scorerVersion,
        status: expected.status,
        applicable: expected.applicable,
        passed: expected.passed,
        deterministicScore: expected.score,
        reasonCodes: expected.reasonCodes,
        priority: "P0",
        authoritativeDeliveryGate: false,
      });
      expect(result.score).toBe(expected.status === "pass" ? 1 : 0);
      expect(result.reason).toContain(`${expected.status}:`);
      expect(result.reason).toContain("delivery gate remains authoritative");
    }

    const notApplicable = await adapters["v3.response.required-tool-set"].run({
      input,
      output,
    });
    const notApplicableAnalysis = notApplicable.analyzeStepResult;
    if (notApplicableAnalysis === undefined) {
      throw new Error("The native scorer did not return analysis metadata.");
    }
    expect(notApplicableAnalysis.status).toBe("not_applicable");
    expect(notApplicableAnalysis.deterministicScore).toBeNull();
    expect(notApplicable.score).toBe(0);
  });

  it("reports a conversational failure deterministically and never invokes a judge", async () => {
    const adapters = createV3MastraResponseScorers({ signer: signer() });
    const output = {
      ...response(),
      status: "complete" as const,
      message: "DETERMINISTIC RESPONSE",
    };
    const result = await adapters["v3.response.conversational-quality"].run({
      input: nativeInput(),
      output,
    });

    expect(result.score).toBe(0);
    expect(result.analyzeStepResult).toMatchObject({
      status: "fail",
      applicable: true,
      passed: false,
      deterministicScore: 0,
      reasonCodes: ["response_exposes_internal_or_machine_labels"],
    });
  });

  it("uses explicit schemas and keeps the signer outside the serializable input", () => {
    const input = nativeInput();
    expect(v3MastraResponseScorerInputSchema.safeParse(input).success).toBe(true);
    expect(v3MastraAssistantResponseSchema.safeParse(response()).success).toBe(true);
    expect(
      v3MastraAssistantResponseSchema.safeParse({
        ...response(),
        cards: [{
          cardId: "card-activity-1",
          kind: "activity",
          title: "Recent trading activity",
          factRefs: [],
          data: { returnedCount: 6, records: [] }
        }]
      }).success
    ).toBe(true);
    expect(
      v3MastraResponseScorerInputSchema.safeParse({
        ...input,
        signer: signer(),
      }).success,
    ).toBe(false);
    expect(
      v3MastraResponseScorerInputSchema.safeParse({
        ...input,
        maxToolAgeMsByTool: { "unreviewed-tool": 1_000 },
      }).success,
    ).toBe(false);
    expect(v3MastraAssistantResponseSchema.safeParse({ message: "hello" }).success).toBe(
      false,
    );
  });

  it("can be passed directly to Mastra so Studio can list the complete response scorer catalog", () => {
    const scorers = createV3MastraResponseScorers({ signer: signer() });
    const mastra = new Mastra({ scorers, logger: false });
    const registered = mastra.listScorers();

    expect(Object.keys(registered ?? {})).toEqual(V3_BLOCKING_RESPONSE_SCORER_IDS);
    for (const scorerId of V3_BLOCKING_RESPONSE_SCORER_IDS) {
      expect(registered?.[scorerId]).toBe(scorers[scorerId]);
    }
  });
});
