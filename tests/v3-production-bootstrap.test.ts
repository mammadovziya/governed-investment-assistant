import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { MarketDataError } from "../src/services/market-data.js";
import {
  publicMarketBootstrapMode
} from "../src/assistant-v3/bootstrap.js";
import {
  UNAVAILABLE_PUBLIC_MARKET_PROVIDER,
  UnavailableMarketHistoryProvider,
  UnavailablePublicMarketResearchProvider
} from "../src/assistant-v3/unavailable-public-market.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("production public-market bootstrap", () => {
  it("selects the offline synthetic provider by default for a local pilot", () => {
    expect(publicMarketBootstrapMode({
      environment: "development",
      releaseTarget: "internal-pilot"
    })).toBe("synthetic-offline");
    expect(publicMarketBootstrapMode({
      environment: "test",
      releaseTarget: "internal-pilot"
    })).toBe("synthetic-offline");
  });

  it("selects Yahoo only after an explicit development/test opt-in", () => {
    expect(publicMarketBootstrapMode({
      environment: "development",
      releaseTarget: "internal-pilot",
      requestedProvider: "yahoo-development"
    })).toBe("yahoo-development");
    expect(publicMarketBootstrapMode({
      environment: "test",
      releaseTarget: "internal-pilot",
      requestedProvider: "yahoo-development"
    })).toBe("yahoo-development");

    for (const input of [
      { environment: "staging", releaseTarget: "internal-pilot" },
      { environment: "production", releaseTarget: "internal-pilot" },
      { environment: "development", releaseTarget: "customer-production" },
      { environment: "test", releaseTarget: "customer-production" },
      { environment: "staging", releaseTarget: "customer-production" },
      { environment: "production", releaseTarget: "customer-production" }
    ] as const) {
      expect(publicMarketBootstrapMode({
        ...input,
        requestedProvider: "yahoo-development"
      })).toBe("unavailable-fail-closed");
    }
  });

  it("never returns quotes, research, or history from the unavailable adapter", async () => {
    const market = new UnavailablePublicMarketResearchProvider();
    const history = new UnavailableMarketHistoryProvider();

    expect(market.descriptor).toBe(UNAVAILABLE_PUBLIC_MARKET_PROVIDER);
    expect(market.descriptor.licenseClass).not.toBe("production-approved");
    for (const operation of [
      market.getSnapshot("AAPL"),
      market.getResearch("AAPL"),
      history.getHistory("AAPL", "1y")
    ]) {
      await expect(operation).rejects.toMatchObject({
        name: "MarketDataError",
        statusCode: 503
      } satisfies Partial<MarketDataError>);
    }
  });

  it("boots the real server in customer-production and exposes fail-closed readiness", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "investment-assistant-prod-bootstrap-"));
    temporaryDirectories.push(directory);
    const serverModuleUrl = new URL("../src/server.ts", import.meta.url).href;
    const script = `
      const { createApp } = await import(${JSON.stringify(serverModuleUrl)});
      const server = createApp().listen(0, "127.0.0.1", async () => {
        try {
          const address = server.address();
          if (!address || typeof address === "string") throw new Error("missing address");
          const baseUrl = "http://127.0.0.1:" + address.port;
          const health = await fetch(baseUrl + "/api/health");
          const readiness = await fetch(baseUrl + "/api/ready");
          console.log("__BOOTSTRAP_RESULT__" + JSON.stringify({
            healthStatus: health.status,
            health: await health.json(),
            readinessStatus: readiness.status,
            readiness: await readiness.json()
          }));
          server.close(() => process.exit(0));
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      });
      setTimeout(() => process.exit(2), 20000).unref();
    `;
    const localFile = (name: string) => `file:${path.join(directory, name)}`;
    const localPath = (name: string) => path.join(directory, name);

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        cwd: path.resolve(new URL("..", import.meta.url).pathname),
        env: {
          ...process.env,
          NODE_ENV: "production",
          ASSISTANT_RELEASE_TARGET: "customer-production",
          ASSISTANT_SIGNING_KEY:
            "production-bootstrap-test-signing-key-0000000000000000",
          KNOWLEDGE_APPROVAL_MODE: "controlled",
          MASTRA_STORAGE_URL: localFile("mastra.db"),
          MASTRA_STUDIO_STORAGE_URL: localFile("mastra-studio.db"),
          MASTRA_OBSERVABILITY_SHARED: "false",
          MASTRA_OBSERVABILITY_PATH: localPath("observability.duckdb"),
          MASTRA_STUDIO_OBSERVABILITY_PATH: localPath("observability-studio.duckdb"),
          KNOWLEDGE_VECTOR_URL: localFile("knowledge.db"),
          ASSISTANT_AUDIT_OUTBOX_PATH: localPath("audit.jsonl"),
          ASSISTANT_V3_CONVERSATION_MEMORY_ENABLED: "false",
          ASSISTANT_STUDIO_EXPOSED: "false",
          OPENAI_API_KEY: ""
        },
        timeout: 30_000,
        maxBuffer: 1_000_000
      }
    );

    const resultLine = stdout
      .split(/\r?\n/u)
      .find((line) => line.startsWith("__BOOTSTRAP_RESULT__"));
    expect(resultLine).toBeDefined();
    const result = JSON.parse(
      resultLine?.slice("__BOOTSTRAP_RESULT__".length) ?? "{}"
    ) as Record<string, unknown>;
    expect(result).toEqual({
      healthStatus: 200,
      health: {
        schemaVersion: "assistant-v3.liveness.v1",
        status: "ok"
      },
      readinessStatus: 503,
      readiness: {
        schemaVersion: "assistant-v3.readiness.v1",
        status: "not-ready",
        errors: ["RELEASE_NOT_READY"]
      }
    });
  }, 35_000);
});
