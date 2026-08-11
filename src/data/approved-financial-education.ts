import {
  FINANCIAL_EDUCATION_DOCUMENT_SCHEMA_VERSION,
  type ApprovedFinancialEducationDocument,
  type FinancialEducationAuthorityBinding,
  type FinancialEducationAuthorityPolicy,
  type FinancialEducationProposition
} from "../domain/financial-education.js";
import {
  FinancialEducationRegistry
} from "../services/financial-education-registry.js";

export const APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID =
  "project-reviewed-financial-education-2026-07" as const;

export const APPROVED_FINANCIAL_EDUCATION_SOURCE_HOSTS = Object.freeze([
  "www.investor.gov",
  "www.govinfo.gov"
] as const);

const VERSION = "2026-07-28.v1";
const PUBLISHED_AT = "2026-07-28T00:00:00.000Z";
const REVIEWED_AT = "2026-07-28T01:00:00.000Z";
const EFFECTIVE_FROM = "2026-07-28T02:00:00.000Z";
const REVIEW_DUE_AT = "2027-07-28T01:00:00.000Z";
const EFFECTIVE_TO = "2027-07-28T02:00:00.000Z";

const BOND_SOURCE_URL =
  "https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-86";
const ETF_SOURCE_URL =
  "https://www.investor.gov/introduction-investing/investing-basics/investment-products/mutual-funds-and-exchange-traded-2";
const INDEX_FUND_SOURCE_URL =
  "https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-26";
const DIVERSIFICATION_SOURCE_URL =
  "https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset";
const TWR_SOURCE_URL =
  "https://www.govinfo.gov/content/pkg/FR-2024-03-12/pdf/2024-03473.pdf";

