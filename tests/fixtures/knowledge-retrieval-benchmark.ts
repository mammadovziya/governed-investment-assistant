import type { KnowledgeFacet } from "../../src/domain/knowledge.js";
import type { SupportedLocale } from "../../src/domain/types.js";

/**
 * Reviewed, deterministic retrieval judgments for the immutable pilot corpus.
 * Every supported locale/facet pair has morphology or paraphrase variation so
 * the promotion gate measures query-family recall, not only exact source titles.
 */
export interface KnowledgeRetrievalBenchmarkCase {
  id: string;
  locale: SupportedLocale;
  facet: Exclude<KnowledgeFacet, "general">;
  query: string;
  relevantSourceIds: readonly string[];
}

export const knowledgeRetrievalBenchmark: readonly KnowledgeRetrievalBenchmarkCase[] = [
  {
    id: "fees-en-direct",
    locale: "en-US",
    facet: "fees",
    query: "What are the Demo Invest fees?",
    relevantSourceIds: ["demo-invest-commissions-en"]
  },
  {
    id: "fees-en-paraphrase",
    locale: "en-US",
    facet: "fees",
    query: "How is the Investor commission calculated?",
    relevantSourceIds: ["demo-invest-commissions-en"]
  },
  {
    id: "fees-en-tariff",
    locale: "en-US",
    facet: "fees",
    query: "Explain the trading tariff charges.",
    relevantSourceIds: ["demo-invest-commissions-en"]
  },
  {
    id: "fees-az-inflected",
    locale: "az-AZ",
    facet: "fees",
    query: "Demo Invest komissiyası necə hesablanır?",
    relevantSourceIds: ["demo-invest-commissions-az"]
  },
  {
    id: "fees-az-tariff",
    locale: "az-AZ",
    facet: "fees",
    query: "Investor tarifində komissiya nə qədərdir?",
    relevantSourceIds: ["demo-invest-commissions-az"]
  },
  {
    id: "fees-az-cost",
    locale: "az-AZ",
    facet: "fees",
    query: "Ticarət xərclərini izah et.",
    relevantSourceIds: ["demo-invest-commissions-az"]
  },
  {
    id: "account-opening-en-direct",
    locale: "en-US",
    facet: "account_opening",
    query: "How do I open an investment account?",
    relevantSourceIds: ["demo-invest-account-opening-en"]
  },
  {
    id: "account-opening-en-create",
    locale: "en-US",
    facet: "account_opening",
    query: "How can I create my investment account?",
    relevantSourceIds: ["demo-invest-account-opening-en"]
  },
  {
    id: "account-opening-en-topup",
    locale: "en-US",
    facet: "account_opening",
    query: "What is the minimum top-up to open the account?",
    relevantSourceIds: ["demo-invest-account-opening-en"]
  },
  {
    id: "account-opening-az-inflected",
    locale: "az-AZ",
    facet: "account_opening",
    query: "İnvestisiya hesabını necə aça bilərəm?",
    relevantSourceIds: ["demo-invest-account-opening-az"]
  },
  {
    id: "account-opening-az-digital-signature",
    locale: "az-AZ",
    facet: "account_opening",
    query: "Rəqəmsal imza ilə investisiya hesabı qeydiyyatı necədir?",
    relevantSourceIds: ["demo-invest-account-opening-az"]
  },
  {
    id: "account-opening-az-topup",
    locale: "az-AZ",
    facet: "account_opening",
    query: "Hesabı açmaq üçün ən azı nə qədər mədaxil etməliyəm?",
    relevantSourceIds: ["demo-invest-account-opening-az"]
  },
  {
    id: "funding-en-direct",
    locale: "en-US",
    facet: "funding",
    query: "How can I fund my investment account?",
    relevantSourceIds: ["demo-invest-funding-en"]
  },
  {
    id: "funding-en-card",
    locale: "en-US",
    facet: "funding",
    query: "Can I fund my investment account with Demo Invest virtual cash?",
    relevantSourceIds: ["demo-invest-funding-en"]
  },
  {
    id: "funding-en-timing",
    locale: "en-US",
    facet: "funding",
    query: "How long does an account top-up take?",
    relevantSourceIds: ["demo-invest-funding-en"]
  },
  {
    id: "funding-az-direct",
    locale: "az-AZ",
    facet: "funding",
    query: "İnvestisiya hesabına necə mədaxil edə bilərəm?",
    relevantSourceIds: ["demo-invest-funding-az"]
  },
  {
    id: "funding-az-card",
    locale: "az-AZ",
    facet: "funding",
    query: "Demo Invest hesabına virtual mədaxil mümkündür?",
    relevantSourceIds: ["demo-invest-funding-az"]
  },
  {
    id: "funding-az-timing",
    locale: "az-AZ",
    facet: "funding",
    query: "Mədaxilin əks olunması neçə gün çəkir?",
    relevantSourceIds: ["demo-invest-funding-az"]
  },
  {
    id: "withdrawal-en-direct",
    locale: "en-US",
    facet: "withdrawal",
    query: "How do I withdraw money from my investment account?",
    relevantSourceIds: ["demo-invest-withdrawal-en"]
  },
  {
    id: "withdrawal-en-limits",
    locale: "en-US",
    facet: "withdrawal",
    query: "What are the withdrawal limits?",
    relevantSourceIds: ["demo-invest-withdrawal-en"]
  },
  {
    id: "withdrawal-en-settlement",
    locale: "en-US",
    facet: "withdrawal",
    query: "When are sale proceeds available for cash out?",
    relevantSourceIds: ["demo-invest-withdrawal-en"]
  },
  {
    id: "withdrawal-az-direct",
    locale: "az-AZ",
    facet: "withdrawal",
    query: "İnvestisiya hesabımdan pulu necə çıxara bilərəm?",
    relevantSourceIds: ["demo-invest-withdrawal-az"]
  },
  {
    id: "withdrawal-az-limits",
    locale: "az-AZ",
    facet: "withdrawal",
    query: "Məxaric limitləri nə qədərdir?",
    relevantSourceIds: ["demo-invest-withdrawal-az"]
  },
  {
    id: "withdrawal-az-settlement",
    locale: "az-AZ",
    facet: "withdrawal",
    query: "Satışdan sonra vəsaiti çıxarmaq üçün neçə gün gözləməliyəm?",
    relevantSourceIds: ["demo-invest-withdrawal-az"]
  },
  {
    id: "market-hours-en-direct",
    locale: "en-US",
    facet: "market_hours",
    query: "Information on trading days and hours",
    relevantSourceIds: ["demo-invest-market-hours-en"]
  },
  {
    id: "market-hours-en-pre-market",
    locale: "en-US",
    facet: "market_hours",
    query: "Can I enter an order before the stock exchange opens in pre-market?",
    relevantSourceIds: ["demo-invest-market-hours-en"]
  },
  {
    id: "market-hours-en-after-hours",
    locale: "en-US",
    facet: "market_hours",
    query: "What happens to an order entered after-market hours?",
    relevantSourceIds: ["demo-invest-market-hours-en"]
  },
  {
    id: "market-hours-az-direct",
    locale: "az-AZ",
    facet: "market_hours",
    query: "Ticarət günləri və saatları haqqında məlumat ver.",
    relevantSourceIds: ["demo-invest-market-hours-az"]
  },
  {
    id: "market-hours-az-open",
    locale: "az-AZ",
    facet: "market_hours",
    query: "ABŞ birjası nə vaxt açılır?",
    relevantSourceIds: ["demo-invest-market-hours-az"]
  },
  {
    id: "market-hours-az-outside",
    locale: "az-AZ",
    facet: "market_hours",
    query: "Qeyri-ticarət saatlarında sifarişə nə olur?",
    relevantSourceIds: ["demo-invest-market-hours-az"]
  },
  {
    id: "purchase-process-en-operation",
    locale: "en-US",
    facet: "purchase_process",
    query: "How is a purchase operation carried out?",
    relevantSourceIds: ["demo-invest-purchase-process-en"]
  },
  {
    id: "purchase-process-en-shares",
    locale: "en-US",
    facet: "purchase_process",
    query: "How do I buy sample company shares in Demo Invest?",
    relevantSourceIds: ["demo-invest-purchase-process-en"]
  },
  {
    id: "purchase-process-en-review",
    locale: "en-US",
    facet: "purchase_process",
    query: "How do I review and confirm a stock purchase?",
    relevantSourceIds: ["demo-invest-purchase-process-en"]
  },
  {
    id: "purchase-process-az-operation",
    locale: "az-AZ",
    facet: "purchase_process",
    query: "Alış əməliyyatı necə həyata keçirilir?",
    relevantSourceIds: ["demo-invest-purchase-process-az"]
  },
  {
    id: "purchase-process-az-shares",
    locale: "az-AZ",
    facet: "purchase_process",
    query: "Demo Invest-də nümunə şirkət səhmlərini necə ala bilərəm?",
    relevantSourceIds: ["demo-invest-purchase-process-az"]
  },
  {
    id: "purchase-process-az-review",
    locale: "az-AZ",
    facet: "purchase_process",
    query: "Səhm alış sifarişini necə yoxlayıb təsdiqləyim?",
    relevantSourceIds: ["demo-invest-purchase-process-az"]
  },
  {
    id: "product-en-direct",
    locale: "en-US",
    facet: "product",
    query: "What is the Demo Invest investment product?",
    relevantSourceIds: ["demo-invest-product-en"]
  },
  {
    id: "product-en-service",
    locale: "en-US",
    facet: "product",
    query: "Explain the Demo Invest investment service.",
    relevantSourceIds: ["demo-invest-product-en"]
  },
  {
    id: "product-en-section",
    locale: "en-US",
    facet: "product",
    query: "What can I access from the investments section?",
    relevantSourceIds: ["demo-invest-product-en"]
  },
  {
    id: "product-az-direct",
    locale: "az-AZ",
    facet: "product",
    query: "Demo Invest investisiya məhsulu nədir?",
    relevantSourceIds: ["demo-invest-product-az"]
  },
  {
    id: "product-az-service",
    locale: "az-AZ",
    facet: "product",
    query: "İnvestisiya xidmətini izah et.",
    relevantSourceIds: ["demo-invest-product-az"]
  },
  {
    id: "product-az-section",
    locale: "az-AZ",
    facet: "product",
    query: "İnvestisiyalar bölməsi nə üçündür?",
    relevantSourceIds: ["demo-invest-product-az"]
  },
  {
    id: "risk-az-disclosure",
    locale: "az-AZ",
    facet: "risk_disclosure",
    query: "Marja ticarəti üçün risk açıqlaması nə deyir?",
    relevantSourceIds: ["demo-invest-risk-disclosure-az"]
  },
  {
    id: "risk-az-warning",
    locale: "az-AZ",
    facet: "risk_disclosure",
    query: "Marja risk açıqlamasını izah et.",
    relevantSourceIds: ["demo-invest-risk-disclosure-az"]
  },
  {
    id: "risk-az-inflected",
    locale: "az-AZ",
    facet: "risk_disclosure",
    query: "Marja ticarətinin risk açıqlaması nədir?",
    relevantSourceIds: ["demo-invest-risk-disclosure-az"]
  },
  {
    id: "research-az-weekly",
    locale: "az-AZ",
    facet: "research",
    query: "Demo Invest həftəlik icmalı nəyi əhatə edir?",
    relevantSourceIds: ["demo-invest-weekly-research-2026-07-10-az"]
  },
  {
    id: "research-az-period",
    locale: "az-AZ",
    facet: "research",
    query: "6–10 iyul bazar araşdırmasını izah et.",
    relevantSourceIds: ["demo-invest-weekly-research-2026-07-10-az"]
  },
  {
    id: "research-az-published",
    locale: "az-AZ",
    facet: "research",
    query: "Kapital bazarlarının həftəlik icmalı nə vaxt dərc edilib?",
    relevantSourceIds: ["demo-invest-weekly-research-2026-07-10-az"]
  }
] as const;
