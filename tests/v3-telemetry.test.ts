import { describe, expect, it } from "vitest";
import {
  V3_COMPONENTS,
  V3_CONVERSATION_MEMORY_OPERATIONS,
  V3_FAILURE_REASONS,
  V3_GATES,
  V3_INTENTS,
  V3_LOCALES,
  V3_METRIC_LABEL_DOMAINS,
  V3_MODEL_TOKEN_KINDS,
  V3_OPERATIONS,
  V3_PROVIDERS,
  V3_TOOLS,
  V3_WRITER_AGENTS,
  V3_WORKFLOWS,
  V3TelemetryMetrics,
  allowlistedTraceAttributes,
  buildRedactedLogEvent,
  redactTelemetryData,
  type V3Component,
  type V3ConversationMemoryOperation,
  type V3FailureReason,
  type V3Gate,
  type V3Intent,
  type V3Locale,
  type V3Operation,
  type V3Provider,
  type V3Tool,
  type V3WriterAgent,
  type V3Workflow
} from "../src/assistant-v3/telemetry.js";
import { V3_OPENAI_MODEL_IDS } from "../src/assistant-v3/model-policy.js";
import { OperationalMetrics } from "../src/services/operational-metrics.js";

const FIXED_NOW = Date.parse("2026-07-22T10:30:00.000Z");

function createTelemetry(): V3TelemetryMetrics {
  return new V3TelemetryMetrics(new OperationalMetrics({
    prefix: "investment_assistant_test",
    now: () => FIXED_NOW,
    latencyBucketsMs: [10, 100, 1_000],
    maxSeriesPerMetric: 500
  }));
}

