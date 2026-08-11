import {
  TracingEventType,
  type FeedbackEvent,
  type LogEvent,
  type MetricEvent,
  type ObservabilityExporter,
  type ScoreEvent,
  type TracingEvent
} from "@mastra/core/observability";

export const V3_OBSERVABILITY_BRIDGE_PATHS = Object.freeze({
  spans: "/observability-bridge/ai/spans/publish",
  logs: "/observability-bridge/ai/logs/publish",
  metrics: "/observability-bridge/ai/metrics/publish",
  scores: "/observability-bridge/ai/scores/publish",
  feedback: "/observability-bridge/ai/feedback/publish",
  health: "/observability-bridge/health"
} as const);

export interface V3ObservabilityBridgeConfig {
  readonly endpoint: string;
  readonly accessToken: string;
}

type BridgeSignal = "spans" | "logs" | "metrics" | "scores" | "feedback";

type BridgeBuffer = {
  [Signal in BridgeSignal]: unknown[];
};

const MAX_BRIDGE_BATCH_SIZE = 100;
const MAX_BRIDGE_BUFFER_SIZE = 1_000;
const BRIDGE_BATCH_WAIT_MS = 250;
const BRIDGE_REQUEST_TIMEOUT_MS = 2_000;
const BRIDGE_REQUEST_ATTEMPTS = 2;

function bridgeUrl(
  config: V3ObservabilityBridgeConfig,
  path: string
): string {
  return new URL(path, `${config.endpoint.replace(/\/+$/u, "")}/`).href;
}

function emptyBridgeBuffer(): BridgeBuffer {
  return {
    spans: [],
    logs: [],
    metrics: [],
    scores: [],
    feedback: []
  };
}

function bridgeBufferSize(buffer: BridgeBuffer): number {
  return Object.values(buffer).reduce(
    (total, records) => total + records.length,
    0
  );
}

function assertLoopbackBridgeConfig(
  config: V3ObservabilityBridgeConfig
): void {
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.username !== "" ||
    endpoint.password !== ""
  ) {
    throw new TypeError(
      "The shared observability bridge must use unauthenticated URL syntax on http://127.0.0.1."
    );
  }
  if (config.accessToken.length < 32 || config.accessToken.length > 512) {
    throw new TypeError(
      "The shared observability bridge token must contain 32-512 characters."
    );
  }
}

/**
 * Bounded loopback batch exporter. Failed transient batches remain in a finite
 * process-local buffer for the next flush; no request can block longer than
 * two short attempts.
 */
class V3ObservabilityBridgeExporter implements ObservabilityExporter {
  readonly name = "assistant-v3-loopback-observability-bridge";
  readonly #config: V3ObservabilityBridgeConfig;
  #buffer = emptyBridgeBuffer();
  #flushTimer: NodeJS.Timeout | undefined;
  #flushPromise: Promise<void> | undefined;
  #shutdown = false;

  constructor(config: V3ObservabilityBridgeConfig) {
    assertLoopbackBridgeConfig(config);
    this.#config = config;
  }

  async onTracingEvent(event: TracingEvent): Promise<void> {
    await this.exportTracingEvent(event);
  }

  async exportTracingEvent(event: TracingEvent): Promise<void> {
    if (event.type !== TracingEventType.SPAN_ENDED) return;
    this.#enqueue("spans", event.exportedSpan);
  }

  async onLogEvent(event: LogEvent): Promise<void> {
    this.#enqueue("logs", event.log);
  }

  async onMetricEvent(event: MetricEvent): Promise<void> {
    this.#enqueue("metrics", event.metric);
  }

  async onScoreEvent(event: ScoreEvent): Promise<void> {
    this.#enqueue("scores", event.score);
  }

  async onFeedbackEvent(event: FeedbackEvent): Promise<void> {
    this.#enqueue("feedback", event.feedback);
  }

