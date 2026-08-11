import { randomBytes } from "node:crypto";
import type { TrustedRequestContext } from "./contracts.js";
import type { V3TrustedSession } from "./sessions.js";

const MAX_AUTHORITY_CAPACITY = 100_000;
const DEFAULT_TRUSTED_CONTEXT_CAPACITY = 4_096;
const DEFAULT_ORDER_CONFIRMATION_CAPACITY = 1_024;

function authorityCapacity(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_AUTHORITY_CAPACITY
  ) {
    throw new RangeError(
      `${label} must be an integer between 1 and ${String(MAX_AUTHORITY_CAPACITY)}.`
    );
  }
  return resolved;
}

interface TrustedRequestRecord {
  context: TrustedRequestContext;
  session: V3TrustedSession;
  expiresAt: number;
}

/** One-use bridge from the authenticated HTTP edge into the entry workflow. */
export class TrustedRequestContextAuthority {
  readonly #records = new Map<string, TrustedRequestRecord>();
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #capacity: number;

  constructor(input: {
    now?: () => number;
    ttlMs?: number;
    capacity?: number;
  } = {}) {
    this.#now = input.now ?? Date.now;
    this.#ttlMs = input.ttlMs ?? 30_000;
    this.#capacity = authorityCapacity(
      input.capacity,
      DEFAULT_TRUSTED_CONTEXT_CAPACITY,
      "Trusted request-context capacity"
    );
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs <= 0 || this.#ttlMs > 60_000) {
      throw new RangeError("Trusted request-context TTL must be between one and sixty seconds.");
    }
  }

  issue(context: TrustedRequestContext, session: V3TrustedSession): string {
    const now = this.#now();
    this.#purge(now);
    if (context.sessionId !== session.claims.sessionId) {
      throw new Error("Trusted context and session disagree.");
    }
    if (this.#records.size >= this.#capacity) {
      throw new Error("Trusted request-context capacity is exhausted.");
    }
    const expiresAt = Math.min(now + this.#ttlMs, session.claims.expiresAt);
    if (expiresAt <= now) {
      throw new Error("Trusted request context would already be expired.");
    }
    const token = `v3c_${randomBytes(32).toString("base64url")}`;
    this.#records.set(token, {
      context,
      session,
      expiresAt
    });
    return token;
  }

  consume(token: string): { context: TrustedRequestContext; session: V3TrustedSession } {
    const now = this.#now();
    this.#purge(now);
    const record = this.#records.get(token);
    this.#records.delete(token);
    if (!record || record.expiresAt <= now) {
      throw new Error("Trusted request context is missing, expired, or already consumed.");
    }
    return { context: record.context, session: record.session };
  }

  get pendingCount(): number {
    this.#purge(this.#now());
    return this.#records.size;
  }

  #purge(now: number): void {
    for (const [token, record] of this.#records) {
      if (record.expiresAt <= now) this.#records.delete(token);
    }
  }
}

interface ConfirmationRecord {
  intentId: string;
  sessionId: string;
  principalRef: string;
  expiresAt: number;
}

/** Binds the HTTP confirmation click to the suspended workflow principal. */
export class OrderConfirmationAuthority {
  readonly #records = new Map<string, ConfirmationRecord>();
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #capacity: number;

  constructor(input: {
    now?: () => number;
    ttlMs?: number;
    capacity?: number;
  } = {}) {
    this.#now = input.now ?? Date.now;
    this.#ttlMs = input.ttlMs ?? 30_000;
    this.#capacity = authorityCapacity(
      input.capacity,
      DEFAULT_ORDER_CONFIRMATION_CAPACITY,
      "Order confirmation capacity"
    );
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs <= 0 || this.#ttlMs > 60_000) {
      throw new RangeError("Order confirmation TTL must be between one and sixty seconds.");
    }
  }

  issue(input: { intentId: string; sessionId: string; principalRef: string }): string {
    const now = this.#now();
    this.#purge(now);
    if (this.#records.size >= this.#capacity) {
      throw new Error("Order confirmation capacity is exhausted.");
    }
    const token = `v3confirm_${randomBytes(32).toString("base64url")}`;
    this.#records.set(token, {
      ...input,
      expiresAt: now + this.#ttlMs
    });
    return token;
  }

  consume(token: string, expected: {
    intentId: string;
    sessionId: string;
    principalRef: string;
  }): void {
    const now = this.#now();
    this.#purge(now);
    const record = this.#records.get(token);
    this.#records.delete(token);
    if (!record || record.expiresAt <= now) {
      throw new Error("Order confirmation is missing, expired, or already consumed.");
    }
    if (
      record.intentId !== expected.intentId ||
      record.sessionId !== expected.sessionId ||
      record.principalRef !== expected.principalRef
    ) {
      throw new Error("Order confirmation binding does not match the suspended workflow.");
    }
  }

  get pendingCount(): number {
    this.#purge(this.#now());
    return this.#records.size;
  }

  #purge(now: number): void {
    for (const [token, record] of this.#records) {
      if (record.expiresAt <= now) this.#records.delete(token);
    }
  }
}
