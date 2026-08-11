import { describe, expect, it } from "vitest";

import {
  classifyV3ReviewedNoToolTurn,
  deriveV3DirectPortfolioAllocationArguments,
  expectedV3DirectToolForQuery,
  reviewedV3StudioNoToolResponse
} from "../src/assistant-v3/direct-no-tool.js";

describe("reviewed direct Studio no-tool responses", () => {
  it.each([
    [
      "Should I rebalance this quarter or annually?",
      null
    ],
    [
      "What allocation should I set if I want growth but not too volatile?",
      "allocation_clarification"
    ],
    [
      "What’s the current yield of this bond fund/ETF?",
      "instrument_clarification"
    ],
    [
      "Where is this company listed?",
      "instrument_clarification"
    ],
    [
      "Thanks, that helped.",
      "gratitude"
    ],
    [
      "Mene nece komek ede bilersen?",
      "capability_overview"
    ],
    [
      "Bunu daha sade izah et.",
      "simplify_follow_up"
    ]
  ] as const)("classifies %s", (query, expected) => {
    expect(classifyV3ReviewedNoToolTurn(query)).toBe(expected);
  });

  it("routes rebalancing education through retrieval instead of a ready no-tool answer", () => {
    const query = "Should I rebalance this quarter or annually?";

    expect(classifyV3ReviewedNoToolTurn(query)).toBeNull();
    expect(reviewedV3StudioNoToolResponse({
      query,
      locale: "en-US"
    })).toBeNull();
    expect(expectedV3DirectToolForQuery(query)).toBe(
      "retrieve-reviewed-investment-education"
    );
  });

  it("renders compact reviewed EN/AZ responses without accepting unrelated turns", () => {
    const english = reviewedV3StudioNoToolResponse({
      query: "What’s the current yield of this bond fund/ETF?",
      locale: "en-US"
    });
    const azerbaijani = reviewedV3StudioNoToolResponse({
      query: "Bu ETF-in gəlirliliyi nə qədərdir?",
      locale: "az-AZ"
    });
    expect(english).toContain("exact ticker");
    expect(english).toContain("won’t reuse");
    expect(azerbaijani).toContain("dəqiq tickeri");
    expect(reviewedV3StudioNoToolResponse({
      query: "What is the current NVDA price?",
      locale: "en-US"
    })).toBeNull();
    expect(reviewedV3StudioNoToolResponse({
      query: "Thanks!",
      locale: "en-US",
      modelText: "You’re welcome—I’m glad I could help."
    })).toBe("You’re welcome—I’m glad I could help.");
    expect(reviewedV3StudioNoToolResponse({
      query: "Thanks!",
      locale: "en-US",
      modelText: "You’re welcome. NVDA is $203."
    })).toContain("next investment question");
  });

  it.each([
    ["Where is A listed?", "resolve-instrument"],
    ["What is the current NVDA price?", "read-market-snapshot"],
    ["What is NVDA's P/E ratio (TTM and forward)?", "read-instrument-research"],
    ["How risky is NVDA compared with SPY?", "read-instrument-research"],
    ["Latest NVDA news", "read-market-content"],
    ["Show NVDA over 10 years", "read-price-history"],
    ["What is the current NVDA price in AZN?", "convert-currency"],
    ["NVDA-nın cari qiymətini AZN ilə göstər", "convert-currency"],
    ["What is the value of my portfolio in AZN?", "convert-currency"],
    ["Convert it into AZN", "convert-currency"],
    ["Convert 100 USD to AZN", "convert-currency"],
    ["Onu AZN-ə çevir", "convert-currency"],
    ["Portfelimin AZN ilə cari dəyəri nə qədərdir?", "convert-currency"],
    ["Portfelimin cari deyerini AZN ile goster", "convert-currency"],
    ["Portfelimin cari dəyərini manatla göstər", "convert-currency"],
    ["Portfelimin cari dəyərini manat ilə göstər", "convert-currency"],
    ["Portfelimin dəyərini Azərbaycan manatı ilə göstər", "convert-currency"],
    ["Portfelimin AZN ekvivalentini göstər", "convert-currency"],
    ["What is in my portfolio?", "read-portfolio-snapshot"],
    [
      "What are the biggest risks in this portfolio?",
      "analyze-portfolio-allocation"
    ],
    [
      "If you were my investment advisor, what would you change in this portfolio?",
      "analyze-portfolio-allocation"
    ],
    [
      "Lets assume I have a portfolio worth $20,000: 40% Tesla, 30% NVIDIA, 20% Microsoft, 10% cash. Analyze my allocation.",
      "analyze-portfolio-allocation"
    ],
    ["Show my latest 5 NVDA trades", "read-portfolio-activity"],
    ["How do Demo Invest fees work?", "retrieve-approved-product-knowledge"],
    [
      "Should I rebalance quarterly?",
      "retrieve-reviewed-investment-education"
    ],
    ["TWR nədir?", "retrieve-reviewed-investment-education"],
    ["What is TWR?", "retrieve-reviewed-investment-education"],
    ["What does bond duration mean?", "retrieve-reviewed-investment-education"],
    ["Mənim TWR-im nədir?", "read-portfolio-snapshot"],
    ["What is the yield of this ETF?", null],
    ["Thanks!", null],
    ["What can you help me with?", null],
    ["Bunu daha sade izah et.", null]
  ] as const)("selects %s", (query, toolId) => {
    expect(expectedV3DirectToolForQuery(query)).toBe(toolId);
  });

  it("derives exact current and strictly parsed hypothetical allocation-analysis arguments", () => {
    for (const query of [
      "What are the biggest risks in this portfolio?",
      "If you were my investment advisor, what would you change in this portfolio?"
    ]) {
      expect(classifyV3ReviewedNoToolTurn(query)).toBeNull();
      expect(deriveV3DirectPortfolioAllocationArguments(query)).toEqual({
        scope: "current"
      });
    }

    const hypothetical =
      "Lets assume I have a portfolio worth $20,000: 40% Tesla, 30% NVIDIA, 20% Microsoft, 10% cash. Analyze my allocation.";
    expect(classifyV3ReviewedNoToolTurn(hypothetical)).toBeNull();
    expect(deriveV3DirectPortfolioAllocationArguments(hypothetical)).toEqual({
      scope: "hypothetical",
      currency: "USD",
      totalValue: "20000.00000000",
      allocations: [
        {
          label: "Tesla",
          symbol: "TSLA",
          category: "Consumer discretionary",
          theme: "technology-dependent",
          allocationRate: "0.40000000",
          amount: "8000.00000000"
        },
        {
          label: "NVIDIA",
          symbol: "NVDA",
          category: "Technology",
          theme: "technology",
          allocationRate: "0.30000000",
          amount: "6000.00000000"
        },
        {
          label: "Microsoft",
          symbol: "MSFT",
          category: "Technology",
          theme: "technology",
          allocationRate: "0.20000000",
          amount: "4000.00000000"
        },
        {
          label: "Cash",
          symbol: null,
          category: "Cash",
          theme: "cash",
          allocationRate: "0.10000000",
          amount: "2000.00000000"
        }
      ]
    });
    expect(deriveV3DirectPortfolioAllocationArguments(
      "A portfolio worth $20,000: 40% Tesla, 30% NVIDIA, 20% Microsoft."
    )).toBeNull();
  });
});
