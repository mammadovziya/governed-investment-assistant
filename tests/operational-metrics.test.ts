import { describe, expect, it } from "vitest";
import { OperationalMetrics } from "../src/services/operational-metrics.js";

describe("OperationalMetrics", () => {
  it("records production request, workflow, provider, agent, tool, eval and fallback dimensions", () => {
    const metrics = new OperationalMetrics({
      now: () => Date.parse("2026-07-21T12:00:00.000Z"),
      latencyBucketsMs: [10, 100]
    });

    metrics.recordRequest({ intent: "company_analysis", route: "company-analysis", locale: "en-US" });
    metrics.recordRequest({ intent: "company_analysis", route: "company-analysis", locale: "en-US" });
    metrics.recordWorkflowResult({ workflow: "company-analysis", result: "success", durationMs: 85 });
    metrics.recordProviderRequest({
      provider: "yahoo",
      operation: "quote",
      result: "success",
      durationMs: 25,
      cache: "hit"
    });
    metrics.recordProviderRequest({
      provider: "yahoo",
      operation: "quote",
      result: "timeout",
      durationMs: 150,
      cache: "miss"
    });
    metrics.recordAgentRun({ agent: "market-analyst", result: "success" });
    metrics.recordToolCall({ tool: "get-market-snapshot", result: "success" });
    metrics.recordEvaluation({ evaluation: "citation-coverage", passed: false, intent: "company_analysis" });
    metrics.recordFallback({ component: "sentiment", reason: "provider_unavailable" });
    metrics.recordUnsupportedSection({ intent: "company_analysis", section: "sentiment" });
    metrics.setActiveRequests("company-analysis", 2);
    metrics.addActiveRequests("company-analysis", -1);
    metrics.setProviderCacheEntries("yahoo", 12);

    const snapshot = metrics.snapshot();
    expect(snapshot.generatedAt).toBe("2026-07-21T12:00:00.000Z");
    expect(snapshot.counters).toContainEqual(
      expect.objectContaining({
        name: "investment_assistant_requests_total",
        labels: { intent: "company_analysis", route: "company-analysis", locale: "en-US" },
        value: 2
      })
    );
    expect(snapshot.counters).toContainEqual(
      expect.objectContaining({
        name: "investment_assistant_provider_errors_total",
        labels: { provider: "yahoo", operation: "quote", result: "timeout" },
        value: 1
      })
    );
    expect(snapshot.gauges).toContainEqual(
      expect.objectContaining({ name: "investment_assistant_active_requests", value: 1 })
    );
    expect(snapshot.histograms).toContainEqual(
      expect.objectContaining({
        name: "investment_assistant_provider_duration_ms",
        count: 2,
        sum: 175,
        buckets: [
          { le: 10, count: 0 },
          { le: 100, count: 1 },
          { le: "+Inf", count: 2 }
        ]
      })
    );
  });

  it("exports valid Prometheus text with cumulative histograms and escaped labels", () => {
    const metrics = new OperationalMetrics({ latencyBucketsMs: [50, 100] });
    metrics.recordProviderRequest({
      provider: 'provider"one',
      operation: "quote\nlookup",
      result: "success",
      durationMs: 75,
      cache: "miss"
    });

    const output = metrics.toPrometheus();

    expect(output).toContain("# TYPE investment_assistant_provider_requests_total counter");
    expect(output).toContain('provider="provider\\"one"');
    expect(output).toContain('operation="quote\\nlookup"');
    expect(output).toContain('investment_assistant_provider_duration_ms_bucket{le="50"');
    expect(output).toContain('investment_assistant_provider_duration_ms_bucket{le="100"');
    expect(output).toContain('investment_assistant_provider_duration_ms_bucket{le="+Inf"');
    expect(output).toContain("investment_assistant_provider_duration_ms_sum");
    expect(output).toContain("investment_assistant_provider_duration_ms_count");
  });

  it("records provider-reported model token usage with bounded dimensions", () => {
    const metrics = new OperationalMetrics();
    metrics.recordModelTokenUsage({
      provider: "openai",
      model: "gpt-4o",
      workflow: "public_research_v3",
      agent: "public-research-writer",
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 20,
      reasoningOutputTokens: 5
    });
    metrics.recordModelEstimatedCost({
      provider: "openai",
      model: "gpt-4o",
      kind: "input",
      estimatedCostUsd: 0.0006
    });
    metrics.recordModelEstimatedCost({
      provider: "openai",
      model: "gpt-4o",
      kind: "output",
      estimatedCostUsd: 0.0004
    });

    const points = metrics.snapshot().counters.filter(
      (point) => point.name === "investment_assistant_model_tokens_total"
    );
    expect(points).toEqual(expect.arrayContaining([
      expect.objectContaining({
        labels: {
          provider: "openai",
          model: "gpt-4o",
          workflow: "public_research_v3",
          agent: "public-research-writer",
          kind: "input"
        },
        value: 120
      }),
      expect.objectContaining({
        labels: expect.objectContaining({ kind: "output" }),
        value: 30
      }),
      expect.objectContaining({
        labels: expect.objectContaining({ kind: "cached_input" }),
        value: 20
      }),
      expect.objectContaining({
        labels: expect.objectContaining({ kind: "reasoning_output" }),
        value: 5
      })
    ]));
    const output = metrics.toPrometheus();
    expect(output).toContain("# TYPE investment_assistant_model_tokens_total counter");
    expect(output).toContain(
      'investment_assistant_model_tokens_total{agent="public-research-writer",kind="input",model="gpt-4o",provider="openai",workflow="public_research_v3"} 120'
    );
    expect(output).toContain(
      "# TYPE investment_assistant_model_estimated_cost_usd_total counter"
    );
    expect(output).toContain(
      'investment_assistant_model_estimated_cost_usd_total{kind="input",model="gpt-4o",provider="openai"} 0.0006'
    );
    expect(output).toContain(
      'investment_assistant_model_estimated_cost_usd_total{kind="output",model="gpt-4o",provider="openai"} 0.0004'
    );
  });

  it("times a workflow once and clamps an active-request gauge at zero", () => {
    const times = [1_000, 1_125, 1_500];
    const metrics = new OperationalMetrics({ now: () => times.shift() ?? 1_500 });
    const finish = metrics.startWorkflowTimer("risk-analysis");

    expect(finish("success")).toBe(125);
    expect(finish("error")).toBe(0);
    expect(metrics.addActiveRequests("risk-analysis", -3)).toBe(0);

    const snapshot = metrics.snapshot();
    const resultCounter = snapshot.counters.find(
      (point) => point.name === "investment_assistant_workflow_results_total"
    );
    expect(resultCounter?.value).toBe(1);
  });

  it("completes an active-request lease once across finish/close style callbacks", () => {
    const metrics = new OperationalMetrics();
    const complete = metrics.startActiveRequest("api_chat");

    expect(complete()).toBe(0);
    expect(complete()).toBe(0);
    expect(metrics.snapshot().gauges).toContainEqual(
      expect.objectContaining({
        name: "investment_assistant_active_requests",
        labels: { route: "api_chat" },
        value: 0
      })
    );
  });

  it("bounds metric label cardinality with a single overflow series", () => {
    const metrics = new OperationalMetrics({ maxSeriesPerMetric: 2 });
    for (const reason of ["one", "two", "three", "four"]) {
      metrics.recordFallback({ component: "research", reason });
    }

    const points = metrics.snapshot().counters.filter(
      (point) => point.name === "investment_assistant_fallbacks_total"
    );
    expect(points).toHaveLength(2);
    expect(points).toContainEqual(
      expect.objectContaining({
        labels: { component: "__overflow__", reason: "__overflow__" },
        value: 3
      })
    );
  });

  it("keeps adversarial label tuples distinct instead of merging colliding keys", () => {
    const metrics = new OperationalMetrics();
    metrics.recordFallback({ component: "a|6:reason:b", reason: "c" });
    metrics.recordFallback({ component: "a", reason: "b|6:reason:c" });

    const points = metrics.snapshot().counters.filter(
      (point) => point.name === "investment_assistant_fallbacks_total"
    );
    expect(points).toHaveLength(2);
    expect(points.map((point) => point.labels)).toEqual(
      expect.arrayContaining([
        { component: "a|6:reason:b", reason: "c" },
        { component: "a", reason: "b|6:reason:c" }
      ])
    );
  });

  it("applies the series cap to gauges and histograms as well as counters", () => {
    const metrics = new OperationalMetrics({
      maxSeriesPerMetric: 3,
      latencyBucketsMs: [100]
    });
    for (const route of ["one", "two", "three", "four"]) {
      metrics.setActiveRequests(route, 1);
    }
    for (const operation of ["one", "two", "three", "four"]) {
      metrics.recordProviderRequest({
        provider: "market",
        operation,
        result: "success",
        durationMs: 5
      });
    }

    const active = metrics.snapshot().gauges.filter(
      (point) => point.name === "investment_assistant_active_requests"
    );
    const latency = metrics.snapshot().histograms.filter(
      (point) => point.name === "investment_assistant_provider_duration_ms"
    );
    expect(active).toHaveLength(3);
    expect(active).toContainEqual(
      expect.objectContaining({ labels: { route: "__overflow__" } })
    );
    expect(latency).toHaveLength(3);
    expect(latency).toContainEqual(
      expect.objectContaining({
        labels: { provider: "__overflow__", operation: "__overflow__" },
        count: 2
      })
    );
  });

  it("exports truthful bounded pass/fail evaluation labels", () => {
    const metrics = new OperationalMetrics({ maxSeriesPerMetric: 3 });
    metrics.recordEvaluation({ evaluation: "tool-grounding", passed: true, intent: "market_quote" });
    metrics.recordEvaluation({ evaluation: "tool-grounding", passed: false, intent: "market_quote" });
    metrics.recordEvaluation({ evaluation: "freshness", passed: false, intent: "security_overview" });
    metrics.recordEvaluation({ evaluation: "language", passed: false, intent: "security_overview" });

    const points = metrics.snapshot().counters.filter(
      (point) => point.name === "investment_assistant_evaluations_total"
    );
    expect(points).toHaveLength(3);
    expect(points).toContainEqual(
      expect.objectContaining({
        labels: { evaluation: "tool-grounding", result: "pass", intent: "market_quote" },
        value: 1
      })
    );
    expect(points).toContainEqual(
      expect.objectContaining({
        labels: { evaluation: "tool-grounding", result: "fail", intent: "market_quote" },
        value: 1
      })
    );
    expect(points).toContainEqual(
      expect.objectContaining({
        labels: {
          evaluation: "__overflow__",
          result: "__overflow__",
          intent: "__overflow__"
        },
        value: 2
      })
    );
  });

  it("rejects invalid observations and registry limits", () => {
    expect(() => new OperationalMetrics({ latencyBucketsMs: [] })).toThrow("At least one");
    expect(() => new OperationalMetrics({ maxSeriesPerMetric: 0 })).toThrow("positive");
    const metrics = new OperationalMetrics();
    expect(() =>
      metrics.recordProviderRequest({
        provider: "yahoo",
        operation: "quote",
        result: "success",
        durationMs: Number.NaN
      })
    ).toThrow("finite non-negative");
    expect(() => metrics.recordModelTokenUsage({
      provider: "openai",
      model: "gpt-4o",
      workflow: "public_research_v3",
      agent: "public-research-writer",
      inputTokens: 10,
      outputTokens: 2.5
    })).toThrow("safe integer");
    expect(() => metrics.recordModelTokenUsage({
      provider: "openai",
      model: "gpt-4o",
      workflow: "public_research_v3",
      agent: "public-research-writer",
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 11
    })).toThrow("cannot exceed");
    expect(() => metrics.recordModelEstimatedCost({
      provider: "openai",
      model: "gpt-4o",
      kind: "input",
      estimatedCostUsd: Number.NaN
    })).toThrow("finite non-negative");
  });
});
