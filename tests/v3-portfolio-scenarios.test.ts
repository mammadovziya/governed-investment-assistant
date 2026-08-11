import { describe, expect, it } from "vitest";

import {
  parseHypotheticalPortfolioScenario,
  parseHypotheticalPositionScenario,
  projectHypotheticalPortfolioAnalysis
} from "../src/assistant-v3/portfolio-scenarios.js";

describe("V3 user-supplied hypothetical scenario parsing", () => {
  it("accepts a complete percentage allocation and derives concentration", () => {
    const parsed = parseHypotheticalPortfolioScenario(
      "Imagine my portfolio is 60% NVDA, 20% AAPL, 20% cash."
    );

    expect(parsed).toMatchObject({
      status: "supported",
      scenario: {
        totalValue: null,
        allocations: [
          expect.objectContaining({ symbol: "NVDA", allocationRate: "0.60000000" }),
          expect.objectContaining({ symbol: "AAPL", allocationRate: "0.20000000" }),
          expect.objectContaining({ symbol: null, allocationRate: "0.20000000" })
        ]
      }
    });
    if (parsed.status !== "supported") throw new Error("Expected a supported scenario.");
    expect(projectHypotheticalPortfolioAnalysis(parsed.scenario).analysis).toEqual({
      largestPosition: "NVDA",
      largestAllocationRate: "0.60000000",
      topTwoAllocationRate: "0.80000000",
      technologyAndTechnologyDependentRate: "0.80000000",
      cashAllocationRate: "0.20000000",
      recommendationAllowed: false
    });
  });

  it("derives exact dollar amounts when a total value is supplied", () => {
    expect(parseHypotheticalPortfolioScenario(
      "Portfolio worth $20,000: 40% Tesla, 30% NVIDIA, 20% Microsoft, 10% cash."
    )).toMatchObject({
      status: "supported",
      scenario: {
        totalValue: "20000.00000000",
        allocations: [
          expect.objectContaining({ symbol: "TSLA", amount: "8000.00000000" }),
          expect.objectContaining({ symbol: "NVDA", amount: "6000.00000000" }),
          expect.objectContaining({ symbol: "MSFT", amount: "4000.00000000" }),
          expect.objectContaining({ symbol: null, amount: "2000.00000000" })
        ]
      }
    });
  });

  it("accepts an Azerbaijani cash label", () => {
    expect(parseHypotheticalPortfolioScenario(
      "Hipotetik portfel bölgüsü: 60% NVDA, 20% AAPL və 20% nağd vəsait."
    )).toMatchObject({
      status: "supported",
      scenario: {
        allocations: [
          expect.objectContaining({ symbol: "NVDA" }),
          expect.objectContaining({ symbol: "AAPL" }),
          expect.objectContaining({ symbol: null, label: "Cash" })
        ]
      }
    });
  });

  it.each([
    "My portfolio is 60% NVDA, 20% AAPL, 10% cash.",
    "My portfolio is 60% NVDA and 40% AAPL."
  ])("rejects an incomplete or non-cash allocation: %s", (message) => {
    expect(parseHypotheticalPortfolioScenario(message).status).toBe("invalid");
  });

  it("requires both share count and purchase price for a position comparison", () => {
    expect(parseHypotheticalPositionScenario(
      "Assume I own 15 shares of NVDA bought at $170 each.",
      "NVDA"
    )).toMatchObject({
      status: "supported",
      scenario: {
        symbol: "NVDA",
        quantity: "15.00000000",
        unitCost: "170.00000000"
      }
    });
    expect(parseHypotheticalPositionScenario(
      "Assume I own NVDA.",
      "NVDA"
    )).toMatchObject({ status: "not-present" });
  });

  it("accepts a reviewed Azerbaijani hypothetical position shape", () => {
    const message =
      "Fərz et ki, 15 NVDA səhmi almışam, alış qiyməti səhm başına $170-dir. Daha çox alım, saxlayım, yoxsa satım?";
    expect(parseHypotheticalPositionScenario(message, "NVDA")).toMatchObject({
      status: "supported",
      scenario: {
        symbol: "NVDA",
        quantity: "15.00000000",
        unitCost: "170.00000000"
      }
    });
  });
});
