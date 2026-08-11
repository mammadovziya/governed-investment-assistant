import {
  DEFAULT_BLOCKED_LABELS,
  type CorrelationContext,
  type FeedbackEvent,
  type InitExporterOptions,
  type LogEvent,
  type MetricEvent,
  type ObservabilityDropEvent,
  type ObservabilityExporter,
  type ScoreEvent,
  type AnySpan,
  type SpanOutputProcessor,
  SpanType,
  type TracingEvent
} from "@mastra/core/observability";
import type { IMastraLogger } from "@mastra/core/logger";
import {
  MastraStorageExporter,
  Observability,
  SamplingStrategyType,
  SensitiveDataFilter
} from "@mastra/observability";

import {
  V3_COMPONENTS,
  V3_FAILURE_REASONS,
  V3_GATES,
  V3_INTENTS,
  V3_LOCALES,
  V3_LOG_EVENTS,
  V3_METRIC_LABEL_DOMAINS,
  V3_MODEL_TOKEN_KINDS,
  V3_OPERATIONS,
  V3_PROVIDERS,
  V3_TOOLS,
  V3_WORKFLOWS,
  allowlistedTraceAttributes
} from "./telemetry.js";
import {
  V3_OPENAI_MODEL_IDS,
  type V3OpenAIModelId
} from "./model-policy.js";

export const V3_OBSERVABILITY_SERVICE_NAMES = [
  "governed-investment-assistant-v3",
  "governed-investment-assistant-v3-studio"
] as const;

export type V3ObservabilityServiceName =
  (typeof V3_OBSERVABILITY_SERVICE_NAMES)[number];

export interface V3EstimatedModelCostMetric {
  readonly provider: "openai";
  readonly model: V3OpenAIModelId;
  readonly kind: "input" | "output";
  readonly estimatedCostUsd: number;
}

export const V3_OBSERVABILITY_SERIALIZATION_LIMITS = Object.freeze({
  maxStringLength: 256,
  maxDepth: 4,
  maxArrayLength: 32,
  maxObjectKeys: 32
});

export const V3_OBSERVABILITY_BLOCKED_LABELS = Object.freeze([
  ...DEFAULT_BLOCKED_LABELS,
  "account",
  "account_id",
  "account_ref",
  "client_id",
  "conversation_id",
  "customer_id",
  "email",
  "message",
  "organization_id",
  "principal_id",
  "principal_ref",
  "prompt",
  "query",
  "symbol",
  "tenant_id",
  "tenant_ref",
  "ticker",
  "url",
  "uri"
]);

export const V3_TRACE_REDACTION_MARKER = "[REDACTED]" as const;
export const V3_PRIVACY_BOUND_EXPORTER_NAME =
  "assistant-v3-privacy-bound-storage-exporter" as const;

export const V3_APPROVED_MODEL_TOKEN_METRIC_NAMES = Object.freeze([
  "mastra_model_total_input_tokens",
  "mastra_model_total_output_tokens",
  "mastra_model_input_text_tokens",
  "mastra_model_input_cache_read_tokens",
  "mastra_model_input_cache_write_tokens",
  "mastra_model_input_audio_tokens",
  "mastra_model_input_image_tokens",
  "mastra_model_output_text_tokens",
  "mastra_model_output_reasoning_tokens",
  "mastra_model_output_audio_tokens",
  "mastra_model_output_image_tokens"
] as const);

export const V3_APPROVED_OBSERVABILITY_LOG_MESSAGES = Object.freeze([
  ...V3_LOG_EVENTS
] as const);

export const V3_APPROVED_FEEDBACK_STRING_VALUES = Object.freeze([
  "up",
  "down",
  "thumbs_up",
  "thumbs_down",
  "positive",
  "negative"
] as const);

const V3_APPROVED_FEEDBACK_TYPES = [
  "thumbs",
  "rating",
  "binary",
  "quality"
] as const;

