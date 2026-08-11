import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export type V3AuthLevel = "authenticated" | "step_up";
export type V3ConsentScope =
  | "assistant_use"
  | "portfolio_data"
  | "public_market_data"
  | "approved_knowledge";
export type V3Entitlement =
  | "assistant_access"
  | "portfolio_read"
  | "market_read"
  | "research_read"
  | "knowledge_read"
  | "order_preview";

export interface V3SessionClaims {
  readonly version: 1;
  readonly issuer: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly authContextId: string;
  readonly authLevel: V3AuthLevel;
  readonly consentVersion: string;
  readonly consents: readonly V3ConsentScope[];
  readonly entitlementVersion: string;
  readonly entitlements: readonly V3Entitlement[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly nonce: string;
}

export interface V3TrustedSession {
  readonly trusted: true;
  readonly claims: V3SessionClaims;
  readonly tokenHash: string;
}

export interface V3IssueSessionInput {
  readonly tenantId: string;
  readonly principalId: string;
  readonly authContextId: string;
  readonly authLevel?: V3AuthLevel;
  readonly consentVersion: string;
  readonly consents: readonly V3ConsentScope[];
  readonly entitlementVersion: string;
  readonly entitlements: readonly V3Entitlement[];
  readonly ttlMs?: number;
}

export interface V3IssuedSession {
  readonly token: string;
  readonly session: V3TrustedSession;
}

export interface V3ExpectedSession {
  readonly tenantId?: string;
  readonly principalId?: string;
  readonly authContextId?: string;
}

export interface V3SessionAuthorityOptions {
  readonly secret: string | Uint8Array;
  readonly issuer?: string;
  readonly defaultTtlMs?: number;
  readonly revocationCapacity?: number;
  readonly now?: () => number;
}

export class V3SessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "V3SessionError";
    this.code = code;
  }
}

const trustedSessions = new WeakSet<object>();
const trustedSessionState = new WeakMap<object, { readonly isRevoked: () => boolean }>();
const TOKEN_PREFIX = "v3s";
const MIN_SECRET_BYTES = 32;
const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const MAX_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_REVOCATION_CAPACITY = 4_096;
const MAX_REVOCATION_CAPACITY = 100_000;

function revocationCapacity(value: number | undefined): number {
  const resolved = value ?? DEFAULT_REVOCATION_CAPACITY;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_REVOCATION_CAPACITY
  ) {
    throw new V3SessionError(
      "invalid_revocation_capacity",
      `Revocation capacity must be an integer between 1 and ${String(MAX_REVOCATION_CAPACITY)}.`,
    );
  }
  return resolved;
}

function secretBytes(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  if (bytes.byteLength < MIN_SECRET_BYTES) {
    throw new V3SessionError(
      "weak_session_secret",
      `Session signing secret must be at least ${MIN_SECRET_BYTES} bytes.`,
    );
  }
  return Uint8Array.from(bytes);
}

function canonicalBase64UrlBytes(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new V3SessionError("invalid_session_claims", `${field} must be a non-empty string.`);
  }
  return value;
}

function stringArray<T extends string>(value: unknown, field: string): readonly T[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new V3SessionError("invalid_session_claims", `${field} must be a string array.`);
  }
  return Object.freeze([...new Set(value as string[])]) as readonly T[];
}

function parseClaims(payload: string): V3SessionClaims {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new V3SessionError("malformed_session", "Session payload is not valid JSON.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new V3SessionError("invalid_session_claims", "Session payload must be an object.");
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) {
    throw new V3SessionError("unsupported_session_version", "Unsupported session version.");
  }
  if (record.authLevel !== "authenticated" && record.authLevel !== "step_up") {
    throw new V3SessionError("invalid_session_claims", "Session auth level is invalid.");
  }
  if (
    typeof record.issuedAt !== "number" ||
    !Number.isSafeInteger(record.issuedAt) ||
    typeof record.expiresAt !== "number" ||
    !Number.isSafeInteger(record.expiresAt)
  ) {
    throw new V3SessionError("invalid_session_claims", "Session timestamps are invalid.");
  }

  return Object.freeze({
    version: 1,
    issuer: requiredString(record.issuer, "issuer"),
    sessionId: requiredString(record.sessionId, "sessionId"),
    tenantId: requiredString(record.tenantId, "tenantId"),
    principalId: requiredString(record.principalId, "principalId"),
    authContextId: requiredString(record.authContextId, "authContextId"),
    authLevel: record.authLevel,
    consentVersion: requiredString(record.consentVersion, "consentVersion"),
    consents: stringArray<V3ConsentScope>(record.consents, "consents"),
    entitlementVersion: requiredString(record.entitlementVersion, "entitlementVersion"),
    entitlements: stringArray<V3Entitlement>(record.entitlements, "entitlements"),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    nonce: requiredString(record.nonce, "nonce"),
  });
}

