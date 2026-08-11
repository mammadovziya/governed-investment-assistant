import { createHash } from "node:crypto";
import type {
  CacheResult,
  ExecutionResult,
  OperationalMetricsSnapshot,
  ProviderResult,
  WorkflowResult
} from "../services/operational-metrics.js";
import { OperationalMetrics } from "../services/operational-metrics.js";
import {
  V3_OPENAI_MODEL_IDS,
  type V3OpenAIModelId
} from "./model-policy.js";

export const V3_WORKFLOWS = [
  "assistant_request_v3",
  "public_research_v3",
  "portfolio_insight_v3",
  "approved_knowledge_v3",
  "order_ticket_handoff_v3",
  "evaluation_replay_v3"
] as const;
export type V3Workflow = (typeof V3_WORKFLOWS)[number];

export const V3_INTENTS = [
  "market_research",
  "portfolio",
  "approved_knowledge",
  "education",
  "order_handoff",
  "safety",
  "unknown"
] as const;
export type V3Intent = (typeof V3_INTENTS)[number];

export const V3_LOCALES = ["en-US", "az-AZ"] as const;
export type V3Locale = (typeof V3_LOCALES)[number];

export const V3_PROVIDERS = [
  "market_facade",
  "public_research",
  "mock_portfolio_adapter",
  "enterprise_portfolio_adapter",
  "approved_knowledge",
  "order_eligibility",
  "handoff_signer",
  "conversation_context_memory",
  "openai"
] as const;
export type V3Provider = (typeof V3_PROVIDERS)[number];

export const V3_WRITER_AGENTS = [
  "public-research-writer",
  "portfolio-insight-writer",
  "approved-knowledge-writer"
] as const;
export type V3WriterAgent = (typeof V3_WRITER_AGENTS)[number];

export const V3_MODEL_TOKEN_KINDS = [
  "input",
  "output",
  "cached_input",
  "reasoning_output"
] as const;
export type V3ModelTokenKind = (typeof V3_MODEL_TOKEN_KINDS)[number];

export interface V3ModelTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
}

export const V3_CONVERSATION_MEMORY_OPERATIONS = ["read", "write", "clear"] as const;
export type V3ConversationMemoryOperation =
  (typeof V3_CONVERSATION_MEMORY_OPERATIONS)[number];

export const V3_OPERATIONS = [
  "resolve_instrument",
  "market_snapshot",
  "price_history",
  "instrument_research",
  "market_news",
  "portfolio_snapshot",
  "portfolio_activity",
  "knowledge_retrieval",
  "order_eligibility",
  "create_handoff",
  "conversation_memory_read",
  "conversation_memory_write",
  "conversation_memory_clear",
  "generation"
] as const;
export type V3Operation = (typeof V3_OPERATIONS)[number];

export const V3_TOOLS = [
  "resolve-instrument",
  "read-market-snapshot",
  "read-price-history",
  "read-instrument-research",
  "read-market-content",
  "convert-currency",
  "analyze-portfolio-allocation",
  "read-portfolio-snapshot",
  "read-portfolio-activity",
  "retrieve-reviewed-investment-education",
  "retrieve-approved-product-knowledge",
  "read-order-eligibility",
  "create-signed-order-handoff"
] as const;
export type V3Tool = (typeof V3_TOOLS)[number];

export const V3_GATES = [
  "authentication",
  "authorization",
  "route_fidelity",
  "required_tool",
  "evidence_signature",
  "numeric_integrity",
  "citation_grounding",
  "freshness",
  "language",
  "advice_boundary",
  "execution_boundary",
  "privacy"
] as const;
export type V3Gate = (typeof V3_GATES)[number];

export const V3_FAILURE_REASONS = [
  "invalid_context",
  "policy_rejected",
  "ambiguous_request",
  "missing_evidence",
  "stale_evidence",
  "invalid_signature",
  "calculation_reconciliation",
  "citation_failure",
  "model_unavailable",
  "provider_unavailable",
  "timeout",
  "rate_limited",
  "fallback_renderer",
  "invalid_writer_output",
  "writer_exact_value_rejected",
  "writer_semantic_vocabulary_rejected",
  "writer_semantic_language_rejected",
  "writer_semantic_uppercase_rejected",
  "writer_semantic_material_rejected",
  "writer_local_semantics_rejected",
  "writer_reference_rejected",
  "writer_conversation_shape_rejected",
  "missing_required_references",
  "handoff_ineligible",
  "handoff_expired",
  "privacy_rejected"
] as const;
export type V3FailureReason = (typeof V3_FAILURE_REASONS)[number];

