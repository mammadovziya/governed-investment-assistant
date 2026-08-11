import { describe, expect, it } from "vitest";
import { evaluateProductionReadiness } from "../src/assistant-v3/readiness.js";

describe("V3 customer-production readiness", () => {
  const pilotDependencies = {
    identityMode: "mock-internal-pilot",
    authenticatedSessionEdge: false,
    portfolioMode: "synthetic-ledger",
    marketLicenceClass: "development-public-feed",
    developmentSigningKey: true,
    signerMode: "dev-hmac" as const,
    storageUrl: "file:./assistant.db",
    authorityStateMode: "process-local" as const,
    auditMode: "local-hash-chain" as const,
    legacyUnauthenticatedRoutes: true,
    externalModelApproved: false,
    knowledgeApprovalMode: "official-publication" as const,
    orderHandoffMode: "synthetic-review" as const,
    studioExposed: false,
    environment: "development",
    conversationMemoryMode: "process-local-bounded" as const
  };

  it("permits the declared internal pilot", () => {
    expect(evaluateProductionReadiness(pilotDependencies, "internal-pilot")).toEqual({
      target: "internal-pilot",
      ready: true,
      blockers: []
    });
  });

  it("blocks even the internal pilot when Studio is exposed", () => {
    expect(evaluateProductionReadiness(
      { ...pilotDependencies, studioExposed: true },
      "internal-pilot"
    )).toEqual({
      target: "internal-pilot",
      ready: false,
      blockers: [{
        code: "STUDIO_EXPOSED",
        severity: "p0",
        capability: "all",
        message: "Mastra Studio must remain private and outside the pilot artifact."
      }]
    });
  });

  it("fails customer-production readiness for every development dependency", () => {
    const report = evaluateProductionReadiness(pilotDependencies, "customer-production");
    expect(report.ready).toBe(false);
    expect(report.blockers.map(({ code }) => code)).toEqual([
      "MOCK_IDENTITY",
      "UNAUTHENTICATED_SESSION_EDGE",
      "SYNTHETIC_LEDGER",
      "UNLICENSED_MARKET_FEED",
      "DEVELOPMENT_SIGNING_KEY",
      "SYMMETRIC_PROCESS_SIGNER",
      "LOCAL_STORAGE",
      "PROCESS_LOCAL_AUTHORITY_STATE",
      "LOCAL_AUDIT_CHAIN",
      "UNAUTHENTICATED_LEGACY_ROUTES",
      "EXTERNAL_MODEL_GOVERNANCE",
      "UNCONTROLLED_KNOWLEDGE_APPROVAL",
      "SYNTHETIC_ORDER_HANDOFF",
      "PROCESS_LOCAL_CONVERSATION_MEMORY"
    ]);
  });

  it("allows bounded process-local memory only for the internal pilot", () => {
    expect(evaluateProductionReadiness(
      pilotDependencies,
      "internal-pilot"
    )).toMatchObject({ ready: true, blockers: [] });

    expect(evaluateProductionReadiness(
      {
        ...pilotDependencies,
        identityMode: "enterprise-oidc",
        authenticatedSessionEdge: true,
        portfolioMode: "enterprise-ledger",
        marketLicenceClass: "customer-production-licensed",
        developmentSigningKey: false,
        signerMode: "managed-asymmetric",
        storageUrl: "libsql://controlled-audit.example.invalid",
        authorityStateMode: "distributed-atomic",
        auditMode: "transactional-worm",
        legacyUnauthenticatedRoutes: false,
        externalModelApproved: true,
        knowledgeApprovalMode: "controlled",
        orderHandoffMode: "enterprise-oms-handoff",
        environment: "production"
      },
      "customer-production"
    )).toMatchObject({
      ready: false,
      blockers: [{ code: "PROCESS_LOCAL_CONVERSATION_MEMORY" }]
    });
  });

  it("passes only with controlled customer-production dependencies", () => {
    const report = evaluateProductionReadiness(
      {
        ...pilotDependencies,
        identityMode: "enterprise-oidc",
        authenticatedSessionEdge: true,
        portfolioMode: "enterprise-ledger",
        marketLicenceClass: "customer-production-licensed",
        developmentSigningKey: false,
        signerMode: "managed-asymmetric",
        storageUrl: "libsql://controlled-audit.example.invalid",
        authorityStateMode: "distributed-atomic",
        auditMode: "transactional-worm",
        legacyUnauthenticatedRoutes: false,
        externalModelApproved: true,
        knowledgeApprovalMode: "controlled",
        orderHandoffMode: "enterprise-oms-handoff",
        studioExposed: false,
        environment: "production",
        conversationMemoryMode: "encrypted-ha-ttl-store"
      },
      "customer-production"
    );
    expect(report).toMatchObject({ ready: true, blockers: [] });
  });

  it("also permits customer production with conversation memory disabled", () => {
    const report = evaluateProductionReadiness(
      {
        ...pilotDependencies,
        identityMode: "enterprise-oidc",
        authenticatedSessionEdge: true,
        portfolioMode: "enterprise-ledger",
        marketLicenceClass: "customer-production-licensed",
        developmentSigningKey: false,
        signerMode: "managed-asymmetric",
        storageUrl: "libsql://controlled-audit.example.invalid",
        authorityStateMode: "distributed-atomic",
        auditMode: "transactional-worm",
        legacyUnauthenticatedRoutes: false,
        externalModelApproved: true,
        knowledgeApprovalMode: "controlled",
        orderHandoffMode: "enterprise-oms-handoff",
        environment: "production",
        conversationMemoryMode: "disabled"
      },
      "customer-production"
    );
    expect(report).toMatchObject({ ready: true, blockers: [] });
  });
});