function freezeTrustedSession(
  claims: V3SessionClaims,
  token: string,
  isRevoked: () => boolean,
): V3TrustedSession {
  const session = Object.freeze({
    trusted: true as const,
    claims,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  });
  trustedSessions.add(session);
  trustedSessionState.set(session, { isRevoked });
  return session;
}

export function isV3TrustedSession(value: unknown): value is V3TrustedSession {
  return typeof value === "object" && value !== null && trustedSessions.has(value);
}

export function isV3SessionCurrent(
  session: unknown,
  now: number = Date.now(),
): session is V3TrustedSession {
  if (!isV3TrustedSession(session)) return false;
  const state = trustedSessionState.get(session);
  return (
    state !== undefined &&
    !state.isRevoked() &&
    session.claims.issuedAt <= now &&
    session.claims.expiresAt > now
  );
}

export function v3PrincipalFingerprint(session: V3TrustedSession): string {
  return createHash("sha256")
    .update(`${session.claims.tenantId}\u0000${session.claims.principalId}`)
    .digest("hex");
}

export class V3SessionAuthority {
  readonly #secret: Uint8Array;
  readonly #issuer: string;
  readonly #defaultTtlMs: number;
  readonly #revocationCapacity: number;
  readonly #now: () => number;
  readonly #revoked = new Map<string, number>();

  constructor(options: V3SessionAuthorityOptions) {
    this.#secret = secretBytes(options.secret);
    this.#issuer = options.issuer ?? "governed-investment-assistant-v3";
    this.#defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.#revocationCapacity = revocationCapacity(options.revocationCapacity);
    this.#now = options.now ?? Date.now;
    if (
      !Number.isSafeInteger(this.#defaultTtlMs) ||
      this.#defaultTtlMs <= 0 ||
      this.#defaultTtlMs > MAX_TTL_MS
    ) {
      throw new V3SessionError(
        "invalid_session_ttl",
        `Default session TTL must be between 1 and ${MAX_TTL_MS} milliseconds.`,
      );
    }
  }

  issue(input: V3IssueSessionInput): V3IssuedSession {
    const now = this.#now();
    this.#purgeExpiredRevocations(now);
    const ttlMs = input.ttlMs ?? this.#defaultTtlMs;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw new V3SessionError(
        "invalid_session_ttl",
        `Session TTL must be between 1 and ${MAX_TTL_MS} milliseconds.`,
      );
    }

