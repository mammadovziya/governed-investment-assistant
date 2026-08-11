import { describe, expect, it } from "vitest";

import {
  classifyV3ConversationalTurn,
  isReviewedConversationDefinition,
  isReviewedGenericClarificationDefinition,
  reviewedConversationDefinition,
  reviewedGenericClarificationDefinition,
  safeStudioConversationalReply
} from "../src/assistant-v3/conversation.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import {
  renderClaimDrafts,
  sealRenderableFact
} from "../src/assistant-v3/rendering.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";

describe("V3 bounded conversational turns", () => {
  it.each([
    ["Hello!", "greeting"],
    ["Salam, necəsən?", "greeting"],
    ["Thanks, that helped.", "gratitude"],
    ["Thanks, that helps.", "gratitude"],
    ["I appreciate it.", "gratitude"],
    ["Cox sag ol!", "gratitude"],
    ["Çox sağ ol, kömək etdi.", "gratitude"],
    ["Cox sag ol, komek etdi.", "gratitude"],
    ["What can you help me with?", "capability_overview"],
    ["Hello, what can you help me with?", "capability_overview"],
    ["Mene nece komek ede bilersen?", "capability_overview"],
    ["Salam, mənə nələrdə kömək edə bilərsən?", "capability_overview"],
    ["Mənə nələrdə kömək edə bilərsən?", "capability_overview"],
    ["Mene nelerde komek ede bilersen?", "capability_overview"],
    ["Could you explain that more simply?", "simplify_follow_up"],
    ["Bunu daha sade izah et.", "simplify_follow_up"]
  ] as const)("classifies %s without a factual route", (message, kind) => {
    expect(classifyV3ConversationalTurn(message)).toBe(kind);
  });

  it.each([
    "Thanks—what is NVDA trading at?",
    "Çox sağ ol, AAPL indi neçəyə ticarət olunur?",
    "Mənim üçün AAPL ala bilərsən?",
    "Explain NVDA more simply",
    "Can you buy NVDA for me?",
    "What are Demo Invest's fees?"
  ])("does not absorb a factual or executable mixed turn: %s", (message) => {
    expect(classifyV3ConversationalTurn(message)).toBeNull();
  });

  it.each([
    ["Hello!", "en-US"],
    ["Salam!", "az-AZ"],
    ["What can you do?", "en-US"],
    ["Ne ede bilersen?", "az-AZ"]
  ] as const)("returns a locale-bound reviewed semantic catalog for %s", (
    message,
    locale
  ) => {
    const definition = reviewedConversationDefinition(message, locale);
    expect(definition).not.toBeNull();
    expect(isReviewedConversationDefinition(definition, locale)).toBe(true);
    expect(definition?.statements.every(({ required }) => required)).toBe(true);
    expect(definition?.answer).toMatch(/\{\{CONVERSATION_/u);
  });

  it.each(["en-US", "az-AZ"] as const)(
    "returns reviewed value-free generic clarification slots for %s",
    (locale) => {
      const definition = reviewedGenericClarificationDefinition(locale);
      expect(definition).toMatchObject({
        catalogVersion: "assistant-generic-clarification-v1",
        kind: "generic_clarification",
        locale
      });
      expect(definition.statements.map(({ alias }) => alias)).toEqual([
        "CLARIFICATION_REQUEST",
        "CLARIFICATION_SCOPE"
      ]);
      expect(definition.statements.every(({ required }) => required)).toBe(true);
      expect(definition.answer).toContain("{{CLARIFICATION_REQUEST}}");
      expect(definition.answer).toContain("{{CLARIFICATION_SCOPE}}");
      expect(isReviewedGenericClarificationDefinition(
        definition,
        locale
      )).toBe(true);
      expect(isReviewedGenericClarificationDefinition({
        ...definition,
        statements: [{
          ...definition.statements[0],
          text: "tampered"
        }, ...definition.statements.slice(1)]
      }, locale)).toBe(false);
    }
  );

  it("keeps a natural Studio reply but rejects factual or trading additions", () => {
    expect(safeStudioConversationalReply({
      message: "Thanks!",
      locale: "en-US",
      modelText: "You’re welcome—I’m glad I could help."
    })).toBe("You’re welcome—I’m glad I could help.");
    expect(safeStudioConversationalReply({
      message: "Thanks!",
      locale: "en-US",
      modelText: "You’re welcome. NVDA is $203."
    })).toBeNull();
    expect(safeStudioConversationalReply({
      message: "Mene nece komek ede bilersen?",
      locale: "az-AZ",
      modelText: "Portfel və bazar suallarını sadə dildə izah etməyə kömək edə bilərəm."
    })).toContain("kömək");
    expect(safeStudioConversationalReply({
      message: "What can you do?",
      locale: "en-US",
      modelText: "I can execute trades and recommend what to buy."
    })).toBeNull();
    expect(safeStudioConversationalReply({
      message: "What can you do?",
      locale: "en-US",
      modelText:
        "I can help with portfolio and public-market research, but I cannot execute trades."
    })).toContain("cannot execute");
  });

  it("accepts a bounded model-authored Azerbaijani greeting shell", () => {
    const now = Date.parse("2026-07-23T10:00:00.000Z");
    const evidence = new EvidenceFactory({
      signer: new DevHmacSigner({
        keyId: "conversation-az",
        secret: "conversation-az-test-secret-is-long-enough"
      }),
      now: () => now
    });
    const definition = reviewedConversationDefinition("Salam!", "az-AZ")!;
    const fact = evidence.fact({
      requestId: "conversation-az-request",
      workflowRunId: "conversation-az-run",
      kind: "assistant.reviewed-conversation",
      subject: { type: "product", ref: "ASSISTANT_CONVERSATION" },
      asOf: new Date(now).toISOString(),
      value: definition,
      provenance: {
        toolExecutionIds: [],
        inputFactIds: [],
        calculation: {
          id: "deterministic-conversation-catalog",
          version: "1.0.0",
          formulaId: "reviewed-conversation-lookup"
        }
      }
    });
    const facts = definition.statements.map((statement) =>
      sealRenderableFact({
        alias: statement.alias,
        fact,
        meaning: statement.meaning,
        required: statement.required,
        display: statement.text
      }, evidence)
    );
    const result = renderClaimDrafts({
      drafts: [{
        claimId: "natural-az-greeting",
        locale: "az-AZ",
        textTemplate:
          "Salam! {{CONVERSATION_SCOPE}} üzrə kömək etməyə hazıram.",
        factRefs: ["CONVERSATION_SCOPE"],
        citationRefs: [],
        limitations: []
      }],
      facts,
      citations: [],
      tools: [],
      evidence,
      fallback: [{
        claimId: "fallback-az-greeting",
        locale: "az-AZ",
        textTemplate: definition.answer,
        factRefs: ["CONVERSATION_SCOPE"],
        citationRefs: [],
        limitations: []
      }],
      locale: "az-AZ"
    });

    expect(result.generationMode).toBe("writer");
    expect(result.message).toContain("kömək etməyə hazıram");
  });
});
