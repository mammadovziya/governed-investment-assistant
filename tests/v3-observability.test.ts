import type { IMastraLogger } from "@mastra/core/logger";
import {
  EntityType,
  SpanType,
  type AnySpan,
  type FeedbackEvent,
  type InitExporterOptions,
  type LogEvent,
  type MetricEvent,
  type ObservabilityExporter,
  type ScoreEvent,
  type TracingEvent
} from "@mastra/core/observability";
import {
  Observability,
  SamplingStrategyType
} from "@mastra/observability";
import { describe, expect, it, vi } from "vitest";

import {
  V3_APPROVED_MODEL_TOKEN_METRIC_NAMES,
  V3_APPROVED_OBSERVABILITY_LOG_MESSAGES,
  V3_OBSERVABILITY_BLOCKED_LABELS,
  V3_OBSERVABILITY_SERIALIZATION_LIMITS,
  V3_PRIVACY_BOUND_EXPORTER_NAME,
  V3PrivacyBoundStorageExporter,
  V3PrivacySpanOutputProcessor,
  V3_TRACE_REDACTION_MARKER,
  createV3Observability
} from "../src/assistant-v3/observability.js";

class RecordingExporter implements ObservabilityExporter {
  readonly name = "recording-exporter";
  readonly tracing: TracingEvent[] = [];
  readonly logs: LogEvent[] = [];
  readonly metrics: MetricEvent[] = [];
  readonly scores: ScoreEvent[] = [];
  readonly feedback: FeedbackEvent[] = [];
  initOptions: InitExporterOptions | undefined;
  logger: IMastraLogger | undefined;
  flushCount = 0;
  shutdownCount = 0;

  init(options: InitExporterOptions): void {
    this.initOptions = options;
  }

  __setLogger(logger: IMastraLogger): void {
    this.logger = logger;
  }

  async exportTracingEvent(event: TracingEvent): Promise<void> {
    this.tracing.push(event);
  }

  async onLogEvent(event: LogEvent): Promise<void> {
    this.logs.push(event);
  }

  async onMetricEvent(event: MetricEvent): Promise<void> {
    this.metrics.push(event);
  }

  async onScoreEvent(event: ScoreEvent): Promise<void> {
    this.scores.push(event);
  }

  async onFeedbackEvent(event: FeedbackEvent): Promise<void> {
    this.feedback.push(event);
  }

  async flush(): Promise<void> {
    this.flushCount += 1;
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1;
  }
}

