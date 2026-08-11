import type { TrustedRequestContext } from "./contracts.js";
import {
  V3_CONVERSATION_CONTEXT_ROUTES,
  type V3Function
} from "./routing.js";
import {
  isV3SessionCurrent,
  type V3TrustedSession
} from "./sessions.js";
import {
  canonicalHash,
  type DevHmacSigner
} from "./signing.js";

export const V3_CONVERSATION_MEMORY_ELIGIBLE_ROUTES =
  V3_CONVERSATION_CONTEXT_ROUTES;

export type V3ConversationMemoryEligibleRoute =
  (typeof V3_CONVERSATION_MEMORY_ELIGIBLE_ROUTES)[number];

export const V3_CONVERSATION_MEMORY_DEFAULT_TTL_MS = 5 * 60_000;
export const V3_CONVERSATION_MEMORY_MAX_TTL_MS = 5 * 60_000;
export const V3_CONVERSATION_MEMORY_MAX_SYMBOLS = 2;
export const V3_CONVERSATION_MEMORY_MAX_ASSISTED_HOPS = 3;
export const V3_CONVERSATION_MEMORY_MAX_SERIALIZED_BYTES = 512;
export const V3_CONVERSATION_MEMORY_DEFAULT_MAX_ENTRIES = 10_000;
export const V3_CONVERSATION_MEMORY_HARD_MAX_ENTRIES = 10_000;

const STORED_SCHEMA_VERSION = 1;
const STORED_KEYS = Object.freeze(["b", "e", "h", "n", "r", "s", "u", "v"]);
const SYMBOL_PATTERN = /^[A-Z]{1,5}(?:\.[A-Z])?$/u;
const HASH_PATTERN = /^hmac-sha256:[A-Za-z0-9_-]{43}$/u;
const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface V3ConversationMemoryScope {
  readonly context: TrustedRequestContext;
  readonly session: V3TrustedSession;
}

export interface V3ConversationMemorySnapshot {
  readonly schemaVersion: "assistant-v3.conversation-memory.v1";
  /** Hash of the complete trusted scope; never a raw tenant or principal ID. */
  readonly bindingHash: string;
  readonly symbols: readonly string[];
  readonly lastRoute: V3ConversationMemoryEligibleRoute;
  readonly updatedAt: number;
  readonly expiresAt: number;
  readonly assistedHopsRemaining: number;
  /** Optimistic-concurrency version used when committing an assisted turn. */
  readonly version: number;
  /** Opaque identity of the exact signed record read; contains no raw context. */
  readonly revision: string;
}

export type V3ConversationMemoryReadResult =
  | { readonly status: "hit"; readonly snapshot: V3ConversationMemorySnapshot }
  | { readonly status: "miss" | "expired" | "exhausted"; readonly snapshot: null };

export type V3ConversationMemoryErrorCode =
  | "invalid_scope"
  | "ineligible_route"
  | "invalid_symbols"
  | "integrity_failure"
  | "binding_mismatch"
  | "capacity_exceeded"
  | "record_too_large"
  | "concurrent_update"
  | "stale_assisted_read";

export class V3ConversationMemoryError extends Error {
  constructor(
    public readonly code: V3ConversationMemoryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "V3ConversationMemoryError";
  }
}

/**
 * Minimal synchronous storage boundary. The default implementation is a
 * process-local private Map. A production adapter must perform the comparison
 * and mutation atomically across workers and install its native TTL in the same
 * transaction as `compareAndSet`; it must not expose this store to Studio.
 */
export interface V3ConversationMemoryStorage {
  get(bindingHash: string): unknown;
  compareAndSet(
    bindingHash: string,
    expectedRecord: unknown | undefined,
    signedRecord: string,
    expiresAt: number
  ): boolean;
  compareAndDelete(bindingHash: string, expectedRecord: unknown): boolean;
  entries(): IterableIterator<readonly [string, unknown]>;
  size(): number;
}

class ProcessLocalConversationMemoryStorage implements V3ConversationMemoryStorage {
  readonly #records = new Map<string, string>();

  get(bindingHash: string): unknown {
    return this.#records.get(bindingHash);
  }

