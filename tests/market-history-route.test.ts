import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V3_REGISTRY_MANIFEST } from "../src/assistant-v3/registry.js";
import { createApp, type V3ServerApplication } from "../src/server.js";

const mocks = vi.hoisted(() => ({
  getHistory: vi.fn()
}));

function applicationWithHistory(): V3ServerApplication {
  const unavailable = async (): Promise<never> => {
    throw new Error("Not used by this route test");
  };
  return {
    runtime: {
      createSession: unavailable,
      message: unavailable,
      confirmOrderHandoff: unavailable,
      openOrderHandoff: unavailable
    },
    manifest: V3_REGISTRY_MANIFEST,
    readiness: {
      identityMode: "mock-internal-pilot",
      portfolioMode: "synthetic-ledger",
      marketLicenceClass: "development-public-feed",
      developmentSigningKey: true,
      storageUrl: "file:test",
      studioExposed: false,
      environment: "test",
      conversationMemoryMode: "process-local-bounded"
    },
    conversationMemory: {
      enabled: true,
      mode: "process-local-bounded",
      ttlMs: 300_000,
      maxHops: 3
    },
    market: {
      descriptor: {
        id: "test-market",
        displayName: "Test market",
        licenseClass: "development-only"
      },
      getSnapshot: unavailable,
      getResearch: unavailable
    },
    history: { getHistory: mocks.getHistory },
    portfolio: {
      getClient: () => ({
        id: "test-client",
        displayName: "Test Client",
        initials: "TC",
        locale: "en-US",
        accountLabel: "Synthetic",
        baseCurrency: "USD",
        isMock: true,
        holdings: [],
        cash: []
      }),
      getSummary: unavailable
    },
    approvedKnowledge: {
      readiness: async () => ({
        ready: true,
        indexName: "test",
        indexDimension: 384,
        count: 1,
        indexedChunksExpected: 1,
        eligibleDocuments: 2,
        approvalMode: "test",
        requiredLocales: ["en-US", "az-AZ"],
        requiredFacets: ["fees"],
        localeCoverage: [
          {
            locale: "en-US",
            eligibleDocuments: 1,
            coveredFacets: ["fees"],
            missingFacets: []
          },
          {
            locale: "az-AZ",
            eligibleDocuments: 1,
            coveredFacets: ["fees"],
            missingFacets: []
          }
        ]
      })
    },
    criticalReadiness: {
      signer: async () => true,
      audit: async () => true,
      storage: async () => true,
      observability: async () => true
    }
  };
}

describe("GET /api/market/:symbol/history", () => {
  let server: Server | undefined;

  afterEach(async () => {
    mocks.getHistory.mockReset();
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  it("returns the normalized history response and disables intermediary caching", async () => {
    const expected = {
      symbol: "INTC",
      range: "10y",
      interval: "1wk",
      currency: "USD",
      exchange: "NasdaqGS",
      asOf: "2026-07-20T13:30:00.000Z",
      source: "Yahoo Finance chart endpoint",
      points: [{ timestamp: "2026-07-20T13:30:00.000Z", close: 97.06 }]
    };
    mocks.getHistory.mockResolvedValue(expected);
    server = createApp({ assistantV3: applicationWithHistory() }).listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/market/intc/history?range=10y`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(expected);
    expect(mocks.getHistory).toHaveBeenCalledWith("intc", "10y");
  });

  it("defaults to 10y and rejects an unsupported range before calling Yahoo", async () => {
    mocks.getHistory.mockResolvedValue({
      symbol: "INTC",
      range: "10y",
      interval: "1wk",
      currency: "USD",
      exchange: "NasdaqGS",
      asOf: "2026-07-20T13:30:00.000Z",
      source: "Yahoo Finance chart endpoint",
      points: []
    });
    server = createApp({ assistantV3: applicationWithHistory() }).listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${baseUrl}/api/market/INTC/history`)).status).toBe(200);
    expect(mocks.getHistory).toHaveBeenLastCalledWith("INTC", "10y");

    const invalidResponse = await fetch(
      `${baseUrl}/api/market/INTC/history?range=2y`
    );
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: "Unsupported market history range. Use one of: 1d, 1w, 1m, 6m, 1y, 5y, 10y, max"
    });
    expect(mocks.getHistory).toHaveBeenCalledTimes(1);
  });
});
