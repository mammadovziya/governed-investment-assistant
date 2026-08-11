import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from "vitest";

const legacy = vi.hoisted(() => ({
  getClient: vi.fn(() => ({
    id: "legacy-dashboard-client",
    displayName: "Demo Client",
    initials: "DC",
    locale: "en-US" as const,
    accountLabel: "Synthetic account",
    baseCurrency: "USD" as const,
    isMock: true as const
  })),
  getSummary: vi.fn(async () => ({
    clientId: "legacy-dashboard-client",
    baseCurrency: "USD" as const,
    asOf: "2026-07-22T12:00:00.000Z",
    cash: [{ currency: "USD" as const, amount: 2_000 }],
    positionsValue: 8_000,
    coveredValue: 10_000,
    cashValue: 2_000,
    costBasis: 7_000,
    unrealizedPnl: 1_000,
    unrealizedPnlPercent: 14.29,
    dayChangeValue: 50,
    pricedHoldings: 0,
    totalHoldings: 0,
    coverageComplete: true,
    notices: [],
    holdings: []
  })),
  legacyChat: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn()
}));

vi.mock("../src/assistant-v3/logging.js", () => ({
  v3Logger: {
    info: legacy.loggerInfo,
    error: legacy.loggerError,
    warn: legacy.loggerWarn
  }
}));

import type { AssistantResponse } from "../src/assistant-v3/contracts.js";
import type {
  V3AssistantHttpRuntime,
  V3HttpCreatedSession
} from "../src/assistant-v3/http.js";
import {
  GOVERNED_NAVIGATION_CATALOG_VERSION
} from "../src/assistant-v3/governed-navigation.js";
import { V3_REGISTRY_MANIFEST } from "../src/assistant-v3/registry.js";
import type {
  OrderHandoffScreenState,
  SignedOrderHandoff
} from "../src/assistant-v3/order-handoff.js";
import {
  classifyHttpWorkflowResult,
  createApp,
  isInternalPilotOnlyRoute,
  type V3ServerApplication
} from "../src/server.js";

const SESSION_TOKEN = "v3s.payload.signature_for_server_contract_123456";
const INTERNAL_DIAGNOSTICS_TOKEN =
  "internal-diagnostics-test-token-1234567890";
const SESSION_ID = "00000000-0000-4000-8000-000000000110";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000120";
const AS_OF = "2026-07-22T12:00:00.000Z";
const createdSession: V3HttpCreatedSession = {
  sessionToken: SESSION_TOKEN,
  sessionId: SESSION_ID,
  conversationId: CONVERSATION_ID,
  locale: "en-US",
  expiresAt: "2026-07-22T12:30:00.000Z",
  consent: {
    status: "granted",
    version: "pilot-consent-v3",
    scopes: ["assistant_use"]
  },
  capabilities: ["public-research", "portfolio-insight"]
};

const assistantResponse: AssistantResponse = {
  schemaVersion: "assistant-v3.response.v1",
  requestId: "request-v3-server-1",
  conversationId: CONVERSATION_ID,
  status: "complete",
  message: "V3 response",
  claims: [],
  facts: [],
  citations: [],
  cards: [],
  charts: [],
  actions: [],
  notices: [],
  freshness: [],
  evaluations: [],
  deliveryGate: "pass",
  generationMode: "deterministic",
  provenance: {
    workflowId: "assistant-request-v3",
    workflowVersion: "3.0.0",
    workflowRunId: "workflow-v3-server-1",
    model: null,
    toolExecutionIds: [],
    factIds: [],
    policyVersion: "3.0.0"
  }
};

interface SurfaceFixture {
  application: V3ServerApplication;
  createSession: ReturnType<typeof vi.fn>;
  message: ReturnType<typeof vi.fn>;
  confirmOrderHandoff: ReturnType<typeof vi.fn>;
  openOrderHandoff: ReturnType<typeof vi.fn>;
  marketSnapshot: ReturnType<typeof vi.fn>;
  knowledgeReadiness: ReturnType<typeof vi.fn>;
  criticalReadiness: {
    signer: ReturnType<typeof vi.fn>;
    audit: ReturnType<typeof vi.fn>;
    storage: ReturnType<typeof vi.fn>;
    observability: ReturnType<typeof vi.fn>;
  };
}

