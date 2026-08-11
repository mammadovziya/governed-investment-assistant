export type ReadinessSeverity = "p0" | "p1";

export interface ProductionReadinessInput {
  identityMode: string;
  authenticatedSessionEdge?: boolean;
  portfolioMode: string;
  marketLicenceClass: string;
  developmentSigningKey: boolean;
  signerMode?: "dev-hmac" | "managed-asymmetric";
  storageUrl: string;
  authorityStateMode?: "process-local" | "distributed-atomic";
  auditMode?: "local-hash-chain" | "transactional-worm";
  legacyUnauthenticatedRoutes?: boolean;
  externalModelApproved?: boolean;
  knowledgeApprovalMode?: "official-publication" | "controlled";
  orderHandoffMode?: "synthetic-review" | "enterprise-oms-handoff";
  studioExposed: boolean;
  environment: string;
  /**
   * The pilot uses signed, bounded process-local subject/intent context. A
   * customer deployment may disable continuity or supply an approved encrypted
   * HA store with enforced TTL and subject/session isolation.
   */
  conversationMemoryMode?:
    | "disabled"
    | "process-local-bounded"
    | "encrypted-ha-ttl-store";
}

export interface ProductionReadinessBlocker {
  code:
    | "MOCK_IDENTITY"
    | "UNAUTHENTICATED_SESSION_EDGE"
    | "SYNTHETIC_LEDGER"
    | "UNLICENSED_MARKET_FEED"
    | "DEVELOPMENT_SIGNING_KEY"
    | "SYMMETRIC_PROCESS_SIGNER"
    | "LOCAL_STORAGE"
    | "PROCESS_LOCAL_AUTHORITY_STATE"
    | "LOCAL_AUDIT_CHAIN"
    | "UNAUTHENTICATED_LEGACY_ROUTES"
    | "EXTERNAL_MODEL_GOVERNANCE"
    | "UNCONTROLLED_KNOWLEDGE_APPROVAL"
    | "SYNTHETIC_ORDER_HANDOFF"
    | "PROCESS_LOCAL_CONVERSATION_MEMORY"
    | "STUDIO_EXPOSED";
  severity: ReadinessSeverity;
  capability:
    | "all"
    | "private-portfolio"
    | "public-market"
    | "approved-knowledge"
    | "order-handoff";
  message: string;
}

export interface ProductionReadinessReport {
  target: "internal-pilot" | "customer-production";
  ready: boolean;
  blockers: ProductionReadinessBlocker[];
}

/**
 * Customer-production readiness is deliberately separate from process health.
 * The internal pilot is allowed to run with synthetic client data and public
 * development feeds, but the same dependencies must never be labelled as
 * customer-production ready.
 */
