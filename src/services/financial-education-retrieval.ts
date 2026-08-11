import { createHash } from "node:crypto";

import {
  FINANCIAL_EDUCATION_RESULT_SCHEMA_VERSION,
  type ApprovedFinancialEducationDocument,
  type FinancialEducationCitation,
  type FinancialEducationQueryContext,
  type FinancialEducationRetrievalInput,
  type FinancialEducationRetrievalPort,
  type FinancialEducationRetrievalResult,
  type RetrievedFinancialEducationProposition
} from "../domain/financial-education.js";
import { FinancialEducationRegistry } from "./financial-education-registry.js";

const EMBEDDING_DIMENSION = 384;
const MAX_QUERY_LENGTH = 2_000;
const MAX_TOP_K = 5;
const MIN_PROPOSITION_SCORE = 0;
const MAX_PROPOSITION_SCORE = 1;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "do", "does", "for",
  "from", "how", "i", "in", "is", "it", "me", "my", "of", "on", "the",
  "to", "what", "when", "with", "would", "you", "your",
  "bu", "bir", "da", "de", "haqqinda", "ile", "mene", "menim", "ne",
  "nece", "nedir", "olur", "ve"
]);

/**
 * Query expansion improves paraphrase recall only. It selects no answer and
 * carries no factual proposition.
 */
const EQUIVALENT_TERMS = [
  ["rise", "rises", "rising", "increase", "increases", "up", "art", "qalx", "yuksel"],
  ["fall", "falls", "falling", "decrease", "decreases", "down", "azal", "dus", "en"],
  ["bond", "bonds", "fixedincome", "istiqraz"],
  ["fund", "funds", "etf", "etfs", "fond"],
  ["compare", "comparison", "difference", "differ", "ferq", "muqayise"],
  [
    "expense",
    "expenses",
    "cost",
    "costs",
    "fee",
    "fees",
    "xerc",
    "haq",
    "haqq",
    "komissiya"
  ],
  ["benchmark", "index", "indeks"],
  ["duration", "muddet"],
  ["diversification", "diversified", "saxelendirme"],
  ["interest", "rate", "rates", "faiz"],
  ["price", "prices", "qiymet"],
  ["risk", "risks"]
] as const;

const PERSONALIZED_RECOMMENDATION = [
  /\bshould\s+i\s+(?:buy|sell|hold|invest|allocate|choose)\b/iu,
  /\b(?:recommend|select|choose)\b[^.!?\n]{0,80}\b(?:for\s+me|my\s+(?:portfolio|money))\b/iu,
  /\bwhere\s+should\s+i\s+invest\b/iu,
  /\bwhich\b[^.!?\n]{0,80}\bshould\s+i\s+(?:buy|choose|invest\s+in)\b/iu,
  /(?<!\p{L})(?:alım|satım|saxlayım|seçim|investisiya\s+edim)(?!\p{L})/iu,
  /(?<!\p{L})(?:mənə|mene|mənim\s+üçün|menim\s+ucun)[^.!?\n]{0,80}(?:tövsiyə|tovsiye|seç|sec)(?!\p{L})/iu,
  /(?<!\p{L})hara\s+investisiya\s+edim(?!\p{L})/iu
] as const;

