import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { canonicalizeV3 } from "./grants.js";

export interface V3AuditEventInput {
  readonly eventId?: string;
  readonly eventType: string;
  readonly requestId: string;
  readonly workflowRunId: string | null;
  readonly tenantId: string;
  /** A one-way principal fingerprint, never the raw customer identifier. */
  readonly principalFingerprint: string;
  readonly payload: unknown;
}

export interface V3AuditEvent {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly requestId: string;
  readonly workflowRunId: string | null;
  readonly tenantId: string;
  readonly principalFingerprint: string;
  readonly payload: unknown;
  readonly occurredAt: number;
  readonly previousHash: string;
  readonly eventHash: string;
}

export type V3AuditVerification =
  | {
      readonly valid: true;
      readonly eventCount: number;
      readonly headHash: string;
    }
  | {
      readonly valid: false;
      readonly eventCount: number;
      readonly headHash: string;
      readonly errorAt: number;
      readonly reason: string;
    };

export interface V3AuditReadiness {
  readonly ready: boolean;
  readonly chainValid: boolean;
  readonly durablePathConfigured: boolean;
  readonly durablePathAccessible: boolean;
  readonly eventCount: number;
}

export interface V3AuditOutboxOptions {
  readonly now?: () => number;
  /** Optional internal-pilot JSONL sink. Each append is flushed before return. */
  readonly filePath?: string;
}

export class V3AuditError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "V3AuditError";
    this.code = code;
  }
}

export const V3_AUDIT_GENESIS_HASH = "0".repeat(64);

function requiredString(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new V3AuditError("invalid_audit_event", `${field} must be a non-empty string.`);
  }
  return value;
}

function immutableCanonicalCopy(value: unknown): unknown {
  const copy = JSON.parse(canonicalizeV3(value)) as unknown;
  return deepFreeze(copy);
}

function deepFreeze(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

type HashableAuditEvent = Omit<V3AuditEvent, "eventHash">;

export function computeV3AuditEventHash(event: HashableAuditEvent): string {
  return createHash("sha256")
    .update(
      canonicalizeV3({
        schemaVersion: event.schemaVersion,
        sequence: event.sequence,
        eventId: event.eventId,
        eventType: event.eventType,
        requestId: event.requestId,
        workflowRunId: event.workflowRunId,
        tenantId: event.tenantId,
        principalFingerprint: event.principalFingerprint,
        payload: event.payload,
        occurredAt: event.occurredAt,
        previousHash: event.previousHash,
      }),
    )
    .digest("hex");
}

export function verifyV3AuditChain(events: readonly V3AuditEvent[]): V3AuditVerification {
  let previousHash = V3_AUDIT_GENESIS_HASH;
  const ids = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) {
      return {
        valid: false,
        eventCount: events.length,
        headHash: previousHash,
        errorAt: index,
        reason: "missing_event",
      };
    }
    if (event.sequence !== index + 1) {
      return {
        valid: false,
        eventCount: events.length,
        headHash: previousHash,
        errorAt: index,
        reason: "sequence_mismatch",
      };
    }
    if (ids.has(event.eventId)) {
      return {
        valid: false,
        eventCount: events.length,
        headHash: previousHash,
        errorAt: index,
        reason: "duplicate_event_id",
      };
    }
    if (event.previousHash !== previousHash) {
      return {
        valid: false,
        eventCount: events.length,
        headHash: previousHash,
        errorAt: index,
        reason: "previous_hash_mismatch",
      };
    }
    const { eventHash: _eventHash, ...hashable } = event;
    const expectedHash = computeV3AuditEventHash(hashable);
    if (event.eventHash !== expectedHash) {
      return {
        valid: false,
        eventCount: events.length,
        headHash: previousHash,
        errorAt: index,
        reason: "event_hash_mismatch",
      };
    }
    ids.add(event.eventId);
    previousHash = event.eventHash;
  }
  return {
    valid: true,
    eventCount: events.length,
    headHash: previousHash,
  };
}

/**
 * In-process append-only outbox. Persistence adapters can store each immutable
 * event as an insert-only row while preserving the sequence and hash chain.
 */
export class V3AuditOutbox {
  readonly #events: V3AuditEvent[] = [];
  readonly #eventIds = new Set<string>();
  readonly #now: () => number;
  readonly #filePath: string | null;