  compareAndSet(
    bindingHash: string,
    expectedRecord: unknown | undefined,
    signedRecord: string,
    _expiresAt: number
  ): boolean {
    if (!Object.is(this.#records.get(bindingHash), expectedRecord)) return false;
    this.#records.set(bindingHash, signedRecord);
    return true;
  }

  compareAndDelete(bindingHash: string, expectedRecord: unknown): boolean {
    if (
      !this.#records.has(bindingHash) ||
      !Object.is(this.#records.get(bindingHash), expectedRecord)
    ) {
      return false;
    }
    return this.#records.delete(bindingHash);
  }

  entries(): IterableIterator<readonly [string, unknown]> {
    return this.#records.entries();
  }

  size(): number {
    return this.#records.size;
  }
}

interface StoredConversationMemory {
  /** Stored schema version. */
  readonly v: 1;
  /** Trusted-scope binding hash. */
  readonly b: string;
  /** Explicit user-supplied public symbols only. */
  readonly s: readonly string[];
  /** Last eligible deterministic route. */
  readonly r: V3ConversationMemoryEligibleRoute;
  /** Updated and expiry epoch milliseconds. */
  readonly u: number;
  readonly e: number;
  /** Remaining assisted hops and optimistic-concurrency version. */
  readonly h: number;
  readonly n: number;
}

interface ScheduledExpiry {
  readonly signedRecord: string;
  readonly expiresAt: number;
  readonly retryCount: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface BoundedV3ConversationMemoryOptions {
  readonly signer: DevHmacSigner;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly maxAssistedHops?: number;
  readonly maxEntries?: number;
  /** Primarily a future adapter seam; omitted in the process-local pilot. */
  readonly storage?: V3ConversationMemoryStorage;
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === STORED_KEYS.length &&
    keys.every((key, index) => key === STORED_KEYS[index]);
}

function isEligibleRoute(value: unknown): value is V3ConversationMemoryEligibleRoute {
  return typeof value === "string" &&
    (V3_CONVERSATION_MEMORY_ELIGIBLE_ROUTES as readonly string[]).includes(value);
}

function normalizeSymbols(symbols: readonly string[]): readonly string[] {
  if (!Array.isArray(symbols)) {
    throw new V3ConversationMemoryError("invalid_symbols", "Conversation symbols are invalid.");
  }
  const normalized = [...new Set(symbols.map((symbol) =>
    typeof symbol === "string" ? symbol.normalize("NFKC").trim().toUpperCase() : ""
  ))];
  if (
    normalized.length === 0 ||
    normalized.length > V3_CONVERSATION_MEMORY_MAX_SYMBOLS ||
    normalized.some((symbol) => !SYMBOL_PATTERN.test(symbol))
  ) {
    throw new V3ConversationMemoryError(
      "invalid_symbols",
      "Conversation memory accepts one or two canonical public symbols."
    );
  }
  return Object.freeze(normalized);
}

function recordRevision(signedRecord: string): string {
  return canonicalHash(signedRecord);
}

function frozenSnapshot(
  payload: StoredConversationMemory,
  signedRecord: string
): V3ConversationMemorySnapshot {
  return Object.freeze({
    schemaVersion: "assistant-v3.conversation-memory.v1" as const,
    bindingHash: payload.b,
    symbols: Object.freeze([...payload.s]),
    lastRoute: payload.r,
    updatedAt: payload.u,
    expiresAt: payload.e,
    assistedHopsRemaining: payload.h,
    version: payload.n,
    revision: recordRevision(signedRecord)
  });
}

/**
 * Bounded deterministic conversation subject context.
 *
 * This is intentionally not model, transcript, semantic-recall, or working
 * memory. It stores only an integrity-protected subject pointer and route. A
 * runtime should call `write` only after a successful audited turn containing
 * explicit user symbols, and `commitAssisted` only after a successful audited
 * follow-up. Merely calling `read` never changes retention or hop state.
 */
export class BoundedV3ConversationMemory {
  readonly #signer: DevHmacSigner;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxAssistedHops: number;
  readonly #maxEntries: number;
  readonly #storage: V3ConversationMemoryStorage;
  readonly #scheduledExpiries = new Map<string, ScheduledExpiry>();

  constructor(options: BoundedV3ConversationMemoryOptions) {
    this.#signer = options.signer;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? V3_CONVERSATION_MEMORY_DEFAULT_TTL_MS;
    this.#maxAssistedHops = options.maxAssistedHops ??
      V3_CONVERSATION_MEMORY_MAX_ASSISTED_HOPS;
    this.#maxEntries = options.maxEntries ?? V3_CONVERSATION_MEMORY_DEFAULT_MAX_ENTRIES;
    this.#storage = options.storage ?? new ProcessLocalConversationMemoryStorage();
    if (
      !Number.isSafeInteger(this.#ttlMs) ||
      this.#ttlMs <= 0 ||
      this.#ttlMs > V3_CONVERSATION_MEMORY_MAX_TTL_MS
    ) {
      throw new RangeError("Conversation-memory TTL must be between 1 ms and five minutes.");
    }
    if (
      !Number.isSafeInteger(this.#maxAssistedHops) ||
      this.#maxAssistedHops <= 0 ||
      this.#maxAssistedHops > V3_CONVERSATION_MEMORY_MAX_ASSISTED_HOPS
    ) {
      throw new RangeError(
        `Conversation-memory assisted hops must be between 1 and ${V3_CONVERSATION_MEMORY_MAX_ASSISTED_HOPS}.`
      );
    }
    if (
      !Number.isSafeInteger(this.#maxEntries) ||
      this.#maxEntries <= 0 ||
      this.#maxEntries > V3_CONVERSATION_MEMORY_HARD_MAX_ENTRIES
    ) {
      throw new RangeError(
        `Conversation-memory entries must be between 1 and ${V3_CONVERSATION_MEMORY_HARD_MAX_ENTRIES}.`
      );
    }
  }

  bindingHash(scope: V3ConversationMemoryScope): string {
    this.#assertScope(scope);
    const binding = {
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
    // A keyed alias prevents offline dictionary recovery of low-entropy
    // internal principal/session references if the context store is exposed.
    return `hmac-sha256:${this.#signer.sign(binding).signature}`;
  }

  read(
    scope: V3ConversationMemoryScope,
    route?: V3Function
  ): V3ConversationMemoryReadResult {
    if (route !== undefined) this.#assertEligibleRoute(route);
    const bindingHash = this.bindingHash(scope);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const raw = this.#storage.get(bindingHash);
      if (raw === undefined) return Object.freeze({ status: "miss", snapshot: null });
      const payload = this.#loadBound(bindingHash, raw);
      const now = this.#now();
      if (payload.e <= now || payload.e > scope.session.claims.expiresAt) {
        if (this.#deleteExact(bindingHash, raw)) {
          return Object.freeze({ status: "expired", snapshot: null });
        }
        continue;
      }
      if (payload.h <= 0) {
        if (this.#deleteExact(bindingHash, raw)) {
          return Object.freeze({ status: "exhausted", snapshot: null });
        }
        continue;
      }
      return Object.freeze({ status: "hit", snapshot: frozenSnapshot(payload, raw as string) });
    }
    throw new V3ConversationMemoryError(
      "concurrent_update",
      "Conversation memory changed repeatedly while it was being read."
    );
  }

  /**
   * Reads the prior eligible subject before a stateless route is known. The
   * runtime may use this only after its deterministic follow-up detector has
   * accepted the current turn; arbitrary clarify turns must not call it.
   */
  peek(scope: V3ConversationMemoryScope): V3ConversationMemoryReadResult {
    return this.read(scope);
  }

  /**
   * Establishes or replaces the subject from explicit symbols in the current
   * user turn. It resets the assisted-hop budget.
   */
  write(
    scope: V3ConversationMemoryScope,
    input: { readonly symbols: readonly string[]; readonly route: V3Function }
  ): V3ConversationMemorySnapshot {
    this.#assertEligibleRoute(input.route);
    const symbols = normalizeSymbols(input.symbols);
    const bindingHash = this.bindingHash(scope);
    const now = this.#now();
    const raw = this.#storage.get(bindingHash);
    let version = 1;
    let expectedRecord = raw;
    if (raw !== undefined) {
      const existing = this.#loadBound(bindingHash, raw);
      if (existing.e > now) version = existing.n + 1;
      else {
        if (!this.#deleteExact(bindingHash, raw)) {
          throw new V3ConversationMemoryError(
            "concurrent_update",
            "Conversation memory changed before the explicit subject was stored."
          );
        }
        expectedRecord = undefined;
      }
    }
    if (expectedRecord === undefined) {
      this.#ensureCapacity(now);
    }
    const payload = this.#payload({
      bindingHash,
      symbols,
      route: input.route,
      now,
      expiresAt: Math.min(now + this.#ttlMs, scope.session.claims.expiresAt),
      assistedHopsRemaining: this.#maxAssistedHops,
      version
    });
    const signedRecord = this.#storeExact(payload, expectedRecord, "concurrent_update");
    return frozenSnapshot(payload, signedRecord);
  }

  /**
   * Commits one successful memory-assisted follow-up using optimistic
   * concurrency. This should be invoked only after response gates and audit.
   */
  commitAssisted(
    scope: V3ConversationMemoryScope,
    input: {
      readonly expectedVersion: number;
      readonly expectedRevision: string;
      readonly route: V3Function;
    }
  ): V3ConversationMemorySnapshot {
    this.#assertEligibleRoute(input.route);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion <= 0 ||
      !REVISION_PATTERN.test(input.expectedRevision)
    ) {
      throw new V3ConversationMemoryError(
        "stale_assisted_read",
        "The assisted-memory version is invalid."
      );
    }
    const bindingHash = this.bindingHash(scope);
    const raw = this.#storage.get(bindingHash);
    if (raw === undefined) {
      throw new V3ConversationMemoryError(
        "stale_assisted_read",
        "Conversation memory changed before the assisted turn was committed."
      );
    }
    const existing = this.#loadBound(bindingHash, raw);
    const now = this.#now();
    if (
      existing.e <= now ||
      existing.e > scope.session.claims.expiresAt ||
      existing.h <= 0 ||
      existing.n !== input.expectedVersion ||
      recordRevision(raw as string) !== input.expectedRevision
    ) {
      if (existing.e <= now || existing.h <= 0) this.#deleteExact(bindingHash, raw);
      throw new V3ConversationMemoryError(
        "stale_assisted_read",
        "Conversation memory changed or expired before the assisted turn was committed."
      );
    }
    const payload = this.#payload({
      bindingHash,
      symbols: existing.s,
      route: input.route,
      now,
      // Assisted follow-ups consume the original anchor budget; only a new
      // explicit-symbol anchor may reset the absolute retention deadline.
      expiresAt: existing.e,
      assistedHopsRemaining: existing.h - 1,
      version: existing.n + 1
    });
    const signedRecord = this.#storeExact(payload, raw, "stale_assisted_read");
    return frozenSnapshot(payload, signedRecord);
  }

  clear(scope: V3ConversationMemoryScope): boolean {
    const bindingHash = this.bindingHash(scope);
    const raw = this.#storage.get(bindingHash);
    if (raw === undefined) return false;
    this.#loadBound(bindingHash, raw);
    if (this.#deleteExact(bindingHash, raw)) return true;
    throw new V3ConversationMemoryError(
      "concurrent_update",
      "Conversation memory changed before it could be cleared."
    );
  }

  purgeExpired(): number {
    const now = this.#now();
    let removed = 0;
    for (const [bindingHash, raw] of this.#storage.entries()) {
      const payload = this.#loadBound(bindingHash, raw);
      if (payload.e <= now || payload.h <= 0) {
        if (this.#deleteExact(bindingHash, raw)) removed += 1;
      }
    }
    return removed;
  }

  #assertScope(scope: V3ConversationMemoryScope): void {
    const now = this.#now();
    const { context, session } = scope;
    if (
      !isV3SessionCurrent(session, now) ||
      context.schemaVersion !== "assistant-v3.request-context.v1" ||
      !nonEmpty(context.tenantRef) ||
      !nonEmpty(context.principalRef) ||
      !nonEmpty(context.sessionId) ||
      !nonEmpty(context.conversationId) ||
      !nonEmpty(context.authentication.authContextRef) ||
      !nonEmpty(context.consentVersion) ||
      !nonEmpty(context.entitlementVersion) ||
      !nonEmpty(context.policyVersion) ||
      context.sessionId !== session.claims.sessionId ||
      context.tenantRef !== session.claims.tenantId ||
      context.principalRef !== session.claims.principalId ||
      context.authentication.strength !== session.claims.authLevel ||
      context.authentication.authContextRef !== session.claims.authContextId ||
      context.consentVersion !== session.claims.consentVersion ||
      context.entitlementVersion !== session.claims.entitlementVersion ||
      !sameStrings(context.consentScopes, session.claims.consents) ||
      !sameStrings(context.entitlements, session.claims.entitlements) ||
      !context.consentScopes.includes("assistant_use") ||
      !context.entitlements.includes("assistant_access")
    ) {
      throw new V3ConversationMemoryError(
        "invalid_scope",
        "Conversation memory requires a current, exactly bound trusted scope."
      );
    }
  }

  #assertEligibleRoute(route: V3Function): asserts route is V3ConversationMemoryEligibleRoute {
    if (!isEligibleRoute(route)) {
      throw new V3ConversationMemoryError(
        "ineligible_route",
        "This route cannot read or retain conversation memory."
      );
    }
  }

  #assertBinding(payload: StoredConversationMemory, expected: string): void {
    if (payload.b !== expected) {
      throw new V3ConversationMemoryError(
        "binding_mismatch",
        "Conversation memory belongs to a different trusted scope."
      );
    }
  }

  #loadBound(bindingHash: string, raw: unknown): StoredConversationMemory {
    try {
      const payload = this.#decode(raw);
      this.#assertBinding(payload, bindingHash);
      return payload;
    } catch (error) {
      if (
        error instanceof V3ConversationMemoryError &&
        (error.code === "integrity_failure" || error.code === "binding_mismatch")
      ) {
        // A corrupt or replayed value is never left in place to repeatedly
        // fail the same trusted session. The request still fails closed.
        this.#deleteExact(bindingHash, raw);
      }
      throw error;
    }
  }

  #decode(raw: unknown): StoredConversationMemory {
    if (
      typeof raw !== "string" ||
      Buffer.byteLength(raw, "utf8") > V3_CONVERSATION_MEMORY_MAX_SERIALIZED_BYTES ||
      !this.#signer.verifyCompactJws(raw)
    ) {
      throw new V3ConversationMemoryError(
        "integrity_failure",
        "Conversation-memory integrity verification failed."
      );
    }
    const encodedPayload = raw.split(".")[1];
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8"));
    } catch {
      throw new V3ConversationMemoryError(
        "integrity_failure",
        "Conversation-memory payload is malformed."
      );
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new V3ConversationMemoryError("integrity_failure", "Conversation memory is invalid.");
    }
    const record = value as Readonly<Record<string, unknown>>;
    if (
      !exactKeys(record) ||
      record.v !== STORED_SCHEMA_VERSION ||
      typeof record.b !== "string" ||
      !HASH_PATTERN.test(record.b) ||
      !Array.isArray(record.s) ||
      record.s.length === 0 ||
      record.s.length > V3_CONVERSATION_MEMORY_MAX_SYMBOLS ||
      record.s.some((symbol) => typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol)) ||
      new Set(record.s).size !== record.s.length ||
      !isEligibleRoute(record.r) ||
      !Number.isSafeInteger(record.u) ||
      !Number.isSafeInteger(record.e) ||
      (record.u as number) < 0 ||
      (record.e as number) <= (record.u as number) ||
      !Number.isSafeInteger(record.h) ||
      (record.h as number) < 0 ||
      (record.h as number) > this.#maxAssistedHops ||
      !Number.isSafeInteger(record.n) ||
      (record.n as number) <= 0
    ) {
      throw new V3ConversationMemoryError(
        "integrity_failure",
        "Conversation-memory payload failed its bounded schema."
      );
    }
    return record as unknown as StoredConversationMemory;
  }

  #payload(input: {
    bindingHash: string;
    symbols: readonly string[];
    route: V3ConversationMemoryEligibleRoute;
    now: number;
    expiresAt: number;
    assistedHopsRemaining: number;
    version: number;
  }): StoredConversationMemory {
    if (
      !Number.isSafeInteger(input.now) ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= input.now ||
      !Number.isSafeInteger(input.version) ||
      input.version <= 0 ||
      !Number.isSafeInteger(input.assistedHopsRemaining) ||
      input.assistedHopsRemaining < 0 ||
      input.assistedHopsRemaining > this.#maxAssistedHops
    ) {
      throw new V3ConversationMemoryError(
        "invalid_scope",
        "Conversation-memory timestamps or version are invalid."
      );
    }
    return Object.freeze({
      v: STORED_SCHEMA_VERSION,
      b: input.bindingHash,
      s: Object.freeze([...input.symbols]),
      r: input.route,
      u: input.now,
      e: input.expiresAt,
      h: input.assistedHopsRemaining,
      n: input.version
    });
  }

  #storeExact(
    payload: StoredConversationMemory,
    expectedRecord: unknown | undefined,
    conflictCode: "concurrent_update" | "stale_assisted_read"
  ): string {
    const encoded = this.#signer.toCompactJws(payload);
    if (Buffer.byteLength(encoded, "utf8") > V3_CONVERSATION_MEMORY_MAX_SERIALIZED_BYTES) {
      throw new V3ConversationMemoryError(
        "record_too_large",
        "The signed conversation-memory record exceeds its hard byte limit."
      );
    }
    if (!this.#storage.compareAndSet(payload.b, expectedRecord, encoded, payload.e)) {
      throw new V3ConversationMemoryError(
        conflictCode,
        "Conversation memory changed before the atomic update completed."
      );
    }
    this.#scheduleExpiry(payload.b, encoded, payload.e);
    return encoded;
  }

  #ensureCapacity(now: number): void {
    if (this.#storage.size() < this.#maxEntries) return;
    let oldest: { bindingHash: string; updatedAt: number; raw: unknown } | null = null;
    for (const [bindingHash, raw] of this.#storage.entries()) {
      const payload = this.#loadBound(bindingHash, raw);
      if (payload.e <= now || payload.h <= 0) {
        this.#deleteExact(bindingHash, raw);
        continue;
      }
      if (
        oldest === null ||
        payload.u < oldest.updatedAt ||
        (payload.u === oldest.updatedAt && bindingHash < oldest.bindingHash)
      ) {
        oldest = { bindingHash, updatedAt: payload.u, raw };
      }
    }
    if (this.#storage.size() >= this.#maxEntries && oldest !== null) {
      this.#deleteExact(oldest.bindingHash, oldest.raw);
    }
    if (this.#storage.size() >= this.#maxEntries) {
      throw new V3ConversationMemoryError(
        "capacity_exceeded",
        "Conversation-memory capacity is exhausted."
      );
    }
  }

  #deleteExact(bindingHash: string, expectedRecord: unknown): boolean {
    const removed = this.#storage.compareAndDelete(bindingHash, expectedRecord);
    if (removed) this.#cancelScheduledExpiry(bindingHash, expectedRecord);
    return removed;
  }

  #scheduleExpiry(
    bindingHash: string,
    signedRecord: string,
    expiresAt: number,
    retryCount = 0,
    retryDelayMs?: number
  ): void {
    this.#cancelScheduledExpiry(bindingHash);
    const delay = retryDelayMs ?? Math.max(0, expiresAt - this.#now());
    const timer = setTimeout(() => {
      const scheduled = this.#scheduledExpiries.get(bindingHash);
      if (scheduled?.signedRecord !== signedRecord) return;
      try {
        this.#storage.compareAndDelete(bindingHash, signedRecord);
        this.#scheduledExpiries.delete(bindingHash);
      } catch {
        const nextRetry = retryCount + 1;
        const backoffMs = Math.min(30_000, 1_000 * (2 ** Math.min(nextRetry - 1, 5)));
        this.#scheduleExpiry(
          bindingHash,
          signedRecord,
          expiresAt,
          nextRetry,
          backoffMs
        );
      }
    }, delay);
    timer.unref();
    this.#scheduledExpiries.set(bindingHash, {
      signedRecord,
      expiresAt,
      retryCount,
      timer
    });
  }

  #cancelScheduledExpiry(bindingHash: string, expectedRecord?: unknown): void {
    const scheduled = this.#scheduledExpiries.get(bindingHash);
    if (
      scheduled === undefined ||
      (expectedRecord !== undefined && scheduled.signedRecord !== expectedRecord)
    ) {
      return;
    }
    clearTimeout(scheduled.timer);
    this.#scheduledExpiries.delete(bindingHash);
  }
}
