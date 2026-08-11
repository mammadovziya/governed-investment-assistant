import { describe, expect, it } from "vitest";

import {
  V3_APPROVED_BOUNDARY_TOOL_IDS,
  enforceV3PolicyAgreement,
  evaluateV3Policy,
} from "../src/assistant-v3/policy.js";
import {
  V3_MVP_FUNCTIONS,
  applyV3ConversationRouteContext,
  detectV3ResearchFacet,
  extractV3Symbols,
  routeKnownV3Capability,
  routeV3Request,
} from "../src/assistant-v3/routing.js";
import {
  V3SessionAuthority,
  type V3ConsentScope,
  type V3Entitlement,
} from "../src/assistant-v3/sessions.js";
import { financialEducationRouteReason } from
  "../src/assistant-v3/financial-education-query.js";

const NOW = Date.UTC(2026, 6, 22, 10, 0, 0);
const ALL_CONSENTS: readonly V3ConsentScope[] = [
  "assistant_use",
  "portfolio_data",
  "public_market_data",
  "approved_knowledge",
];
const ALL_ENTITLEMENTS: readonly V3Entitlement[] = [
  "assistant_access",
  "portfolio_read",
  "market_read",
  "research_read",
  "knowledge_read",
  "order_preview",
];

function authority(): V3SessionAuthority {
  return new V3SessionAuthority({
    secret: "v3-test-session-secret-that-is-longer-than-32-bytes",
    now: () => NOW,
  });
}

function trustedSession(
  consents: readonly V3ConsentScope[] = ALL_CONSENTS,
  entitlements: readonly V3Entitlement[] = ALL_ENTITLEMENTS,
) {
  return authority().issue({
    tenantId: "tenant-demo-invest-az",
    principalId: "customer-42",
    authContextId: "auth-ctx-1",
    consentVersion: "consent-2026-07",
    consents,
    entitlementVersion: "entitlements-7",
    entitlements,
  }).session;
}