interface Candidate {
  readonly document: ApprovedFinancialEducationDocument;
  readonly propositionIndex: number;
  readonly relevanceScore: number;
  readonly lexicalScore: number;
  readonly vectorScore: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeQuery(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
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

function stem(value: string): string {
  let token = value;
  const suffixes = [
    "larinin", "lerinin", "larina", "lerine", "lardan", "lerden",
    "lari", "leri", "lar", "ler", "nin", "nın", "nun", "nün",
    "dan", "den", "dir", "dır", "dur", "dür", "da", "de",
    "ing", "ed", "es", "s"
  ];
  for (const suffix of suffixes) {
    if (token.length - suffix.length >= 3 && token.endsWith(suffix)) {
      token = token.slice(0, -suffix.length);
      break;
    }
  }
  return token;
}

function canonicalToken(token: string): string {
  for (const [canonical, ...variants] of EQUIVALENT_TERMS) {
    if (
      token === stem(canonical) ||
      variants.some((variant) => token === stem(variant))
    ) {
      return canonical;
    }
  }
  return token;
}

function tokens(value: string): string[] {
  const normalized = asciiAzerbaijani(
    value.normalize("NFKC").toLocaleLowerCase("en-US")
  );
  const matched = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return matched
    .map(stem)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(canonicalToken);
}

/**
 * Preserves literal customer/document terminology for a small title-affinity
 * signal. Unlike `tokens`, this deliberately does not collapse ETF into fund,
 * so an exact ETF question prefers the approved ETF source over a merely
 * related index-fund source.
 */
function surfaceTokens(value: string): string[] {
  const normalized = asciiAzerbaijani(
    value.normalize("NFKC").toLocaleLowerCase("en-US")
  );
  return (normalized.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(stem)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function surfaceQueryCoverage(query: string, title: string): number {
  const queryTokens = new Set(surfaceTokens(query));
  const titleTokens = new Set(surfaceTokens(title));
  if (queryTokens.size === 0 || titleTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) overlap += 1;
  }
  return overlap / queryTokens.size;
}

const DEFINITION_QUERY_PATTERNS = [
  /\bwhat\s+(?:is|are)\b/iu,
  /\bwhat\s+does\b[^?]{0,120}\bmean\b/iu,
  /(?<!\p{L})(?:nədir|nedir|nə\s+deməkdir|ne\s+demekdir)(?!\p{L})/iu
] as const;

const DEFINITION_SECTION_PATTERNS = [
  /\b(?:definition|basics|structure)\b/iu,
  /(?<!\p{L})(?:tərif|terif|struktur)\p{L}*(?!\p{L})/iu
] as const;

/**
 * A small, topic-neutral ordering signal for definition-shaped questions.
 * It never supplies content or selects a financial topic; it only prefers an
 * approved proposition whose reviewed section is explicitly definitional.
 */
function definitionAffinity(query: string, section: string): number {
  if (!DEFINITION_QUERY_PATTERNS.some((pattern) => pattern.test(query))) {
    return 0;
  }
  return DEFINITION_SECTION_PATTERNS.some((pattern) => pattern.test(section))
    ? 1
    : 0;
}

function features(value: string): string[] {
  const values = new Set<string>();
  for (const token of tokens(value)) {
    values.add(`w:${token}`);
    if (token.length >= 3) {
      for (let index = 0; index <= token.length - 3; index += 1) {
        values.add(`c:${token.slice(index, index + 3)}`);
      }
    }
  }
  return [...values];
}

function hash32(value: string): number {
  return createHash("sha256").update(value, "utf8").digest().readUInt32BE(0);
}

export function deterministicFinancialEducationEmbedding(
  value: string
): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0);
  for (const feature of features(value)) {
    const index = hash32(feature) % EMBEDDING_DIMENSION;
    const sign = hash32(`sign:${feature}`) % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const norm = Math.sqrt(
    vector.reduce((sum, component) => sum + component * component, 0)
  );
  return norm === 0
    ? vector
    : vector.map((component) => component / norm);
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) return 0;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return Math.max(0, Math.min(1, dot));
}

function lexicalScore(query: string, evidence: string): number {
  const queryTokens = new Set(tokens(query));
  const evidenceTokens = new Set(tokens(evidence));
  if (queryTokens.size === 0 || evidenceTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (evidenceTokens.has(token)) overlap += 1;
  }
  const queryCoverage = overlap / queryTokens.size;
  const cosineOverlap =
    overlap / Math.sqrt(queryTokens.size * evidenceTokens.size);
  // Short customer questions such as "TWR nədir?" should not be penalized
  // merely because an approved proposition contains explanatory context.
  // Query coverage remains lexical and deterministic; at least one matching
  // content token is still required before a candidate can be selected.
  return 0.7 * queryCoverage + 0.3 * cosineOverlap;
}

function validContext(context: FinancialEducationQueryContext): boolean {
  return (
    context.requestId.trim().length >= 1 &&
    context.requestId.length <= 200 &&
    context.jurisdiction === "AZ" &&
    context.channel === "customer_chat" &&
    Number.isFinite(Date.parse(context.asOf)) &&
    new Date(context.asOf).toISOString() === context.asOf
  );
}

function citationId(input: {
  sourceId: string;
  version: string;
  propositionId: string;
}): string {
  return `financial-education-${sha256(
    `${input.sourceId}\u0000${input.version}\u0000${input.propositionId}`
  ).slice(0, 24)}`;
}

function emptyResult(input: {
  status: FinancialEducationRetrievalResult["status"];
  reasonCode: string;
  requestId: string;
  queryHash: string;
  locale: FinancialEducationQueryContext["locale"];
  authorityId: string;
  minimumScore: number;
  topK: number;
  eligibleDocumentCount?: number;
  eligiblePropositionCount?: number;
}): FinancialEducationRetrievalResult {
  return Object.freeze({
    schemaVersion: FINANCIAL_EDUCATION_RESULT_SCHEMA_VERSION,
    status: input.status,
    requestId: input.requestId,
    queryHash: input.queryHash,
    locale: input.locale,
    propositions: Object.freeze([]),
    citations: Object.freeze([]),
    retrieval: Object.freeze({
      retrievalMethod:
        "approved-corpus-deterministic-vector-plus-lexical-rerank",
      queryHash: input.queryHash,
      locale: input.locale,
      authorityId: input.authorityId,
      minimumScore: input.minimumScore,
      topK: input.topK,
      eligibleDocumentCount: input.eligibleDocumentCount ?? 0,
      eligiblePropositionCount: input.eligiblePropositionCount ?? 0,
      selectedPropositionIds: Object.freeze([])
    }),
    reasonCodes: Object.freeze([input.reasonCode])
  });
}

export class ApprovedFinancialEducationService
  implements FinancialEducationRetrievalPort {
  readonly #registry: FinancialEducationRegistry;
  readonly #minimumScore: number;
  readonly #topK: number;

  constructor(input: {
    readonly registry: FinancialEducationRegistry;
    readonly minimumScore?: number;
    readonly topK?: number;
  }) {
    const minimumScore = input.minimumScore ?? 0.2;
    const topK = input.topK ?? 3;
    if (
      !Number.isFinite(minimumScore) ||
      minimumScore <= MIN_PROPOSITION_SCORE ||
      minimumScore > MAX_PROPOSITION_SCORE
    ) {
      throw new RangeError("Financial-education minimum score is invalid.");
    }
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
      throw new RangeError("Financial-education topK is outside the approved bound.");
    }
    this.#registry = input.registry;
    this.#minimumScore = minimumScore;
    this.#topK = topK;
  }

