import { createScorer } from "@mastra/core/evals";
import { z } from "zod/v4";

import type { AssistantResponse } from "./contracts.js";
import { V3_APPROVED_BOUNDARY_TOOL_IDS } from "./policy.js";
import { RENDERABLE_SEMANTIC_ROLES } from "./rendering.js";
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
} from "./response-scorers.js";
import {
  V3_ADDITIONAL_CAPABILITIES,
  V3_MVP_FUNCTIONS,
  V3_RESEARCH_FACETS,
} from "./routing.js";
import { v3ErrorScore, type V3ScorerResult } from "./scorers.js";
import type { DevHmacSigner } from "./signing.js";

const V3_MASTRA_SCORER_ADAPTER_VERSION = "1.0.0" as const;
const V3_FUNCTIONS = [
  ...V3_MVP_FUNCTIONS,
  ...V3_ADDITIONAL_CAPABILITIES,
] as const;

const boundedString = z.string().min(1).max(4_096);
const identifier = z.string().min(1).max(256);
const timestamp = z.string().datetime({ offset: true });
const decimalString = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u);
const sha256 = z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/iu);

const signatureSchema = z
  .object({
    algorithm: z.literal("HS256"),
    keyId: identifier,
    protectedHeader: boundedString,
    payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/iu),
    signature: boundedString,
  })
  .strict();

const integritySchema = z
  .object({
    canonicalization: z.literal("jcs-compatible-v1"),
    signature: signatureSchema,
  })
  .strict();

const toolSourceSchema = z
  .object({
    provider: identifier,
    sourceId: boundedString,
    sourceUrl: z.string().nullable(),
    licenseClass: z.enum([
      "public-indicative",
      "licensed",
      "project-internal",
      "synthetic",
    ]),
    observedAt: timestamp,
    sourceAsOf: timestamp,
  })
  .strict();

const toolExecutionEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("assistant-v3.tool-execution.v1"),
    executionId: identifier,
    requestId: identifier,
    workflowRunId: identifier,
    toolId: identifier,
    toolVersion: identifier,
    status: z.enum(["success", "unavailable", "rejected", "error"]),
    startedAt: timestamp,
    completedAt: timestamp,
    argumentsHash: z.string().regex(/^sha256:[a-f0-9]{64}$/iu),
    resultHash: z.string().regex(/^sha256:[a-f0-9]{64}$/iu).nullable(),
    result: z.unknown().nullable(),
    error: z
      .object({
        code: identifier,
        message: boundedString,
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
    source: toolSourceSchema,
    integrity: integritySchema,
  })
  .strict();

const factEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("assistant-v3.fact.v1"),
    factId: identifier,
    requestId: identifier,
    workflowRunId: identifier,
    kind: identifier,
    subject: z
      .object({
        type: z.enum(["portfolio", "instrument", "product", "order-handoff"]),
        ref: boundedString,
      })
      .strict(),
    asOf: timestamp,
    createdAt: timestamp,
    value: z.unknown(),
    provenance: z
      .object({
        toolExecutionIds: z.array(identifier).max(128),
        inputFactIds: z.array(identifier).max(128),
        calculation: z
          .object({
            id: identifier,
            version: identifier,
            formulaId: identifier,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    quality: z
      .object({
        status: z.enum(["complete", "partial", "unavailable"]),
        coverage: decimalString,
        flags: z.array(boundedString).max(128),
      })
      .strict(),
    integrity: integritySchema,
  })
  .strict();

const trustedRequestContextSchema = z
  .object({
    schemaVersion: z.literal("assistant-v3.request-context.v1"),
    requestId: identifier,
    sessionId: identifier,
    conversationId: identifier,
    principalRef: identifier,
    tenantRef: identifier,
    locale: z.enum(["en-US", "az-AZ"]),
    jurisdiction: z.literal("AZ"),
    channel: z.enum(["web", "mobile", "mastra-studio", "test"]),
    environment: z.enum(["development", "test", "staging", "production"]),
    requestedAt: timestamp,
    authentication: z
      .object({
        strength: z.enum(["authenticated", "step_up"]),
        authContextRef: identifier,
      })
      .strict(),
    consentVersion: identifier,
    consentScopes: z.array(identifier).max(128),
    entitlementVersion: identifier,
    entitlements: z.array(identifier).max(128),
    policyVersion: identifier,
    capabilities: z.array(identifier).max(128),
    featureSnapshot: z
      .object({
        version: identifier,
        flags: z.record(z.string().min(1).max(128), z.boolean()),
      })
      .strict(),
  })
  .strict();

const routeDecisionSchema = z
  .object({
    kind: z.enum(["mvp", "capability", "boundary", "clarify"]),
    route: z.enum(V3_FUNCTIONS).nullable(),
    mvpFunction: z.enum(V3_MVP_FUNCTIONS).nullable(),
    researchFacet: z.enum(V3_RESEARCH_FACETS).nullable(),
    boundary: z
      .enum(["order_execution", "sensitive_support", "prompt_injection"])
      .nullable(),
    locale: z.enum(["az-AZ", "en-US"]),
    symbols: z
      .array(z.string().regex(/^[A-Z]{1,5}(?:\.[A-Z])?$/u))
      .max(2),
    confidence: z.number().min(0).max(1),
    reasonCodes: z.array(identifier).max(64),
    requiresPortfolio: z.boolean(),
    requiresMarketData: z.boolean(),
    requiresKnowledge: z.boolean(),
    readOnly: z.boolean(),
  })
  .strict();

const claimDraftSchema = z
  .object({
    claimId: identifier,
    locale: z.enum(["en-US", "az-AZ"]),
    textTemplate: z.string().min(1).max(4_096),
    factRefs: z.array(identifier).max(128),
    citationRefs: z.array(identifier).max(128),
    limitations: z.array(boundedString).max(128),
  })
  .strict();

const citationSchema = z
  .object({
    citationId: identifier,
    sourceId: boundedString,
    title: boundedString,
    url: z.string().url(),
    sourceAsOf: timestamp,
    effectiveFrom: timestamp.nullable(),
    effectiveTo: timestamp.nullable(),
    contentHash: sha256,
  })
  .strict();

const cardSchema = z
  .object({
    cardId: identifier,
    kind: z.enum([
      "market",
      "portfolio",
      "allocation",
      "performance",
      "knowledge",
      "research",
      "decision-support",
      "position-analysis",
      "fee",
      "activity",
      "order-preview",
    ]),
    title: boundedString,
    factRefs: z.array(identifier).max(128),
    data: z.unknown(),
  })
  .strict();

const chartSchema = z
  .object({
    chartId: identifier,
    symbol: z.string().regex(/^[A-Z]{1,5}(?:\.[A-Z])?$/u),
    range: z.enum(["1d", "1w", "1m", "6m", "1y", "5y", "10y", "max"]),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    asOf: timestamp,
    source: boundedString,
    points: z
      .array(
        z
          .object({
            timestamp,
            close: decimalString,
          })
          .strict(),
      )
      .max(20_000),
  })
  .strict();

const commandActionSchema = z
  .object({
    actionId: identifier,
    kind: z.enum(["clarify", "open-signed-order-ticket", "open-official-source"]),
    label: boundedString,
    href: z.string().nullable(),
    expiresAt: timestamp.nullable(),
    intentId: z.string().nullable(),
  })
  .strict();

const inAppActionSchema = z
  .object({
    schemaVersion: z.literal("assistant-v3.in-app-navigation-action.v1"),
    actionId: identifier,
    kind: z.literal("open-in-app"),
    target: z.enum([
      "investments.account-opening.guide",
      "investments.funding.guide",
      "investments.share-purchase.guide",
      "investments.withdrawal.guide",
      "investments.price-alerts.create",
    ]),
    label: boundedString,
    href: z.enum([
      "/investments/guides/account-opening",
      "/investments/guides/funding",
      "/investments/guides/share-purchase",
      "/investments/guides/withdrawal",
      "/investments/price-alerts/create",
    ]),
    citationRefs: z.array(identifier).min(1).max(16),
    catalogVersion: identifier,
  })
  .strict();

const readOnlyNavigationActionSchema = z
  .object({
    schemaVersion: z.literal("assistant-v3.read-only-navigation-action.v1"),
    actionId: z.enum([
      "view-portfolio-overview",
      "view-portfolio-cash",
      "view-recent-activity",
      "view-instrument-overview",
    ]),
    kind: z.literal("open-read-only-view"),
    target: z.enum([
      "investments.portfolio.overview",
      "investments.portfolio.cash",
      "investments.portfolio.activity",
      "investments.instrument.overview",
    ]),
    label: boundedString,
    href: z.enum([
      "/investments/portfolio",
      "/investments/portfolio/cash",
      "/investments/activity",
      "/investments/instruments",
    ]),
    factRefs: z.tuple([identifier]),
    catalogVersion: z.literal(
      "governed-investment-read-only-navigation-2026-07-29.v1",
    ),
  })
  .strict();

const actionSchema = z.union([
  commandActionSchema,
  inAppActionSchema,
  readOnlyNavigationActionSchema,
]);

const freshnessSchema = z
  .object({
    sourceId: boundedString,
    asOf: timestamp,
    status: z.enum(["live", "delayed", "indicative", "stale", "document-effective"]),
    delayMinutes: decimalString.nullable(),
  })
  .strict();

const evaluationSchema = z
  .object({
    scorerId: identifier,
    status: z.enum(["pass", "fail", "not_applicable", "error"]),
    passed: z.boolean(),
    score: z.union([z.literal(0), z.literal(1)]).nullable(),
    reasonCodes: z.array(identifier).max(256),
  })
  .strict();

/**
 * The finalized response shape scored by every native adapter. This explicit
 * schema makes the Studio scorer form useful and prevents an arbitrary agent
 * string from being mistaken for a composed, evidence-bearing V3 response.
 */
export const v3MastraAssistantResponseSchema: z.ZodType<AssistantResponse> = z
  .object({
    schemaVersion: z.literal("assistant-v3.response.v1"),
    requestId: identifier,
    conversationId: identifier,
    status: z.enum(["complete", "partial", "unavailable", "clarification-required"]),
    message: z.string().max(8_192),
    claims: z.array(claimDraftSchema).max(256),
    facts: z.array(factEnvelopeSchema).max(512),
    citations: z.array(citationSchema).max(256),
    cards: z.array(cardSchema).max(128),
    charts: z.array(chartSchema).max(32),
    actions: z.array(actionSchema).max(32),
    notices: z.array(boundedString).max(128),
    freshness: z.array(freshnessSchema).max(128),
    evaluations: z.array(evaluationSchema).max(128),
    deliveryGate: z.enum(["pass", "blocked"]),
    generationMode: z.enum([
      "gpt-4o",
      "gpt-4.1",
      "deterministic-fallback",
      "deterministic",
    ]),
    provenance: z
      .object({
        workflowId: identifier,
        workflowVersion: identifier,
        workflowRunId: identifier,
        model: z.enum(["gpt-4o", "gpt-4.1"]).nullable(),
        toolExecutionIds: z.array(identifier).max(128),
        factIds: z.array(identifier).max(512),
        policyVersion: identifier,
      })
      .strict(),
  })
  .strict() as unknown as z.ZodType<AssistantResponse>;

const maxToolAgeByToolSchema = z
  .record(z.string().min(1).max(128), z.number().finite().positive())
  .superRefine((record, context) => {
    const approved = new Set<string>(V3_APPROVED_BOUNDARY_TOOL_IDS);
    for (const key of Object.keys(record)) {
      if (!approved.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Unknown boundary tool freshness key: ${key}`,
          path: [key],
        });
      }
    }
  });

/**
 * Evidence supplied alongside the response. The signer is deliberately absent:
 * it stays in the server-side adapter closure and can never be entered in or
 * returned from the Studio scorer form.
 */
export type V3MastraResponseScorerInput = Omit<
  V3ResponseScoringInput,
  "response" | "signer"
>;

export const v3MastraResponseScorerInputSchema: z.ZodType<V3MastraResponseScorerInput> = z
  .object({
    route: routeDecisionSchema,
    context: trustedRequestContextSchema,
    requestMessage: z.string().min(1).max(2_000).optional(),
    tools: z
      .array(
        z
          .object({
            envelope: toolExecutionEnvelopeSchema,
            arguments: z.unknown(),
            maxAgeMs: z.number().finite().positive().optional(),
          })
          .strict(),
      )
      .max(128),
    inputFacts: z.array(factEnvelopeSchema).max(512).optional(),
    factDisplays: z
      .array(
        z
          .object({
            alias: identifier,
            factId: identifier,
            display: z.string().min(1).max(8_192),
            meaning: z.string().min(1).max(8_192),
            required: z.boolean(),
            semanticRoles: z.array(z.enum(RENDERABLE_SEMANTIC_ROLES)).max(16),
            requiredCitationAlias: identifier.optional(),
            projectionIntegrity: integritySchema,
          })
          .strict(),
      )
      .max(512)
      .optional(),
    evaluatedAt: z.union([z.number().finite(), timestamp]).optional(),
    defaultToolMaxAgeMs: z.number().finite().positive().optional(),
    maxToolAgeMsByTool: maxToolAgeByToolSchema.optional(),
    futureClockSkewMs: z.number().finite().nonnegative().optional(),
  })
  .strict() as unknown as z.ZodType<V3MastraResponseScorerInput>;

export interface V3MastraResponseScorerAnalysis {
  readonly adapterVersion: typeof V3_MASTRA_SCORER_ADAPTER_VERSION;
  readonly scorerId: V3BlockingResponseScorerId;
  readonly scorerVersion: "3.0.0";
  readonly status: V3ScorerResult["status"];
  readonly applicable: boolean;
  readonly passed: boolean;
  readonly deterministicScore: 0 | 1 | null;
  readonly reasonCodes: readonly string[];
  readonly priority: "P0";
  /** These native scorers mirror the gate; scoreV3ResponseForDelivery remains authoritative. */
  readonly authoritativeDeliveryGate: false;
}

interface V3MastraScorerDefinition<TId extends V3BlockingResponseScorerId> {
  readonly id: TId;
  readonly name: string;
  readonly description: string;
  readonly evaluate: (input: V3ResponseScoringInput) => V3ScorerResult;
}

const DEFINITIONS = {
  "v3.response.required-tool-set": {
    id: "v3.response.required-tool-set",
    name: "Required route tool coverage",
    description:
      "Deterministically verifies that every tool required by the selected V3 route and symbol scope is present.",
    evaluate: scoreV3RequiredToolSet,
  },
  "v3.response.tool-envelope-integrity": {
    id: "v3.response.tool-envelope-integrity",
    name: "Signed tool envelope integrity",
    description:
      "Deterministically verifies approved tool IDs, exact argument hashes, signatures, provenance, and freshness.",
    evaluate: scoreV3ToolEnvelopeIntegrity,
  },
  "v3.response.fact-derivation": {
    id: "v3.response.fact-derivation",
    name: "Signed fact derivation",
    description:
      "Deterministically verifies fact signatures and complete tool-to-fact ancestry.",
    evaluate: scoreV3FactDerivation,
  },
  "v3.response.material-claim-lineage": {
    id: "v3.response.material-claim-lineage",
    name: "Material claim lineage",
    description:
      "Deterministically verifies that material claims and cards reference present, unique facts and required citations.",
    evaluate: scoreV3MaterialClaimLineage,
  },
  "v3.response.navigation-integrity": {
    id: "v3.response.navigation-integrity",
    name: "Read-only navigation integrity",
    description:
      "Deterministically reauthorizes fact-bound local navigation and verifies its exact route, label, target, card, and signed fact lineage.",
    evaluate: scoreV3NavigationIntegrity,
  },
  "v3.response.citation-integrity": {
    id: "v3.response.citation-integrity",
    name: "Citation eligibility and integrity",
    description:
      "Deterministically verifies citation eligibility, effective dates, content hashes, and signed evidence lineage.",
    evaluate: scoreV3CitationIntegrity,
  },
  "v3.response.numeric-date-grounding": {
    id: "v3.response.numeric-date-grounding",
    name: "Numeric and date grounding",
    description:
      "Deterministically verifies that exact numbers, dates, cards, and chart values come from signed facts or tool evidence.",
    evaluate: scoreV3NumericDateGrounding,
  },
  "v3.response.conversational-quality": {
    id: "v3.response.conversational-quality",
    name: "Conversational response quality",
    description:
      "Deterministically checks concise human-readable chat style and rejects internal or machine-report labels.",
    evaluate: scoreV3ConversationalQuality,
  },
} as const satisfies {
  readonly [TId in V3BlockingResponseScorerId]: V3MastraScorerDefinition<TId>;
};

/** Studio-facing catalog metadata; no model or judge is configured. */
export const V3_MASTRA_RESPONSE_SCORER_METADATA = Object.freeze(
  V3_BLOCKING_RESPONSE_SCORER_IDS.map((id) =>
    Object.freeze({
      id,
      name: DEFINITIONS[id].name,
      description: DEFINITIONS[id].description,
      scorerVersion: "3.0.0" as const,
      adapterVersion: V3_MASTRA_SCORER_ADAPTER_VERSION,
      implementation: "deterministic-function" as const,
      priority: "P0" as const,
      nativePassScore: 1 as const,
      nativeNonPassScore: 0 as const,
      authoritativeDeliveryGate: false as const,
    }),
  ),
);

function analysisFor(
  expectedId: V3BlockingResponseScorerId,
  result: V3ScorerResult,
): V3MastraResponseScorerAnalysis {
  const invariantValid = result.scorerVersion === "3.0.0" && (
    (result.status === "pass" &&
      result.applicable &&
      result.passed &&
      result.score === 1) ||
    (result.status === "fail" &&
      result.applicable &&
      !result.passed &&
      result.score === 0) ||
    ((result.status === "not_applicable" || result.status === "error") &&
      !result.applicable &&
      !result.passed &&
      result.score === null)
  );
  const safeResult = result.scorerId === expectedId && invariantValid
    ? result
    : v3ErrorScore(
      expectedId,
      result.scorerId === expectedId
        ? "native_adapter_result_invariant_invalid"
        : "native_adapter_scorer_id_mismatch",
    );
  return Object.freeze({
    adapterVersion: V3_MASTRA_SCORER_ADAPTER_VERSION,
    scorerId: expectedId,
    scorerVersion: safeResult.scorerVersion,
    status: safeResult.status,
    applicable: safeResult.applicable,
    passed: safeResult.passed,
    deterministicScore: safeResult.score,
    reasonCodes: Object.freeze([...safeResult.reasonCodes]),
    priority: "P0",
    authoritativeDeliveryGate: false,
  });
}

function invalidAnalysis(
  scorerId: V3BlockingResponseScorerId,
  reasonCode: string,
): V3MastraResponseScorerAnalysis {
  return analysisFor(scorerId, v3ErrorScore(scorerId, reasonCode));
}

function evaluateNativeRun(
  definition: V3MastraScorerDefinition<V3BlockingResponseScorerId>,
  signer: DevHmacSigner,
  run: { readonly input?: unknown; readonly output: unknown },
): V3MastraResponseScorerAnalysis {
  const parsedInput = v3MastraResponseScorerInputSchema.safeParse(run.input);
  if (!parsedInput.success) {
    return invalidAnalysis(definition.id, "native_adapter_input_invalid");
  }
  const parsedOutput = v3MastraAssistantResponseSchema.safeParse(run.output);
  if (!parsedOutput.success) {
    return invalidAnalysis(definition.id, "native_adapter_output_invalid");
  }
  try {
    const scoringInput = {
      ...parsedInput.data,
      response: parsedOutput.data as unknown as AssistantResponse,
      signer,
    } as unknown as V3ResponseScoringInput;
    return analysisFor(definition.id, definition.evaluate(scoringInput));
  } catch {
    return invalidAnalysis(definition.id, "native_adapter_execution_error");
  }
}

function nativeReason(analysis: V3MastraResponseScorerAnalysis): string {
  const reasons = analysis.reasonCodes.length === 0
    ? "no_reason_code"
    : analysis.reasonCodes.join(", ");
  return `${analysis.status}: ${reasons}. Observability mirror only; the V3 P0 delivery gate remains authoritative.`;
}

function createNativeAdapter<TId extends V3BlockingResponseScorerId>(
  definition: V3MastraScorerDefinition<TId>,
  signer: DevHmacSigner,
) {
  return createScorer({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    type: {
      input: v3MastraResponseScorerInputSchema,
      output: v3MastraAssistantResponseSchema,
    },
  })
    .analyze(({ run }) => evaluateNativeRun(definition, signer, run))
    .generateScore(({ results }) =>
      results.analyzeStepResult.status === "pass" &&
      results.analyzeStepResult.applicable &&
      results.analyzeStepResult.passed &&
      results.analyzeStepResult.deterministicScore === 1
        ? 1
        : 0,
    )
    .generateReason(({ results }) => nativeReason(results.analyzeStepResult));
}

export interface CreateV3MastraResponseScorersInput {
  /** Must be the same signer used to create the response's tool and fact envelopes. */
  readonly signer: DevHmacSigner;
}

/**
 * Creates the complete native response-scorer catalog for registration and
 * Studio visibility.
 * They are observability adapters around the existing scorer functions; they
 * neither call a model nor replace scoreV3ResponseForDelivery in the runtime.
 */
export function createV3MastraResponseScorers(
  input: CreateV3MastraResponseScorersInput,
) {
  return Object.freeze({
    "v3.response.required-tool-set": createNativeAdapter(
      DEFINITIONS["v3.response.required-tool-set"],
      input.signer,
    ),
    "v3.response.tool-envelope-integrity": createNativeAdapter(
      DEFINITIONS["v3.response.tool-envelope-integrity"],
      input.signer,
    ),
    "v3.response.fact-derivation": createNativeAdapter(
      DEFINITIONS["v3.response.fact-derivation"],
      input.signer,
    ),
    "v3.response.material-claim-lineage": createNativeAdapter(
      DEFINITIONS["v3.response.material-claim-lineage"],
      input.signer,
    ),
    "v3.response.navigation-integrity": createNativeAdapter(
      DEFINITIONS["v3.response.navigation-integrity"],
      input.signer,
    ),
    "v3.response.citation-integrity": createNativeAdapter(
      DEFINITIONS["v3.response.citation-integrity"],
      input.signer,
    ),
    "v3.response.numeric-date-grounding": createNativeAdapter(
      DEFINITIONS["v3.response.numeric-date-grounding"],
      input.signer,
    ),
    "v3.response.conversational-quality": createNativeAdapter(
      DEFINITIONS["v3.response.conversational-quality"],
      input.signer,
    ),
  });
}

export type V3MastraResponseScorers = ReturnType<
  typeof createV3MastraResponseScorers
>;