const V3_APPROVED_ENVIRONMENTS = [
  "development",
  "test",
  "staging",
  "production"
] as const;

const V3_APPROVED_DATA_CLASSES = [
  "public",
  "synthetic",
  "customer_private",
  "approved_internal"
] as const;

const V3_APPROVED_WRITER_IDS = [
  "public-research-writer",
  "portfolio-insight-writer",
  "approved-knowledge-writer"
] as const;

const V3_APPROVED_WORKFLOW_IDS = [
  "assistant-request-v3",
  "public-research-v3",
  "portfolio-insight-v3",
  "approved-knowledge-v3",
  "order-ticket-handoff-v3"
] as const;

const V3_APPROVED_SCORER_IDS = [
  "v3.response.required-tool-set",
  "v3.response.tool-envelope-integrity",
  "v3.response.fact-derivation",
  "v3.response.material-claim-lineage",
  "v3.response.citation-integrity",
  "v3.response.numeric-date-grounding",
  "v3.response.conversational-quality",
  "v3.agent.direct-tool-grounding"
] as const;

const V3_APPROVED_ENTITY_TYPES = [
  "agent",
  "scorer",
  "rag_ingestion",
  "trajectory",
  "input_processor",
  "input_step_processor",
  "output_processor",
  "output_step_processor",
  "workflow_step",
  "tool",
  "workflow_run",
  "memory"
] as const;

const V3_APPROVED_ENTITY_IDENTITIES = new Set<string>([
  ...V3_APPROVED_WRITER_IDS,
  ...V3_APPROVED_WORKFLOW_IDS,
  ...V3_APPROVED_SCORER_IDS,
  ...V3_TOOLS
]);

const V3_APPROVED_SCORE_REASON_CODES = [
  "pass",
  "fail",
  "not_applicable",
  "error",
  "all_required_route_tools_present",
  "tool_envelopes_verified",
  "fact_signatures_and_ancestry_verified",
  "material_claim_lineage_complete",
  "citations_eligible_and_integrity_verified",
  "all_exact_numbers_dates_cards_and_charts_are_grounded",
  "response_is_concise_and_conversational",
  "signed_tool_envelope_verified",
  "signed_two_instrument_research_envelopes_verified",
  "reviewed_no_tool_rebalance_education",
  "reviewed_no_tool_allocation_clarification",
  "reviewed_no_tool_instrument_clarification",
  "reviewed_no_tool_greeting",
  "reviewed_no_tool_gratitude",
  "reviewed_no_tool_capability_overview",
  "reviewed_no_tool_simplify_follow_up",
  "direct_agent_input_invalid",
  "direct_agent_query_missing",
  "greeting_does_not_require_tool",
  "tool_result_not_successful",
  "tool_envelope_or_request_run_binding_invalid",
  "tool_identity_not_allowed_or_mismatched",
  "tool_envelope_signature_invalid",
  "tool_arguments_hash_invalid",
  "tool_result_hash_invalid",
  "factual_query_tool_not_called",
  "tool_not_semantically_authorized_for_current_query",
  "tool_request_run_binding_mismatch",
  "factual_query_has_multiple_tool_results",
  "factual_query_has_no_verified_tool_result",
  "direct_agent_output_invalid",
  "native_adapter_input_invalid",
  "native_adapter_output_invalid",
  "native_adapter_execution_error",
  "no_reason_code"
] as const;

const V3_APPROVED_SCORE_SOURCES = [
  "live",
  "trace",
  "experiment",
  "manual",
  "automated"
] as const;

const V3_APPROVED_RESULT_VALUES = [
  ...V3_METRIC_LABEL_DOMAINS.workflowResult,
  ...V3_METRIC_LABEL_DOMAINS.providerResult,
  ...V3_METRIC_LABEL_DOMAINS.executionResult,
  ...V3_METRIC_LABEL_DOMAINS.cacheResult,
  ...V3_METRIC_LABEL_DOMAINS.gateResult,
  "partial",
  "unavailable",
  "rejected",
  "no_evidence",
  "dependency_error"
] as const;

