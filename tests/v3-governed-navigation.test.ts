import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TrustedRequestContext } from "../src/assistant-v3/contracts.js";
import { approvedProductKnowledgeDocuments } from "../src/data/approved-product-knowledge.js";
import {
  GOVERNED_NAVIGATION_CATALOG_VERSION,
  GovernedInAppNavigationService,
  detectGovernedNavigationTarget,
  getGovernedNavigationCatalogMetadata,
  isAllowlistedInAppPath,
  type GovernedNavigationCitationRef
} from "../src/assistant-v3/governed-navigation.js";

const fundingEvidence: Record<TrustedRequestContext["locale"], GovernedNavigationCitationRef> = {
  "en-US": {
    citationId: "product-knowledge-1",
    sourceId: "demo-invest-funding-en@project-authored-synthetic-2026-07-21",
    url: "https://knowledge.demo-invest.invalid/en/funding",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: "525957899d5269a3681a1e1b8a7170eb6c9d9e53863211aca2233915168bbf0c"
  },
  "az-AZ": {
    citationId: "product-knowledge-1",
    sourceId: "demo-invest-funding-az@project-authored-synthetic-2026-07-21",
    url: "https://knowledge.demo-invest.invalid/az/funding",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: "111648055ba6f696cccdb91f7d48c3f15fac759b71cd3360c0df9cd14277fa3f"
  }
};

const sharePurchaseEvidence: Record<
  TrustedRequestContext["locale"],
  GovernedNavigationCitationRef
> = {
  "en-US": {
    citationId: "product-knowledge-share-purchase",
    sourceId:
      "demo-invest-purchase-process-en@project-authored-synthetic-2026-07-21",
    url: "https://knowledge.demo-invest.invalid/en/order-preview",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: "913811301a0db26fce9b6f20b8fc53671576b1d9a2c4c014aa9eeddba7b7db66"
  },
  "az-AZ": {
    citationId: "product-knowledge-share-purchase",
    sourceId:
      "demo-invest-purchase-process-az@project-authored-synthetic-2026-07-21",
    url: "https://knowledge.demo-invest.invalid/az/order-preview",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: "1189ae637d6e65c76eb3e120ecf156d6d4d7c1bc8c747ef3f569634878ab5f84"
  }
};

const accountOpeningEvidence: Record<
  TrustedRequestContext["locale"],
  GovernedNavigationCitationRef
> = {
  "en-US": {
    citationId: "product-knowledge-account-opening",
    sourceId:
      "demo-invest-account-opening-en@project-authored-synthetic-2026-07-21",
    url: "https://knowledge.demo-invest.invalid/en/account-opening",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: "8523ac2eb5cae20efcf514a609f2d100562cb7e23425ae6b2ef769c4fda5a067"
  },
  "az-AZ": {
    citationId: "product-knowledge-account-opening",
    sourceId:
      "demo-invest-account-opening-az@project-authored-synthetic-2026-07-21",
    url: "https://knowledge.demo-invest.invalid/az/account-opening",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: "c67aac1fc4de4ec08c82477fea709e86f218b68e9a942703a446408ff86832db"
  }
};

const withdrawalEvidence: Record<
  TrustedRequestContext["locale"],
  GovernedNavigationCitationRef
> = {
  "en-US": {
    citationId: "product-knowledge-withdrawal",
    sourceId: "demo-invest-withdrawal-en@project-authored-synthetic-2026-07-21",
    url: "https://knowledge.demo-invest.invalid/en/withdrawals",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: "98278a295cdee7e1d6e018312a4df4a209031c2ebfc2446c366a8861009751e6"
  },
  "az-AZ": {
    citationId: "product-knowledge-withdrawal",
    sourceId: "demo-invest-withdrawal-az@project-authored-synthetic-2026-07-21",
    url: "https://knowledge.demo-invest.invalid/az/withdrawals",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: "c675669f5e2cd60332d2341de23d4632cfd8712708f1ba195d78a6ba16c200bc"
  }
};

