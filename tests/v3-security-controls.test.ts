import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  V3AuditOutbox,
  verifyV3AuditChain,
  type V3AuditEvent,
} from "../src/assistant-v3/audit.js";
import {
  V3ToolGrantAuthority,
  canonicalizeV3,
  hashCanonicalV3Args,
} from "../src/assistant-v3/grants.js";
import { evaluateV3Policy } from "../src/assistant-v3/policy.js";
import { routeV3Request } from "../src/assistant-v3/routing.js";
import {
  aggregateV3Scores,
  runIndependentV3Scorers,
  scoreV3AuditIntegrity,
  scoreV3GrantBinding,
  scoreV3PolicyRouteAgreement,
  scoreV3RequiredToolUse,
  v3NotApplicableScore,
} from "../src/assistant-v3/scorers.js";
import {
  V3SessionAuthority,
  V3SessionError,
  isV3SessionCurrent,
  v3PrincipalFingerprint,
} from "../src/assistant-v3/sessions.js";

const NOW = Date.UTC(2026, 6, 22, 12, 0, 0);

function sessionAuthority(now: () => number = () => NOW): V3SessionAuthority {
  return new V3SessionAuthority({
    secret: "another-v3-test-secret-that-is-more-than-thirty-two-bytes",
    now,
  });
}

function issueSession(
  authority: V3SessionAuthority,
  principalId = "principal-1",
) {
  return authority.issue({
    tenantId: "tenant-1",
    principalId,
    authContextId: `auth-${principalId}`,
    consentVersion: "consent-v1",
    consents: [
      "assistant_use",
      "portfolio_data",
      "public_market_data",
      "approved_knowledge",
    ],
    entitlementVersion: "entitlements-v1",
    entitlements: [
      "assistant_access",
      "portfolio_read",
      "market_read",
      "research_read",
      "knowledge_read",
      "order_preview",
    ],
  });
}

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

describe("server-issued V3 sessions", () => {
  it("verifies a signed session and binds expected identity", () => {
    const authority = sessionAuthority();
    const issued = issueSession(authority);

    expect(
      authority.verify(issued.token, {
        tenantId: "tenant-1",
        principalId: "principal-1",
        authContextId: "auth-principal-1",
      }).claims.sessionId,
    ).toBe(issued.session.claims.sessionId);
  });

  it("rejects tampering and cross-tenant replay", () => {
    const authority = sessionAuthority();
    const issued = issueSession(authority);
    const [prefix, payload, signature] = issued.token.split(".") as [
      string,
      string,
      string,
    ];
    const tampered = `${prefix}.${payload}.${tamperBase64UrlByte(signature)}`;
    const nonCanonicalSignature = nonCanonicalSha256Base64Url(signature);

    expect(() => authority.verify(tampered)).toThrow(V3SessionError);
    expect(Buffer.from(nonCanonicalSignature, "base64url")).toEqual(
      Buffer.from(signature, "base64url"),
    );
    expect(() =>
      authority.verify(`${prefix}.${payload}.${nonCanonicalSignature}`)
    ).toThrow(V3SessionError);
    expect(() => authority.verify(issued.token, { tenantId: "tenant-2" })).toThrowError(
      /tenant/i,
    );
  });

  it("rejects expired and revoked sessions", () => {
    let now = NOW;
    const authority = sessionAuthority(() => now);
    const issued = authority.issue({
      tenantId: "tenant-1",
      principalId: "principal-1",
      authContextId: "auth-1",
      consentVersion: "v1",
      consents: ["assistant_use"],
      entitlementVersion: "v1",
      entitlements: ["assistant_access"],
      ttlMs: 10,
    });
    authority.revoke(issued.session.claims.sessionId);
    expect(isV3SessionCurrent(issued.session, NOW)).toBe(false);
    expect(() => authority.verify(issued.token)).toThrowError(/revoked/i);

    const second = authority.issue({
      tenantId: "tenant-1",
      principalId: "principal-1",
      authContextId: "auth-1",
      consentVersion: "v1",
      consents: ["assistant_use"],
      entitlementVersion: "v1",
      entitlements: ["assistant_access"],
      ttlMs: 10,
    });
    now += 11;
    expect(() => authority.verify(second.token)).toThrowError(/not current/i);
  });

  it("retains revocation until the revoked session expires and then recovers capacity", () => {
    let now = NOW;
    const authority = new V3SessionAuthority({
      secret: "bounded-revocation-secret-that-is-at-least-thirty-two-bytes",
      now: () => now,
      revocationCapacity: 1
    });
    const first = authority.issue({
      tenantId: "tenant-1",
      principalId: "principal-1",
      authContextId: "auth-1",
      consentVersion: "v1",
      consents: ["assistant_use"],
      entitlementVersion: "v1",
      entitlements: ["assistant_access"],
      ttlMs: 10
    });
    const second = authority.issue({
      tenantId: "tenant-1",
      principalId: "principal-2",
      authContextId: "auth-2",
      consentVersion: "v1",
      consents: ["assistant_use"],
      entitlementVersion: "v1",
      entitlements: ["assistant_access"],
      ttlMs: 20
    });

    authority.revoke(first.session);
    expect(authority.revokedCount).toBe(1);
    expect(() => authority.verify(first.token)).toThrowError(/revoked/i);
    expect(() => authority.revoke(second.session)).toThrowError(/capacity/i);

    now += 9;
    expect(authority.revokedCount).toBe(1);
    expect(() => authority.verify(first.token)).toThrowError(/revoked/i);

    now += 2;
    expect(authority.revokedCount).toBe(0);
    authority.revoke(second.session);
    expect(authority.revokedCount).toBe(1);
    expect(() => authority.verify(second.token)).toThrowError(/revoked/i);
  });

  it("uses a conservative lifetime when revoking by legacy session ID", () => {
    let now = NOW;
    const authority = new V3SessionAuthority({
      secret: "legacy-revocation-secret-that-is-at-least-thirty-two-bytes",
      now: () => now,
      revocationCapacity: 1
    });
    const issued = authority.issue({
      tenantId: "tenant-1",
      principalId: "principal-1",
      authContextId: "auth-1",
      consentVersion: "v1",
      consents: ["assistant_use"],
      entitlementVersion: "v1",
      entitlements: ["assistant_access"],
      ttlMs: 10
    });
    authority.revoke(issued.session.claims.sessionId);

    now += 11;
    expect(authority.revokedCount).toBe(1);
    now += 24 * 60 * 60 * 1_000;
    expect(authority.revokedCount).toBe(0);
  });

  it.each([0, 100_001, Number.NaN, 1.5])(
    "rejects invalid revocation capacity: %s",
    (revocationCapacity) => {
      expect(() => new V3SessionAuthority({
        secret: "invalid-revocation-capacity-secret-at-least-thirty-two-bytes",
        revocationCapacity
      })).toThrowError(/capacity/i);
    }
  );
});

