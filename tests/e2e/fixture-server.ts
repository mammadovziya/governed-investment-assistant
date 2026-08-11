import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type {
  V3AssistantHttpRuntime,
  V3HttpCreatedSession
} from "../../src/assistant-v3/http.js";
import type {
  OrderHandoffScreenState,
  SignedOrderHandoff
} from "../../src/assistant-v3/order-handoff.js";
import type { SupportedLocale } from "../../src/assistant-v3/contracts.js";
import type { V3ServerApplication } from "../../src/server.js";
import {
  assistantResponseFor,
  E2E_CLIENT,
  E2E_CONVERSATION_ID,
  E2E_ORIGIN,
  E2E_PORTFOLIO
} from "./fixture-data.js";

process.umask(0o077);

// These values are deliberately installed before the dynamic source imports.
// dotenv therefore cannot populate a developer's real key from .env.local.
process.env.NODE_ENV = "test";
process.env.OPENAI_API_KEY = "e2e-disabled-no-provider-access";
process.env.ASSISTANT_RELEASE_TARGET = "internal-pilot";
process.env.ASSISTANT_V3_ENABLED = "true";
process.env.API_RATE_LIMIT_MAX = "10000";

interface FixtureRequest {
  readonly method: string;
  readonly path: string;
}

interface FixtureState {
  readonly requests: FixtureRequest[];
  readonly providerPortCalls: string[];
  readonly outboundFetchAttempts: string[];
  readonly unexpectedRuntimeCalls: string[];
}

const fixtureState: FixtureState = {
  requests: [],
  providerPortCalls: [],
  outboundFetchAttempts: [],
  unexpectedRuntimeCalls: []
};

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input, init) => {
  const rawUrl =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
  const url = new URL(rawUrl, E2E_ORIGIN);
  if (url.origin !== E2E_ORIGIN) {
    fixtureState.outboundFetchAttempts.push(url.origin);
    throw new Error("offline_e2e_outbound_fetch_blocked");
  }
  return nativeFetch(input, init);
}) as typeof fetch;

function providerPortTouched(port: string): never {
  fixtureState.providerPortCalls.push(port);
  throw new Error(`offline_e2e_provider_port_touched:${port}`);
}

function unexpectedRuntimeCall(operation: string): never {
  fixtureState.unexpectedRuntimeCalls.push(operation);
  throw new Error(`offline_e2e_unexpected_runtime_call:${operation}`);
}

const [
  { createApp },
  { V3_REGISTRY_MANIFEST }
] = await Promise.all([
  import("../../src/server.js"),
  import("../../src/assistant-v3/registry.js")
]);

let sessionSequence = 0;
const sessionLocales = new Map<string, SupportedLocale>();

function resetFixtureState(): void {
  fixtureState.requests.length = 0;
  fixtureState.providerPortCalls.length = 0;
  fixtureState.outboundFetchAttempts.length = 0;
  fixtureState.unexpectedRuntimeCalls.length = 0;
  sessionLocales.clear();
  sessionSequence = 0;
}

function createdSession(locale: SupportedLocale): V3HttpCreatedSession {
  sessionSequence += 1;
  const token =
    `e2e_session_${locale.replace("-", "_")}_${String(sessionSequence).padStart(24, "0")}`;
  sessionLocales.set(token, locale);
  return {
    sessionToken: token,
    sessionId:
      locale === "az-AZ"
        ? "00000000-0000-4000-8000-000000000422"
        : "00000000-0000-4000-8000-000000000421",
    conversationId: E2E_CONVERSATION_ID,
    locale,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    consent: {
      status: "granted",
      version: "offline-e2e-consent-v1",
      scopes: ["assistant_use"]
    },
    capabilities: [
      "portfolio-insight",
      "public-research",
      "approved-knowledge"
    ]
  };
}

