import { timingSafeEqual } from "node:crypto";

import type { Mastra } from "@mastra/core/mastra";
import type {
  AnyExportedSpan,
  FeedbackEvent,
  LogEvent,
  MetricEvent,
  ScoreEvent
} from "@mastra/core/observability";
import {
  batchCreateFeedbackArgsSchema,
  batchCreateLogsArgsSchema,
  batchCreateMetricsArgsSchema,
  batchCreateScoresArgsSchema,
  batchCreateSpansArgsSchema,
  buildCreateSpanRecord,
  buildFeedbackRecord,
  buildLogRecord,
  buildMetricRecord,
  buildScoreRecord,
  type ObservabilityStorage
} from "@mastra/core/storage";
import {
  registerApiRoute,
  type ApiRoute
} from "@mastra/core/server";

import { V3_OBSERVABILITY_BRIDGE_PATHS } from "./observability-bridge.js";

type BridgeSignal = "spans" | "logs" | "metrics" | "scores" | "feedback";

const MAX_BRIDGE_RECORDS = 1_000;

function authorized(header: string | undefined, accessToken: string): boolean {
  if (header === undefined) return false;
  const supplied = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${accessToken}`);
  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected);
}

function normalizedDate(value: unknown): unknown {
  if (value === null || value === undefined || value instanceof Date) {
    return value;
  }
  if (typeof value !== "string") return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

function normalizedRecords(
  body: unknown,
  sourceKey: BridgeSignal,
  dateFields: readonly string[]
): ReadonlyArray<Record<string, unknown>> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const input = body as Readonly<Record<string, unknown>>;
  const records = input[sourceKey];
  if (!Array.isArray(records) || records.length > MAX_BRIDGE_RECORDS) {
    return null;
  }
  const output: Array<Record<string, unknown>> = [];
  for (const record of records) {
    if (
      typeof record !== "object" ||
      record === null ||
      Array.isArray(record)
    ) {
      return null;
    }
    const normalized = { ...record } as Record<string, unknown>;
    for (const field of dateFields) {
      if (field in normalized) {
        normalized[field] = normalizedDate(normalized[field]);
      }
    }
    output.push(normalized);
  }
  return output;
}

async function observabilityStorage(mastra: Mastra): Promise<ObservabilityStorage> {
  const storage = mastra.getStorage();
  const observability = await storage?.getStore("observability");
  if (observability === undefined) {
    throw new Error("Shared Studio observability storage is unavailable.");
  }
  return observability;
}

function unauthorizedResponse(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401 }
  );
}

function invalidPayloadResponse(): Response {
  return Response.json(
    { error: "invalid_observability_batch" },
    { status: 400 }
  );
}

function unavailableResponse(): Response {
  return Response.json(
    { error: "observability_storage_unavailable" },
    { status: 503 }
  );
}

function publishRoute(
  signal: BridgeSignal,
  accessToken: string
): ApiRoute {
  return registerApiRoute(
    V3_OBSERVABILITY_BRIDGE_PATHS[signal],
    {
      method: "POST",
      requiresAuth: false,
      createHandler: async ({ mastra }) => {
        const store = await observabilityStorage(mastra);
        return async (context) => {
          if (!authorized(context.req.header("authorization"), accessToken)) {
            return unauthorizedResponse();
          }
          let body: unknown;
          try {
            body = await context.req.json();
          } catch {
            return invalidPayloadResponse();
          }
          try {
            switch (signal) {
              case "spans": {
                const records = normalizedRecords(
                  body,
                  "spans",
                  [
                    "startTime",
                    "endTime",
                    "startedAt",
                    "endedAt",
                    "createdAt",
                    "updatedAt"
                  ]
                );
                if (records === null) return invalidPayloadResponse();
                const parsed = batchCreateSpansArgsSchema.safeParse({
                  records: records.map((record) =>
                    buildCreateSpanRecord(record as unknown as AnyExportedSpan)
                  )
                });
                if (!parsed.success) return invalidPayloadResponse();
                await store.batchCreateSpans(parsed.data);
                break;
              }
              case "logs": {
                const records = normalizedRecords(
                  body,
                  "logs",
                  ["timestamp"]
                );
                if (records === null) return invalidPayloadResponse();
                const parsed = batchCreateLogsArgsSchema.safeParse({
                  logs: records.map((log) =>
                    buildLogRecord({
                      type: "log",
                      log: log as unknown as LogEvent["log"]
                    })
                  )
                });
                if (!parsed.success) return invalidPayloadResponse();
                await store.batchCreateLogs(parsed.data);
                break;
              }
              case "metrics": {
                const records = normalizedRecords(
                  body,
                  "metrics",
                  ["timestamp"]
                );
                if (records === null) return invalidPayloadResponse();
                const parsed = batchCreateMetricsArgsSchema.safeParse({
                  metrics: records.map((metric) =>
                    buildMetricRecord({
                      type: "metric",
                      metric: metric as unknown as MetricEvent["metric"]
                    })
                  )
                });
                if (!parsed.success) return invalidPayloadResponse();
                await store.batchCreateMetrics(parsed.data);
                break;
              }
              case "scores": {
                const records = normalizedRecords(
                  body,
                  "scores",
                  ["timestamp"]
                );
                if (records === null) return invalidPayloadResponse();
                const parsed = batchCreateScoresArgsSchema.safeParse({
                  scores: records.map((score) =>
                    buildScoreRecord({
                      type: "score",
                      score: score as unknown as ScoreEvent["score"]
                    })
                  )
                });
                if (!parsed.success) return invalidPayloadResponse();
                await store.batchCreateScores(parsed.data);
                break;
              }
              case "feedback": {
                const records = normalizedRecords(
                  body,
                  "feedback",
                  ["timestamp"]
                );
                if (records === null) return invalidPayloadResponse();
                const parsed = batchCreateFeedbackArgsSchema.safeParse({
                  feedbacks: records.map((feedback) =>
                    buildFeedbackRecord({
                      type: "feedback",
                      feedback:
                        feedback as unknown as FeedbackEvent["feedback"]
                    })
                  )
                });
                if (!parsed.success) return invalidPayloadResponse();
                await store.batchCreateFeedback(parsed.data);
                break;
              }
            }
          } catch {
            return unavailableResponse();
          }
          return Response.json({ accepted: true });
        };
      }
    }
  );
}

export function createV3StudioObservabilityBridgeRoutes(
  accessToken: string
): readonly ApiRoute[] {
  const health = registerApiRoute(
    V3_OBSERVABILITY_BRIDGE_PATHS.health,
    {
      method: "GET",
      requiresAuth: false,
      createHandler: async ({ mastra }) => {
        const store = await observabilityStorage(mastra);
        return async (context) => {
          if (!authorized(context.req.header("authorization"), accessToken)) {
            return unauthorizedResponse();
          }
          try {
            await store.listTraces({
              pagination: { page: 0, perPage: 1 }
            });
            return Response.json({
              status: "ok",
              storage: "shared-duckdb"
            });
          } catch {
            return unavailableResponse();
          }
        };
      }
    }
  );

  return Object.freeze([
    publishRoute("spans", accessToken),
    publishRoute("logs", accessToken),
    publishRoute("metrics", accessToken),
    publishRoute("scores", accessToken),
    publishRoute("feedback", accessToken),
    health
  ]);
}
