import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { TracingContext } from "@mastra/core/observability";
import { z } from "zod";
import type {
  AssistantCommandAction,
  AssistantCard,
  AssistantChart,
  AssistantCitation,
  AssistantFreshness,
  AssistantResponse,
  ClaimDraft,
  FactEnvelope,
  ToolExecutionEnvelope,
  TrustedRequestContext
} from "./contracts.js";
import type { EvidenceFactory } from "./evidence.js";
import {
  isV3TrustedPolicyDecision,
  V3_APPROVED_BOUNDARY_TOOL_IDS,
  type V3PolicyDecision
} from "./policy.js";
import type {
  RenderableCitation,
  RenderableFact,
  WriterDraftRejectionReason
} from "./rendering.js";
import { renderClaimDrafts } from "./rendering.js";
import type { V3RouteDecision } from "./routing.js";
import { isV3TrustedSession, type V3TrustedSession } from "./sessions.js";
import { canonicalHash } from "./signing.js";
import {
  generateWriterClaims,
  writerLabelHints,
  writerModelDecision,
  type WriterAgents,
  type WriterCitationView,
  type WriterFactView
} from "./writers.js";
import {
  V3_WRITER_AGENTS,
  type V3FailureReason,
  type V3WriterAgent,
  type V3Workflow,
  type V3TelemetryMetrics
} from "./telemetry.js";

export const V3_WORKFLOW_IDS = [
  "assistant-request-v3",
  "public-research-v3",
  "portfolio-insight-v3",
  "approved-knowledge-v3",
  "order-ticket-handoff-v3"
] as const;

export interface V3WorkflowInvocation {
  message: string;
  context: TrustedRequestContext;
  session: V3TrustedSession;
  policy: V3PolicyDecision;
  route: V3RouteDecision;
}

export interface V3CapabilityBundle {
  invocation: V3WorkflowInvocation;
  workflowId: (typeof V3_WORKFLOW_IDS)[number];
  workflowRunId: string;
  status: AssistantResponse["status"];
  tools: ToolExecutionEnvelope<unknown>[];
  toolArguments: Array<{ executionId: string; arguments: unknown }>;
  facts: FactEnvelope<unknown>[];
  citations: AssistantCitation[];
  cards: AssistantCard[];
  charts: AssistantChart[];
  actions: AssistantResponse["actions"];
  notices: string[];
  freshness: AssistantFreshness[];
  renderableFacts: RenderableFact[];
  renderableCitations: RenderableCitation[];
  fallback: ClaimDraft[];
  writerGoal: string;
  /** Used only for fail-closed unavailable/clarification responses with no facts. */
  deterministicMessage: string | null;
}

export interface V3PreparedResponse extends V3CapabilityBundle {
  message: string;
  claims: ClaimDraft[];
  generationMode: AssistantResponse["generationMode"];
}

export interface V3WorkflowDependencies {
  evidence: EvidenceFactory;
  writers: WriterAgents;
  telemetry?: V3TelemetryMetrics;
  modelTimeoutMs: number;
  authorize(input: { message: string; contextToken: string }): Promise<V3WorkflowInvocation>;
  acquirePublic(invocation: V3WorkflowInvocation, workflowRunId: string): Promise<V3CapabilityBundle>;
  acquirePortfolio(
    invocation: V3WorkflowInvocation,
    workflowRunId: string,
    tracingContext?: TracingContext
  ): Promise<V3CapabilityBundle>;
  acquireKnowledge(
    invocation: V3WorkflowInvocation,
    workflowRunId: string,
    tracingContext?: TracingContext
  ): Promise<V3CapabilityBundle>;
  prepareOrder(invocation: V3WorkflowInvocation, workflowRunId: string): Promise<V3CapabilityBundle>;
  confirmOrder(prepared: V3PreparedResponse, confirmationToken: string): Promise<V3PreparedResponse>;
  deterministicBoundary(invocation: V3WorkflowInvocation, workflowRunId: string): Promise<V3PreparedResponse>;
  finalize(prepared: V3PreparedResponse): Promise<AssistantResponse>;
  rememberOrderRun(
    prepared: V3PreparedResponse,
    runId: string,
    run: { resume(input: { step: string; resumeData: unknown }): Promise<unknown> }
  ): void;
}

const workflowInvocationSchema = z.custom<V3WorkflowInvocation>(
  (value) => typeof value === "object" && value !== null
);
const bundleSchema = z.custom<V3CapabilityBundle>(
  (value) => typeof value === "object" && value !== null
);
const preparedSchema = z.custom<V3PreparedResponse>(
  (value) => typeof value === "object" && value !== null
);
const responseSchema = z.custom<AssistantResponse>(
  (value) => typeof value === "object" && value !== null
);

