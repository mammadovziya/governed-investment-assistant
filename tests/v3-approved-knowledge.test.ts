import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  KnowledgeChunkMetadata,
  KnowledgeDocument,
  KnowledgeQueryContext,
  KnowledgeToolResult
} from "../src/domain/knowledge.js";
import {
  ApprovedKnowledgeAdapter,
  type ApprovedKnowledgeServicePort
} from "../src/assistant-v3/approved-knowledge.js";
import type {
  ToolExecutionEnvelope,
  TrustedRequestContext
} from "../src/assistant-v3/contracts.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { DevHmacSigner, verifyEnvelope } from "../src/assistant-v3/signing.js";

const NOW = Date.parse("2026-07-22T08:00:00.000Z");
const AS_OF = "2026-07-22T07:59:59.000Z";
const INDEX_GENERATION = "approved-knowledge-test-v3";
const OPEN_ENDED = "9999-12-31T23:59:59.999Z";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function signer(): DevHmacSigner {
  return new DevHmacSigner({
    keyId: "approved-knowledge-test-key",
    secret: "knowledge-test-secret-0123456789abcdef" // gitleaks:allow -- synthetic test-only HMAC key
  });
}

function trustedContext(
  overrides: Partial<TrustedRequestContext> = {}
): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-approved-knowledge-001",
    sessionId: "session-approved-knowledge-001",
    conversationId: "conversation-approved-knowledge-001",
    principalRef: "principal:test-customer",
    tenantRef: "tenant:demo-invest",
    locale: "en-US",
    jurisdiction: "AZ",
    channel: "test",
    environment: "test",
    requestedAt: AS_OF,
    authentication: { strength: "authenticated", authContextRef: "auth-knowledge" },
    consentVersion: "consent-v3",
    consentScopes: ["assistant_use", "approved_knowledge"],
    entitlementVersion: "entitlements-v3",
    entitlements: ["assistant_access", "knowledge_read"],
    policyVersion: "policy-v3",
    capabilities: ["approved-knowledge-read"],
    featureSnapshot: { version: "features-v1", flags: { approvedKnowledge: true } },
    ...overrides
  };
}

function feeDocument(): KnowledgeDocument {
  const content =
    "The fictional Standard plan applies a 0.20% paper-trading fee, subject to its sample minimum and maximum.";
  return {
    manifest: {
      schemaVersion: "1.0.0",
      sourceId: "demo-invest-fees-en-test",
      version: "2026-07-01",
      documentType: "fee_schedule",
      title: "Demo Invest sample fees",
      url: "https://knowledge.demo-invest.invalid/en/fees",
      locale: "en-US",
      jurisdiction: "AZ",
      productScopes: ["DEMO_INVEST"],
      facets: ["fees"],
      audience: "customer",
      allowedChannels: ["customer_chat"],
      classification: "public",
      ownerTeam: "Demo Invest maintainers",
      approvalStatus: "approved",
      approvalBasis: "official_publication",
      approvals: [{
        role: "publisher",
        actorRef: "knowledge.demo-invest.invalid",
        approvalRef: "https://knowledge.demo-invest.invalid/en/fees",
        decidedAt: "2026-07-01T00:00:00.000Z"
      }],
      publishedAt: "2026-07-01T00:00:00.000Z",
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      effectiveTo: null,
      contentAsOf: "2026-07-01T00:00:00.000Z",
      reviewDueAt: null,
      revokedAt: null,
      section: "Trading commissions",
      sourceChecksumSha256: sha256(content),
      normalizedChecksumSha256: sha256(content.normalize("NFKC")),
      parserProfile: "curated-project-synthetic-v1",
      chunkingProfile: "mastra-recursive-900-120-v1",
      embeddingProfile: "deterministic-hash-384-v1",
      verifiedAt: "2026-07-01T00:00:00.000Z"
    },
    content
  };
}

