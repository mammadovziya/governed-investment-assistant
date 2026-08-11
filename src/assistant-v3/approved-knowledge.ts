import { createHash, randomUUID } from "node:crypto";
import type {
  KnowledgeDocument,
  KnowledgeDocumentManifest,
  KnowledgeQueryContext,
  KnowledgeRetrievedChunk,
  KnowledgeToolResult
} from "../domain/knowledge.js";
import type {
  AssistantCitation,
  FactEnvelope,
  SupportedLocale,
  ToolExecutionEnvelope,
  ToolSource,
  TrustedRequestContext
} from "./contracts.js";
import { EvidenceFactory } from "./evidence.js";
import type { DevHmacSigner } from "./signing.js";

const TOOL_ID = "retrieve-approved-product-knowledge" as const;
const TOOL_VERSION = "1.0.0";
const PRODUCT_SCOPE = "DEMO_INVEST";
const OPEN_ENDED = "9999-12-31T23:59:59.999Z";

export interface ApprovedKnowledgeServicePort {
  readonly indexGeneration: string;
  readonly registry: {
    allDocuments(): KnowledgeDocument[];
  };
  retrieve(query: string, context: KnowledgeQueryContext): Promise<KnowledgeToolResult>;
}

export interface ApprovedKnowledgeEvidenceValue {
  chunkId: string;
  sourceId: string;
  version: string;
  documentType: KnowledgeDocumentManifest["documentType"];
  title: string;
  url: string;
  locale: SupportedLocale;
  jurisdiction: "AZ";
  productScope: "DEMO_INVEST";
  section: string;
  text: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  contentAsOf: string;
  sourceChecksumSha256: string;
  chunkChecksumSha256: string;
  indexGeneration: string;
}

export interface ApprovedKnowledgeAdapterResult {
  status: "grounded" | "unavailable";
  workflowRunId: string;
  toolExecution:
    | ToolExecutionEnvelope<KnowledgeToolResult>
    | ToolExecutionEnvelope<never>;
  citations: readonly AssistantCitation[];
  facts: readonly FactEnvelope<ApprovedKnowledgeEvidenceValue>[];
  failure: {
    code:
      | "INVALID_TRUSTED_CONTEXT"
      | "INVALID_QUERY"
      | "NO_ELIGIBLE_EVIDENCE"
      | "CONFLICTING_EVIDENCE"
      | "KNOWLEDGE_POLICY_REJECTED"
      | "KNOWLEDGE_DEPENDENCY_UNAVAILABLE";
    message: string;
    retryable: boolean;
  } | null;
}

export interface ApprovedKnowledgeAdapterOptions {
  service: ApprovedKnowledgeServicePort;
  signer: DevHmacSigner;
  now?: () => number;
  workflowRunId?: () => string;
}

export interface ProjectApprovedKnowledgeEvidenceInput {
  context: TrustedRequestContext;
  toolExecution: ToolExecutionEnvelope<KnowledgeToolResult>;
  service: ApprovedKnowledgeServicePort;
  signer: DevHmacSigner;
}

export interface ProjectedApprovedKnowledgeEvidence {
  citations: readonly AssistantCitation[];
  facts: readonly FactEnvelope<ApprovedKnowledgeEvidenceValue>[];
}