const ORDER_CONFIRMATION_STEP_ID = "await-explicit-order-confirmation" as const;
const PREPARED_RESPONSE_KEYS = [
  "invocation",
  "workflowId",
  "workflowRunId",
  "status",
  "tools",
  "toolArguments",
  "facts",
  "citations",
  "cards",
  "charts",
  "actions",
  "notices",
  "freshness",
  "renderableFacts",
  "renderableCitations",
  "fallback",
  "writerGoal",
  "deterministicMessage",
  "message",
  "claims",
  "generationMode"
] as const;
const INVOCATION_KEYS = ["message", "context", "session", "policy", "route"] as const;
const CONTEXT_KEYS = [
  "schemaVersion",
  "requestId",
  "sessionId",
  "conversationId",
  "principalRef",
  "tenantRef",
  "locale",
  "jurisdiction",
  "channel",
  "environment",
  "requestedAt",
  "authentication",
  "consentVersion",
  "consentScopes",
  "entitlementVersion",
  "entitlements",
  "policyVersion",
  "capabilities",
  "featureSnapshot"
] as const;
const ROUTE_KEYS = [
  "kind",
  "route",
  "mvpFunction",
  "researchFacet",
  "boundary",
  "locale",
  "symbols",
  "confidence",
  "reasonCodes",
  "requiresPortfolio",
  "requiresMarketData",
  "requiresKnowledge",
  "readOnly"
] as const;
const ACTION_KEYS = ["actionId", "kind", "label", "href", "expiresAt", "intentId"] as const;
const TOOL_KEYS = [
  "schemaVersion",
  "executionId",
  "requestId",
  "workflowRunId",
  "toolId",
  "toolVersion",
  "status",
  "startedAt",
  "completedAt",
  "argumentsHash",
  "resultHash",
  "result",
  "error",
  "source",
  "integrity"
] as const;
const FACT_KEYS = [
  "schemaVersion",
  "factId",
  "requestId",
  "workflowRunId",
  "kind",
  "subject",
  "asOf",
  "createdAt",
  "value",
  "provenance",
  "quality",
  "integrity"
] as const;
const ORDER_PREVIEW_TOOL_IDS = [
  "resolve-instrument",
  "read-market-snapshot",
  "read-order-eligibility"
] as const;

export class V3SuspendPayloadError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "V3SuspendPayloadError";
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value) as object | null;
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactOwnKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") || keys.length !== expected.length) {
    return false;
  }
  const expectedSet = new Set(expected);
  return keys.every((key) => typeof key === "string" && expectedSet.has(key));
}

