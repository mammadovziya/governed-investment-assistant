import { createHash, randomUUID } from "node:crypto";
import { Mastra } from "@mastra/core/mastra";
import { withRagIngestion } from "@mastra/core/observability";
import type { ObservabilityContext } from "@mastra/core/observability";
import type { MastraUnion, ToolObserve } from "@mastra/core/tools";
import type { QueryResult } from "@mastra/core/vector";
import { MDocument } from "@mastra/rag";
import type { LibSQLVector } from "@mastra/libsql";
import type {
  ApprovedKnowledgeAnswer,
  KnowledgeAgentExecution,
  KnowledgeChunkMetadata,
  KnowledgeClaim,
  KnowledgeCitation,
  KnowledgeEvaluation,
  KnowledgeFacet,
  KnowledgeQueryContext,
  KnowledgeRetrievedChunk,
  KnowledgeToolResult
} from "../domain/knowledge.js";
import type { SupportedLocale } from "../domain/types.js";
import { operationalMetrics } from "./operational-metrics.js";
import { detectKnowledgeFacet, KnowledgeRegistry } from "./knowledge-registry.js";

const DIMENSION = 384;
const OPEN_ENDED = "9999-12-31T23:59:59.999Z";
const MAX_SELECTED_CHUNKS = 3;
export const REQUIRED_BILINGUAL_KNOWLEDGE_FACETS = Object.freeze([
  "fees",
  "account_opening",
  "funding",
  "withdrawal",
  "product",
  "market_hours",
  "purchase_process"
] as const satisfies readonly KnowledgeFacet[]);

export const REQUIRED_KNOWLEDGE_LOCALES = Object.freeze([
  "en-US",
  "az-AZ"
] as const satisfies readonly SupportedLocale[]);

export interface ApprovedKnowledgeLocaleReadiness {
  readonly locale: SupportedLocale;
  readonly eligibleDocuments: number;
  readonly coveredFacets: readonly KnowledgeFacet[];
  readonly missingFacets: readonly KnowledgeFacet[];
}

export interface ApprovedKnowledgeReadiness {
  readonly ready: boolean;
  readonly indexName: string;
  readonly indexDimension: number;
  readonly count: number;
  readonly indexedChunksExpected: number;
  readonly eligibleDocuments: number;
  readonly approvalMode: string;
  readonly requiredLocales: readonly SupportedLocale[];
  readonly requiredFacets: readonly KnowledgeFacet[];
  readonly localeCoverage: readonly ApprovedKnowledgeLocaleReadiness[];
  readonly reason?: string;
}

type LibSQLQueryInput = Parameters<LibSQLVector["query"]>[0];
type LibSQLVectorFilter = NonNullable<LibSQLQueryInput["filter"]>;

interface VectorStoreLike {
  listIndexes(): Promise<string[]>;
  describeIndex(input: { indexName: string }): Promise<{ dimension: number; count: number }>;
  createIndex(input: { indexName: string; dimension: number; metric?: "cosine" }): Promise<void>;
  upsert(input: {
    indexName: string;
    vectors: number[][];
    metadata?: Record<string, unknown>[];
    ids?: string[];
  }): Promise<string[]>;
  query(input: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter: LibSQLVectorFilter;
    includeVector: boolean;
  }): Promise<QueryResult[]>;
}

interface PreparedChunk {
  id: string;
  vector: number[];
  metadata: KnowledgeChunkMetadata;
}

export interface ApprovedKnowledgeServiceOptions {
  registry: KnowledgeRegistry;
  vectorStore: LibSQLVector | VectorStoreLike;
  indexName: string;
  indexGeneration: string;
  minimumScore?: number;
  now?: () => number;
}

