import { describe, expect, it } from "vitest";
import type { TrustedRequestContext } from "../src/assistant-v3/contracts.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import { OrderHandoffStore } from "../src/assistant-v3/order-handoff.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";

const context: TrustedRequestContext = {
  schemaVersion: "assistant-v3.request-context.v1",
  requestId: "req-preview",
  sessionId: "session-1",
  conversationId: "conversation-1",
  principalRef: "principal-opaque-1",
  tenantRef: "tenant-1",
  locale: "en-US",
  jurisdiction: "AZ",
  channel: "web",
  environment: "test",
  requestedAt: "2026-07-22T08:00:00.000Z",
  authentication: { strength: "authenticated", authContextRef: "auth-test" },
  consentVersion: "consent-v1",
  consentScopes: ["assistant_use", "public_market_data"],
  entitlementVersion: "entitlement-v1",
  entitlements: ["assistant_access", "order_preview", "market_read"],
  policyVersion: "policy-v3",
  capabilities: ["order-ticket-preview"],
  featureSnapshot: { version: "features-v1", flags: { orderHandoff: true } }
};

function createPreview(store: OrderHandoffStore, requestId = context.requestId) {
  return store.createPreview({
    context: { ...context, requestId },
    symbol: "AAPL",
    requestedNotional: decimal("100"),
    previewPrice: decimal("200"),
    estimatedCommission: decimal("3"),
    estimatedDebit: decimal("103"),
    tariffVersion: "tariff-v1"
  });
}