function chunkMetadata(document: KnowledgeDocument): KnowledgeChunkMetadata {
  const { manifest } = document;
  return {
    chunkId: `${manifest.sourceId}:${manifest.version}:0`,
    sourceId: manifest.sourceId,
    version: manifest.version,
    documentType: manifest.documentType,
    title: manifest.title,
    url: manifest.url,
    locale: manifest.locale,
    jurisdiction: manifest.jurisdiction,
    productScopes: [...manifest.productScopes],
    productScope: "DEMO_INVEST",
    audience: manifest.audience,
    channel: "customer_chat",
    approvalStatus: manifest.approvalStatus,
    approvalBasis: manifest.approvalBasis,
    effectiveFrom: manifest.effectiveFrom,
    effectiveTo: manifest.effectiveTo ?? OPEN_ENDED,
    contentAsOf: manifest.contentAsOf ?? manifest.publishedAt,
    section: manifest.section,
    text: document.content,
    sourceChecksumSha256: manifest.sourceChecksumSha256,
    chunkChecksumSha256: sha256(document.content),
    indexGeneration: INDEX_GENERATION,
    embeddingProfile: manifest.embeddingProfile,
    chunkIndex: 0
  };
}

function retrievalResult(
  document: KnowledgeDocument,
  context: KnowledgeQueryContext,
  status: KnowledgeToolResult["status"] = "grounded"
): KnowledgeToolResult {
  const metadata = chunkMetadata(document);
  const grounded = status === "grounded";
  return {
    status,
    queryHash: sha256("what are the fees?"),
    locale: context.locale,
    jurisdiction: "AZ",
    chunks: grounded
      ? [{ metadata, vectorScore: 0.91, lexicalScore: 0.95, score: 0.93 }]
      : [],
    retrieval: {
      traceId: "trace-approved-knowledge-test",
      queryHash: sha256("what are the fees?"),
      indexGeneration: INDEX_GENERATION,
      vectorStore: "LibSQLVector",
      retrievalMethod: "mastra-chunked-hash-vector-plus-lexical-rerank",
      embeddingProfile: "deterministic-hash-384-v1",
      trustedFilter: {
        locale: context.locale,
        jurisdiction: "AZ",
        approvalStatus: "approved",
        productScopes: ["DEMO_INVEST"],
        channel: "customer_chat",
        asOf: context.asOf
      },
      facet: "fees",
      eligibleCandidateCount: grounded ? 1 : 0,
      vectorCandidateCount: grounded ? 1 : 0,
      selectedChunkIds: grounded ? [metadata.chunkId] : [],
      rejectedCandidateCount: 0,
      durationMs: 4
    },
    ...(grounded ? {} : { reason: "No eligible evidence." })
  };
}

function serviceFixture(input: {
  document?: KnowledgeDocument;
  status?: KnowledgeToolResult["status"];
  throws?: boolean;
} = {}): {
  service: ApprovedKnowledgeServicePort;
  contexts: KnowledgeQueryContext[];
} {
  const document = input.document ?? feeDocument();
  const contexts: KnowledgeQueryContext[] = [];
  return {
    contexts,
    service: {
      indexGeneration: INDEX_GENERATION,
      registry: { allDocuments: () => [document] },
      retrieve: async (_query, context) => {
        contexts.push(structuredClone(context));
        if (input.throws) throw new Error("vector store unavailable");
        return retrievalResult(document, context, input.status);
      }
    }
  };
}

function adapter(service: ApprovedKnowledgeServicePort, serviceSigner: DevHmacSigner) {
  return new ApprovedKnowledgeAdapter({
    service,
    signer: serviceSigner,
    now: () => NOW,
    workflowRunId: () => "workflow-approved-knowledge-001"
  });
}