function nonEmptyString(value: unknown, maximum = 4_096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function stringArray(value: unknown, maximum = 64): value is string[] {
  return Array.isArray(value) && value.length <= maximum &&
    value.every((item) => nonEmptyString(item, 256));
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isTrustedContext(value: unknown): value is TrustedRequestContext {
  if (!plainRecord(value) || !hasExactOwnKeys(value, CONTEXT_KEYS)) return false;
  const authentication = value.authentication;
  const featureSnapshot = value.featureSnapshot;
  return value.schemaVersion === "assistant-v3.request-context.v1" &&
    nonEmptyString(value.requestId, 128) &&
    nonEmptyString(value.sessionId, 128) &&
    nonEmptyString(value.conversationId, 128) &&
    nonEmptyString(value.principalRef, 256) &&
    nonEmptyString(value.tenantRef, 256) &&
    (value.locale === "en-US" || value.locale === "az-AZ") &&
    value.jurisdiction === "AZ" &&
    ["web", "mobile", "mastra-studio", "test"].includes(String(value.channel)) &&
    ["development", "test", "staging", "production"].includes(String(value.environment)) &&
    validTimestamp(value.requestedAt) &&
    plainRecord(authentication) &&
    hasExactOwnKeys(authentication, ["strength", "authContextRef"]) &&
    (authentication.strength === "authenticated" || authentication.strength === "step_up") &&
    nonEmptyString(authentication.authContextRef, 256) &&
    nonEmptyString(value.consentVersion, 256) &&
    stringArray(value.consentScopes) &&
    nonEmptyString(value.entitlementVersion, 256) &&
    stringArray(value.entitlements) &&
    value.policyVersion === "3.0.0" &&
    stringArray(value.capabilities) &&
    plainRecord(featureSnapshot) &&
    hasExactOwnKeys(featureSnapshot, ["version", "flags"]) &&
    nonEmptyString(featureSnapshot.version, 256) &&
    plainRecord(featureSnapshot.flags) &&
    Object.values(featureSnapshot.flags).every((flag) => typeof flag === "boolean");
}

function isOrderPreviewRoute(value: unknown): value is V3RouteDecision {
  if (!plainRecord(value) || !hasExactOwnKeys(value, ROUTE_KEYS)) return false;
  return value.kind === "mvp" &&
    value.route === "order_ticket_preview" &&
    value.mvpFunction === "order_ticket_preview" &&
    value.researchFacet === null &&
    value.boundary === null &&
    (value.locale === "en-US" || value.locale === "az-AZ") &&
    Array.isArray(value.symbols) &&
    value.symbols.length === 1 &&
    value.symbols.every((symbol) =>
      typeof symbol === "string" && /^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(symbol)
    ) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    stringArray(value.reasonCodes) &&
    value.requiresPortfolio === false &&
    value.requiresMarketData === true &&
    value.requiresKnowledge === false &&
    value.readOnly === true;
}

function isTrustedOrderInvocation(value: unknown): value is V3WorkflowInvocation {
  if (!plainRecord(value) || !hasExactOwnKeys(value, INVOCATION_KEYS)) return false;
  if (
    !nonEmptyString(value.message, 2_000) ||
    !isTrustedContext(value.context) ||
    !isV3TrustedSession(value.session) ||
    !isV3TrustedPolicyDecision(value.policy) ||
    !isOrderPreviewRoute(value.route)
  ) {
    return false;
  }
  const { context, session, policy, route } = value;
  return context.locale === route.locale &&
    context.sessionId === session.claims.sessionId &&
    context.tenantRef === session.claims.tenantId &&
    context.principalRef === session.claims.principalId &&
    context.authentication.strength === session.claims.authLevel &&
    context.authentication.authContextRef === session.claims.authContextId &&
    context.consentVersion === session.claims.consentVersion &&
    sameStrings(context.consentScopes, session.claims.consents) &&
    context.entitlementVersion === session.claims.entitlementVersion &&
    sameStrings(context.entitlements, session.claims.entitlements) &&
    context.policyVersion === policy.policyVersion &&
    policy.authorized === true &&
    policy.action === "allow" &&
    policy.route === route.route &&
    policy.routeKind === route.kind &&
    policy.boundary === route.boundary &&
    policy.sessionId === session.claims.sessionId &&
    policy.tenantId === session.claims.tenantId &&
    ORDER_PREVIEW_TOOL_IDS.every((toolId) => policy.allowedToolIds.includes(toolId));
}

function isOrderAction(
  value: unknown
): value is AssistantCommandAction & { kind: "open-signed-order-ticket" } {
  if (!plainRecord(value) || !hasExactOwnKeys(value, ACTION_KEYS)) return false;
  return nonEmptyString(value.actionId, 160) &&
    value.kind === "open-signed-order-ticket" &&
    nonEmptyString(value.label, 256) &&
    value.href === null &&
    validTimestamp(value.expiresAt) &&
    typeof value.intentId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.intentId);
}

function isToolEnvelopeShape(value: unknown): value is ToolExecutionEnvelope<unknown> {
  if (!plainRecord(value) || !hasExactOwnKeys(value, TOOL_KEYS)) return false;
  return value.schemaVersion === "assistant-v3.tool-execution.v1" &&
    nonEmptyString(value.executionId, 128) &&
    nonEmptyString(value.requestId, 128) &&
    nonEmptyString(value.workflowRunId, 128) &&
    typeof value.toolId === "string" &&
    V3_APPROVED_BOUNDARY_TOOL_IDS.includes(
      value.toolId as (typeof V3_APPROVED_BOUNDARY_TOOL_IDS)[number]
    ) &&
    nonEmptyString(value.toolVersion, 64) &&
    value.status === "success" &&
    validTimestamp(value.startedAt) &&
    validTimestamp(value.completedAt) &&
    nonEmptyString(value.argumentsHash, 160) &&
    nonEmptyString(value.resultHash, 160) &&
    value.result !== null &&
    value.error === null &&
    plainRecord(value.source) &&
    plainRecord(value.integrity);
}

function isFactEnvelopeShape(value: unknown): value is FactEnvelope<unknown> {
  if (!plainRecord(value) || !hasExactOwnKeys(value, FACT_KEYS)) return false;
  return value.schemaVersion === "assistant-v3.fact.v1" &&
    nonEmptyString(value.factId, 128) &&
    nonEmptyString(value.requestId, 128) &&
    nonEmptyString(value.workflowRunId, 128) &&
    value.kind === "order-ticket.preview" &&
    plainRecord(value.subject) &&
    value.subject.type === "order-handoff" &&
    nonEmptyString(value.subject.ref, 128) &&
    validTimestamp(value.asOf) &&
    validTimestamp(value.createdAt) &&
    plainRecord(value.provenance) &&
    plainRecord(value.quality) &&
    plainRecord(value.integrity);
}

function isClaimDraftShape(value: unknown): value is ClaimDraft {
  if (!plainRecord(value) || !hasExactOwnKeys(value, [
    "claimId",
    "locale",
    "textTemplate",
    "factRefs",
    "citationRefs",
    "limitations"
  ])) return false;
  return nonEmptyString(value.claimId, 80) &&
    (value.locale === "en-US" || value.locale === "az-AZ") &&
    nonEmptyString(value.textTemplate, 1_000) &&
    stringArray(value.factRefs, 8) &&
    Array.isArray(value.citationRefs) &&
    value.citationRefs.length <= 8 &&
    value.citationRefs.every((item) => typeof item === "string") &&
    Array.isArray(value.limitations) &&
    value.limitations.length <= 4 &&
    value.limitations.every((item) => typeof item === "string");
}

function isStrictSuspendedOrderPrepared(
  value: unknown,
  evidence: EvidenceFactory
): value is V3PreparedResponse {
  if (!plainRecord(value) || !hasExactOwnKeys(value, PREPARED_RESPONSE_KEYS)) return false;
  const invocation = value.invocation;
  if (!isTrustedOrderInvocation(invocation)) return false;
  if (
    value.workflowId !== "order-ticket-handoff-v3" ||
    !nonEmptyString(value.workflowRunId, 128) ||
    value.status !== "complete" ||
    !nonEmptyString(value.writerGoal, 512) ||
    value.deterministicMessage !== null ||
    !nonEmptyString(value.message, 4_000) ||
    !["gpt-4o", "gpt-4.1", "deterministic-fallback"]
      .includes(String(value.generationMode)) ||
    !Array.isArray(value.tools) ||
    !Array.isArray(value.toolArguments) ||
    !Array.isArray(value.facts) ||
    !Array.isArray(value.cards) ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.notices) ||
    !Array.isArray(value.freshness) ||
    !Array.isArray(value.renderableFacts) ||
    !Array.isArray(value.fallback) ||
    !Array.isArray(value.claims) ||
    !Array.isArray(value.citations) || value.citations.length !== 0 ||
    !Array.isArray(value.charts) || value.charts.length !== 0 ||
    !Array.isArray(value.renderableCitations) || value.renderableCitations.length !== 0
  ) {
    return false;
  }

  const tools = value.tools;
  if (
    tools.length !== ORDER_PREVIEW_TOOL_IDS.length ||
    !tools.every(isToolEnvelopeShape) ||
    !tools.every((tool) => evidence.verifyTool(tool)) ||
    !sameStrings(tools.map((tool) => tool.toolId), ORDER_PREVIEW_TOOL_IDS) ||
    !tools.every((tool) =>
      tool.requestId === invocation.context.requestId &&
      tool.workflowRunId === value.workflowRunId
    )
  ) {
    return false;
  }

  if (
    value.toolArguments.length !== tools.length ||
    !value.toolArguments.every((entry, index) => {
      if (!plainRecord(entry) || !hasExactOwnKeys(entry, ["executionId", "arguments"])) {
        return false;
      }
      const tool = tools[index];
      return tool !== undefined &&
        entry.executionId === tool.executionId &&
        canonicalHash(entry.arguments) === tool.argumentsHash;
    })
  ) {
    return false;
  }

  const facts = value.facts;
  if (
    facts.length !== 1 ||
    !facts.every(isFactEnvelopeShape) ||
    !facts.every((fact) => evidence.verifyFact(fact, tools)) ||
    !facts.every((fact) =>
      fact.requestId === invocation.context.requestId &&
      fact.workflowRunId === value.workflowRunId
    )
  ) {
    return false;
  }

  const action = value.actions.length === 1 ? value.actions[0] : undefined;
  const fact = facts[0];
  if (!isOrderAction(action) || !fact || action.intentId !== fact.subject.ref) return false;

  if (
    value.cards.length !== 1 ||
    !plainRecord(value.cards[0]) ||
    value.cards[0].kind !== "order-preview" ||
    !stringArray(value.cards[0].factRefs, 8) ||
    !value.cards[0].factRefs.includes(fact.factId) ||
    !stringArray(value.notices, 16) ||
    value.freshness.length !== 1 ||
    !plainRecord(value.freshness[0]) ||
    !validTimestamp(value.freshness[0].asOf) ||
    value.renderableFacts.length !== 1 ||
    !plainRecord(value.renderableFacts[0]) ||
    value.renderableFacts[0].alias !== "F1" ||
    !plainRecord(value.renderableFacts[0].fact) ||
    value.renderableFacts[0].fact.factId !== fact.factId ||
    !nonEmptyString(value.renderableFacts[0].display, 4_000) ||
    value.fallback.length === 0 ||
    !value.fallback.every(isClaimDraftShape) ||
    value.claims.length === 0 ||
    !value.claims.every(isClaimDraftShape)
  ) {
    return false;
  }
  return true;
}