describe("V3 Mastra observability policy", () => {
  it("drops reconstruction data and retains only finite approved trace attributes", async () => {
    const processor = new V3PrivacySpanOutputProcessor();
    const unsafeUrl = "https://private.example/trace";
    const unsafeEmail = "trace.private@example.com";
    const unsafeUuid = "00000000-0000-4000-8000-000000000001";
    const span = {
      type: SpanType.MODEL_GENERATION,
      attributes: {
        "assistant.workflow": "public_research_v3",
        "assistant.intent": "market_research",
        "assistant.locale": "en-US",
        "assistant.tool": "analyze-portfolio-allocation",
        "assistant.outcome": "success",
        "assistant.data_class": "synthetic",
        "assistant.retryable": false,
        provider: "openai",
        model: "gpt-4o",
        responseModel: "gpt-4.1",
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          inputDetails: {
            text: 100,
            cacheRead: 20,
            secret: "private usage detail"
          },
          outputDetails: {
            text: 25,
            reasoning: 5
          },
          raw: {
            prompt: "private raw usage"
          }
        },
        prompt: "private prompt",
        url: unsafeUrl,
        email: unsafeEmail,
        uuid: unsafeUuid,
        conversationId: "conversation-private",
        arbitrary: { private: "value" }
      },
      metadata: {
        principalRef: "principal-private",
        requestId: "request-private"
      },
      input: {
        message: "Should I buy ten shares?",
        accountRef: "account-private",
        allocations: [
          { symbol: "NVDA", allocationRate: "0.60000000" }
        ]
      },
      output: {
        price: "123.45",
        response: "private output",
        result: {
          largestPosition: "NVDA",
          largestAllocationRate: "0.60000000"
        }
      },
      requestContext: {
        tenantRef: "tenant-private",
        sessionId: "session-private"
      },
      tags: ["customer-private"],
      errorInfo: {
        message: "provider failed for account-private",
        stack: "private stack"
      },
      stack: "private stack",
      domain: "private domain",
      category: "private category",
      details: { credential: "private credential" }
    } as unknown as AnySpan;

    expect(processor.process(span)).toBe(span);
    expect(span.attributes).toEqual({
      "assistant.workflow": "public_research_v3",
      "assistant.intent": "market_research",
      "assistant.locale": "en-US",
      "assistant.tool": "analyze-portfolio-allocation",
      "assistant.outcome": "success",
      "assistant.data_class": "synthetic",
      "assistant.retryable": false,
      provider: "openai",
      model: "gpt-4o",
      responseModel: "gpt-4.1",
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        inputDetails: {
          text: 100,
          cacheRead: 20
        },
        outputDetails: {
          text: 25,
          reasoning: 5
        }
      }
    });
    expect(span.metadata).toBeUndefined();
    expect(span.input).toBeUndefined();
    expect(span.output).toBeUndefined();
    expect(span.requestContext).toBeUndefined();
    expect(span.tags).toBeUndefined();
    expect(span.errorInfo).toEqual({ message: V3_TRACE_REDACTION_MARKER });
    const privateFields = span as unknown as Record<string, unknown>;
    expect(privateFields.stack).toBeUndefined();
    expect(privateFields.domain).toBeUndefined();
    expect(privateFields.category).toBeUndefined();
    expect(privateFields.details).toBeUndefined();
    const persisted = JSON.stringify(span);
    for (const forbidden of [
      "private prompt",
      "private usage detail",
      "private raw usage",
      unsafeUrl,
      unsafeEmail,
      unsafeUuid,
      "conversation-private",
      "principal-private",
      "request-private",
      "account-private",
      "0.60000000",
      "tenant-private",
      "session-private"
    ]) {
      expect(persisted).not.toContain(forbidden);
    }
    expect(processor.process(undefined)).toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });

  it("retains only reviewed dated response-model identities for pricing attribution", () => {
    const processor = new V3PrivacySpanOutputProcessor();
    const datedEscalationSpan = {
      type: SpanType.MODEL_GENERATION,
      attributes: {
        provider: "openai.responses",
        model: "gpt-4o",
        responseModel: "gpt-4-1-2025-04-14",
        usage: {
          inputTokens: 12,
          outputTokens: 4
        }
      }
    } as unknown as AnySpan;
    const unreviewedVariantSpan = {
      type: SpanType.MODEL_GENERATION,
      attributes: {
        provider: "openai.responses",
        model: "gpt-4o",
        responseModel: "gpt-4.1-mini-2025-04-14",
        usage: {
          inputTokens: 12,
          outputTokens: 4
        }
      }
    } as unknown as AnySpan;

    processor.process(datedEscalationSpan);
    processor.process(unreviewedVariantSpan);

    expect(datedEscalationSpan.attributes).toEqual({
      provider: "openai",
      model: "gpt-4o",
      responseModel: "gpt-4.1-2025-04-14",
      usage: {
        inputTokens: 12,
        outputTokens: 4
      }
    });
    expect(unreviewedVariantSpan.attributes).toEqual({
      provider: "openai",
      model: "gpt-4o",
      usage: {
        inputTokens: 12,
        outputTokens: 4
      }
    });
  });

  it("keeps model usage only on model-generation spans", () => {
    const processor = new V3PrivacySpanOutputProcessor();
    const attributes = {
      provider: "openai",
      model: "gpt-4o",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        inputDetails: { text: 10 },
        outputDetails: { text: 4 }
      }
    };
    const genericSpan = {
      type: SpanType.GENERIC,
      attributes
    } as unknown as AnySpan;
    const inconsistentModelSpan = {
      type: SpanType.MODEL_GENERATION,
      attributes: {
        ...attributes,
        usage: {
          ...attributes.usage,
          inputDetails: { cacheRead: 11 }
        }
      }
    } as unknown as AnySpan;
    const unsupportedProviderSpan = {
      type: SpanType.MODEL_GENERATION,
      attributes: {
        ...attributes,
        provider: "openai.unreviewed"
      }
    } as unknown as AnySpan;

    processor.process(genericSpan);
    processor.process(inconsistentModelSpan);
    processor.process(unsupportedProviderSpan);

    expect(genericSpan.attributes).toEqual({});
    expect(inconsistentModelSpan.attributes).toEqual({
      provider: "openai",
      model: "gpt-4o"
    });
    expect(unsupportedProviderSpan.attributes).toEqual({
      model: "gpt-4o",
      usage: attributes.usage
    });
  });

  it("auto-extracts approved native token metrics from a bounded model span", async () => {
    const delegate = new RecordingExporter();
    const modelCostMetricRecorder = vi.fn();
    const observability = new Observability({
      configs: {
        default: {
          serviceName: "governed-investment-assistant-v3",
          sampling: { type: SamplingStrategyType.ALWAYS },
          exporters: [
            new V3PrivacyBoundStorageExporter(delegate, {
              modelCostMetricRecorder
            })
          ],
          spanOutputProcessors: [new V3PrivacySpanOutputProcessor()]
        }
      }
    });

    try {
      const instance = observability.getDefaultInstance();
      const span = instance?.startSpan({
        name: "usage",
        type: SpanType.MODEL_GENERATION,
        entityType: EntityType.AGENT,
        entityName: "public-research-writer",
        attributes: {
          provider: "openai.responses",
          model: "gpt-4o"
        }
      });
      expect(span).toBeDefined();
      span?.end({
        attributes: {
          provider: "openai.responses",
          model: "gpt-4o",
          responseModel: "gpt-4o",
          usage: {
            inputTokens: 12,
            outputTokens: 9,
            inputDetails: { text: 10, cacheRead: 2 },
            outputDetails: { text: 7, reasoning: 2 }
          }
        }
      });
      await observability.flush();
      await vi.waitFor(() => {
        expect(delegate.metrics.length).toBeGreaterThanOrEqual(6);
      });

      expect(
        delegate.metrics.map(({ metric }) => [metric.name, metric.value])
      ).toEqual(expect.arrayContaining([
        ["mastra_model_total_input_tokens", 12],
        ["mastra_model_total_output_tokens", 9],
        ["mastra_model_input_text_tokens", 10],
        ["mastra_model_input_cache_read_tokens", 2],
        ["mastra_model_output_text_tokens", 7],
        ["mastra_model_output_reasoning_tokens", 2]
      ]));
      for (const metricName of [
        "mastra_model_total_input_tokens",
        "mastra_model_total_output_tokens"
      ]) {
        const metric = delegate.metrics.find(
          ({ metric: candidate }) => candidate.name === metricName
        )?.metric;
        expect(metric?.costContext).toMatchObject({
          provider: "openai",
          model: "gpt-4o",
          costUnit: "USD"
        });
        expect(metric?.costContext?.estimatedCost).toBeGreaterThan(0);
      }
      expect(modelCostMetricRecorder).toHaveBeenCalledTimes(2);
      expect(modelCostMetricRecorder.mock.calls.map(([metric]) => metric))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            provider: "openai",
            model: "gpt-4o",
            kind: "input",
            estimatedCostUsd: expect.any(Number)
          }),
          expect.objectContaining({
            provider: "openai",
            model: "gpt-4o",
            kind: "output",
            estimatedCostUsd: expect.any(Number)
          })
        ]));
    } finally {
      await observability.shutdown();
    }
  });

  it("attributes escalation cost to the dated response model, not the wrapper model", async () => {
    const delegate = new RecordingExporter();
    const modelCostMetricRecorder = vi.fn();
    const observability = new Observability({
      configs: {
        default: {
          serviceName: "governed-investment-assistant-v3",
          sampling: { type: SamplingStrategyType.ALWAYS },
          exporters: [
            new V3PrivacyBoundStorageExporter(delegate, {
              modelCostMetricRecorder
            })
          ],
          spanOutputProcessors: [new V3PrivacySpanOutputProcessor()]
        }
      }
    });

    try {
      const instance = observability.getDefaultInstance();
      const span = instance?.startSpan({
        name: "escalated-usage",
        type: SpanType.MODEL_GENERATION,
        entityType: EntityType.AGENT,
        entityName: "public-research-writer",
        attributes: {
          // The locked dynamic model is represented by its primary wrapper
          // until the provider reports which reviewed model served the call.
          provider: "openai.responses",
          model: "gpt-4o"
        }
      });
      expect(span).toBeDefined();
      span?.end({
        attributes: {
          provider: "openai.responses",
          model: "gpt-4o",
          responseModel: "gpt-4.1-2025-04-14",
          usage: {
            inputTokens: 12,
            outputTokens: 9,
            inputDetails: { text: 12 },
            outputDetails: { text: 9 }
          }
        }
      });
      await observability.flush();
      await vi.waitFor(() => {
        expect(delegate.metrics.length).toBeGreaterThanOrEqual(4);
      });

      for (const metricName of [
        "mastra_model_total_input_tokens",
        "mastra_model_total_output_tokens"
      ]) {
        const metric = delegate.metrics.find(
          ({ metric: candidate }) => candidate.name === metricName
        )?.metric;
        expect(metric?.costContext).toMatchObject({
          provider: "openai",
          model: "gpt-4.1",
          costUnit: "USD"
        });
        expect(metric?.costContext?.estimatedCost).toBeGreaterThan(0);
      }
      expect(modelCostMetricRecorder).toHaveBeenCalledTimes(2);
      expect(modelCostMetricRecorder.mock.calls.map(([metric]) => metric))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            provider: "openai",
            model: "gpt-4.1",
            kind: "input",
            estimatedCostUsd: expect.any(Number)
          }),
          expect.objectContaining({
            provider: "openai",
            model: "gpt-4.1",
            kind: "output",
            estimatedCostUsd: expect.any(Number)
          })
        ]));
    } finally {
      await observability.shutdown();
    }
  });

  it("configures persistent storage export, always sampling, bounded data, and info logs", async () => {
    const observability = createV3Observability();
    try {
      const instance = observability.getDefaultInstance();
      expect(instance).toBeDefined();
      const config = instance?.getConfig();
      expect(config).toMatchObject({
        serviceName: "governed-investment-assistant-v3",
        sampling: { type: SamplingStrategyType.ALWAYS },
        serializationOptions: V3_OBSERVABILITY_SERIALIZATION_LIMITS,
        logging: {
          enabled: true,
          level: "info"
        }
      });
      expect(instance?.getExporters().map(({ name }) => name)).toEqual([
        V3_PRIVACY_BOUND_EXPORTER_NAME
      ]);
      expect(instance?.getSpanOutputProcessors().map(({ name }) => name)).toEqual([
        "assistant-v3-privacy-boundary",
        "sensitive-data-filter"
      ]);
      const cardinality = (
        instance as unknown as {
          cardinalityFilter: {
            filterLabels(labels: Record<string, string>): Record<string, string>;
          };
        }
      ).cardinalityFilter;
      expect(cardinality.filterLabels({
        workflow: "public_research_v3",
        request_id: "request-private",
        principal_ref: "principal-private",
        symbol: "NVDA",
        arbitrary_uuid: "00000000-0000-4000-8000-000000000001"
      })).toEqual({
        workflow: "public_research_v3"
      });
      expect(V3_OBSERVABILITY_BLOCKED_LABELS).toEqual(expect.arrayContaining([
        "trace_id",
        "request_id",
        "principal_ref",
        "symbol",
        "url"
      ]));
    } finally {
      await observability.shutdown();
    }
  });

  it("sanitizes every non-tracing signal before storage", async () => {
    const delegate = new RecordingExporter();
    const exporter = new V3PrivacyBoundStorageExporter(delegate);
    const unsafeUrl = "https://private.example/account/123";
    const unsafePrompt = "Should I buy 100 NVDA shares?";
    const unsafeEmail = "alice.private@example.com";
    const unsafeUuid = "00000000-0000-4000-8000-000000000001";
    const unsafeIdentifiers = [
      "user-private",
      "organization-private",
      "resource-private",
      "run-private",
      "session-private",
      "thread-private",
      "request-private",
      "experiment-private",
      "version-private",
      "source-private",
      "args-private",
      "raw-error-private"
    ] as const;
    const correlationContext = {
      traceId: unsafeUuid,
      spanId: unsafeUuid,
      entityType: EntityType.AGENT,
      entityId: "public-research-writer",
      entityName: "public-research-writer",
      entityVersionId: "version-private",
      parentEntityType: EntityType.WORKFLOW_RUN,
      parentEntityId: "public-research-v3",
      parentEntityName: "public-research-v3",
      parentEntityVersionId: "version-private",
      rootEntityType: EntityType.WORKFLOW_RUN,
      rootEntityId: "assistant-request-v3",
      rootEntityName: "assistant-request-v3",
      rootEntityVersionId: "version-private",
      userId: "user-private",
      organizationId: "organization-private",
      resourceId: "resource-private",
      runId: "run-private",
      sessionId: "session-private",
      threadId: "thread-private",
      requestId: "request-private",
      environment: "development",
      source: "source-private",
      serviceName: "governed-investment-assistant-v3",
      experimentId: "experiment-private",
      tags: [unsafeUrl, unsafeEmail]
    };
    const timestamp = new Date("2026-07-23T10:00:00.000Z");

    await exporter.onLogEvent({
      type: "log",
      log: {
        logId: "log-system",
        timestamp,
        traceId: "trace-system",
        spanId: "span-system",
        level: "error",
        message: `${unsafePrompt} ${unsafeEmail} ${unsafeUrl}`,
        data: {
          event: "request_received",
          outcome: "success",
          workflow: "public_research_v3",
          durationMs: 25,
          url: unsafeUrl,
          prompt: unsafePrompt,
          email: unsafeEmail,
          requestId: "request-private",
          args: "args-private",
          error: "raw-error-private",
          uuid: unsafeUuid
        },
        tags: [unsafePrompt],
        correlationContext,
        metadata: { email: unsafeEmail }
      }
    });
    await exporter.onMetricEvent({
      type: "metric",
      metric: {
        metricId: "metric-system",
        timestamp,
        traceId: "trace-system",
        name: `assistant_${unsafeUrl}_${unsafeEmail}_${unsafeUuid}`,
        value: 1,
        labels: {
          workflow: "public_research_v3",
          result: "success",
          prompt: unsafePrompt,
          url: unsafeUrl,
          user_id: "user-private",
          arbitrary_uuid: unsafeUuid
        },
        correlationContext,
        costContext: {
          provider: "openai",
          model: "gpt-4-1-2025-04-14",
          estimatedCost: 0.01,
          costUnit: "usd",
          costMetadata: {
            prompt: unsafePrompt,
            url: unsafeUrl
          }
        },
        metadata: { email: unsafeEmail }
      }
    });
    await exporter.onMetricEvent({
      type: "metric",
      metric: {
        metricId: "metric-model-input-tokens",
        timestamp,
        traceId: "trace-system",
        spanId: "span-system",
        name: "mastra_model_total_input_tokens",
        value: 321,
        labels: {
          provider: "openai",
          model: "gpt-4o",
          kind: "input",
          prompt: unsafePrompt,
          request_id: "request-private"
        },
        correlationContext,
        costContext: {
          provider: "openai",
          model: "gpt-4o",
          estimatedCost: 0.001,
          costUnit: "USD"
        }
      }
    });
    await exporter.onMetricEvent({
      type: "metric",
      metric: {
        metricId: "metric-unapproved-token-name",
        timestamp,
        name: "customer_token_usage",
        value: 999,
        labels: {
          provider: "openai",
          model: "gpt-4o",
          kind: "input"
        }
      }
    });
    await exporter.onScoreEvent({
      type: "score",
      score: {
        scoreId: "score-system",
        timestamp,
        traceId: "trace-system",
        scorerId: unsafeUuid,
        scorerName: unsafeEmail,
        scorerVersion: "version-private",
        source: "live",
        scoreSource: "live",
        score: 1,
        reason: `${unsafePrompt} ${unsafeUrl} ${unsafeUuid}`,
        experimentId: "experiment-private",
        scoreTraceId: "request-private",
        targetEntityType: EntityType.AGENT,
        correlationContext,
        metadata: {
          prompt: unsafePrompt,
          error: "raw-error-private"
        }
      }
    });
    await exporter.onScoreEvent({
      type: "score",
      score: {
        scoreId: "score-approved",
        timestamp,
        scorerId: "v3.agent.direct-tool-grounding",
        source: "live",
        scoreSource: "live",
        score: 1,
        reason:
          "pass: signed_tool_envelope_verified. Successful tool results: 1."
      }
    });
    await exporter.onFeedbackEvent({
      type: "feedback",
      feedback: {
        feedbackId: "feedback-system",
        timestamp,
        traceId: "trace-system",
        source: "source-private",
        feedbackSource: "source-private",
        feedbackType: "correction",
        value: `${unsafePrompt} ${unsafeEmail} ${unsafeUrl} ${unsafeUuid}`,
        userId: "user-private",
        feedbackUserId: "user-private",
        comment: unsafePrompt,
        sourceId: "resource-private",
        experimentId: "experiment-private",
        correlationContext,
        metadata: { url: unsafeUrl }
      }
    });
    await exporter.onFeedbackEvent({
      type: "feedback",
      feedback: {
        feedbackId: "feedback-approved",
        timestamp,
        feedbackType: "thumbs",
        value: "up"
      }
    });

    expect(delegate.logs).toHaveLength(1);
    expect(delegate.logs[0]?.log).toEqual({
      logId: "log-system",
      timestamp,
      traceId: "trace-system",
      spanId: "span-system",
      level: "error",
      message: V3_TRACE_REDACTION_MARKER,
      data: {
        event: "request_received",
        outcome: "success",
        workflow: "public_research_v3",
        durationMs: 25
      },
      correlationContext: {
        entityType: "agent",
        parentEntityType: "workflow_run",
        rootEntityType: "workflow_run",
        entityId: "public-research-writer",
        entityName: "public-research-writer",
        parentEntityId: "public-research-v3",
        parentEntityName: "public-research-v3",
        rootEntityId: "assistant-request-v3",
        rootEntityName: "assistant-request-v3",
        environment: "development",
        serviceName: "governed-investment-assistant-v3"
      }
    });
    expect(delegate.metrics[0]?.metric).toMatchObject({
      name: "assistant_v3_redacted_metric",
      labels: {
        workflow: "public_research_v3",
        result: "success"
      },
      costContext: {
        provider: "openai",
        model: "gpt-4.1",
        estimatedCost: 0.01,
        costUnit: "USD"
      }
    });
    expect(delegate.metrics[1]?.metric).toMatchObject({
      name: "mastra_model_total_input_tokens",
      value: 321,
      labels: {
        provider: "openai",
        model: "gpt-4o",
        kind: "input"
      },
      costContext: {
        provider: "openai",
        model: "gpt-4o",
        estimatedCost: 0.001,
        costUnit: "USD"
      }
    });
    expect(V3_APPROVED_MODEL_TOKEN_METRIC_NAMES).toContain(
      "mastra_model_total_input_tokens"
    );
    expect(delegate.metrics[2]?.metric.name).toBe(
      "assistant_v3_redacted_metric"
    );
    expect(delegate.scores[0]?.score).toMatchObject({
      scorerId: "v3.score.redacted",
      score: 1,
      source: "live",
      scoreSource: "live",
      reason: V3_TRACE_REDACTION_MARKER,
      targetEntityType: "agent"
    });
    expect(delegate.scores[1]?.score).toMatchObject({
      scorerId: "v3.agent.direct-tool-grounding",
      score: 1,
      source: "live",
      scoreSource: "live",
      reason: "pass:signed_tool_envelope_verified"
    });
    expect(delegate.feedback[0]?.feedback).toMatchObject({
      feedbackType: "redacted",
      value: V3_TRACE_REDACTION_MARKER
    });
    expect(delegate.feedback[1]?.feedback).toMatchObject({
      feedbackType: "thumbs",
      value: "up"
    });

    const persisted = JSON.stringify({
      logs: delegate.logs,
      metrics: delegate.metrics,
      scores: delegate.scores,
      feedback: delegate.feedback
    });
    for (const forbidden of [
      unsafeUrl,
      unsafePrompt,
      unsafeEmail,
      unsafeUuid,
      ...unsafeIdentifiers
    ]) {
      expect(persisted).not.toContain(forbidden);
    }
    expect(persisted).not.toContain("costMetadata");
    expect(persisted).not.toContain("metadata");
    expect(persisted).not.toContain("comment");
    expect(persisted).not.toContain("feedbackUserId");
  });

  it("retains every reviewed direct-agent comparison and no-tool scorer reason", async () => {
    const delegate = new RecordingExporter();
    const exporter = new V3PrivacyBoundStorageExporter(delegate);
    const timestamp = new Date("2026-07-23T10:00:00.000Z");
    const cases = [
      {
        status: "pass",
        code: "signed_two_instrument_research_envelopes_verified",
        successful: 2,
        score: 1
      },
      {
        status: "fail",
        code: "tool_not_semantically_authorized_for_current_query",
        successful: 1,
        score: 0
      },
      {
        status: "not_applicable",
        code: "reviewed_no_tool_rebalance_education",
        successful: 0,
        score: 0
      },
      {
        status: "not_applicable",
        code: "reviewed_no_tool_allocation_clarification",
        successful: 0,
        score: 0
      },
      {
        status: "not_applicable",
        code: "reviewed_no_tool_instrument_clarification",
        successful: 0,
        score: 0
      }
    ] as const;

    for (const [index, item] of cases.entries()) {
      await exporter.onScoreEvent({
        type: "score",
        score: {
          scoreId: `score-reviewed-${index}`,
          timestamp,
          scorerId: "v3.agent.direct-tool-grounding",
          source: "live",
          scoreSource: "live",
          score: item.score,
          reason:
            `${item.status}: ${item.code}. Successful tool results: ${item.successful}.`
        }
      });
    }

    expect(delegate.scores.map(({ score }) => score.reason)).toEqual(
      cases.map(({ status, code }) => `${status}:${code}`)
    );
    expect(delegate.scores).not.toContainEqual(
      expect.objectContaining({
        score: expect.objectContaining({ reason: V3_TRACE_REDACTION_MARKER })
      })
    );
  });

  it("delegates tracing and exporter lifecycle while preserving only exact approved log messages", async () => {
    const delegate = new RecordingExporter();
    const exporter = new V3PrivacyBoundStorageExporter(delegate);
    const initOptions = {} satisfies InitExporterOptions;
    const logger = {} as IMastraLogger;
    const trace = {
      type: "span_started",
      span: { id: "span-system" }
    } as unknown as TracingEvent;
    const timestamp = new Date("2026-07-23T10:00:00.000Z");

    await exporter.init(initOptions);
    exporter.__setLogger(logger);
    await exporter.onTracingEvent(trace);
    await exporter.onLogEvent({
      type: "log",
      log: {
        logId: "log-approved",
        timestamp,
        level: "info",
        message: "request_received"
      }
    });
    await exporter.flush();
    await exporter.shutdown();

    expect(delegate.initOptions).toBe(initOptions);
    expect(delegate.logger).toBe(logger);
    expect(delegate.tracing).toEqual([trace]);
    expect(delegate.logs[0]?.log.message).toBe("request_received");
    expect(V3_APPROVED_OBSERVABILITY_LOG_MESSAGES).toContain("request_received");
    expect(delegate.flushCount).toBe(1);
    expect(delegate.shutdownCount).toBe(1);
  });

  it("keeps complete log messages for the isolated private Studio exporter", async () => {
    const delegate = new RecordingExporter();
    const exporter = new V3PrivacyBoundStorageExporter(delegate, {
      retainLogMessages: true
    });
    const timestamp = new Date("2026-07-23T10:00:00.000Z");
    const message = "Agent received: What is the current NVDA price?";

    await exporter.onLogEvent({
      type: "log",
      log: {
        logId: "log-private-studio",
        timestamp,
        level: "info",
        message
      }
    });

    expect(delegate.logs[0]?.log.message).toBe(message);
  });

  it("supports only the reviewed app and private-Studio service identities", async () => {
    const studio = createV3Observability({
      serviceName: "governed-investment-assistant-v3-studio"
    });
    try {
      expect(studio.getDefaultInstance()?.getConfig().serviceName).toBe(
        "governed-investment-assistant-v3-studio"
      );
      const processors = studio.getDefaultInstance()?.getSpanOutputProcessors() ?? [];
      const span = {
        input: {
          message: "What is the current NVDA price?",
          credential: "private-studio-secret"
        },
        output: {
          response: "private output"
        }
      } as unknown as AnySpan;
      const projected = processors.reduce<AnySpan | undefined>(
        (current, processor) => processor.process(current),
        span
      ) as unknown as {
        input?: Record<string, unknown>;
        output?: unknown;
      };
      expect(projected.input).toEqual({
        message: "What is the current NVDA price?",
        credential: V3_TRACE_REDACTION_MARKER
      });
      expect(projected.output).toEqual({
        response: "private output"
      });
    } finally {
      await studio.shutdown();
    }

    expect(() => createV3Observability({
      serviceName: "customer-controlled" as never
    })).toThrow("service name is not approved");
  });
});
