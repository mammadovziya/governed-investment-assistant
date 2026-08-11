import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  CanonicalSignature,
  EnvelopeIntegrity
} from "./contracts.js";

type CanonicalObject = Record<string, unknown>;

function isPlainObject(value: object): value is CanonicalObject {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value: unknown, inArray = false): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers.");
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "bigint":
      throw new TypeError(
        "BigInt cannot cross a signed envelope boundary; format it as a decimal string first."
      );
    case "undefined":
    case "function":
    case "symbol":
      if (inArray) return "null";
      throw new TypeError("Unsupported top-level canonical JSON value.");
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item, true)).join(",")}]`;
      }
      if (!isPlainObject(value)) {
        throw new TypeError("Signed payloads must contain only plain JSON objects.");
      }
      const members = Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
      return `{${members.join(",")}}`;
    }
  }
  throw new TypeError("Unsupported canonical JSON value.");
}

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function signatureBytes(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function canonicalHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

/**
 * Development-only symmetric signer. Production should replace this class with
 * a KMS/HSM-backed asymmetric signer while retaining the same envelope contract.
 */
export class DevHmacSigner {
  readonly keyId: string;
  private readonly secret: Buffer;

  constructor(input: { keyId: string; secret: string | Uint8Array }) {
    if (!input.keyId.trim()) throw new TypeError("A signing key ID is required.");
    const secret = Buffer.from(input.secret);
    if (secret.byteLength < 32) {
      throw new RangeError("The development HMAC secret must contain at least 32 bytes.");
    }
    this.keyId = input.keyId;
    this.secret = Buffer.from(secret);
  }

  sign(payload: unknown): CanonicalSignature {
    const protectedHeader = base64Url(
      canonicalJson({ alg: "HS256", kid: this.keyId, typ: "JOSE" })
    );
    const canonicalPayload = canonicalJson(payload);
    const encodedPayload = base64Url(canonicalPayload);
    const signature = createHmac("sha256", this.secret)
      .update(`${protectedHeader}.${encodedPayload}`, "utf8")
      .digest("base64url");
    return {
      algorithm: "HS256",
      keyId: this.keyId,
      protectedHeader,
      payloadHash: canonicalHash(payload),
      signature
    };
  }

  verify(payload: unknown, candidate: CanonicalSignature): boolean {
    if (candidate.algorithm !== "HS256" || candidate.keyId !== this.keyId) return false;
    if (candidate.payloadHash !== canonicalHash(payload)) return false;
    const expected = this.sign(payload);
    if (candidate.protectedHeader !== expected.protectedHeader) return false;
    const actualBytes = signatureBytes(candidate.signature);
    const expectedBytes = signatureBytes(expected.signature);
    return actualBytes !== null && expectedBytes !== null &&
      actualBytes.byteLength === expectedBytes.byteLength &&
      timingSafeEqual(actualBytes, expectedBytes);
  }

  seal(payload: unknown): EnvelopeIntegrity {
    return {
      canonicalization: "jcs-compatible-v1",
      signature: this.sign(payload)
    };
  }

  verifyIntegrity(payload: unknown, integrity: EnvelopeIntegrity): boolean {
    return integrity.canonicalization === "jcs-compatible-v1" &&
      this.verify(payload, integrity.signature);
  }

  toCompactJws(payload: unknown): string {
    const signed = this.sign(payload);
    return `${signed.protectedHeader}.${base64Url(canonicalJson(payload))}.${signed.signature}`;
  }

  verifyAndDecodeCompactJws(compact: string): { payload: unknown } | null {
    const [protectedHeader, encodedPayload, signature, extra] = compact.split(".");
    if (!protectedHeader || !encodedPayload || !signature || extra !== undefined) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    const candidate: CanonicalSignature = {
      algorithm: "HS256",
      keyId: this.keyId,
      protectedHeader,
      payloadHash: canonicalHash(parsed),
      signature
    };
    return encodedPayload === base64Url(canonicalJson(parsed)) &&
      this.verify(parsed, candidate)
      ? { payload: parsed }
      : null;
  }

  verifyCompactJws(compact: string): boolean {
    return this.verifyAndDecodeCompactJws(compact) !== null;
  }
}

export function attachIntegrity<TPayload extends object>(
  payload: TPayload,
  signer: DevHmacSigner
): TPayload & { integrity: EnvelopeIntegrity } {
  return { ...payload, integrity: signer.seal(payload) };
}

export function unsignedEnvelope<TEnvelope extends { integrity: EnvelopeIntegrity }>(
  envelope: TEnvelope
): Omit<TEnvelope, "integrity"> {
  const { integrity: _integrity, ...payload } = envelope;
  return payload;
}

export function verifyEnvelope<TEnvelope extends { integrity: EnvelopeIntegrity }>(
  envelope: TEnvelope,
  signer: DevHmacSigner
): boolean {
  return signer.verifyIntegrity(unsignedEnvelope(envelope), envelope.integrity);
}