function surfaceFixture(): SurfaceFixture {
  const createSession = vi.fn(async () => structuredClone(createdSession));
  const message = vi.fn(async () => structuredClone(assistantResponse));
  const confirmOrderHandoff = vi.fn(async (): Promise<SignedOrderHandoff> => ({
    handoffRef: "test",
    payload: {
      schemaVersion: "assistant-v3.order-handoff.v1",
      handoffId: "00000000-0000-4000-8000-000000000130",
      intentId: "00000000-0000-4000-8000-000000000140",
      principalRef: "principal-1",
      tenantRef: "tenant-1",
      previewRequestId: "request-1",
      side: "BUY",
      symbol: "NVDA",
      requestedNotional:
        "100.00000000" as SignedOrderHandoff["payload"]["requestedNotional"],
      currency: "USD",
      issuedAt: AS_OF,
      expiresAt: "2026-07-22T12:05:00.000Z",
      nonce: "nonce",
      executionAllowed: false
    },
    expiresAt: "2026-07-22T12:05:00.000Z",
    oneUse: true,
    destination: "/orders/preview"
  }));
  const openOrderHandoff = vi.fn(async (): Promise<OrderHandoffScreenState> => ({
    schemaVersion: "assistant-v3.order-screen-state.v1",
    status: "external-order-screen-not-integrated",
    handoffId: "00000000-0000-4000-8000-000000000130",
    intentId: "00000000-0000-4000-8000-000000000140",
    side: "BUY",
    symbol: "NVDA",
    requestedNotional:
      "100.00000000" as OrderHandoffScreenState["requestedNotional"],
    currency: "USD",
    expiresAt: "2026-07-22T12:05:00.000Z",
    destination: "/orders/preview",
    oneUseHandoffConsumed: true,
    submissionAllowed: false,
    requiredRechecks: [
      "live-price",
      "fees",
      "available-balance",
      "disclosures",
      "eligibility",
      "final-confirmation"
    ]
  }));
  const runtime: V3AssistantHttpRuntime = {
    createSession,
    message,
    confirmOrderHandoff,
    openOrderHandoff
  };
  const marketSnapshot = vi.fn(async (symbol: string) => ({
    symbol,
    displayName: symbol === "BND" ? "Vanguard Total Bond Market ETF" : `${symbol} Inc.`,
    currency: "USD",
    exchange: "NasdaqGS",
    instrumentType: symbol === "BND" ? "ETF" : "EQUITY",
    price: 200,
    previousClose: 199,
    change: 1,
    changePercent: 0.5,
    marketState: "CLOSED" as const,
    freshness: "indicative" as const,
    delayMinutes: 0,
    asOf: AS_OF,
    source: "Test V3 market",
    notice: "Test snapshot"
  }));
  const knowledgeReadiness = vi.fn(async () => ({
    ready: true,
    indexName: "demo_invest_knowledge_test_v3",
    indexDimension: 384,
    count: 14,
    indexedChunksExpected: 14,
    eligibleDocuments: 14,
    approvalMode: "official-publication",
    requiredLocales: ["en-US", "az-AZ"] as const,
    requiredFacets: [
      "fees",
      "account_opening",
      "funding",
      "withdrawal",
      "product",
      "market_hours",
      "purchase_process"
    ] as const,
    localeCoverage: (["en-US", "az-AZ"] as const).map((locale) => ({
      locale,
      eligibleDocuments: 7,
      coveredFacets: [
        "fees",
        "account_opening",
        "funding",
        "withdrawal",
        "product",
        "market_hours",
        "purchase_process"
      ] as const,
      missingFacets: []
    }))
  }));
  const criticalReadiness = {
    signer: vi.fn(async () => true),
    audit: vi.fn(async () => true),
    storage: vi.fn(async () => true),
    observability: vi.fn(async () => true)
  };

  return {
    createSession,
    message,
    confirmOrderHandoff,
    openOrderHandoff,
    marketSnapshot,
    knowledgeReadiness,
    criticalReadiness,
    application: {
      runtime,
      manifest: V3_REGISTRY_MANIFEST,
      readiness: {
        identityMode: "mock-internal-pilot",
        portfolioMode: "synthetic-ledger",
        marketLicenceClass: "development-public-feed",
        developmentSigningKey: true,
        storageUrl: "file:process-local-v3-test",
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
          id: "v3-test-market",
          displayName: "V3 Test Market",
          licenseClass: "development-only"
        },
        getSnapshot: marketSnapshot,
        getResearch: vi.fn(async () => {
          throw new Error("research not used by this test");
        })
      },
      history: {
        getHistory: vi.fn(async () => {
          throw new Error("history not used by this test");
        })
      },
      portfolio: {
        getClient: legacy.getClient,
        getSummary: legacy.getSummary
      },
      approvedKnowledge: { readiness: knowledgeReadiness },
      criticalReadiness
    }
  };
}