function context(
  locale: TrustedRequestContext["locale"] = "en-US",
  overrides: Partial<TrustedRequestContext> = {}
): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "req-navigation-001",
    sessionId: "session-navigation-001",
    conversationId: "conversation-navigation-001",
    principalRef: "principal:navigation-test",
    tenantRef: "tenant:demo-invest-test",
    locale,
    jurisdiction: "AZ",
    channel: "web",
    environment: "test",
    requestedAt: "2026-07-22T12:00:00.000Z",
    authentication: {
      strength: "authenticated",
      authContextRef: "auth:navigation-test"
    },
    consentVersion: "consent-v1",
    consentScopes: ["assistant_use", "approved_knowledge"],
    entitlementVersion: "entitlement-v1",
    entitlements: ["assistant_access", "knowledge_read"],
    policyVersion: "assistant-policy-v3",
    capabilities: ["approved-knowledge-read"],
    featureSnapshot: {
      version: "navigation-features-v1",
      flags: { approvedKnowledge: true, priceAlerts: true }
    },
    ...overrides
  };
}

describe("GovernedInAppNavigationService", () => {
  const navigation = new GovernedInAppNavigationService();

  it("is pinned to the current approved EN/AZ funding publication manifests", () => {
    const approvedFundingDocuments = approvedProductKnowledgeDocuments
      .filter(({ manifest }) => manifest.facets.includes("funding"));

    expect(approvedFundingDocuments).toHaveLength(2);
    for (const { manifest, content } of approvedFundingDocuments) {
      const locale = manifest.locale;
      const expected = fundingEvidence[locale];
      const chunkHash = createHash("sha256")
        .update(`${manifest.title}\n\n${content}`, "utf8")
        .digest("hex");
      expect(expected).toMatchObject({
        sourceId: `${manifest.sourceId}@${manifest.version}`,
        url: manifest.url,
        sourceAsOf: manifest.contentAsOf ?? manifest.publishedAt,
        effectiveFrom: manifest.effectiveFrom,
        effectiveTo: manifest.effectiveTo,
        contentHash: chunkHash
      });
      expect(navigation.resolveAction({
        context: context(locale),
        target: "investments.funding.guide",
        citationRefs: [expected]
      })).not.toBeNull();
    }
  });

  it.each([
    ["en-US", "View funding steps"],
    ["az-AZ", "Mədaxil addımlarına bax"]
  ] as const)("emits a localized, citation-bound funding action for %s", (locale, label) => {
    const decision = navigation.evaluate({
      context: context(locale),
      target: "investments.funding.guide",
      citationRefs: [fundingEvidence[locale]]
    });

    expect(decision).toEqual({
      status: "allowed",
      target: "investments.funding.guide",
      action: {
        schemaVersion: "assistant-v3.in-app-navigation-action.v1",
        actionId: "view-investment-account-funding-guide",
        kind: "open-in-app",
        target: "investments.funding.guide",
        label,
        href: "/investments/guides/funding",
        citationRefs: ["product-knowledge-1"],
        catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION
      },
      reasonCodes: []
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.action)).toBe(true);
    expect(Object.isFrozen(decision.action?.citationRefs)).toBe(true);
  });

  it.each([
    {
      locale: "en-US",
      target: "investments.account-opening.guide",
      label: "View account-opening steps",
      href: "/investments/guides/account-opening",
      evidence: accountOpeningEvidence["en-US"]
    },
    {
      locale: "az-AZ",
      target: "investments.account-opening.guide",
      label: "Hesabın açılması addımlarına bax",
      href: "/investments/guides/account-opening",
      evidence: accountOpeningEvidence["az-AZ"]
    },
    {
      locale: "en-US",
      target: "investments.share-purchase.guide",
      label: "View share-purchase steps",
      href: "/investments/guides/share-purchase",
      evidence: sharePurchaseEvidence["en-US"]
    },
    {
      locale: "az-AZ",
      target: "investments.share-purchase.guide",
      label: "Səhm alışı addımlarına bax",
      href: "/investments/guides/share-purchase",
      evidence: sharePurchaseEvidence["az-AZ"]
    },
    {
      locale: "en-US",
      target: "investments.withdrawal.guide",
      label: "View withdrawal steps",
      href: "/investments/guides/withdrawal",
      evidence: withdrawalEvidence["en-US"]
    },
    {
      locale: "az-AZ",
      target: "investments.withdrawal.guide",
      label: "Məxaric addımlarına bax",
      href: "/investments/guides/withdrawal",
      evidence: withdrawalEvidence["az-AZ"]
    }
  ] as const)(
    "emits the exact evidence-bound $target action for $locale",
    ({ locale, target, label, href, evidence }) => {
      const decision = navigation.evaluate({
        context: context(locale),
        target,
        citationRefs: [evidence]
      });

      expect(decision).toMatchObject({
        status: "allowed",
        target,
        action: {
          schemaVersion: "assistant-v3.in-app-navigation-action.v1",
          kind: "open-in-app",
          target,
          label,
          href,
          citationRefs: [evidence.citationId],
          catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION
        }
      });
    }
  );

  it("pins every enabled guide to the matching approved bilingual publication", () => {
    const cases = [
      {
        facet: "account_opening",
        target: "investments.account-opening.guide",
        evidence: accountOpeningEvidence
      },
      {
        facet: "purchase_process",
        target: "investments.share-purchase.guide",
        evidence: sharePurchaseEvidence
      },
      {
        facet: "withdrawal",
        target: "investments.withdrawal.guide",
        evidence: withdrawalEvidence
      }
    ] as const;

    for (const testCase of cases) {
      const documents = approvedProductKnowledgeDocuments.filter(({ manifest }) =>
        manifest.facets.includes(testCase.facet)
      );
      expect(documents).toHaveLength(2);
      for (const { manifest, content } of documents) {
        const expected = testCase.evidence[manifest.locale];
        const chunkHash = createHash("sha256")
          .update(`${manifest.title}\n\n${content}`, "utf8")
          .digest("hex");
        expect(expected).toMatchObject({
          sourceId: `${manifest.sourceId}@${manifest.version}`,
          url: manifest.url,
          sourceAsOf: manifest.contentAsOf ?? manifest.publishedAt,
          effectiveFrom: manifest.effectiveFrom,
          effectiveTo: manifest.effectiveTo,
          contentHash: chunkHash
        });
        expect(navigation.resolveAction({
          context: context(manifest.locale),
          target: testCase.target,
          citationRefs: [expected]
        })).not.toBeNull();
      }
    }
  });

  it("fails closed for price alerts even when a caller enables the feature and forges evidence", () => {
    const decision = navigation.evaluate({
      context: context(),
      target: "investments.price-alerts.create",
      citationRefs: [fundingEvidence["en-US"]]
    });

    expect(decision).toEqual({
      status: "denied",
      target: "investments.price-alerts.create",
      action: null,
      reasonCodes: ["TARGET_DISABLED"]
    });
  });

  it("requires the current locale's exact approved evidence version", () => {
    const wrongLocale = navigation.evaluate({
      context: context("az-AZ"),
      target: "investments.funding.guide",
      citationRefs: [fundingEvidence["en-US"]]
    });
    const tamperedHash = navigation.evaluate({
      context: context(),
      target: "investments.funding.guide",
      citationRefs: [{ ...fundingEvidence["en-US"], contentHash: "0".repeat(64) }]
    });
    const tamperedUrl = navigation.evaluate({
      context: context(),
      target: "investments.funding.guide",
      citationRefs: [{
        ...fundingEvidence["en-US"],
        url: "https://user:password@knowledge.demo-invest.invalid/en/funding"
      }]
    });

    expect(wrongLocale).toMatchObject({ status: "denied", action: null });
    expect(wrongLocale.reasonCodes).toContain("EVIDENCE_MISSING");
    expect(tamperedHash.reasonCodes).toContain("EVIDENCE_MISSING");
    expect(tamperedUrl.reasonCodes).toContain("EVIDENCE_MISSING");
  });

  it("does not authorize one guide with another guide's valid citation", () => {
    const accountFromWithdrawal = navigation.evaluate({
      context: context(),
      target: "investments.account-opening.guide",
      citationRefs: [withdrawalEvidence["en-US"]]
    });
    const withdrawalFromFunding = navigation.evaluate({
      context: context(),
      target: "investments.withdrawal.guide",
      citationRefs: [fundingEvidence["en-US"]]
    });
    const purchaseFromFunding = navigation.evaluate({
      context: context(),
      target: "investments.share-purchase.guide",
      citationRefs: [fundingEvidence["en-US"]]
    });

    expect(accountFromWithdrawal).toMatchObject({ status: "denied", action: null });
    expect(accountFromWithdrawal.reasonCodes).toContain("EVIDENCE_MISSING");
    expect(withdrawalFromFunding).toMatchObject({ status: "denied", action: null });
    expect(withdrawalFromFunding.reasonCodes).toContain("EVIDENCE_MISSING");
    expect(purchaseFromFunding).toMatchObject({ status: "denied", action: null });
    expect(purchaseFromFunding.reasonCodes).toContain("EVIDENCE_MISSING");
  });

  it("does not emit funding navigation before its catalog/evidence effective time", () => {
    const decision = navigation.evaluate({
      context: context("en-US", { requestedAt: "2026-07-20T23:59:59.999Z" }),
      target: "investments.funding.guide",
      citationRefs: [fundingEvidence["en-US"]]
    });

    expect(decision).toMatchObject({ status: "denied", action: null });
    expect(decision.reasonCodes).toContain("CATALOG_NOT_EFFECTIVE");
    expect(decision.reasonCodes).toContain("EVIDENCE_MISSING");
  });

  it.each([
    [
      { featureSnapshot: { version: "features-v1", flags: { approvedKnowledge: false } } },
      "FEATURE_DISABLED"
    ],
    [{ consentScopes: ["assistant_use"] }, "CONSENT_DENIED"],
    [{ entitlements: ["assistant_access"] }, "ENTITLEMENT_DENIED"],
    [{ capabilities: [] }, "CAPABILITY_DENIED"],
    [{ channel: "mastra-studio" }, "CHANNEL_DENIED"]
  ] as const)("denies when trusted policy context lacks a prerequisite", (overrides, reason) => {
    const decision = navigation.evaluate({
      context: context("en-US", overrides as Partial<TrustedRequestContext>),
      target: "investments.funding.guide",
      citationRefs: [fundingEvidence["en-US"]]
    });

    expect(decision).toMatchObject({ status: "denied", action: null });
    expect(decision.reasonCodes).toContain(reason);
    expect(navigation.resolveAction({
      context: context("en-US", overrides as Partial<TrustedRequestContext>),
      target: "investments.funding.guide",
      citationRefs: [fundingEvidence["en-US"]]
    })).toBeNull();
  });

  it("rejects malformed context, unknown targets, and duplicate citation identities", () => {
    const invalidContext = navigation.evaluate({
      context: context("en-US", { requestedAt: "not-a-date" }),
      target: "investments.funding.guide",
      citationRefs: [fundingEvidence["en-US"]]
    });
    const unknownTarget = navigation.evaluate({
      context: context(),
      target: "https://evil.example/fund" as "investments.funding.guide",
      citationRefs: [fundingEvidence["en-US"]]
    });
    const duplicateCitation = navigation.evaluate({
      context: context(),
      target: "investments.funding.guide",
      citationRefs: [fundingEvidence["en-US"], fundingEvidence["en-US"]]
    });
    const malformedCitation = navigation.evaluate({
      context: context(),
      target: "investments.funding.guide",
      citationRefs: [
        fundingEvidence["en-US"],
        null as unknown as GovernedNavigationCitationRef
      ]
    });

    expect(invalidContext.reasonCodes).toEqual(["INVALID_TRUSTED_CONTEXT"]);
    expect(unknownTarget.reasonCodes).toEqual(["TARGET_NOT_ALLOWLISTED"]);
    expect(duplicateCitation.reasonCodes).toContain("EVIDENCE_INELIGIBLE");
    expect(malformedCitation).toMatchObject({ status: "denied", action: null });
    expect(malformedCitation.reasonCodes).toContain("EVIDENCE_INELIGIBLE");
  });
});