const V3_APPROVED_LOG_STRING_DATA = Object.freeze({
  schemaVersion: ["assistant-v3.telemetry-log.v1"],
  event: V3_LOG_EVENTS,
  outcome: ["success", "partial", "unavailable", "rejected", "error"],
  workflow: V3_WORKFLOWS,
  intent: V3_INTENTS,
  locale: V3_LOCALES,
  provider: V3_PROVIDERS,
  model: V3_OPENAI_MODEL_IDS,
  kind: V3_MODEL_TOKEN_KINDS,
  operation: V3_OPERATIONS,
  tool: V3_TOOLS,
  gate: V3_GATES,
  failureReason: V3_FAILURE_REASONS,
  component: V3_COMPONENTS,
  result: V3_APPROVED_RESULT_VALUES,
  cache: V3_METRIC_LABEL_DOMAINS.cacheResult,
  environment: V3_APPROVED_ENVIRONMENTS,
  dataClass: V3_APPROVED_DATA_CLASSES
} satisfies Readonly<Record<string, readonly string[]>>);

const V3_APPROVED_METRIC_LABELS = Object.freeze({
  workflow: V3_WORKFLOWS,
  route: V3_WORKFLOWS,
  intent: V3_INTENTS,
  locale: V3_LOCALES,
  provider: V3_PROVIDERS,
  model: V3_OPENAI_MODEL_IDS,
  kind: V3_MODEL_TOKEN_KINDS,
  operation: V3_OPERATIONS,
  tool: V3_TOOLS,
  gate: V3_GATES,
  failure_reason: V3_FAILURE_REASONS,
  component: V3_COMPONENTS,
  result: V3_APPROVED_RESULT_VALUES,
  cache: V3_METRIC_LABEL_DOMAINS.cacheResult,
  outcome: V3_APPROVED_RESULT_VALUES,
  environment: V3_APPROVED_ENVIRONMENTS,
  data_class: V3_APPROVED_DATA_CLASSES,
  entity_type: V3_APPROVED_ENTITY_TYPES,
  agent: V3_APPROVED_WRITER_IDS,
  evaluation: [...V3_GATES, ...V3_APPROVED_SCORER_IDS],
  service_name: V3_OBSERVABILITY_SERVICE_NAMES
} satisfies Readonly<Record<string, readonly string[]>>);

const SAFE_METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]{0,127}$/u;
const UNSAFE_METRIC_NAME =
  /(?:account|client|conversation|customer|email|message|principal|prompt|query|request|session|tenant|token|url|uri|user)/iu;
const URL_OR_EMAIL =
  /(?:https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/iu;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const REDACTED_METRIC_NAME = "assistant_v3_redacted_metric" as const;
const REDACTED_SCORER_ID = "v3.score.redacted" as const;

const MASTRA_STORAGE_EXPORTER_OPTIONS = Object.freeze({
  maxBatchSize: 100,
  maxBufferSize: 1_000,
  maxBatchWaitMs: 500,
  maxRetries: 3,
  retryDelayMs: 100
});

function approvedString(
  value: unknown,
  domain: readonly string[]
): string | undefined {
  return typeof value === "string" && domain.includes(value)
    ? value
    : undefined;
}

function sanitizeCorrelationContext(
  input: CorrelationContext | undefined
): CorrelationContext | undefined {
  if (input === undefined) return undefined;
  const output: CorrelationContext = {};

  for (const key of [
    "entityType",
    "parentEntityType",
    "rootEntityType"
  ] as const) {
    const value = approvedString(input[key], V3_APPROVED_ENTITY_TYPES);
    if (value !== undefined) output[key] = value as NonNullable<CorrelationContext[typeof key]>;
  }
  for (const key of [
    "entityId",
    "entityName",
    "parentEntityId",
    "parentEntityName",
    "rootEntityId",
    "rootEntityName"
  ] as const) {
    const value = input[key];
    if (typeof value === "string" && V3_APPROVED_ENTITY_IDENTITIES.has(value)) {
      output[key] = value;
    }
  }
  const environment = approvedString(input.environment, V3_APPROVED_ENVIRONMENTS);
  if (environment !== undefined) output.environment = environment;
  const serviceName = approvedString(
    input.serviceName,
    V3_OBSERVABILITY_SERVICE_NAMES
  );
  if (serviceName !== undefined) output.serviceName = serviceName;

  return Object.keys(output).length === 0 ? undefined : output;
}

function sanitizeLogData(
  input: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> | undefined {
  if (input === undefined) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, domain] of Object.entries(V3_APPROVED_LOG_STRING_DATA)) {
    const value = approvedString(input[key], domain);
    if (value !== undefined) output[key] = value;
  }
  if (typeof input.retryable === "boolean") output.retryable = input.retryable;
  if (
    typeof input.durationMs === "number" &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0 &&
    input.durationMs <= 600_000
  ) {
    output.durationMs = input.durationMs;
  }
  return Object.keys(output).length === 0 ? undefined : output;
}