describe("V3 signed order handoff", () => {
  it("requires explicit confirmation and returns a non-executable signed reference", () => {
    let now = Date.parse("2026-07-22T08:00:00.000Z");
    const store = new OrderHandoffStore({
      signer: new DevHmacSigner({ keyId: "test", secret: "x".repeat(32) }),
      now: () => now
    });
    const preview = store.createPreview({
      context,
      symbol: "AAPL",
      requestedNotional: decimal("100"),
      previewPrice: decimal("200"),
      estimatedCommission: decimal("3"),
      estimatedDebit: decimal("103"),
      tariffVersion: "tariff-v1"
    });
    expect(preview.status).toBe("awaiting-explicit-confirmation");
    expect(preview.expiresAt).toBe("2026-07-22T08:05:00.000Z");

    now += 1_000;
    const handoff = store.confirm({
      intentId: preview.intentId,
      context: { ...context, requestId: "req-confirm" },
      explicitConfirmation: true
    });
    expect(handoff.payload).toMatchObject({
      symbol: "AAPL",
      requestedNotional: "100.00000000",
      executionAllowed: false
    });
    expect(handoff.oneUse).toBe(true);
  });

  it("rejects cross-principal confirmation and replay", () => {
    const signer = new DevHmacSigner({ keyId: "test", secret: "y".repeat(32) });
    const store = new OrderHandoffStore({ signer });
    const preview = store.createPreview({
      context,
      symbol: "AAPL",
      requestedNotional: decimal("100"),
      previewPrice: decimal("200"),
      estimatedCommission: decimal("3"),
      estimatedDebit: decimal("103"),
      tariffVersion: "tariff-v1"
    });
    expect(() => store.confirm({
      intentId: preview.intentId,
      context: { ...context, principalRef: "attacker" },
      explicitConfirmation: true
    })).toThrow(/different principal/u);

    const handoff = store.confirm({
      intentId: preview.intentId,
      context,
      explicitConfirmation: true
    });
    expect(store.consume(handoff, context).intentId).toBe(preview.intentId);
    expect(() => store.consume(handoff, context)).toThrow(/already consumed/u);
    expect(() => store.confirm({
      intentId: preview.intentId,
      context,
      explicitConfirmation: true
    })).toThrow(/already confirmed/u);
  });

  it("binds the consumed payload to the signed order-handoff reference", () => {
    const signer = new DevHmacSigner({
      keyId: "order-handoff-test",
      secret: "z".repeat(32)
    });
    const store = new OrderHandoffStore({ signer });
    const preview = store.createPreview({
      context,
      symbol: "AAPL",
      requestedNotional: decimal("100"),
      previewPrice: decimal("200"),
      estimatedCommission: decimal("3"),
      estimatedDebit: decimal("103"),
      tariffVersion: "tariff-v1"
    });
    const handoff = store.confirm({
      intentId: preview.intentId,
      context,
      explicitConfirmation: true
    });

    expect(() =>
      store.consume(
        {
          ...handoff,
          payload: {
            ...handoff.payload,
            symbol: "NVDA",
            requestedNotional: decimal("999999")
          }
        },
        context
      )
    ).toThrow(/does not match its signed reference/u);
    expect(() =>
      store.consume(
        {
          ...handoff,
          handoffRef: signer.toCompactJws(handoff.payload)
        },
        context
      )
    ).toThrow(/signature is invalid/u);
    expect(() =>
      store.consume(
        {
          ...handoff,
          handoffRef: signer.toCompactJws({
            purpose: "assistant-v3.evidence.signed.v1",
            payload: handoff.payload
          })
        },
        context
      )
    ).toThrow(/signature is invalid/u);

    expect(store.consume(handoff, context)).toEqual(handoff.payload);
  });

  it("bounds preview state and admits a new preview only after deterministic expiry", () => {
    let now = Date.parse("2026-07-22T08:00:00.000Z");
    const store = new OrderHandoffStore({
      signer: new DevHmacSigner({
        keyId: "bounded-order-preview-test",
        secret: "p".repeat(32)
      }),
      now: () => now,
      ttlMs: 1_000,
      intentCapacity: 1
    });

    createPreview(store, "req-capacity-1");
    expect(() => createPreview(store, "req-capacity-2")).toThrow(
      /preview capacity is exhausted/u
    );

    now += 1_001;
    expect(createPreview(store, "req-after-expiry")).toMatchObject({
      status: "awaiting-explicit-confirmation",
      expiresAt: new Date(now + 1_000).toISOString()
    });
  });

  it("fails closed at consumed-handoff capacity and purges expired replay records", () => {
    let now = Date.parse("2026-07-22T08:00:00.000Z");
    const store = new OrderHandoffStore({
      signer: new DevHmacSigner({
        keyId: "bounded-consumed-handoff-test",
        secret: "c".repeat(32)
      }),
      now: () => now,
      ttlMs: 1_000,
      intentCapacity: 4,
      consumedHandoffCapacity: 1
    });

    const first = createPreview(store, "req-consumed-1");
    const firstHandoff = store.confirm({
      intentId: first.intentId,
      context,
      explicitConfirmation: true
    });
    expect(store.consume(firstHandoff, context).handoffId).toBe(
      firstHandoff.payload.handoffId
    );

    const second = createPreview(store, "req-consumed-2");
    const secondHandoff = store.confirm({
      intentId: second.intentId,
      context,
      explicitConfirmation: true
    });
    expect(() => store.consume(secondHandoff, context)).toThrow(
      /Consumed order-handoff capacity is exhausted/u
    );

    now += 1_001;
    const afterExpiry = createPreview(store, "req-consumed-after-expiry");
    const afterExpiryHandoff = store.confirm({
      intentId: afterExpiry.intentId,
      context,
      explicitConfirmation: true
    });
    expect(store.consume(afterExpiryHandoff, context).handoffId).toBe(
      afterExpiryHandoff.payload.handoffId
    );
  });

  it.each([
    { intentCapacity: 0 },
    { consumedHandoffCapacity: 0 },
    { intentCapacity: 100_001 },
    { consumedHandoffCapacity: Number.NaN }
  ])("rejects invalid order-state capacity configuration: %j", (capacity) => {
    expect(() => new OrderHandoffStore({
      signer: new DevHmacSigner({
        keyId: "invalid-capacity-test",
        secret: "i".repeat(32)
      }),
      ...capacity
    })).toThrow(RangeError);
  });
});