export function evaluateProductionReadiness(
  input: ProductionReadinessInput,
  target: ProductionReadinessReport["target"]
): ProductionReadinessReport {
  if (target === "internal-pilot") {
    // Synthetic identity, ledger, development feeds, signing, and local
    // storage are declared pilot constraints. Studio exposure is different:
    // it creates a customer-reachable administration surface and therefore
    // remains a P0 blocker for every release target.
    const blockers: ProductionReadinessBlocker[] = input.studioExposed
      ? [{
          code: "STUDIO_EXPOSED",
          severity: "p0",
          capability: "all",
          message: "Mastra Studio must remain private and outside the pilot artifact."
        }]
      : [];
    return { target, ready: blockers.length === 0, blockers };
  }

  const blockers: ProductionReadinessBlocker[] = [];
  if (input.identityMode !== "enterprise-oidc") {
    blockers.push({
      code: "MOCK_IDENTITY",
      severity: "p0",
      capability: "all",
      message: "Customer production requires an approved OIDC identity adapter."
    });
  }
  if (input.authenticatedSessionEdge !== true) {
    blockers.push({
      code: "UNAUTHENTICATED_SESSION_EDGE",
      severity: "p0",
      capability: "all",
      message: "Customer production requires a gateway-authenticated session edge; self-issued anonymous sessions are forbidden."
    });
  }
  if (input.portfolioMode !== "enterprise-ledger") {
    blockers.push({
      code: "SYNTHETIC_LEDGER",
      severity: "p0",
      capability: "private-portfolio",
      message: "Customer production requires an entitled production portfolio-ledger adapter."
    });
  }
  if (input.marketLicenceClass !== "customer-production-licensed") {
    blockers.push({
      code: "UNLICENSED_MARKET_FEED",
      severity: "p0",
      capability: "public-market",
      message: "Synthetic or public development feeds are not licensed for customer production."
    });
  }
  if (input.developmentSigningKey) {
    blockers.push({
      code: "DEVELOPMENT_SIGNING_KEY",
      severity: "p0",
      capability: "order-handoff",
      message: "Customer production requires a managed non-development signing key."
    });
  }
  if (input.signerMode !== "managed-asymmetric") {
    blockers.push({
      code: "SYMMETRIC_PROCESS_SIGNER",
      severity: "p0",
      capability: "all",
      message: "Customer production requires a purpose-bound managed asymmetric signer with rotation and revocation."
    });
  }
  if (input.storageUrl.startsWith("file:")) {
    blockers.push({
      code: "LOCAL_STORAGE",
      severity: "p0",
      capability: "all",
      message: "Customer production requires controlled durable storage, not local LibSQL."
    });
  }
  if (input.authorityStateMode !== "distributed-atomic") {
    blockers.push({
      code: "PROCESS_LOCAL_AUTHORITY_STATE",
      severity: "p0",
      capability: "all",
      message: "Customer production requires atomic distributed session, grant, revocation, and one-use handoff state."
    });
  }
  if (input.auditMode !== "transactional-worm") {
    blockers.push({
      code: "LOCAL_AUDIT_CHAIN",
      severity: "p0",
      capability: "all",
      message: "Customer production requires a transactional audit outbox and independently retained tamper-evident archive."
    });
  }
  if (input.legacyUnauthenticatedRoutes !== false) {
    blockers.push({
      code: "UNAUTHENTICATED_LEGACY_ROUTES",
      severity: "p0",
      capability: "all",
      message: "Customer production must remove or authenticate every legacy portfolio, market, compatibility, and streaming route."
    });
  }
  if (input.externalModelApproved !== true) {
    blockers.push({
      code: "EXTERNAL_MODEL_GOVERNANCE",
      severity: "p0",
      capability: "all",
      message: "Customer production requires approved OpenAI data, privacy, residency, and model-risk controls."
    });
  }
  if (input.knowledgeApprovalMode !== "controlled") {
    blockers.push({
      code: "UNCONTROLLED_KNOWLEDGE_APPROVAL",
      severity: "p0",
      capability: "approved-knowledge",
      message: "Customer production requires controlled Legal, Compliance, Product, or Research approvals for exact knowledge versions."
    });
  }
  if (input.orderHandoffMode !== "enterprise-oms-handoff") {
    blockers.push({
      code: "SYNTHETIC_ORDER_HANDOFF",
      severity: "p0",
      capability: "order-handoff",
      message: "Customer production requires an approved order-screen integration that revalidates every material check."
    });
  }
  if ((input.conversationMemoryMode ?? "process-local-bounded") === "process-local-bounded") {
    blockers.push({
      code: "PROCESS_LOCAL_CONVERSATION_MEMORY",
      severity: "p0",
      capability: "all",
      message: "Customer production requires disabled memory or an approved encrypted HA TTL store."
    });
  }
  if (input.studioExposed) {
    blockers.push({
      code: "STUDIO_EXPOSED",
      severity: "p0",
      capability: "all",
      message: "Mastra Studio must not be exposed in the customer artifact."
    });
  }

  return { target, ready: blockers.length === 0, blockers };
}