function sanitizeMetricLabels(
  input: Readonly<Record<string, string>>
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, domain] of Object.entries(V3_APPROVED_METRIC_LABELS)) {
    const value = approvedString(input[key], domain);
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function sanitizeMetricName(name: string): string {
  if (
    (V3_APPROVED_MODEL_TOKEN_METRIC_NAMES as readonly string[]).includes(name)
  ) {
    return name;
  }
  return SAFE_METRIC_NAME.test(name) &&
    !UNSAFE_METRIC_NAME.test(name) &&
    !URL_OR_EMAIL.test(name) &&
    !UUID.test(name)
    ? name
    : REDACTED_METRIC_NAME;
}

function sanitizeScoreReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  if (
    (V3_APPROVED_SCORE_REASON_CODES as readonly string[]).includes(reason)
  ) {
    return reason;
  }
  const structured =
    /^(pass|fail|not_applicable|error): ([a-z0-9_, ]+)\. (?:Successful tool results: [0-9]+\.|Observability mirror only; the V3 P0 delivery gate remains authoritative\.)$/u
      .exec(reason);
  if (structured === null) return V3_TRACE_REDACTION_MARKER;
  const status = structured[1];
  const codes = structured[2]
    ?.split(",")
    .map((code) => code.trim())
    .filter(Boolean) ?? [];
  if (
    status === undefined ||
    codes.length === 0 ||
    codes.some(
      (code) =>
        !(V3_APPROVED_SCORE_REASON_CODES as readonly string[]).includes(code)
    )
  ) {
    return V3_TRACE_REDACTION_MARKER;
  }
  return `${status}:${codes.join(",")}`;
}

function sanitizeFeedbackValue(value: number | string): number | string {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -1 &&
    value <= 5
  ) {
    return value;
  }
  if (
    typeof value === "string" &&
    (V3_APPROVED_FEEDBACK_STRING_VALUES as readonly string[]).includes(value)
  ) {
    return value;
  }
  return V3_TRACE_REDACTION_MARKER;
}

/**
 * OpenAI can return a dated deployment id even when the configured model is
 * one of the two reviewed aliases. Keep that exact, bounded response identity
 * on the model span so Mastra's versioned pricing registry can select the
 * matching entry (or its own base-model fallback). Metrics use the canonical
 * reviewed alias to avoid an unbounded model-label dimension.
 */
function observedV3OpenAIModel(
  input: unknown
): {
  readonly canonical: V3OpenAIModelId;
  readonly pricingIdentity: string;
} | undefined {
  if (typeof input !== "string") return undefined;
  const match = /^(gpt-4o|gpt-4(?:\.1|-1))(-20\d{2}-\d{2}-\d{2})?$/u.exec(
    input
  );
  if (match === null) return undefined;
  const canonical = match[1] === "gpt-4o"
    ? "gpt-4o"
    : "gpt-4.1";
  return {
    canonical,
    pricingIdentity: `${canonical}${match[2] ?? ""}`
  };
}

