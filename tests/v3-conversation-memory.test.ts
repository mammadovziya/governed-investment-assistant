import { afterEach, describe, expect, it, vi } from "vitest";

import type { TrustedRequestContext } from "../src/assistant-v3/contracts.js";
import {
  BoundedV3ConversationMemory,
  V3_CONVERSATION_MEMORY_MAX_ASSISTED_HOPS,
  V3_CONVERSATION_MEMORY_MAX_SERIALIZED_BYTES,
  V3ConversationMemoryError,
  type V3ConversationMemoryScope,
  type V3ConversationMemoryStorage
} from "../src/assistant-v3/conversation-memory.js";
import {
  V3SessionAuthority,
  type V3IssuedSession
} from "../src/assistant-v3/sessions.js";
import { canonicalHash, DevHmacSigner } from "../src/assistant-v3/signing.js";

const START = Date.UTC(2026, 6, 22, 12, 0, 0);

class InspectableStorage implements V3ConversationMemoryStorage {
  readonly records = new Map<string, unknown>();
  beforeNextCompareAndSet: (() => void) | undefined;
  beforeNextCompareAndDelete: (() => void) | undefined;

  get(bindingHash: string): unknown {
    return this.records.get(bindingHash);
  }

  compareAndSet(
    bindingHash: string,
    expectedRecord: unknown | undefined,
    signedRecord: string,
    _expiresAt: number
  ): boolean {
    const beforeCompare = this.beforeNextCompareAndSet;
    this.beforeNextCompareAndSet = undefined;
    beforeCompare?.();
    if (!Object.is(this.records.get(bindingHash), expectedRecord)) return false;
    this.records.set(bindingHash, signedRecord);
    return true;
  }

  compareAndDelete(bindingHash: string, expectedRecord: unknown): boolean {
    const beforeCompare = this.beforeNextCompareAndDelete;
    this.beforeNextCompareAndDelete = undefined;
    beforeCompare?.();
    if (
      !this.records.has(bindingHash) ||
      !Object.is(this.records.get(bindingHash), expectedRecord)
    ) {
      return false;
    }
    return this.records.delete(bindingHash);
  }

  entries(): IterableIterator<readonly [string, unknown]> {
    return this.records.entries();
  }

  size(): number {
    return this.records.size;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

function contextFor(
  issued: V3IssuedSession,
  input: { conversationId?: string; policyVersion?: string } = {}
): TrustedRequestContext {
  const claims = issued.session.claims;
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-memory-test",
    sessionId: claims.sessionId,
    conversationId: input.conversationId ?? "conversation-memory-test",
    principalRef: claims.principalId,
    tenantRef: claims.tenantId,
    locale: "en-US",
    jurisdiction: "AZ",
    channel: "test",
    environment: "test",
    requestedAt: new Date(claims.issuedAt).toISOString(),
    authentication: {
      strength: claims.authLevel,
      authContextRef: claims.authContextId
    },
    consentVersion: claims.consentVersion,
    consentScopes: [...claims.consents],
    entitlementVersion: claims.entitlementVersion,
    entitlements: [...claims.entitlements],
    policyVersion: input.policyVersion ?? "3.0.0",
    capabilities: ["market-read", "portfolio-read"],
    featureSnapshot: {
      version: "memory-test-v1",
      flags: { boundedConversationContext: true }
    }
  };
}

function issueScope(
  authority: V3SessionAuthority,
  input: {
    tenantId?: string;
    principalId?: string;
    conversationId?: string;
    ttlMs?: number;
  } = {}
): V3ConversationMemoryScope {
  const issued = authority.issue({
    tenantId: input.tenantId ?? "tenant:demo-invest",
    principalId: input.principalId ?? "principal:mock-client-001",
    authContextId: `auth:${input.principalId ?? "mock-client-001"}`,
    consentVersion: "pilot-consent-v3",
    consents: ["assistant_use", "public_market_data", "portfolio_data"],
    entitlementVersion: "pilot-entitlements-v3",
    entitlements: ["assistant_access", "market_read", "portfolio_read"],
    ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs })
  });
  return {
    context: contextFor(issued, {
      ...(input.conversationId === undefined
        ? {}
        : { conversationId: input.conversationId })
    }),
    session: issued.session
  };
}

