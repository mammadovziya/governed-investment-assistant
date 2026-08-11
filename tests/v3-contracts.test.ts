import { describe, expect, it } from "vitest";
import type { AssistantResponse } from "../src/assistant-v3/contracts.js";
import {
  ONE_FIXED,
  decimal,
  divideFixed,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal
} from "../src/assistant-v3/fixed-decimal.js";
import {
  createMockPortfolioToolExecution,
  mockTrustedRequestContext
} from "../src/assistant-v3/mock-portfolio.js";
import {
  DevHmacSigner,
  canonicalHash,
  canonicalJson,
  verifyEnvelope
} from "../src/assistant-v3/signing.js";

const signer = () => new DevHmacSigner({
  keyId: "test-hmac-key",
  secret: "0123456789abcdef0123456789abcdef"
});

function tamperBase64UrlByte(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0) throw new Error("Cannot tamper with an empty base64url value.");
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  return bytes.toString("base64url");
}

function nonCanonicalSha256Base64Url(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = value.at(-1);
  if (last === undefined) throw new Error("Cannot alter an empty base64url value.");
  const index = alphabet.indexOf(last);
  if (index < 0 || index % 4 !== 0) {
    throw new Error("Expected a canonical unpadded SHA-256 base64url value.");
  }
  return `${value.slice(0, -1)}${alphabet[index + 1]}`;
}

describe("V3 fixed decimal", () => {
  it("uses fixed-scale BigInt arithmetic instead of binary floating point", () => {
    const oneTenth = parseFixedDecimal(decimal("0.1"));
    const twoTenths = parseFixedDecimal(decimal("0.2"));

    expect(formatFixedDecimal(multiplyFixed(oneTenth, twoTenths))).toBe("0.02000000");
    expect(formatFixedDecimal(divideFixed(ONE_FIXED, parseFixedDecimal(decimal("3"))))).toBe(
      "0.33333333"
    );
    expect(decimal("00012.3400")).toBe("12.34000000");
  });

  it("rejects precision that cannot be represented exactly at the contract scale", () => {
    expect(() => parseFixedDecimal("1.000000001")).toThrow(/exceeds the supported 8-place scale/u);
    expect(() => parseFixedDecimal("1e3")).toThrow(/Invalid decimal string/u);
  });
});

describe("V3 canonical signing", () => {
  it("hashes and signs semantically identical key orders identically", () => {
    const service = signer();
    const first = { z: ["one", { b: true, a: decimal("10.5") }], a: "value" };
    const second = { a: "value", z: ["one", { a: decimal("10.5"), b: true }] };

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(canonicalHash(first)).toBe(canonicalHash(second));
    expect(service.sign(first)).toEqual(service.sign(second));
    expect(service.verify(second, service.sign(first))).toBe(true);
    expect(service.verify({ ...second, a: "tampered" }, service.sign(first))).toBe(false);
  });

  it("produces verifiable JWS-style compact signatures", () => {
    const service = signer();
    const payload = { factId: "portfolio-value", amount: decimal("10036") };
    const compact = service.toCompactJws(payload);
    const [header, encodedPayload, signature] = compact.split(".") as [string, string, string];
    const changedSignature = tamperBase64UrlByte(signature);
    const nonCanonicalSignature = nonCanonicalSha256Base64Url(signature);

    expect(compact.split(".")).toHaveLength(3);
    expect(service.verifyCompactJws(compact)).toBe(true);
    expect(service.verifyCompactJws(`${header}.${encodedPayload}.${changedSignature}`)).toBe(false);
    expect(Buffer.from(nonCanonicalSignature, "base64url")).toEqual(
      Buffer.from(signature, "base64url")
    );
    expect(
      service.verifyCompactJws(`${header}.${encodedPayload}.${nonCanonicalSignature}`)
    ).toBe(false);
  });

  it("refuses raw BigInt at a serialized trust boundary", () => {
    expect(() => canonicalHash({ authoritativeMoney: 100n })).toThrow(
      /format it as a decimal string/u
    );
  });

  it("binds a typed tool execution to its request and result", () => {
    const service = signer();
    const envelope = createMockPortfolioToolExecution(mockTrustedRequestContext, service);

    expect(verifyEnvelope(envelope, service)).toBe(true);
    expect(envelope.resultHash).toBe(canonicalHash(envelope.result));
    expect(envelope.requestId).toBe(mockTrustedRequestContext.requestId);
  });
});

describe("V3 response contract", () => {
  it("supports a typed, provenance-bearing response without embedding an executable order", () => {
    const response: AssistantResponse = {
      schemaVersion: "assistant-v3.response.v1",
      requestId: mockTrustedRequestContext.requestId,
      conversationId: mockTrustedRequestContext.conversationId,
      status: "complete",
      message: "Your covered mock portfolio value is ready.",
      claims: [],
      facts: [],
      citations: [],
      cards: [],
      charts: [],
      actions: [],
      notices: ["Synthetic client data."],
      freshness: [],
      evaluations: [],
      deliveryGate: "pass",
      generationMode: "deterministic",
      provenance: {
        workflowId: "portfolio-insight-v3",
        workflowVersion: "3.0.0",
        workflowRunId: "workflow-run-portfolio-v3-001",
        model: "gpt-4o",
        toolExecutionIds: [],
        factIds: [],
        policyVersion: mockTrustedRequestContext.policyVersion
      }
    };

    expect(response.provenance.model).toBe("gpt-4o");
    expect(response.actions).toEqual([]);
  });
});
