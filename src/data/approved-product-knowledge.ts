import { createHash } from "node:crypto";
import type {
  KnowledgeDocument,
  KnowledgeDocumentManifest,
  KnowledgeDocumentType,
  KnowledgeFacet
} from "../domain/knowledge.js";
import type { SupportedLocale } from "../domain/types.js";

const VERIFIED_AT = "2026-07-21T00:00:00.000Z";
const OPEN_ENDED = null;
const SYNTHETIC_SOURCE_ORIGIN = "https://knowledge.demo-invest.invalid";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeForChecksum(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function syntheticPublicationDocument(input: {
  sourceId: string;
  translationGroupId?: string;
  documentType: KnowledgeDocumentType;
  facet: KnowledgeFacet;
  title: string;
  path: string;
  locale: SupportedLocale;
  section: string;
  content: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  contentAsOf?: string | null;
  reviewDueAt?: string | null;
}): KnowledgeDocument {
  const url = `${SYNTHETIC_SOURCE_ORIGIN}${input.path}`;
  const version = `project-authored-synthetic-${VERIFIED_AT.slice(0, 10)}`;
  const manifest: KnowledgeDocumentManifest = {
    schemaVersion: "1.0.0",
    sourceId: input.sourceId,
    version,
    ...(input.translationGroupId ? { translationGroupId: input.translationGroupId } : {}),
    documentType: input.documentType,
    title: input.title,
    url,
    locale: input.locale,
    jurisdiction: "AZ",
    // Kept as a compatibility identifier for the existing policy and index
    // contracts. It does not identify or imply an affiliation with a bank.
    productScopes: ["DEMO_INVEST"],
    facets: [input.facet],
    audience: "customer",
    allowedChannels: ["customer_chat"],
    classification: "public",
    ownerTeam: "Demo Invest open-source maintainers",
    approvalStatus: "approved",
    approvalBasis: "official_publication",
    approvals: [
      {
        role: "publisher",
        actorRef: new URL(url).hostname,
        approvalRef: url,
        decidedAt: VERIFIED_AT
      }
    ],
    publishedAt: input.effectiveFrom ?? VERIFIED_AT,
    effectiveFrom: input.effectiveFrom ?? VERIFIED_AT,
    effectiveTo: input.effectiveTo === undefined ? OPEN_ENDED : input.effectiveTo,
    contentAsOf: input.contentAsOf ?? null,
    reviewDueAt: input.reviewDueAt ?? null,
    revokedAt: null,
    section: input.section,
    sourceChecksumSha256: sha256(input.content),
    normalizedChecksumSha256: sha256(normalizeForChecksum(input.content)),
    parserProfile: "curated-project-synthetic-v1",
    chunkingProfile: "mastra-recursive-900-120-v1",
    embeddingProfile: "deterministic-hash-384-v1",
    verifiedAt: VERIFIED_AT
  };
  return { manifest, content: input.content };
}

/**
 * Original, fictional product passages authored for this repository. They are
 * covered by the repository licence and intentionally use the reserved
 * `.invalid` namespace: the URLs are stable evidence identities, not live
 * product pages. Amounts, limits, timings, and workflows below are demo data
 * and must not be represented as terms offered by a real financial institution.
 */
export const approvedDemoKnowledgeDocuments: KnowledgeDocument[] = [
  syntheticPublicationDocument({
    sourceId: "demo-invest-commissions-en",
    translationGroupId: "demo-invest-commissions",
    documentType: "fee_schedule",
    facet: "fees",
    title: "Demo Invest sample fee schedule",
    path: "/en/fees",
    locale: "en-US",
    section: "Fictional trading fees",
    content:
      "In the fictional Demo Invest profile, the sample Investor plan applies a 0.20% paper-trading fee with a $1 minimum and $20 maximum, while the sample Trader plan applies a 0.10% fee with a $0.50 minimum and $15 maximum. For a sample security priced below $5, both plans use $0.01 per virtual share with a $0.25 minimum and $15 maximum. These figures are synthetic demonstration data, not charges offered by a real broker."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-commissions-az",
    translationGroupId: "demo-invest-commissions",
    documentType: "fee_schedule",
    facet: "fees",
    title: "Demo Invest nümunə komissiya cədvəli",
    path: "/az/fees",
    locale: "az-AZ",
    section: "Fiktiv ticarət komissiyaları",
    content:
      "Fiktiv Demo Invest profilində nümunəvi Investor planının kağız üzərində ticarət komissiyası 0,20%, minimum 1 ABŞ dolları və maksimum 20 ABŞ dolları, nümunəvi Trader planının komissiyası isə 0,10%, minimum 0,50 ABŞ dolları və maksimum 15 ABŞ dollarıdır. Qiyməti 5 ABŞ dollarından aşağı olan nümunə qiymətli kağız üçün hər iki planda virtual səhm başına 0,01 ABŞ dolları, minimum 0,25 ABŞ dolları və maksimum 15 ABŞ dolları tətbiq edilir. Bu rəqəmlər sintetik nümayiş məlumatıdır və real brokerin tətbiq etdiyi komissiyalar deyil."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-account-opening-en",
    translationGroupId: "demo-invest-account-opening",
    documentType: "product_doc",
    facet: "account_opening",
    title: "Creating a Demo Invest sandbox profile",
    path: "/en/account-opening",
    locale: "en-US",
    section: "Sandbox profile steps",
    content:
      "Demo Invest is a fictional sandbox and does not open a brokerage account. In the sample flow, open the Investments demo, choose Create demo profile, review the simulated disclosures, and confirm the profile. The sandbox then adds $10,000 of virtual cash; it never requests or accepts a real deposit, so there is no minimum top-up."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-account-opening-az",
    translationGroupId: "demo-invest-account-opening",
    documentType: "product_doc",
    facet: "account_opening",
    title: "Demo Invest sınaq profilinin yaradılması",
    path: "/az/account-opening",
    locale: "az-AZ",
    section: "Sınaq profili addımları",
    content:
      "Demo Invest fiktiv sınaq mühitidir və broker hesabı açmır. Nümunə axınında İnvestisiyalar demosunu açın, Demo profili yarat seçimini edin, simulyasiya edilmiş açıqlamaları nəzərdən keçirin və profili təsdiqləyin. Bu sınaq qeydiyyatı real rəqəmsal imzadan istifadə etmir. Sınaq mühiti daha sonra 10 000 ABŞ dolları virtual vəsait əlavə edir; real mədaxil istəmir və qəbul etmir."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-funding-en",
    translationGroupId: "demo-invest-funding",
    documentType: "policy",
    facet: "funding",
    title: "Demo Invest virtual funding",
    path: "/en/funding",
    locale: "en-US",
    section: "Virtual cash policy",
    content:
      "Demo Invest uses virtual US-dollar cash only. A virtual top-up is immediate: selecting Reset virtual cash restores the sample balance to $10,000. No card, bank account, currency conversion, payment rail, or real customer money is connected to this demonstration."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-funding-az",
    translationGroupId: "demo-invest-funding",
    documentType: "policy",
    facet: "funding",
    title: "Demo Invest virtual mədaxili",
    path: "/az/funding",
    locale: "az-AZ",
    section: "Virtual vəsait qaydası",
    content:
      "Demo Invest yalnız virtual ABŞ dolları vəsaitindən istifadə edir. Virtual vəsaiti sıfırla seçimi nümunə balansını dərhal 10 000 ABŞ dollarına qaytarır. Bu nümayişə kart, bank hesabı, valyuta konvertasiyası, ödəniş kanalı və ya real müştəri vəsaiti qoşulmur."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-withdrawal-en",
    translationGroupId: "demo-invest-withdrawal",
    documentType: "policy",
    facet: "withdrawal",
    title: "Demo Invest virtual withdrawal policy",
    path: "/en/withdrawals",
    locale: "en-US",
    section: "Virtual balance and settlement",
    content:
      "Demo Invest cannot send or withdraw real money. For workflow demonstrations, a simulated sale is labelled unsettled for two business days before its virtual proceeds become available. The sample daily virtual-withdrawal limit is $25,000. Both the settlement period and limit are fictional test rules."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-withdrawal-az",
    translationGroupId: "demo-invest-withdrawal",
    documentType: "policy",
    facet: "withdrawal",
    title: "Demo Invest virtual məxaric qaydası",
    path: "/az/withdrawals",
    locale: "az-AZ",
    section: "Virtual balans və hesablaşma",
    content:
      "Demo Invest real pul göndərə və ya çıxara bilmir. İş axınının nümayişi üçün simulyasiya edilmiş satışın virtual vəsaiti əlçatan olmamışdan əvvəl iki iş günü hesablaşmamış kimi işarələnir. Nümunəvi gündəlik virtual məxaric limiti 25 000 ABŞ dollarıdır. Həm hesablaşma müddəti, həm də limit fiktiv sınaq qaydalarıdır."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-market-hours-en",
    translationGroupId: "demo-invest-market-hours",
    documentType: "product_doc",
    facet: "market_hours",
    title: "Demo Invest paper-market hours",
    path: "/en/market-hours",
    locale: "en-US",
    section: "Paper-order availability",
    content:
      "The Demo Invest order screen is a read-only paper-trading simulation. A preview can be created at any time, but it never reaches an exchange and never executes. Any market-status label is synthetic test data and must not be treated as the operating hours of a real venue."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-market-hours-az",
    translationGroupId: "demo-invest-market-hours",
    documentType: "product_doc",
    facet: "market_hours",
    title: "Demo Invest kağız bazar saatları",
    path: "/az/market-hours",
    locale: "az-AZ",
    section: "Kağız sifarişinin əlçatanlığı",
    content:
      "Demo Invest sifariş ekranı yalnız oxuma üçün kağız üzərində ticarət simulyasiyasıdır. İstənilən vaxt önbaxış yaratmaq olar, lakin o, birjaya göndərilmir və icra edilmir. Bazar statusu göstəricisi sintetik sınaq məlumatıdır və real ticarət meydançasının iş saatı sayılmamalıdır."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-purchase-process-en",
    translationGroupId: "demo-invest-purchase-process",
    documentType: "product_doc",
    facet: "purchase_process",
    title: "Creating a Demo Invest order preview",
    path: "/en/order-preview",
    locale: "en-US",
    section: "Read-only preview steps",
    content:
      "To inspect a fictional share purchase, choose a supported sample ticker, enter a virtual quantity or notional amount, and review the generated price, fee, total, and risk disclosures. Confirming the handoff opens a read-only demo ticket. Demo Invest does not place, route, or execute an order."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-purchase-process-az",
    translationGroupId: "demo-invest-purchase-process",
    documentType: "product_doc",
    facet: "purchase_process",
    title: "Demo Invest sifariş önbaxışının yaradılması",
    path: "/az/order-preview",
    locale: "az-AZ",
    section: "Yalnız oxuma üçün önbaxış addımları",
    content:
      "Alış əməliyyatı yalnız fiktiv önbaxış kimi aparılır. Şirkət səhmlərini necə almağı yoxlamaq üçün dəstəklənən nümunə ticker seçin, virtual say və ya şərti məbləğ daxil edin, sonra yaradılmış qiymət, komissiya, ümumi məbləğ və risk açıqlamalarını nəzərdən keçirin. Keçidi təsdiqləmək yalnız oxuma üçün demo bileti açır. Demo Invest sifariş yerləşdirmir, yönləndirmir və icra etmir."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-product-en",
    translationGroupId: "demo-invest-product",
    documentType: "product_doc",
    facet: "product",
    title: "About the Demo Invest profile",
    path: "/en/product",
    locale: "en-US",
    section: "Fictional product overview",
    content:
      "Demo Invest is the fictional product profile bundled with this open-source reference application. It demonstrates tool-grounded portfolio analysis, synthetic market data, governed knowledge retrieval, and a read-only order preview. It is not a broker, investment adviser, bank, or live trading service."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-product-az",
    translationGroupId: "demo-invest-product",
    documentType: "product_doc",
    facet: "product",
    title: "Demo Invest profili haqqında",
    path: "/az/product",
    locale: "az-AZ",
    section: "Fiktiv məhsul haqqında ümumi məlumat",
    content:
      "Demo Invest bu açıq mənbəli nümunə tətbiqə daxil edilmiş fiktiv məhsul profilidir. İnvestisiyalar bölməsi alətlə əsaslandırılmış portfel təhlilini, sintetik bazar məlumatını, idarə olunan bilik axtarışını və yalnız oxuma üçün sifariş önbaxışını nümayiş etdirir. Bu, broker, investisiya məsləhətçisi, bank və ya real ticarət xidməti deyil."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-risk-disclosure-az",
    documentType: "disclosure",
    facet: "risk_disclosure",
    title: "Demo Invest risk açıqlaması",
    path: "/az/risk-disclosure",
    locale: "az-AZ",
    section: "Simulyasiya və investisiya riski",
    content:
      "Demo Invest yalnız tədris və sınaq məqsədli simulyasiyadır. Simulyasiya edilmiş nəticələr real bazar nəticələrinə zəmanət vermir; real investisiyalarda kapitalın bir hissəsini və ya hamısını itirmək mümkündür. Bu ümumi risk məlumatıdır, fərdi uyğunluq qiymətləndirməsi və ya investisiya məsləhəti deyil."
  }),
  syntheticPublicationDocument({
    sourceId: "demo-invest-weekly-research-2026-07-10-az",
    documentType: "research",
    facet: "research",
    title: "Demo Invest ssenari qeydi — 6–10 iyul 2026",
    path: "/az/research/scenario-2026-07-10",
    locale: "az-AZ",
    section: "Sintetik ssenarinin əhatə dövrü",
    content:
      "Demo Invest 13 iyul 2026-cı il tarixli həftəlik icmal sınaq qeydi 6–10 iyul 2026-cı il üçün fiktiv kapital, valyuta və əmtəə bazarı ssenarisini təsvir edir. Qeyd yalnız idarə olunan araşdırma axınını nümayiş etdirir; cari xəbər, real bazar araşdırması və ya investisiya tövsiyəsi deyil.",
    effectiveFrom: "2026-07-13T00:00:00.000Z",
    effectiveTo: "2026-08-13T00:00:00.000Z",
    contentAsOf: "2026-07-10T23:59:59.000Z",
    reviewDueAt: "2026-08-06T00:00:00.000Z"
  })
];

/**
 * Generic export for the bundled, project-authored Demo Invest corpus.
 */
export const approvedProductKnowledgeDocuments = approvedDemoKnowledgeDocuments;