function signedPayload(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") throw new TypeError("Expected a compact signed record.");
  const encodedPayload = raw.split(".")[1];
  if (!encodedPayload) throw new TypeError("Signed record has no payload.");
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function expectMemoryError(code: string) {
  return expect.objectContaining({
    name: "V3ConversationMemoryError",
    code
  });
}

describe("bounded deterministic V3 conversation memory", () => {
  it("stores only a signed bounded subject pointer under the complete trusted binding", () => {
    let now = START;
    const authority = new V3SessionAuthority({
      secret: "memory-session-secret-that-is-at-least-thirty-two-bytes",
      now: () => now
    });
    const signer = new DevHmacSigner({
      keyId: "assistant-v3-development",
      secret: "memory-record-secret-that-is-at-least-thirty-two-bytes"
    });
    const storage = new InspectableStorage();
    const memory = new BoundedV3ConversationMemory({ signer, storage, now: () => now });
    const scope = issueScope(authority, {
      tenantId: "tenant:confidential-001",
      principalId: "principal:account-123-secret",
      conversationId: "conversation-server-issued"
    });

    const bindingPayload = {
      schemaVersion: "assistant-v3.conversation-memory-binding.v1",
      tenantRef: scope.context.tenantRef,
      principalRef: scope.context.principalRef,
      sessionId: scope.context.sessionId,
      conversationId: scope.context.conversationId,
      authContextRef: scope.context.authentication.authContextRef,
      consentVersion: scope.context.consentVersion,
      entitlementVersion: scope.context.entitlementVersion,
      policyVersion: scope.context.policyVersion
    };
    const expectedBinding = `hmac-sha256:${signer.sign(bindingPayload).signature}`;
    const written = memory.write(scope, {
      symbols: ["nvda", "AAPL"],
      route: "company_research"
    });
    const raw = storage.records.get(expectedBinding);
    expect(typeof raw).toBe("string");

    expect(written).toEqual({
      schemaVersion: "assistant-v3.conversation-memory.v1",
      bindingHash: expectedBinding,
      symbols: ["NVDA", "AAPL"],
      lastRoute: "company_research",
      updatedAt: START,
      expiresAt: START + 5 * 60_000,
      assistedHopsRemaining: V3_CONVERSATION_MEMORY_MAX_ASSISTED_HOPS,
      version: 1,
      revision: canonicalHash(raw)
    });
    expect(Object.isFrozen(written)).toBe(true);
    expect(Object.isFrozen(written.symbols)).toBe(true);
    expect(memory.read(scope, "security_risk")).toEqual({
      status: "hit",
      snapshot: written
    });
    expect(memory.peek(scope)).toEqual({ status: "hit", snapshot: written });

    expect(Buffer.byteLength(raw as string, "utf8")).toBeLessThanOrEqual(
      V3_CONVERSATION_MEMORY_MAX_SERIALIZED_BYTES
    );
    const payload = signedPayload(raw);
    expect(Object.keys(payload).sort()).toEqual(["b", "e", "h", "n", "r", "s", "u", "v"]);
    expect(payload).toMatchObject({
      b: expectedBinding,
      s: ["NVDA", "AAPL"],
      r: "company_research",
      h: 3,
      n: 1,
      v: 1
    });
    const serializedPayload = JSON.stringify(payload);
    for (const forbidden of [
      scope.context.tenantRef,
      scope.context.principalRef,
      scope.context.sessionId,
      scope.context.conversationId,
      scope.context.authentication.authContextRef,
      "prompt",
      "fact",
      "account-123-secret"
    ]) {
      expect(serializedPayload).not.toContain(forbidden);
    }
    now += 1;
  });

  it("caps retention at five minutes and at the earlier session expiry", () => {
    let now = START;
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => now });
    const signer = new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) });
    const memory = new BoundedV3ConversationMemory({ signer, now: () => now, ttlMs: 1_000 });
    const scope = issueScope(authority);
    memory.write(scope, { symbols: ["NVDA"], route: "market_quote" });

    now += 1_001;
    expect(memory.read(scope, "security_risk")).toEqual({ status: "expired", snapshot: null });
    expect(memory.read(scope, "security_risk")).toEqual({ status: "miss", snapshot: null });

    now = START + 10_000;
    const shortSession = issueScope(authority, { ttlMs: 60_000 });
    const capped = new BoundedV3ConversationMemory({ signer, now: () => now }).write(
      shortSession,
      { symbols: ["AAPL"], route: "technical_analysis" }
    );
    expect(capped.expiresAt).toBe(shortSession.session.claims.expiresAt);
    expect(() => new BoundedV3ConversationMemory({ signer, ttlMs: 300_001 })).toThrow(
      /five minutes/u
    );
  });

  it("physically deletes idle records at TTL without a later read or purge", () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const authority = new V3SessionAuthority({
      secret: "s".repeat(40),
      now: Date.now
    });
    const storage = new InspectableStorage();
    const memory = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) }),
      storage,
      now: Date.now,
      ttlMs: 1_000
    });
    const scope = issueScope(authority);

    memory.write(scope, { symbols: ["NVDA"], route: "market_quote" });
    expect(storage.size()).toBe(1);
    vi.advanceTimersByTime(999);
    expect(storage.size()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(storage.size()).toBe(0);
  });

  it("allows exactly three committed assisted hops and uses optimistic concurrency", () => {
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => START });
    const memory = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) }),
      now: () => START
    });
    const scope = issueScope(authority);
    let snapshot = memory.write(scope, { symbols: ["NVDA"], route: "market_quote" });

    for (const [route, expectedHops] of [
      ["security_risk", 2],
      ["news_sentiment", 1],
      ["technical_analysis", 0]
    ] as const) {
      const read = memory.read(scope, route);
      expect(read.status).toBe("hit");
      if (read.status !== "hit") throw new Error("Expected memory hit.");
      snapshot = memory.commitAssisted(scope, {
        expectedVersion: read.snapshot.version,
        expectedRevision: read.snapshot.revision,
        route
      });
      expect(snapshot.assistedHopsRemaining).toBe(expectedHops);
    }

    expect(snapshot.version).toBe(4);
    expect(memory.read(scope, "company_research")).toEqual({
      status: "exhausted",
      snapshot: null
    });

    const reset = memory.write(scope, { symbols: ["AAPL"], route: "market_quote" });
    const firstRead = memory.read(scope, "security_risk");
    if (firstRead.status !== "hit") throw new Error("Expected memory hit.");
    const replaced = memory.write(scope, { symbols: ["INTC"], route: "market_quote" });
    expect(replaced.version).toBe(reset.version + 1);
    expect(() => memory.commitAssisted(scope, {
      expectedVersion: firstRead.snapshot.version,
      expectedRevision: firstRead.snapshot.revision,
      route: "security_risk"
    })).toThrow(expectMemoryError("stale_assisted_read"));

    const oneHop = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "one-hop-memory", secret: "h".repeat(40) }),
      now: () => START,
      maxAssistedHops: 1
    });
    const oneHopWritten = oneHop.write(scope, {
      symbols: ["NVDA"],
      route: "market_quote"
    });
    expect(oneHopWritten.assistedHopsRemaining).toBe(1);
    oneHop.commitAssisted(scope, {
      expectedVersion: oneHopWritten.version,
      expectedRevision: oneHopWritten.revision,
      route: "security_risk"
    });
    expect(oneHop.peek(scope)).toEqual({ status: "exhausted", snapshot: null });
    expect(() => new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "invalid-hops", secret: "h".repeat(40) }),
      maxAssistedHops: 4
    })).toThrow(/between 1 and 3/u);
  });

  it("uses atomic compare-and-set so a concurrent anchor cannot be overwritten", () => {
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => START });
    const storage = new InspectableStorage();
    const memory = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) }),
      storage,
      now: () => START
    });
    const scope = issueScope(authority);
    memory.write(scope, { symbols: ["NVDA"], route: "market_quote" });
    const assistedRead = memory.read(scope, "security_risk");
    if (assistedRead.status !== "hit") throw new Error("Expected memory hit.");

    storage.beforeNextCompareAndSet = () => {
      memory.write(scope, { symbols: ["AAPL"], route: "market_quote" });
    };
    expect(() => memory.commitAssisted(scope, {
      expectedVersion: assistedRead.snapshot.version,
      expectedRevision: assistedRead.snapshot.revision,
      route: "security_risk"
    })).toThrow(expectMemoryError("stale_assisted_read"));
    expect(memory.peek(scope)).toMatchObject({
      status: "hit",
      snapshot: { symbols: ["AAPL"], lastRoute: "market_quote", version: 2 }
    });
  });

  it("rejects an ABA-assisted commit after delete and recreate both use version one", () => {
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => START });
    const memory = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) }),
      now: () => START
    });
    const scope = issueScope(authority);
    memory.write(scope, { symbols: ["NVDA"], route: "market_quote" });
    const staleRead = memory.read(scope, "security_risk");
    if (staleRead.status !== "hit") throw new Error("Expected memory hit.");

    expect(memory.clear(scope)).toBe(true);
    const replacement = memory.write(scope, {
      symbols: ["AAPL"],
      route: "technical_analysis"
    });
    expect(replacement.version).toBe(staleRead.snapshot.version);
    expect(replacement.revision).not.toBe(staleRead.snapshot.revision);

    expect(() => memory.commitAssisted(scope, {
      expectedVersion: staleRead.snapshot.version,
      expectedRevision: staleRead.snapshot.revision,
      route: "security_risk"
    })).toThrow(expectMemoryError("stale_assisted_read"));
    expect(memory.peek(scope)).toMatchObject({
      status: "hit",
      snapshot: {
        symbols: ["AAPL"],
        lastRoute: "technical_analysis",
        version: 1,
        revision: replacement.revision
      }
    });
  });

  it("does not slide the absolute expiry when an assisted turn is committed", () => {
    let now = START;
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => now });
    const memory = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) }),
      now: () => now,
      ttlMs: 1_000
    });
    const scope = issueScope(authority);
    const anchor = memory.write(scope, { symbols: ["NVDA"], route: "market_quote" });

    now += 900;
    const read = memory.read(scope, "security_risk");
    if (read.status !== "hit") throw new Error("Expected memory hit.");
    const committed = memory.commitAssisted(scope, {
      expectedVersion: read.snapshot.version,
      expectedRevision: read.snapshot.revision,
      route: "security_risk"
    });
    expect(committed.updatedAt).toBe(now);
    expect(committed.expiresAt).toBe(anchor.expiresAt);

    now += 101;
    expect(memory.read(scope, "security_risk")).toEqual({
      status: "expired",
      snapshot: null
    });
  });

  it("conditionally clears only the exact version it verified", () => {
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => START });
    const storage = new InspectableStorage();
    const memory = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) }),
      storage,
      now: () => START
    });
    const scope = issueScope(authority);
    memory.write(scope, { symbols: ["NVDA"], route: "market_quote" });

    storage.beforeNextCompareAndDelete = () => {
      memory.write(scope, { symbols: ["AAPL"], route: "technical_analysis" });
    };
    expect(() => memory.clear(scope)).toThrow(expectMemoryError("concurrent_update"));
    expect(memory.peek(scope)).toMatchObject({
      status: "hit",
      snapshot: { symbols: ["AAPL"], lastRoute: "technical_analysis", version: 2 }
    });
  });

  it("rejects ineligible routes and more than two or malformed symbols", () => {
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => START });
    const memory = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) }),
      now: () => START
    });
    const scope = issueScope(authority);

    expect(() => memory.write(scope, {
      symbols: ["NVDA"],
      route: "order_ticket_preview"
    })).toThrow(expectMemoryError("ineligible_route"));
    expect(() => memory.read(scope, "fees_tariff")).toThrow(
      expectMemoryError("ineligible_route")
    );
    expect(() => memory.write(scope, {
      symbols: ["NVDA", "AAPL", "INTC"],
      route: "company_research"
    })).toThrow(expectMemoryError("invalid_symbols"));
    expect(() => memory.write(scope, {
      symbols: ["not a ticker"],
      route: "market_quote"
    })).toThrow(expectMemoryError("invalid_symbols"));
  });

  it("fails closed for invalid trusted scope, signed tampering, and cross-binding replay", () => {
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => START });
    const signer = new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) });
    const storage = new InspectableStorage();
    const memory = new BoundedV3ConversationMemory({ signer, storage, now: () => START });
    const first = issueScope(authority, { principalId: "principal:first" });
    const second = issueScope(authority, { principalId: "principal:second" });
    memory.write(first, { symbols: ["NVDA"], route: "market_quote" });

    const firstKey = memory.bindingHash(first);
    const firstRaw = storage.records.get(firstKey);
    expect(typeof firstRaw).toBe("string");
    storage.records.set(firstKey, `${(firstRaw as string).slice(0, -2)}aa`);
    expect(() => memory.read(first, "security_risk")).toThrow(
      expectMemoryError("integrity_failure")
    );
    expect(storage.records.has(firstKey)).toBe(false);

    storage.records.set(firstKey, firstRaw);
    const secondKey = memory.bindingHash(second);
    storage.records.set(secondKey, firstRaw);
    expect(() => memory.read(second, "security_risk")).toThrow(
      expectMemoryError("binding_mismatch")
    );
    expect(storage.records.has(secondKey)).toBe(false);

    storage.records.set(firstKey, `${(firstRaw as string).slice(0, -2)}aa`);
    expect(() => memory.clear(first)).toThrow(expectMemoryError("integrity_failure"));
    expect(storage.records.has(firstKey)).toBe(false);

    const invalidScope: V3ConversationMemoryScope = {
      ...first,
      context: { ...first.context, principalRef: "principal:attacker" }
    };
    expect(() => memory.bindingHash(invalidScope)).toThrow(expectMemoryError("invalid_scope"));
  });

  it("enforces capacity, supports verified clear, and purges exhausted records", () => {
    let now = START;
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => now });
    const signer = new DevHmacSigner({ keyId: "memory-test", secret: "m".repeat(40) });
    const storage = new InspectableStorage();
    const memory = new BoundedV3ConversationMemory({
      signer,
      storage,
      now: () => now,
      maxEntries: 1
    });
    const first = issueScope(authority, { principalId: "principal:first" });
    const second = issueScope(authority, { principalId: "principal:second" });
    memory.write(first, { symbols: ["NVDA"], route: "market_quote" });
    now += 1;
    expect(() => memory.write(second, {
      symbols: ["AAPL"],
      route: "market_quote"
    })).not.toThrow();
    expect(memory.read(first, "market_quote")).toEqual({ status: "miss", snapshot: null });
    expect(memory.clear(first)).toBe(false);
    expect(memory.clear(second)).toBe(true);
    memory.write(second, { symbols: ["AAPL"], route: "market_quote" });
    let read = memory.read(second, "security_risk");
    for (let index = 0; index < 3; index += 1) {
      if (read.status !== "hit") throw new Error("Expected memory hit.");
      memory.commitAssisted(second, {
        expectedVersion: read.snapshot.version,
        expectedRevision: read.snapshot.revision,
        route: "security_risk"
      });
      if (index < 2) read = memory.read(second, "security_risk");
    }
    expect(memory.purgeExpired()).toBe(1);
    expect(storage.size()).toBe(0);
  });

  it("fails before storage when a supplied signer makes the hard record cap impossible", () => {
    const authority = new V3SessionAuthority({ secret: "s".repeat(40), now: () => START });
    const storage = new InspectableStorage();
    const memory = new BoundedV3ConversationMemory({
      signer: new DevHmacSigner({ keyId: "k".repeat(300), secret: "m".repeat(40) }),
      storage,
      now: () => START
    });
    expect(() => memory.write(issueScope(authority), {
      symbols: ["NVDA", "AAPL"],
      route: "etf_explanation_risk"
    })).toThrow(expectMemoryError("record_too_large"));
    expect(storage.size()).toBe(0);
  });
});