export const V3_COMPONENTS = [
  ...V3_WORKFLOWS,
  ...V3_PROVIDERS,
  "router",
  "response_composer",
  "policy_gate",
  "privacy_filter"
] as const;
export type V3Component = (typeof V3_COMPONENTS)[number];

export const V3_METRIC_LABEL_DOMAINS = {
  workflow: V3_WORKFLOWS,
  intent: V3_INTENTS,
  locale: V3_LOCALES,
  provider: V3_PROVIDERS,
  model: V3_OPENAI_MODEL_IDS,
  agent: V3_WRITER_AGENTS,
  kind: V3_MODEL_TOKEN_KINDS,
  operation: V3_OPERATIONS,
  tool: V3_TOOLS,
  gate: V3_GATES,
  failureReason: V3_FAILURE_REASONS,
  component: V3_COMPONENTS,
  workflowResult: ["success", "error", "timeout", "cancelled"] as const,
  providerResult: ["success", "error", "timeout"] as const,
  executionResult: ["success", "error", "timeout", "fallback"] as const,
  cacheResult: ["hit", "miss", "stale", "bypass"] as const,
  gateResult: ["pass", "fail"] as const
} as const;

type DomainValues = readonly string[];

function assertDomain<T extends string>(
  value: T,
  domain: DomainValues,
  field: string
): void {
  if (!domain.includes(value)) throw new TypeError(`${field} is not an approved bounded label.`);
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 600_000) {
    throw new RangeError("durationMs must be between 0 and 600000.");
  }
  return value;
}

const V3_MAX_TOKENS_PER_GENERATION = 10_000_000;

function boundedTokenCount(value: number, field: string): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > V3_MAX_TOKENS_PER_GENERATION
  ) {
    throw new RangeError(
      `${field} must be a non-negative safe integer no greater than ` +
        `${V3_MAX_TOKENS_PER_GENERATION}.`
    );
  }
  return value;
}

/**
 * Typed facade over OperationalMetrics. No method accepts arbitrary labels, IDs,
 * tickers, URLs, messages, or exception strings.
 */
export class V3TelemetryMetrics {
  readonly #metrics: OperationalMetrics;

  constructor(metrics: OperationalMetrics) {
    this.#metrics = metrics;
  }

