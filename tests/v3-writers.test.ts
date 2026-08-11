import type { Agent } from "@mastra/core/agent";
import { describe, expect, it, vi } from "vitest";

import {
  draftWriterClaims,
  generateWriterClaims,
  type WriterFactView,
  writerLabelHints,
  writerModelDecision,
  writerQuestionContext,
  writerSlotGrammar
} from "../src/assistant-v3/writers.js";

describe("V3 constrained workflow writer", () => {
  it("derives localized label grammar only from signed semantic roles", () => {
    expect(writerLabelHints(
      ["market.change"],
      "az-AZ"
    )).toEqual(["dəyişiklik"]);
    expect(writerLabelHints(
      ["market.price", "market.change"],
      "en-US"
    )).toEqual(["quote"]);
    expect(writerLabelHints(
      ["risk.generic", "risk.volatility", "risk.drawdown"],
      "az-AZ"
    )).toEqual(["risk"]);
    expect(writerLabelHints(
      ["instrument.identity"],
      "az-AZ"
    )).toEqual([]);
    expect(writerSlotGrammar([{
      ref: "RETURN",
      kind: "market.price-history",
      subjectType: "instrument",
      subjectRef: "AAPL",
      asOfRef: "as-of-RETURN",
      availability: "complete",
      required: true,
      meaning: "verified close-to-close return",
      semanticRoles: ["market.change"],
      labelHints: ["dəyişiklik"]
    }])).toEqual([
      "RETURN => dəyişiklik: {{RETURN}}"
    ]);
    expect(writerSlotGrammar([{
      ref: "E1",
      kind: "education.approved-retrieval",
      subjectType: "product",
      subjectRef: "GENERAL_FINANCIAL_EDUCATION:query-hash",
      asOfRef: "as-of-E1",
      availability: "complete",
      required: true,
      meaning: "exact approved financial-education proposition",
      semanticRoles: ["knowledge.education"],
      requiredCitationRef: "C1",
      labelHints: ["əsas məqam"]
    }])).toEqual([
      "E1 => əsas məqam: {{E1}}; {{C1}} (paired required citation; place it immediately after {{E1}})"
    ]);
  });

  it("keeps conversational wording but removes unsigned exact values and evidence subjects", () => {
    expect(writerQuestionContext(
      "AAPL səhminin son 10 illik qiymətini $203.28 ilə müqayisə et.",
      ["AAPL"]
    )).toBe(
      "[evidence-subject] səhminin son [requested-value] illik qiymətini [requested-value] ilə müqayisə et."
    );
  });

  it("receives value-free slot meaning and required status", async () => {
    const generate = vi.fn(async (
      _prompt: string,
      _options?: { instructions?: string }
    ) => ({
      object: {
        claims: [{
          claimId: "writer-claim",
          textTemplate: "{{PRICE}}.",
          factRefs: ["PRICE"],
          citationRefs: [],
          limitations: []
        }]
      }
    }));
    const agent = { generate } as unknown as Agent;

    const result = await draftWriterClaims({
      agent,
      locale: "en-US",
      userMessage:
        "Could you quickly tell me what NVDA is trading at for jane@example.com, +994501234567, client-1234567890123456?",
      userGoal: "answer the current quote directly",
      facts: [
        {
          ref: "PRICE",
          kind: "market.quote",
          subjectType: "instrument",
          subjectRef: "NVDA",
          asOfRef: "as-of-PRICE",
          availability: "complete",
          required: true,
          meaning: "the verified current market price",
          semanticRoles: ["market.price"],
          labelHints: ["price"]
        },
        {
          ref: "MARKET_CONTEXT",
          kind: "market.quote",
          subjectType: "instrument",
          subjectRef: "NVDA",
          asOfRef: "as-of-MARKET_CONTEXT",
          availability: "complete",
          required: false,
          meaning: "the verified market state and freshness",
          semanticRoles: ["market.state", "source.freshness"],
          labelHints: ["freshness"]
        }
      ],
      citations: [],
      timeoutMs: 1_000
    });

    expect(result).toEqual([{
      claimId: "writer-claim",
      locale: "en-US",
      textTemplate: "{{PRICE}}.",
      factRefs: ["PRICE"],
      citationRefs: [],
      limitations: []
    }]);
    const prompt = generate.mock.calls[0]?.[0];
    expect(prompt).toContain('"meaning":"the verified current market price"');
    expect(prompt).toContain('"semanticRoles":["market.price"]');
    expect(prompt).toContain('"labelHints":["price"]');
    expect(prompt).toContain(
      "PRICE => price: {{PRICE}}"
    );
    expect(prompt).toContain('"required":true');
    expect(prompt).toContain('"required":false');
    expect(prompt).toContain(
      'Sanitized conversation intent: {"locale":"en-US","responseStyle":"concise","interaction":"direct-question","politeness":"polite"}'
    );
    expect(prompt).not.toContain("jane@example.com");
    expect(prompt).not.toContain("+994501234567");
    expect(prompt).not.toContain("client-1234567890123456");
    expect(prompt).not.toMatch(/\$|203\.28/u);
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain("Never write the literal placeholder {{REF}}");
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain("Always return an empty limitations array");
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain("return one claim per subject");
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain("Never concatenate, quote, or comma-join reference names");
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain("The semanticRoles list is authoritative");
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain('isolated segment "label: {{REFERENCE}}"');
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain(
      "When a semantic fact names requiredCitationRef, place that exact citation placeholder immediately after the fact placeholder"
    );
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain(
      "{{F1_IDENTITY}} — price: {{F1_PRICE}}; change: {{F1_CHANGE}}; {{F1_SOURCE}}"
    );
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain(
      "{{F1_IDENTITY}} — quote: {{F1_QUOTE}}; market cap: {{F1_MARKET_CAP}}; trailing P/E: {{F1_TRAILING_PE}}; {{F1_SOURCE}}"
    );
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain(
      "{{F1_IDENTITY}} — cari qiymət: {{F1_PRICE}}; dəyişiklik: {{F1_CHANGE}}; {{F1_SOURCE}}"
    );
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain(
      "{{F1_IDENTITY}} — kotirovka: {{F1_QUOTE}}; bazar kapitallaşması: {{F1_MARKET_CAP}}; P/E: {{F1_TRAILING_PE}}; {{F1_SOURCE}}"
    );
    expect(generate.mock.calls[0]?.[1]).toMatchObject({
      providerOptions: {
        "assistant-v3": {
          modelTier: "primary",
          selectionReasonCode: "primary_default"
        }
      }
    });
  });

  it("keeps the exact two-ETF writer draft inside the comparison sentence envelope", async () => {
    const exactDraft = (prefix: "F1" | "F2") =>
      `{{${prefix}_IDENTITY}} üçün {{${prefix}_CLASSIFICATION}}. Xidmət haqqı: {{${prefix}_EXPENSE}}; paylanma gəlirliliyi: {{${prefix}_DISTRIBUTION}}. Risk: {{${prefix}_HISTORICAL_RISK}}; risk: {{${prefix}_RATE_RISK}}; konsentrasiya: {{${prefix}_CONCENTRATION}}. {{${prefix}_SOURCE}}`;
    const refs = (prefix: "F1" | "F2") => [
      `${prefix}_IDENTITY`,
      `${prefix}_CLASSIFICATION`,
      `${prefix}_EXPENSE`,
      `${prefix}_DISTRIBUTION`,
      `${prefix}_HISTORICAL_RISK`,
      `${prefix}_RATE_RISK`,
      `${prefix}_CONCENTRATION`,
      `${prefix}_SOURCE`
    ];
    const generate = vi.fn(async (
      _prompt: string,
      _options?: { instructions?: string }
    ) => ({
      object: {
        claims: (["F1", "F2"] as const).map((prefix) => ({
          claimId: `etf-comparison-${prefix}`,
          textTemplate: exactDraft(prefix),
          factRefs: refs(prefix),
          citationRefs: [],
          limitations: []
        }))
      }
    }));
    const agent = { generate } as unknown as Agent;
    const comparisonFacts: WriterFactView[] = ([
      ["F1", "VOO"],
      ["F2", "QQQ"]
    ] as const).flatMap(([prefix, subjectRef]) => [
      {
        ref: `${prefix}_IDENTITY`,
        kind: "market.etf-research",
        subjectType: "instrument",
        subjectRef,
        asOfRef: `as-of-${prefix}`,
        availability: "complete" as const,
        required: true,
        meaning: "verified ETF name and ticker",
        semanticRoles: ["instrument.identity"],
        labelHints: []
      },
      {
        ref: `${prefix}_CLASSIFICATION`,
        kind: "market.etf-research",
        subjectType: "instrument",
        subjectRef,
        asOfRef: `as-of-${prefix}`,
        availability: "complete" as const,
        required: true,
        meaning: "verified ETF classification and fund family",
        semanticRoles: ["instrument.type"],
        labelHints: []
      },
      {
        ref: `${prefix}_EXPENSE`,
        kind: "market.etf-research",
        subjectType: "instrument",
        subjectRef,
        asOfRef: `as-of-${prefix}`,
        availability: "complete" as const,
        required: true,
        meaning: "verified annual expense ratio",
        semanticRoles: ["knowledge.fee"],
        labelHints: ["xidmət haqqı"]
      },
      {
        ref: `${prefix}_DISTRIBUTION`,
        kind: "market.etf-research",
        subjectType: "instrument",
        subjectRef,
        asOfRef: `as-of-${prefix}`,
        availability: "complete" as const,
        required: true,
        meaning: "verified distribution yield",
        semanticRoles: ["fundamental.dividend_yield"],
        labelHints: ["paylanma gəlirliliyi"]
      },
      {
        ref: `${prefix}_HISTORICAL_RISK`,
        kind: "market.etf-research",
        subjectType: "instrument",
        subjectRef,
        asOfRef: `as-of-${prefix}`,
        availability: "complete" as const,
        required: true,
        meaning: "verified historical volatility and drawdown risk",
        semanticRoles: ["risk.generic", "risk.volatility", "risk.drawdown"],
        labelHints: ["risk"]
      },
      {
        ref: `${prefix}_RATE_RISK`,
        kind: "market.etf-research",
        subjectType: "instrument",
        subjectRef,
        asOfRef: `as-of-${prefix}`,
        availability: "complete" as const,
        required: true,
        meaning: "verified duration and maturity indicators for rate risk",
        semanticRoles: ["risk.generic", "risk.duration", "risk.maturity"],
        labelHints: ["risk"]
      },
      {
        ref: `${prefix}_CONCENTRATION`,
        kind: "market.etf-research",
        subjectType: "instrument",
        subjectRef,
        asOfRef: `as-of-${prefix}`,
        availability: "complete" as const,
        required: true,
        meaning: "verified holdings concentration",
        semanticRoles: ["risk.concentration"],
        labelHints: ["konsentrasiya"]
      },
      {
        ref: `${prefix}_SOURCE`,
        kind: "market.etf-research",
        subjectType: "instrument",
        subjectRef,
        asOfRef: `as-of-${prefix}`,
        availability: "complete" as const,
        required: true,
        meaning: "verified ETF research time and source",
        semanticRoles: ["source.identity", "source.time"],
        labelHints: ["mənbə"]
      }
    ]);

    const result = await generateWriterClaims({
      agent,
      locale: "az-AZ",
      userMessage: "VOO ilə QQQ arasında əsas fərq nədir?",
      userGoal: "compare two verified ETF evidence sets",
      facts: comparisonFacts,
      citations: [],
      timeoutMs: 1_000
    });

    expect(result.claims.map(({ textTemplate }) => textTemplate)).toEqual([
      "{{F1_IDENTITY}} üçün {{F1_CLASSIFICATION}}; Xidmət haqqı: {{F1_EXPENSE}}; paylanma gəlirliliyi: {{F1_DISTRIBUTION}}; Risk: {{F1_HISTORICAL_RISK}}; risk: {{F1_RATE_RISK}}; konsentrasiya: {{F1_CONCENTRATION}}; {{F1_SOURCE}}",
      "{{F2_IDENTITY}} üçün {{F2_CLASSIFICATION}}; Xidmət haqqı: {{F2_EXPENSE}}; paylanma gəlirliliyi: {{F2_DISTRIBUTION}}; Risk: {{F2_HISTORICAL_RISK}}; risk: {{F2_RATE_RISK}}; konsentrasiya: {{F2_CONCENTRATION}}; {{F2_SOURCE}}"
    ]);
    const prompt = generate.mock.calls[0]?.[0];
    expect(prompt).toContain("Comparison composition grammar:");
    expect(prompt).toContain("Write exactly one sentence in each subject claim.");
    expect(prompt).toContain(
      "do not put a sentence terminator before a later placeholder."
    );
    expect(
      generate.mock.calls[0]?.[1]?.instructions
    ).toContain(
      "each subject claim must be exactly one sentence"
    );
  });

  it("escalates only reviewed complex compositions", () => {
    expect(writerModelDecision({
      userMessage: "What is the current AAPL price?",
      locale: "en-US",
      factCount: 4,
      citationCount: 0
    })).toEqual({
      tier: "primary",
      modelId: "gpt-4o",
      reasonCode: "primary_default"
    });
    expect(writerModelDecision({
      userMessage: "Compare NVDA and AAPL",
      locale: "en-US",
      factCount: 4,
      citationCount: 0
    })).toEqual({
      tier: "escalation",
      modelId: "gpt-4.1",
      reasonCode: "comparison_requires_instruction_fidelity"
    });
    expect(writerModelDecision({
      userMessage: "Explain Demo Invest products, fees, and disclosures",
      locale: "en-US",
      factCount: 3,
      citationCount: 3
    })).toEqual({
      tier: "escalation",
      modelId: "gpt-4.1",
      reasonCode: "multi_citation_knowledge_composition"
    });
  });

  it("surfaces only bounded aggregate model usage with generated claims", async () => {
    const generate = vi.fn(async () => ({
      object: {
        claims: [{
          claimId: "writer-claim",
          textTemplate: "{{PRICE}}.",
          factRefs: ["PRICE"],
          citationRefs: [],
          limitations: []
        }]
      },
      totalUsage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 20,
        reasoningTokens: 5,
        raw: {
          requestId: "provider-private-request",
          prompt: "private prompt"
        }
      },
      providerMetadata: {
        openai: { responseId: "provider-private-response" }
      }
    }));
    const agent = { generate } as unknown as Agent;

    const result = await generateWriterClaims({
      agent,
      locale: "en-US",
      userMessage: "What is the current price?",
      userGoal: "answer from one verified fact",
      facts: [],
      citations: [],
      timeoutMs: 1_000
    });

    expect(result).toEqual({
      claims: [{
        claimId: "writer-claim",
        locale: "en-US",
        textTemplate: "{{PRICE}}.",
        factRefs: ["PRICE"],
        citationRefs: [],
        limitations: []
      }],
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 20,
        reasoningOutputTokens: 5
      },
      modelDecision: {
        tier: "primary",
        modelId: "gpt-4o",
        reasonCode: "primary_default"
      }
    });
    expect(JSON.stringify(result)).not.toContain("provider-private");
    expect(JSON.stringify(result)).not.toContain("private prompt");
  });
});
