import { describe, expect, it } from "vitest";

import {
  approvedKnowledgePropositions,
  buildKnowledgeCapabilityPresentation
} from "../src/assistant-v3/capability-presentations.js";
import type {
  AssistantCitation,
  SupportedLocale,
  TrustedRequestContext
} from "../src/assistant-v3/contracts.js";
import type {
  ApprovedKnowledgeEvidenceValue,
  ProjectedApprovedKnowledgeEvidence
} from "../src/assistant-v3/approved-knowledge.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { renderClaimDrafts, sealRenderableFact } from "../src/assistant-v3/rendering.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";

const NOW = Date.parse("2026-07-22T08:00:00.000Z");
const AS_OF = new Date(NOW).toISOString();

function context(locale: SupportedLocale): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: `knowledge-conversation-${locale}`,
    sessionId: `knowledge-session-${locale}`,
    conversationId: `knowledge-thread-${locale}`,
    principalRef: "principal:test",
    tenantRef: "tenant:test",
    locale,
    jurisdiction: "AZ",
    channel: "test",
    environment: "test",
    requestedAt: AS_OF,
    authentication: {
      strength: "authenticated",
      authContextRef: "auth:test"
    },
    consentVersion: "consent-v1",
    consentScopes: ["assistant_use", "approved_knowledge"],
    entitlementVersion: "entitlement-v1",
    entitlements: ["assistant_access", "knowledge_read"],
    policyVersion: "3.0.0",
    capabilities: ["approved-knowledge-read"],
    featureSnapshot: { version: "feature-v1", flags: { approvedKnowledge: true } }
  };
}

function projectedKnowledge(input: {
  locale: SupportedLocale;
  text: string;
  section: string;
  evidence: EvidenceFactory;
}): {
  projected: ProjectedApprovedKnowledgeEvidence;
  tool: ReturnType<EvidenceFactory["toolSuccess"]>;
} {
  const sourceId = input.locale === "az-AZ"
    ? "demo-invest-funding-az"
    : "demo-invest-funding-en";
  const workflowRunId = `knowledge-run-${input.locale}`;
  const tool = input.evidence.toolSuccess({
    requestId: `knowledge-conversation-${input.locale}`,
    workflowRunId,
    toolId: "retrieve-approved-product-knowledge",
    toolVersion: "1.0.0",
    arguments: { query: "funding" },
    result: { status: "grounded" },
    source: {
      provider: "demo-invest-approved-knowledge-service",
      sourceId: "approved-knowledge-index:test",
      sourceUrl: null,
      licenseClass: "synthetic",
      observedAt: AS_OF,
      sourceAsOf: AS_OF
    }
  });
  const value: ApprovedKnowledgeEvidenceValue = {
    chunkId: `${sourceId}:1`,
    sourceId,
    version: "project-authored-synthetic-2026-07-21",
    documentType: "policy",
    title: input.locale === "az-AZ"
      ? "Demo Invest virtual mədaxili"
      : "Demo Invest virtual funding",
    url: input.locale === "az-AZ"
      ? "https://knowledge.demo-invest.invalid/az/funding"
      : "https://knowledge.demo-invest.invalid/en/funding",
    locale: input.locale,
    jurisdiction: "AZ",
    productScope: "DEMO_INVEST",
    section: input.section,
    text: input.text,
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentAsOf: AS_OF,
    sourceChecksumSha256: "a".repeat(64),
    chunkChecksumSha256: "b".repeat(64),
    indexGeneration: "test"
  };
  const fact = input.evidence.fact({
    requestId: `knowledge-conversation-${input.locale}`,
    workflowRunId,
    kind: "approved-knowledge.evidence",
    subject: { type: "product", ref: "DEMO_INVEST" },
    asOf: AS_OF,
    value,
    provenance: {
      toolExecutionIds: [tool.executionId],
      inputFactIds: [],
      calculation: null
    }
  });
  const citation: AssistantCitation = {
    citationId: "product-knowledge-1",
    sourceId: `${sourceId}@${value.version}`,
    title: value.title,
    url: value.url,
    sourceAsOf: AS_OF,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: null,
    contentHash: value.chunkChecksumSha256
  };
  return {
    projected: { facts: [fact], citations: [citation] },
    tool
  };
}