describe("V3TelemetryMetrics", () => {
  it("records counters and histograms using finite, approved label domains only", () => {
    const telemetry = createTelemetry();

    telemetry.recordRequest({
      intent: "market_research",
      workflow: "public_research_v3",
      locale: "en-US"
    });
    telemetry.recordWorkflow({
      workflow: "public_research_v3",
      result: "success",
      durationMs: 87
    });
    telemetry.recordProvider({
      provider: "market_facade",
      operation: "market_snapshot",
      result: "timeout",
      durationMs: 245,
      cache: "miss"
    });
    telemetry.recordTool({ tool: "read-market-snapshot", result: "success" });
    telemetry.recordTool({
      tool: "analyze-portfolio-allocation",
      result: "success"
    });
    telemetry.recordAgent({
      agent: "public-research-writer",
      result: "success"
    });
    telemetry.recordModelUsage({
      provider: "openai",
      model: "gpt-4o",
      workflow: "public_research_v3",
      agent: "public-research-writer",
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 20,
        reasoningOutputTokens: 5
      }
    });
    telemetry.recordConversationMemory({
      operation: "read",
      result: "success",
      durationMs: 2,
      outcome: "hit"
    });
    telemetry.recordConversationMemory({
      operation: "write",
      result: "success",
      durationMs: 3
    });
    telemetry.recordConversationMemory({
      operation: "clear",
      result: "success",
      durationMs: 1
    });
    telemetry.recordGate({ gate: "required_tool", passed: true, intent: "market_research" });
    telemetry.recordFallback({ component: "response_composer", reason: "fallback_renderer" });

    const snapshot = telemetry.snapshot();
    expect(snapshot.generatedAt).toBe("2026-07-22T10:30:00.000Z");
    expect(snapshot.counters).toContainEqual(expect.objectContaining({
      name: "investment_assistant_test_requests_total",
      labels: { intent: "market_research", route: "public_research_v3", locale: "en-US" },
      value: 1
    }));
    expect(snapshot.counters).toContainEqual(expect.objectContaining({
      name: "investment_assistant_test_evaluations_total",
      labels: { evaluation: "required_tool", result: "pass", intent: "market_research" }
    }));
    expect(snapshot.counters).toContainEqual(expect.objectContaining({
      name: "investment_assistant_test_tool_calls_total",
      labels: {
        tool: "analyze-portfolio-allocation",
        result: "success"
      },
      value: 1
    }));
    expect(snapshot.counters).toContainEqual(expect.objectContaining({
      name: "investment_assistant_test_model_tokens_total",
      labels: {
        provider: "openai",
        model: "gpt-4o",
        workflow: "public_research_v3",
        agent: "public-research-writer",
        kind: "input"
      },
      value: 120
    }));
    expect(snapshot.histograms).toContainEqual(expect.objectContaining({
      name: "investment_assistant_test_provider_duration_ms",
      labels: { provider: "market_facade", operation: "market_snapshot" },
      count: 1,
      sum: 245
    }));
    expect(snapshot.counters).toContainEqual(expect.objectContaining({
      name: "investment_assistant_test_provider_requests_total",
      labels: {
        provider: "conversation_context_memory",
        operation: "conversation_memory_read",
        result: "success"
      },
      value: 1
    }));
    expect(snapshot.counters).toContainEqual(expect.objectContaining({
      name: "investment_assistant_test_provider_cache_total",
      labels: {
        provider: "conversation_context_memory",
        operation: "conversation_memory_read",
        result: "hit"
      },
      value: 1
    }));

    const approvedValues = new Set<string>([
      ...V3_WORKFLOWS,
      ...V3_INTENTS,
      ...V3_LOCALES,
      ...V3_PROVIDERS,
      ...V3_OPENAI_MODEL_IDS,
      ...V3_MODEL_TOKEN_KINDS,
      ...V3_OPERATIONS,
      ...V3_TOOLS,
      ...V3_WRITER_AGENTS,
      ...V3_GATES,
      ...V3_FAILURE_REASONS,
      ...V3_COMPONENTS,
      ...V3_CONVERSATION_MEMORY_OPERATIONS,
      ...V3_METRIC_LABEL_DOMAINS.workflowResult,
      ...V3_METRIC_LABEL_DOMAINS.providerResult,
      ...V3_METRIC_LABEL_DOMAINS.executionResult,
      ...V3_METRIC_LABEL_DOMAINS.cacheResult,
      ...V3_METRIC_LABEL_DOMAINS.gateResult
    ]);
    for (const point of [...snapshot.counters, ...snapshot.gauges, ...snapshot.histograms]) {
      for (const value of Object.values(point.labels)) expect(approvedValues.has(value)).toBe(true);
    }
  });

  it("rejects IDs, symbols, messages, URLs, account data, and exception text as metric labels", () => {
    const telemetry = createTelemetry();
    const attempts: Array<() => void> = [
      () => telemetry.recordRequest({
        intent: "request-01HZX9QWERTY" as V3Intent,
        workflow: "public_research_v3",
        locale: "en-US"
      }),
      () => telemetry.recordRequest({
        intent: "market_research",
        workflow: "principal-9981" as V3Workflow,
        locale: "en-US"
      }),
      () => telemetry.recordRequest({
        intent: "market_research",
        workflow: "public_research_v3",
        locale: "https://private.example/client" as V3Locale
      }),
      () => telemetry.recordProvider({
        provider: "https://market.example/quote" as V3Provider,
        operation: "market_snapshot",
        result: "success",
        durationMs: 1
      }),
      () => telemetry.recordProvider({
        provider: "market_facade",
        operation: "account-0000137010001944" as V3Operation,
        result: "success",
        durationMs: 1
      }),
      () => telemetry.recordTool({ tool: "NVDA" as V3Tool, result: "success" }),
      () => telemetry.recordAgent({
        agent: "request-private" as V3WriterAgent,
        result: "success"
      }),
      () => telemetry.recordModelUsage({
        provider: "openai",
        model: "client-private-model" as never,
        workflow: "public_research_v3",
        agent: "public-research-writer",
        usage: { inputTokens: 1, outputTokens: 1 }
      }),
      () => telemetry.recordModelUsage({
        provider: "openai",
        model: "gpt-4o",
        workflow: "principal-private" as V3Workflow,
        agent: "public-research-writer",
        usage: { inputTokens: 1, outputTokens: 1 }
      }),
      () => telemetry.recordGate({
        gate: "Error: upstream returned client secret" as V3Gate,
        passed: false,
        intent: "market_research"
      }),
      () => telemetry.recordFallback({
        component: "user said buy ten shares" as V3Component,
        reason: "fallback_renderer"
      }),
      () => telemetry.recordFallback({
        component: "response_composer",
        reason: "Bearer very-private-token" as V3FailureReason
      }),
      () => telemetry.recordConversationMemory({
        operation: "conversation-private-91" as V3ConversationMemoryOperation,
        result: "success",
        durationMs: 1
      })
    ];

    for (const attempt of attempts) expect(attempt).toThrow("approved bounded label");
    expect(telemetry.snapshot().counters).toEqual([]);
    expect(telemetry.snapshot().histograms).toEqual([]);
  });

  it("rejects non-finite, negative, or out-of-policy histogram observations", () => {
    const telemetry = createTelemetry();
    for (const durationMs of [Number.NaN, Number.POSITIVE_INFINITY, -1, 600_001]) {
      expect(() => telemetry.recordWorkflow({
        workflow: "assistant_request_v3",
        result: "error",
        durationMs
      })).toThrow("durationMs must be between 0 and 600000");
    }
    expect(telemetry.snapshot().counters).toEqual([]);
    expect(telemetry.snapshot().histograms).toEqual([]);
  });

  it("rejects invalid model usage atomically before writing any token series", () => {
    for (const invalid of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
      10_000_001
    ]) {
      const telemetry = createTelemetry();
      expect(() => telemetry.recordModelUsage({
        provider: "openai",
        model: "gpt-4o",
        workflow: "public_research_v3",
        agent: "public-research-writer",
        usage: { inputTokens: 10, outputTokens: invalid }
      })).toThrow("non-negative safe integer");
      expect(telemetry.snapshot().counters).toEqual([]);
    }

    const telemetry = createTelemetry();
    expect(() => telemetry.recordModelUsage({
      provider: "openai",
      model: "gpt-4o",
      workflow: "public_research_v3",
      agent: "public-research-writer",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 11
      }
    })).toThrow("cannot exceed");
    expect(telemetry.snapshot().counters).toEqual([]);
  });

  it("exports Prometheus data without introducing request-specific dimensions", () => {
    const telemetry = createTelemetry();
    telemetry.recordRequest({
      intent: "approved_knowledge",
      workflow: "approved_knowledge_v3",
      locale: "az-AZ"
    });
    telemetry.recordTool({ tool: "retrieve-approved-product-knowledge", result: "success" });
    telemetry.recordConversationMemory({
      operation: "read",
      result: "success",
      durationMs: 1,
      outcome: "miss"
    });
    telemetry.recordModelUsage({
      provider: "openai",
      model: "gpt-4.1",
      workflow: "approved_knowledge_v3",
      agent: "approved-knowledge-writer",
      usage: { inputTokens: 90, outputTokens: 24 }
    });

    const output = telemetry.toPrometheus();
    expect(output).toContain('intent="approved_knowledge"');
    expect(output).toContain('route="approved_knowledge_v3"');
    expect(output).toContain('tool="retrieve-approved-product-knowledge"');
    expect(output).toContain('provider="conversation_context_memory"');
    expect(output).toContain('operation="conversation_memory_read"');
    expect(output).toContain('result="miss"');
    expect(output).toContain("investment_assistant_test_model_tokens_total");
    expect(output).toContain('model="gpt-4.1"');
    expect(output).toContain('kind="input"');
    for (const forbiddenLabel of [
      "request_id=",
      "principal_id=",
      "client_id=",
      "account=",
      "symbol=",
      "message=",
      "url=",
      "exception="
    ]) {
      expect(output.toLowerCase()).not.toContain(forbiddenLabel);
    }
  });
});