interface Failure {
  code: NonNullable<ApprovedKnowledgeAdapterResult["failure"]>["code"];
  message: string;
  retryable: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function expectedEffectiveTo(manifest: KnowledgeDocumentManifest): string {
  return manifest.effectiveTo ?? OPEN_ENDED;
}

function manifestsByKey(documents: readonly KnowledgeDocument[]): Map<string, KnowledgeDocument> {
  return new Map(
    documents.map((document) => [
      `${document.manifest.sourceId}@${document.manifest.version}`,
      document
    ])
  );
}

function isManifestEligible(
  manifest: KnowledgeDocumentManifest,
  context: KnowledgeQueryContext
): boolean {
  if (manifest.approvalStatus !== "approved" || manifest.revokedAt !== null) return false;
  if (manifest.locale !== context.locale || manifest.jurisdiction !== "AZ") return false;
  if (manifest.audience !== "customer" || !manifest.allowedChannels.includes("customer_chat")) {
    return false;
  }
  if (!manifest.productScopes.includes(PRODUCT_SCOPE)) return false;
  if (manifest.verifiedAt > context.asOf || manifest.effectiveFrom > context.asOf) return false;
  if (manifest.effectiveTo !== null && context.asOf >= manifest.effectiveTo) return false;
  if (
    manifest.documentType === "research" &&
    (
      manifest.contentAsOf === null ||
      manifest.reviewDueAt === null ||
      context.asOf < manifest.contentAsOf ||
      context.asOf >= manifest.reviewDueAt
    )
  ) {
    return false;
  }
  return true;
}

function isChunkEligible(input: {
  chunk: KnowledgeRetrievedChunk;
  document: KnowledgeDocument | undefined;
  context: KnowledgeQueryContext;
  result: KnowledgeToolResult;
  indexGeneration: string;
}): boolean {
  const { metadata } = input.chunk;
  const manifest = input.document?.manifest;
  if (!input.document || !manifest || !isManifestEligible(manifest, input.context)) return false;
  if (!input.result.retrieval.selectedChunkIds.includes(metadata.chunkId)) return false;
  if (
    metadata.sourceId !== manifest.sourceId ||
    metadata.version !== manifest.version ||
    metadata.documentType !== manifest.documentType ||
    metadata.title !== manifest.title ||
    metadata.url !== manifest.url ||
    metadata.locale !== manifest.locale ||
    metadata.jurisdiction !== "AZ" ||
    metadata.audience !== "customer" ||
    metadata.channel !== "customer_chat" ||
    metadata.approvalStatus !== "approved" ||
    metadata.approvalBasis !== manifest.approvalBasis ||
    metadata.productScope !== PRODUCT_SCOPE ||
    !metadata.productScopes.includes(PRODUCT_SCOPE) ||
    metadata.effectiveFrom !== manifest.effectiveFrom ||
    metadata.effectiveTo !== expectedEffectiveTo(manifest) ||
    metadata.contentAsOf !== (manifest.contentAsOf ?? manifest.publishedAt) ||
    metadata.sourceChecksumSha256 !== manifest.sourceChecksumSha256 ||
    metadata.indexGeneration !== input.indexGeneration ||
    metadata.indexGeneration !== input.result.retrieval.indexGeneration ||
    metadata.embeddingProfile !== manifest.embeddingProfile
  ) {
    return false;
  }
  if (metadata.effectiveFrom > input.context.asOf || metadata.effectiveTo <= input.context.asOf) {
    return false;
  }
  if (sha256(input.document.content) !== manifest.sourceChecksumSha256) return false;
  return sha256(metadata.text) === metadata.chunkChecksumSha256;
}

function trustedFilterMatches(
  result: KnowledgeToolResult,
  context: KnowledgeQueryContext,
  indexGeneration: string
): boolean {
  const filter = result.retrieval.trustedFilter;
  return result.locale === context.locale &&
    result.jurisdiction === "AZ" &&
    filter.locale === context.locale &&
    filter.jurisdiction === "AZ" &&
    filter.approvalStatus === "approved" &&
    filter.channel === "customer_chat" &&
    filter.asOf === context.asOf &&
    filter.productScopes.length === 1 &&
    filter.productScopes[0] === PRODUCT_SCOPE &&
    result.retrieval.indexGeneration === indexGeneration;
}

export class ApprovedKnowledgeAdapter {
  readonly #service: ApprovedKnowledgeServicePort;
  readonly #evidence: EvidenceFactory;
  readonly #now: () => number;
  readonly #workflowRunId: () => string;

  constructor(options: ApprovedKnowledgeAdapterOptions) {
    this.#service = options.service;
    this.#now = options.now ?? Date.now;
    this.#workflowRunId = options.workflowRunId ?? randomUUID;
    this.#evidence = new EvidenceFactory({ signer: options.signer, now: this.#now });
  }

