import type { SupportedLocale } from "./types.js";

export const KNOWLEDGE_DOCUMENT_TYPES = [
  "product_doc",
  "disclosure",
  "fee_schedule",
  "policy",
  "research"
] as const;

export type KnowledgeDocumentType = (typeof KNOWLEDGE_DOCUMENT_TYPES)[number];

export const KNOWLEDGE_APPROVAL_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "superseded",
  "revoked",
  "quarantined"
] as const;

export type KnowledgeApprovalStatus = (typeof KNOWLEDGE_APPROVAL_STATUSES)[number];
export type KnowledgeApprovalBasis = "official_publication" | "controlled_approval";
export type KnowledgeApprovalMode = "official-publication" | "controlled";
export type KnowledgeChannel = "customer_chat" | "advisor_chat" | "internal_search";

export interface KnowledgeApprovalRecord {
  role:
    | "publisher"
    | "content_owner"
    | "product_owner"
    | "legal"
    | "compliance"
    | "research_supervisor";
  actorRef: string;
  approvalRef: string;
  decidedAt: string;
}

/**
 * Canonical approval identity presented to an external, trusted approval
 * registry. A controlled manifest is not authorized merely because it embeds
 * role names: every embedded record must match an independently held binding.
 */
export interface KnowledgeControlledApprovalBinding extends KnowledgeApprovalRecord {
  sourceId: string;
  version: string;
  sourceChecksumSha256: string;
  /** Hash of the complete immutable manifest policy surface (excluding approvals). */
  manifestBindingSha256: string;
}

export interface KnowledgeControlledApprovalVerifier {
  verify(binding: KnowledgeControlledApprovalBinding): boolean;
}

/**
 * Immutable metadata for one independently approved language/version of a source.
 * The registry is the authorization boundary; vector metadata is only a search
 * optimization and is revalidated against this object after every query.
 */
export interface KnowledgeDocumentManifest {
  schemaVersion: "1.0.0";
  sourceId: string;
  version: string;
  translationGroupId?: string | undefined;
  documentType: KnowledgeDocumentType;
  title: string;
  url: string;
  locale: SupportedLocale;
  jurisdiction: "AZ";
  productScopes: string[];
  /** Governed answer domains this independently approved source may support. */
  facets: KnowledgeFacet[];
  audience: "customer" | "advisor" | "internal";
  allowedChannels: KnowledgeChannel[];
  classification: "public" | "internal_approved";
  ownerTeam: string;
  approvalStatus: KnowledgeApprovalStatus;
  approvalBasis: KnowledgeApprovalBasis;
  approvals: KnowledgeApprovalRecord[];
  publishedAt: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  contentAsOf: string | null;
  reviewDueAt: string | null;
  revokedAt: string | null;
  section: string;
  sourceChecksumSha256: string;
  normalizedChecksumSha256: string;
  parserProfile: "curated-official-publication-v1" | "curated-project-synthetic-v1";
  chunkingProfile: "mastra-recursive-900-120-v1";
  embeddingProfile: "deterministic-hash-384-v1";
  verifiedAt: string;
}

export interface KnowledgeDocument {
  manifest: KnowledgeDocumentManifest;
  /** Curated, source-faithful text. Retrieved evidence is data, never instructions. */
  content: string;
}

export interface KnowledgeQueryContext {
  locale: SupportedLocale;
  jurisdiction: "AZ";
  productScopes: string[];
  channel: "customer_chat";
  asOf: string;
  requestId: string;
}

export type KnowledgeFacet =
  | "fees"
  | "account_opening"
  | "funding"
  | "withdrawal"
  | "product"
  | "risk_disclosure"
  | "research"
  | "market_hours"
  | "purchase_process"
  | "sale_process"
  | "asset_protection"
  | "custody_registration"
  | "instrument_availability"
  | "taxation"
  | "corporate_actions"
  | "trade_restrictions"
  | "support_navigation"
  | "general";

