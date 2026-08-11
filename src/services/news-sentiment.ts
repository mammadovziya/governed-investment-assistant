import type { SecurityNewsItem } from "../domain/security-research.js";

export type NewsSentimentLabel = "positive" | "neutral" | "negative" | "mixed";

export interface NewsSentimentEvidence {
  newsId: string;
  headline: string;
  label: "positive" | "neutral" | "negative";
  score: -1 | 0 | 1;
  publishedAt: string;
  publisher: string | null;
  url: string;
}

export interface NewsSentimentReport {
  methodologyVersion: "headline-lexicon-v1";
  label: NewsSentimentLabel;
  normalizedScore: number;
  confidence: "low" | "medium" | "high";
  articleCount: number;
  counts: { positive: number; neutral: number; negative: number };
  windowStart: string | null;
  windowEnd: string | null;
  evidence: NewsSentimentEvidence[];
  notices: string[];
}

const POSITIVE_TERMS = [
  "beat",
  "beats",
  "boost",
  "growth",
  "higher",
  "outperform",
  "profit",
  "record",
  "rally",
  "raises",
  "strong",
  "surge",
  "upgrade",
  "wins"
] as const;

const NEGATIVE_TERMS = [
  "ban",
  "bans",
  "crash",
  "cut",
  "cuts",
  "decline",
  "delay",
  "delays",
  "downgrade",
  "dump",
  "dumped",
  "dumps",
  "drop",
  "drops",
  "falls",
  "fraud",
  "investigation",
  "laid off",
  "layoff",
  "layoffs",
  "lays off",
  "lawsuit",
  "lower",
  "lose",
  "loses",
  "loss",
  "losses",
  "lost",
  "miss",
  "misses",
  "plunge",
  "plunges",
  "probe",
  "recall",
  "risk",
  "slump",
  "weak",
  "warning"
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesTerm(headline: string, term: string): boolean {
  return new RegExp(`(?:^|[^a-z])${escapeRegExp(term)}(?:$|[^a-z])`, "iu").test(headline);
}

function classifyHeadline(headline: string): -1 | 0 | 1 {
  const positive = POSITIVE_TERMS.filter((term) => includesTerm(headline, term)).length;
  const negative = NEGATIVE_TERMS.filter((term) => includesTerm(headline, term)).length;
  if (positive === negative) return 0;
  return positive > negative ? 1 : -1;
}

function reportLabel(score: number, positive: number, negative: number): NewsSentimentLabel {
  if (positive > 0 && negative > 0 && Math.abs(score) < 0.35) return "mixed";
  if (score >= 0.2) return "positive";
  if (score <= -0.2) return "negative";
  return "neutral";
}

function normalizedHeadline(headline: string): string {
  return headline
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function sentimentConfidence(
  evidence: readonly NewsSentimentEvidence[]
): NewsSentimentReport["confidence"] {
  if (evidence.length === 0) return "low";
  const classified = evidence.filter(({ score }) => score !== 0);
  const classifiedCoverage = classified.length / evidence.length;
  const publisherDiversity = new Set(
    classified.flatMap(({ publisher }) => {
      const normalized = publisher?.trim().toLocaleLowerCase("en-US");
      return normalized ? [normalized] : [];
    })
  ).size;

  if (
    classified.length >= 6 &&
    classifiedCoverage >= 0.6 &&
    publisherDiversity >= 3
  ) {
    return "high";
  }
  if (
    classified.length >= 3 &&
    classifiedCoverage >= 0.4 &&
    publisherDiversity >= 2
  ) {
    return "medium";
  }
  return "low";
}

export function analyzeNewsSentiment(news: readonly SecurityNewsItem[]): NewsSentimentReport {
  const uniqueById = new Map<string, SecurityNewsItem>();
  for (const item of news) {
    if (!uniqueById.has(item.id)) uniqueById.set(item.id, item);
  }
  const uniqueByHeadline = new Map<string, SecurityNewsItem>();
  for (const item of [...uniqueById.values()]
    .filter((item) => Number.isFinite(Date.parse(item.publishedAt)))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))) {
    const key = normalizedHeadline(item.headline);
    if (key && !uniqueByHeadline.has(key)) uniqueByHeadline.set(key, item);
  }
  const uniqueNews = [...uniqueByHeadline.values()];
  const evidence = uniqueNews.map<NewsSentimentEvidence>((item) => {
    const score = classifyHeadline(item.headline);
    return {
      newsId: item.id,
      headline: item.headline,
      label: score > 0 ? "positive" : score < 0 ? "negative" : "neutral",
      score,
      publishedAt: item.publishedAt,
      publisher: item.publisher,
      url: item.url
    };
  });
  const positive = evidence.filter((item) => item.score > 0).length;
  const negative = evidence.filter((item) => item.score < 0).length;
  const neutral = evidence.length - positive - negative;
  const normalizedScore = evidence.length === 0
    ? 0
    : evidence.reduce((sum, item) => sum + item.score, 0) / evidence.length;
  const confidence = sentimentConfidence(evidence);

  return {
    methodologyVersion: "headline-lexicon-v1",
    label: reportLabel(normalizedScore, positive, negative),
    normalizedScore: Math.round(normalizedScore * 1_000) / 1_000,
    confidence,
    articleCount: evidence.length,
    counts: { positive, neutral, negative },
    windowStart: evidence.at(-1)?.publishedAt ?? null,
    windowEnd: evidence[0]?.publishedAt ?? null,
    evidence,
    notices: [
      "This is a transparent headline-word signal, not investor or social-media sentiment.",
      "Confidence reflects lexicon-classified headline coverage and publisher diversity, not article count alone.",
      "Headlines can be ambiguous; read the linked source articles before drawing conclusions."
    ]
  };
}