/**
 * Mastra 1.51+ exposes a workflow suspension as `{ [suspendedStepId]: payload }`.
 * Accept exactly that data-property envelope—no sibling steps, accessors,
 * symbols, arrays, or prototype-bearing instances.
 */
export function extractSingleMastraSuspendPayload<T>(input: {
  suspendPayload: unknown;
  stepId: string;
  parse(value: unknown): T;
}): T {
  if (!plainRecord(input.suspendPayload)) {
    throw new V3SuspendPayloadError("invalid_suspend_envelope", "Suspend payload must be a plain object.");
  }
  const keys = Reflect.ownKeys(input.suspendPayload);
  if (keys.length !== 1 || keys[0] !== input.stepId) {
    throw new V3SuspendPayloadError(
      "invalid_suspend_step",
      `Suspend payload must contain only ${input.stepId}.`
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(input.suspendPayload, input.stepId);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new V3SuspendPayloadError(
      "invalid_suspend_descriptor",
      "Suspend payload must contain an enumerable data property."
    );
  }
  try {
    return input.parse(descriptor.value);
  } catch (error) {
    if (error instanceof V3SuspendPayloadError) throw error;
    throw new V3SuspendPayloadError(
      "invalid_suspend_content",
      "Suspended step content failed strict validation."
    );
  }
}

export function extractSuspendedOrderPreview(
  suspendPayload: unknown,
  evidence: EvidenceFactory
): V3PreparedResponse {
  return extractSingleMastraSuspendPayload({
    suspendPayload,
    stepId: ORDER_CONFIRMATION_STEP_ID,
    parse: (candidate) => {
      try {
        if (!isStrictSuspendedOrderPrepared(candidate, evidence)) {
          throw new V3SuspendPayloadError(
            "invalid_order_preview_suspend_payload",
            "Suspended order preview failed strict validation."
          );
        }
      } catch (error) {
        if (error instanceof V3SuspendPayloadError) throw error;
        throw new V3SuspendPayloadError(
          "invalid_order_preview_suspend_payload",
          "Suspended order preview failed strict validation."
        );
      }
      return candidate;
    }
  });
}

function writerFactViews(bundle: V3CapabilityBundle): WriterFactView[] {
  let educationLabelUsed = false;
  return bundle.renderableFacts.map(({
    alias,
    fact,
    meaning,
    required,
    semanticRoles,
    requiredCitationAlias
  }) => {
    const roles = [...(semanticRoles ?? [])];
    const isEducationSlot = roles.includes("knowledge.education");
    // One education label establishes the discourse. Repeating "key point"
    // before every retrieved proposition makes a model-authored explanation
    // read like a template even though every proposition remains independently
    // required and citation-bound.
    const omitRepeatedEducationLabel =
      isEducationSlot && educationLabelUsed;
    if (isEducationSlot) educationLabelUsed = true;
    return {
      ref: alias,
      kind: fact.kind,
      subjectType: fact.subject.type,
      subjectRef: fact.subject.ref,
      asOfRef: `as-of-${alias}`,
      availability: fact.quality.status,
      required,
      meaning,
      semanticRoles: roles,
      ...(requiredCitationAlias === undefined
        ? {}
        : { requiredCitationRef: requiredCitationAlias }),
      // SOURCE projections are already complete signed source/freshness
      // clauses. Adding another label would create duplicated prose such as
      // "source: Data as of ...; source: ...".
      labelHints:
        /(?:^|_)SOURCE$/u.test(alias) || omitRepeatedEducationLabel
          ? []
          : writerLabelHints(
              roles,
              bundle.invocation.context.locale
            )
    };
  });
}

function writerCitationViews(bundle: V3CapabilityBundle): WriterCitationView[] {
  return bundle.renderableCitations.map(({ alias, citation, required }) => ({
    ref: alias,
    title: citation.title,
    section: citation.sourceId,
    effectiveDateRef: `effective-${alias}`,
    required
  }));
}

function writerRejectionFailureReason(
  reason: WriterDraftRejectionReason
): V3FailureReason {
  if (reason === "claim_exact_value") return "writer_exact_value_rejected";
  if (reason === "claim_semantics_unsupported_vocabulary") {
    return "writer_semantic_vocabulary_rejected";
  }
  if (reason === "claim_semantics_uppercase") {
    return "writer_semantic_uppercase_rejected";
  }
  if (reason === "claim_semantics_language") {
    return "writer_semantic_language_rejected";
  }
  if (reason === "claim_semantics_unsupported_material") {
    return "writer_semantic_material_rejected";
  }
  if (reason === "claim_local_semantics") {
    return "writer_local_semantics_rejected";
  }
  if (
    reason === "claim_references" ||
    reason === "citation_missing" ||
    reason === "claim_placeholder_remaining" ||
    reason === "fact_display_missing" ||
    reason === "fact_projection_invalid"
  ) {
    return "writer_reference_rejected";
  }
  if (reason === "conversation_shape") {
    return "writer_conversation_shape_rejected";
  }
  return "invalid_writer_output";
}

function generatedExplanationUnavailable(
  bundle: V3CapabilityBundle
): V3PreparedResponse {
  const message = bundle.invocation.context.locale === "az-AZ"
    ? "Təsdiqlənmiş faktlar əldə edildi, lakin izahı təhlükəsiz şəkildə yarada bilmədim. Zəhmət olmasa bir qədər sonra yenidən cəhd edin."
    : "The verified facts were retrieved, but I couldn’t generate a safe explanation. Please try again shortly.";
  return {
    ...bundle,
    status: "unavailable",
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
    deterministicMessage: message,
    message,
    claims: [],
    generationMode: "deterministic-fallback"
  };
}

function telemetryWorkflowForBundle(
  bundle: V3CapabilityBundle
): V3Workflow {
  switch (bundle.workflowId) {
    case "assistant-request-v3":
      return "assistant_request_v3";
    case "public-research-v3":
      return "public_research_v3";
    case "portfolio-insight-v3":
      return "portfolio_insight_v3";
    case "approved-knowledge-v3":
      return "approved_knowledge_v3";
    case "order-ticket-handoff-v3":
      return "order_ticket_handoff_v3";
  }
}

async function compose(
  bundle: V3CapabilityBundle,
  agent: WriterAgents[keyof WriterAgents],
  dependencies: V3WorkflowDependencies
): Promise<V3PreparedResponse> {
  if (bundle.deterministicMessage !== null) {
    return {
      ...bundle,
      message: bundle.deterministicMessage,
      claims: [],
      generationMode: "deterministic-fallback"
    };
  }
  // An order preview is a signed deterministic calculation followed by an
  // explicit suspend/resume action. Model prose adds no value here and can
  // make the blocking delivery gate nondeterministic, so render the reviewed
  // preview template directly.
  const deterministicOrderPreview =
    bundle.invocation.route.route === "order_ticket_preview";
  const generatedExplanationRequired =
    bundle.invocation.route.route === "portfolio_allocation_analysis" ||
    bundle.invocation.route.route === "hypothetical_portfolio_analysis" ||
    bundle.invocation.route.route === "education";
  const modelDecision = writerModelDecision({
    userMessage: bundle.invocation.message,
    locale: bundle.invocation.context.locale,
    factCount: bundle.renderableFacts.filter(({ required }) => required).length,
    citationCount: bundle.renderableCitations.filter(({ required }) => required).length
  });
  const writerId = (
    (V3_WRITER_AGENTS as readonly string[]).includes(agent.id)
      ? agent.id
      : "public-research-writer"
  ) as V3WriterAgent;
  let drafts: ClaimDraft[] = [];
  let fallbackReason: V3FailureReason | null = null;
  if (!deterministicOrderPreview) {
    const generationStartedAt = performance.now();
    try {
      const generated = await generateWriterClaims({
        agent,
        locale: bundle.invocation.context.locale,
        userMessage: bundle.invocation.message,
        userGoal: bundle.writerGoal,
        facts: writerFactViews(bundle),
        citations: writerCitationViews(bundle),
        timeoutMs: dependencies.modelTimeoutMs
      });
      drafts = generated.claims;
      if (generated.usage !== null) {
        dependencies.telemetry?.recordModelUsage({
          provider: "openai",
          model: generated.modelDecision.modelId,
          workflow: telemetryWorkflowForBundle(bundle),
          agent: writerId,
          usage: generated.usage
        });
      }
      dependencies.telemetry?.recordProvider({
        provider: "openai",
        operation: "generation",
        result: "success",
        durationMs: performance.now() - generationStartedAt
      });
      dependencies.telemetry?.recordAgent({
        agent: writerId,
        result: "success"
      });
    } catch (error) {
      // Invalid, unavailable, or slow generation is a presentation failure,
      // never an evidence failure. Signed facts still render deterministically.
      const timeout =
        error instanceof DOMException && error.name === "TimeoutError" ||
        error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError");
      dependencies.telemetry?.recordProvider({
        provider: "openai",
        operation: "generation",
        result: timeout ? "timeout" : "error",
        durationMs: performance.now() - generationStartedAt
      });
      dependencies.telemetry?.recordAgent({
        agent: writerId,
        result: timeout ? "timeout" : "error"
      });
      fallbackReason = timeout ? "timeout" : "model_unavailable";
    }
  }
  let rendered: ReturnType<typeof renderClaimDrafts>;
  try {
    rendered = renderClaimDrafts({
      drafts,
      facts: bundle.renderableFacts,
      citations: bundle.renderableCitations,
      tools: bundle.tools,
      evidence: dependencies.evidence,
      fallback: bundle.fallback,
      locale: bundle.invocation.context.locale,
      onWriterRejected: (reason) => {
        fallbackReason ??= writerRejectionFailureReason(reason);
      }
    });
  } catch (error) {
    // renderClaimDrafts reports a bounded validator reason before attempting
    // the route-owned fallback. Education deliberately has no substantive
    // deterministic fallback, so that second attempt throws. Preserve the
    // already-sanitized validator signal instead of erasing it here.
    fallbackReason ??= "invalid_writer_output";
    dependencies.telemetry?.recordFallback({
      component: "response_composer",
      reason: fallbackReason
    });
    if (generatedExplanationRequired) {
      return generatedExplanationUnavailable(bundle);
    }
    // A malformed presentation draft must not discard already verified tool
    // evidence or turn an otherwise successful read-only request into a 503.
    // Render the route-owned signed fallback; security, order, and advice
    // boundaries remain enforced by the same delivery scorers below.
    rendered = renderClaimDrafts({
      drafts: [],
      facts: bundle.renderableFacts,
      citations: bundle.renderableCitations,
      tools: bundle.tools,
      evidence: dependencies.evidence,
      fallback: bundle.fallback,
      locale: bundle.invocation.context.locale
    });
  }
  const allRequiredFactsUsed = bundle.renderableFacts
    .filter(({ required }) => required)
    .every(({ alias }) =>
      rendered.usedFactAliases.includes(alias)
  );
  const allRequiredCitationsUsed = bundle.renderableCitations
    .filter(({ required }) => required)
    .every(({ alias }) =>
      rendered.usedCitationAliases.includes(alias)
  );
  if (
    rendered.generationMode === "writer" &&
    (!allRequiredFactsUsed || !allRequiredCitationsUsed)
  ) {
    fallbackReason = "missing_required_references";
    if (generatedExplanationRequired) {
      dependencies.telemetry?.recordFallback({
        component: "response_composer",
        reason: fallbackReason
      });
      return generatedExplanationUnavailable(bundle);
    }
    rendered = renderClaimDrafts({
      drafts: [],
      facts: bundle.renderableFacts,
      citations: bundle.renderableCitations,
      tools: bundle.tools,
      evidence: dependencies.evidence,
      fallback: bundle.fallback,
      locale: bundle.invocation.context.locale
    });
  }
  if (
    !deterministicOrderPreview &&
    rendered.generationMode !== "writer"
  ) {
    dependencies.telemetry?.recordFallback({
      component: "response_composer",
      reason: fallbackReason ?? "invalid_writer_output"
    });
  }
  const citationsById = new Map(
    bundle.citations.map((citation) => [citation.citationId, citation])
  );
  const renderableCitationsByAlias = new Map(
    bundle.renderableCitations.map((item) => [item.alias, item])
  );
  return {
    ...bundle,
    // Optional evidence that the writer did not use is not delivered as an
    // orphan citation. Required citations are guaranteed above (or the
    // deterministic fallback is used).
    citations: rendered.usedCitationIds.flatMap((citationId) => {
      const citation = citationsById.get(citationId);
      return citation === undefined ? [] : [citation];
    }),
    renderableCitations: rendered.usedCitationAliases.flatMap((alias) => {
      const citation = renderableCitationsByAlias.get(alias);
      return citation === undefined ? [] : [citation];
    }),
    message: rendered.message,
    claims: rendered.claims,
    generationMode: rendered.generationMode === "writer"
      ? modelDecision.modelId
      : "deterministic-fallback"
  };
}

function createCapabilityWorkflow(input: {
  id: "public-research-v3" | "portfolio-insight-v3" | "approved-knowledge-v3";
  acquire: (
    invocation: V3WorkflowInvocation,
    workflowRunId: string,
    tracingContext?: TracingContext
  ) => Promise<V3CapabilityBundle>;
  writer: WriterAgents[keyof WriterAgents];
  dependencies: V3WorkflowDependencies;
}) {
  const acquire = createStep({
    id: `${input.id}-execute-authorized-tools`,
    description: "Executes only policy-authorized boundary tools and deterministic services.",
    inputSchema: workflowInvocationSchema,
    outputSchema: bundleSchema,
    execute: async ({ inputData, runId, tracingContext }) =>
      input.acquire(inputData, runId, tracingContext)
  });
  const write = createStep({
    id: `${input.id}-write-and-render`,
    description: "Uses the tool-less writer, then inserts exact signed facts deterministically.",
    inputSchema: bundleSchema,
    outputSchema: preparedSchema,
    execute: async ({ inputData }) => compose(inputData, input.writer, input.dependencies)
  });
  return createWorkflow({
    id: input.id,
    description: `${input.id} evidence acquisition and constrained explanation workflow.`,
    inputSchema: workflowInvocationSchema,
    outputSchema: preparedSchema,
    retryConfig: { attempts: 1, delay: 100 },
    // These workflows never suspend. Keeping their raw request and intermediate
    // evidence out of snapshots prevents prompt, bearer, and private fact
    // retention while preserving normal in-process execution.
    options: { shouldPersistSnapshot: () => false }
  }).then(acquire).then(write).commit();
}

export function createAssistantV3Workflows(dependencies: V3WorkflowDependencies) {
  const publicResearch = createCapabilityWorkflow({
    id: "public-research-v3",
    acquire: dependencies.acquirePublic,
    writer: dependencies.writers.publicResearchWriter,
    dependencies
  });
  const portfolioInsight = createCapabilityWorkflow({
    id: "portfolio-insight-v3",
    acquire: dependencies.acquirePortfolio,
    writer: dependencies.writers.portfolioInsightWriter,
    dependencies
  });
  const approvedKnowledge = createCapabilityWorkflow({
    id: "approved-knowledge-v3",
    acquire: dependencies.acquireKnowledge,
    writer: dependencies.writers.approvedKnowledgeWriter,
    dependencies
  });

  const prepareOrder = createStep({
    id: "prepare-read-only-order-preview",
    description: "Reads eligibility, quote, and fees, then creates a non-executable preview.",
    inputSchema: workflowInvocationSchema,
    outputSchema: bundleSchema,
    execute: async ({ inputData, runId }) => dependencies.prepareOrder(inputData, runId)
  });
  const writeOrderPreview = createStep({
    id: "render-read-only-order-preview",
    description: "Renders the preview before requesting the explicit button action.",
    inputSchema: bundleSchema,
    outputSchema: preparedSchema,
    execute: async ({ inputData }) => compose(
      inputData,
      dependencies.writers.publicResearchWriter,
      dependencies
    )
  });
  const awaitConfirmation = createStep({
    id: "await-explicit-order-confirmation",
    description: "Suspends until the authenticated principal clicks the explicit preview action.",
    inputSchema: preparedSchema,
    outputSchema: preparedSchema,
    suspendSchema: preparedSchema,
    resumeSchema: z.object({
      confirmed: z.literal(true),
      confirmationToken: z.string().min(32).max(256)
    }).strict(),
    execute: async ({ inputData, resumeData, suspend }) => {
      if (!resumeData) return await suspend(inputData);
      return dependencies.confirmOrder(inputData, resumeData.confirmationToken);
    }
  });
  const orderTicketHandoff = createWorkflow({
    id: "order-ticket-handoff-v3",
    description: "Read-only preview followed by principal-bound signed handoff suspend/resume.",
    inputSchema: workflowInvocationSchema,
    outputSchema: preparedSchema,
    retryConfig: { attempts: 1, delay: 100 }
  }).then(prepareOrder).then(writeOrderPreview).then(awaitConfirmation).commit();

  const authorize = createStep({
    id: "authenticate-route-and-authorize",
    description: "Consumes server context, routes deterministically, and fails closed on policy disagreement.",
    inputSchema: z.object({
      message: z.string().min(1).max(2_000),
      contextToken: z.string().min(32).max(256)
    }).strict(),
    outputSchema: workflowInvocationSchema,
    execute: async ({ inputData }) => dependencies.authorize(inputData)
  });
  const dispatch = createStep({
    id: "dispatch-authorized-v3-workflow",
    description: "Dispatches to one of the four online capability workflows or a deterministic boundary branch.",
    inputSchema: workflowInvocationSchema,
    outputSchema: preparedSchema,
    execute: async ({ inputData }) => {
      if (
        inputData.route.route === "conversation" ||
        (
          inputData.route.kind === "clarify" &&
          inputData.route.reasonCodes.includes("no_deterministic_route")
        )
      ) {
        const reviewed = await dependencies.deterministicBoundary(
          inputData,
          crypto.randomUUID()
        );
        return compose(
          reviewed,
          dependencies.writers.publicResearchWriter,
          dependencies
        );
      }
      if (
        inputData.route.kind === "boundary" ||
        inputData.route.kind === "clarify"
      ) {
        return dependencies.deterministicBoundary(inputData, crypto.randomUUID());
      }
      const route = inputData.route.route;
      const workflow = route === "order_ticket_preview"
        ? orderTicketHandoff
        : route === "fees_tariff" ||
            route === "approved_knowledge" ||
            route === "education"
          ? approvedKnowledge
          : route !== null && [
              "recent_trading_activity",
              "purchase_history",
              "current_portfolio_value",
              "largest_holding",
              "ytd_gain_loss_twr",
              "holding_average_cost",
              "sector_allocation",
              "one_month_mover_contribution",
              "security_decision_support",
              "portfolio_allocation_analysis",
              "hypothetical_portfolio_analysis",
              "hypothetical_position_analysis"
            ].includes(route)
            ? portfolioInsight
            : publicResearch;
      const run = await workflow.createRun({ resourceId: inputData.context.principalRef });
      const result = await run.start({ inputData });
      if (result.status === "success") return result.result;
      if (result.status === "suspended" && route === "order_ticket_preview") {
        const prepared = extractSuspendedOrderPreview(
          result.suspendPayload,
          dependencies.evidence
        );
        dependencies.rememberOrderRun(prepared, run.runId, run);
        return prepared;
      }
      throw new Error(`${workflow.id} finished with status ${result.status}`);
    }
  });
  const finalize = createStep({
    id: "blocking-scorers-audit-and-compose",
    description: "Runs independent blocking scorers and commits audit before delivery.",
    inputSchema: preparedSchema,
    outputSchema: responseSchema,
    execute: async ({ inputData }) => dependencies.finalize(inputData)
  });
  const assistantRequest = createWorkflow({
    id: "assistant-request-v3",
    description: "Authoritative V3 request lifecycle from trusted context to audited response.",
    inputSchema: z.object({
      message: z.string().min(1).max(2_000),
      contextToken: z.string().min(32).max(256)
    }).strict(),
    outputSchema: responseSchema,
    retryConfig: { attempts: 1, delay: 100 },
    // The authoritative request workflow completes in one turn and has no
    // resume path, so persisting its raw bearer and prompt is unnecessary.
    options: { shouldPersistSnapshot: () => false }
  }).then(authorize).then(dispatch).then(finalize).commit();

  return {
    assistantRequest,
    publicResearch,
    portfolioInsight,
    approvedKnowledge,
    orderTicketHandoff
  };
}

export type AssistantV3Workflows = ReturnType<typeof createAssistantV3Workflows>;