export interface KnowledgeChunkMetadata {
  chunkId: string;
  sourceId: string;
  version: string;
  documentType: KnowledgeDocumentType;
  title: string;
  url: string;
  locale: SupportedLocale;
  jurisdiction: "AZ";
  productScopes: string[];
  /** Flattened primary scope used by LibSQL metadata filtering. */
  productScope: string;
  audience: KnowledgeDocumentManifest["audience"];
  channel: KnowledgeChannel;
  approvalStatus: KnowledgeApprovalStatus;
  approvalBasis: KnowledgeApprovalBasis;
  effectiveFrom: string;
  effectiveTo: string;
  contentAsOf: string;
  section: string;
  text: string;
  sourceChecksumSha256: string;
  chunkChecksumSha256: string;
  indexGeneration: string;
  embeddingProfile: KnowledgeDocumentManifest["embeddingProfile"];
  chunkIndex: number;
}

export interface KnowledgeRetrievedChunk {
  metadata: KnowledgeChunkMetadata;
  vectorScore: number;
  lexicalScore: number;
  score: number;
}

export interface KnowledgeCitation {
  id: string;
  chunkId: string;
  sourceId: string;
  version: string;
  title: string;
  documentType: KnowledgeDocumentType;
  url: string;
  locale: SupportedLocale;
  jurisdiction: "AZ";
  effectiveFrom: string;
  effectiveTo: string | null;
  section: string;
  excerpt: string;
}

export interface KnowledgeClaim {
  id: string;
  text: string;
  citationIds: string[];
}

export interface KnowledgeEvaluationCheck {
  id:
    | "required-retrieval-tool"
    | "metadata-eligibility"
    | "citation-coverage"
    | "citation-integrity"
    | "answer-grounding";
  passed: boolean;
  score: 0 | 1;
  reason: string;
}

export interface KnowledgeEvaluation {
  id: "approved-knowledge-grounding";
  passed: boolean;
  score: number;
  checks: KnowledgeEvaluationCheck[];
  failedCheckIds: string[];
}

export interface KnowledgeRetrievalTrace {
  traceId: string;
  queryHash: string;
  indexGeneration: string;
  vectorStore: "LibSQLVector";
  retrievalMethod: "mastra-chunked-hash-vector-plus-lexical-rerank";
  embeddingProfile: "deterministic-hash-384-v1";
  trustedFilter: {
    locale: SupportedLocale;
    jurisdiction: "AZ";
    approvalStatus: "approved";
    productScopes: string[];
    channel: "customer_chat";
    asOf: string;
  };
  facet: KnowledgeFacet;
  eligibleCandidateCount: number;
  vectorCandidateCount: number;
  selectedChunkIds: string[];
  rejectedCandidateCount: number;
  durationMs: number;
}

export interface ApprovedKnowledgeAnswer {
  status:
    | "grounded"
    | "insufficient_evidence"
    | "conflicting_evidence"
    | "dependency_unavailable";
  locale: SupportedLocale;
  jurisdiction: "AZ";
  text: string;
  claims: KnowledgeClaim[];
  citations: KnowledgeCitation[];
  retrieval: KnowledgeRetrievalTrace;
  evaluation: KnowledgeEvaluation;
}

export interface KnowledgeToolResult {
  status: ApprovedKnowledgeAnswer["status"];
  queryHash: string;
  locale: SupportedLocale;
  jurisdiction: "AZ";
  chunks: KnowledgeRetrievedChunk[];
  retrieval: KnowledgeRetrievalTrace;
  reason?: string | undefined;
}

export interface KnowledgeAgentExecution {
  agentId: "approved-knowledge-agent";
  runId?: string | undefined;
  traceId?: string | undefined;
  toolIds: ["retrieve-approved-knowledge"] | [];
  executionMode: "agent-tool" | "fail-closed";
}

export interface ApprovedKnowledgeWorkflowReport {
  workflowVersion: "1.0.0";
  generatedAt: string;
  text: string;
  notices: string[];
  approvedKnowledge: ApprovedKnowledgeAnswer;
  agentExecution: KnowledgeAgentExecution;
}