describe("V3 structured telemetry privacy", () => {
  it("recursively removes raw client, account, session, query, token, message, and contact data", () => {
    const raw = {
      requestId: "req-01J4PRIVATE",
      clientId: "client-private-7182",
      account: "AZ21NABZ00000000137010001944",
      sessionId: "session-private-44",
      principalId: "principal-private-12",
      conversationId: "conversation-private-91",
      query: "Should I buy ten NVDA shares?",
      message: "My private portfolio is worth 10036 dollars",
      authorization: "Bearer super-private-auth-token",
      token: "sk_private_abcdefghijk123456",
      email: "person.private@example.com",
      callbackUrl: "https://private.example/callback?client=7182",
      cardNumber: "4111111111111111",
      error: {
        message: "Provider failed for account AZ21NABZ00000000137010001944",
        stack: "at https://private.example/source.ts:10"
      },
      status: "timeout",
      operation: "market_snapshot",
      retryCount: 2,
      note: "arbitrary user-controlled prose"
    };
    const cyclic: Record<string, unknown> = { ...raw };
    cyclic.self = cyclic;
    cyclic["person.private@example.com"] = "timeout";

    const event = buildRedactedLogEvent({
      level: "warn",
      event: "provider_completed",
      outcome: "unavailable",
      workflow: "public_research_v3",
      intent: "market_research",
      locale: "en-US",
      requestId: raw.requestId,
      failureReason: "provider_unavailable",
      diagnostics: cyclic,
      now: () => FIXED_NOW
    });
    const serialized = JSON.stringify(event);

    expect(event.timestamp).toBe("2026-07-22T10:30:00.000Z");
    expect(event.requestRef).toMatch(/^sha256:[a-f0-9]{24}$/u);
    expect(event.requestRef).not.toContain(raw.requestId);
    expect(event.diagnostics).toMatchObject({
      requestId: "[REDACTED]",
      clientId: "[REDACTED]",
      account: "[REDACTED]",
      sessionId: "[REDACTED]",
      principalId: "[REDACTED]",
      conversationId: "[REDACTED]",
      query: "[REDACTED]",
      message: "[REDACTED]",
      status: "timeout",
      operation: "market_snapshot",
      retryCount: 2,
      note: "[REDACTED_TEXT]",
      self: "[REDACTED_CYCLE]"
    });
    for (const secret of [
      raw.requestId,
      raw.clientId,
      raw.account,
      raw.sessionId,
      raw.principalId,
      raw.conversationId,
      raw.query,
      raw.message,
      raw.authorization,
      raw.token,
      raw.email,
      raw.callbackUrl,
      raw.cardNumber,
      raw.error.message,
      raw.error.stack,
      "person.private@example.com"
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("fails closed for arbitrary text, credential patterns, cycles, depth, and hostile objects", () => {
    const direct = redactTelemetryData({
      status: "https://private.example/resource",
      reason: "person.private@example.com",
      code: "sk_private_abcdefghijk123456",
      description: "this is arbitrary exception text",
      nested: { request_id: "req-private-snake-case" }
    });
    const serialized = JSON.stringify(direct);
    expect(serialized).not.toContain("https://private.example/resource");
    expect(serialized).not.toContain("person.private@example.com");
    expect(serialized).not.toContain("sk_private_abcdefghijk123456");
    expect(serialized).not.toContain("this is arbitrary exception text");
    expect(serialized).not.toContain("req-private-snake-case");

    const hostile = new Proxy({}, {
      getPrototypeOf(): never {
        throw new Error("must not escape from the logger");
      }
    });
    expect(redactTelemetryData(hostile)).toBe("[REDACTED_OBJECT]");

    let deep: Record<string, unknown> = { status: "success" };
    for (let index = 0; index < 12; index += 1) deep = { nested: deep };
    expect(JSON.stringify(redactTelemetryData(deep))).toContain("[REDACTED_DEPTH]");
  });

  it("allows only bounded trace attributes and drops identifiers, symbols, URLs, messages, and errors", () => {
    const attributes = allowlistedTraceAttributes({
      "assistant.workflow": "public_research_v3",
      "assistant.intent": "market_research",
      "assistant.locale": "en-US",
      "assistant.provider": "market_facade",
      "assistant.operation": "market_snapshot",
      "assistant.tool": "analyze-portfolio-allocation",
      "assistant.gate": "required_tool",
      "assistant.failure_reason": "provider_unavailable",
      "assistant.outcome": "unavailable",
      "assistant.environment": "production",
      "assistant.data_class": "public",
      "assistant.cache": "miss",
      "assistant.retryable": true,
      "assistant.request_id": "req-private-123",
      "assistant.principal_id": "principal-private-12",
      "assistant.account": "AZ21NABZ00000000137010001944",
      "assistant.symbol": "NVDA",
      "assistant.message": "buy ten shares",
      "assistant.url": "https://private.example/quote",
      "assistant.exception": "Error: private provider detail",
      "http.request.header.authorization": "Bearer private-token"
    });

    expect(attributes).toEqual({
      "assistant.workflow": "public_research_v3",
      "assistant.intent": "market_research",
      "assistant.locale": "en-US",
      "assistant.provider": "market_facade",
      "assistant.operation": "market_snapshot",
      "assistant.tool": "analyze-portfolio-allocation",
      "assistant.gate": "required_tool",
      "assistant.failure_reason": "provider_unavailable",
      "assistant.outcome": "unavailable",
      "assistant.environment": "production",
      "assistant.data_class": "public",
      "assistant.cache": "miss",
      "assistant.retryable": true
    });
    const serialized = JSON.stringify(attributes);
    for (const secret of [
      "req-private-123",
      "principal-private-12",
      "AZ21NABZ00000000137010001944",
      "NVDA",
      "buy ten shares",
      "https://private.example/quote",
      "Error: private provider detail",
      "Bearer private-token"
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("drops values outside an allowlisted trace attribute's finite domain", () => {
    expect(allowlistedTraceAttributes({
      "assistant.workflow": "req-123",
      "assistant.intent": "NVDA",
      "assistant.locale": "en-CLIENT-ID",
      "assistant.provider": "https://private.example",
      "assistant.outcome": "database exploded for account 123",
      "assistant.retryable": "true"
    })).toEqual({});
  });
});
