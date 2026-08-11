import type { Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantResponse } from "../src/assistant-v3/contracts.js";
import {
  V3HttpRuntimeError,
  createV3HttpRouter,
  type V3AssistantHttpRuntime,
  type V3HttpCreatedSession,
  type V3HttpRuntimeErrorCode
} from "../src/assistant-v3/http.js";
import type {
  OrderHandoffScreenState,
  SignedOrderHandoff
} from "../src/assistant-v3/order-handoff.js";

const SESSION_TOKEN = "v3s.payload.signature_value_0123456789";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000020";
const INTENT_ID = "00000000-0000-4000-8000-000000000030";
const AS_OF = "2026-07-22T12:00:00.000Z";

const CREATED_SESSION: V3HttpCreatedSession = {
  sessionToken: SESSION_TOKEN,
  sessionId: SESSION_ID,
  conversationId: CONVERSATION_ID,
  locale: "en-US",
  expiresAt: "2026-07-22T12:15:00.000Z",
  consent: {
    status: "granted",
    version: "consent-v3",
    scopes: ["assistant_use", "public_market_data"]
  },
  capabilities: ["market-read", "approved-knowledge-read"]
};

const ASSISTANT_RESPONSE: AssistantResponse = {
  schemaVersion: "assistant-v3.response.v1",
  requestId: "request-http-1",
  conversationId: CONVERSATION_ID,
  status: "complete",
  message: "The grounded answer.",
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
    workflowRunId: "workflow-http-1",
    model: null,
    toolExecutionIds: [],
    factIds: [],
    policyVersion: "3.0.0"
  }
};

const SIGNED_HANDOFF: SignedOrderHandoff = {
  handoffRef:
    "eyJhbGciOiJIUzI1NiJ9.eyJwdXJwb3NlIjoib3JkZXItaGFuZG9mZiJ9.c2lnbmF0dXJl", // gitleaks:allow -- synthetic unsigned JWT fixture
  payload: {
    schemaVersion: "assistant-v3.order-handoff.v1",
    handoffId: "00000000-0000-4000-8000-000000000040",
    intentId: INTENT_ID,
    principalRef: "principal-1",
    tenantRef: "tenant-1",
    previewRequestId: "request-http-1",
    side: "BUY",
    symbol: "NVDA",
    requestedNotional: "100.00000000" as SignedOrderHandoff["payload"]["requestedNotional"],
    currency: "USD",
    issuedAt: AS_OF,
    expiresAt: "2026-07-22T12:05:00.000Z",
    nonce: "00000000-0000-4000-8000-000000000050",
    executionAllowed: false
  },
  expiresAt: "2026-07-22T12:05:00.000Z",
  oneUse: true,
  destination: "/orders/preview"
};
const ORDER_SCREEN_STATE: OrderHandoffScreenState = {
  schemaVersion: "assistant-v3.order-screen-state.v1",
  status: "external-order-screen-not-integrated",
  handoffId: SIGNED_HANDOFF.payload.handoffId,
  intentId: SIGNED_HANDOFF.payload.intentId,
  side: "BUY",
  symbol: "NVDA",
  requestedNotional: SIGNED_HANDOFF.payload.requestedNotional,
  currency: "USD",
  expiresAt: SIGNED_HANDOFF.expiresAt,
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
};

interface RuntimeFixture {
  runtime: V3AssistantHttpRuntime;
  createSession: ReturnType<typeof vi.fn>;
  message: ReturnType<typeof vi.fn>;
  confirmOrderHandoff: ReturnType<typeof vi.fn>;
  openOrderHandoff: ReturnType<typeof vi.fn>;
}

function runtimeFixture(): RuntimeFixture {
  const createSession = vi.fn(async () => structuredClone(CREATED_SESSION));
  const message = vi.fn(async () => structuredClone(ASSISTANT_RESPONSE));
  const confirmOrderHandoff = vi.fn(async () => structuredClone(SIGNED_HANDOFF));
  const openOrderHandoff = vi.fn(async () => structuredClone(ORDER_SCREEN_STATE));
  return {
    createSession,
    message,
    confirmOrderHandoff,
    openOrderHandoff,
    runtime: { createSession, message, confirmOrderHandoff, openOrderHandoff }
  };
}