const runtime: V3AssistantHttpRuntime = {
  async createSession(input) {
    return createdSession(input.locale ?? "en-US");
  },
  async message(input) {
    const locale = sessionLocales.get(input.sessionToken);
    if (!locale) throw new Error("offline_e2e_unknown_session");
    return structuredClone(assistantResponseFor(locale, input.message));
  },
  async confirmOrderHandoff(_input): Promise<SignedOrderHandoff> {
    return unexpectedRuntimeCall("confirm-order-handoff");
  },
  async openOrderHandoff(_input): Promise<OrderHandoffScreenState> {
    return unexpectedRuntimeCall("open-order-handoff");
  }
};

const application: V3ServerApplication = {
  runtime,
  manifest: V3_REGISTRY_MANIFEST,
  readiness: {
    identityMode: "mock-internal-pilot",
    portfolioMode: "synthetic-ledger",
    marketLicenceClass: "development-public-feed",
    developmentSigningKey: true,
    storageUrl: "file:offline-browser-e2e",
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
      id: "offline-e2e-market",
      displayName: "Offline E2E market",
      licenseClass: "synthetic-test-only"
    },
    async getSnapshot(_symbol) {
      return providerPortTouched("market.getSnapshot");
    },
    async getResearch(_symbol) {
      return providerPortTouched("market.getResearch");
    }
  },
  history: {
    async getHistory(_symbol, _range) {
      return providerPortTouched("history.getHistory");
    }
  },
  portfolio: {
    getClient() {
      return structuredClone(E2E_CLIENT);
    },
    async getSummary() {
      return structuredClone(E2E_PORTFOLIO);
    }
  },
  approvedKnowledge: {
    async readiness() {
      return providerPortTouched("approvedKnowledge.readiness");
    }
  },
  criticalReadiness: {
    async signer() {
      return providerPortTouched("criticalReadiness.signer");
    },
    async audit() {
      return providerPortTouched("criticalReadiness.audit");
    },
    async storage() {
      return providerPortTouched("criticalReadiness.storage");
    },
    async observability() {
      return providerPortTouched("criticalReadiness.observability");
    }
  }
};

const app = createApp({
  assistantV3: application,
  readinessModelProbe: async (_modelId) =>
    providerPortTouched("readiness.model")
});

app.post("/__e2e__/reset", (_request, response) => {
  resetFixtureState();
  response.set("cache-control", "no-store");
  response.status(204).end();
});

app.get("/__e2e__/state", (_request, response) => {
  response.set("cache-control", "no-store");
  response.json({
    requests: fixtureState.requests,
    providerPortCalls: fixtureState.providerPortCalls,
    outboundFetchAttempts: fixtureState.outboundFetchAttempts,
    unexpectedRuntimeCalls: fixtureState.unexpectedRuntimeCalls
  });
});

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", E2E_ORIGIN).pathname;
  if (!path.startsWith("/__e2e__/")) {
    fixtureState.requests.push({
      method: request.method ?? "UNKNOWN",
      path
    });
  }
  app(request, response);
});

server.listen(4173, "127.0.0.1", () => {
  const address = server.address() as AddressInfo | null;
  if (
    address === null ||
    address.address !== "127.0.0.1" ||
    address.port !== 4173
  ) {
    throw new Error("offline_e2e_server_binding_invalid");
  }
  process.stdout.write("offline-e2e fixture ready on 127.0.0.1:4173\n");
});

let closing = false;
function closeFixture(): void {
  if (closing) return;
  closing = true;
  if (
    fixtureState.providerPortCalls.length > 0 ||
    fixtureState.outboundFetchAttempts.length > 0 ||
    fixtureState.unexpectedRuntimeCalls.length > 0
  ) {
    process.exitCode = 1;
  }
  server.closeAllConnections();
  const deadline = setTimeout(() => process.exit(1), 2_000);
  deadline.unref();
  server.close((error) => {
    clearTimeout(deadline);
    if (error) process.exitCode = 1;
  });
}

process.once("SIGINT", closeFixture);
process.once("SIGTERM", closeFixture);
