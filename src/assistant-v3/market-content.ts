import type { SecurityResearchReport } from "../domain/security-research.js";
import type {
  ProviderLicenseClass,
  PublicProviderDescriptor
} from "./providers.js";

export type MarketContentKind = "NEWS" | "MARKET_EVENT";

export interface MarketContentAttribution {
  providerId: string;
  sourceId: string;
  label: string;
  publisher: string | null;
  url: string | null;
  publishedAt: string;
  licenseClass: ProviderLicenseClass;
}

export interface MarketContentItem {
  id: string;
  kind: MarketContentKind;
  title: string;
  summary: string | null;
  url: string | null;
  canonicalUrl: string | null;
  publishedAt: string;
  symbols: string[];
  attributions: MarketContentAttribution[];
  occurrenceCount: number;
}

const TRACKING_QUERY_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "guccounter",
  "guce_referrer",
  "guce_referrer_sig",
  "ref",
  "source"
]);

function validDate(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function normalizedTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Canonicalize only for deduplication; original URLs remain in attribution. */
export function canonicalizeMarketContentUrl(value: string | null): string | null {
  if (!value?.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_QUERY_PARAMETERS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString();
}

function contentKey(item: MarketContentItem): string {
  if (item.kind === "NEWS" && item.canonicalUrl) {
    return `NEWS|url|${item.canonicalUrl}`;
  }
  const day = new Date(item.publishedAt).toISOString().slice(0, 10);
  return `${item.kind}|title|${normalizedTitle(item.title)}|${day}`;
}

function attributionKey(attribution: MarketContentAttribution): string {
  return [
    attribution.providerId,
    attribution.sourceId,
    attribution.publisher ?? "",
    attribution.url ?? "",
    attribution.publishedAt
  ].join("|");
}

function mergeAttributions(
  left: readonly MarketContentAttribution[],
  right: readonly MarketContentAttribution[]
): MarketContentAttribution[] {
  const merged = new Map<string, MarketContentAttribution>();
  for (const attribution of [...left, ...right]) {
    const key = attributionKey(attribution);
    if (!merged.has(key)) merged.set(key, attribution);
  }
  return [...merged.values()];
}

function normalizeItem(item: MarketContentItem): MarketContentItem {
  const title = item.title.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!title) throw new TypeError("Market content title is required.");
  if (!validDate(item.publishedAt)) {
    throw new TypeError("Market content publishedAt must be a valid timestamp.");
  }
  const url = item.url?.trim() || null;
  const occurrenceCount =
    Number.isFinite(item.occurrenceCount) && item.occurrenceCount > 0
      ? Math.floor(item.occurrenceCount)
      : 1;
  return {
    ...item,
    title,
    summary: item.summary?.normalize("NFKC").replace(/\s+/gu, " ").trim() || null,
    url,
    canonicalUrl: canonicalizeMarketContentUrl(url),
    publishedAt: new Date(item.publishedAt).toISOString(),
    symbols: [...new Set(item.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))],
    attributions: mergeAttributions([], item.attributions),
    occurrenceCount
  };
}

/**
 * Dedupe syndicated market/news items while retaining every distinct provider
 * attribution. First-seen display copy is stable; attribution is never replaced.
 */
export function deduplicateMarketContent(
  content: readonly MarketContentItem[]
): MarketContentItem[] {
  const deduplicated = new Map<string, MarketContentItem>();
  for (const rawItem of content) {
    const item = normalizeItem(rawItem);
    const key = contentKey(item);
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, item);
      continue;
    }

    deduplicated.set(key, {
      ...existing,
      summary: existing.summary ?? item.summary,
      symbols: [...new Set([...existing.symbols, ...item.symbols])],
      attributions: mergeAttributions(existing.attributions, item.attributions),
      occurrenceCount: existing.occurrenceCount + item.occurrenceCount
    });
  }
  return [...deduplicated.values()];
}

function newsItems(
  report: SecurityResearchReport,
  provider: PublicProviderDescriptor
): MarketContentItem[] {
  return (report.newsAndCatalysts.data?.news ?? []).map((news) => ({
    id: news.id,
    kind: "NEWS",
    title: news.headline,
    summary: null,
    url: news.url,
    canonicalUrl: canonicalizeMarketContentUrl(news.url),
    publishedAt: news.publishedAt,
    symbols: news.relatedSymbols,
    attributions: [
      {
        providerId: provider.id,
        sourceId: news.source,
        label: news.publisher ?? provider.displayName,
        publisher: news.publisher,
        url: news.url,
        publishedAt: news.publishedAt,
        licenseClass: provider.licenseClass
      }
    ],
    occurrenceCount: 1
  }));
}

function catalystItems(
  report: SecurityResearchReport,
  provider: PublicProviderDescriptor
): MarketContentItem[] {
  return (report.newsAndCatalysts.data?.catalysts ?? []).map((catalyst) => ({
    id: catalyst.id,
    kind: "MARKET_EVENT",
    title: catalyst.title,
    summary: null,
    url: catalyst.sourceUrl,
    canonicalUrl: canonicalizeMarketContentUrl(catalyst.sourceUrl),
    publishedAt: catalyst.scheduledAt,
    symbols: [report.symbol],
    attributions: [
      {
        providerId: provider.id,
        sourceId: catalyst.source,
        label: provider.displayName,
        publisher: provider.displayName,
        url: catalyst.sourceUrl,
        publishedAt: catalyst.scheduledAt,
        licenseClass: provider.licenseClass
      }
    ],
    occurrenceCount: 1
  }));
}

/** Normalize and dedupe content already returned by public research providers. */
export function marketContentFromResearchReports(
  reports: readonly SecurityResearchReport[],
  provider: PublicProviderDescriptor
): MarketContentItem[] {
  return deduplicateMarketContent(
    reports.flatMap((report) => [
      ...newsItems(report, provider),
      ...catalystItems(report, provider)
    ])
  );
}