describe("one-use, canonically bound V3 tool grants", () => {
  it("canonicalizes object keys and rejects unsupported argument values", () => {
    expect(canonicalizeV3({ symbol: "NVDA", range: "1d" })).toBe(
      canonicalizeV3({ range: "1d", symbol: "NVDA" }),
    );
    expect(hashCanonicalV3Args({ a: 1, b: [2, 3] })).toBe(
      hashCanonicalV3Args({ b: [2, 3], a: 1 }),
    );
    expect(() => canonicalizeV3({ price: Number.NaN })).toThrowError(/non-finite/i);
  });

  it("binds request, workflow, principal, policy, tool, and canonical args", () => {
    const authority = sessionAuthority();
    const session = issueSession(authority).session;
    const route = routeV3Request("current NVDA price");
    const policy = evaluateV3Policy({ route, session, now: NOW });
    const grants = new V3ToolGrantAuthority({ now: () => NOW });
    const issued = grants.issue({
      requestId: "request-1",
      workflowRunId: "workflow-1",
      route,
      policy,
      session,
      toolId: "read-market-snapshot",
      args: { symbol: "NVDA", range: "1d" },
    });

    const consumed = grants.consume(issued.token, {
      requestId: "request-1",
      workflowRunId: "workflow-1",
      policy,
      session,
      toolId: "read-market-snapshot",
      args: { range: "1d", symbol: "NVDA" },
    });

    expect(consumed).toMatchObject({
      requestId: "request-1",
      workflowRunId: "workflow-1",
      principalFingerprint: v3PrincipalFingerprint(session),
      policyDecisionId: policy.decisionId,
      toolId: "read-market-snapshot",
    });
    expect(() =>
      grants.consume(issued.token, {
        requestId: "request-1",
        workflowRunId: "workflow-1",
        policy,
        session,
        toolId: "read-market-snapshot",
        args: { symbol: "NVDA", range: "1d" },
      }),
    ).toThrowError(/already consumed/i);
  });

  it("binds each currency-conversion scope to its least-privilege route", () => {
    const authority = sessionAuthority();
    const session = issueSession(authority).session;
    const grants = new V3ToolGrantAuthority({ now: () => NOW });
    const quoteRoute = routeV3Request(
      "What is the current NVDA price in AZN?"
    );
    const quotePolicy = evaluateV3Policy({
      route: quoteRoute,
      session,
      now: NOW
    });

    expect(() => grants.issue({
      requestId: "request-wrong-quote-scope",
      workflowRunId: "workflow-wrong-quote-scope",
      route: quoteRoute,
      policy: quotePolicy,
      session,
      toolId: "convert-currency",
      args: {
        scope: "current-portfolio-value",
        targetCurrency: "AZN"
      }
    })).toThrowError(/outside the authorized route scope/i);
    const quoteGrant = grants.issue({
      requestId: "request-quote-conversion",
      workflowRunId: "workflow-quote-conversion",
      route: quoteRoute,
      policy: quotePolicy,
      session,
      toolId: "convert-currency",
      args: {
        scope: "current-market-price",
        symbol: "NVDA",
        targetCurrency: "AZN"
      }
    });
    expect(grants.revoke(quoteGrant.token)).toBe(true);

    const portfolioRoute = routeV3Request(
      "What is the value of my portfolio in AZN?"
    );
    const portfolioPolicy = evaluateV3Policy({
      route: portfolioRoute,
      session,
      now: NOW
    });
    expect(() => grants.issue({
      requestId: "request-wrong-portfolio-scope",
      workflowRunId: "workflow-wrong-portfolio-scope",
      route: portfolioRoute,
      policy: portfolioPolicy,
      session,
      toolId: "convert-currency",
      args: {
        scope: "current-market-price",
        symbol: "NVDA",
        targetCurrency: "AZN"
      }
    })).toThrowError(/outside the authorized route scope/i);
  });

  it("binds education grants to one normalized query hash", () => {
    const query = "What does bond duration mean?";
    const authority = sessionAuthority();
    const session = issueSession(authority).session;
    const route = routeV3Request(query);
    const policy = evaluateV3Policy({ route, session, now: NOW });
    const grants = new V3ToolGrantAuthority({ now: () => NOW });

    const issued = grants.issue({
      requestId: "request-education-query",
      workflowRunId: "workflow-education-query",
      route,
      policy,
      session,
      toolId: "retrieve-reviewed-investment-education",
      args: { query }
    });
    expect(grants.revoke(issued.token)).toBe(true);

    for (const args of [
      { query: "What is tracking error?" },
      { query: ` ${query}` },
      { query, locale: "en-US" },
      { topicId: "bond-duration", locale: "en-US" }
    ]) {
      expect(() => grants.issue({
        requestId: "request-education-query-mismatch",
        workflowRunId: "workflow-education-query-mismatch",
        route,
        policy,
        session,
        toolId: "retrieve-reviewed-investment-education",
        args
      })).toThrowError(/outside the authorized route scope/i);
    }
  });

  it("burns a grant after a mismatched attempt and rejects cross-principal use", () => {
    const authority = sessionAuthority();
    const session = issueSession(authority).session;
    const otherSession = issueSession(authority, "principal-2").session;
    const route = routeV3Request("current NVDA price");
    const policy = evaluateV3Policy({ route, session, now: NOW });
    const grants = new V3ToolGrantAuthority({ now: () => NOW });
    const issued = grants.issue({
      requestId: "request-1",
      workflowRunId: "workflow-1",
      route,
      policy,
      session,
      toolId: "read-market-snapshot",
      args: { symbol: "NVDA" },
    });

    expect(() =>
      grants.consume(issued.token, {
        requestId: "request-1",
        workflowRunId: "workflow-1",
        policy,
        session: otherSession,
        toolId: "read-market-snapshot",
        args: { symbol: "NVDA" },
      }),
    ).toThrowError(/principal|session/i);
    expect(() =>
      grants.consume(issued.token, {
        requestId: "request-1",
        workflowRunId: "workflow-1",
        policy,
        session,
        toolId: "read-market-snapshot",
        args: { symbol: "NVDA" },
      }),
    ).toThrowError(/unknown or already consumed/i);
  });

  it("fails closed at pending capacity and releases state after one-use consumption", () => {
    const authority = sessionAuthority();
    const session = issueSession(authority).session;
    const route = routeV3Request("current NVDA price");
    const policy = evaluateV3Policy({ route, session, now: NOW });
    const grants = new V3ToolGrantAuthority({
      now: () => NOW,
      pendingCapacity: 1
    });
    const input = {
      requestId: "request-capacity",
      workflowRunId: "workflow-capacity",
      route,
      policy,
      session,
      toolId: "read-market-snapshot" as const,
      args: { symbol: "NVDA" }
    };
    const first = grants.issue(input);

    expect(() => grants.issue({
      ...input,
      requestId: "request-at-capacity"
    })).toThrowError(/capacity is exhausted/i);
    expect(grants.pendingCount).toBe(1);

    grants.consume(first.token, {
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      policy,
      session,
      toolId: input.toolId,
      args: input.args
    });
    expect(grants.pendingCount).toBe(0);
    expect(grants.issue({
      ...input,
      requestId: "request-after-consume"
    }).binding.requestId).toBe("request-after-consume");
  });

  it("purges expired pending grants before applying capacity", () => {
    let now = NOW;
    const authority = sessionAuthority(() => now);
    const session = issueSession(authority).session;
    const route = routeV3Request("current NVDA price");
    const policy = evaluateV3Policy({ route, session, now });
    const grants = new V3ToolGrantAuthority({
      now: () => now,
      defaultTtlMs: 10,
      pendingCapacity: 1
    });
    const input = {
      requestId: "request-expiry",
      workflowRunId: "workflow-expiry",
      route,
      policy,
      session,
      toolId: "read-market-snapshot" as const,
      args: { symbol: "NVDA" }
    };
    const expired = grants.issue(input);
    now += 11;

    expect(grants.pendingCount).toBe(0);
    expect(grants.issue({
      ...input,
      requestId: "request-after-expiry"
    }).binding.requestId).toBe("request-after-expiry");
    expect(() => grants.consume(expired.token, {
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      policy,
      session,
      toolId: input.toolId,
      args: input.args
    })).toThrowError(/unknown or already consumed/i);
  });

  it.each([0, 100_001, Number.NaN, 1.5])(
    "rejects invalid pending-grant capacity: %s",
    (pendingCapacity) => {
      expect(() => new V3ToolGrantAuthority({ pendingCapacity })).toThrowError(
        /capacity/i
      );
    }
  );
});

