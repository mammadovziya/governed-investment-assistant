/**
 * A small, process-local metrics registry for the assistant HTTP process.
 *
 * The registry intentionally has no transport or vendor dependency. Callers can
 * expose `toPrometheus()` from a scrape endpoint and include `snapshot()` in a
 * health/debug response. Metric labels are bounded by the typed recording
 * methods rather than accepting arbitrary user-provided labels.
 */

export type MetricLabelValue = string | number | boolean;
export type MetricLabels = Readonly<Record<string, MetricLabelValue>>;

export type WorkflowResult =
  | "success"
  | "rejected"
  | "error"
  | "timeout"
  | "cancelled";
export type ProviderResult = "success" | "error" | "timeout";
export type CacheResult = "hit" | "miss" | "stale" | "bypass";
export type ExecutionResult = "success" | "error" | "timeout" | "fallback";

export interface RequestMetricInput {
  intent: string;
  route: string;
  locale: string;
}

export interface WorkflowMetricInput {
  workflow: string;
  result: WorkflowResult;
  durationMs?: number;
}

export interface ProviderMetricInput {
  provider: string;
  operation: string;
  result: ProviderResult;
  durationMs: number;
  cache?: CacheResult;
}

export interface AgentMetricInput {
  agent: string;
  result: ExecutionResult;
}

export interface ToolMetricInput {
  tool: string;
  result: ExecutionResult;
}

export interface ModelTokenMetricInput {
  provider: string;
  model: string;
  workflow: string;
  agent: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface ModelEstimatedCostMetricInput {
  provider: string;
  model: string;
  kind: "input" | "output";
  estimatedCostUsd: number;
}

export interface EvaluationMetricInput {
  evaluation: string;
  passed: boolean;
  intent?: string;
}

export interface FallbackMetricInput {
  component: string;
  reason: string;
}

export interface UnsupportedSectionMetricInput {
  intent: string;
  section: string;
}

export interface RagRetrievalMetricInput {
  result: "success" | "no_evidence" | "dependency_error";
  locale: "az-AZ" | "en-US";
  facet: string;
  durationMs: number;
}

export interface RagRejectedCandidateMetricInput {
  reason: "post_filter_or_integrity" | "metadata_policy" | "relevance";
}

export interface RagCitationGateMetricInput {
  passed: boolean;
}

export interface CounterSnapshot {
  name: string;
  help: string;
  labels: Record<string, string>;
  value: number;
}

export interface GaugeSnapshot extends CounterSnapshot {}

export interface HistogramBucketSnapshot {
  le: number | "+Inf";
  count: number;
}

export interface HistogramSnapshot {
  name: string;
  help: string;
  labels: Record<string, string>;
  count: number;
  sum: number;
  buckets: HistogramBucketSnapshot[];
}

export interface OperationalMetricsSnapshot {
  generatedAt: string;
  counters: CounterSnapshot[];
  gauges: GaugeSnapshot[];
  histograms: HistogramSnapshot[];
}

export interface OperationalMetricsOptions {
  prefix?: string;
  now?: () => number;
  latencyBucketsMs?: readonly number[];
  /** Hard cap per metric family; excess label sets collapse into one overflow series. */
  maxSeriesPerMetric?: number;
}

interface MetricDefinition {
  name: string;
  help: string;
  labelNames: readonly string[];
}

interface MetricSeries {
  labels: Record<string, string>;
  value: number;
}

interface HistogramSeries {
  labels: Record<string, string>;
  count: number;
  sum: number;
  bucketCounts: number[];
}

const DEFAULT_LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const;

function sanitizeMetricPart(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_:]/g, "_");
  const safeStart = /^[a-zA-Z_:]/.test(sanitized) ? sanitized : `_${sanitized}`;
  return safeStart || "metric";
}

function normalizeLabelValue(value: MetricLabelValue): string {
  const normalized = String(value).trim();
  return (normalized || "unknown").slice(0, 160);
}

function labelsKey(labelNames: readonly string[], labels: MetricLabels): string {
  // JSON tuple encoding is collision resistant even when a bounded label value
  // contains the separators used by a human-readable key format.
  return JSON.stringify(
    labelNames.map((name) => [name, normalizeLabelValue(labels[name] ?? "unknown")])
  );
}

function normalizedLabels(
  labelNames: readonly string[],
  labels: MetricLabels
): Record<string, string> {
  return Object.fromEntries(
    labelNames.map((name) => [name, normalizeLabelValue(labels[name] ?? "unknown")])
  );
}

