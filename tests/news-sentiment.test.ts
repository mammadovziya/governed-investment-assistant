import { describe, expect, it } from "vitest";
import type { SecurityNewsItem } from "../src/domain/security-research.js";
import { analyzeNewsSentiment } from "../src/services/news-sentiment.js";

function item(
  id: string,
  headline: string,
  day: number,
  publisher = "Test Wire"
): SecurityNewsItem {
  return {
    id,
    headline,
    publisher,
    publishedAt: new Date(Date.UTC(2026, 6, day)).toISOString(),
    url: `https://example.com/${id}`,
    relatedSymbols: ["NVDA"],
    source: "yahoo-search"
  };
}

describe("analyzeNewsSentiment", () => {
  it("returns a transparent, timestamped headline signal", () => {
    const report = analyzeNewsSentiment([
      item("1", "Company beats expectations with record growth", 3),
      item("2", "Analyst upgrade follows strong results", 2),
      item("3", "Company schedules annual meeting", 1)
    ]);

    expect(report.label).toBe("positive");
    expect(report.counts).toEqual({ positive: 2, neutral: 1, negative: 0 });
    expect(report.confidence).toBe("low");
    expect(report.windowEnd).toBe(new Date(Date.UTC(2026, 6, 3)).toISOString());
    expect(report.notices[0]).toMatch(/headline-word/i);
  });

  it("reports mixed opposing signals and removes duplicate IDs", () => {
    const positive = item("1", "Strong growth and profit beat", 3);
    const report = analyzeNewsSentiment([
      positive,
      positive,
      item("2", "Warning follows weak outlook and downgrade", 2)
    ]);

    expect(report.articleCount).toBe(2);
    expect(report.label).toBe("mixed");
    expect(report.normalizedScore).toBe(0);
  });

  it("recognizes obvious downside language from transcript-shaped headlines", () => {
    const report = analyzeNewsSentiment([
      item("1", "Company announces layoffs after weak demand", 4),
      item("2", "Chipmaker lost a major customer contract", 3),
      item("3", "Large holder dumps stock as risk rises", 2)
    ]);

    expect(report.label).toBe("negative");
    expect(report.counts).toEqual({ positive: 0, neutral: 0, negative: 3 });
    expect(report.evidence.map(({ score }) => score)).toEqual([-1, -1, -1]);
  });

  it("bases confidence on classified coverage and source diversity, not volume alone", () => {
    const neutralVolume = analyzeNewsSentiment(
      Array.from({ length: 10 }, (_, index) =>
        item(
          `neutral-${index}`,
          `Company schedules routine event number ${index}`,
          11 - index,
          `Publisher ${index % 4}`
        )
      )
    );
    const classifiedDiverse = analyzeNewsSentiment([
      item("1", "Record profit beats forecasts", 9, "Wire A"),
      item("2", "Demand growth drives shares higher", 8, "Wire B"),
      item("3", "Analyst upgrade follows strong quarter", 7, "Wire C"),
      item("4", "Product wins boost outlook", 6, "Wire A"),
      item("5", "Revenue miss triggers downgrade", 5, "Wire B"),
      item("6", "Weak demand warning prompts drop", 4, "Wire C"),
      item("7", "Company schedules annual meeting", 3, "Wire A"),
      item("8", "Board publishes meeting agenda", 2, "Wire B")
    ]);

    expect(neutralVolume.articleCount).toBe(10);
    expect(neutralVolume.confidence).toBe("low");
    expect(classifiedDiverse.confidence).toBe("high");
    expect(classifiedDiverse.notices).toEqual(
      expect.arrayContaining([expect.stringMatching(/not article count alone/i)])
    );
  });

  it("does not inflate confidence with syndicated duplicate headlines", () => {
    const report = analyzeNewsSentiment([
      item("wire-a", "Company beats estimates with record profit", 3, "Wire A"),
      item("wire-b", "Company beats estimates with record profit", 2, "Wire B")
    ]);

    expect(report.articleCount).toBe(1);
    expect(report.counts.positive).toBe(1);
    expect(report.confidence).toBe("low");
  });

  it("does not fabricate a signal when no articles are available", () => {
    expect(analyzeNewsSentiment([])).toMatchObject({
      label: "neutral",
      normalizedScore: 0,
      confidence: "low",
      articleCount: 0,
      windowStart: null,
      windowEnd: null
    });
  });
});