  async retrieve(input: {
    context: TrustedRequestContext;
    query: string;
  }): Promise<ApprovedKnowledgeAdapterResult> {
    const workflowRunId = this.#workflowRunId();
    const startedAt = new Date(this.#now()).toISOString();
    const source = this.#source(input.context.requestedAt);
    const contextFailure = this.#validateTrustedContext(input.context);
    if (contextFailure) {
      return this.#fail({
        context: input.context,
        query: input.query,
        workflowRunId,
        startedAt,
        source,
        failure: contextFailure
      });
    }

    const query = input.query.normalize("NFKC").trim();
    if (query.length === 0 || query.length > 2_000) {
      return this.#fail({
        context: input.context,
        query,
        workflowRunId,
        startedAt,
        source,
        failure: {
          code: "INVALID_QUERY",
          message: "Approved knowledge queries must contain 1-2,000 characters.",
          retryable: false
        }
      });
    }

    const knowledgeContext: KnowledgeQueryContext = {
      locale: input.context.locale,
      jurisdiction: "AZ",
      productScopes: [PRODUCT_SCOPE],
      channel: "customer_chat",
      asOf: input.context.requestedAt,
      requestId: input.context.requestId
    };

    let result: KnowledgeToolResult;
    try {
      result = await this.#service.retrieve(query, knowledgeContext);
    } catch {
      return this.#fail({
        context: input.context,
        query,
        workflowRunId,
        startedAt,
        source,
        failure: {
          code: "KNOWLEDGE_DEPENDENCY_UNAVAILABLE",
          message: "Approved product knowledge retrieval is temporarily unavailable.",
          retryable: true
        }
      });
    }

    if (result.status !== "grounded") {
      const failure: Failure = result.status === "conflicting_evidence"
        ? {
            code: "CONFLICTING_EVIDENCE",
            message: "Approved product sources conflict for this request.",
            retryable: false
          }
        : result.status === "insufficient_evidence"
          ? {
              code: "NO_ELIGIBLE_EVIDENCE",
              message: "No current approved product evidence matched this request.",
              retryable: false
            }
          : {
              code: "KNOWLEDGE_DEPENDENCY_UNAVAILABLE",
              message: "Approved product knowledge retrieval is temporarily unavailable.",
              retryable: true
            };
      return this.#fail({
        context: input.context,
        query,
        workflowRunId,
        startedAt,
        source,
        failure
      });
    }

    const registry = manifestsByKey(this.#service.registry.allDocuments());
    const policyValid = result.chunks.length > 0 &&
      trustedFilterMatches(result, knowledgeContext, this.#service.indexGeneration) &&
      result.chunks.every((chunk) => isChunkEligible({
        chunk,
        document: registry.get(`${chunk.metadata.sourceId}@${chunk.metadata.version}`),
        context: knowledgeContext,
        result,
        indexGeneration: this.#service.indexGeneration
      }));
    if (!policyValid) {
      return this.#fail({
        context: input.context,
        query,
        workflowRunId,
        startedAt,
        source,
        failure: {
          code: "KNOWLEDGE_POLICY_REJECTED",
          message: "Retrieved evidence failed approval, locale, scope, or effective-date validation.",
          retryable: false
        }
      });
    }

    const toolExecution = this.#evidence.toolSuccess({
      requestId: input.context.requestId,
      workflowRunId,
      toolId: TOOL_ID,
      toolVersion: TOOL_VERSION,
      arguments: {
        queryHash: sha256(query),
        locale: knowledgeContext.locale,
        jurisdiction: knowledgeContext.jurisdiction,
        productScopes: knowledgeContext.productScopes,
        channel: knowledgeContext.channel,
        asOf: knowledgeContext.asOf
      },
      result,
      source,
      startedAt
    });
    const citations = result.chunks.map(({ metadata }, index): AssistantCitation => ({
      citationId: `product-knowledge-${index + 1}`,
      sourceId: `${metadata.sourceId}@${metadata.version}`,
      title: metadata.title,
      url: metadata.url,
      sourceAsOf: metadata.contentAsOf,
      effectiveFrom: metadata.effectiveFrom,
      effectiveTo: metadata.effectiveTo === OPEN_ENDED ? null : metadata.effectiveTo,
      contentHash: metadata.chunkChecksumSha256
    }));
    const facts = result.chunks.map(({ metadata }): FactEnvelope<ApprovedKnowledgeEvidenceValue> =>
      this.#evidence.fact({
        requestId: input.context.requestId,
        workflowRunId,
        kind: "approved-knowledge.evidence",
        subject: { type: "product", ref: PRODUCT_SCOPE },
        asOf: metadata.contentAsOf,
        value: {
          chunkId: metadata.chunkId,
          sourceId: metadata.sourceId,
          version: metadata.version,
          documentType: metadata.documentType,
          title: metadata.title,
          url: metadata.url,
          locale: metadata.locale,
          jurisdiction: metadata.jurisdiction,
          productScope: PRODUCT_SCOPE,
          section: metadata.section,
          text: metadata.text,
          effectiveFrom: metadata.effectiveFrom,
          effectiveTo: metadata.effectiveTo === OPEN_ENDED ? null : metadata.effectiveTo,
          contentAsOf: metadata.contentAsOf,
          sourceChecksumSha256: metadata.sourceChecksumSha256,
          chunkChecksumSha256: metadata.chunkChecksumSha256,
          indexGeneration: metadata.indexGeneration
        },
        provenance: {
          toolExecutionIds: [toolExecution.executionId],
          inputFactIds: [],
          calculation: null
        },
        quality: {
          status: "complete",
          coverage: "1.00000000" as FactEnvelope<ApprovedKnowledgeEvidenceValue>["quality"]["coverage"],
          flags: ["APPROVED", "AZ", "CUSTOMER_CHAT", PRODUCT_SCOPE]
        }
      })
    );

    return {
      status: "grounded",
      workflowRunId,
      toolExecution,
      citations,
      facts,
      failure: null
    };
  }

  #source(sourceAsOf: string): ToolSource {
    const observedAt = new Date(this.#now()).toISOString();
    return {
      provider: "demo-invest-approved-knowledge-service",
      sourceId: `approved-knowledge-index:${this.#service.indexGeneration}`,
      sourceUrl: null,
      licenseClass: "synthetic",
      observedAt,
      sourceAsOf
    };
  }

  #validateTrustedContext(context: TrustedRequestContext): Failure | null {
    if (
      context.schemaVersion !== "assistant-v3.request-context.v1" ||
      context.jurisdiction !== "AZ" ||
      !context.requestId ||
      !context.principalRef ||
      !context.requestedAt ||
      context.channel === "mastra-studio" ||
      !context.capabilities.includes("approved-knowledge-read")
    ) {
      return {
        code: "INVALID_TRUSTED_CONTEXT",
        message: "The server-owned knowledge capability context is missing or invalid.",
        retryable: false
      };
    }
    return null;
  }

  #fail(input: {
    context: TrustedRequestContext;
    query: string;
    workflowRunId: string;
    startedAt: string;
    source: ToolSource;
    failure: Failure;
  }): ApprovedKnowledgeAdapterResult {
    const toolExecution = this.#evidence.toolUnavailable({
      requestId: input.context.requestId,
      workflowRunId: input.workflowRunId,
      toolId: TOOL_ID,
      toolVersion: TOOL_VERSION,
      arguments: {
        queryHash: sha256(input.query.normalize("NFKC").trim()),
        locale: input.context.locale,
        jurisdiction: "AZ",
        productScopes: [PRODUCT_SCOPE],
        channel: "customer_chat",
        asOf: input.context.requestedAt
      },
      source: input.source,
      code: input.failure.code,
      message: input.failure.message,
      retryable: input.failure.retryable,
      startedAt: input.startedAt
    });
    return {
      status: "unavailable",
      workflowRunId: input.workflowRunId,
      toolExecution,
      citations: [],
      facts: [],
      failure: input.failure
    };
  }
}