describe("append-only hash-chain audit outbox", () => {
  it("chains immutable events and detects payload tampering", () => {
    let now = NOW;
    const outbox = new V3AuditOutbox({ now: () => now++ });
    expect(outbox.readiness()).toMatchObject({
      ready: true,
      chainValid: true,
      durablePathConfigured: false,
      eventCount: 0
    });
    outbox.append({
      eventType: "route.decided",
      requestId: "request-1",
      workflowRunId: "workflow-1",
      tenantId: "tenant-1",
      principalFingerprint: "principal-hash",
      payload: { route: "market_quote" },
    });
    outbox.append({
      eventType: "tool.grant.consumed",
      requestId: "request-1",
      workflowRunId: "workflow-1",
      tenantId: "tenant-1",
      principalFingerprint: "principal-hash",
      payload: { toolId: "read-market-snapshot" },
    });

    expect(outbox.verify()).toMatchObject({ valid: true, eventCount: 2 });
    expect(Object.isFrozen(outbox.snapshot()[0]?.payload)).toBe(true);

    const copied = outbox.snapshot().map((event) => ({ ...event })) as V3AuditEvent[];
    const second = copied[1];
    if (second === undefined) throw new Error("missing test event");
    copied[1] = { ...second, payload: { toolId: "unapproved-tool" } };
    expect(verifyV3AuditChain(copied)).toMatchObject({
      valid: false,
      errorAt: 1,
      reason: "event_hash_mismatch",
    });
    expect(outbox.verify()).toMatchObject({ valid: true });
  });

  it("rejects duplicate event IDs", () => {
    const outbox = new V3AuditOutbox({ now: () => NOW });
    const input = {
      eventId: "event-1",
      eventType: "request.received",
      requestId: "request-1",
      workflowRunId: null,
      tenantId: "tenant-1",
      principalFingerprint: "principal-hash",
      payload: {},
    } as const;
    outbox.append(input);
    expect(() => outbox.append(input)).toThrowError(/already exists/i);
  });

  it("flushes a durable chain before returning and refuses a corrupted restart", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "assistant-v3-audit-"));
    const filePath = path.join(directory, "outbox.jsonl");
    try {
      const first = new V3AuditOutbox({ filePath, now: () => NOW });
      expect(first.readiness()).toMatchObject({
        ready: true,
        durablePathConfigured: true,
        durablePathAccessible: true
      });
      first.append({
        eventId: "durable-event-1",
        eventType: "assistant-response-committed",
        requestId: "request-1",
        workflowRunId: "workflow-1",
        tenantId: "tenant-1",
        principalFingerprint: "principal-hash",
        payload: { responseHash: "a".repeat(64) },
      });
      expect(readFileSync(filePath, "utf8")).toContain("durable-event-1");
      expect(first.readiness()).toMatchObject({
        ready: true,
        chainValid: true,
        eventCount: 1
      });

      const restarted = new V3AuditOutbox({ filePath, now: () => NOW + 1 });
      expect(restarted.verify()).toMatchObject({ valid: true, eventCount: 1 });
      restarted.append({
        eventId: "durable-event-2",
        eventType: "assistant-response-committed",
        requestId: "request-2",
        workflowRunId: "workflow-2",
        tenantId: "tenant-1",
        principalFingerprint: "principal-hash",
        payload: { responseHash: "b".repeat(64) },
      });
      expect(new V3AuditOutbox({ filePath }).verify()).toMatchObject({
        valid: true,
        eventCount: 2,
      });

      appendFileSync(filePath, "{\"tampered\":true}\n", "utf8");
      expect(() => new V3AuditOutbox({ filePath })).toThrowError(/malformed/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("independent V3 scorer semantics", () => {
  it("never treats not_applicable as a pass", () => {
    const notApplicable = v3NotApplicableScore("test.na");
    expect(notApplicable).toMatchObject({
      status: "not_applicable",
      applicable: false,
      passed: false,
      score: null,
    });
    expect(aggregateV3Scores([notApplicable])).toMatchObject({
      passed: false,
      score: null,
      notApplicableCount: 1,
    });
  });

  it("isolates scorer errors and excludes N/A from the denominator", () => {
    const scores = runIndependentV3Scorers([
      {
        scorerId: "test.pass",
        evaluate: () => ({
          scorerId: "test.pass",
          scorerVersion: "3.0.0",
          status: "pass",
          applicable: true,
          passed: true,
          score: 1,
          reasonCodes: ["ok"],
        }),
      },
      { scorerId: "test.na", evaluate: () => v3NotApplicableScore("test.na") },
      { scorerId: "test.error", evaluate: () => { throw new Error("boom"); } },
    ]);

    expect(scores.map((score) => score.status)).toEqual(["pass", "not_applicable", "error"]);
    expect(aggregateV3Scores(scores)).toMatchObject({
      passed: false,
      score: 1,
      passedCount: 1,
      notApplicableCount: 1,
      errorCount: 1,
    });
  });

  it("scores policy agreement, required tool use, grants, and audit independently", () => {
    const authority = sessionAuthority();
    const session = issueSession(authority).session;
    const route = routeV3Request("current NVDA price");
    const policy = evaluateV3Policy({ route, session, now: NOW });
    const grants = new V3ToolGrantAuthority({ now: () => NOW });
    const issued = grants.issue({
      requestId: "request-score",
      workflowRunId: "workflow-score",
      route,
      policy,
      session,
      toolId: "read-market-snapshot",
      args: { symbol: "NVDA" },
    });

    expect(scoreV3PolicyRouteAgreement(route, policy).status).toBe("pass");
    expect(scoreV3RequiredToolUse(route, ["read-market-snapshot"]).status).toBe("pass");
    expect(
      scoreV3GrantBinding({
        grant: issued.binding,
        requestId: "request-score",
        workflowRunId: "workflow-score",
        policy,
        session,
        toolId: "read-market-snapshot",
        args: { symbol: "NVDA" },
      }).status,
    ).toBe("pass");
    expect(scoreV3AuditIntegrity([])).toMatchObject({
      status: "not_applicable",
      passed: false,
    });
  });

  it("requires the converter in the legacy scorer for an AZN portfolio value", () => {
    const route = routeV3Request("What is the value of my portfolio in AZN?");

    expect(scoreV3RequiredToolUse(
      route,
      ["read-portfolio-snapshot", "read-market-snapshot"]
    ).status).toBe("fail");
    expect(scoreV3RequiredToolUse(
      route,
      ["read-portfolio-snapshot", "read-market-snapshot", "convert-currency"]
    ).status).toBe("pass");
  });
});