  recordRequest(input: { intent: V3Intent; workflow: V3Workflow; locale: V3Locale }): void {
    assertDomain(input.intent, V3_INTENTS, "intent");
    assertDomain(input.workflow, V3_WORKFLOWS, "workflow");
    assertDomain(input.locale, V3_LOCALES, "locale");
    this.#metrics.recordRequest({
      intent: input.intent,
      route: input.workflow,
      locale: input.locale
    });
  }

  recordWorkflow(input: {
    workflow: V3Workflow;
    result: WorkflowResult;
    durationMs: number;
  }): void {
    assertDomain(input.workflow, V3_WORKFLOWS, "workflow");
    assertDomain(input.result, V3_METRIC_LABEL_DOMAINS.workflowResult, "result");
    this.#metrics.recordWorkflowResult({
      workflow: input.workflow,
      result: input.result,
      durationMs: boundedDuration(input.durationMs)
    });
  }

  recordProvider(input: {
    provider: V3Provider;
    operation: V3Operation;
    result: ProviderResult;
    durationMs: number;
    cache?: CacheResult;
  }): void {
    assertDomain(input.provider, V3_PROVIDERS, "provider");
    assertDomain(input.operation, V3_OPERATIONS, "operation");
    assertDomain(input.result, V3_METRIC_LABEL_DOMAINS.providerResult, "result");
    if (input.cache !== undefined) {
      assertDomain(input.cache, V3_METRIC_LABEL_DOMAINS.cacheResult, "cache");
    }
    this.#metrics.recordProviderRequest({
      provider: input.provider,
      operation: input.operation,
      result: input.result,
      durationMs: boundedDuration(input.durationMs),
      ...(input.cache === undefined ? {} : { cache: input.cache })
    });
  }

  /**
   * Records bounded control-plane conversation-context activity. The method
   * deliberately accepts no subject, session, conversation, symbol, prompt,
   * or stored-value fields. Read outcomes reuse the existing finite cache
   * domain (`hit`, `miss`, `stale`, `bypass`).
   */
  recordConversationMemory(input: {
    operation: V3ConversationMemoryOperation;
    result: ProviderResult;
    durationMs: number;
    outcome?: CacheResult;
  }): void {
    assertDomain(
      input.operation,
      V3_CONVERSATION_MEMORY_OPERATIONS,
      "conversationMemoryOperation"
    );
    this.recordProvider({
      provider: "conversation_context_memory",
      operation: `conversation_memory_${input.operation}`,
      result: input.result,
      durationMs: input.durationMs,
      ...(input.outcome === undefined ? {} : { cache: input.outcome })
    });
  }

  recordTool(input: { tool: V3Tool; result: ExecutionResult }): void {
    assertDomain(input.tool, V3_TOOLS, "tool");
    assertDomain(input.result, V3_METRIC_LABEL_DOMAINS.executionResult, "result");
    this.#metrics.recordToolCall(input);
  }

  recordAgent(input: { agent: V3WriterAgent; result: ExecutionResult }): void {
    assertDomain(input.agent, V3_WRITER_AGENTS, "agent");
    assertDomain(input.result, V3_METRIC_LABEL_DOMAINS.executionResult, "result");
    this.#metrics.recordAgentRun(input);
  }

  recordModelUsage(input: {
    provider: "openai";
    model: V3OpenAIModelId;
    workflow: V3Workflow;
    agent: V3WriterAgent;
    usage: V3ModelTokenUsage;
  }): void {
    assertDomain(input.provider, V3_PROVIDERS, "provider");
    assertDomain(input.model, V3_OPENAI_MODEL_IDS, "model");
    assertDomain(input.workflow, V3_WORKFLOWS, "workflow");
    assertDomain(input.agent, V3_WRITER_AGENTS, "agent");
    const inputTokens = boundedTokenCount(
      input.usage.inputTokens,
      "inputTokens"
    );
    const outputTokens = boundedTokenCount(
      input.usage.outputTokens,
      "outputTokens"
    );
    const cachedInputTokens = input.usage.cachedInputTokens === undefined
      ? undefined
      : boundedTokenCount(
          input.usage.cachedInputTokens,
          "cachedInputTokens"
        );
    const reasoningOutputTokens =
      input.usage.reasoningOutputTokens === undefined
        ? undefined
        : boundedTokenCount(
            input.usage.reasoningOutputTokens,
            "reasoningOutputTokens"
          );
    if (cachedInputTokens !== undefined && cachedInputTokens > inputTokens) {
      throw new RangeError("cachedInputTokens cannot exceed inputTokens.");
    }
    if (
      reasoningOutputTokens !== undefined &&
      reasoningOutputTokens > outputTokens
    ) {
      throw new RangeError(
        "reasoningOutputTokens cannot exceed outputTokens."
      );
    }
    this.#metrics.recordModelTokenUsage({
      provider: input.provider,
      model: input.model,
      workflow: input.workflow,
      agent: input.agent,
      inputTokens,
      outputTokens,
      ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
      ...(reasoningOutputTokens === undefined
        ? {}
        : { reasoningOutputTokens })
    });
  }

  recordGate(input: { gate: V3Gate; passed: boolean; intent: V3Intent }): void {
    assertDomain(input.gate, V3_GATES, "gate");
    assertDomain(input.intent, V3_INTENTS, "intent");
    this.#metrics.recordEvaluation({
      evaluation: input.gate,
      passed: input.passed,
      intent: input.intent
    });
  }

  recordFallback(input: { component: V3Component; reason: V3FailureReason }): void {
    assertDomain(input.component, V3_COMPONENTS, "component");
    assertDomain(input.reason, V3_FAILURE_REASONS, "reason");
    this.#metrics.recordFallback(input);
  }

  startWorkflowTimer(workflow: V3Workflow): (result: WorkflowResult) => number {
    assertDomain(workflow, V3_WORKFLOWS, "workflow");
    const complete = this.#metrics.startWorkflowTimer(workflow);
    return (result) => {
      assertDomain(result, V3_METRIC_LABEL_DOMAINS.workflowResult, "result");
      return complete(result);
    };
  }

  snapshot(): OperationalMetricsSnapshot {
    return this.#metrics.snapshot();
  }

  toPrometheus(): string {
    return this.#metrics.toPrometheus();
  }
}