function sanitizeCostContext(
  input: MetricEvent["metric"]["costContext"]
): MetricEvent["metric"]["costContext"] {
  if (input === undefined) return undefined;
  const output: NonNullable<MetricEvent["metric"]["costContext"]> = {};
  const provider = approvedString(input.provider, V3_PROVIDERS);
  if (provider !== undefined) output.provider = provider;
  const model = observedV3OpenAIModel(input.model);
  if (model !== undefined) output.model = model.canonical;
  if (
    typeof input.estimatedCost === "number" &&
    Number.isFinite(input.estimatedCost) &&
    input.estimatedCost >= 0 &&
    input.estimatedCost <= 1_000_000
  ) {
    output.estimatedCost = input.estimatedCost;
  }
  const costUnit = approvedString(input.costUnit, ["USD", "usd", "credits", "tokens"]);
  if (costUnit === "USD" || costUnit === "usd") output.costUnit = "USD";
  else if (costUnit !== undefined) output.costUnit = costUnit;
  return Object.keys(output).length === 0 ? undefined : output;
}

interface MutablePrivateSpanFields {
  attributes?: unknown;
  metadata?: unknown;
  input?: unknown;
  output?: unknown;
  errorInfo?: unknown;
  requestContext?: unknown;
  tags?: unknown;
  stack?: unknown;
  domain?: unknown;
  category?: unknown;
  details?: unknown;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

/**
 * Strict export-boundary projection for Mastra spans.
 *
 * The application keeps reconstructable financial evidence in the signed
 * audit channel, not in general-purpose traces. Traces therefore retain only
 * finite, reviewed operational attributes and correlation/topology fields.
 */
export class V3PrivacySpanOutputProcessor implements SpanOutputProcessor {
  readonly name = "assistant-v3-privacy-boundary";
  readonly #retainInput: boolean;
  readonly #retainOutput: boolean;
  readonly #serviceName: V3ObservabilityServiceName | undefined;

  constructor(options: {
    retainInput?: boolean;
    retainOutput?: boolean;
    serviceName?: V3ObservabilityServiceName;
  } = {}) {
    this.#retainInput = options.retainInput ?? false;
    this.#retainOutput = options.retainOutput ?? false;
    this.#serviceName = options.serviceName;
  }