const SYNONYMS: Record<string, string[]> = {
  fee: ["fees", "commission", "commissions", "tariff", "tariffs", "komissiya", "tarif"],
  withdraw: ["withdrawal", "cashout", "settlement", "məxaric", "mexaric", "çıxar", "cixar", "hesablaşma"],
  fund: ["funding", "deposit", "topup", "mədaxil", "medaxil", "maliyyələşdir"],
  account: ["register", "opening", "create", "hesab", "qeydiyyat", "imza"],
  purchase: ["buy", "buying", "bought", "purchase", "purchasing", "alış", "alis", "almaq"],
  risk: ["disclosure", "warning", "margin", "risk", "açıqlama", "aciqlama", "marja"],
  research: ["review", "weekly", "outlook", "research", "araşdırma", "arasdirma", "icmal", "həftəlik"],
  product: ["service", "investments", "product", "məhsul", "mehsul", "xidmət", "xidmet"]
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "can", "do", "does", "for", "from", "how", "i", "in",
  "is", "me", "my", "of", "on", "the", "to", "what", "with", "your", "bu", "bir", "haqqında",
  "haqqinda", "mənə", "mene", "nə", "ne", "necə", "nece", "və", "ve"
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asciiAzerbaijani(value: string): string {
  return value
    .replaceAll("ə", "e").replaceAll("Ə", "e")
    .replaceAll("ı", "i").replaceAll("İ", "i")
    .replaceAll("ş", "s").replaceAll("Ş", "s")
    .replaceAll("ç", "c").replaceAll("Ç", "c")
    .replaceAll("ğ", "g").replaceAll("Ğ", "g")
    .replaceAll("ö", "o").replaceAll("Ö", "o")
    .replaceAll("ü", "u").replaceAll("Ü", "u");
}

function tokens(value: string): string[] {
  const normalized = asciiAzerbaijani(value.normalize("NFKC").toLocaleLowerCase("en-US"));
  return normalized.match(/[\p{L}\p{N}$%]+/gu)?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [];
}

function expandedTokens(value: string): string[] {
  const base = tokens(value);
  const expanded = new Set(base);
  for (const [root, variants] of Object.entries(SYNONYMS)) {
    const normalizedVariants = variants.map(asciiAzerbaijani);
    const matchesStem = (token: string, stem: string) =>
      token === stem || (stem.length >= 5 && token.startsWith(stem));
    if (base.some((token) =>
      matchesStem(token, root) || normalizedVariants.some((variant) => matchesStem(token, variant))
    )) {
      expanded.add(root);
      for (const variant of normalizedVariants) expanded.add(variant);
    }
  }
  return [...expanded];
}

function hash32(value: string): number {
  const digest = createHash("sha256").update(value, "utf8").digest();
  return digest.readUInt32BE(0);
}

/** Deterministic feature hashing: vector retrieval without introducing a second model. */
export function deterministicKnowledgeEmbedding(value: string): number[] {
  const vector = Array.from({ length: DIMENSION }, () => 0);
  const features = expandedTokens(value);
  for (const token of features) {
    const weightedFeatures = [token, `w:${token}`, ...Array.from({ length: Math.max(0, token.length - 2) }, (_, index) => `c:${token.slice(index, index + 3)}`)];
    for (const feature of weightedFeatures) {
      const first = hash32(feature);
      const second = hash32(`sign:${feature}`);
      const index = first % DIMENSION;
      vector[index] = (vector[index] ?? 0) + (second % 2 === 0 ? 1 : -1);
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, component) => sum + component * component, 0));
  return norm === 0 ? vector : vector.map((component) => component / norm);
}

function lexicalScore(query: string, evidence: string): number {
  const queryTokens = new Set(expandedTokens(query));
  const evidenceTokens = new Set(expandedTokens(evidence));
  if (queryTokens.size === 0 || evidenceTokens.size === 0) return 0;
  let matches = 0;
  for (const token of queryTokens) if (evidenceTokens.has(token)) matches += 1;
  return matches / Math.sqrt(queryTokens.size * evidenceTokens.size);
}