describe("V3 deterministic AZ/EN routing", () => {
  it("defines exactly the eight explicit MVP functions", () => {
    expect(V3_MVP_FUNCTIONS).toEqual([
      "current_portfolio_value",
      "ytd_gain_loss_twr",
      "holding_average_cost",
      "sector_allocation",
      "one_month_mover_contribution",
      "etf_explanation_risk",
      "fees_tariff",
      "order_ticket_preview",
    ]);
  });

  it.each(["A", "ON", "IT", "ARE", "I", "BRK.B"])(
    "preserves machine-known ticker %s without natural-language stopword filtering",
    (symbol) => {
      expect(routeKnownV3Capability({
        route: "market_quote",
        locale: "en-US",
        symbols: [symbol],
        reasonCode: "studio-tool:read-market-snapshot",
      })).toMatchObject({
        route: "market_quote",
        symbols: [symbol],
        requiresMarketData: true,
      });
    },
  );

  it("fails closed for invalid machine-known route inputs", () => {
    expect(() => routeKnownV3Capability({
      route: "market_quote",
      locale: "en-US",
      symbols: ["nvda"],
      reasonCode: "studio-tool:read-market-snapshot",
    })).toThrow("symbols are invalid");
    expect(() => routeKnownV3Capability({
      route: "market_quote",
      locale: "en-US",
      symbols: ["NVDA"],
      reasonCode: "not reviewed!",
    })).toThrow("reason code is invalid");
  });

  it.each([
    ["What is my current portfolio value?", "current_portfolio_value", "en-US"],
    ["Portfelimin cari dəyəri nə qədərdir?", "current_portfolio_value", "az-AZ"],
    ["How much cash do I have?", "current_portfolio_value", "en-US"],
    ["Hesabımda nə qədər nağd pul var?", "current_portfolio_value", "az-AZ"],
    ["Show my YTD gain/loss and TWR", "ytd_gain_loss_twr", "en-US"],
    ["Portfelimin YTD gəlir/zərərini və TWR-ni izah et", "ytd_gain_loss_twr", "az-AZ"],
    ["What is my average cost for NVDA?", "holding_average_cost", "en-US"],
    ["NVDA səhmlərimin orta alış qiyməti nədir?", "holding_average_cost", "az-AZ"],
    ["Show my portfolio sector allocation", "sector_allocation", "en-US"],
    ["Portfelimin sektor bölgüsünü göstər", "sector_allocation", "az-AZ"],
    [
      "Which holding was the biggest one-month mover and contribution?",
      "one_month_mover_contribution",
      "en-US",
    ],
    [
      "Son bir ayda ən böyük dəyişən və töhfə verən mövqe hansıdır?",
      "one_month_mover_contribution",
      "az-AZ",
    ],
    ["Son 1 ayda ən çox nə qazandırıb?", "one_month_mover_contribution", "az-AZ"],
    ["Explain ETF risks", "etf_explanation_risk", "en-US"],
    ["ETF nədir və riskləri hansılardır?", "etf_explanation_risk", "az-AZ"],
    ["What fees and tariffs does Demo Invest charge?", "fees_tariff", "en-US"],
    ["Demo Invest komissiya və tarifləri nədir?", "fees_tariff", "az-AZ"],
    ["Open a $100 AAPL buy ticket", "order_ticket_preview", "en-US"],
    ["100 USD-lik AAPL alış bileti aç", "order_ticket_preview", "az-AZ"],
    [
      "AAPL üçün 100 ABŞ dolları məbləğində yalnız baxış üçün alış bileti hazırla",
      "order_ticket_preview",
      "az-AZ"
    ],
  ] as const)("routes %s", (message, expectedRoute, locale) => {
    const routed = routeV3Request(message);

    expect(routed.kind).toBe("mvp");
    expect(routed.route).toBe(expectedRoute);
    expect(routed.mvpFunction).toBe(expectedRoute);
    expect(routed.locale).toBe(locale);
  });

  it.each([
    ["How much cash do I have?", "en-US"],
    ["What is my cash balance?", "en-US"],
    ["Nə qədər nağd vəsaitim var?", "az-AZ"],
    ["Nağd balansım nə qədərdir?", "az-AZ"],
    ["Nagd balansim ne qederdir?", "az-AZ"]
  ] as const)("marks standalone cash-balance wording without inventing a new capability: %s", (
    message,
    locale
  ) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "mvp",
      route: "current_portfolio_value",
      locale,
      requiresPortfolio: true,
      reasonCodes: ["cash_balance_marker"]
    });
  });

  it.each([
    ["What is the value of my portfolio in AZN?", "en-US"],
    ["Convert it into AZN", "en-US"],
    ["Portfelimin cari dəyərini AZN ilə göstər", "az-AZ"],
    ["Portfelimin AZN ilə cari dəyəri nə qədərdir?", "az-AZ"],
    ["Onu AZN-ə çevir", "az-AZ"]
  ] as const)("routes an AZN portfolio valuation with an explicit conversion marker: %s", (
    message,
    locale
  ) => {
    const route = routeV3Request(message);
    expect(route).toMatchObject({
      kind: "mvp",
      route: "current_portfolio_value",
      locale,
      requiresPortfolio: true
    });
    expect(route.reasonCodes).toContain("portfolio_value_currency:AZN");
  });

  it.each([
    ["What is the current NVDA price in AZN?", "en-US"],
    ["NVDA-nın cari qiymətini AZN ilə göstər", "az-AZ"]
  ] as const)("routes a current quote with an explicit AZN conversion marker: %s", (
    message,
    locale
  ) => {
    const route = routeV3Request(message);
    expect(route).toMatchObject({
      kind: "capability",
      route: "market_quote",
      locale,
      symbols: ["NVDA"],
      requiresMarketData: true
    });
    expect(route.reasonCodes).toContain("market_quote_currency:AZN");
  });

  it.each([
    ["What is the current NVDA price?", "market_quote"],
    ["Could you quickly tell me what NVDA is trading at right now?", "market_quote"],
    ["NVDA-nın hazırkı qiyməti nədir?", "market_quote"],
    ["AAPL indi neçəyə ticarət olunur?", "market_quote"],
    ["AAPL indi neceye ticaret olunur?", "market_quote"],
    ["Show AAPL's one-month price chart", "market_history"],
    ["NVDA 1y performance", "market_history"],
    ["AAPL üçün son 1 ay qiymət qrafiki", "market_history"],
    ["What is my largest holding?", "largest_holding"],
    ["Portfelimdə ən böyük mövqe hansıdır?", "largest_holding"],
    ["When is the next AAPL earnings date?", "market_event"],
    ["analyze NVDA fundamentals", "company_research"],
    ["NVDA RSI and technical indicators", "technical_analysis"],
    ["NVDA latest news and sentiment", "news_sentiment"],
    ["NVDA risk anaylsis", "security_risk"],
    ["Digital-signature onboarding documents", "approved_knowledge"],
  ] as const)("keeps additional capability %s separate from the eight MVP routes", (message, route) => {
    expect(routeV3Request(message)).toMatchObject({ kind: "capability", route });
  });

  it("routes investment questions to neutral decision-factor research, not an instant order block", () => {
    expect(routeV3Request("Should I invest in INTC?")).toMatchObject({
      kind: "capability",
      route: "company_research",
      boundary: null,
      symbols: ["INTC"],
      requiresMarketData: true,
      readOnly: true,
      reasonCodes: ["neutral_decision_factors_marker"],
    });
  });

  it("routes a personal sell question to portfolio-aware decision support without authorizing execution", () => {
    expect(routeV3Request("Should I sell my NVDA shares?")).toMatchObject({
      kind: "capability",
      route: "security_decision_support",
      boundary: null,
      symbols: ["NVDA"],
      requiresPortfolio: true,
      requiresMarketData: true,
      readOnly: true,
      reasonCodes: ["portfolio_aware_decision_support_marker"]
    });
  });

  it("routes user-supplied hypothetical allocations without treating their tickers as account scope", () => {
    expect(routeV3Request(
      "I have a portfolio worth $20,000: 40% Tesla, 30% NVIDIA, 20% Microsoft, 10% cash. Analyze my allocation."
    )).toMatchObject({
      kind: "capability",
      route: "hypothetical_portfolio_analysis",
      symbols: [],
      requiresPortfolio: false,
      requiresMarketData: false,
      readOnly: true,
      reasonCodes: ["user_supplied_hypothetical_allocation"]
    });
  });

  it("routes a supplied share count and cost basis to an indicative position comparison", () => {
    expect(routeV3Request(
      "Assume I own 15 shares of NVDA bought at $170 each. Should I buy more, hold, or sell?"
    )).toMatchObject({
      kind: "capability",
      route: "hypothetical_position_analysis",
      symbols: ["NVDA"],
      requiresPortfolio: false,
      requiresMarketData: true,
      readOnly: true,
      reasonCodes: ["user_supplied_hypothetical_position"]
    });
  });

  it.each([
    "If I only had $1,000 to invest today, where would you allocate it?",
    "How would Warren Buffett view this portfolio?",
    "Portfelimi yenidən balanslaşdırmanı rüblük, yoxsa illik etməliyəm?"
  ])("routes personalized scenario follow-up to reviewed non-advisory education: %s", (message) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "capability",
      route: "education",
      requiresPortfolio: false,
      requiresMarketData: false,
      readOnly: true
    });
  });

  it.each([
    [
      "If you were my investment advisor, what would you change in this portfolio?",
      "portfolio_nonadvisory_review_marker"
    ],
    [
      "What are the biggest risks in this portfolio?",
      "portfolio_risk_analysis_marker"
    ]
  ] as const)("routes a connected portfolio review through signed allocation analysis: %s", (
    message,
    reasonCode
  ) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "capability",
      route: "portfolio_allocation_analysis",
      requiresPortfolio: true,
      requiresMarketData: true,
      readOnly: true,
      reasonCodes: [reasonCode]
    });
  });

  it("routes an explicit two-symbol comparison through one research capability", () => {
    expect(routeV3Request("Compare NVDA and AAPL")).toMatchObject({
      kind: "capability",
      route: "company_research",
      symbols: ["NVDA", "AAPL"],
      reasonCodes: ["security_comparison_marker"],
    });
  });

  it.each([
    ["What is NVDA’s market cap?", "market_cap"],
    ["What is NVDA’s P/E ratio (TTM and forward)?", "pe"],
    ["What is NVDA’s dividend yield?", "dividend"],
    ["Does NVDA pay dividends? When was the last dividend paid?", "dividend"],
    ["What is NVDA’s 52-week high and low?", "price_range"],
    ["What is the analyst rating consensus for NVDA?", "analyst_consensus"],
    ["Where is NVDA listed?", "listing"]
  ] as const)("routes a requested company metric to its typed facet: %s", (message, researchFacet) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "capability",
      route: "company_research",
      symbols: ["NVDA"],
      researchFacet
    });
    expect(detectV3ResearchFacet(message)).toBe(researchFacet);
  });

  it("does not extract financial abbreviations or SEC prose as tickers and resolves an explicit S&P 500 ETF", () => {
    expect(extractV3Symbols("NVDA P/E ratio (TTM and forward)")).toEqual(["NVDA"]);
    expect(extractV3Symbols("Read the SEC filing for NVDA")).toEqual(["NVDA"]);
    expect(extractV3Symbols("Compare NVDA with an S&P 500 ETF")).toEqual(["NVDA", "SPY"]);
  });

  it("accepts one-letter tickers only when explicitly marked", () => {
    expect(extractV3Symbols("Where is a company listed?")).toEqual([]);
    expect(extractV3Symbols("Where is ticker A listed?")).toEqual(["A"]);
    expect(extractV3Symbols("What is $A market cap?")).toEqual(["A"]);
    expect(extractV3Symbols("Analyze Agilent Technologies")).toEqual(["A"]);
  });

  it("routes a requested historical-risk comparison with both controlled symbols", () => {
    expect(routeV3Request("How risky is NVDA compared with an S&P 500 ETF?"))
      .toMatchObject({
        route: "security_risk",
        researchFacet: "risk_comparison",
        symbols: ["NVDA", "SPY"]
      });
  });

  it.each([
    ["How do I fund my investment account?", "en-US"],
    ["How do I fund my portfolio?", "en-US"],
    ["İnvestisiya hesabına necə mədaxil edə bilərəm?", "az-AZ"],
    ["How do I set a price alert for AAPL?", "en-US"],
    ["AAPL üçün qiymət bildirişi necə yarada bilərəm?", "az-AZ"]
  ] as const)("routes governed product navigation before market matching: %s", (message, locale) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "capability",
      route: "approved_knowledge",
      locale,
      requiresKnowledge: true,
      requiresMarketData: false,
      reasonCodes: ["governed_navigation_knowledge_marker"]
    });
  });

  it("keeps a combined imperative and activity request behind the execution boundary", () => {
    expect(routeV3Request("Buy 2 AAPL shares now and show my recent orders")).toMatchObject({
      kind: "boundary",
      route: null,
      boundary: "order_execution",
      reasonCodes: ["executable_order_requested"]
    });
    expect(routeV3Request("When did I buy AAPL?")).toMatchObject({
      kind: "capability",
      route: "purchase_history",
      boundary: null
    });
  });

  it.each([
    ["Can you buy AAPL and show my recent orders?", "en-US"],
    ["Would you buy AAPL and show my orders?", "en-US"],
    ["I'd like you to sell NVDA and list my latest trades", "en-US"],
    ["I want to buy AAPL and show my recent orders", "en-US"],
    ["I would like to buy AAPL and show my orders", "en-US"],
    ["I need to sell NVDA and list my latest trades", "en-US"],
    ["AAPL səhmini ala bilərsən və son sifarişlərimi göstərə bilərsən?", "az-AZ"],
    ["AAPL almaq istəyirəm və son sifarişlərimi göstər", "az-AZ"],
    ["Mənim üçün NVDA sat və son əməliyyatlarımı göstər", "az-AZ"],
    ["Xahiş edirəm AAPL al, sonra sifarişlərimi göstər", "az-AZ"]
  ] as const)(
    "fails closed on polite or indirect execution mixed with activity: %s",
    (message, locale) => {
      expect(routeV3Request(message)).toMatchObject({
        kind: "boundary",
        route: null,
        boundary: "order_execution",
        locale,
        readOnly: false,
        reasonCodes: ["executable_order_requested"]
      });
    }
  );

  it("does not let preview language downgrade a sequenced execution request", () => {
    expect(routeV3Request("Preview AAPL and then buy it now")).toMatchObject({
      kind: "boundary",
      route: null,
      boundary: "order_execution",
      readOnly: false,
      reasonCodes: ["executable_order_requested"]
    });

    expect(routeV3Request("Preview buying 10 NVDA shares")).toMatchObject({
      kind: "clarify",
      route: null,
      boundary: null,
      readOnly: true,
      reasonCodes: ["order_preview_quantity_not_supported"]
    });
    expect(routeV3Request("Preview a $100 order for AAPL")).toMatchObject({
      kind: "clarify",
      route: null,
      reasonCodes: ["order_preview_buy_side_required"]
    });
    expect(routeV3Request("Simulate an AAPL stop order for $100")).toMatchObject({
      kind: "clarify",
      route: null,
      reasonCodes: ["order_preview_order_type_not_supported"]
    });
    expect(routeV3Request(
      "Preview a $100 buy order for NVDA and AAPL"
    )).toMatchObject({
      kind: "clarify",
      route: null,
      symbols: ["NVDA", "AAPL"],
      reasonCodes: ["order_preview_single_instrument_required"]
    });
  });

  it.each([
    ["When did I buy AAPL?", "purchase_history", "en-US"],
    ["Show my AAPL purchase history", "purchase_history", "en-US"],
    ["AAPL alış tarixçəmi göstər", "purchase_history", "az-AZ"],
    ["Should I invest in AAPL?", "company_research", "en-US"]
  ] as const)(
    "preserves read-only historical or decision-factor routing: %s",
    (message, route, locale) => {
      expect(routeV3Request(message)).toMatchObject({
        kind: "capability",
        route,
        boundary: null,
        locale,
        readOnly: true
      });
    }
  );

  it.each([
    [
      "Bu il investisiyalarımdan nə qədər gəlir və ya zərər etmişəm?",
      "ytd_gain_loss_twr",
      "az-AZ",
    ],
    [
      "How much gain or loss have I made on my investments this year?",
      "ytd_gain_loss_twr",
      "en-US",
    ],
    [
      "How much have I made or lost this year?",
      "ytd_gain_loss_twr",
      "en-US",
    ],
    [
      "Bu il investisiyalarimdan ne qeder gelir ve ya zerer etmisem?",
      "ytd_gain_loss_twr",
      "az-AZ",
    ],
    ["How much porfolio gain or loss this year?", "ytd_gain_loss_twr", "en-US"],
    ["Bu il porfolio P&L nəticəm nədir?", "ytd_gain_loss_twr", "az-AZ"],
    ["In plain English, how is my portfolio doing this year?", "ytd_gain_loss_twr", "en-US"],
    ["Portfelim bu il nece netice gosterib?", "ytd_gain_loss_twr", "az-AZ"],
    [
      "Portfelimin neçə faizi texnologiya sektorundadır?",
      "sector_allocation",
      "az-AZ",
    ],
    [
      "What percentage of my portfolio is in the technology sector?",
      "sector_allocation",
      "en-US",
    ],
    [
      "Portfelimin nece faizi texnologiya sektorundadir?",
      "sector_allocation",
      "az-AZ",
    ],
    ["What percent of my porfolio is technology sector?", "sector_allocation", "en-US"],
    [
      "Portfolio-mun neçə faizi technology sektorundadır?",
      "sector_allocation",
      "az-AZ",
    ],
  ] as const)("routes natural-language portfolio metric phrase: %s", (message, route, locale) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "mvp",
      route,
      mvpFunction: route,
      locale,
    });
  });

  it("does not mistake a public security's yearly move for client-portfolio YTD", () => {
    expect(routeV3Request("How much did NVDA gain this year?").route).not.toBe(
      "ytd_gain_loss_twr",
    );
  });

  it("marks ETF explanation as public market evidence without governed-product knowledge", () => {
    expect(routeV3Request("Explain ETF risks")).toMatchObject({
      route: "etf_explanation_risk",
      requiresMarketData: true,
      requiresKnowledge: false,
    });
  });

  it.each([
    ["Hello!", "en-US", "conversation:greeting"],
    ["Thanks, that helped.", "en-US", "conversation:gratitude"],
    ["What can you help me with?", "en-US", "conversation:capability_overview"],
    ["Hello, what can you help me with?", "en-US", "conversation:capability_overview"],
    ["Çox sağ ol, kömək etdi.", "az-AZ", "conversation:gratitude"],
    ["Cox sag ol, komek etdi.", "az-AZ", "conversation:gratitude"],
    ["Mənə nələrdə kömək edə bilərsən?", "az-AZ", "conversation:capability_overview"],
    ["Salam, mənə nələrdə kömək edə bilərsən?", "az-AZ", "conversation:capability_overview"],
    ["Mene nelerde komek ede bilersen?", "az-AZ", "conversation:capability_overview"],
    ["Bunu daha sade izah et.", "az-AZ", "conversation:simplify_follow_up"],
    ["Mene nece komek ede bilersen?", "az-AZ", "conversation:capability_overview"]
  ] as const)("routes conversational no-tool turn %s", (
    message,
    locale,
    reasonCode
  ) => {
    const route = routeV3Request(message);
    expect(route).toMatchObject({
      kind: "capability",
      route: "conversation",
      locale,
      symbols: [],
      requiresPortfolio: false,
      requiresMarketData: false,
      requiresKnowledge: false,
      reasonCodes: [reasonCode]
    });
    const policy = evaluateV3Policy({
      route,
      session: trustedSession(),
      now: NOW
    });
    expect(policy).toMatchObject({
      action: "allow",
      authorized: true,
      allowedToolIds: [],
      capabilities: []
    });
  });

  it("does not let a social prefix suppress the factual or execution route", () => {
    expect(routeV3Request("Thanks—what is the current NVDA price?")).toMatchObject({
      route: "market_quote",
      symbols: ["NVDA"]
    });
    expect(routeV3Request(
      "Çox sağ ol, AAPL indi neçəyə ticarət olunur?"
    )).toMatchObject({
      kind: "capability",
      route: "market_quote",
      locale: "az-AZ",
      symbols: ["AAPL"]
    });
    expect(routeV3Request("Can you buy NVDA for me?")).toMatchObject({
      kind: "boundary",
      boundary: "order_execution"
    });
    expect(routeV3Request("Mənim üçün AAPL ala bilərsən?")).toMatchObject({
      kind: "boundary",
      boundary: "order_execution"
    });
  });

  it("binds supported market-history periods and clarifies custom date ranges", () => {
    expect(routeV3Request("Show AAPL's one-month price chart")).toMatchObject({
      route: "market_history",
      symbols: ["AAPL"],
      reasonCodes: ["market_history_range:1m"]
    });
    expect(routeV3Request(
      "Show AAPL price history from 2026-01-01 to 2026-06-30"
    )).toMatchObject({
      kind: "clarify",
      route: null,
      reasonCodes: ["market_history_custom_range_unsupported"]
    });
  });

  it("does not return out-of-range or public-tariff data for private activity gaps", () => {
    expect(routeV3Request(
      "Show my order history from 2026-06-01 to 2026-06-30"
    )).toMatchObject({
      kind: "clarify",
      route: null,
      reasonCodes: ["activity_date_range_unsupported"]
    });
    expect(routeV3Request("Show my recent fees and dividends")).toMatchObject({
      kind: "clarify",
      route: null,
      reasonCodes: ["account_fee_dividend_activity_unsupported"]
    });
  });

  it("uses explicit boundaries for language switching and out-of-scope requests", () => {
    expect(routeV3Request("Answer in Azerbaijani please", {
      locale: "en-US"
    })).toMatchObject({
      kind: "clarify",
      route: null,
      reasonCodes: ["language_switch_requires_new_session"]
    });
    expect(routeV3Request("What is the weather tomorrow?")).toMatchObject({
      kind: "clarify",
      route: null,
      reasonCodes: ["out_of_scope_request"]
    });
    expect(routeV3Request("Sabah hava necə olacaq?")).toMatchObject({
      kind: "clarify",
      route: null,
      locale: "az-AZ",
      reasonCodes: ["out_of_scope_request"]
    });
  });

  it("keeps compound product-knowledge requests on governed retrieval", () => {
    expect(routeV3Request(
      "What products, fees, risks, and disclosures does Demo Invest have?"
    )).toMatchObject({
      route: "approved_knowledge",
      reasonCodes: ["compound_approved_knowledge_marker"]
    });
  });

  it("reserves P&L, YTD, TWR, and ETF before ticker extraction", () => {
    expect(extractV3Symbols("Show YTD P&L, TWR and explain ETF risk")).toEqual([]);
    expect(routeV3Request("Portfelimin YTD P&L-ni explain et")).toMatchObject({
      route: "ytd_gain_loss_twr",
      symbols: [],
      locale: "az-AZ",
    });
  });

  it("supports typos, morphology, and code-switching without inventing symbols", () => {
    expect(routeV3Request("porfolio performance YTD").route).toBe("ytd_gain_loss_twr");
    expect(routeV3Request("What is my current portoflio value?")).toMatchObject({
      kind: "mvp",
      route: "current_portfolio_value",
      reasonCodes: ["current_portfolio_value_marker"],
    });
    expect(routeV3Request("Show the balance for my portfolio now")).toMatchObject({
      kind: "mvp",
      route: "current_portfolio_value",
      reasonCodes: ["current_portfolio_value_marker"],
    });
    expect(routeV3Request("NVDA riskini analyze et")).toMatchObject({
      route: "security_risk",
      locale: "az-AZ",
      symbols: ["NVDA"],
    });
    expect(routeV3Request("risk anaylsis for nvda")).toMatchObject({
      route: "security_risk",
      symbols: ["NVDA"],
    });
    expect(extractV3Symbols("Bəs AAPL?")).toEqual(["AAPL"]);
    expect(routeV3Request("Bəs AAPL?", { locale: "az-AZ" })).toMatchObject({
      kind: "clarify",
      symbols: ["AAPL"]
    });
  });

  it("separates a read-only order preview from execution", () => {
    expect(routeV3Request("Preview selling 2 AAPL shares")).toMatchObject({
      kind: "clarify",
      route: null,
      readOnly: true,
      reasonCodes: ["order_preview_sell_not_supported"]
    });
    expect(routeV3Request("Buy 2 AAPL shares now")).toMatchObject({
      kind: "boundary",
      boundary: "order_execution",
      readOnly: false,
    });
  });

  it("applies bounded subject and intent context only to explicit follow-ups", () => {
    const risk = applyV3ConversationRouteContext({
      message: "What are its risks?",
      route: routeV3Request("What are its risks?", { locale: "en-US" }),
      rememberedRoute: "company_research",
      rememberedSymbols: ["NVDA"]
    });
    expect(risk).toMatchObject({
      route: "security_risk",
      symbols: ["NVDA"],
      reasonCodes: expect.arrayContaining(["conversation_symbol_context"])
    });

    const changedSubject = applyV3ConversationRouteContext({
      message: "And AAPL?",
      route: routeV3Request("And AAPL?", { locale: "en-US" }),
      rememberedRoute: "technical_analysis",
      rememberedSymbols: ["NVDA"]
    });
    expect(changedSubject).toMatchObject({
      route: "technical_analysis",
      symbols: ["AAPL"],
      reasonCodes: expect.arrayContaining(["conversation_intent_context"])
    });

    const inherited = applyV3ConversationRouteContext({
      message: "What else can you tell me about it?",
      route: routeV3Request("What else can you tell me about it?", { locale: "en-US" }),
      rememberedRoute: "company_research",
      rememberedSymbols: ["NVDA"]
    });
    expect(inherited).toMatchObject({
      route: "company_research",
      symbols: ["NVDA"],
      reasonCodes: expect.arrayContaining([
        "conversation_intent_context",
        "conversation_symbol_context"
      ])
    });
  });

  it.each([
    ["price", "market_quote", "en-US"],
    ["What's its latest quote?", "market_quote", "en-US"],
    ["qiyməti", "market_quote", "az-AZ"],
    ["risk analysis", "security_risk", "en-US"],
    ["riskləri", "security_risk", "az-AZ"],
    ["news", "news_sentiment", "en-US"],
    ["xəbərlər", "news_sentiment", "az-AZ"],
    ["indicators", "technical_analysis", "en-US"],
    ["texniki analiz", "technical_analysis", "az-AZ"],
    ["cost basis", "holding_average_cost", "en-US"],
    ["orta alış qiyməti", "holding_average_cost", "az-AZ"],
  ] as const)(
    "uses the requested %s facet instead of inheriting an earlier research intent",
    (message, expectedRoute, locale) => {
      const routed = routeV3Request(message, { locale });
      const contextual = applyV3ConversationRouteContext({
        message,
        route: routed,
        rememberedRoute: "company_research",
        rememberedSymbols: ["NVDA"],
      });

      expect(contextual).toMatchObject({
        route: expectedRoute,
        symbols: ["NVDA"],
      });
      if (routed.kind === "clarify") {
        expect(contextual.reasonCodes).toContain("conversation_facet_context");
        expect(contextual.reasonCodes).not.toContain("conversation_intent_context");
      }
    },
  );

  it("does not inherit a multi-symbol subject for average cost in EN or AZ", () => {
    for (const [message, locale] of [
      ["average cost", "en-US"],
      ["orta alış qiyməti", "az-AZ"],
    ] as const) {
      const routed = routeV3Request(message, { locale });
      const contextual = applyV3ConversationRouteContext({
        message,
        route: routed,
        rememberedRoute: "company_research",
        rememberedSymbols: ["NVDA", "AAPL"],
      });

      expect(contextual).toBe(routed);
      expect(contextual.symbols).toEqual([]);
    }

    const unresolved = routeV3Request("What else?", { locale: "en-US" });
    expect(applyV3ConversationRouteContext({
      message: "What else?",
      route: unresolved,
      rememberedRoute: "holding_average_cost",
      rememberedSymbols: ["NVDA", "AAPL"],
    })).toBe(unresolved);
  });

  it("does not reuse context for ordinary text, ambiguous singulars, or order previews", () => {
    const ordinary = routeV3Request("Hello again", { locale: "en-US" });
    expect(applyV3ConversationRouteContext({
      message: "Hello again",
      route: ordinary,
      rememberedRoute: "company_research",
      rememberedSymbols: ["NVDA"]
    })).toBe(ordinary);

    const ambiguous = routeV3Request("What are its risks?", { locale: "en-US" });
    expect(applyV3ConversationRouteContext({
      message: "What are its risks?",
      route: ambiguous,
      rememberedRoute: "company_research",
      rememberedSymbols: ["NVDA", "AAPL"]
    })).toBe(ambiguous);

    const order = routeV3Request("Open a $100 buy ticket preview", { locale: "en-US" });
    expect(applyV3ConversationRouteContext({
      message: "Open a $100 buy ticket preview",
      route: order,
      rememberedRoute: "market_quote",
      rememberedSymbols: ["NVDA"]
    })).toBe(order);
  });
});