  process(span?: AnySpan): AnySpan | undefined {
    if (span === undefined) return undefined;
    const mutable = span as unknown as MutablePrivateSpanFields;
    const inputAttributes = recordValue(mutable.attributes);
    const configuredModel = observedV3OpenAIModel(inputAttributes.model);
    const responseModel = observedV3OpenAIModel(
      inputAttributes.responseModel
    );
    mutable.attributes = {
      ...allowlistedTraceAttributes(
        {
          ...inputAttributes,
          ...(configuredModel === undefined
            ? {}
            : { model: configuredModel.canonical })
        },
        {
          allowModelUsage: span.type === SpanType.MODEL_GENERATION
        }
      ),
      // Mastra estimates cost after span processors run. Retaining only a
      // reviewed base id plus an optional ISO date lets its bundled/versioned
      // pricing registry attribute an escalation without storing arbitrary
      // provider-returned model labels.
      ...(span.type === SpanType.MODEL_GENERATION &&
      responseModel !== undefined
        ? { responseModel: responseModel.pricingIdentity }
        : {})
    };
    // Mastra's storage record builder derives span source attribution from
    // metadata. Replace all caller-controlled metadata with this one bounded,
    // system-owned value so shared Studio traces remain filterable without
    // retaining request identifiers or reconstructable customer data.
    mutable.metadata = this.#serviceName === undefined
      ? undefined
      : { serviceName: this.#serviceName };
    if (!this.#retainInput) mutable.input = undefined;
    if (!this.#retainOutput) mutable.output = undefined;
    mutable.requestContext = undefined;
    mutable.tags = undefined;
    mutable.stack = undefined;
    mutable.domain = undefined;
    mutable.category = undefined;
    mutable.details = undefined;
    mutable.errorInfo = mutable.errorInfo === undefined
      ? undefined
      : { message: V3_TRACE_REDACTION_MARKER };
    return span;
  }

  async shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Final persistence boundary for every Mastra observability signal.
 *
 * Span payloads arrive here after the span processors above. Non-span signals
 * do not pass through span processors, so this exporter projects each of them
 * to a finite operational schema before delegating to storage.
 */
export class V3PrivacyBoundStorageExporter implements ObservabilityExporter {
  readonly name = V3_PRIVACY_BOUND_EXPORTER_NAME;
  readonly #delegate: ObservabilityExporter;
  readonly #retainLogMessages: boolean;
  readonly #modelCostMetricRecorder:
    ((metric: V3EstimatedModelCostMetric) => void) | undefined;

  constructor(
    delegate: ObservabilityExporter = new MastraStorageExporter(
      MASTRA_STORAGE_EXPORTER_OPTIONS
    ),
    options: {
      readonly retainLogMessages?: boolean;
      readonly modelCostMetricRecorder?:
        (metric: V3EstimatedModelCostMetric) => void;
    } = {}
  ) {
    this.#delegate = delegate;
    this.#retainLogMessages = options.retainLogMessages ?? false;
    this.#modelCostMetricRecorder = options.modelCostMetricRecorder;
  }

  async init(options: InitExporterOptions): Promise<void> {
    await this.#delegate.init?.(options);
  }

  __setLogger(logger: IMastraLogger): void {
    this.#delegate.__setLogger?.(logger);
  }

  async onTracingEvent(event: TracingEvent): Promise<void> {
    if (this.#delegate.onTracingEvent !== undefined) {
      await this.#delegate.onTracingEvent(event);
      return;
    }
    await this.#delegate.exportTracingEvent(event);
  }

  async exportTracingEvent(event: TracingEvent): Promise<void> {
    await this.#delegate.exportTracingEvent(event);
  }

  async onLogEvent(event: LogEvent): Promise<void> {
    if (this.#delegate.onLogEvent === undefined) return;
    const message = this.#retainLogMessages ||
      (
        V3_APPROVED_OBSERVABILITY_LOG_MESSAGES as readonly string[]
      ).includes(event.log.message)
      ? event.log.message
      : V3_TRACE_REDACTION_MARKER;
    const data = sanitizeLogData(event.log.data);
    const correlationContext = sanitizeCorrelationContext(
      event.log.correlationContext
    );
    await this.#delegate.onLogEvent({
      type: "log",
      log: {
        logId: event.log.logId,
        timestamp: event.log.timestamp,
        ...(event.log.traceId === undefined ? {} : { traceId: event.log.traceId }),
        ...(event.log.spanId === undefined ? {} : { spanId: event.log.spanId }),
        level: event.log.level,
        message,
        ...(data === undefined ? {} : { data }),
        ...(correlationContext === undefined ? {} : { correlationContext })
      }
    });
  }

  async onMetricEvent(event: MetricEvent): Promise<void> {
    if (this.#delegate.onMetricEvent === undefined) return;
    const correlationContext = sanitizeCorrelationContext(
      event.metric.correlationContext
    );
    const costContext = sanitizeCostContext(event.metric.costContext);
    const costKind = event.metric.name === "mastra_model_total_input_tokens"
      ? "input"
      : event.metric.name === "mastra_model_total_output_tokens"
        ? "output"
        : undefined;
    if (
      costKind !== undefined &&
      costContext?.provider === "openai" &&
      (
        costContext.model === "gpt-4o" ||
        costContext.model === "gpt-4.1"
      ) &&
      typeof costContext.estimatedCost === "number" &&
      costContext.costUnit === "USD"
    ) {
      try {
        this.#modelCostMetricRecorder?.({
          provider: "openai",
          model: costContext.model,
          kind: costKind,
          estimatedCostUsd: costContext.estimatedCost
        });
      } catch {
        // The process-local metrics mirror is non-critical and must not block
        // persistence of the canonical Mastra metric event.
      }
    }
    await this.#delegate.onMetricEvent({
      type: "metric",
      metric: {
        metricId: event.metric.metricId,
        timestamp: event.metric.timestamp,
        ...(event.metric.traceId === undefined ? {} : { traceId: event.metric.traceId }),
        ...(event.metric.spanId === undefined ? {} : { spanId: event.metric.spanId }),
        name: sanitizeMetricName(event.metric.name),
        value: Number.isFinite(event.metric.value) ? event.metric.value : 0,
        labels: sanitizeMetricLabels(event.metric.labels),
        ...(correlationContext === undefined ? {} : { correlationContext }),
        ...(costContext === undefined ? {} : { costContext })
      }
    });
  }