export type RedactedTelemetryValue =
  | string
  | number
  | boolean
  | null
  | readonly RedactedTelemetryValue[]
  | { readonly [key: string]: RedactedTelemetryValue };

const SENSITIVE_KEY = /(?:account|authorization|card|client|conversation|cookie|credential|customer|email|href|iban|input|message|output|pan|passcode|password|phone|pin|principal|prompt|query|requestid|secret|session|stack|token|transcript|uri|url|userid)/iu;
const SAFE_CATEGORICAL_KEY = /^(?:code|dataClass|environment|event|gate|intent|kind|locale|operation|outcome|provider|reason|result|status|tool|workflow)$/u;
const SAFE_CATEGORICAL_VALUE = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/u;
const SAFE_OBJECT_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/u;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/giu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const BEARER_PATTERN = /\b(?:bearer|basic)\s+[a-zA-Z0-9._~+/=-]+/giu;
const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/gu;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/giu;
const API_SECRET_PATTERN = /\b(?:sk|pk|api|key|secret|token)[-_][a-zA-Z0-9_-]{8,}\b/giu;
const LONG_NUMBER_PATTERN = /\b\d{12,19}\b/gu;
const NAMED_SECRET_PATTERN = /\b(?:account|client|conversation|principal|query|request|session|token)(?:[-_ ]?id)?\s*[:=]\s*[^\s,;]+/giu;

interface RedactionState {
  seen: WeakSet<object>;
  depth: number;
  inheritedKey: string | null;
}

function maskSensitivePatterns(value: string): string {
  return value
    .replace(BEARER_PATTERN, "[REDACTED_SECRET]")
    .replace(JWT_PATTERN, "[REDACTED_SECRET]")
    .replace(API_SECRET_PATTERN, "[REDACTED_SECRET]")
    .replace(URL_PATTERN, "[REDACTED_URL]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(IBAN_PATTERN, "[REDACTED_IBAN]")
    .replace(LONG_NUMBER_PATTERN, "[REDACTED_NUMBER]")
    .replace(NAMED_SECRET_PATTERN, "[REDACTED_IDENTIFIER]");
}

function isSensitiveKey(key: string): boolean {
  // Canonicalization covers snake_case, kebab-case, and mixed-case spellings
  // such as request_id, principal-id, and accountNumber.
  return SENSITIVE_KEY.test(key.replace(/[^a-zA-Z0-9]/gu, ""));
}

function safeOutputKey(key: string, index: number): string {
  if (!SAFE_OBJECT_KEY.test(key) || maskSensitivePatterns(key) !== key) {
    return `redactedField${index}`;
  }
  return key;
}

function redactRecursive(value: unknown, state: RedactionState): RedactedTelemetryValue {
  if (state.depth > 8) return "[REDACTED_DEPTH]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (state.inheritedKey && isSensitiveKey(state.inheritedKey)) return "[REDACTED]";
    const masked = maskSensitivePatterns(value);
    if (masked !== value) return masked.slice(0, 256);
    if (
      state.inheritedKey &&
      SAFE_CATEGORICAL_KEY.test(state.inheritedKey) &&
      SAFE_CATEGORICAL_VALUE.test(value)
    ) {
      return value;
    }
    return "[REDACTED_TEXT]";
  }
  if (typeof value === "bigint") return "[REDACTED_NUMERIC]";
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return "[REDACTED_UNSUPPORTED]";
  }
  try {
    if (state.seen.has(value)) return "[REDACTED_CYCLE]";
    state.seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 32).map((item) => redactRecursive(item, {
        seen: state.seen,
        depth: state.depth + 1,
        inheritedKey: state.inheritedKey
      }));
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) return "[REDACTED_OBJECT]";
    const output: Record<string, RedactedTelemetryValue> = {};
    for (const [index, [key, child]] of Object.entries(value).slice(0, 64).entries()) {
      const outputKey = safeOutputKey(key, index);
      output[outputKey] = isSensitiveKey(key)
        ? "[REDACTED]"
        : redactRecursive(child, {
            seen: state.seen,
            depth: state.depth + 1,
            inheritedKey: key
          });
    }
    return output;
  } catch {
    // Logging must fail closed even for throwing accessors or hostile proxies.
    return "[REDACTED_OBJECT]";
  }
}