  async retrieve(
    input: FinancialEducationRetrievalInput
  ): Promise<FinancialEducationRetrievalResult> {
    const query = normalizeQuery(input.query);
    const queryHash = sha256(query);
    const base = {
      requestId: input.context.requestId,
      queryHash,
      locale: input.context.locale,
      authorityId: this.#registry.authorityId,
      minimumScore: this.#minimumScore,
      topK: this.#topK
    };
    if (
      !validContext(input.context) ||
      query.length < 1 ||
      query.length > MAX_QUERY_LENGTH ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(query)
    ) {
      return emptyResult({
        ...base,
        status: "insufficient_evidence",
        reasonCode: "invalid_query_or_context"
      });
    }
    if (PERSONALIZED_RECOMMENDATION.some((pattern) => pattern.test(query))) {
      return emptyResult({
        ...base,
        status: "not_permitted",
        reasonCode: "personalized_recommendation_not_permitted"
      });
    }

    try {
      const documents = this.#registry.eligibleDocuments(input.context);
      const eligiblePropositionCount = documents.reduce(
        (count, document) => count + document.propositions.length,
        0
      );
      if (documents.length === 0) {
        return emptyResult({
          ...base,
          status: "insufficient_evidence",
          reasonCode: "no_eligible_approved_documents",
          eligibleDocumentCount: 0,
          eligiblePropositionCount: 0
        });
      }
      const queryVector = deterministicFinancialEducationEmbedding(query);
      const candidates: Candidate[] = [];
      for (const document of documents) {
        for (
          let propositionIndex = 0;
          propositionIndex < document.propositions.length;
          propositionIndex += 1
        ) {
          const proposition = document.propositions[propositionIndex]!;
          const evidence = [
            document.manifest.title,
            proposition.section,
            proposition.text
          ].join(" ");
          const lexical = lexicalScore(query, evidence);
          const vector = cosine(
            queryVector,
            deterministicFinancialEducationEmbedding(evidence)
          );
          const titleAffinity = surfaceQueryCoverage(
            query,
            document.manifest.title
          );
          const definitionSignal = definitionAffinity(
            query,
            proposition.section
          );
          const score = Number((
            0.53 * lexical +
            0.25 * vector +
            0.14 * titleAffinity +
            0.08 * definitionSignal
          ).toFixed(6));
          if (lexical <= 0 || score < this.#minimumScore) continue;
          candidates.push({
            document,
            propositionIndex,
            relevanceScore: score,
            lexicalScore: Number(lexical.toFixed(6)),
            vectorScore: Number(vector.toFixed(6))
          });
        }
      }
      candidates.sort((left, right) =>
        right.relevanceScore - left.relevanceScore ||
        left.document.manifest.sourceId.localeCompare(
          right.document.manifest.sourceId
        ) ||
        left.propositionIndex - right.propositionIndex
      );
      const selected = candidates.slice(0, this.#topK);
      if (selected.length === 0) {
        return emptyResult({
          ...base,
          status: "insufficient_evidence",
          reasonCode: "below_relevance_threshold",
          eligibleDocumentCount: documents.length,
          eligiblePropositionCount
        });
      }

      const propositions: RetrievedFinancialEducationProposition[] = [];
      const citations: FinancialEducationCitation[] = [];
      for (const candidate of selected) {
        const document = candidate.document;
        const proposition = document.propositions[candidate.propositionIndex]!;
        const id = citationId({
          sourceId: document.manifest.sourceId,
          version: document.manifest.version,
          propositionId: proposition.propositionId
        });
        propositions.push(Object.freeze({
          propositionId: proposition.propositionId,
          text: proposition.text,
          locale: document.manifest.locale,
          sourceId: document.manifest.sourceId,
          sourceVersion: document.manifest.version,
          relevanceScore: candidate.relevanceScore,
          lexicalScore: candidate.lexicalScore,
          vectorScore: candidate.vectorScore,
          citationId: id
        }));
        citations.push(Object.freeze({
          citationId: id,
          propositionId: proposition.propositionId,
          sourceId: document.manifest.sourceId,
          version: document.manifest.version,
          translationGroupId: document.manifest.translationGroupId,
          title: document.manifest.title,
          sourceUrl: document.manifest.sourceUrl,
          locale: document.manifest.locale,
          jurisdiction: document.manifest.jurisdiction,
          section: proposition.section,
          excerpt: proposition.text,
          publishedAt: document.manifest.publishedAt,
          effectiveFrom: document.manifest.effectiveFrom,
          effectiveTo: document.manifest.effectiveTo,
          reviewedAt: document.manifest.reviewedAt,
          reviewDueAt: document.manifest.reviewDueAt,
          contentSha256: document.manifest.contentSha256
        }));
      }

      return Object.freeze({
        schemaVersion: FINANCIAL_EDUCATION_RESULT_SCHEMA_VERSION,
        status: "grounded",
        requestId: input.context.requestId,
        queryHash,
        locale: input.context.locale,
        propositions: Object.freeze(propositions),
        citations: Object.freeze(citations),
        retrieval: Object.freeze({
          retrievalMethod:
            "approved-corpus-deterministic-vector-plus-lexical-rerank",
          queryHash,
          locale: input.context.locale,
          authorityId: this.#registry.authorityId,
          minimumScore: this.#minimumScore,
          topK: this.#topK,
          eligibleDocumentCount: documents.length,
          eligiblePropositionCount,
          selectedPropositionIds: Object.freeze(
            propositions.map(({ propositionId }) => propositionId)
          )
        }),
        reasonCodes: Object.freeze(["approved_evidence_retrieved"])
      });
    } catch {
      return emptyResult({
        ...base,
        status: "dependency_unavailable",
        reasonCode: "approved_education_dependency_unavailable"
      });
    }
  }
}