  async onScoreEvent(event: ScoreEvent): Promise<void> {
    if (this.#delegate.onScoreEvent === undefined) return;
    const correlationContext = sanitizeCorrelationContext(
      event.score.correlationContext
    );
    const scorerId = (
      V3_APPROVED_SCORER_IDS as readonly string[]
    ).includes(event.score.scorerId)
      ? event.score.scorerId
      : REDACTED_SCORER_ID;
    const source = approvedString(event.score.source, V3_APPROVED_SCORE_SOURCES);
    const scoreSource = approvedString(
      event.score.scoreSource,
      V3_APPROVED_SCORE_SOURCES
    );
    const reason = sanitizeScoreReason(event.score.reason);
    const targetEntityType = approvedString(
      event.score.targetEntityType,
      V3_APPROVED_ENTITY_TYPES
    ) as ScoreEvent["score"]["targetEntityType"] | undefined;
    await this.#delegate.onScoreEvent({
      type: "score",
      score: {
        scoreId: event.score.scoreId,
        timestamp: event.score.timestamp,
        ...(event.score.traceId === undefined ? {} : { traceId: event.score.traceId }),
        ...(event.score.spanId === undefined ? {} : { spanId: event.score.spanId }),
        scorerId,
        score: Number.isFinite(event.score.score) ? event.score.score : 0,
        ...(source === undefined ? {} : { source }),
        ...(scoreSource === undefined ? {} : { scoreSource }),
        ...(reason === undefined ? {} : { reason }),
        ...(targetEntityType === undefined ? {} : { targetEntityType }),
        ...(correlationContext === undefined ? {} : { correlationContext })
      }
    });
  }