/**
 * Projects an already grant-gated boundary result into citation-bound facts.
 * This avoids a second retrieval while retaining the registry, checksum,
 * locale, jurisdiction, approval, revocation, and effective-date checks.
 */
export function projectApprovedKnowledgeEvidence(
  input: ProjectApprovedKnowledgeEvidenceInput
): ProjectedApprovedKnowledgeEvidence {
  const requestedAt = Date.parse(input.context.requestedAt);
  if (!Number.isFinite(requestedAt)) {
    throw new Error("The trusted request timestamp is invalid.");
  }
  const evidence = new EvidenceFactory({
    signer: input.signer,
    now: () => requestedAt
  });
  const result = input.toolExecution.result;
  if (
    input.toolExecution.toolId !== TOOL_ID ||
    input.toolExecution.requestId !== input.context.requestId ||
    input.toolExecution.status !== "success" ||
    result === null ||
    !evidence.verifyTool(input.toolExecution)
  ) {
    throw new Error("Approved knowledge tool evidence is invalid or unavailable.");
  }
  const context: KnowledgeQueryContext = {
    locale: input.context.locale,
    jurisdiction: "AZ",
    productScopes: [PRODUCT_SCOPE],
    channel: "customer_chat",
    asOf: input.context.requestedAt,
    requestId: input.context.requestId
  };
  const registry = manifestsByKey(input.service.registry.allDocuments());
  const eligible = result.status === "grounded" &&
    result.chunks.length > 0 &&
    trustedFilterMatches(result, context, input.service.indexGeneration) &&
    result.chunks.every((chunk) => isChunkEligible({
      chunk,
      document: registry.get(`${chunk.metadata.sourceId}@${chunk.metadata.version}`),
      context,
      result,
      indexGeneration: input.service.indexGeneration
    }));
  if (!eligible) {
    throw new Error("Approved knowledge evidence failed governed eligibility checks.");
  }

  const citations = result.chunks.map(({ metadata }, index): AssistantCitation => ({
    citationId: `product-knowledge-${index + 1}`,
    sourceId: `${metadata.sourceId}@${metadata.version}`,
    title: metadata.title,
    url: metadata.url,
    sourceAsOf: metadata.contentAsOf,
    effectiveFrom: metadata.effectiveFrom,
    effectiveTo: metadata.effectiveTo === OPEN_ENDED ? null : metadata.effectiveTo,
    contentHash: metadata.chunkChecksumSha256
  }));
  const facts = result.chunks.map(({ metadata }): FactEnvelope<ApprovedKnowledgeEvidenceValue> => evidence.fact({
    requestId: input.context.requestId,
    workflowRunId: input.toolExecution.workflowRunId,
    kind: "approved-knowledge.evidence",
    subject: { type: "product" as const, ref: PRODUCT_SCOPE },
    asOf: metadata.contentAsOf,
    value: {
      chunkId: metadata.chunkId,
      sourceId: metadata.sourceId,
      version: metadata.version,
      documentType: metadata.documentType,
      title: metadata.title,
      url: metadata.url,
      locale: metadata.locale,
      jurisdiction: metadata.jurisdiction,
      productScope: PRODUCT_SCOPE,
      section: metadata.section,
      text: metadata.text,
      effectiveFrom: metadata.effectiveFrom,
      effectiveTo: metadata.effectiveTo === OPEN_ENDED ? null : metadata.effectiveTo,
      contentAsOf: metadata.contentAsOf,
      sourceChecksumSha256: metadata.sourceChecksumSha256,
      chunkChecksumSha256: metadata.chunkChecksumSha256,
      indexGeneration: metadata.indexGeneration
    },
    provenance: {
      toolExecutionIds: [input.toolExecution.executionId],
      inputFactIds: [],
      calculation: null
    },
    quality: {
      status: "complete",
      coverage: "1.00000000" as FactEnvelope<ApprovedKnowledgeEvidenceValue>["quality"]["coverage"],
      flags: ["APPROVED", "AZ", "CUSTOMER_CHAT", PRODUCT_SCOPE]
    }
  }));
  return { citations, facts };
}