  constructor(options: V3AuditOutboxOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#filePath = options.filePath ? path.resolve(options.filePath) : null;
    if (this.#filePath !== null) this.#loadDurableChain(this.#filePath);
  }

  #loadDurableChain(filePath: string): void {
    let contents = "";
    try {
      contents = readFileSync(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new V3AuditError("audit_storage_unavailable", "The audit outbox could not be read.");
    }
    const events: V3AuditEvent[] = [];
    try {
      for (const line of contents.split("\n")) {
        if (!line.trim()) continue;
        const candidate = JSON.parse(line) as V3AuditEvent;
        if (
          candidate.schemaVersion !== 1 ||
          !Number.isSafeInteger(candidate.sequence) ||
          typeof candidate.eventId !== "string" ||
          typeof candidate.eventType !== "string" ||
          typeof candidate.requestId !== "string" ||
          (candidate.workflowRunId !== null && typeof candidate.workflowRunId !== "string") ||
          typeof candidate.tenantId !== "string" ||
          typeof candidate.principalFingerprint !== "string" ||
          !Number.isSafeInteger(candidate.occurredAt) ||
          typeof candidate.previousHash !== "string" ||
          typeof candidate.eventHash !== "string"
        ) throw new Error("invalid_event_shape");
        events.push(deepFreeze(candidate) as V3AuditEvent);
      }
    } catch {
      throw new V3AuditError("audit_chain_invalid", "The durable audit outbox is malformed.");
    }
    const verification = verifyV3AuditChain(events);
    if (!verification.valid) {
      throw new V3AuditError("audit_chain_invalid", `The durable audit chain failed at ${verification.errorAt}.`);
    }
    for (const event of events) {
      this.#events.push(event);
      this.#eventIds.add(event.eventId);
    }
  }

  #persist(event: V3AuditEvent): void {
    if (this.#filePath === null) return;
    mkdirSync(path.dirname(this.#filePath), { recursive: true, mode: 0o700 });
    let descriptor: number | null = null;
    try {
      descriptor = openSync(
        this.#filePath,
        fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY,
        0o600,
      );
      writeFileSync(descriptor, `${canonicalizeV3(event)}\n`, "utf8");
      fsyncSync(descriptor);
    } catch {
      throw new V3AuditError(
        "audit_storage_unavailable",
        "The audit event could not be durably committed.",
      );
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  }

  append(input: V3AuditEventInput): V3AuditEvent {
    const eventId = requiredString(input.eventId ?? randomUUID(), "eventId");
    if (this.#eventIds.has(eventId)) {
      throw new V3AuditError("duplicate_audit_event", `Audit event ${eventId} already exists.`);
    }
    const previous = this.#events.at(-1);
    const hashable: HashableAuditEvent = {
      schemaVersion: 1,
      sequence: this.#events.length + 1,
      eventId,
      eventType: requiredString(input.eventType, "eventType"),
      requestId: requiredString(input.requestId, "requestId"),
      workflowRunId:
        input.workflowRunId === null
          ? null
          : requiredString(input.workflowRunId, "workflowRunId"),
      tenantId: requiredString(input.tenantId, "tenantId"),
      principalFingerprint: requiredString(
        input.principalFingerprint,
        "principalFingerprint",
      ),
      payload: immutableCanonicalCopy(input.payload),
      occurredAt: this.#now(),
      previousHash: previous?.eventHash ?? V3_AUDIT_GENESIS_HASH,
    };
    const event: V3AuditEvent = Object.freeze({
      ...hashable,
      eventHash: computeV3AuditEventHash(hashable),
    });
    // Persistence precedes mutation and response delivery. A failed flush is a
    // fail-closed financial-response failure, not a best-effort log warning.
    this.#persist(event);
    this.#events.push(event);
    this.#eventIds.add(eventId);
    return event;
  }

  snapshot(): readonly V3AuditEvent[] {
    return Object.freeze([...this.#events]);
  }

  verify(): V3AuditVerification {
    return verifyV3AuditChain(this.#events);
  }

  /**
   * Read-only audit preflight for process readiness.
   *
   * It validates the current hash chain and checks that the configured sink (or
   * the nearest existing parent for a not-yet-created sink) is accessible. It
   * deliberately does not append a probe event, so load-balancer polling cannot
   * grow the financial audit trail.
   */
  readiness(): V3AuditReadiness {
    const verification = this.verify();
    if (!verification.valid) {
      return {
        ready: false,
        chainValid: false,
        durablePathConfigured: this.#filePath !== null,
        durablePathAccessible: false,
        eventCount: verification.eventCount
      };
    }
    if (this.#filePath === null) {
      return {
        ready: true,
        chainValid: true,
        durablePathConfigured: false,
        durablePathAccessible: true,
        eventCount: verification.eventCount
      };
    }

    let candidate = existsSync(this.#filePath)
      ? this.#filePath
      : path.dirname(this.#filePath);
    while (!existsSync(candidate)) {
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
    try {
      const mode = candidate === this.#filePath
        ? fsConstants.R_OK | fsConstants.W_OK
        : fsConstants.W_OK;
      // accessSync performs no creation or write and is suitable for a
      // readiness preflight of this internal-pilot sink.
      accessSync(candidate, mode);
      return {
        ready: true,
        chainValid: true,
        durablePathConfigured: true,
        durablePathAccessible: true,
        eventCount: verification.eventCount
      };
    } catch {
      return {
        ready: false,
        chainValid: true,
        durablePathConfigured: true,
        durablePathAccessible: false,
        eventCount: verification.eventCount
      };
    }
  }

  get size(): number {
    return this.#events.length;
  }

  get headHash(): string {
    return this.#events.at(-1)?.eventHash ?? V3_AUDIT_GENESIS_HASH;
  }
}