describe("V3 route-policy control plane", () => {
  it("uses only the thirteen approved boundary tool IDs", () => {
    expect(V3_APPROVED_BOUNDARY_TOOL_IDS).toEqual([
      "resolve-instrument",
      "read-market-snapshot",
      "read-price-history",
      "read-instrument-research",
      "read-market-content",
      "convert-currency",
      "analyze-portfolio-allocation",
      "read-portfolio-snapshot",
      "read-portfolio-activity",
      "retrieve-reviewed-investment-education",
      "retrieve-approved-product-knowledge",
      "read-order-eligibility",
      "create-signed-order-handoff",
    ]);
  });

  it("allows only the tools, consent, and entitlements for the selected route", () => {
    const route = routeV3Request("What is my current portfolio value?");
    const session = trustedSession();
    const policy = evaluateV3Policy({ route, session, now: NOW });

    expect(policy).toMatchObject({
      action: "allow",
      authorized: true,
      route: "current_portfolio_value",
      allowedToolIds: [
        "read-portfolio-snapshot",
        "read-market-snapshot"
      ],
    });
    expect(enforceV3PolicyAgreement(route, policy, session, NOW)).toBe(policy);
  });

  it("authorizes current quotes with an exact long-term history boundary", () => {
    const route = routeV3Request("What is the current INTC price?");
    const policy = evaluateV3Policy({ route, session: trustedSession(), now: NOW });

    expect(policy).toMatchObject({
      action: "allow",
      route: "market_quote",
      allowedToolIds: [
        "resolve-instrument",
        "read-market-snapshot",
        "read-price-history",
      ],
    });
  });

  it("authorizes the converter only for an explicitly converted route", () => {
    const session = trustedSession();
    const quoteRoute = routeV3Request(
      "What is the current NVDA price in AZN?"
    );
    const portfolioRoute = routeV3Request(
      "What is the value of my portfolio in AZN?"
    );

    expect(evaluateV3Policy({
      route: quoteRoute,
      session,
      now: NOW
    }).allowedToolIds).toEqual([
      "resolve-instrument",
      "read-market-snapshot",
      "convert-currency",
      "read-price-history"
    ]);
    expect(evaluateV3Policy({
      route: portfolioRoute,
      session,
      now: NOW
    }).allowedToolIds).toEqual([
      "read-portfolio-snapshot",
      "read-market-snapshot",
      "convert-currency"
    ]);
  });

  it.each([
    "Should I invest in INTC?",
    "Compare NVDA and AAPL",
  ])("authorizes the complete quote, research, and history tool set for %s", (message) => {
    const route = routeV3Request(message);
    const policy = evaluateV3Policy({ route, session: trustedSession(), now: NOW });

    expect(policy).toMatchObject({
      action: "allow",
      route: "company_research",
      allowedToolIds: [
        "resolve-instrument",
        "read-market-snapshot",
        "read-instrument-research",
        "read-price-history",
      ],
    });
  });

  it("uses the signed allocation tool for hypothetical analysis and limits a position comparison to public quote tools", () => {
    const session = trustedSession();
    const portfolioRoute = routeV3Request(
      "Imagine my portfolio is 60% NVDA, 20% AAPL, 20% cash."
    );
    const positionRoute = routeV3Request(
      "Assume I own 15 shares of NVDA bought at $170 each. Should I buy more, hold, or sell?"
    );

    expect(evaluateV3Policy({
      route: portfolioRoute,
      session,
      now: NOW
    })).toMatchObject({
      authorized: true,
      allowedToolIds: ["analyze-portfolio-allocation"],
      capabilities: []
    });
    expect(evaluateV3Policy({
      route: positionRoute,
      session,
      now: NOW
    })).toMatchObject({
      authorized: true,
      allowedToolIds: ["resolve-instrument", "read-market-snapshot"],
      capabilities: ["market:read"]
    });
  });

  it("denies missing consent or entitlement", () => {
    const route = routeV3Request("What is my current portfolio value?");
    const session = trustedSession(
      ["assistant_use"],
      ["assistant_access", "portfolio_read"],
    );
    const policy = evaluateV3Policy({ route, session, now: NOW });

    expect(policy.authorized).toBe(false);
    expect(policy.allowedToolIds).toEqual([]);
    expect(policy.reasonCodes).toContain("missing_consent:portfolio_data");
    expect(() => enforceV3PolicyAgreement(route, policy, session, NOW)).toThrowError(
      /did not authorize/i,
    );
  });

  it("rejects client-forged session objects", () => {
    const route = routeV3Request("What is my current portfolio value?");
    const forged = {
      trusted: true,
      claims: {
        tenantId: "tenant-demo-invest-az",
        principalId: "customer-42",
        consents: ALL_CONSENTS,
        entitlements: ALL_ENTITLEMENTS,
        issuedAt: NOW,
        expiresAt: NOW + 60_000,
      },
    };

    expect(evaluateV3Policy({ route, session: forged, now: NOW })).toMatchObject({
      authorized: false,
      reasonCodes: ["trusted_current_session_required"],
    });
  });

  it("fails closed when the router and policy disagree", () => {
    const session = trustedSession();
    const quoteRoute = routeV3Request("current NVDA price");
    const quotePolicy = evaluateV3Policy({ route: quoteRoute, session, now: NOW });
    const researchRoute = routeV3Request("analyze NVDA fundamentals");

    expect(() =>
      enforceV3PolicyAgreement(researchRoute, quotePolicy, session, NOW),
    ).toThrowError(/disagree/i);
  });

  it("never authorizes boundary routes", () => {
    const session = trustedSession();
    const route = routeV3Request("Buy 2 AAPL shares now");
    const policy = evaluateV3Policy({ route, session, now: NOW });

    expect(policy).toMatchObject({ action: "deny", authorized: false, allowedToolIds: [] });
  });
});