/** Strict recursive projection intended for logs and trace-adjacent diagnostics. */
export function redactTelemetryData(value: unknown): RedactedTelemetryValue {
  return redactRecursive(value, { seen: new WeakSet(), depth: 0, inheritedKey: null });
}

export const V3_LOG_EVENTS = [
  "request_received",
  "workflow_completed",
  "provider_completed",
  "tool_completed",
  "gate_failed",
  "fallback_used",
  "handoff_created",
  "security_rejected"
] as const;
export type V3LogEventName = (typeof V3_LOG_EVENTS)[number];
export type V3LogLevel = "debug" | "info" | "warn" | "error";
export type V3LogOutcome = "success" | "partial" | "unavailable" | "rejected" | "error";

export interface StructuredTelemetryLogEvent {
  schemaVersion: "assistant-v3.telemetry-log.v1";
  timestamp: string;
  level: V3LogLevel;
  event: V3LogEventName;
  outcome: V3LogOutcome;
  workflow: V3Workflow | null;
  intent: V3Intent | null;
  locale: V3Locale | null;
  requestRef: string | null;
  failureReason: V3FailureReason | null;
  diagnostics: RedactedTelemetryValue;
}

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const LOG_OUTCOMES = ["success", "partial", "unavailable", "rejected", "error"] as const;

function correlationRef(value: string | undefined): string | null {
  if (!value) return null;
  const hash = createHash("sha256").update(value, "utf8").digest("hex");
  return `sha256:${hash.slice(0, 24)}`;
}

export function buildRedactedLogEvent(input: {
  level: V3LogLevel;
  event: V3LogEventName;
  outcome: V3LogOutcome;
  workflow?: V3Workflow;
  intent?: V3Intent;
  locale?: V3Locale;
  requestId?: string;
  failureReason?: V3FailureReason;
  diagnostics?: unknown;
  now?: () => number;
}): StructuredTelemetryLogEvent {
  assertDomain(input.level, LOG_LEVELS, "level");
  assertDomain(input.event, V3_LOG_EVENTS, "event");
  assertDomain(input.outcome, LOG_OUTCOMES, "outcome");
  if (input.workflow !== undefined) assertDomain(input.workflow, V3_WORKFLOWS, "workflow");
  if (input.intent !== undefined) assertDomain(input.intent, V3_INTENTS, "intent");
  if (input.locale !== undefined) assertDomain(input.locale, V3_LOCALES, "locale");
  if (input.failureReason !== undefined) {
    assertDomain(input.failureReason, V3_FAILURE_REASONS, "failureReason");
  }
  return {
    schemaVersion: "assistant-v3.telemetry-log.v1",
    timestamp: new Date((input.now ?? Date.now)()).toISOString(),
    level: input.level,
    event: input.event,
    outcome: input.outcome,
    workflow: input.workflow ?? null,
    intent: input.intent ?? null,
    locale: input.locale ?? null,
    requestRef: correlationRef(input.requestId),
    failureReason: input.failureReason ?? null,
    diagnostics: redactTelemetryData(input.diagnostics ?? {})
  };
}

const TRACE_ATTRIBUTE_DOMAINS = {
  "assistant.workflow": V3_WORKFLOWS,
  "assistant.intent": V3_INTENTS,
  "assistant.locale": V3_LOCALES,
  "assistant.provider": V3_PROVIDERS,
  "assistant.operation": V3_OPERATIONS,
  "assistant.tool": V3_TOOLS,
  "assistant.gate": V3_GATES,
  "assistant.failure_reason": V3_FAILURE_REASONS,
  "assistant.outcome": LOG_OUTCOMES,
  "assistant.environment": ["development", "test", "staging", "production"] as const,
  "assistant.data_class": ["public", "synthetic", "customer_private", "approved_internal"] as const,
  "assistant.cache": V3_METRIC_LABEL_DOMAINS.cacheResult
} as const;