describe("V3 approved knowledge adapter", () => {
  it("derives trusted product filters, signs the exact tool execution, citations, and facts", async () => {
    const fixture = serviceFixture();
    const serviceSigner = signer();
    const result = await adapter(fixture.service, serviceSigner).retrieve({
      context: trustedContext(),
      query: "  what are the fees?  "
    });

    expect(fixture.contexts).toEqual([{
      locale: "en-US",
      jurisdiction: "AZ",
      productScopes: ["DEMO_INVEST"],
      channel: "customer_chat",
      asOf: AS_OF,
      requestId: "request-approved-knowledge-001"
    }]);
    expect(result.status).toBe("grounded");
    expect(result.failure).toBeNull();
    expect(result.toolExecution.toolId).toBe("retrieve-approved-product-knowledge");
    expect(result.toolExecution.status).toBe("success");
    expect(verifyEnvelope(result.toolExecution, serviceSigner)).toBe(true);
    expect(result.citations).toEqual([
      expect.objectContaining({
        sourceId: "demo-invest-fees-en-test@2026-07-01",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null
      })
    ]);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.value).toMatchObject({
      sourceId: "demo-invest-fees-en-test",
      locale: "en-US",
      jurisdiction: "AZ",
      productScope: "DEMO_INVEST",
      indexGeneration: INDEX_GENERATION
    });
    const evidence = new EvidenceFactory({ signer: serviceSigner, now: () => NOW });
    expect(evidence.verifyFact(
      result.facts[0]!,
      [result.toolExecution as ToolExecutionEnvelope<unknown>]
    )).toBe(true);
  });

  it.each([
    {
      name: "wrong locale",
      alter: (document: KnowledgeDocument) => {
        document.manifest.locale = "az-AZ";
      }
    },
    {
      name: "revoked source",
      alter: (document: KnowledgeDocument) => {
        document.manifest.revokedAt = "2026-07-10T00:00:00.000Z";
      }
    },
    {
      name: "expired source",
      alter: (document: KnowledgeDocument) => {
        document.manifest.effectiveTo = "2026-07-10T00:00:00.000Z";
      }
    }
  ])("fails closed for a grounded-looking $name", async ({ alter }) => {
    const document = feeDocument();
    alter(document);
    const fixture = serviceFixture({ document });
    const serviceSigner = signer();
    const result = await adapter(fixture.service, serviceSigner).retrieve({
      context: trustedContext(),
      query: "what are the fees?"
    });

    expect(result.status).toBe("unavailable");
    expect(result.failure?.code).toBe("KNOWLEDGE_POLICY_REJECTED");
    expect(result.facts).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.toolExecution.toolId).toBe("retrieve-approved-product-knowledge");
    expect(result.toolExecution.status).toBe("unavailable");
    expect(verifyEnvelope(result.toolExecution, serviceSigner)).toBe(true);
  });

  it.each([
    ["conflicting_evidence", "CONFLICTING_EVIDENCE"],
    ["insufficient_evidence", "NO_ELIGIBLE_EVIDENCE"],
    ["dependency_unavailable", "KNOWLEDGE_DEPENDENCY_UNAVAILABLE"]
  ] as const)("maps %s to a signed fail-closed result", async (status, expectedCode) => {
    const fixture = serviceFixture({ status });
    const serviceSigner = signer();
    const result = await adapter(fixture.service, serviceSigner).retrieve({
      context: trustedContext(),
      query: "what are the fees?"
    });

    expect(result.status).toBe("unavailable");
    expect(result.failure?.code).toBe(expectedCode);
    expect(result.facts).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.toolExecution.status).toBe("unavailable");
    expect(verifyEnvelope(result.toolExecution, serviceSigner)).toBe(true);
  });

  it("does not call retrieval without the server-owned capability", async () => {
    const fixture = serviceFixture();
    const serviceSigner = signer();
    const result = await adapter(fixture.service, serviceSigner).retrieve({
      context: trustedContext({ capabilities: [] }),
      query: "what are the fees?"
    });

    expect(fixture.contexts).toEqual([]);
    expect(result.failure?.code).toBe("INVALID_TRUSTED_CONTEXT");
    expect(result.toolExecution.toolId).toBe("retrieve-approved-product-knowledge");
    expect(verifyEnvelope(result.toolExecution, serviceSigner)).toBe(true);
  });

  it("converts dependency exceptions into a signed unavailable envelope", async () => {
    const fixture = serviceFixture({ throws: true });
    const serviceSigner = signer();
    const result = await adapter(fixture.service, serviceSigner).retrieve({
      context: trustedContext(),
      query: "what are the fees?"
    });

    expect(result.failure).toEqual(expect.objectContaining({
      code: "KNOWLEDGE_DEPENDENCY_UNAVAILABLE",
      retryable: true
    }));
    expect(result.facts).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(verifyEnvelope(result.toolExecution, serviceSigner)).toBe(true);
  });
});
