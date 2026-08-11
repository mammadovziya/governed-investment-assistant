import type { QueryResult } from "@mastra/core/vector";

interface StoredVector {
  readonly id: string;
  readonly vector: readonly number[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface StoredIndex {
  readonly dimension: number;
  readonly records: Map<string, StoredVector>;
}

type FilterRecord = Readonly<Record<string, unknown>>;

function plainRecord(value: unknown): value is FilterRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function comparable(value: unknown): value is string | number {
  return typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value));
}

function comparison(actual: unknown, operator: string, expected: unknown): boolean {
  if (operator === "$in") {
    return Array.isArray(expected) && expected.some((item) => Object.is(item, actual));
  }
  if (!comparable(actual) || !comparable(expected) || typeof actual !== typeof expected) {
    return false;
  }
  if (operator === "$lte") return actual <= expected;
  if (operator === "$gt") return actual > expected;
  return false;
}

function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (!plainRecord(expected)) return Object.is(actual, expected);
  const entries = Object.entries(expected);
  return entries.length > 0 && entries.every(([operator, value]) =>
    comparison(actual, operator, value)
  );
}

/**
 * Evaluates only the reviewed metadata operators emitted by
 * ApprovedKnowledgeService. Unknown logical or comparison operators fail
 * closed instead of becoming an arbitrary vector-filter surface.
 */
function metadataMatches(metadata: FilterRecord, filter: unknown): boolean {
  if (!plainRecord(filter)) return false;
  return Object.entries(filter).every(([field, expected]) => {
    if (field === "$and") {
      return Array.isArray(expected) && expected.length > 0 &&
        expected.every((condition) => metadataMatches(metadata, condition));
    }
    if (field.startsWith("$")) return false;
    return fieldMatches(metadata[field], expected);
  });
}

function safeIndexName(value: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,62}$/u.test(value)) {
    throw new Error("Private Studio knowledge index name is invalid.");
  }
  return value;
}

function finiteVector(value: readonly number[], dimension: number): boolean {
  return value.length === dimension && value.every((component) => Number.isFinite(component));
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * Process-memory vector port used only by the loopback Studio component
 * harness. It persists approved document chunks only for the process lifetime
 * and never stores queries, principals, messages, responses, or customer data.
 */
export class V3PrivateStudioKnowledgeVectorStore {
  readonly #indexes = new Map<string, StoredIndex>();

  async listIndexes(): Promise<string[]> {
    return [...this.#indexes.keys()].sort();
  }

  async describeIndex(input: {
    indexName: string;
  }): Promise<{ dimension: number; count: number }> {
    const index = this.#requiredIndex(input.indexName);
    return { dimension: index.dimension, count: index.records.size };
  }

  async createIndex(input: {
    indexName: string;
    dimension: number;
    metric?: "cosine";
  }): Promise<void> {
    const indexName = safeIndexName(input.indexName);
    if (!Number.isSafeInteger(input.dimension) || input.dimension <= 0) {
      throw new Error("Private Studio knowledge vector dimension is invalid.");
    }
    if (input.metric !== undefined && input.metric !== "cosine") {
      throw new Error("Private Studio knowledge vectors support cosine distance only.");
    }
    const current = this.#indexes.get(indexName);
    if (current && current.dimension !== input.dimension) {
      throw new Error("Private Studio knowledge index dimension changed.");
    }
    if (!current) {
      this.#indexes.set(indexName, {
        dimension: input.dimension,
        records: new Map()
      });
    }
  }

  async upsert(input: {
    indexName: string;
    vectors: number[][];
    metadata?: Record<string, unknown>[];
    ids?: string[];
  }): Promise<string[]> {
    const index = this.#requiredIndex(input.indexName);
    const ids = input.ids ?? input.vectors.map((_, offset) => `studio-vector-${offset}`);
    if (
      ids.length !== input.vectors.length ||
      (input.metadata !== undefined && input.metadata.length !== input.vectors.length)
    ) {
      throw new Error("Private Studio vector batches must have equal lengths.");
    }
    for (const [offset, vector] of input.vectors.entries()) {
      const id = ids[offset];
      const metadata = input.metadata?.[offset] ?? {};
      if (!id || !finiteVector(vector, index.dimension) || !plainRecord(metadata)) {
        throw new Error("Private Studio knowledge vector input is invalid.");
      }
      index.records.set(id, Object.freeze({
        id,
        vector: Object.freeze([...vector]),
        metadata: Object.freeze(structuredClone(metadata))
      }));
    }
    return [...ids];
  }

  async query(input: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter: Record<string, unknown>;
    includeVector: boolean;
  }): Promise<QueryResult[]> {
    const index = this.#requiredIndex(input.indexName);
    if (
      !finiteVector(input.queryVector, index.dimension) ||
      !Number.isSafeInteger(input.topK) ||
      input.topK <= 0 ||
      input.topK > 100
    ) {
      throw new Error("Private Studio knowledge query is invalid.");
    }
    return [...index.records.values()]
      .filter(({ metadata }) => metadataMatches(metadata, input.filter))
      .map(({ id, vector, metadata }) => ({
        id,
        score: cosine(vector, input.queryVector),
        metadata: structuredClone(metadata),
        ...(input.includeVector ? { vector: [...vector] } : {})
      }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, input.topK);
  }

  clear(): void {
    this.#indexes.clear();
  }

  #requiredIndex(rawIndexName: string): StoredIndex {
    const indexName = safeIndexName(rawIndexName);
    const index = this.#indexes.get(indexName);
    if (!index) throw new Error(`Private Studio knowledge index ${indexName} is unavailable.`);
    return index;
  }
}
