import { describe, expect, it } from "vitest";

import {
  APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
  APPROVED_FINANCIAL_EDUCATION_BINDINGS,
  APPROVED_FINANCIAL_EDUCATION_SOURCE_HOSTS,
  approvedFinancialEducationAuthority,
  approvedFinancialEducationDocuments,
  createApprovedFinancialEducationRegistry
} from "../src/data/approved-financial-education.js";
import type {
  ApprovedFinancialEducationDocument,
  FinancialEducationAuthorityBinding
} from "../src/domain/financial-education.js";
import {
  financialEducationAuthorityBinding,
  FinancialEducationRegistry
} from "../src/services/financial-education-registry.js";
import {
  ApprovedFinancialEducationService
} from "../src/services/financial-education-retrieval.js";

const AS_OF = "2026-08-01T00:00:00.000Z";

function bindingKey(binding: FinancialEducationAuthorityBinding): string {
  return JSON.stringify(binding);
}

function context(locale: "en-US" | "az-AZ") {
  return {
    requestId: `approved-financial-education-${locale}`,
    locale,
    jurisdiction: "AZ" as const,
    channel: "customer_chat" as const,
    asOf: AS_OF
  };
}

function retrieval(): ApprovedFinancialEducationService {
  return new ApprovedFinancialEducationService({
    registry: createApprovedFinancialEducationRegistry(),
    minimumScore: 0.2,
    topK: 3
  });
}