export type V3TraceAttributeKey =
  | keyof typeof TRACE_ATTRIBUTE_DOMAINS
  | "assistant.retryable";

export interface V3TraceTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly inputDetails?: Readonly<{
    text?: number;
    cacheRead?: number;
    cacheWrite?: number;
    audio?: number;
    image?: number;
  }>;
  readonly outputDetails?: Readonly<{
    text?: number;
    reasoning?: number;
    audio?: number;
    image?: number;
  }>;
}

export type V3TraceAttributes =
  & Partial<Record<V3TraceAttributeKey, string | boolean>>
  & {
    provider?: "openai";
    model?: V3OpenAIModelId;
    responseModel?: V3OpenAIModelId;
    usage?: V3TraceTokenUsage;
  };

function traceTokenCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= V3_MAX_TOKENS_PER_GENERATION
    ? value as number
    : undefined;
}

function traceTokenDetails(
  value: unknown,
  keys: readonly string[]
): Record<string, number> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Readonly<Record<string, unknown>>;
  const output: Record<string, number> = {};
  for (const key of keys) {
    const count = traceTokenCount(input[key]);
    if (count !== undefined) output[key] = count;
  }
  return Object.keys(output).length === 0 ? undefined : output;
}

function detailTokenTotal(
  details: Readonly<Record<string, number>> | undefined
): number {
  return details === undefined
    ? 0
    : Object.values(details).reduce((total, count) => total + count, 0);
}

function traceTokenUsage(value: unknown): V3TraceTokenUsage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Readonly<Record<string, unknown>>;
  const inputTokens = traceTokenCount(input.inputTokens);
  const outputTokens = traceTokenCount(input.outputTokens);
  const inputDetails = traceTokenDetails(input.inputDetails, [
    "text",
    "cacheRead",
    "cacheWrite",
    "audio",
    "image"
  ]);
  const outputDetails = traceTokenDetails(input.outputDetails, [
    "text",
    "reasoning",
    "audio",
    "image"
  ]);
  if (
    (inputDetails !== undefined &&
      (inputTokens === undefined ||
        detailTokenTotal(inputDetails) > inputTokens)) ||
    (outputDetails !== undefined &&
      (outputTokens === undefined ||
        detailTokenTotal(outputDetails) > outputTokens))
  ) {
    return undefined;
  }
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    inputDetails === undefined &&
    outputDetails === undefined
  ) {
    return undefined;
  }
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(inputDetails === undefined ? {} : { inputDetails }),
    ...(outputDetails === undefined ? {} : { outputDetails })
  };
}

/** Drops every attribute not in the finite allowlist and validates each value. */
export function allowlistedTraceAttributes(
  input: Readonly<Record<string, unknown>>,
  options: { readonly allowModelUsage?: boolean } = {}
): V3TraceAttributes {
  const output: V3TraceAttributes = {};
  for (const [key, domain] of Object.entries(TRACE_ATTRIBUTE_DOMAINS)) {
    const value = input[key];
    if (typeof value === "string" && (domain as readonly string[]).includes(value)) {
      output[key as keyof typeof TRACE_ATTRIBUTE_DOMAINS] = value;
    }
  }
  if (typeof input["assistant.retryable"] === "boolean") {
    output["assistant.retryable"] = input["assistant.retryable"];
  }
  if (options.allowModelUsage !== true) return output;
  if (
    input.provider === "openai" ||
    input.provider === "openai.responses"
  ) {
    output.provider = "openai";
  }
  if (
    typeof input.model === "string" &&
    (V3_OPENAI_MODEL_IDS as readonly string[]).includes(input.model)
  ) {
    output.model = input.model as V3OpenAIModelId;
  }
  if (
    typeof input.responseModel === "string" &&
    (V3_OPENAI_MODEL_IDS as readonly string[]).includes(input.responseModel)
  ) {
    output.responseModel = input.responseModel as V3OpenAIModelId;
  }
  const usage = traceTokenUsage(input.usage);
  if (usage !== undefined) output.usage = usage;
  return output;
}