describe("active server V3 surface", () => {
  let server: Server | undefined;
  let baseUrl = "";
  let current: SurfaceFixture;
  let modelReadinessProbe: Mock<(modelId: string) => Promise<boolean>>;

  beforeEach(async () => {
    vi.unstubAllGlobals();
    legacy.getClient.mockClear();
    legacy.getSummary.mockClear();
    legacy.legacyChat.mockClear();
    current = surfaceFixture();
    modelReadinessProbe = vi.fn(async (_modelId: string) => true);
    server = createApp({
      assistantV3: current.application,
      internalDiagnosticsToken: INTERNAL_DIAGNOSTICS_TOKEN,
      readinessModelProbe: modelReadinessProbe,
      readinessNow: () => Date.parse(AS_OF) + 1_000
    }).listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  async function post(path: string, body: unknown, authorization?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === undefined ? {} : { authorization })
      },
      body: JSON.stringify(body)
    });
  }

  it("sets browser isolation and transport security headers", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("mounts V3 sessions/messages and keeps /api/chat as the V3 compatibility adapter", async () => {
    const sessionResponse = await post("/v1/assistant/sessions", { locale: "en-US" });
    expect(sessionResponse.status).toBe(201);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      sessionToken: SESSION_TOKEN,
      conversationId: CONVERSATION_ID
    });

    const messageResponse = await post(
      "/v1/assistant/messages",
      { message: "Analyze NVDA" },
      `Bearer ${SESSION_TOKEN}`
    );
    expect(messageResponse.status).toBe(200);
    await expect(messageResponse.json()).resolves.toEqual(assistantResponse);

    current.createSession.mockClear();
    current.message.mockClear();
    const compatibilityResponse = await post("/api/chat", {
      message: "Portfolio summary",
      locale: "en-US"
    });
    expect(compatibilityResponse.status).toBe(200);
    expect(current.createSession).toHaveBeenCalledOnce();
    expect(current.message).toHaveBeenCalledOnce();
    expect(current.message).toHaveBeenCalledWith({
      sessionToken: SESSION_TOKEN,
      message: "Portfolio summary"
    });
    expect(legacy.legacyChat).not.toHaveBeenCalled();
  });

  it("reports the mounted runtime memory status and rejects readiness drift", async () => {
    const disabled = surfaceFixture();
    disabled.application.readiness.conversationMemoryMode = "disabled";
    disabled.application.conversationMemory = {
      enabled: false,
      mode: "disabled",
      ttlMs: 300_000,
      maxHops: 3
    };
    const disabledServer = createApp({
      assistantV3: disabled.application,
      internalDiagnosticsToken: INTERNAL_DIAGNOSTICS_TOKEN,
      readinessModelProbe: modelReadinessProbe
    }).listen(0);
    await new Promise<void>((resolve) => disabledServer.once("listening", resolve));
    try {
      const address = disabledServer.address();
      if (!address || typeof address === "string") throw new Error("Missing test port");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/mastra/capabilities`,
        {
          headers: {
            authorization: `Bearer ${INTERNAL_DIAGNOSTICS_TOKEN}`
          }
        }
      );
      await expect(response.json()).resolves.toMatchObject({
        conversationContextMemory: false,
        conversationContextMemoryMode: "disabled"
      });
    } finally {
      await new Promise<void>((resolve) => disabledServer.close(() => resolve()));
    }

    const inconsistent = surfaceFixture();
    inconsistent.application.conversationMemory = {
      enabled: false,
      mode: "process-local-bounded",
      ttlMs: 300_000,
      maxHops: 3
    };
    expect(() => createApp({ assistantV3: inconsistent.application })).toThrow(
      /conversation-memory status is inconsistent or unsafe/u
    );
  });

  it("disables the assistant runtime when a P0 readiness control fails", async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    const blocked = surfaceFixture();
    blocked.application.readiness.studioExposed = true;
    server = createApp({ assistantV3: blocked.application }).listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await post("/v1/assistant/sessions", { locale: "en-US" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unavailable" }
    });
    expect(blocked.createSession).not.toHaveBeenCalled();
  });

  it("uses the same injected V3 portfolio port for client, snapshot, and stream routes", async () => {
    const clientResponse = await fetch(`${baseUrl}/api/client`);
    expect(clientResponse.status).toBe(200);
    await expect(clientResponse.json()).resolves.toMatchObject({
      id: "legacy-dashboard-client",
      isMock: true
    });

    const portfolioResponse = await fetch(`${baseUrl}/api/portfolio`);
    expect(portfolioResponse.status).toBe(200);
    await expect(portfolioResponse.json()).resolves.toMatchObject({
      clientId: "legacy-dashboard-client",
      coveredValue: 10_000
    });

    const streamController = new AbortController();
    const streamResponse = await fetch(`${baseUrl}/api/portfolio/stream`, {
      signal: streamController.signal
    });
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
    const reader = streamResponse.body?.getReader();
    if (!reader) throw new Error("Portfolio stream did not expose a response body.");
    const firstEvent = await reader.read();
    const payload = new TextDecoder().decode(firstEvent.value);
    await reader.cancel();
    streamController.abort();

    expect(payload).toContain("event: portfolio");
    expect(payload).toContain('"clientId":"legacy-dashboard-client"');
    expect(legacy.getClient).toHaveBeenCalledOnce();
    expect(legacy.getSummary).toHaveBeenCalledTimes(2);
  });

  it("does not retain duplicate chat or direct legacy workflow routes", async () => {
    const serverSource = await readFile(
      fileURLToPath(new URL("../src/server.ts", import.meta.url)),
      "utf8"
    );
    expect(serverSource).toContain("createV3HttpRouter(assistantRuntime)");
    expect(serverSource).not.toMatch(/app\.post\(["']\/api\/chat["']/u);
    expect(serverSource).not.toMatch(/app\.post\(["']\/api\/workflows\//u);

    const legacyWorkflow = await post("/api/workflows/request-triage", {
      message: "bypass V3"
    });
    expect(legacyWorkflow.status).toBe(404);
  });

  it("serves only exact governed guidance destinations without a SPA catch-all", async () => {
    for (const path of [
      "/investments/guides/account-opening",
      "/investments/guides/funding",
      "/investments/guides/share-purchase",
      "/investments/guides/withdrawal"
    ]) {
      const destination = await fetch(`${baseUrl}${path}`);
      expect(destination.status, path).toBe(200);
      expect(destination.headers.get("content-type")).toContain("text/html");
      expect(destination.headers.get("cache-control")).toBe("no-store");
      const html = await destination.text();
      expect(html).toContain('id="messages"');
      expect(html).toContain('<script type="module" src="/app.js"></script>');
    }

    for (const path of [
      "/investments",
      "/investments/guides/account-opening/",
      "/investments/guides/account-opening?next=%2Forders",
      "/investments/guides/funding/",
      "/investments/guides/funding?amount=100",
      "/investments/guides/share-purchase/",
      "/investments/guides/share-purchase?symbol=AAPL",
      "/investments/guides/withdrawal/",
      "/investments/guides/withdrawal?amount=100",
      "/investments/price-alerts/create",
      "/investments/unknown",
      "/random-client-route"
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain('id="messages"');
    }
  });

  it("serves only exact GET-only fact-bound read-only destinations", async () => {
    const paths = [
      "/investments/portfolio",
      "/investments/portfolio/cash",
      "/investments/activity",
      "/investments/instruments"
    ];
    for (const path of paths) {
      const destination = await fetch(`${baseUrl}${path}`);
      expect(destination.status, path).toBe(200);
      expect(destination.headers.get("content-type")).toContain("text/html");
      expect(destination.headers.get("cache-control")).toBe("no-store");
      expect(await destination.text()).toContain('id="messages"');
    }
    for (const path of [
      "/investments/portfolio/",
      "/investments/portfolio?account=1",
      "/investments/portfolio/cash/",
      "/investments/activity?client=1",
      "/investments/instruments/AAPL",
      "/investments/instruments?symbol=AAPL"
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain('id="messages"');
    }
    for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await fetch(`${baseUrl}/investments/portfolio`, {
        method
      });
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow"), method).toBe("GET");
    }
  });

  it("serves the exact non-executable order review destination", async () => {
    const review = await fetch(`${baseUrl}/orders/preview`);
    expect(review.status).toBe(200);
    expect(review.headers.get("content-type")).toContain("text/html");
    expect(review.headers.get("cache-control")).toBe("no-store");
    const html = await review.text();
    expect(html).toContain("READ-ONLY INTERNAL PILOT");
    expect(html).toContain('src="/order-preview.js"');

    for (const path of [
      "/orders/preview/",
      "/orders/preview?handoff=secret",
      "/orders/unknown"
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain(
        "READ-ONLY INTERNAL PILOT"
      );
    }
  });

  it("keeps liveness minimal and reports topology only on pilot product or authenticated diagnostics surfaces", async () => {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const health = await healthResponse.json() as Record<string, unknown>;
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.headers.get("cache-control")).toBe("no-store");
    expect(health).toEqual({
      schemaVersion: "assistant-v3.liveness.v1",
      status: "ok"
    });
    expect(JSON.stringify(health)).not.toMatch(
      /model|provider|index|blocker|memory|agent|workflow|tool|scorer/iu
    );
    expect(modelReadinessProbe).not.toHaveBeenCalled();
    expect(current.marketSnapshot).not.toHaveBeenCalled();
    expect(current.knowledgeReadiness).not.toHaveBeenCalled();
    expect(current.criticalReadiness.signer).not.toHaveBeenCalled();

    const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`);
    const bootstrap = await bootstrapResponse.json() as {
      productProfile: unknown;
      branding: Record<string, unknown>;
      capabilities: Record<string, unknown>;
    };
    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapResponse.headers.get("cache-control")).toBe("no-store");
    expect(bootstrap.productProfile).toBe("demo-invest");
    expect(bootstrap.branding).toEqual({
      name: "Invest Assistant",
      mark: "IA",
      productName: "Demo Invest"
    });
    expect(bootstrap.capabilities).toMatchObject({
      assistantApiVersion: "v3",
      orchestration: "Mastra V3 workflows",
      registryCounts: { agents: 4, workflows: 5, tools: 13 },
      agents: V3_REGISTRY_MANIFEST.ids.agents,
      workflows: V3_REGISTRY_MANIFEST.ids.workflows,
      tools: V3_REGISTRY_MANIFEST.ids.tools,
      clientOwnedIdentityAccepted: false,
      directOrderExecution: false,
      signedOrderTicketHandoff: true,
      conversationContextMemory: true,
      conversationContextMemoryMode: "process-local-bounded",
      conversationContextMemoryTtlMs: 300_000,
      conversationContextMemoryMaxHops: 3,
      governedNavigation: {
        schemaVersion: "assistant-v3.navigation-catalog-metadata.v1",
        catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION,
        entries: expect.arrayContaining([
          expect.objectContaining({
            target: "investments.account-opening.guide",
            status: "enabled",
            evidenceLocales: ["en-US", "az-AZ"]
          }),
          expect.objectContaining({
            target: "investments.price-alerts.create",
            status: "disabled",
            readinessBlocker: "MISSING_APPROVED_BILINGUAL_EVIDENCE"
          })
        ])
      },
      compatibilityAdapter: "/api/chat"
    });

    const unauthenticatedCapabilities = await fetch(
      `${baseUrl}/api/mastra/capabilities`
    );
    expect(unauthenticatedCapabilities.status).toBe(404);

    const capabilitiesResponse = await fetch(`${baseUrl}/api/mastra/capabilities`, {
      headers: {
        authorization: `Bearer ${INTERNAL_DIAGNOSTICS_TOKEN}`
      }
    });
    expect(capabilitiesResponse.status).toBe(200);
    expect(capabilitiesResponse.headers.get("cache-control")).toBe("no-store");
    await expect(capabilitiesResponse.json()).resolves.toMatchObject({
      conversationContextMemory: true,
      conversationContextMemoryMode: "process-local-bounded",
      conversationContextMemoryTtlMs: 300_000,
      conversationContextMemoryMaxHops: 3,
      governedNavigation: {
        schemaVersion: "assistant-v3.navigation-catalog-metadata.v1",
        catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION
      }
    });
  });

  it("keeps public readiness minimal and exposes detailed probes only with pilot diagnostics authentication", async () => {
    const response = await fetch(`${baseUrl}/api/ready`);
    const publicBody = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(publicBody).toEqual({
      schemaVersion: "assistant-v3.readiness.v1",
      status: "ready"
    });
    expect(JSON.stringify(publicBody)).not.toMatch(
      /gpt|openai|model|provider|index|blocker|yahoo|mock|memory/iu
    );

    const diagnosticResponse = await fetch(
      `${baseUrl}/api/internal/diagnostics/readiness`,
      {
        headers: {
          authorization: `Bearer ${INTERNAL_DIAGNOSTICS_TOKEN}`
        }
      }
    );
    const body = await diagnosticResponse.json() as {
      status: string;
      internalPilotReadiness: { ready: boolean };
      conversationContextMemory: boolean;
      conversationContextMemoryMode: string;
      conversationContextMemoryTtlMs: number;
      conversationContextMemoryMaxHops: number;
      governedNavigation: unknown;
      customerProductionReadiness: {
        ready: boolean;
        blockers: Array<{ code: string }>;
      };
    };

    expect(diagnosticResponse.status).toBe(200);
    expect(diagnosticResponse.headers.get("cache-control")).toBe("no-store");
    expect(body.status).toBe("ready");
    expect(body.internalPilotReadiness.ready).toBe(true);
    expect(body).toMatchObject({
      conversationContextMemory: true,
      conversationContextMemoryMode: "process-local-bounded",
      conversationContextMemoryTtlMs: 300_000,
      conversationContextMemoryMaxHops: 3,
      governedNavigation: {
        schemaVersion: "assistant-v3.navigation-catalog-metadata.v1",
        catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION
      }
    });
    expect(JSON.stringify(body.governedNavigation)).not.toMatch(
      /sourceUrl|contentHash|citation/iu
    );
    expect(body.customerProductionReadiness.ready).toBe(false);
    expect(body.customerProductionReadiness.blockers.map(({ code }) => code)).toContain(
      "MOCK_IDENTITY"
    );
    expect(body.customerProductionReadiness.blockers.map(({ code }) => code)).toContain(
      "PROCESS_LOCAL_CONVERSATION_MEMORY"
    );
    expect(current.marketSnapshot.mock.calls.map(([symbol]) => symbol)).toEqual([
      "AAPL",
      "NVDA",
      "BND"
    ]);
    expect(current.knowledgeReadiness).toHaveBeenCalledOnce();
    expect(current.criticalReadiness.signer).toHaveBeenCalledOnce();
    expect(current.criticalReadiness.audit).toHaveBeenCalledOnce();
    expect(current.criticalReadiness.storage).toHaveBeenCalledOnce();
    expect(current.criticalReadiness.observability).toHaveBeenCalledOnce();
    expect(modelReadinessProbe).toHaveBeenCalledTimes(2);
    expect(modelReadinessProbe.mock.calls.map(([model]) => model)).toEqual([
      "gpt-4o",
      "gpt-4.1"
    ]);
  });

  it("returns only generic public codes and never leaks dependency failures", async () => {
    modelReadinessProbe.mockRejectedValueOnce(
      new Error("secret OpenAI provider detail")
    );
    current.marketSnapshot.mockRejectedValueOnce(new Error("licensed feed credential"));
    current.knowledgeReadiness.mockRejectedValueOnce(new Error("private index path"));
    current.criticalReadiness.signer.mockRejectedValueOnce(new Error("signer key detail"));
    current.criticalReadiness.audit.mockRejectedValueOnce(new Error("audit path detail"));
    current.criticalReadiness.storage.mockRejectedValueOnce(new Error("storage path detail"));
    current.criticalReadiness.observability.mockRejectedValueOnce(
      new Error("observability path detail")
    );

    const response = await fetch(`${baseUrl}/api/ready`);
    const raw = await response.text();
    const body = JSON.parse(raw) as { errors: string[] };

    expect(response.status).toBe(503);
    expect(body.errors).toEqual(["DEPENDENCY_UNAVAILABLE"]);
    expect(raw).not.toMatch(
      /secret OpenAI|credential|private index|gpt|model|provider|knowledge/iu
    );

    const diagnosticsResponse = await fetch(
      `${baseUrl}/api/internal/diagnostics/readiness`,
      {
        headers: {
          authorization: `Bearer ${INTERNAL_DIAGNOSTICS_TOKEN}`
        }
      }
    );
    const diagnosticsRaw = await diagnosticsResponse.text();
    const diagnostics = JSON.parse(diagnosticsRaw) as { errors: string[] };
    expect(diagnostics.errors).toEqual([
      "OPENAI_MODEL_UNAVAILABLE",
      "MARKET_COVERAGE_UNAVAILABLE",
      "APPROVED_KNOWLEDGE_COVERAGE_UNAVAILABLE",
      "SIGNER_SELF_TEST_FAILED",
      "AUDIT_UNAVAILABLE",
      "STORAGE_UNAVAILABLE",
      "OBSERVABILITY_UNAVAILABLE"
    ]);
    expect(diagnosticsRaw).not.toMatch(
      /secret OpenAI|licensed feed credential|private index path|signer key detail|audit path detail|storage path detail|observability path detail/iu
    );
  });

  it("fails readiness when a nominally ready index lacks required AZ coverage", async () => {
    const complete = await current.application.approvedKnowledge.readiness();
    current.knowledgeReadiness.mockClear();
    current.knowledgeReadiness.mockResolvedValueOnce({
      ...complete,
      ready: true,
      requiredLocales: ["en-US", "az-AZ"],
      localeCoverage: complete.localeCoverage.filter(
        ({ locale }) => locale === "en-US"
      )
    });

    const response = await fetch(`${baseUrl}/api/ready`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: "assistant-v3.readiness.v1",
      status: "not-ready",
      errors: ["DEPENDENCY_UNAVAILABLE"]
    });

    const diagnostics = await fetch(
      `${baseUrl}/api/internal/diagnostics/readiness`,
      {
        headers: {
          authorization: `Bearer ${INTERNAL_DIAGNOSTICS_TOKEN}`
        }
      }
    );
    await expect(diagnostics.json()).resolves.toMatchObject({
      errors: ["APPROVED_KNOWLEDGE_COVERAGE_UNAVAILABLE"]
    });
  });

  it("does not probe dependencies or reveal diagnostics without the private bearer token", async () => {
    for (const authorization of [
      undefined,
      "Bearer wrong-but-long-enough-diagnostics-token-1234"
    ]) {
      const response = await fetch(
        `${baseUrl}/api/internal/diagnostics/readiness`,
        authorization === undefined ? {} : { headers: { authorization } }
      );
      const raw = await response.text();
      expect(response.status).toBe(404);
      expect(raw).not.toMatch(
        /gpt|openai|model|provider|index|blocker|credential|token/iu
      );
    }

    expect(modelReadinessProbe).not.toHaveBeenCalled();
    expect(current.marketSnapshot).not.toHaveBeenCalled();
    expect(current.knowledgeReadiness).not.toHaveBeenCalled();
    expect(current.criticalReadiness.signer).not.toHaveBeenCalled();
    expect(current.criticalReadiness.audit).not.toHaveBeenCalled();
    expect(current.criticalReadiness.storage).not.toHaveBeenCalled();
    expect(current.criticalReadiness.observability).not.toHaveBeenCalled();
  });

  it("single-flights concurrent readiness checks and serves the bounded cached result", async () => {
    modelReadinessProbe.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return true;
    });

    const responses = await Promise.all(
      Array.from({ length: 16 }, () => fetch(`${baseUrl}/api/ready`))
    );
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(modelReadinessProbe).toHaveBeenCalledTimes(2);
    expect(current.marketSnapshot).toHaveBeenCalledTimes(3);
    expect(current.knowledgeReadiness).toHaveBeenCalledTimes(1);
    expect(current.criticalReadiness.signer).toHaveBeenCalledTimes(1);
    expect(current.criticalReadiness.audit).toHaveBeenCalledTimes(1);
    expect(current.criticalReadiness.storage).toHaveBeenCalledTimes(1);
    expect(current.criticalReadiness.observability).toHaveBeenCalledTimes(1);

    const cached = await fetch(`${baseUrl}/api/ready`);
    expect(cached.status).toBe(200);
    expect(modelReadinessProbe).toHaveBeenCalledTimes(2);
    expect(current.marketSnapshot).toHaveBeenCalledTimes(3);
    expect(current.knowledgeReadiness).toHaveBeenCalledTimes(1);
    expect(current.criticalReadiness.signer).toHaveBeenCalledTimes(1);
  });
});

