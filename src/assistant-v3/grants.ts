import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  enforceV3PolicyAgreement,
  isV3TrustedPolicyDecision,
  type V3ApprovedBoundaryToolId,
  type V3PolicyDecision,
} from "./policy.js";
import type { V3RouteDecision } from "./routing.js";
import {
  isV3SessionCurrent,
  v3PrincipalFingerprint,
  type V3TrustedSession,
} from "./sessions.js";
import {
  financialEducationRouteReason,
  normalizeFinancialEducationQuery,
} from "./financial-education-query.js";

export interface V3GrantBinding {
  readonly grantId: string;
  readonly requestId: string;
  readonly workflowRunId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly principalFingerprint: string;
  readonly policyDecisionId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly routeFingerprint: string;
  readonly toolId: V3ApprovedBoundaryToolId;
  readonly canonicalArgsHash: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface V3IssueGrantInput {
  readonly requestId: string;
  readonly workflowRunId: string;
  readonly route: V3RouteDecision;
  readonly policy: V3PolicyDecision;
  readonly session: V3TrustedSession;
  readonly toolId: V3ApprovedBoundaryToolId;
  readonly args: unknown;
  readonly ttlMs?: number;
}

export interface V3IssuedGrant {
  readonly token: string;
  readonly binding: V3GrantBinding;
}

export interface V3ConsumeGrantInput {
  readonly requestId: string;
  readonly workflowRunId: string;
  readonly policy: V3PolicyDecision;
  readonly session: V3TrustedSession;
  readonly toolId: V3ApprovedBoundaryToolId;
  readonly args: unknown;
}

export interface V3ConsumedGrant extends V3GrantBinding {
  readonly consumedAt: number;
}

export interface V3GrantAuthorityOptions {
  readonly defaultTtlMs?: number;
  readonly pendingCapacity?: number;
  readonly now?: () => number;
}

export class V3GrantError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "V3GrantError";
    this.code = code;
  }
}

const DEFAULT_TTL_MS = 15_000;
const MAX_TTL_MS = 60_000;
const DEFAULT_PENDING_GRANT_CAPACITY = 4_096;
const MAX_PENDING_GRANT_CAPACITY = 100_000;

function pendingGrantCapacity(value: number | undefined): number {
  const resolved = value ?? DEFAULT_PENDING_GRANT_CAPACITY;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_PENDING_GRANT_CAPACITY
  ) {
    throw new V3GrantError(
      "invalid_grant_capacity",
      `Pending grant capacity must be an integer between 1 and ${String(MAX_PENDING_GRANT_CAPACITY)}.`,
    );
  }
  return resolved;
}