  async onFeedbackEvent(event: FeedbackEvent): Promise<void> {
    if (this.#delegate.onFeedbackEvent === undefined) return;
    const correlationContext = sanitizeCorrelationContext(
      event.feedback.correlationContext
    );
    const feedbackType = approvedString(
      event.feedback.feedbackType,
      V3_APPROVED_FEEDBACK_TYPES
    ) ?? "redacted";
    await this.#delegate.onFeedbackEvent({
      type: "feedback",
      feedback: {
        feedbackId: event.feedback.feedbackId,
        timestamp: event.feedback.timestamp,
        ...(event.feedback.traceId === undefined ? {} : { traceId: event.feedback.traceId }),
        ...(event.feedback.spanId === undefined ? {} : { spanId: event.feedback.spanId }),
        feedbackType,
        value: sanitizeFeedbackValue(event.feedback.value),
        ...(correlationContext === undefined ? {} : { correlationContext })
      }
    });
  }

  async onDroppedEvent(event: ObservabilityDropEvent): Promise<void> {
    if (this.#delegate.onDroppedEvent === undefined) return;
    await this.#delegate.onDroppedEvent({
      type: "drop",
      signal: event.signal,
      reason: event.reason,
      count: event.count,
      timestamp: event.timestamp,
      exporterName: this.name,
      ...(event.error === undefined
        ? {}
        : { error: { message: V3_TRACE_REDACTION_MARKER } })
    });
  }

  async addScoreToTrace(input: {
    traceId: string;
    spanId?: string;
    score: number;
    reason?: string;
    scorerName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (this.#delegate.addScoreToTrace === undefined) return;
    const reason = sanitizeScoreReason(input.reason);
    await this.#delegate.addScoreToTrace({
      traceId: input.traceId,
      ...(input.spanId === undefined ? {} : { spanId: input.spanId }),
      score: Number.isFinite(input.score) ? input.score : 0,
      ...(reason === undefined ? {} : { reason }),
      scorerName: (
        V3_APPROVED_SCORER_IDS as readonly string[]
      ).includes(input.scorerName)
        ? input.scorerName
        : REDACTED_SCORER_ID
    });
  }

  async flush(): Promise<void> {
    await this.#delegate.flush();
  }

  async shutdown(): Promise<void> {
    await this.#delegate.shutdown();
  }
}

export interface CreateV3ObservabilityOptions {
  readonly serviceName?: V3ObservabilityServiceName;
  readonly exporter?: ObservabilityExporter;
  readonly modelCostMetricRecorder?:
    (metric: V3EstimatedModelCostMetric) => void;
}

/**
 * One reusable observability policy for every Assistant V3 Mastra bootstrap.
 * The storage exporter persists spans, metrics, scores, feedback, and bounded
 * info-level observability logs through Mastra's configured storage domain.
 */
export function createV3Observability(
  options: CreateV3ObservabilityOptions = {}
): Observability {
  const serviceName = options.serviceName ?? "governed-investment-assistant-v3";
  if (!(V3_OBSERVABILITY_SERVICE_NAMES as readonly string[]).includes(serviceName)) {
    throw new TypeError("V3 observability service name is not approved.");
  }
  const retainPrivateStudioInput =
    serviceName === "governed-investment-assistant-v3-studio";
  const sensitiveFields = [
    "account",
    "accountId",
    "accountRef",
    "authorization",
    "clientId",
    "conversationId",
    "credential",
    "customerId",
    "email",
    "input",
    "message",
    "output",
    "password",
    "principalId",
    "principalRef",
    "prompt",
    "query",
    "requestId",
    "secret",
    "sessionId",
    "tenantId",
    "tenantRef",
    "token",
    "url"
  ].filter((field) =>
    !retainPrivateStudioInput ||
    !["input", "message", "output", "prompt", "query"].includes(field)
  );

  return new Observability({
    configs: {
      default: {
        serviceName,
        sampling: { type: SamplingStrategyType.ALWAYS },
        exporters: [
          new V3PrivacyBoundStorageExporter(options.exporter, {
            retainLogMessages: retainPrivateStudioInput,
            ...(options.modelCostMetricRecorder === undefined
              ? {}
              : {
                  modelCostMetricRecorder:
                    options.modelCostMetricRecorder
                })
          })
        ],
        spanOutputProcessors: [
          new V3PrivacySpanOutputProcessor({
            retainInput: retainPrivateStudioInput,
            retainOutput: retainPrivateStudioInput,
            serviceName
          }),
          new SensitiveDataFilter({
            sensitiveFields,
            redactionStyle: "full",
            redactionToken: V3_TRACE_REDACTION_MARKER
          })
        ],
        serializationOptions: { ...V3_OBSERVABILITY_SERIALIZATION_LIMITS },
        cardinality: {
          blockedLabels: [...V3_OBSERVABILITY_BLOCKED_LABELS],
          blockUUIDs: true
        },
        logging: {
          enabled: true,
          level: "info"
        }
      }
    }
  });
}
