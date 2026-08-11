import type { SupportedLocale } from "./types.js";

export const FINANCIAL_EDUCATION_DOCUMENT_SCHEMA_VERSION =
  "assistant-v3.financial-education-document.v1" as const;

export const FINANCIAL_EDUCATION_RESULT_SCHEMA_VERSION =
  "assistant-v3.financial-education-retrieval.v1" as const;

export interface FinancialEducationProposition {
  /** Stable within every language/version of one translation group. */
  readonly propositionId: string;
  readonly section: string;
  /** Exact approved source text. It is evidence, not a prepared chat answer. */
  readonly text: string;
}

export interface FinancialEducationDocumentManifest {
  readonly schemaVersion: typeof FINANCIAL_EDUCATION_DOCUMENT_SCHEMA_VERSION;
  readonly sourceId: string;
  readonly version: string;
  readonly translationGroupId: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly locale: SupportedLocale;
  readonly jurisdiction: "AZ";
  readonly audience: "customer";
  readonly channel: "customer_chat";
  readonly approvalStatus: "approved";
  /** Opaque reference verified by the independent authority adapter. */
  readonly approvalRef: string;
  readonly publishedAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly reviewedAt: string;
  readonly reviewDueAt: string;
  readonly contentSha256: string;
}

export interface ApprovedFinancialEducationDocument {
  readonly manifest: FinancialEducationDocumentManifest;
  readonly propositions: readonly FinancialEducationProposition[];
}

/**
 * Complete immutable identity checked against an approval system of record.
 * The registry never treats manifest fields as proof of their own approval.
 */
export interface FinancialEducationAuthorityBinding {
  readonly authorityId: string;
  readonly sourceId: string;
  readonly version: string;
  readonly locale: SupportedLocale;
  readonly approvalRef: string;
  readonly contentSha256: string;
  readonly manifestBindingSha256: string;
}

export interface FinancialEducationAuthorityVerifier {
  verify(binding: FinancialEducationAuthorityBinding): boolean;
}

export interface FinancialEducationAuthorityPolicy {
  readonly authorityId: string;
  readonly allowedSourceHosts: readonly string[];
  readonly requiredLocales: readonly SupportedLocale[];
  readonly verifier: FinancialEducationAuthorityVerifier;
}

export interface FinancialEducationQueryContext {
  readonly requestId: string;
  readonly locale: SupportedLocale;
  readonly jurisdiction: "AZ";
  readonly channel: "customer_chat";
  readonly asOf: string;
}

export interface FinancialEducationCitation {
  readonly citationId: string;
  readonly propositionId: string;
  readonly sourceId: string;
  readonly version: string;
  readonly translationGroupId: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly locale: SupportedLocale;
  readonly jurisdiction: "AZ";
  readonly section: string;
  readonly excerpt: string;
  readonly publishedAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly reviewedAt: string;
  readonly reviewDueAt: string;
  readonly contentSha256: string;
}

export interface RetrievedFinancialEducationProposition {
  readonly propositionId: string;
  readonly text: string;
  readonly locale: SupportedLocale;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly relevanceScore: number;
  readonly lexicalScore: number;
  readonly vectorScore: number;
  readonly citationId: string;
}

export type FinancialEducationRetrievalStatus =
  | "grounded"
  | "insufficient_evidence"
  | "not_permitted"
  | "dependency_unavailable";

export interface FinancialEducationRetrievalTrace {
  readonly retrievalMethod:
    "approved-corpus-deterministic-vector-plus-lexical-rerank";
  readonly queryHash: string;
  readonly locale: SupportedLocale;
  readonly authorityId: string;
  readonly minimumScore: number;
  readonly topK: number;
  readonly eligibleDocumentCount: number;
  readonly eligiblePropositionCount: number;
  readonly selectedPropositionIds: readonly string[];
}

export interface FinancialEducationRetrievalResult {
  readonly schemaVersion: typeof FINANCIAL_EDUCATION_RESULT_SCHEMA_VERSION;
  readonly status: FinancialEducationRetrievalStatus;
  readonly requestId: string;
  readonly queryHash: string;
  readonly locale: SupportedLocale;
  readonly propositions: readonly RetrievedFinancialEducationProposition[];
  readonly citations: readonly FinancialEducationCitation[];
  readonly retrieval: FinancialEducationRetrievalTrace;
  readonly reasonCodes: readonly string[];
}

export interface FinancialEducationRetrievalInput {
  readonly query: string;
  readonly context: FinancialEducationQueryContext;
}

/** Directly wrap this port in a governed boundary tool after policy integration. */
export interface FinancialEducationRetrievalPort {
  retrieve(
    input: FinancialEducationRetrievalInput
  ): Promise<FinancialEducationRetrievalResult>;
}
