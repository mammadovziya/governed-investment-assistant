import type { QueryResult } from "@mastra/core/vector";
import { describe, expect, it } from "vitest";
import { approvedProductKnowledgeDocuments } from "../src/data/approved-product-knowledge.js";
import type {
  KnowledgeDocument,
  KnowledgeQueryContext,
  KnowledgeToolResult
} from "../src/domain/knowledge.js";
import { KnowledgeRegistry } from "../src/services/knowledge-registry.js";
import {
  ApprovedKnowledgeService,
  composeApprovedKnowledgeAnswer
} from "../src/services/knowledge-retrieval.js";
import { knowledgeRetrievalBenchmark } from "./fixtures/knowledge-retrieval-benchmark.js";
import { knowledgeContext, knowledgeDocument } from "./helpers/knowledge-fixtures.js";
import {
  evaluateRetrievalQuality,
  type RetrievalJudgment
} from "./helpers/retrieval-metrics.js";

const INDEX_NAME = "knowledge-quality-gate-index";
const INDEX_GENERATION = "knowledge-quality-gate-v1";
const AS_OF = "2026-07-22T00:00:00.000Z";

interface StoredVector {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

/** Deterministic cosine search; trusted metadata is still enforced by the service post-filter. */
class BenchmarkVectorStore {
  private readonly records: StoredVector[] = [];
  private created = false;
  private dimension = 0;

  async listIndexes(): Promise<string[]> {
    return this.created ? [INDEX_NAME] : [];
  }

  async describeIndex(_input: { indexName: string }): Promise<{ dimension: number; count: number }> {
    return { dimension: this.dimension, count: this.records.length };
  }

  async createIndex(input: { indexName: string; dimension: number }): Promise<void> {
    this.created = true;
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
    return this.records
      .map(({ id, vector, metadata }) => ({
        id,
        score: vector.reduce(
          (total, component, index) => total + component * (input.queryVector[index] ?? 0),
          0
        ),
        metadata
      }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, input.topK);
  }
}

function retrievalService(documents: readonly KnowledgeDocument[]): ApprovedKnowledgeService {
  return new ApprovedKnowledgeService({
    registry: new KnowledgeRegistry(documents, "official-publication"),
    vectorStore: new BenchmarkVectorStore(),
    indexName: INDEX_NAME,
    indexGeneration: INDEX_GENERATION,
    minimumScore: 0
  });
}

function assertNoFactualAnswer(result: KnowledgeToolResult): void {
  const answer = composeApprovedKnowledgeAnswer({
    toolResult: result,
    toolObserved: true,
    expectedQueryHash: result.queryHash
  });

  expect(answer.status).not.toBe("grounded");
  expect(answer.claims).toEqual([]);
  expect(answer.citations).toEqual([]);
  expect(answer.text).not.toMatch(/0[.,]25|50\s?000|150\s?000|\$3/iu);
}

describe("V3 governed-RAG retrieval quality acceptance gate", () => {
  it("uses standard binary-relevance metric definitions", () => {
    const metrics = evaluateRetrievalQuality([{
      retrievedIds: ["irrelevant", "relevant-a", "relevant-b"],
      relevantIds: ["relevant-a", "relevant-b"]
    }], 5);

    expect(metrics.recallAtK).toBe(1);
    expect(metrics.meanReciprocalRank).toBe(0.5);
    expect(metrics.normalizedDiscountedCumulativeGainAtK).toBeCloseTo(0.693426, 6);
  });

  it("meets Recall@5, MRR, and nDCG@5 independently for every locale/facet", async () => {
    const retrieval = retrievalService(approvedProductKnowledgeDocuments);
    const judgmentsByGroup = new Map<string, RetrievalJudgment[]>();

    for (const benchmarkCase of knowledgeRetrievalBenchmark) {
      const result = await retrieval.retrieve(
        benchmarkCase.query,
        knowledgeContext({
          locale: benchmarkCase.locale,
          asOf: AS_OF,
          requestId: `rag-quality-${benchmarkCase.id}`
        })
      );
      const retrievedIds = result.chunks.map(({ metadata }) => metadata.sourceId);

      expect(result.retrieval.facet, benchmarkCase.id).toBe(benchmarkCase.facet);
      expect(result.status, benchmarkCase.id).toBe("grounded");

      const group = `${benchmarkCase.locale}:${benchmarkCase.facet}`;
      const judgments = judgmentsByGroup.get(group) ?? [];
      judgments.push({
        retrievedIds,
        relevantIds: benchmarkCase.relevantSourceIds
      });
      judgmentsByGroup.set(group, judgments);
    }

    const corpusGroups = new Set(approvedProductKnowledgeDocuments.map(({ manifest }) =>
      `${manifest.locale}:${manifest.facets[0]}`
    ));
    expect(new Set(judgmentsByGroup.keys())).toEqual(corpusGroups);

    for (const [group, judgments] of judgmentsByGroup) {
      const metrics = evaluateRetrievalQuality(judgments, 5);
      expect(metrics.queryCount, `${group} benchmark size`).toBeGreaterThanOrEqual(3);
      expect(metrics.recallAtK, `${group} Recall@5`).toBeGreaterThanOrEqual(0.9);
      expect(metrics.meanReciprocalRank, `${group} MRR`).toBeGreaterThanOrEqual(0.9);
      expect(
        metrics.normalizedDiscountedCumulativeGainAtK,
        `${group} nDCG@5`
      ).toBeGreaterThanOrEqual(0.85);
    }
  });

  it.each([
    {
      condition: "wrong-locale",
      documents: [knowledgeDocument({ manifest: { sourceId: "fees-en-only" } })],
      context: knowledgeContext({ locale: "az-AZ", asOf: AS_OF })
    },
    {
      condition: "revoked",
      documents: [knowledgeDocument({
        manifest: {
          sourceId: "fees-revoked",
          approvalStatus: "revoked",
          revokedAt: "2026-07-21T00:00:00.000Z"
        }
      })],
      context: knowledgeContext({ asOf: AS_OF })
    },
    {
      condition: "expired",
      documents: [knowledgeDocument({
        manifest: {
          sourceId: "fees-expired",
          effectiveFrom: "2026-07-01T00:00:00.000Z",
          effectiveTo: "2026-07-21T00:00:00.000Z"
        }
      })],
      context: knowledgeContext({ asOf: AS_OF })
    }
  ])("returns no factual answer for $condition evidence", async ({ documents, context }) => {
    const result = await retrievalService(documents).retrieve(
      context.locale === "az-AZ"
        ? "Demo Invest komissiyası nə qədərdir?"
        : "What are the Demo Invest fees?",
      context as KnowledgeQueryContext
    );

    expect(result.chunks).toEqual([]);
    assertNoFactualAnswer(result);
  });

  it("blocks conflicting authorities before serving and renders conflict status without facts", () => {
    const first = knowledgeDocument({ manifest: { sourceId: "fees-authority-a" } });
    const second = knowledgeDocument({ manifest: { sourceId: "fees-authority-b" } });

    expect(() => retrievalService([first, second]))
      .toThrow(/overlapping authoritative effective windows/u);

    const safeService = retrievalService([first]);
    const conflictResult: KnowledgeToolResult = {
      ...safeService.failClosedResult(
        "What are the Demo Invest fees?",
        knowledgeContext({ asOf: AS_OF }),
        "Conflicting approved authorities"
      ),
      status: "conflicting_evidence"
    };
    assertNoFactualAnswer(conflictResult);
  });
});