describe("TWR definition and personal-metric routing", () => {
  it.each([
    ["TWR nədir?", "az-AZ"],
    ["test TWR nədir?", "az-AZ"],
    ["TWR nedir?", "az-AZ"],
    ["TWR-ni izah et", "az-AZ"],
    ["What is TWR?", "en-US"],
    ["Define TWR", "en-US"],
    ["How is TWR calculated?", "en-US"],
    ["TWR", "en-US"]
  ] as const)("routes %s to reviewed education without portfolio access", (
    message,
    locale
  ) => {
    expect(routeV3Request(message)).toMatchObject({
      route: "education",
      locale,
      symbols: [],
      requiresPortfolio: false,
      requiresMarketData: false,
      requiresKnowledge: true,
      reasonCodes: [
        financialEducationRouteReason(message)
      ]
    });
  });

  it("routes a general financial concept by query hash without a topic identifier", () => {
    const message = "What does bond duration mean?";
    expect(routeV3Request(message)).toMatchObject({
      route: "education",
      locale: "en-US",
      symbols: [],
      requiresPortfolio: false,
      requiresMarketData: false,
      requiresKnowledge: true,
      reasonCodes: [financialEducationRouteReason(message)]
    });
  });

  it.each([
    "What is my TWR?",
    "Mənim TWR-im nədir?",
    "Portfelimin YTD TWR-si nədir?",
    "Show my YTD gain/loss and TWR"
  ])("keeps %s on the personal portfolio calculation route", (message) => {
    expect(routeV3Request(message)).toMatchObject({
      route: "ytd_gain_loss_twr",
      requiresPortfolio: true,
      requiresMarketData: true,
      requiresKnowledge: false
    });
  });
});