function compareLabels(left: Record<string, string>, right: Record<string, string>): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function escapePrometheusLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function prometheusLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "";
  return `{${entries.map(([name, value]) => `${name}="${escapePrometheusLabel(value)}"`).join(",")}}`;
}

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number.`);
  }
  return value;
}

function finiteNonNegativeInteger(value: number, field: string): number {
  finiteNonNegative(value, field);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

/** Process-local operational metrics with Prometheus-compatible output. */
export class OperationalMetrics {
  private readonly prefix: string;
  private readonly now: () => number;
  private readonly latencyBucketsMs: number[];
  private readonly maxSeriesPerMetric: number;
  private readonly counters = new Map<string, Map<string, MetricSeries>>();
  private readonly gauges = new Map<string, Map<string, MetricSeries>>();
  private readonly histograms = new Map<string, Map<string, HistogramSeries>>();

  private readonly definitions: Record<string, MetricDefinition>;

  constructor(options: OperationalMetricsOptions = {}) {
    const rawPrefix = options.prefix ?? "investment_assistant";
    this.prefix = sanitizeMetricPart(rawPrefix).replace(/_+$/, "");
    this.now = options.now ?? Date.now;
    const buckets = [...(options.latencyBucketsMs ?? DEFAULT_LATENCY_BUCKETS_MS)]
      .map((bucket) => finiteNonNegative(bucket, "Latency bucket"))
      .sort((left, right) => left - right)
      .filter((bucket, index, all) => index === 0 || bucket !== all[index - 1]);
    if (buckets.length === 0) throw new RangeError("At least one latency bucket is required.");
    this.latencyBucketsMs = buckets;
    const maxSeries = options.maxSeriesPerMetric ?? 500;
    if (!Number.isFinite(maxSeries) || maxSeries < 1) {
      throw new RangeError("maxSeriesPerMetric must be a positive finite number.");
    }
    this.maxSeriesPerMetric = Math.floor(maxSeries);

    const metric = (suffix: string, help: string, labelNames: readonly string[]): MetricDefinition => ({
      name: `${this.prefix}_${suffix}`,
      help,
      labelNames
    });
    this.definitions = {
      requests: metric("requests_total", "Assistant requests by classified intent and route.", ["intent", "route", "locale"]),
      workflowResults: metric("workflow_results_total", "Workflow completions by result.", ["workflow", "result"]),
      workflowDuration: metric("workflow_duration_ms", "Workflow execution latency in milliseconds.", ["workflow"]),
      providerRequests: metric("provider_requests_total", "Upstream provider requests by result.", ["provider", "operation", "result"]),
      providerDuration: metric("provider_duration_ms", "Upstream provider latency in milliseconds.", ["provider", "operation"]),
      providerErrors: metric("provider_errors_total", "Upstream provider errors and timeouts.", ["provider", "operation", "result"]),
      providerCache: metric("provider_cache_total", "Upstream provider cache outcomes.", ["provider", "operation", "result"]),
      agentRuns: metric("agent_runs_total", "Agent executions by result.", ["agent", "result"]),
      toolCalls: metric("tool_calls_total", "Tool executions by result.", ["tool", "result"]),
      modelTokens: metric(
        "model_tokens_total",
        "Provider-reported model tokens used by constrained writer generations.",
        ["provider", "model", "workflow", "agent", "kind"]
      ),
      modelEstimatedCost: metric(
        "model_estimated_cost_usd_total",
        "Mastra-estimated USD cost of constrained writer model generations.",
        ["provider", "model", "kind"]
      ),
      evaluations: metric("evaluations_total", "Deterministic evaluation outcomes.", ["evaluation", "result", "intent"]),
      fallbacks: metric("fallbacks_total", "Fallback executions by component and bounded reason code.", ["component", "reason"]),
      unsupportedSections: metric("unsupported_sections_total", "Research sections without sufficient supporting evidence.", ["intent", "section"]),
      ragRetrievals: metric("rag_requests_total", "Governed RAG retrievals by bounded outcome, locale, and facet.", ["result", "locale", "facet"]),
      ragRetrievalDuration: metric("rag_retrieval_latency_ms", "Governed RAG retrieval latency in milliseconds.", ["locale", "facet"]),
      ragRejectedCandidates: metric("rag_ineligible_candidate_total", "RAG candidates rejected by a bounded authorization or integrity reason.", ["reason"]),
      ragCitationGate: metric("rag_citation_gate_total", "Governed RAG citation-gate outcomes.", ["result"]),
      activeRequests: metric("active_requests", "Assistant requests currently in progress.", ["route"]),
      providerCacheEntries: metric("provider_cache_entries", "Current process-local provider cache entries.", ["provider"])
    };
  }

  recordRequest(input: RequestMetricInput): void {
    this.increment(this.definition("requests"), {
      intent: input.intent,
      route: input.route,
      locale: input.locale
    });
  }

  recordWorkflowResult(input: WorkflowMetricInput): void {
    this.increment(this.definition("workflowResults"), {
      workflow: input.workflow,
      result: input.result
    });
    if (input.durationMs !== undefined) {
      this.observe(this.definition("workflowDuration"), { workflow: input.workflow }, input.durationMs);
    }
  }

  recordProviderRequest(input: ProviderMetricInput): void {
    this.increment(this.definition("providerRequests"), {
      provider: input.provider,
      operation: input.operation,
      result: input.result
    });
    this.observe(
      this.definition("providerDuration"),
      { provider: input.provider, operation: input.operation },
      input.durationMs
    );
    if (input.result !== "success") {
      this.increment(this.definition("providerErrors"), {
        provider: input.provider,
        operation: input.operation,
        result: input.result
      });
    }
    if (input.cache !== undefined) {
      this.increment(this.definition("providerCache"), {
        provider: input.provider,
        operation: input.operation,
        result: input.cache
      });
    }
  }

  recordAgentRun(input: AgentMetricInput): void {
    this.increment(this.definition("agentRuns"), {
      agent: input.agent,
      result: input.result
    });
  }

  recordToolCall(input: ToolMetricInput): void {
    this.increment(this.definition("toolCalls"), {
      tool: input.tool,
      result: input.result
    });
  }

  recordModelTokenUsage(input: ModelTokenMetricInput): void {
    const inputTokens = finiteNonNegativeInteger(input.inputTokens, "Input tokens");
    const outputTokens = finiteNonNegativeInteger(input.outputTokens, "Output tokens");
    const cachedInputTokens = input.cachedInputTokens === undefined
      ? undefined
      : finiteNonNegativeInteger(input.cachedInputTokens, "Cached input tokens");
    const reasoningOutputTokens = input.reasoningOutputTokens === undefined
      ? undefined
      : finiteNonNegativeInteger(
          input.reasoningOutputTokens,
          "Reasoning output tokens"
        );
    if (cachedInputTokens !== undefined && cachedInputTokens > inputTokens) {
      throw new RangeError("Cached input tokens cannot exceed input tokens.");
    }
    if (
      reasoningOutputTokens !== undefined &&
      reasoningOutputTokens > outputTokens
    ) {
      throw new RangeError("Reasoning output tokens cannot exceed output tokens.");
    }
    const labels = {
      provider: input.provider,
      model: input.model,
      workflow: input.workflow,
      agent: input.agent
    };
    this.increment(
      this.definition("modelTokens"),
      { ...labels, kind: "input" },
      inputTokens
    );
    this.increment(
      this.definition("modelTokens"),
      { ...labels, kind: "output" },
      outputTokens
    );
    if (cachedInputTokens !== undefined) {
      this.increment(
        this.definition("modelTokens"),
        { ...labels, kind: "cached_input" },
        cachedInputTokens
      );
    }
    if (reasoningOutputTokens !== undefined) {
      this.increment(
        this.definition("modelTokens"),
        { ...labels, kind: "reasoning_output" },
        reasoningOutputTokens
      );
    }
  }

  recordModelEstimatedCost(input: ModelEstimatedCostMetricInput): void {
    this.increment(
      this.definition("modelEstimatedCost"),
      {
        provider: input.provider,
        model: input.model,
        kind: input.kind
      },
      finiteNonNegative(
        input.estimatedCostUsd,
        "Estimated model cost USD"
      )
    );
  }

  recordEvaluation(input: EvaluationMetricInput): void {
    this.increment(this.definition("evaluations"), {
      evaluation: input.evaluation,
      result: input.passed ? "pass" : "fail",
      intent: input.intent ?? "unknown"
    });
  }

  recordFallback(input: FallbackMetricInput): void {
    this.increment(this.definition("fallbacks"), {
      component: input.component,
      reason: input.reason
    });
  }

  recordUnsupportedSection(input: UnsupportedSectionMetricInput): void {
    this.increment(this.definition("unsupportedSections"), {
      intent: input.intent,
      section: input.section
    });
  }

  recordRagRetrieval(input: RagRetrievalMetricInput): void {
    this.increment(this.definition("ragRetrievals"), {
      result: input.result,
      locale: input.locale,
      facet: input.facet
    });
    this.observe(
      this.definition("ragRetrievalDuration"),
      { locale: input.locale, facet: input.facet },
      input.durationMs
    );
  }

  recordRagRejectedCandidate(input: RagRejectedCandidateMetricInput, amount = 1): void {
    this.increment(this.definition("ragRejectedCandidates"), { reason: input.reason }, amount);
  }

  recordRagCitationGate(input: RagCitationGateMetricInput): void {
    this.increment(this.definition("ragCitationGate"), {
      result: input.passed ? "pass" : "fail"
    });
  }

  setActiveRequests(route: string, value: number): void {
    this.setGauge(this.definition("activeRequests"), { route }, value);
  }

  addActiveRequests(route: string, delta: number): number {
    if (!Number.isFinite(delta)) throw new RangeError("Active request delta must be finite.");
    return this.addGauge(this.definition("activeRequests"), { route }, delta, true);
  }

  /**
   * Starts an active-request lease. The returned completion function is
   * idempotent so callers can safely attach it to both `finish` and `close`.
   */
  startActiveRequest(route: string): () => number {
    this.addActiveRequests(route, 1);
    let completed = false;
    return () => {
      if (completed) return this.addActiveRequests(route, 0);
      completed = true;
      return this.addActiveRequests(route, -1);
    };
  }

  setProviderCacheEntries(provider: string, value: number): void {
    this.setGauge(this.definition("providerCacheEntries"), { provider }, value);
  }

  /**
   * Times an operation with the same monotonic-ish clock used by the registry.
   * Completion is idempotent, preventing double counts in `finally` paths.
   */
  startWorkflowTimer(workflow: string): (result: WorkflowResult) => number {
    const startedAt = this.now();
    let completed = false;
    return (result) => {
      if (completed) return 0;
      completed = true;
      const durationMs = Math.max(0, this.now() - startedAt);
      this.recordWorkflowResult({ workflow, result, durationMs });
      return durationMs;
    };
  }

  snapshot(): OperationalMetricsSnapshot {
    const counters: CounterSnapshot[] = [];
    const gauges: GaugeSnapshot[] = [];
    const histograms: HistogramSnapshot[] = [];

    for (const [definitionKey, series] of this.counters) {
      const definition = this.definition(definitionKey);
      for (const value of series.values()) {
        counters.push({ name: definition.name, help: definition.help, labels: { ...value.labels }, value: value.value });
      }
    }
    for (const [definitionKey, series] of this.gauges) {
      const definition = this.definition(definitionKey);
      for (const value of series.values()) {
        gauges.push({ name: definition.name, help: definition.help, labels: { ...value.labels }, value: value.value });
      }
    }
    for (const [definitionKey, series] of this.histograms) {
      const definition = this.definition(definitionKey);
      for (const value of series.values()) {
        histograms.push({
          name: definition.name,
          help: definition.help,
          labels: { ...value.labels },
          count: value.count,
          sum: value.sum,
          buckets: [
            ...this.latencyBucketsMs.map((le, index) => ({ le, count: value.bucketCounts[index] ?? 0 })),
            { le: "+Inf" as const, count: value.count }
          ]
        });
      }
    }

    const byNameAndLabels = <T extends { name: string; labels: Record<string, string> }>(left: T, right: T): number =>
      left.name.localeCompare(right.name) || compareLabels(left.labels, right.labels);
    counters.sort(byNameAndLabels);
    gauges.sort(byNameAndLabels);
    histograms.sort(byNameAndLabels);

    return {
      generatedAt: new Date(this.now()).toISOString(),
      counters,
      gauges,
      histograms
    };
  }

  toPrometheus(): string {
    const snapshot = this.snapshot();
    const lines: string[] = [];
    const emitFamilyHeader = (name: string, help: string, type: "counter" | "gauge" | "histogram"): void => {
      lines.push(`# HELP ${name} ${help.replace(/\n/g, " ")}`);
      lines.push(`# TYPE ${name} ${type}`);
    };

    for (const family of this.groupSnapshot(snapshot.counters)) {
      const first = family[0];
      if (!first) continue;
      emitFamilyHeader(first.name, first.help, "counter");
      for (const point of family) lines.push(`${point.name}${prometheusLabels(point.labels)} ${point.value}`);
    }
    for (const family of this.groupSnapshot(snapshot.gauges)) {
      const first = family[0];
      if (!first) continue;
      emitFamilyHeader(first.name, first.help, "gauge");
      for (const point of family) lines.push(`${point.name}${prometheusLabels(point.labels)} ${point.value}`);
    }
    for (const family of this.groupSnapshot(snapshot.histograms)) {
      const first = family[0];
      if (!first) continue;
      emitFamilyHeader(first.name, first.help, "histogram");
      for (const point of family) {
        for (const bucket of point.buckets) {
          lines.push(`${point.name}_bucket${prometheusLabels({ ...point.labels, le: String(bucket.le) })} ${bucket.count}`);
        }
        lines.push(`${point.name}_sum${prometheusLabels(point.labels)} ${point.sum}`);
        lines.push(`${point.name}_count${prometheusLabels(point.labels)} ${point.count}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  /** Intended for isolated tests or controlled process resets. */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private definition(key: string): MetricDefinition {
    const definition = this.definitions[key];
    if (!definition) throw new Error(`Unknown metric definition: ${key}`);
    return definition;
  }

  private increment(definition: MetricDefinition, labels: MetricLabels, amount = 1): void {
    finiteNonNegative(amount, "Counter increment");
    const key = this.definitionKey(definition);
    const family = this.counters.get(key) ?? new Map<string, MetricSeries>();
    const identity = this.boundedIdentity(definition, labels, family);
    const seriesKey = identity.key;
    const current = family.get(seriesKey);
    family.set(seriesKey, {
      labels: current?.labels ?? identity.labels,
      value: (current?.value ?? 0) + amount
    });
    this.counters.set(key, family);
  }

  private observe(definition: MetricDefinition, labels: MetricLabels, value: number): void {
    finiteNonNegative(value, "Histogram observation");
    const key = this.definitionKey(definition);
    const family = this.histograms.get(key) ?? new Map<string, HistogramSeries>();
    const identity = this.boundedIdentity(definition, labels, family);
    const seriesKey = identity.key;
    const current = family.get(seriesKey) ?? {
      labels: identity.labels,
      count: 0,
      sum: 0,
      bucketCounts: this.latencyBucketsMs.map(() => 0)
    };
    current.count += 1;
    current.sum += value;
    this.latencyBucketsMs.forEach((bucket, index) => {
      if (value <= bucket) current.bucketCounts[index] = (current.bucketCounts[index] ?? 0) + 1;
    });
    family.set(seriesKey, current);
    this.histograms.set(key, family);
  }

  private setGauge(definition: MetricDefinition, labels: MetricLabels, value: number): void {
    finiteNonNegative(value, "Gauge value");
    const key = this.definitionKey(definition);
    const family = this.gauges.get(key) ?? new Map<string, MetricSeries>();
    const identity = this.boundedIdentity(definition, labels, family);
    const seriesKey = identity.key;
    family.set(seriesKey, { labels: identity.labels, value });
    this.gauges.set(key, family);
  }

  private addGauge(
    definition: MetricDefinition,
    labels: MetricLabels,
    delta: number,
    clampAtZero: boolean
  ): number {
    const key = this.definitionKey(definition);
    const family = this.gauges.get(key) ?? new Map<string, MetricSeries>();
    const identity = this.boundedIdentity(definition, labels, family);
    const seriesKey = identity.key;
    const current = family.get(seriesKey);
    const rawValue = (current?.value ?? 0) + delta;
    const value = clampAtZero ? Math.max(0, rawValue) : rawValue;
    family.set(seriesKey, {
      labels: current?.labels ?? identity.labels,
      value
    });
    this.gauges.set(key, family);
    return value;
  }

  private definitionKey(definition: MetricDefinition): string {
    const entry = Object.entries(this.definitions).find(([, candidate]) => candidate === definition);
    if (!entry) throw new Error(`Metric definition is not registered: ${definition.name}`);
    return entry[0];
  }

  private boundedIdentity(
    definition: MetricDefinition,
    labels: MetricLabels,
    family: Map<string, unknown>
  ): { key: string; labels: Record<string, string> } {
    const normalized = normalizedLabels(definition.labelNames, labels);
    const key = labelsKey(definition.labelNames, normalized);
    if (family.has(key)) {
      return { key, labels: normalized };
    }
    const overflow = Object.fromEntries(
      definition.labelNames.map((name) => [name, "__overflow__"])
    );
    const overflowKey = labelsKey(definition.labelNames, overflow);
    if (family.has(overflowKey) || family.size >= this.maxSeriesPerMetric - 1) {
      return { key: overflowKey, labels: overflow };
    }
    return { key, labels: normalized };
  }

  private groupSnapshot<T extends { name: string }>(points: T[]): T[][] {
    const groups: T[][] = [];
    let current: T[] = [];
    let currentName: string | undefined;
    for (const point of points) {
      if (currentName !== point.name) {
        if (current.length > 0) groups.push(current);
        current = [];
        currentName = point.name;
      }
      current.push(point);
    }
    if (current.length > 0) groups.push(current);
    return groups;
  }
}

export const operationalMetrics = new OperationalMetrics({
  prefix: process.env.ASSISTANT_METRICS_PREFIX ?? "investment_assistant"
});
