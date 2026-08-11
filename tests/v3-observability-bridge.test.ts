import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { Mastra } from "@mastra/core/mastra";
import {
  EntityType,
  SpanType
} from "@mastra/core/observability";
import { InMemoryStore } from "@mastra/core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  createV3ObservabilityBridgeExporter,
  probeV3ObservabilityBridge,
  V3_OBSERVABILITY_BRIDGE_PATHS
} from "../src/assistant-v3/observability-bridge.js";
import { createV3Observability } from "../src/assistant-v3/observability.js";
import { createV3StudioObservabilityBridgeRoutes } from "../src/assistant-v3/studio-observability-bridge.js";

const ACCESS_TOKEN = "shared-observability-test-token-000000000000";

describe("V3 shared observability bridge", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("uses exact non-reserved Mastra custom-route paths", () => {
    const routes = createV3StudioObservabilityBridgeRoutes(ACCESS_TOKEN);
    expect(routes.map(({ path }) => path)).toEqual(
      Object.values(V3_OBSERVABILITY_BRIDGE_PATHS)
    );
    expect(routes.every(({ path }) => !path.startsWith("/api"))).toBe(true);
  });

  it("refuses a non-loopback bridge or weak bridge token", () => {
    expect(() =>
      createV3ObservabilityBridgeExporter({
        endpoint: "https://collector.example.com",
        accessToken: ACCESS_TOKEN
      })
    ).toThrow("http://127.0.0.1");
    expect(() =>
      createV3ObservabilityBridgeExporter({
        endpoint: "http://127.0.0.1:4111",
        accessToken: "too-short"
      })
    ).toThrow("32-512");
  });

  it("publishes app traces and metrics into the Studio-owned observability store", async () => {
    const storage = new InMemoryStore({
      id: "shared-observability-bridge-test"
    });
    const mastra = new Mastra({ storage, logger: false });
    await storage.init();
    cleanups.push(async () => {
      await mastra.shutdown();
    });

    const routes = createV3StudioObservabilityBridgeRoutes(ACCESS_TOKEN);
    const handlers = new Map<string, (context: unknown) => Promise<Response>>();
    for (const route of routes) {
      if (!("createHandler" in route)) continue;
      handlers.set(
        route.path,
        await route.createHandler({ mastra }) as (
          context: unknown
        ) => Promise<Response>
      );
    }

    const receivedPaths: string[] = [];
    const receivedAuthorization: string[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        const path = new URL(
          request.url ?? "/",
          "http://127.0.0.1"
        ).pathname;
        receivedPaths.push(path);
        receivedAuthorization.push(request.headers.authorization ?? "");
        const handler = handlers.get(path);
        if (handler === undefined) {
          response.statusCode = 404;
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        const bridgeResponse = await handler({
          req: {
            header: (name: string) =>
              request.headers[name.toLowerCase()] as string | undefined,
            json: async () => raw === "" ? {} : JSON.parse(raw)
          }
        });
        response.statusCode = bridgeResponse.status;
        response.setHeader(
          "content-type",
          bridgeResponse.headers.get("content-type") ?? "application/json"
        );
        response.end(await bridgeResponse.text());
      })().catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanups.push(async () => {
      server.close();
      await once(server, "close");
    });
    const address = server.address() as AddressInfo;
    const bridge = {
      endpoint: `http://127.0.0.1:${address.port}`,
      accessToken: ACCESS_TOKEN
    };
    const appObservability = createV3Observability({
      exporter: createV3ObservabilityBridgeExporter(bridge)
    });
    cleanups.push(async () => {
      await appObservability.shutdown();
    });

    const instance = appObservability.getDefaultInstance();
    const workflowSpan = instance?.startSpan({
      name: "assistant-request-v3",
      type: SpanType.WORKFLOW_RUN,
      entityType: EntityType.WORKFLOW_RUN,
      entityId: "assistant-request-v3",
      entityName: "assistant-request-v3",
      input: {
        message: "private test prompt that must not cross the bridge"
      }
    });
    expect(workflowSpan).toBeDefined();
    const workflowTraceId = workflowSpan?.externalTraceId;
    const workflowSpanId = workflowSpan?.id;
    if (workflowTraceId === undefined || workflowSpanId === undefined) {
      throw new Error("Expected a concrete workflow trace identity.");
    }
    workflowSpan?.end({
      output: {
        message: "private test output that must not cross the bridge"
      }
    });

    const modelSpan = instance?.startSpan({
      name: "portfolio-insight-writer",
      type: SpanType.MODEL_GENERATION,
      entityType: EntityType.AGENT,
      entityName: "portfolio-insight-writer",
      attributes: {
        provider: "openai.responses",
        model: "gpt-4o"
      }
    });
    expect(modelSpan).toBeDefined();
    modelSpan?.end({
      attributes: {
        provider: "openai.responses",
        model: "gpt-4o",
        usage: {
          inputTokens: 42,
          outputTokens: 7,
          inputDetails: { text: 42 },
          outputDetails: { text: 7 }
        }
      }
    });
    await appObservability.addFeedback({
      traceId: workflowTraceId,
      spanId: workflowSpanId,
      correlationContext: {
        serviceName: "governed-investment-assistant-v3"
      },
      feedback: {
        feedbackType: "thumbs",
        value: "up",
        comment: "private feedback comment that must not cross the bridge"
      }
    });
    await appObservability.flush();

    const storedObservability = await storage.getStore("observability");
    const traces = await storedObservability?.listTraces({
      pagination: { page: 0, perPage: 10 }
    });
    expect(traces?.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        traceId: workflowTraceId,
        spanId: workflowSpanId,
        name: "assistant-request-v3",
        serviceName: "governed-investment-assistant-v3",
        input: null,
        output: null
      })
    ]));
    const metrics = await storedObservability?.listMetrics({
      pagination: { page: 0, perPage: 10 }
    });
    expect(metrics?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "mastra_model_total_input_tokens",
        value: 42,
        serviceName: "governed-investment-assistant-v3",
        provider: "openai",
        model: "gpt-4o",
        estimatedCost: expect.any(Number),
        costUnit: "USD"
      })
    ]));
    const totalInputMetric = metrics?.metrics.find(
      ({ name }) => name === "mastra_model_total_input_tokens"
    );
    expect(totalInputMetric?.estimatedCost).toBeGreaterThan(0);
    const feedback = await storedObservability?.listFeedback({
      pagination: { page: 0, perPage: 10 }
    });
    expect(feedback?.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({
        traceId: workflowTraceId,
        spanId: workflowSpanId,
        feedbackType: "thumbs",
        value: "up",
        comment: null,
        serviceName: "governed-investment-assistant-v3"
      })
    ]));
    expect(receivedPaths).toContain(
      "/observability-bridge/ai/spans/publish"
    );
    expect(receivedPaths).toContain(
      "/observability-bridge/ai/metrics/publish"
    );
    expect(receivedPaths).toContain(
      "/observability-bridge/ai/feedback/publish"
    );
    expect(receivedAuthorization).toContain(`Bearer ${ACCESS_TOKEN}`);
    await expect(probeV3ObservabilityBridge(bridge)).resolves.toBe(true);
  });

  it("rejects bridge writes without the shared bearer token", async () => {
    const storage = new InMemoryStore({
      id: "shared-observability-bridge-auth-test"
    });
    const mastra = new Mastra({ storage, logger: false });
    await storage.init();
    try {
      const route = createV3StudioObservabilityBridgeRoutes(ACCESS_TOKEN)
        .find(({ path }) => path.endsWith("/metrics/publish"));
      expect(route).toBeDefined();
      expect(route && "createHandler" in route).toBe(true);
      if (route === undefined || !("createHandler" in route)) return;
      const handler = await route.createHandler({ mastra });
      const response = await handler({
        req: {
          header: () => undefined,
          json: async () => ({
            metrics: [{
              timestamp: new Date().toISOString(),
              name: "should_not_persist",
              value: 1,
              labels: {}
            }]
          })
        }
      });
      expect(response.status).toBe(401);
      const observability = await storage.getStore("observability");
      const metrics = await observability?.listMetrics({
        pagination: { page: 0, perPage: 10 }
      });
      expect(metrics?.metrics).toEqual([]);
    } finally {
      await mastra.shutdown();
    }
  });
});
