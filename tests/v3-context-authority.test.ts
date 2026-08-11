import { describe, expect, it } from "vitest";
import {
  OrderConfirmationAuthority,
  TrustedRequestContextAuthority
} from "../src/assistant-v3/context-authority.js";
import { mockTrustedRequestContext } from "../src/assistant-v3/mock-portfolio.js";
import { V3SessionAuthority } from "../src/assistant-v3/sessions.js";

function trustedContextFixture(now: () => number) {
  const sessions = new V3SessionAuthority({ secret: "s".repeat(32), now });
  const issued = sessions.issue({
    tenantId: "tenant",
    principalId: "principal",
    authContextId: "auth",
    consentVersion: "consent",
    consents: ["assistant_use"],
    entitlementVersion: "entitlements",
    entitlements: ["assistant_access"]
  });
  return {
    issued,
    context: {
      ...mockTrustedRequestContext,
      sessionId: issued.session.claims.sessionId
    }
  };
}

describe("V3 trusted workflow context", () => {
  it("is one-use, current, and session-bound", () => {
    const now = Date.parse("2026-07-22T08:00:00.000Z");
    const { issued, context } = trustedContextFixture(() => now);
    const authority = new TrustedRequestContextAuthority({ now: () => now });
    const token = authority.issue(context, issued.session);
    expect(authority.consume(token).context.requestId).toBe(context.requestId);
    expect(() => authority.consume(token)).toThrow(/already consumed/u);
  });

  it("fails closed at capacity and releases one-use context state after consumption", () => {
    const now = Date.parse("2026-07-22T08:00:00.000Z");
    const { issued, context } = trustedContextFixture(() => now);
    const authority = new TrustedRequestContextAuthority({
      now: () => now,
      capacity: 1
    });
    const token = authority.issue(context, issued.session);

    expect(() => authority.issue(
      { ...context, requestId: "request-at-capacity" },
      issued.session
    )).toThrow(/capacity is exhausted/u);
    expect(authority.pendingCount).toBe(1);

    authority.consume(token);
    expect(authority.pendingCount).toBe(0);
    expect(() => authority.consume(token)).toThrow(/already consumed/u);
    expect(authority.issue(
      { ...context, requestId: "request-after-consume" },
      issued.session
    )).toMatch(/^v3c_/u);
  });

  it("purges expired context state before applying capacity", () => {
    let now = Date.parse("2026-07-22T08:00:00.000Z");
    const { issued, context } = trustedContextFixture(() => now);
    const authority = new TrustedRequestContextAuthority({
      now: () => now,
      ttlMs: 10,
      capacity: 1
    });
    authority.issue(context, issued.session);
    now += 11;

    expect(authority.pendingCount).toBe(0);
    expect(authority.issue(
      { ...context, requestId: "request-after-expiry" },
      issued.session
    )).toMatch(/^v3c_/u);
  });

  it.each([
    { capacity: 0 },
    { capacity: 100_001 },
    { capacity: Number.NaN },
    { ttlMs: Number.NaN }
  ])("rejects invalid trusted-context configuration: %j", (input) => {
    expect(() => new TrustedRequestContextAuthority(input)).toThrow(RangeError);
  });
});

describe("V3 order confirmation authority", () => {
  const binding = {
    intentId: "intent-1",
    sessionId: "session-1",
    principalRef: "principal-1"
  };

  it("burns a mismatched token and then releases its capacity", () => {
    const now = Date.parse("2026-07-22T08:00:00.000Z");
    const authority = new OrderConfirmationAuthority({
      now: () => now,
      capacity: 1
    });
    const token = authority.issue(binding);
    expect(() => authority.issue({ ...binding, intentId: "intent-2" })).toThrow(
      /capacity is exhausted/u
    );

    expect(() => authority.consume(token, {
      ...binding,
      principalRef: "different-principal"
    })).toThrow(/binding does not match/u);
    expect(authority.pendingCount).toBe(0);
    expect(() => authority.consume(token, binding)).toThrow(/already consumed/u);
    expect(authority.issue({ ...binding, intentId: "intent-after-burn" })).toMatch(
      /^v3confirm_/u
    );
  });

  it("purges expired confirmations before applying capacity", () => {
    let now = Date.parse("2026-07-22T08:00:00.000Z");
    const authority = new OrderConfirmationAuthority({
      now: () => now,
      ttlMs: 10,
      capacity: 1
    });
    const expired = authority.issue(binding);
    now += 11;

    expect(authority.pendingCount).toBe(0);
    expect(() => authority.consume(expired, binding)).toThrow(/expired/u);
    expect(authority.issue({ ...binding, intentId: "intent-after-expiry" })).toMatch(
      /^v3confirm_/u
    );
  });

  it.each([
    { capacity: 0 },
    { capacity: 100_001 },
    { capacity: Number.NaN },
    { ttlMs: 0 },
    { ttlMs: 60_001 },
    { ttlMs: Number.NaN }
  ])("rejects invalid confirmation configuration: %j", (input) => {
    expect(() => new OrderConfirmationAuthority(input)).toThrow(RangeError);
  });
});
