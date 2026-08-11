import { describe, expect, it } from "vitest";
import type { SecurityResearchReport } from "../src/domain/security-research.js";
import {
  canonicalizeMarketContentUrl,
  deduplicateMarketContent,
  marketContentFromResearchReports,
  type MarketContentItem
} from "../src/assistant-v3/market-content.js";
import { YAHOO_DEVELOPMENT_PROVIDER } from "../src/assistant-v3/providers.js";

const PUBLISHED_AT = "2026-07-21T12:00:00.000Z";

function content(
  id: string,
  url: string | null,
  providerId: string,
  title = "NVIDIA launches a new platform"
): MarketContentItem {
  return {
    id,
    kind: "NEWS",
    title,
    summary: null,
    url,
    canonicalUrl: canonicalizeMarketContentUrl(url),
    publishedAt: PUBLISHED_AT,
    symbols: [id === "wire-b" ? "AMD" : "NVDA"],
    attributions: [
      {
        providerId,
        sourceId: `${providerId}-news`,
        label: providerId === "wire-a" ? "Wire A" : "Wire B",
        publisher: providerId === "wire-a" ? "Wire A" : "Wire B",
        url,
        publishedAt: PUBLISHED_AT,
        licenseClass: providerId === "wire-a" ? "development-only" : "production-approved"
      }
    ],
    occurrenceCount: 1
  };
}

function researchReport(newsUrl: string): SecurityResearchReport {
  const unavailable = {
    status: "unavailable" as const,
    data: null,
    sources: [],
    unavailableFields: ["not-returned"],
    issues: []
  };
  return {
    symbol: "NVDA",
    generatedAt: PUBLISHED_AT,
    overallStatus: "partial",
    profile: unavailable,
    fundamentals: unavailable,
    valuation: unavailable,
    earnings: unavailable,
    newsAndCatalysts: {
      status: "available",
      data: {
        news: [
          {
            id: "nvda-platform",
            headline: "NVIDIA launches a new platform",
            publisher: "Example Wire",
            publishedAt: PUBLISHED_AT,
            url: newsUrl,
            relatedSymbols: ["NVDA"],
            source: "yahoo-search"
          }
        ],
        catalysts: [
          {
            id: "nvda-earnings",
            type: "earnings-date",
            title: "NVDA earnings date",
            scheduledAt: "2026-08-20T20:00:00.000Z",
            estimated: false,
            source: "yahoo-quote-summary",
            sourceUrl: "https://finance.yahoo.com/quote/NVDA"
          }
        ]
      },
      sources: [],
      unavailableFields: [],
      issues: []
    },
    priceRisk: unavailable,
    notices: []
  };
}

describe("V3 market content normalization", () => {
  it("deduplicates tracking variants and preserves every attribution", () => {
    const output = deduplicateMarketContent([
      content(
        "wire-a",
        "https://www.example.com/markets/nvda?utm_source=feed&article=42",
        "wire-a"
      ),
      content(
        "wire-b",
        "https://example.com/markets/nvda?article=42&fbclid=tracking",
        "wire-b"
      )
    ]);

    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      id: "wire-a",
      canonicalUrl: "https://example.com/markets/nvda?article=42",
      occurrenceCount: 2,
      symbols: ["NVDA", "AMD"]
    });
    expect(output[0]?.attributions).toHaveLength(2);
    expect(output[0]?.attributions.map(({ label }) => label)).toEqual(["Wire A", "Wire B"]);
    expect(output[0]?.attributions.map(({ url }) => url)).toEqual([
      "https://www.example.com/markets/nvda?utm_source=feed&article=42",
      "https://example.com/markets/nvda?article=42&fbclid=tracking"
    ]);
  });

  it("uses normalized headline plus publication day when no URL is available", () => {
    const output = deduplicateMarketContent([
      content("wire-a", null, "wire-a", "NVIDIA: launches a new platform!"),
      content("wire-b", null, "wire-b", "nvidia launches a new platform")
    ]);

    expect(output).toHaveLength(1);
    expect(output[0]?.occurrenceCount).toBe(2);
    expect(output[0]?.attributions).toHaveLength(2);
  });

  it("normalizes Yahoo news and events with development-only attribution", () => {
    const output = marketContentFromResearchReports(
      [
        researchReport("https://finance.yahoo.com/news/nvda-platform?utm_source=one"),
        researchReport("https://finance.yahoo.com/news/nvda-platform?utm_source=two")
      ],
      YAHOO_DEVELOPMENT_PROVIDER
    );

    const news = output.find(({ kind }) => kind === "NEWS");
    const event = output.find(({ kind }) => kind === "MARKET_EVENT");
    expect(news).toMatchObject({ occurrenceCount: 2, symbols: ["NVDA"] });
    expect(news?.attributions[0]).toMatchObject({
      providerId: "yahoo-finance",
      sourceId: "yahoo-search",
      label: "Example Wire",
      licenseClass: "development-only"
    });
    expect(event).toMatchObject({
      title: "NVDA earnings date",
      occurrenceCount: 2
    });
    expect(event?.attributions[0]).toMatchObject({
      sourceId: "yahoo-quote-summary",
      licenseClass: "development-only"
    });
  });
});