describe("governed navigation path and catalog controls", () => {
  it.each([
    ["How do I open an investment account?", "investments.account-opening.guide"],
    ["İnvestisiya hesabını necə aça bilərəm?", "investments.account-opening.guide"],
    ["How do I fund my investment account?", "investments.funding.guide"],
    ["İnvestisiya hesabına necə mədaxil edim?", "investments.funding.guide"],
    ["How do I buy company shares?", "investments.share-purchase.guide"],
    ["How is a purchase operation carried out?", "investments.share-purchase.guide"],
    ["How do I review and confirm a stock purchase?", "investments.share-purchase.guide"],
    ["Şirkət səhmlərini necə ala bilərəm?", "investments.share-purchase.guide"],
    ["Alış əməliyyatı necə həyata keçirilir?", "investments.share-purchase.guide"],
    ["Səhm alış sifarişini necə yoxlayım?", "investments.share-purchase.guide"],
    ["What are the withdrawal limits?", "investments.withdrawal.guide"],
    ["İnvestisiya hesabından pulu necə çıxarım?", "investments.withdrawal.guide"],
    ["How do I set a price alert for AAPL?", "investments.price-alerts.create"]
  ] as const)("detects %s as the governed target", (message, target) => {
    expect(detectGovernedNavigationTarget(message)).toBe(target);
  });

  it.each([
    "What is an ADR?",
    "Explain AAPL",
    "Show my portfolio",
    "Should I buy NVDA?",
    "Buy 100 USD of AAPL",
    "What is a depositary receipt?"
  ])("does not manufacture a guide target for %s", (message) => {
    expect(detectGovernedNavigationTarget(message)).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,boom",
    "//evil.example/investments/guides/funding",
    "https://user:password@example.com/investments/guides/funding",
    "/investments/guides/funding?amount=100",
    "/investments/guides/funding#confirm",
    "/investments/%66unding",
    "/investments/../admin",
    "/investments/orders"
  ])("rejects unapproved or unsafe route %s", (candidate) => {
    expect(isAllowlistedInAppPath(candidate)).toBe(false);
  });

  it("accepts only the five reviewed route constants", () => {
    expect(isAllowlistedInAppPath("/investments/guides/account-opening")).toBe(true);
    expect(isAllowlistedInAppPath("/investments/guides/funding")).toBe(true);
    expect(isAllowlistedInAppPath("/investments/guides/share-purchase")).toBe(true);
    expect(isAllowlistedInAppPath("/investments/guides/withdrawal")).toBe(true);
    expect(isAllowlistedInAppPath("/investments/price-alerts/create")).toBe(true);
  });

  it("exposes immutable readiness metadata without publishing route overrides", () => {
    const metadata = getGovernedNavigationCatalogMetadata();

    expect(metadata).toMatchObject({
      schemaVersion: "assistant-v3.navigation-catalog-metadata.v1",
      catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION,
      entries: [
        {
          target: "investments.account-opening.guide",
          status: "enabled",
          evidenceLocales: ["en-US", "az-AZ"],
          readinessBlocker: null
        },
        {
          target: "investments.funding.guide",
          status: "enabled",
          evidenceLocales: ["en-US", "az-AZ"],
          readinessBlocker: null
        },
        {
          target: "investments.share-purchase.guide",
          status: "enabled",
          evidenceLocales: ["en-US", "az-AZ"],
          readinessBlocker: null
        },
        {
          target: "investments.withdrawal.guide",
          status: "enabled",
          evidenceLocales: ["en-US", "az-AZ"],
          readinessBlocker: null
        },
        {
          target: "investments.price-alerts.create",
          status: "disabled",
          evidenceLocales: [],
          readinessBlocker: "MISSING_APPROVED_BILINGUAL_EVIDENCE"
        }
      ]
    });
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.entries)).toBe(true);
    expect(Object.isFrozen(metadata.entries[0])).toBe(true);
    expect(Object.isFrozen(metadata.entries[0]?.evidenceLocales)).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain("/investments/");
  });
});