describe("V3 conversational approved knowledge", () => {
  it.each([
    {
      locale: "en-US" as const,
      text:
        "Demo Invest uses virtual cash only. " +
        "Resetting virtual cash restores the sample balance immediately. " +
        "No bank account or real customer money is connected to the demonstration.",
      section: "Virtual cash policy",
      template: "{{K1P1}}. {{K1P2}}. {{K1P3}} {{C1}}.",
      expectedPrefix: "Demo Invest uses virtual cash only"
    },
    {
      locale: "az-AZ" as const,
      text:
        "Demo Invest yalnız virtual vəsaitdən istifadə edir. " +
        "Virtual vəsaiti sıfırlamaq nümunə balansını dərhal bərpa edir. " +
        "Nümayişə bank hesabı və ya real müştəri vəsaiti qoşulmur.",
      section: "Virtual vəsait qaydası",
      template: "{{K1P1}}. {{K1P2}}. {{K1P3}} {{C1}}.",
      expectedPrefix: "Demo Invest yalnız virtual vəsaitdən istifadə edir"
    }
  ])(
    "lets the $locale writer connect atomic propositions without seeing a raw chunk",
    ({ locale, text, section, template, expectedPrefix }) => {
      const signer = new DevHmacSigner({
        keyId: `knowledge-conversation-${locale}`,
        secret: `knowledge-conversation-${locale}-secret-is-long-enough`
      });
      const evidence = new EvidenceFactory({ signer, now: () => NOW });
      const { projected, tool } = projectedKnowledge({
        locale,
        text,
        section,
        evidence
      });
      const presentation = buildKnowledgeCapabilityPresentation({
        context: context(locale),
        projected,
        route: "approved_knowledge"
      });
      const facts = presentation.renderableFacts.map((item) =>
        sealRenderableFact(item, evidence)
      );

      expect(facts).toHaveLength(3);
      for (const item of facts) {
        expect(item.display).not.toBe(text);
        expect(text.includes(item.display)).toBe(true);
        expect(item.meaning).toContain("supported by citation C1");
      }

      const rejectionReasons: string[] = [];
      const rendered = renderClaimDrafts({
        drafts: [{
          claimId: `natural-knowledge-${locale}`,
          locale,
          textTemplate: template,
          factRefs: ["K1P1", "K1P2", "K1P3"],
          citationRefs: ["C1"],
          limitations: []
        }],
        facts,
        citations: presentation.renderableCitations,
        tools: [tool],
        evidence,
        fallback: presentation.fallback,
        locale,
        onWriterRejected: (reason) => rejectionReasons.push(reason)
      });

      expect(rendered.generationMode, rejectionReasons.join(",")).toBe("writer");
      expect(rendered.message).toContain(expectedPrefix);
      expect(rendered.message).toContain("[1]");
      expect(rendered.usedFactAliases).toEqual(["K1P1", "K1P2", "K1P3"]);
      expect(rendered.usedCitationAliases).toEqual(["C1"]);
    }
  );

  it("falls back when a draft types an ungrounded policy number", () => {
    const signer = new DevHmacSigner({
      keyId: "knowledge-rejection",
      secret: "knowledge-rejection-test-secret-is-long-enough"
    });
    const evidence = new EvidenceFactory({ signer, now: () => NOW });
    const locale = "en-US" as const;
    const text =
      "The Demo Invest sandbox uses virtual cash. " +
      "A virtual balance reset is immediate.";
    const { projected, tool } = projectedKnowledge({
      locale,
      text,
      section: "Virtual cash policy",
      evidence
    });
    const presentation = buildKnowledgeCapabilityPresentation({
      context: context(locale),
      projected,
      route: "approved_knowledge"
    });
    const rendered = renderClaimDrafts({
      drafts: [{
        claimId: "invented-policy-value",
        locale,
        textTemplate: "{{K1P1}}. It always takes 5 days. {{K1P2}} {{C1}}",
        factRefs: ["K1P1", "K1P2"],
        citationRefs: ["C1"],
        limitations: []
      }],
      facts: presentation.renderableFacts.map((item) =>
        sealRenderableFact(item, evidence)
      ),
      citations: presentation.renderableCitations,
      tools: [tool],
      evidence,
      fallback: presentation.fallback,
      locale
    });

    expect(rendered.generationMode).toBe("deterministic-fallback");
    expect(rendered.message).not.toContain("5 days");
    expect(rendered.message).toContain("[1]");
  });

  it("keeps two retrieved sources paired one-to-one with bounded claim references", () => {
    const signer = new DevHmacSigner({
      keyId: "knowledge-pairing",
      secret: "knowledge-pairing-test-secret-is-long-enough"
    });
    const evidence = new EvidenceFactory({ signer, now: () => NOW });
    const firstBundle = projectedKnowledge({
      locale: "en-US",
      text:
        "The Demo Invest sandbox uses virtual US-dollar cash. " +
        "A virtual balance reset is immediate.",
      section: "Funding method and timing",
      evidence
    });
    const first = firstBundle.projected;
    const firstFact = first.facts[0]!;
    const firstCitation = first.citations[0]!;
    const secondValue: ApprovedKnowledgeEvidenceValue = {
      ...firstFact.value,
      chunkId: "demo-invest-withdrawal-en:1",
      sourceId: "demo-invest-withdrawal-en",
      title: "Withdrawal rules",
      section: "Availability and settlement",
      text:
        "A withdrawal is made from the available investment balance. " +
        "Sale proceeds become available after settlement."
    };
    const secondFact = evidence.fact({
      requestId: firstFact.requestId,
      workflowRunId: firstFact.workflowRunId,
      kind: "approved-knowledge.evidence",
      subject: firstFact.subject,
      asOf: firstFact.asOf,
      value: secondValue,
      provenance: firstFact.provenance
    });
    const secondCitation: AssistantCitation = {
      ...firstCitation,
      citationId: "product-knowledge-2",
      sourceId: "demo-invest-withdrawal-en@project-authored-synthetic-2026-07-21",
      title: "Demo Invest virtual withdrawal policy",
      url: "https://knowledge.demo-invest.invalid/en/withdrawals",
      contentHash: "c".repeat(64)
    };
    const projected: ProjectedApprovedKnowledgeEvidence = {
      facts: [firstFact, secondFact],
      citations: [firstCitation, secondCitation]
    };
    const presentation = buildKnowledgeCapabilityPresentation({
      context: context("en-US"),
      projected,
      route: "approved_knowledge"
    });

    expect(presentation.renderableFacts.filter(({ alias }) =>
      alias.startsWith("K1")
    ).every(({ meaning }) => meaning.includes("citation C1"))).toBe(true);
    expect(presentation.renderableFacts.filter(({ alias }) =>
      alias.startsWith("K2")
    ).every(({ meaning }) => meaning.includes("citation C2"))).toBe(true);
    expect(presentation.fallback.map(({ citationRefs }) => citationRefs)).toEqual([
      ["C1"],
      ["C2"]
    ]);
    expect(presentation.fallback.every(({ factRefs }) => factRefs.length <= 8))
      .toBe(true);
    const rendered = renderClaimDrafts({
      drafts: [{
        claimId: "swapped-knowledge-citations",
        locale: "en-US",
        textTemplate: "{{K1P1}} {{C2}} {{K2P1}} {{C1}}",
        factRefs: ["K1P1", "K2P1"],
        citationRefs: ["C2", "C1"],
        limitations: []
      }],
      facts: presentation.renderableFacts.map((item) =>
        sealRenderableFact(item, evidence)
      ),
      citations: presentation.renderableCitations,
      tools: [firstBundle.tool],
      evidence,
      fallback: presentation.fallback,
      locale: "en-US"
    });
    expect(rendered.generationMode).toBe("deterministic-fallback");
    expect(rendered.usedCitationAliases).toEqual(["C1", "C2"]);

    expect(() => buildKnowledgeCapabilityPresentation({
      context: context("en-US"),
      projected: { facts: [firstFact], citations: [] },
      route: "approved_knowledge"
    })).toThrow(/exactly one citation/u);
  });

  it("rejects empty, over-segmented, and truncated proposition inputs", () => {
    expect(() => approvedKnowledgePropositions("   ")).toThrow(/bounded length/u);
    expect(() => approvedKnowledgePropositions(
      Array.from({ length: 9 }, (_, index) => `Statement ${index + 1}.`).join(" ")
    )).toThrow(/safe propositions/u);
    expect(() => approvedKnowledgePropositions("Unsupported ellipsis …"))
      .toThrow(/safe propositions/u);
  });
});