  #enqueue(signal: BridgeSignal, record: unknown): void {
    if (this.#shutdown) return;
    if (bridgeBufferSize(this.#buffer) >= MAX_BRIDGE_BUFFER_SIZE) return;
    this.#buffer[signal].push(record);
    if (bridgeBufferSize(this.#buffer) >= MAX_BRIDGE_BATCH_SIZE) {
      void this.flush().catch(() => undefined);
      return;
    }
    if (this.#flushTimer === undefined) {
      this.#flushTimer = setTimeout(() => {
        this.#flushTimer = undefined;
        void this.flush().catch(() => undefined);
      }, BRIDGE_BATCH_WAIT_MS);
      this.#flushTimer.unref();
    }
  }

  async #publish(signal: BridgeSignal, records: readonly unknown[]): Promise<void> {
    let lastFailure: unknown;
    for (let attempt = 0; attempt < BRIDGE_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(
          bridgeUrl(this.#config, V3_OBSERVABILITY_BRIDGE_PATHS[signal]),
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.#config.accessToken}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({ [signal]: records }),
            signal: AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS)
          }
        );
        await response.text();
        if (response.ok) return;
        lastFailure = new Error(
          `Observability bridge rejected ${signal} with status ${response.status}.`
        );
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        lastFailure = error;
      }
    }
    throw new Error(
      `Bounded observability bridge publish failed for ${signal}.`,
      { cause: lastFailure }
    );
  }

  #restore(signal: BridgeSignal, records: readonly unknown[]): void {
    const available = Math.max(
      0,
      MAX_BRIDGE_BUFFER_SIZE - bridgeBufferSize(this.#buffer)
    );
    if (available === 0) return;
    this.#buffer[signal].unshift(...records.slice(-available));
  }

  async #flushSnapshot(): Promise<void> {
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    const snapshot = this.#buffer;
    this.#buffer = emptyBridgeBuffer();
    const pending = (
      Object.entries(snapshot) as Array<[BridgeSignal, unknown[]]>
    ).filter(([, records]) => records.length > 0);
    if (pending.length === 0) return;

    const results = await Promise.all(
      pending.map(async ([signal, records]) => {
        try {
          await this.#publish(signal, records);
          return null;
        } catch (error) {
          this.#restore(signal, records);
          return error;
        }
      })
    );
    if (results.some((result) => result !== null)) {
      throw new Error("One or more observability bridge batches failed.");
    }
  }

  async flush(): Promise<void> {
    if (this.#flushPromise !== undefined) {
      await this.#flushPromise;
      if (bridgeBufferSize(this.#buffer) > 0) await this.flush();
      return;
    }
    const pending = this.#flushSnapshot();
    this.#flushPromise = pending;
    try {
      await pending;
    } finally {
      this.#flushPromise = undefined;
    }
  }

  async shutdown(): Promise<void> {
    if (this.#shutdown) return;
    this.#shutdown = true;
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    try {
      await this.flush();
    } catch {
      // The process-local retry buffer cannot outlive shutdown. The bounded
      // request attempts above ensure this never blocks application exit.
    }
    this.#buffer = emptyBridgeBuffer();
  }
}

/**
 * The demo app sends its already privacy-projected observability signals to
 * the loopback Studio process. Studio is the sole owner of the shared DuckDB
 * file, avoiding DuckDB's unsupported multi-process writer topology.
 */
export function createV3ObservabilityBridgeExporter(
  config: V3ObservabilityBridgeConfig
): ObservabilityExporter {
  return new V3ObservabilityBridgeExporter(config);
}

export async function probeV3ObservabilityBridge(
  config: V3ObservabilityBridgeConfig,
  timeoutMs = 2_000
): Promise<boolean> {
  assertLoopbackBridgeConfig(config);
  try {
    const response = await fetch(
      bridgeUrl(config, V3_OBSERVABILITY_BRIDGE_PATHS.health),
      {
        headers: {
          authorization: `Bearer ${config.accessToken}`
        },
        signal: AbortSignal.timeout(timeoutMs)
      }
    );
    if (!response.ok) return false;
    const body = await response.json() as Readonly<Record<string, unknown>>;
    return body.status === "ok" && body.storage === "shared-duckdb";
  } catch {
    return false;
  }
}