describe("approved bilingual financial-education corpus", () => {
  it("accepts only the exact independently bound bilingual corpus", () => {
    const registry = createApprovedFinancialEducationRegistry();
    const documents = registry.allDocuments();

    expect(APPROVED_FINANCIAL_EDUCATION_SOURCE_HOSTS).toEqual([
      "www.investor.gov",
      "www.govinfo.gov"
    ]);
    expect(documents).toHaveLength(10);
    expect(APPROVED_FINANCIAL_EDUCATION_BINDINGS).toHaveLength(10);
    expect(
      new Set(documents.map(({ manifest }) => manifest.translationGroupId)).size
    ).toBe(5);
    expect(
      registry.eligibleDocuments(context("en-US"))
    ).toHaveLength(5);
    expect(
      registry.eligibleDocuments(context("az-AZ"))
    ).toHaveLength(5);

    const approvedKeys = new Set(
      APPROVED_FINANCIAL_EDUCATION_BINDINGS.map(bindingKey)
    );
    for (const document of documents) {
      const binding = financialEducationAuthorityBinding(
        document,
        APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID
      );
      expect(approvedKeys.has(bindingKey(binding))).toBe(true);
      expect(
        approvedFinancialEducationAuthority.verifier.verify(binding)
      ).toBe(true);
      expect(APPROVED_FINANCIAL_EDUCATION_SOURCE_HOSTS).toContain(
        new URL(document.manifest.sourceUrl).hostname
      );
      expect(document).not.toHaveProperty("answer");
      expect(document).not.toHaveProperty("template");
    }
  });

  it("retrieves TWR propositions through the same query path", async () => {
    const result = await retrieval().retrieve({
      query: "TWR nədir?",
      context: context("az-AZ")
    });

    expect(result.status).toBe("grounded");
    expect(result.propositions[0]).toMatchObject({
      propositionId: "twr-compounded-growth",
      sourceId: "federal-register-time-weighted-return-az",
      locale: "az-AZ"
    });
    expect(result.citations[0]?.sourceUrl).toContain("www.govinfo.gov");
  });

  it("rejects content, manifest, or source-authority drift", () => {
    const first = approvedFinancialEducationDocuments[0]!;
    const contentTampered: ApprovedFinancialEducationDocument = {
      manifest: { ...first.manifest },
      propositions: [
        {
          ...first.propositions[0]!,
          text: `${first.propositions[0]!.text} Unapproved addition.`
        },
        ...first.propositions.slice(1)
      ]
    };
    expect(() => new FinancialEducationRegistry({
      documents: [
        contentTampered,
        ...approvedFinancialEducationDocuments.slice(1)
      ],
      authority: approvedFinancialEducationAuthority
    })).toThrow(/content checksum mismatch/u);

    const manifestTampered: ApprovedFinancialEducationDocument = {
      manifest: {
        ...first.manifest,
        title: `${first.manifest.title} changed`
      },
      propositions: first.propositions
    };
    expect(() => new FinancialEducationRegistry({
      documents: [
        manifestTampered,
        ...approvedFinancialEducationDocuments.slice(1)
      ],
      authority: approvedFinancialEducationAuthority
    })).toThrow(/approval verification failed/u);

    const sourceTampered: ApprovedFinancialEducationDocument = {
      manifest: {
        ...first.manifest,
        sourceUrl: "https://example.com/unapproved"
      },
      propositions: first.propositions
    };
    expect(() => new FinancialEducationRegistry({
      documents: [
        sourceTampered,
        ...approvedFinancialEducationDocuments.slice(1)
      ],
      authority: approvedFinancialEducationAuthority
    })).toThrow(/approved HTTPS authority/u);
  });

  it("retrieves bond-rate sensitivity in English and ASCII Azerbaijani", async () => {
    const service = retrieval();
    const english = await service.retrieve({
      query:
        "Why do fixed-rate bond prices fall when market interest rates rise?",
      context: context("en-US")
    });
    const azerbaijani = await service.retrieve({
      query:
        "Faiz dereceleri qalxanda sabit faizli istiqraz qiymetlerine ne olur?",
      context: context("az-AZ")
    });

    expect(english.status).toBe("grounded");
    expect(english.propositions[0]).toMatchObject({
      propositionId: "rate-price-direction",
      sourceId: "investor-gov-bond-rate-risk-en",
      sourceVersion: "2026-07-28.v1",
      locale: "en-US"
    });
    expect(english.citations[0]?.sourceUrl).toContain(
      "www.investor.gov"
    );
    expect(azerbaijani.status).toBe("grounded");
    expect(azerbaijani.propositions[0]).toMatchObject({
      propositionId: "rate-price-direction",
      sourceId: "investor-gov-bond-rate-risk-az",
      locale: "az-AZ"
    });
    expect(
      azerbaijani.propositions.every(({ locale }) => locale === "az-AZ")
    ).toBe(true);
  });

  it("retrieves ETF/index-fund structure and fee evidence without a prepared answer", async () => {
    const service = retrieval();
    const etf = await service.retrieve({
      query: "ETF nədir və fond xərcləri xalis aktiv dəyərinə necə təsir edir?",
      context: context("az-AZ")
    });
    const indexFund = await service.retrieve({
      query:
        "What is an index fund and why can fees or tracking error make it lag the index?",
      context: context("en-US")
    });

    expect(etf.status).toBe("grounded");
    expect(etf.propositions.map(({ propositionId }) => propositionId)).toEqual(
      expect.arrayContaining(["pooled-portfolio", "fees-from-nav"])
    );
    expect(
      etf.propositions.every(({ sourceId }) =>
        sourceId === "investor-gov-etf-basics-fees-az"
      )
    ).toBe(true);

    expect(indexFund.status).toBe("grounded");
    expect(
      indexFund.propositions.map(({ propositionId }) => propositionId)
    ).toEqual(
      expect.arrayContaining(["index-tracking", "fees-tracking-error"])
    );
    expect(
      indexFund.propositions.every(({ text }, index) =>
        text === indexFund.citations[index]?.excerpt
      )
    ).toBe(true);
  });

  it("keeps a short ETF definition query on the exact approved ETF source", async () => {
    const result = await retrieval().retrieve({
      query: "ETF nədir?",
      context: context("az-AZ")
    });

    expect(result.status).toBe("grounded");
    expect(result.propositions).toHaveLength(3);
    expect(
      result.propositions.every(({ sourceId }) =>
        sourceId === "investor-gov-etf-basics-fees-az"
      )
    ).toBe(true);
    expect(result.propositions[0]?.propositionId).toBe("pooled-portfolio");
    expect(result.propositions.map(({ propositionId }) => propositionId))
      .toEqual(expect.arrayContaining([
        "pooled-portfolio",
        "fees-from-nav",
        "market-price-nav"
      ]));
  });

  it("retrieves diversification and rebalancing evidence while refusing personalized allocation", async () => {
    const service = retrieval();
    const education = await service.retrieve({
      query:
        "Şaxələndirmə və yenidən balanslaşdırma nədir, xərclər niyə nəzərə alınır?",
      context: context("az-AZ")
    });
    const personalized = await service.retrieve({
      query: "Mənim üçün hansı bölgünü seçim və nə vaxt yenidən balanslaşdırım?",
      context: context("az-AZ")
    });

    expect(education.status).toBe("grounded");
    expect(
      education.propositions.map(({ propositionId }) => propositionId)
    ).toEqual(
      expect.arrayContaining([
        "diversification-purpose",
        "rebalancing-definition",
        "cost-tax-consideration"
      ])
    );
    expect(personalized).toMatchObject({
      status: "not_permitted",
      propositions: [],
      citations: [],
      reasonCodes: ["personalized_recommendation_not_permitted"]
    });
  });
});