function requiredString(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new V3GrantError("invalid_grant_binding", `${field} must be a non-empty string.`);
  }
  return value;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new V3GrantError("non_canonical_args", "Grant arguments cannot contain non-finite numbers.");
  }
  return Object.is(value, -0) ? "0" : JSON.stringify(value);
}

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return canonicalNumber(value);
  if (
    typeof value === "undefined" ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new V3GrantError(
      "non_canonical_args",
      `Grant arguments cannot contain ${typeof value} values.`,
    );
  }
  if (ancestors.has(value)) {
    throw new V3GrantError("non_canonical_args", "Grant arguments cannot contain cycles.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalValue(item, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new V3GrantError(
        "non_canonical_args",
        "Grant arguments must contain only plain objects and arrays.",
      );
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** RFC-8785-like stable JSON for capability binding. */
export function canonicalizeV3(value: unknown): string {
  return canonicalValue(value, new Set());
}

export function hashCanonicalV3Args(args: unknown): string {
  return createHash("sha256").update(canonicalizeV3(args)).digest("hex");
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mismatch(field: string): never {
  throw new V3GrantError(
    "grant_binding_mismatch",
    `Grant ${field} does not match the execution request.`,
  );
}

function plainArguments(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function enforceToolArgumentScope(
  route: V3RouteDecision,
  toolId: V3ApprovedBoundaryToolId,
  args: unknown
): void {
  if (toolId === "retrieve-reviewed-investment-education") {
    const record = plainArguments(args);
    const query = record?.query;
    const normalizedQuery = typeof query === "string"
      ? normalizeFinancialEducationQuery(query)
      : null;
    const routeReason = normalizedQuery === null
      ? null
      : financialEducationRouteReason(normalizedQuery);
    if (
      route.route !== "education" ||
      record === null ||
      Object.keys(record).length !== 1 ||
      normalizedQuery === null ||
      query !== normalizedQuery ||
      routeReason === null ||
      !route.reasonCodes.includes(routeReason)
    ) {
      throw new V3GrantError(
        "tool_arguments_not_authorized",
        "Reviewed-education arguments are outside the authorized route scope."
      );
    }
    return;
  }
  if (toolId !== "convert-currency") return;
  const record = plainArguments(args);
  const denied = (): never => {
    throw new V3GrantError(
      "tool_arguments_not_authorized",
      "Currency-conversion arguments are outside the authorized route scope."
    );
  };
  const scoped = record === null ? denied() : record;
  if (route.route === "market_quote") {
    if (
      scoped.scope !== "current-market-price" ||
      typeof scoped.symbol !== "string" ||
      route.symbols.length !== 1 ||
      route.symbols[0] !== scoped.symbol ||
      (scoped.targetCurrency !== "USD" && scoped.targetCurrency !== "AZN")
    ) {
      denied();
    }
    return;
  }
  if (route.route === "current_portfolio_value") {
    if (
      scoped.scope !== "provided-amount" &&
      scoped.scope !== "current-portfolio-value"
    ) {
      denied();
    }
    return;
  }
  denied();
}

export class V3ToolGrantAuthority {
  readonly #defaultTtlMs: number;
  readonly #pendingCapacity: number;
  readonly #now: () => number;
  readonly #pending = new Map<string, V3GrantBinding>();

  constructor(options: V3GrantAuthorityOptions = {}) {
    this.#defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.#pendingCapacity = pendingGrantCapacity(options.pendingCapacity);
    this.#now = options.now ?? Date.now;
    if (
      !Number.isSafeInteger(this.#defaultTtlMs) ||
      this.#defaultTtlMs <= 0 ||
      this.#defaultTtlMs > MAX_TTL_MS
    ) {
      throw new V3GrantError("invalid_grant_ttl", "Default grant TTL is invalid.");
    }
  }

  issue(input: V3IssueGrantInput): V3IssuedGrant {
    const now = this.#now();
    this.#purgeExpired(now);
    const policy = enforceV3PolicyAgreement(input.route, input.policy, input.session, now);
    const ttlMs = input.ttlMs ?? this.#defaultTtlMs;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw new V3GrantError("invalid_grant_ttl", "Grant TTL is invalid.");
    }
    if (!policy.allowedToolIds.includes(input.toolId)) {
      throw new V3GrantError(
        "tool_not_authorized",
        `Tool ${input.toolId} is not authorized by the policy decision.`,
      );
    }
    enforceToolArgumentScope(input.route, input.toolId, input.args);
    requiredString(input.toolId, "toolId");
    const expiresAt = Math.min(now + ttlMs, policy.expiresAt, input.session.claims.expiresAt);
    if (expiresAt <= now) {
      throw new V3GrantError("grant_expired", "Grant would already be expired.");
    }
    const requestId = requiredString(input.requestId, "requestId");
    const workflowRunId = requiredString(input.workflowRunId, "workflowRunId");
    const canonicalArgsHash = hashCanonicalV3Args(input.args);
    if (this.#pending.size >= this.#pendingCapacity) {
      throw new V3GrantError(
        "grant_capacity_exhausted",
        "Pending tool-grant capacity is exhausted.",
      );
    }
    const token = `v3g_${randomBytes(32).toString("base64url")}`;
    const binding: V3GrantBinding = Object.freeze({
      grantId: randomUUID(),
      requestId,
      workflowRunId,
      sessionId: input.session.claims.sessionId,
      tenantId: input.session.claims.tenantId,
      principalFingerprint: v3PrincipalFingerprint(input.session),
      policyDecisionId: policy.decisionId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      routeFingerprint: policy.routeFingerprint,
      toolId: input.toolId,
      canonicalArgsHash,
      issuedAt: now,
      expiresAt,
    });
    this.#pending.set(tokenKey(token), binding);
    return Object.freeze({ token, binding });
  }

  consume(token: string, input: V3ConsumeGrantInput): V3ConsumedGrant {
    const now = this.#now();
    const key = tokenKey(token);
    const binding = this.#pending.get(key);
    // Delete before validation: a failed binding attempt also burns the bearer
    // token, preventing retries as an oracle and guaranteeing one-use semantics.
    this.#pending.delete(key);
    this.#purgeExpired(now);
    if (binding === undefined) {
      throw new V3GrantError("grant_missing_or_consumed", "Grant is unknown or already consumed.");
    }
    if (binding.expiresAt <= now || binding.issuedAt > now) {
      throw new V3GrantError("grant_expired", "Grant is not current.");
    }
    if (!isV3SessionCurrent(input.session, now)) mismatch("session");
    if (!isV3TrustedPolicyDecision(input.policy) || !input.policy.authorized) {
      mismatch("policy");
    }
    if (binding.requestId !== input.requestId) mismatch("requestId");
    if (binding.workflowRunId !== input.workflowRunId) mismatch("workflowRunId");
    if (binding.sessionId !== input.session.claims.sessionId) mismatch("sessionId");
    if (binding.tenantId !== input.session.claims.tenantId) mismatch("tenantId");
    if (binding.principalFingerprint !== v3PrincipalFingerprint(input.session)) {
      mismatch("principal");
    }
    if (binding.policyDecisionId !== input.policy.decisionId) mismatch("policyDecisionId");
    if (binding.policyId !== input.policy.policyId) mismatch("policyId");
    if (binding.policyVersion !== input.policy.policyVersion) mismatch("policyVersion");
    if (binding.routeFingerprint !== input.policy.routeFingerprint) mismatch("route");
    if (binding.toolId !== input.toolId) mismatch("toolId");
    if (binding.canonicalArgsHash !== hashCanonicalV3Args(input.args)) mismatch("canonicalArgs");

    return Object.freeze({ ...binding, consumedAt: now });
  }

  revoke(token: string): boolean {
    const removed = this.#pending.delete(tokenKey(token));
    this.#purgeExpired(this.#now());
    return removed;
  }

  get pendingCount(): number {
    this.#purgeExpired(this.#now());
    return this.#pending.size;
  }

  #purgeExpired(now: number): void {
    for (const [key, binding] of this.#pending) {
      if (binding.expiresAt <= now) this.#pending.delete(key);
    }
  }
}