    const claims: V3SessionClaims = Object.freeze({
      version: 1,
      issuer: this.#issuer,
      sessionId: randomUUID(),
      tenantId: requiredString(input.tenantId, "tenantId"),
      principalId: requiredString(input.principalId, "principalId"),
      authContextId: requiredString(input.authContextId, "authContextId"),
      authLevel: input.authLevel ?? "authenticated",
      consentVersion: requiredString(input.consentVersion, "consentVersion"),
      consents: stringArray<V3ConsentScope>(input.consents, "consents"),
      entitlementVersion: requiredString(input.entitlementVersion, "entitlementVersion"),
      entitlements: stringArray<V3Entitlement>(input.entitlements, "entitlements"),
      issuedAt: now,
      expiresAt: now + ttlMs,
      nonce: randomBytes(16).toString("base64url"),
    });
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#secret)
      .update(`${TOKEN_PREFIX}.${payload}`)
      .digest("base64url");
    const token = `${TOKEN_PREFIX}.${payload}.${signature}`;
    return Object.freeze({
      token,
      session: freezeTrustedSession(
        claims,
        token,
        () => this.#revoked.has(claims.sessionId),
      ),
    });
  }

  verify(token: string, expected: V3ExpectedSession = {}): V3TrustedSession {
    const parts = token.split(".");
    const prefix = parts[0];
    const payload = parts[1];
    const providedSignature = parts[2];
    if (
      parts.length !== 3 ||
      prefix !== TOKEN_PREFIX ||
      payload === undefined ||
      providedSignature === undefined
    ) {
      throw new V3SessionError("malformed_session", "Session token format is invalid.");
    }
    if (canonicalBase64UrlBytes(payload) === null) {
      throw new V3SessionError("malformed_session", "Session payload encoding is invalid.");
    }
    const expectedSignature = createHmac("sha256", this.#secret)
      .update(`${TOKEN_PREFIX}.${payload}`)
      .digest();
    const provided = canonicalBase64UrlBytes(providedSignature);
    if (provided === null) {
      throw new V3SessionError("invalid_session_signature", "Session signature is invalid.");
    }
    if (
      provided.byteLength !== expectedSignature.byteLength ||
      !timingSafeEqual(provided, expectedSignature)
    ) {
      throw new V3SessionError("invalid_session_signature", "Session signature is invalid.");
    }

    const claims = parseClaims(payload);
    const now = this.#now();
    this.#purgeExpiredRevocations(now);
    if (claims.issuer !== this.#issuer) {
      throw new V3SessionError("session_issuer_mismatch", "Session issuer does not match.");
    }
    if (claims.issuedAt > now || claims.expiresAt <= now) {
      throw new V3SessionError("session_expired", "Session is not current.");
    }
    if (this.#revoked.has(claims.sessionId)) {
      throw new V3SessionError("session_revoked", "Session has been revoked.");
    }
    if (expected.tenantId !== undefined && claims.tenantId !== expected.tenantId) {
      throw new V3SessionError("tenant_mismatch", "Session tenant does not match.");
    }
    if (expected.principalId !== undefined && claims.principalId !== expected.principalId) {
      throw new V3SessionError("principal_mismatch", "Session principal does not match.");
    }
    if (
      expected.authContextId !== undefined &&
      claims.authContextId !== expected.authContextId
    ) {
      throw new V3SessionError("auth_context_mismatch", "Session auth context does not match.");
    }
    return freezeTrustedSession(
      claims,
      token,
      () => this.#revoked.has(claims.sessionId),
    );
  }

  revoke(session: V3TrustedSession): void;
  revoke(sessionId: string): void;
  revoke(sessionOrId: V3TrustedSession | string): void {
    const now = this.#now();
    this.#purgeExpiredRevocations(now);
    const trustedSession = typeof sessionOrId === "string" ? null : sessionOrId;
    if (trustedSession !== null && !isV3TrustedSession(trustedSession)) {
      throw new V3SessionError(
        "invalid_session",
        "Only a server-issued trusted session can provide revocation expiry.",
      );
    }
    const sessionId = trustedSession === null
      ? requiredString(sessionOrId, "sessionId")
      : trustedSession.claims.sessionId;
    // The legacy session-ID overload cannot recover a token expiry, so it
    // conservatively retains revocation for the maximum possible remaining
    // session lifetime. Passing a trusted session records its exact expiry.
    const expiresAt = trustedSession?.claims.expiresAt ?? now + MAX_TTL_MS;
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt > now + MAX_TTL_MS
    ) {
      throw new V3SessionError(
        "invalid_revocation_expiry",
        "Revocation expiry exceeds the maximum session lifetime.",
      );
    }
    if (expiresAt <= now) return;
    const existingExpiry = this.#revoked.get(sessionId);
    if (existingExpiry !== undefined) {
      if (expiresAt > existingExpiry) this.#revoked.set(sessionId, expiresAt);
      return;
    }
    if (this.#revoked.size >= this.#revocationCapacity) {
      throw new V3SessionError(
        "revocation_capacity_exhausted",
        "Session revocation capacity is exhausted.",
      );
    }
    this.#revoked.set(sessionId, expiresAt);
  }

  get revokedCount(): number {
    this.#purgeExpiredRevocations(this.#now());
    return this.#revoked.size;
  }

  #purgeExpiredRevocations(now: number): void {
    for (const [sessionId, expiresAt] of this.#revoked) {
      if (expiresAt <= now) this.#revoked.delete(sessionId);
    }
  }
}