describe("V3 HTTP router", () => {
  let server: Server | undefined;
  let baseUrl = "";
  let current: RuntimeFixture;

  beforeEach(async () => {
    current = runtimeFixture();
    const app = express();
    app.disable("x-powered-by");
    app.use(createV3HttpRouter(current.runtime));
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  async function post(
    path: string,
    body: unknown,
    authorization?: string
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === undefined ? {} : { authorization })
      },
      body: JSON.stringify(body)
    });
  }

  it("creates a server-owned session from one required locale", async () => {
    current.createSession.mockImplementationOnce(async () => ({
      ...structuredClone(CREATED_SESSION),
      locale: "az-AZ"
    }));

    const response = await post("/v1/assistant/sessions", { locale: "az-AZ" });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      sessionToken: SESSION_TOKEN,
      sessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
      locale: "az-AZ",
      consent: { status: "granted" },
      capabilities: ["market-read", "approved-knowledge-read"]
    });
    expect(current.createSession).toHaveBeenCalledWith({ locale: "az-AZ" });
  });

  it("requires an explicit locale and application/json request body", async () => {
    const missingLocale = await post("/v1/assistant/sessions", {});
    expect(missingLocale.status).toBe(400);

    const textBody = await fetch(`${baseUrl}/v1/assistant/sessions`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ locale: "en-US" })
    });
    expect(textBody.status).toBe(400);
    expect(current.createSession).not.toHaveBeenCalled();
  });

  it("rejects client-controlled identity, conversation, policy, and tool session fields", async () => {
    const response = await post("/v1/assistant/sessions", {
      locale: "en-US",
      clientId: "client-from-browser",
      accountId: "account-from-browser",
      conversationId: CONVERSATION_ID,
      policy: { allowedToolIds: ["anything"] },
      tool: "read-portfolio-snapshot"
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "The request is invalid." }
    });
    expect(current.createSession).not.toHaveBeenCalled();
  });

  it("passes only a normalized message and the Bearer session token to the runtime", async () => {
    const response = await post(
      "/v1/assistant/messages",
      { message: "  What is the NVDA price?  " },
      `Bearer ${SESSION_TOKEN}`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(ASSISTANT_RESPONSE);
    expect(current.message).toHaveBeenCalledWith({
      sessionToken: SESSION_TOKEN,
      message: "What is the NVDA price?"
    });
  });

  it.each([
    undefined,
    "Basic opaque-token",
    "Bearer short",
    `Bearer ${SESSION_TOKEN} extra`,
    `bearer ${"x".repeat(4_097)}`
  ])("rejects missing or malformed session authorization: %s", async (authorization) => {
    const response = await post(
      "/v1/assistant/messages",
      { message: "hello" },
      authorization
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_session",
        message: "A valid assistant session is required."
      }
    });
    expect(current.message).not.toHaveBeenCalled();
  });

  it("rejects oversized messages and all client-owned message control fields", async () => {
    const extraFields = await post(
      "/v1/assistant/messages",
      {
        message: "show portfolio",
        clientId: "attacker",
        accountId: "another-account",
        conversationId: CONVERSATION_ID,
        locale: "az-AZ",
        policy: "allow",
        tool: "read-portfolio-snapshot"
      },
      `Bearer ${SESSION_TOKEN}`
    );
    const oversized = await post(
      "/v1/assistant/messages",
      { message: "x".repeat(2_001) },
      `Bearer ${SESSION_TOKEN}`
    );

    expect(extraFields.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(current.message).not.toHaveBeenCalled();
  });

  it("confirms only one UUID-bound, explicitly confirmed handoff", async () => {
    const response = await post(
      `/v1/assistant/order-handoffs/${INTENT_ID}/confirm`,
      { confirmed: true },
      `Bearer ${SESSION_TOKEN}`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(SIGNED_HANDOFF);
    expect(current.confirmOrderHandoff).toHaveBeenCalledWith({
      sessionToken: SESSION_TOKEN,
      intentId: INTENT_ID,
      confirmed: true
    });
  });

  it("opens only a bounded signed handoff and returns a non-executable screen", async () => {
    const response = await post(
      "/v1/assistant/order-handoffs/open",
      { handoff: SIGNED_HANDOFF },
      `Bearer ${SESSION_TOKEN}`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(ORDER_SCREEN_STATE);
    expect(current.openOrderHandoff).toHaveBeenCalledWith({
      sessionToken: SESSION_TOKEN,
      handoff: SIGNED_HANDOFF
    });
  });

  it("rejects malformed, expanded, or unsigned order-screen handoffs", async () => {
    for (const handoff of [
      { ...SIGNED_HANDOFF, handoffRef: "unsigned" },
      { ...SIGNED_HANDOFF, accountId: "attacker" },
      { ...SIGNED_HANDOFF, oneUse: false }
    ]) {
      const response = await post(
        "/v1/assistant/order-handoffs/open",
        { handoff },
        `Bearer ${SESSION_TOKEN}`
      );
      expect(response.status).toBe(400);
    }
    expect(current.openOrderHandoff).not.toHaveBeenCalled();
  });

  it.each([
    ["not-a-uuid", { confirmed: true }],
    [INTENT_ID, { confirmed: false }],
    [INTENT_ID, { confirmed: true, accountId: "attacker" }],
    [INTENT_ID, { confirmed: true, policy: "bypass" }]
  ])("rejects an invalid or expanded handoff request", async (intentId, body) => {
    const response = await post(
      `/v1/assistant/order-handoffs/${intentId}/confirm`,
      body,
      `Bearer ${SESSION_TOKEN}`
    );

    expect(response.status).toBe(400);
    expect(current.confirmOrderHandoff).not.toHaveBeenCalled();
  });

  it("keeps /api/chat compatible while creating identity and conversation server-side", async () => {
    current.createSession.mockImplementationOnce(async () => ({
      ...structuredClone(CREATED_SESSION),
      locale: "az-AZ"
    }));
    const response = await post("/api/chat", {
      message: "  Portfelimi izah et  ",
      locale: "az-AZ"
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(ASSISTANT_RESPONSE);
    expect(current.createSession).toHaveBeenCalledWith({ locale: "az-AZ" });
    expect(current.message).toHaveBeenCalledWith({
      sessionToken: SESSION_TOKEN,
      message: "Portfelimi izah et"
    });

    const injectedConversation = await post("/api/chat", {
      message: "portfolio",
      conversationId: CONVERSATION_ID,
      clientId: "attacker"
    });
    expect(injectedConversation.status).toBe(400);
    expect(current.createSession).toHaveBeenCalledTimes(1);
  });

  it.each<[V3HttpRuntimeErrorCode, number]>([
    ["invalid_request", 400],
    ["invalid_session", 401],
    ["forbidden", 403],
    ["conflict", 409],
    ["expired", 410],
    ["rate_limited", 429],
    ["unavailable", 503]
  ])("maps runtime error %s to safe HTTP %i", async (code, expectedStatus) => {
    current.message.mockRejectedValueOnce(
      new V3HttpRuntimeError(code, "secret database host and customer detail", {
        ...(code === "rate_limited" ? { retryAfterSeconds: 17 } : {})
      })
    );

    const response = await post(
      "/v1/assistant/messages",
      { message: "hello" },
      `Bearer ${SESSION_TOKEN}`
    );
    const raw = await response.text();

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(raw).not.toContain("secret database");
    expect(JSON.parse(raw)).toMatchObject({ error: { code } });
    expect(response.headers.get("retry-after")).toBe(
      code === "rate_limited" ? "17" : null
    );
  });

  it("maps unknown runtime and malformed JSON failures without leaking details", async () => {
    current.message.mockRejectedValueOnce(new Error("password=private-internal-value"));
    const runtimeFailure = await post(
      "/v1/assistant/messages",
      { message: "hello" },
      `Bearer ${SESSION_TOKEN}`
    );
    const runtimeBody = await runtimeFailure.text();

    expect(runtimeFailure.status).toBe(503);
    expect(runtimeBody).not.toContain("private-internal-value");

    const malformed = await fetch(`${baseUrl}/v1/assistant/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json"
    });
    const malformedBody = await malformed.text();
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("cache-control")).toBe("no-store");
    expect(malformedBody).not.toContain("Unexpected token");

    const tooLarge = await fetch(`${baseUrl}/v1/assistant/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "en-US", padding: "x".repeat(20_000) })
    });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.headers.get("cache-control")).toBe("no-store");
    expect(current.createSession).not.toHaveBeenCalled();
  });
});
