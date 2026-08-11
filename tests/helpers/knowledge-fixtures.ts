import { createHash } from "node:crypto";
import type { QueryResult } from "@mastra/core/vector";
import type {
  KnowledgeDocument,
  KnowledgeDocumentManifest,
  KnowledgeQueryContext
} from "../../src/domain/knowledge.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedChecksum(value: string): string {
  return sha256(value.normalize("NFKC").replace(/\s+/gu, " ").trim());
}

export function knowledgeDocument(input: {
  content?: string;
  manifest?: Partial<KnowledgeDocumentManifest>;
} = {}): KnowledgeDocument {
  const content = input.content ??
    "The fictional Demo Invest Standard plan uses a 0.20% paper-trading fee, subject to its sample minimum and maximum.";
  const sourceId = input.manifest?.sourceId ?? "fixture-fees-en";
  const version = input.manifest?.version ?? "v1";
  const url = input.manifest?.url ?? "https://knowledge.demo-invest.invalid/en/fees";
  const manifest: KnowledgeDocumentManifest = {
    schemaVersion: "1.0.0",
    sourceId,
    version,
    documentType: "fee_schedule",
    title: "Fixture Demo Invest fee schedule",
    url,
    locale: "en-US",
    jurisdiction: "AZ",
    productScopes: ["DEMO_INVEST"],
    facets: ["fees"],
    audience: "customer",
    allowedChannels: ["customer_chat"],
    classification: "public",
    ownerTeam: "fixture-owner",
    approvalStatus: "approved",
    approvalBasis: "official_publication",
    approvals: [{
      role: "publisher",
      actorRef: "knowledge.demo-invest.invalid",
      approvalRef: url,
      decidedAt: "2026-06-30T00:00:00.000Z"
    }],
    publishedAt: "2026-06-30T00:00:00.000Z",
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveTo: null,
    contentAsOf: null,
    reviewDueAt: null,
    revokedAt: null,
    section: "Trading commissions",
    sourceChecksumSha256: sha256(content),
    normalizedChecksumSha256: normalizedChecksum(content),
    parserProfile: "curated-official-publication-v1",
    chunkingProfile: "mastra-recursive-900-120-v1",
    embeddingProfile: "deterministic-hash-384-v1",
    verifiedAt: "2026-07-20T00:00:00.000Z",
    ...input.manifest
  };
  return { manifest, content };
}

export function controlledKnowledgeDocument(input: {
  content?: string;
  manifest?: Partial<KnowledgeDocumentManifest>;
} = {}): KnowledgeDocument {
  return knowledgeDocument({
    ...(input.content !== undefined ? { content: input.content } : {}),
    manifest: {
      sourceId: "fixture-controlled-fees-en",
      approvalBasis: "controlled_approval",
      classification: "internal_approved",
      approvals: [
        {
          role: "content_owner",
          actorRef: "content-owner-fixture",
          approvalRef: "approval-content-001",
          decidedAt: "2026-06-30T00:00:00.000Z"
        },
        {
          role: "compliance",
          actorRef: "compliance-fixture",
          approvalRef: "approval-compliance-001",
          decidedAt: "2026-06-30T00:00:00.000Z"
        }
      ],
      ...input.manifest
    }
  });
}

export function knowledgeContext(
  overrides: Partial<KnowledgeQueryContext> = {}
): KnowledgeQueryContext {
  return {
    locale: "en-US",
    jurisdiction: "AZ",
    productScopes: ["DEMO_INVEST"],
    channel: "customer_chat",
    asOf: "2026-07-21T00:00:00.000Z",
    requestId: "knowledge-test-request",
    ...overrides
  };
}

interface StoredVector {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export class FakeKnowledgeVectorStore {
  readonly records: StoredVector[] = [];
  readonly queries: Array<{
    indexName: string;
    queryVector: number[];
    topK: number;
    filter: Record<string, unknown>;
    includeVector: boolean;
  }> = [];
  private indexCreated = false;
  private dimension = 0;

  constructor(
    private readonly results?: (records: readonly StoredVector[]) => QueryResult[]
  ) {}

  async listIndexes(): Promise<string[]> {
    return this.indexCreated ? ["knowledge-test-index"] : [];
  }

  async describeIndex(): Promise<{ dimension: number; count: number }> {
    return { dimension: this.dimension, count: this.records.length };
  }

  async createIndex(input: {
    indexName: string;
    dimension: number;
    metric?: "cosine";
  }): Promise<void> {
    this.indexCreated = true;
    this.dimension = input.dimension;
  }

  async upsert(input: {
    indexName: string;
    vectors: number[][];
    metadata?: Record<string, unknown>[];
    ids?: string[];
  }): Promise<string[]> {
    const ids = input.ids ?? input.vectors.map((_, index) => `vector-${index}`);
    input.vectors.forEach((vector, index) => {
      this.records.push({
        id: ids[index] ?? `vector-${index}`,
        vector,
        metadata: input.metadata?.[index] ?? {}
      });
    });
    return ids;
  }

  async query(input: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter: Record<string, unknown>;
    includeVector: boolean;
  }): Promise<QueryResult[]> {
    this.queries.push(input);
    if (this.results) return this.results(this.records);
    return this.records.slice(0, input.topK).map(({ id, metadata }) => ({
      id,
      score: 0.9,
      metadata
    }));
  }
}