const BOND_EN = Object.freeze([
  {
    propositionId: "rate-price-direction",
    section: "Interest-rate risk",
    text:
      "Market interest rates and fixed-rate bond prices generally move in opposite directions: when rates rise, fixed-rate bond prices generally fall."
  },
  {
    propositionId: "maturity-sensitivity",
    section: "Maturity",
    text:
      "Longer-maturity bonds generally have more interest-rate risk than otherwise similar bonds with shorter maturities."
  },
  {
    propositionId: "market-price-not-guaranteed",
    section: "Guarantees and market value",
    text:
      "A government guarantee on principal and interest does not guarantee a bond's market price if the bond is sold before maturity."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const BOND_AZ = Object.freeze([
  {
    propositionId: "rate-price-direction",
    section: "Faiz dərəcəsi riski",
    text:
      "Bazar faiz dərəcələri ilə sabit faizli istiqrazların qiymətləri adətən əks istiqamətdə hərəkət edir: faizlər yüksəldikdə sabit faizli istiqrazların qiymətləri adətən azalır."
  },
  {
    propositionId: "maturity-sensitivity",
    section: "Ödəmə müddəti",
    text:
      "Daha uzun ödəmə müddətli istiqrazlar, digər şərtlər eyni olduqda, daha qısa müddətli istiqrazlardan adətən daha çox faiz dərəcəsi riski daşıyır."
  },
  {
    propositionId: "market-price-not-guaranteed",
    section: "Zəmanət və bazar dəyəri",
    text:
      "Dövlətin əsas məbləğə və faizə verdiyi zəmanət istiqraz ödəmə müddətindən əvvəl satıldıqda onun bazar qiymətinə zəmanət vermir."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const ETF_EN = Object.freeze([
  {
    propositionId: "pooled-portfolio",
    section: "ETF structure",
    text:
      "An ETF pools money from many investors into a portfolio of securities or other assets, and each share represents part ownership of that portfolio."
  },
  {
    propositionId: "fees-from-nav",
    section: "ETF costs",
    text:
      "ETF operating costs are passed to investors through fees and expenses deducted from the fund's net asset value."
  },
  {
    propositionId: "market-price-nav",
    section: "ETF market price",
    text:
      "ETF shares trade at market prices that can be above or below the fund's net asset value."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const ETF_AZ = Object.freeze([
  {
    propositionId: "pooled-portfolio",
    section: "ETF strukturu",
    text:
      "ETF çoxsaylı investorların vəsaitini qiymətli kağızlar və ya digər aktivlər portfelində birləşdirir və hər pay həmin portfeldə qismən mülkiyyəti təmsil edir."
  },
  {
    propositionId: "fees-from-nav",
    section: "ETF xərcləri",
    text:
      "ETF-in əməliyyat xərcləri fondun xalis aktiv dəyərindən çıxılan haqq və xərclər vasitəsilə investorlara ötürülür."
  },
  {
    propositionId: "market-price-nav",
    section: "ETF bazar qiyməti",
    text:
      "ETF payları fondun xalis aktiv dəyərindən yuxarı və ya aşağı ola bilən bazar qiymətləri ilə ticarət olunur."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const INDEX_FUND_EN = Object.freeze([
  {
    propositionId: "index-tracking",
    section: "Index-fund definition",
    text:
      "An index fund is a mutual fund or ETF that seeks to track the returns of a market index."
  },
  {
    propositionId: "tracking-methods",
    section: "Tracking an index",
    text:
      "An index fund may hold all securities in its index or only a sample, so its results may not exactly match the index."
  },
  {
    propositionId: "fees-tracking-error",
    section: "Index-fund costs and tracking",
    text:
      "Fees, trading costs, and tracking error can cause an index fund to underperform its index."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const INDEX_FUND_AZ = Object.freeze([
  {
    propositionId: "index-tracking",
    section: "İndeks fondunun tərifi",
    text:
      "İndeks fondu bazar indeksinin gəlirlərini izləməyə çalışan qarşılıqlı fond və ya ETF-dir."
  },
  {
    propositionId: "tracking-methods",
    section: "İndeksin izlənməsi",
    text:
      "İndeks fondu indeksdəki bütün qiymətli kağızları və ya yalnız onların bir hissəsini saxlaya bilər, buna görə nəticələri indekslə tam üst-üstə düşməyə bilər."
  },
  {
    propositionId: "fees-tracking-error",
    section: "İndeks fondu xərcləri və izləmə",
    text:
      "Haqlar, ticarət xərcləri və izləmə fərqi indeks fondunun öz indeksindən daha zəif nəticə göstərməsinə səbəb ola bilər."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const DIVERSIFICATION_EN = Object.freeze([
  {
    propositionId: "diversification-purpose",
    section: "Diversification",
    text:
      "Diversification spreads money across different investments to reduce dependence on any single investment's outcome."
  },
  {
    propositionId: "rebalancing-definition",
    section: "Rebalancing",
    text:
      "Rebalancing brings a portfolio back toward its original asset-allocation mix when holdings drift as investments grow at different rates."
  },
  {
    propositionId: "cost-tax-consideration",
    section: "Rebalancing costs",
    text:
      "Before rebalancing, investors should consider whether the chosen method may create transaction fees or tax consequences."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const DIVERSIFICATION_AZ = Object.freeze([
  {
    propositionId: "diversification-purpose",
    section: "Şaxələndirmə",
    text:
      "Şaxələndirmə hər hansı bir investisiyanın nəticəsindən asılılığı azaltmaq üçün vəsaiti müxtəlif investisiyalar arasında bölür."
  },
  {
    propositionId: "rebalancing-definition",
    section: "Yenidən balanslaşdırma",
    text:
      "İnvestisiyalar fərqli sürətlə böyüdükcə mövqelər ilkin bölgüdən uzaqlaşarsa, yenidən balanslaşdırma portfeli ilkin aktiv bölgüsünə doğru qaytarır."
  },
  {
    propositionId: "cost-tax-consideration",
    section: "Yenidən balanslaşdırma xərcləri",
    text:
      "Yenidən balanslaşdırmadan əvvəl seçilmiş üsulun əməliyyat haqları və ya vergi nəticələri yaradıb-yaratmayacağı nəzərə alınmalıdır."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const TWR_EN = Object.freeze([
  {
    propositionId: "twr-compounded-growth",
    section: "Time-weighted return",
    text:
      "A time-weighted return (TWR) is a method for reporting investment performance over a measurement period while reducing the effect of when external cash flows occur."
  },
  {
    propositionId: "twr-cash-flow-treatment",
    section: "External cash flows",
    text:
      "Time-weighted and money-weighted return methods can report different results because they reflect the timing of external cash flows differently."
  },
  {
    propositionId: "mwr-distinction",
    section: "Money-weighted return",
    text:
      "A money-weighted return, such as an internal rate of return, is another performance-reporting method and is more directly affected by external cash-flow timing."
  }
] as const satisfies readonly FinancialEducationProposition[]);

const TWR_AZ = Object.freeze([
  {
    propositionId: "twr-compounded-growth",
    section: "Vaxt üzrə çəkilən gəlirlilik",
    text:
      "Vaxt üzrə çəkilən gəlirlilik (TWR) xarici pul axınlarının nə vaxt baş verdiyinin təsirini azaltmaqla ölçmə dövrü üzrə investisiya nəticəsini göstərən üsuldur."
  },
  {
    propositionId: "twr-cash-flow-treatment",
    section: "Xarici pul axınları",
    text:
      "Vaxt üzrə və pul üzrə çəkilən gəlirlilik üsulları xarici pul axınlarının vaxtını fərqli əks etdirdiyi üçün müxtəlif nəticələr göstərə bilər."
  },
  {
    propositionId: "mwr-distinction",
    section: "Pul üzrə çəkilən gəlirlilik",
    text:
      "Daxili gəlirlilik norması kimi pul üzrə çəkilən gəlirlilik başqa bir nəticə hesablama üsuludur və xarici pul axınlarının vaxtından daha birbaşa təsirlənir."
  }
] as const satisfies readonly FinancialEducationProposition[]);

function controlledDocument(input: {
  readonly sourceId: string;
  readonly translationGroupId: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly locale: "en-US" | "az-AZ";
  readonly propositions: readonly FinancialEducationProposition[];
  readonly contentSha256: string;
}): ApprovedFinancialEducationDocument {
  return Object.freeze({
    manifest: Object.freeze({
      schemaVersion: FINANCIAL_EDUCATION_DOCUMENT_SCHEMA_VERSION,
      sourceId: input.sourceId,
      version: VERSION,
      translationGroupId: input.translationGroupId,
      title: input.title,
      sourceUrl: input.sourceUrl,
      locale: input.locale,
      jurisdiction: "AZ",
      audience: "customer",
      channel: "customer_chat",
      approvalStatus: "approved",
      approvalRef:
        `controlled-approval:${input.sourceId}:${VERSION}`,
      publishedAt: PUBLISHED_AT,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: EFFECTIVE_TO,
      reviewedAt: REVIEWED_AT,
      reviewDueAt: REVIEW_DUE_AT,
      contentSha256: input.contentSha256
    }),
    propositions: input.propositions
  });
}

export const approvedFinancialEducationDocuments = Object.freeze([
  controlledDocument({
    sourceId: "investor-gov-bond-rate-risk-en",
    translationGroupId: "investor-gov-bond-rate-risk",
    title: "Investor.gov bond interest-rate risk — controlled excerpt",
    sourceUrl: BOND_SOURCE_URL,
    locale: "en-US",
    propositions: BOND_EN,
    contentSha256:
      "2917ff76c980e0488687e1abc04c04b2aabe1888035cc3b4f5d3b088d2681e38"
  }),
  controlledDocument({
    sourceId: "investor-gov-bond-rate-risk-az",
    translationGroupId: "investor-gov-bond-rate-risk",
    title:
      "Investor.gov istiqraz faiz riski — nəzarətli Azərbaycan dilinə tərcümə",
    sourceUrl: BOND_SOURCE_URL,
    locale: "az-AZ",
    propositions: BOND_AZ,
    contentSha256:
      "113465c1ecb1f83c86d785c911058dc474a0d5bd17038f27bed852a3a6064abc"
  }),
  controlledDocument({
    sourceId: "investor-gov-etf-basics-fees-en",
    translationGroupId: "investor-gov-etf-basics-fees",
    title: "Investor.gov ETF basics and fees — controlled excerpt",
    sourceUrl: ETF_SOURCE_URL,
    locale: "en-US",
    propositions: ETF_EN,
    contentSha256:
      "a3484c9502892ea17a4690eb3286e96626a3ab0cb486ee23e3a35aa6a614e90b"
  }),
  controlledDocument({
    sourceId: "investor-gov-etf-basics-fees-az",
    translationGroupId: "investor-gov-etf-basics-fees",
    title:
      "Investor.gov ETF əsasları və haqları — nəzarətli Azərbaycan dilinə tərcümə",
    sourceUrl: ETF_SOURCE_URL,
    locale: "az-AZ",
    propositions: ETF_AZ,
    contentSha256:
      "dfab5fbef9da6d2c19d668ef0f4072d36655e52305f1079466323b31775c0511"
  }),
  controlledDocument({
    sourceId: "investor-gov-index-funds-en",
    translationGroupId: "investor-gov-index-funds",
    title: "Investor.gov index funds — controlled excerpt",
    sourceUrl: INDEX_FUND_SOURCE_URL,
    locale: "en-US",
    propositions: INDEX_FUND_EN,
    contentSha256:
      "c357850ff28d9c617fda95e008b8dd95b862d0bc6b893cb31d7032323d62a6bc"
  }),
  controlledDocument({
    sourceId: "investor-gov-index-funds-az",
    translationGroupId: "investor-gov-index-funds",
    title:
      "Investor.gov indeks fondları — nəzarətli Azərbaycan dilinə tərcümə",
    sourceUrl: INDEX_FUND_SOURCE_URL,
    locale: "az-AZ",
    propositions: INDEX_FUND_AZ,
    contentSha256:
      "4fa9e064e6c139b771ff8667a8bd7f0b0a736f4b0ad9e6d98b697a69bb193669"
  }),
  controlledDocument({
    sourceId: "investor-gov-diversification-rebalancing-en",
    translationGroupId: "investor-gov-diversification-rebalancing",
    title:
      "Investor.gov diversification and rebalancing — controlled excerpt",
    sourceUrl: DIVERSIFICATION_SOURCE_URL,
    locale: "en-US",
    propositions: DIVERSIFICATION_EN,
    contentSha256:
      "4331d11b813d175ef1d5cd85a45c5e99d11be0f1e71abf04197b0da3777832da"
  }),
  controlledDocument({
    sourceId: "investor-gov-diversification-rebalancing-az",
    translationGroupId: "investor-gov-diversification-rebalancing",
    title:
      "Investor.gov şaxələndirmə və yenidən balanslaşdırma — nəzarətli Azərbaycan dilinə tərcümə",
    sourceUrl: DIVERSIFICATION_SOURCE_URL,
    locale: "az-AZ",
    propositions: DIVERSIFICATION_AZ,
    contentSha256:
      "e00ab0c857a4c3e547350e1b03e1e717c677b38f2a6302383e0e5ba4f47dbccd"
  }),
  controlledDocument({
    sourceId: "federal-register-time-weighted-return-en",
    translationGroupId: "federal-register-time-weighted-return",
    title: "Federal Register performance methods — project-authored summary",
    sourceUrl: TWR_SOURCE_URL,
    locale: "en-US",
    propositions: TWR_EN,
    contentSha256:
      "8ee64d4a7bc8774001868589309cc663623a5184408fcefe00e0449d67499caf"
  }),
  controlledDocument({
    sourceId: "federal-register-time-weighted-return-az",
    translationGroupId: "federal-register-time-weighted-return",
    title:
      "Federal Register nəticə üsulları — layihənin Azərbaycan dilində xülasəsi",
    sourceUrl: TWR_SOURCE_URL,
    locale: "az-AZ",
    propositions: TWR_AZ,
    contentSha256:
      "c990a71b967c78b3171ee1943cb6873122f27a17ff55f84494461a07bea16d31"
  })
] as const satisfies readonly ApprovedFinancialEducationDocument[]);

/**
 * This is intentionally a separate, immutable approval surface. Final values
 * are populated from the controlled approval record, never generated from the
 * document array during application startup.
 */
export const APPROVED_FINANCIAL_EDUCATION_BINDINGS = Object.freeze(
  [
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "investor-gov-bond-rate-risk-en",
      version: VERSION,
      locale: "en-US",
      approvalRef:
        "controlled-approval:investor-gov-bond-rate-risk-en:2026-07-28.v1",
      contentSha256:
        "2917ff76c980e0488687e1abc04c04b2aabe1888035cc3b4f5d3b088d2681e38",
      manifestBindingSha256:
        "b895a5ccc263275d9d485b3b0bd7a24cdb133850d924da9260ab9375d1fb5966"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "investor-gov-bond-rate-risk-az",
      version: VERSION,
      locale: "az-AZ",
      approvalRef:
        "controlled-approval:investor-gov-bond-rate-risk-az:2026-07-28.v1",
      contentSha256:
        "113465c1ecb1f83c86d785c911058dc474a0d5bd17038f27bed852a3a6064abc",
      manifestBindingSha256:
        "4d1aef5df3341870a0df7219a1c38f8800dab14e42573685582f72aa40a82bd5"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "investor-gov-etf-basics-fees-en",
      version: VERSION,
      locale: "en-US",
      approvalRef:
        "controlled-approval:investor-gov-etf-basics-fees-en:2026-07-28.v1",
      contentSha256:
        "a3484c9502892ea17a4690eb3286e96626a3ab0cb486ee23e3a35aa6a614e90b",
      manifestBindingSha256:
        "d87a404fb209dc5feae22b28a10563538b5fba2f45f2a8778bd6c5fe41416f3e"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "investor-gov-etf-basics-fees-az",
      version: VERSION,
      locale: "az-AZ",
      approvalRef:
        "controlled-approval:investor-gov-etf-basics-fees-az:2026-07-28.v1",
      contentSha256:
        "dfab5fbef9da6d2c19d668ef0f4072d36655e52305f1079466323b31775c0511",
      manifestBindingSha256:
        "6b245a424cf231f90d5e0d2fa557f54af1acbd07d47015e06773faf16fa685af"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "investor-gov-index-funds-en",
      version: VERSION,
      locale: "en-US",
      approvalRef:
        "controlled-approval:investor-gov-index-funds-en:2026-07-28.v1",
      contentSha256:
        "c357850ff28d9c617fda95e008b8dd95b862d0bc6b893cb31d7032323d62a6bc",
      manifestBindingSha256:
        "ad347b8becf45eba2157c344e49a626637bce622343419fab5751160a6ef85c1"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "investor-gov-index-funds-az",
      version: VERSION,
      locale: "az-AZ",
      approvalRef:
        "controlled-approval:investor-gov-index-funds-az:2026-07-28.v1",
      contentSha256:
        "4fa9e064e6c139b771ff8667a8bd7f0b0a736f4b0ad9e6d98b697a69bb193669",
      manifestBindingSha256:
        "b4dcb76e8153740eb53b372987b1156945b1aee9865e112f512fa70b3eeee63a"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "investor-gov-diversification-rebalancing-en",
      version: VERSION,
      locale: "en-US",
      approvalRef:
        "controlled-approval:investor-gov-diversification-rebalancing-en:2026-07-28.v1",
      contentSha256:
        "4331d11b813d175ef1d5cd85a45c5e99d11be0f1e71abf04197b0da3777832da",
      manifestBindingSha256:
        "fa80561e9701215825d2495f9ae75206e0956b29218d58731f6a780f9e270c46"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "investor-gov-diversification-rebalancing-az",
      version: VERSION,
      locale: "az-AZ",
      approvalRef:
        "controlled-approval:investor-gov-diversification-rebalancing-az:2026-07-28.v1",
      contentSha256:
        "e00ab0c857a4c3e547350e1b03e1e717c677b38f2a6302383e0e5ba4f47dbccd",
      manifestBindingSha256:
        "a60463d3c7dd420000a222c22f60496755d93f5828e5c8d931592baffd433280"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "federal-register-time-weighted-return-en",
      version: VERSION,
      locale: "en-US",
      approvalRef:
        "controlled-approval:federal-register-time-weighted-return-en:2026-07-28.v1",
      contentSha256:
        "8ee64d4a7bc8774001868589309cc663623a5184408fcefe00e0449d67499caf",
      manifestBindingSha256:
        "75d0e7a53a614941ee40ebdd87e3bf4f15eb0cd15a21ccc796ed286762e96b30"
    },
    {
      authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
      sourceId: "federal-register-time-weighted-return-az",
      version: VERSION,
      locale: "az-AZ",
      approvalRef:
        "controlled-approval:federal-register-time-weighted-return-az:2026-07-28.v1",
      contentSha256:
        "c990a71b967c78b3171ee1943cb6873122f27a17ff55f84494461a07bea16d31",
      manifestBindingSha256:
        "f657b13a75d11b980172c2267015a5417a96adf100c26d5a66dd3ce9921bdf8a"
    }
  ] as const satisfies readonly FinancialEducationAuthorityBinding[]
);

function bindingKey(binding: FinancialEducationAuthorityBinding): string {
  return JSON.stringify([
    binding.authorityId,
    binding.sourceId,
    binding.version,
    binding.locale,
    binding.approvalRef,
    binding.contentSha256,
    binding.manifestBindingSha256
  ]);
}

const APPROVED_BINDING_KEYS = new Set(
  APPROVED_FINANCIAL_EDUCATION_BINDINGS.map(bindingKey)
);

export const approvedFinancialEducationAuthority:
  FinancialEducationAuthorityPolicy = Object.freeze({
  authorityId: APPROVED_FINANCIAL_EDUCATION_AUTHORITY_ID,
  allowedSourceHosts: APPROVED_FINANCIAL_EDUCATION_SOURCE_HOSTS,
  requiredLocales: Object.freeze(["en-US", "az-AZ"] as const),
  verifier: Object.freeze({
    verify(binding: FinancialEducationAuthorityBinding): boolean {
      return APPROVED_BINDING_KEYS.has(bindingKey(binding));
    }
  })
});

export function createApprovedFinancialEducationRegistry():
  FinancialEducationRegistry {
  return new FinancialEducationRegistry({
    documents: approvedFinancialEducationDocuments,
    authority: approvedFinancialEducationAuthority
  });
}