describe("customer-production route containment", () => {
  it.each([
    "/api/chat",
    "/v1/assistant/order-handoffs/open",
    "/orders/preview",
    "/api/bootstrap",
    "/api/internal/diagnostics/readiness",
    "/api/mastra/capabilities",
    "/api/client",
    "/api/portfolio",
    "/api/portfolio/stream",
    "/api/market/AAPL",
    "/api/market/AAPL/history",
    "/api/security/NVDA/research",
    "/api/metrics",
    "/metrics"
  ])("marks %s as internal-pilot-only", (pathname) => {
    expect(isInternalPilotOnlyRoute(pathname)).toBe(true);
  });

  it.each([
    "/api/health",
    "/api/ready",
    "/v1/assistant/sessions",
    "/v1/assistant/messages"
  ])("keeps %s outside the legacy route set", (pathname) => {
    expect(isInternalPilotOnlyRoute(pathname)).toBe(false);
  });

  it("separates rejected requests from successful and failed service work", () => {
    expect(classifyHttpWorkflowResult(200, false)).toBe("success");
    expect(classifyHttpWorkflowResult(399, false)).toBe("success");
    expect(classifyHttpWorkflowResult(400, false)).toBe("rejected");
    expect(classifyHttpWorkflowResult(429, false)).toBe("rejected");
    expect(classifyHttpWorkflowResult(500, false)).toBe("error");
    expect(classifyHttpWorkflowResult(200, true)).toBe("error");
  });
});