function isChunkMetadata(value: unknown): value is KnowledgeChunkMetadata {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.chunkId === "string" && typeof record.sourceId === "string" &&
    typeof record.version === "string" && typeof record.text === "string" &&
    typeof record.sourceChecksumSha256 === "string" && typeof record.chunkChecksumSha256 === "string" &&
    typeof record.locale === "string" && typeof record.effectiveFrom === "string" &&
    typeof record.effectiveTo === "string" && Array.isArray(record.productScopes);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchesAuthoritativeMetadata(
  candidate: KnowledgeChunkMetadata,
  authoritative: KnowledgeChunkMetadata
): boolean {
  return candidate.chunkId === authoritative.chunkId &&
    candidate.sourceId === authoritative.sourceId &&
    candidate.version === authoritative.version &&
    candidate.documentType === authoritative.documentType &&
    candidate.title === authoritative.title &&
    candidate.url === authoritative.url &&
    candidate.locale === authoritative.locale &&
    candidate.jurisdiction === authoritative.jurisdiction &&
    sameStrings(candidate.productScopes, authoritative.productScopes) &&
    candidate.productScope === authoritative.productScope &&
    candidate.audience === authoritative.audience &&
    candidate.channel === authoritative.channel &&
    candidate.approvalStatus === authoritative.approvalStatus &&
    candidate.approvalBasis === authoritative.approvalBasis &&
    candidate.effectiveFrom === authoritative.effectiveFrom &&
    candidate.effectiveTo === authoritative.effectiveTo &&
    candidate.contentAsOf === authoritative.contentAsOf &&
    candidate.section === authoritative.section &&
    candidate.text === authoritative.text &&
    candidate.sourceChecksumSha256 === authoritative.sourceChecksumSha256 &&
    candidate.chunkChecksumSha256 === authoritative.chunkChecksumSha256 &&
    candidate.indexGeneration === authoritative.indexGeneration &&
    candidate.embeddingProfile === authoritative.embeddingProfile &&
    candidate.chunkIndex === authoritative.chunkIndex;
}

function localizedNoEvidence(locale: SupportedLocale, status: ApprovedKnowledgeAnswer["status"]): string {
  if (locale === "az-AZ") {
    return status === "dependency_unavailable"
      ? "Təsdiqlənmiş məhsul mənbələrini indi yoxlaya bilmədim. Yaddaşa əsaslanıb cavab verməyəcəyəm; zəhmət olmasa bir qədər sonra yenidən cəhd edin."
      : status === "conflicting_evidence"
        ? "Cari təsdiqlənmiş məhsul mənbələrində ziddiyyət gördüm, buna görə onlardan birini özbaşına seçməyəcəyəm. Konfiqurasiya edilmiş dəstək kanalı ilə dəqiqləşdirmək daha təhlükəsizdir."
        : "Bu sualı cavablandırmaq üçün dilinizə və Azərbaycana uyğun cari təsdiqlənmiş məhsul mənbəsi tapmadım. Təxmin etməyəcəyəm; konfiqurasiya edilmiş dəstək kanalı ilə dəqiqləşdirə bilərsiniz.";
  }
  return status === "dependency_unavailable"
    ? "I couldn’t check the approved product sources just now. I won’t answer from memory; please try again shortly."
    : status === "conflicting_evidence"
      ? "The current approved product sources conflict, so I won’t choose one on my own. It is safer to confirm this through the configured support channel."
      : "I couldn’t find a current approved product source for this question in your language and Azerbaijan jurisdiction. I won’t guess; you can confirm it through the configured support channel.";
}

function answerLead(facet: KnowledgeFacet, locale: SupportedLocale): string {
  if (locale === "az-AZ") {
    const leads: Record<KnowledgeFacet, string> = {
      fees: "Demo məhsul profilində dərc edilmiş komissiya məlumatı belədir:",
      account_opening: "İnvestisiya hesabını belə aça bilərsiniz:",
      funding: "İnvestisiya hesabına mədaxil qaydası belədir:",
      withdrawal: "Məxariclə bağlı dərc olunmuş qayda belədir:",
      product: "Konfiqurasiya edilmiş investisiya məhsulu haqqında təsdiqlənmiş məlumat:",
      risk_disclosure: "Dərc olunmuş risk açıqlaması:",
      research: "Demo məhsul profilindəki cari təsdiqlənmiş araşdırma qeydi:",
      market_hours: "Bazar saatları üzrə təsdiqlənmiş məlumat:",
      purchase_process: "Alış prosesinə dair dərc olunmuş təlimat:",
      sale_process: "Satış prosesinə dair təsdiqlənmiş məlumat:",
      asset_protection: "Aktivlərin qorunmasına dair təsdiqlənmiş məlumat:",
      custody_registration: "Qiymətli kağızların saxlanması və qeydiyyatına dair təsdiqlənmiş məlumat:",
      instrument_availability: "Mövcud investisiya alətlərinə dair təsdiqlənmiş məlumat:",
      taxation: "İnvestisiya vergilərinə dair təsdiqlənmiş məlumat:",
      corporate_actions: "Korporativ hərəkətlərə dair təsdiqlənmiş məlumat:",
      trade_restrictions: "Ticarət məhdudiyyətlərinə dair təsdiqlənmiş məlumat:",
      support_navigation: "Konfiqurasiya edilmiş dəstək kanalı üzrə təsdiqlənmiş məlumat:",
      general: "Təsdiqlənmiş məhsul mənbələrində tapdığım məlumat:"
    };
    return leads[facet];
  }
  const leads: Record<KnowledgeFacet, string> = {
    fees: "Here’s the commission information published for the demo product profile:",
    account_opening: "Here’s how the published instructions say to open an investment account:",
    funding: "Here’s the published investment-account funding guidance:",
    withdrawal: "Here’s the published withdrawal guidance:",
    product: "Here’s the approved information I found about the configured investment product:",
    risk_disclosure: "Here’s the published risk disclosure:",
    research: "Here’s the current approved research item for the demo product profile:",
    market_hours: "Here’s the approved market-hours information I found:",
    purchase_process: "Here’s the published purchase-process guidance:",
    sale_process: "Here’s the approved sale-process information I found:",
    asset_protection: "Here’s the approved asset-protection information I found:",
    custody_registration: "Here’s the approved custody and registration information I found:",
    instrument_availability: "Here’s the approved instrument-availability information I found:",
    taxation: "Here’s the approved investment-tax information I found:",
    corporate_actions: "Here’s the approved corporate-actions information I found:",
    trade_restrictions: "Here’s the approved trading-restrictions information I found:",
    support_navigation: "Here’s the approved information for the configured support channel:",
    general: "Here’s what I found in the approved product sources:"
  };
  return leads[facet];
}

function evaluation(checks: KnowledgeEvaluation["checks"]): KnowledgeEvaluation {
  const failedCheckIds = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return {
    id: "approved-knowledge-grounding",
    passed: failedCheckIds.length === 0,
    score: Number((checks.filter(({ passed }) => passed).length / checks.length).toFixed(4)),
    checks,
    failedCheckIds
  };
}

export class ApprovedKnowledgeService {
  readonly registry: KnowledgeRegistry;
  readonly indexName: string;
  readonly indexGeneration: string;
  private readonly vectorStore: VectorStoreLike;
  private readonly minimumScore: number;
  private readonly now: () => number;
  private preparedPromise?: Promise<PreparedChunk[]>;
  private indexingPromise: Promise<void> | undefined;
  private indexed = false;

  constructor(options: ApprovedKnowledgeServiceOptions) {
    this.registry = options.registry;
    this.vectorStore = options.vectorStore;
    this.indexName = options.indexName;
    this.indexGeneration = options.indexGeneration;
    this.minimumScore = options.minimumScore ?? 0.08;
    this.now = options.now ?? Date.now;
  }

  async ensureIndexed(mastra?: MastraUnion): Promise<void> {
    if (this.indexed) return;
    this.indexingPromise ??= this.runIndexing(mastra).catch((error) => {
      this.indexingPromise = undefined;
      throw error;
    });
    await this.indexingPromise;
  }

  async readiness(): Promise<ApprovedKnowledgeReadiness> {
    try {
      await this.ensureIndexed();
      const stats = await this.vectorStore.describeIndex({ indexName: this.indexName });
      const prepared = await this.preparedChunks();
      const asOf = new Date(this.now()).toISOString();
      const eligibleDocumentKeys = new Set<string>();
      const localeCoverage = REQUIRED_KNOWLEDGE_LOCALES.map((locale) => {
        const context: KnowledgeQueryContext = {
          locale,
          jurisdiction: "AZ",
          productScopes: ["DEMO_INVEST"],
          channel: "customer_chat",
          asOf,
          requestId: "readiness-probe"
        };
        const localeDocumentKeys = new Set<string>();
        const coveredFacets: KnowledgeFacet[] = [];
        for (const facet of REQUIRED_BILINGUAL_KNOWLEDGE_FACETS) {
          const facetKeys = new Set<string>();
          for (const { manifest } of this.registry.eligibleDocuments(context, facet)) {
            const key = `${manifest.sourceId}@${manifest.version}`;
            facetKeys.add(key);
            localeDocumentKeys.add(key);
            eligibleDocumentKeys.add(key);
          }
          if (
            facetKeys.size > 0 &&
            prepared.some(({ metadata }) =>
              metadata.locale === locale &&
              facetKeys.has(`${metadata.sourceId}@${metadata.version}`)
            )
          ) {
            coveredFacets.push(facet);
          }
        }
        const covered = new Set(coveredFacets);
        return {
          locale,
          eligibleDocuments: localeDocumentKeys.size,
          coveredFacets,
          missingFacets: REQUIRED_BILINGUAL_KNOWLEDGE_FACETS.filter(
            (facet) => !covered.has(facet)
          )
        };
      });
      const eligibleDocuments = eligibleDocumentKeys.size;
      const ready =
        stats.dimension === DIMENSION &&
        prepared.length > 0 &&
        stats.count >= prepared.length &&
        localeCoverage.every(
          ({ eligibleDocuments: localeDocuments, missingFacets }) =>
            localeDocuments > 0 && missingFacets.length === 0
        );
      return {
        ready,
        indexName: this.indexName,
        indexDimension: stats.dimension,
        count: stats.count,
        indexedChunksExpected: prepared.length,
        eligibleDocuments,
        approvalMode: this.registry.approvalMode,
        requiredLocales: [...REQUIRED_KNOWLEDGE_LOCALES],
        requiredFacets: [...REQUIRED_BILINGUAL_KNOWLEDGE_FACETS],
        localeCoverage,
        ...(!ready
          ? {
              reason:
                "The approved knowledge index does not cover every required bilingual pilot facet."
            }
          : {})
      };
    } catch (error) {
      return {
        ready: false,
        indexName: this.indexName,
        indexDimension: 0,
        count: 0,
        indexedChunksExpected: 0,
        eligibleDocuments: 0,
        approvalMode: this.registry.approvalMode,
        requiredLocales: [...REQUIRED_KNOWLEDGE_LOCALES],
        requiredFacets: [...REQUIRED_BILINGUAL_KNOWLEDGE_FACETS],
        localeCoverage: REQUIRED_KNOWLEDGE_LOCALES.map((locale) => ({
          locale,
          eligibleDocuments: 0,
          coveredFacets: [],
          missingFacets: [...REQUIRED_BILINGUAL_KNOWLEDGE_FACETS]
        })),
        reason: error instanceof Error ? error.message : "Knowledge index unavailable"
      };
    }
  }

  failClosedResult(
    query: string,
    context: KnowledgeQueryContext,
    reason: string
  ): KnowledgeToolResult {
    const queryHash = sha256(query.normalize("NFKC").trim());
    return {
      status: "dependency_unavailable",
      queryHash,
      locale: context.locale,
      jurisdiction: context.jurisdiction,
      chunks: [],
      retrieval: {
        traceId: randomUUID(),
        queryHash,
        indexGeneration: this.indexGeneration,
        vectorStore: "LibSQLVector",
        retrievalMethod: "mastra-chunked-hash-vector-plus-lexical-rerank",
        embeddingProfile: "deterministic-hash-384-v1",
        trustedFilter: {
          locale: context.locale,
          jurisdiction: context.jurisdiction,
          approvalStatus: "approved",
          productScopes: [...context.productScopes],
          channel: context.channel,
          asOf: context.asOf
        },
        facet: detectKnowledgeFacet(query),
        eligibleCandidateCount: 0,
        vectorCandidateCount: 0,
        selectedChunkIds: [],
        rejectedCandidateCount: 0,
        durationMs: 0
      },
      reason
    };
  }

  async retrieve(
    query: string,
    context: KnowledgeQueryContext,
    options: { mastra?: MastraUnion; observe?: ToolObserve } = {}
  ): Promise<KnowledgeToolResult> {
    const startedAt = this.now();
    const queryHash = sha256(query.normalize("NFKC").trim());
    const facet = detectKnowledgeFacet(query);
    const traceId = randomUUID();
    const baseTrace = {
      traceId,
      queryHash,
      indexGeneration: this.indexGeneration,
      vectorStore: "LibSQLVector" as const,
      retrievalMethod: "mastra-chunked-hash-vector-plus-lexical-rerank" as const,
      embeddingProfile: "deterministic-hash-384-v1" as const,
      trustedFilter: {
        locale: context.locale,
        jurisdiction: context.jurisdiction,
        approvalStatus: "approved" as const,
        productScopes: [...context.productScopes],
        channel: context.channel,
        asOf: context.asOf
      },
      facet
    };

    try {
      await this.ensureIndexed(options.mastra);
      const prepared = await this.preparedChunks();
      const eligibleDocuments = this.registry.eligibleDocuments(context, facet);
      const eligibleKeys = new Set(eligibleDocuments.map(({ manifest }) => `${manifest.sourceId}@${manifest.version}`));
      const eligibleChunks = prepared.filter(({ metadata }) =>
        eligibleKeys.has(`${metadata.sourceId}@${metadata.version}`)
      );
      if (eligibleChunks.length === 0) {
        const durationMs = Math.max(0, this.now() - startedAt);
        operationalMetrics.recordRagRetrieval({
          result: "no_evidence",
          locale: context.locale,
          facet,
          durationMs
        });
        return {
          status: "insufficient_evidence",
          queryHash,
          locale: context.locale,
          jurisdiction: context.jurisdiction,
          chunks: [],
          retrieval: {
            ...baseTrace,
            eligibleCandidateCount: 0,
            vectorCandidateCount: 0,
            selectedChunkIds: [],
            rejectedCandidateCount: 0,
            durationMs
          },
          reason: "No document passed the trusted metadata policy."
        };
      }

      const filter: LibSQLVectorFilter = {
        $and: [
          { approvalStatus: "approved" },
          { locale: context.locale },
          { jurisdiction: context.jurisdiction },
          { audience: "customer" },
          { channel: context.channel },
          { productScope: "DEMO_INVEST" },
          { sourceId: { $in: eligibleDocuments.map(({ manifest }) => manifest.sourceId) } },
          { effectiveFrom: { $lte: context.asOf } },
          { effectiveTo: { $gt: context.asOf } },
          { indexGeneration: this.indexGeneration }
        ]
      };
      const queryTask = () => this.vectorStore.query({
        indexName: this.indexName,
        queryVector: deterministicKnowledgeEmbedding(query),
        topK: Math.min(100, Math.max(20, eligibleChunks.length * 2)),
        filter,
        includeVector: false
      });
      const rawResults = options.observe
        ? await options.observe.span("rag.vector.query", queryTask, {
            indexName: this.indexName,
            locale: context.locale,
            jurisdiction: context.jurisdiction,
            approvalStatus: "approved",
            queryHash
          })
        : await queryTask();

      const preparedById = new Map(prepared.map((chunk) => [chunk.id, chunk]));
      const accepted: KnowledgeRetrievedChunk[] = [];
      let rejectedCandidateCount = 0;
      for (const result of rawResults) {
        const candidateMetadata = result.metadata;
        if (!isChunkMetadata(candidateMetadata)) {
          rejectedCandidateCount += 1;
          continue;
        }
        const authoritative = preparedById.get(result.id);
        const integrityValid = authoritative &&
          candidateMetadata.chunkId === result.id &&
          authoritative.metadata.chunkId === result.id &&
          matchesAuthoritativeMetadata(candidateMetadata, authoritative.metadata);
        if (!integrityValid || !this.registry.isChunkEligible(authoritative.metadata, context, facet)) {
          rejectedCandidateCount += 1;
          continue;
        }
        // Vector-store metadata is an untrusted search hint. All delivered
        // evidence and citation fields come from the checksum-bound registry
        // projection prepared in this process, never from the query result.
        const metadata = authoritative.metadata;
        const lexical = lexicalScore(query, `${metadata.title} ${metadata.section} ${metadata.text}`);
        const vectorScore = Number.isFinite(result.score) ? Math.max(0, result.score) : 0;
        const score = Number((0.62 * lexical + 0.38 * vectorScore).toFixed(6));
        if (lexical <= 0 || score < this.minimumScore) continue;
        accepted.push({ metadata, vectorScore, lexicalScore: lexical, score });
      }
      accepted.sort((left, right) => right.score - left.score || left.metadata.chunkId.localeCompare(right.metadata.chunkId));
      const uniqueSources = new Set<string>();
      const selected = accepted.filter(({ metadata }) => {
        if (uniqueSources.has(metadata.sourceId)) return false;
        uniqueSources.add(metadata.sourceId);
        return true;
      }).slice(0, MAX_SELECTED_CHUNKS);
      const durationMs = Math.max(0, this.now() - startedAt);
      const status = selected.length > 0 ? "grounded" : "insufficient_evidence";
      operationalMetrics.recordRagRetrieval({
        result: status === "grounded" ? "success" : "no_evidence",
        locale: context.locale,
        facet,
        durationMs
      });
      if (rejectedCandidateCount > 0) {
        operationalMetrics.recordRagRejectedCandidate({ reason: "post_filter_or_integrity" }, rejectedCandidateCount);
      }
      return {
        status,
        queryHash,
        locale: context.locale,
        jurisdiction: context.jurisdiction,
        chunks: selected,
        retrieval: {
          ...baseTrace,
          eligibleCandidateCount: eligibleChunks.length,
          vectorCandidateCount: rawResults.length,
          selectedChunkIds: selected.map(({ metadata }) => metadata.chunkId),
          rejectedCandidateCount,
          durationMs
        },
        ...(selected.length === 0 ? { reason: "No eligible passage met the relevance threshold." } : {})
      };
    } catch (error) {
      const durationMs = Math.max(0, this.now() - startedAt);
      operationalMetrics.recordRagRetrieval({
        result: "dependency_error",
        locale: context.locale,
        facet,
        durationMs
      });
      return {
        status: "dependency_unavailable",
        queryHash,
        locale: context.locale,
        jurisdiction: context.jurisdiction,
        chunks: [],
        retrieval: {
          ...baseTrace,
          eligibleCandidateCount: 0,
          vectorCandidateCount: 0,
          selectedChunkIds: [],
          rejectedCandidateCount: 0,
          durationMs
        },
        reason: error instanceof Error ? error.message : "Knowledge dependency unavailable"
      };
    }
  }

  private async runIndexing(mastra?: MastraUnion): Promise<void> {
    const ingest = async (observabilityContext?: ObservabilityContext) => {
      const prepared = await this.preparedChunks(observabilityContext);
      const indexes = await this.vectorStore.listIndexes();
      if (indexes.includes(this.indexName)) {
        const stats = await this.vectorStore.describeIndex({ indexName: this.indexName });
        if (stats.dimension !== DIMENSION || stats.count !== prepared.length) {
          throw new Error(
            `Immutable knowledge index ${this.indexName} has dimension/count ${stats.dimension}/${stats.count}; expected ${DIMENSION}/${prepared.length}. Publish a new index generation.`
          );
        }
        this.indexed = true;
        return { chunkCount: prepared.length, reused: true };
      }
      if (prepared.length === 0) throw new Error("No knowledge documents are available to index.");
      await this.vectorStore.createIndex({ indexName: this.indexName, dimension: DIMENSION, metric: "cosine" });
      await this.vectorStore.upsert({
        indexName: this.indexName,
        vectors: prepared.map(({ vector }) => vector),
        metadata: prepared.map(({ metadata }) => metadata as unknown as Record<string, unknown>),
        ids: prepared.map(({ id }) => id)
      });
      this.indexed = true;
      return { chunkCount: prepared.length, reused: false };
    };

    if (!(mastra instanceof Mastra)) {
      await ingest();
      return;
    }
    await withRagIngestion(
      {
        mastra,
        name: "Approved product knowledge ingestion",
        attributes: {
          pipelineName: "approved-product-knowledge-v1",
          sourceCount: this.registry.indexableDocuments().length,
          vectorStore: "LibSQLVector",
          indexName: this.indexName,
          embeddingModel: "deterministic-hash-384-v1",
          embeddingProvider: "local-deterministic"
        }
      },
      async (observabilityContext) => ingest(observabilityContext)
    );
  }

  private preparedChunks(observabilityContext?: ObservabilityContext): Promise<PreparedChunk[]> {
    this.preparedPromise ??= this.buildChunks(observabilityContext);
    return this.preparedPromise;
  }

  private async buildChunks(observabilityContext?: ObservabilityContext): Promise<PreparedChunk[]> {
    const result: PreparedChunk[] = [];
    for (const document of this.registry.indexableDocuments()) {
      const { manifest } = document;
      const source = MDocument.fromText(`${manifest.title}\n\n${document.content}`, {
        sourceId: manifest.sourceId,
        version: manifest.version
      });
      const chunking = { strategy: "recursive", maxSize: 900, overlap: 120 } as const;
      const chunks = observabilityContext
        ? await source.chunk(chunking, { observabilityContext })
        : await source.chunk(chunking);
      for (const [chunkIndex, chunk] of chunks.entries()) {
        const text = chunk.text.trim();
        const chunkChecksumSha256 = sha256(text);
        const chunkId = `chunk_${sha256(`${manifest.sourceId}:${manifest.version}:${chunkIndex}:${chunkChecksumSha256}`).slice(0, 32)}`;
        const metadata: KnowledgeChunkMetadata = {
          chunkId,
          sourceId: manifest.sourceId,
          version: manifest.version,
          documentType: manifest.documentType,
          title: manifest.title,
          url: manifest.url,
          locale: manifest.locale,
          jurisdiction: manifest.jurisdiction,
          productScopes: [...manifest.productScopes],
          productScope: manifest.productScopes[0] ?? "",
          audience: manifest.audience,
          channel: "customer_chat",
          approvalStatus: manifest.approvalStatus,
          approvalBasis: manifest.approvalBasis,
          effectiveFrom: manifest.effectiveFrom,
          effectiveTo: manifest.effectiveTo ?? OPEN_ENDED,
          // Policies and fee schedules do not have a research observation
          // date. Their publication timestamp is the authoritative source-as-
          // of value used by signed facts and citation freshness checks.
          contentAsOf: manifest.contentAsOf ?? manifest.publishedAt,
          section: manifest.section,
          text,
          sourceChecksumSha256: manifest.sourceChecksumSha256,
          chunkChecksumSha256,
          indexGeneration: this.indexGeneration,
          embeddingProfile: manifest.embeddingProfile,
          chunkIndex
        };
        result.push({
          id: chunkId,
          vector: deterministicKnowledgeEmbedding(`${manifest.title} ${manifest.section} ${text}`),
          metadata
        });
      }
    }
    return result;
  }
}

export function composeApprovedKnowledgeAnswer(input: {
  toolResult: KnowledgeToolResult;
  toolObserved: boolean;
  expectedQueryHash: string;
}): ApprovedKnowledgeAnswer {
  const { toolResult } = input;
  const toolValid = input.toolObserved && toolResult.queryHash === input.expectedQueryHash;
  const finalStatus = toolValid ? toolResult.status : "dependency_unavailable";
  const selectedChunkIds = new Set(toolResult.retrieval.selectedChunkIds);
  const citations: KnowledgeCitation[] = finalStatus === "grounded"
    ? toolResult.chunks.map(({ metadata }, index) => ({
        id: `source-${index + 1}`,
        chunkId: metadata.chunkId,
        sourceId: metadata.sourceId,
        version: metadata.version,
        title: metadata.title,
        documentType: metadata.documentType,
        url: metadata.url,
        locale: metadata.locale,
        jurisdiction: metadata.jurisdiction,
        effectiveFrom: metadata.effectiveFrom,
        effectiveTo: metadata.effectiveTo === OPEN_ENDED ? null : metadata.effectiveTo,
        section: metadata.section,
        excerpt: metadata.text.slice(0, 500)
      }))
    : [];
  const claims: KnowledgeClaim[] = finalStatus === "grounded"
    ? toolResult.chunks.map(({ metadata }, index) => ({
        id: `claim-${index + 1}`,
        text: metadata.text.replace(/^.*?\n\n/u, "").trim(),
        citationIds: [`source-${index + 1}`]
      }))
    : [];
  const validCitationIds = new Set(citations.map(({ id }) => id));
  const groundedPayload = finalStatus === "grounded";
  const metadataEligible = groundedPayload
    ? toolResult.chunks.length > 0 && toolResult.chunks.every(({ metadata }) =>
        selectedChunkIds.has(metadata.chunkId) &&
        metadata.approvalStatus === "approved" &&
        metadata.locale === toolResult.locale &&
        metadata.jurisdiction === toolResult.jurisdiction &&
        metadata.effectiveFrom <= toolResult.retrieval.trustedFilter.asOf &&
        metadata.effectiveTo > toolResult.retrieval.trustedFilter.asOf
      )
    : toolResult.chunks.length === 0;
  const citationCoverage = groundedPayload
    ? claims.length > 0 && citations.length > 0 && claims.every(({ citationIds }) =>
        citationIds.length > 0 && citationIds.every((id) => validCitationIds.has(id))
      )
    : claims.length === 0 && citations.length === 0;
  const citationIntegrity = groundedPayload
    ? citations.length > 0 && citations.every(({ chunkId }) => selectedChunkIds.has(chunkId))
    : citations.length === 0;
  const answerGrounding = groundedPayload
    ? claims.length > 0 && claims.every((claim, index) => {
        const evidence = toolResult.chunks[index]?.metadata.text ?? "";
        return evidence.includes(claim.text);
      })
    : claims.length === 0;
  const checks: KnowledgeEvaluation["checks"] = [
    {
      id: "required-retrieval-tool",
      passed: toolValid,
      score: toolValid ? 1 : 0,
      reason: toolValid ? "Approved Knowledge Agent used the required tool with the exact server-bound query." : "Required retrieval tool evidence or server-bound query integrity is missing."
    },
    {
      id: "metadata-eligibility",
      passed: metadataEligible,
      score: metadataEligible ? 1 : 0,
      reason: metadataEligible ? "All selected chunks satisfy approval, locale, jurisdiction, and effective-date gates." : "At least one selected chunk failed a trusted metadata gate."
    },
    {
      id: "citation-coverage",
      passed: citationCoverage,
      score: citationCoverage ? 1 : 0,
      reason: citationCoverage ? "Every delivered factual claim has a selected citation." : "At least one delivered factual claim lacks a selected citation."
    },
    {
      id: "citation-integrity",
      passed: citationIntegrity,
      score: citationIntegrity ? 1 : 0,
      reason: citationIntegrity ? "Every citation resolves to the retrieval trace." : "A citation points outside the retrieval trace."
    },
    {
      id: "answer-grounding",
      passed: answerGrounding,
      score: answerGrounding ? 1 : 0,
      reason: answerGrounding ? "Answer claims are extractive from the selected approved passages." : "The answer contains a claim not supported by selected evidence."
    }
  ];
  const embeddedEvaluation = evaluation(checks);
  operationalMetrics.recordEvaluation({
    evaluation: embeddedEvaluation.id,
    passed: embeddedEvaluation.passed,
    intent: "support"
  });
  operationalMetrics.recordRagCitationGate({ passed: embeddedEvaluation.passed });

  const text = finalStatus === "grounded" && embeddedEvaluation.passed
    ? `${answerLead(toolResult.retrieval.facet, toolResult.locale)}\n\n${claims.map((claim, index) => `${claim.text} [${index + 1}]`).join("\n\n")}`
    : localizedNoEvidence(toolResult.locale, finalStatus);
  return {
    status: finalStatus === "grounded" && !embeddedEvaluation.passed ? "dependency_unavailable" : finalStatus,
    locale: toolResult.locale,
    jurisdiction: toolResult.jurisdiction,
    text,
    claims: embeddedEvaluation.passed ? claims : [],
    citations: embeddedEvaluation.passed ? citations : [],
    retrieval: toolResult.retrieval,
    evaluation: embeddedEvaluation
  };
}

export function knowledgeAgentExecution(input: {
  observed: boolean;
  runId?: string;
  traceId?: string;
}): KnowledgeAgentExecution {
  return {
    agentId: "approved-knowledge-agent",
    toolIds: input.observed ? ["retrieve-approved-knowledge"] : [],
    executionMode: input.observed ? "agent-tool" : "fail-closed",
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {})
  };
}
