import type {
  AssistantCitation,
  AssistantInAppAction,
  AssistantResponse,
  DecimalString,
  SupportedLocale
} from "../../src/assistant-v3/contracts.js";
import type { PortfolioSummary } from "../../src/domain/types.js";

export const E2E_ORIGIN = "http://127.0.0.1:4173";
export const E2E_AS_OF = "2026-07-25T12:00:00.000Z";
export const E2E_CONVERSATION_ID = "00000000-0000-4000-8000-000000000417";

const decimal = (value: string): DecimalString => value as DecimalString;

export const E2E_CLIENT = Object.freeze({
  id: "e2e-synthetic-client",
  displayName: "E2E Investor",
  initials: "EI",
  locale: "en-US" as const,
  accountLabel: "Synthetic browser-test account",
  baseCurrency: "USD" as const,
  isMock: true as const
});

export const E2E_PORTFOLIO: PortfolioSummary = {
  clientId: E2E_CLIENT.id,
  baseCurrency: "USD",
  asOf: E2E_AS_OF,
  holdings: [
    {
      symbol: "AAPL",
      name: "Apple Inc.",
      assetClass: "Equity",
      quantity: 10,
      averageCost: 180,
      currency: "USD",
      quote: {
        symbol: "AAPL",
        displayName: "Apple Inc.",
        currency: "USD",
        exchange: "NasdaqGS",
        instrumentType: "EQUITY",
        price: 210.25,
        previousClose: 209.5,
        change: 0.75,
        changePercent: 0.3579952267,
        marketState: "CLOSED" as const,
        freshness: "indicative" as const,
        delayMinutes: 0,
        asOf: E2E_AS_OF,
        source: "Offline E2E fixture",
        notice: "Deterministic browser-test value."
      },
      costBasis: 1_800,
      marketValue: 2_102.5,
      unrealizedPnl: 302.5,
      unrealizedPnlPercent: 16.81,
      dayChangeValue: 7.5,
      allocationPercent: 15.87
    },
    {
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      assetClass: "Equity",
      quantity: 40,
      averageCost: 150,
      currency: "USD",
      quote: {
        symbol: "NVDA",
        displayName: "NVIDIA Corporation",
        currency: "USD",
        exchange: "NasdaqGS",
        instrumentType: "EQUITY",
        price: 198.7,
        previousClose: 197.9,
        change: 0.8,
        changePercent: 0.4042445679,
        marketState: "CLOSED" as const,
        freshness: "indicative" as const,
        delayMinutes: 0,
        asOf: E2E_AS_OF,
        source: "Offline E2E fixture",
        notice: "Deterministic browser-test value."
      },
      costBasis: 6_000,
      marketValue: 7_948,
      unrealizedPnl: 1_948,
      unrealizedPnlPercent: 32.47,
      dayChangeValue: 32,
      allocationPercent: 59.98
    }
  ],
  cash: [{ currency: "USD", amount: 3_200 }],
  positionsValue: 10_050.5,
  cashValue: 3_200,
  coveredValue: 13_250.5,
  costBasis: 7_800,
  unrealizedPnl: 2_250.5,
  unrealizedPnlPercent: 28.85,
  dayChangeValue: 39.5,
  pricedHoldings: 2,
  totalHoldings: 2,
  coverageComplete: true,
  notices: ["Synthetic browser-test portfolio."]
};

interface GuideDefinition {
  readonly key: "account-opening" | "funding" | "share-purchase" | "withdrawal";
  readonly target: AssistantInAppAction["target"];
  readonly path: AssistantInAppAction["href"];
  readonly actionId: string;
  readonly prompt: Readonly<Record<SupportedLocale, string>>;
  readonly label: Readonly<Record<SupportedLocale, string>>;
  readonly heading: Readonly<Record<SupportedLocale, string>>;
  readonly noticePattern: Readonly<Record<SupportedLocale, RegExp>>;
  readonly source: Readonly<Record<SupportedLocale, {
    sourceId: string;
    url: string;
    contentHash: string;
  }>>;
}

export const GUIDE_DEFINITIONS: readonly GuideDefinition[] = Object.freeze([
  {
    key: "account-opening",
    target: "investments.account-opening.guide",
    path: "/investments/guides/account-opening",
    actionId: "view-investment-account-opening-guide",
    prompt: {
      "en-US": "How do I open an investment account?",
      "az-AZ": "İnvestisiya hesabını necə aça bilərəm?"
    },
    label: {
      "en-US": "View account-opening steps",
      "az-AZ": "Hesabın açılması addımlarına bax"
    },
    heading: {
      "en-US": "Open an investment account",
      "az-AZ": "İnvestisiya hesabını açın"
    },
    noticePattern: {
      "en-US": /guidance only/iu,
      "az-AZ": /yalnız təlimat/iu
    },
    source: {
      "en-US": {
        sourceId:
          "demo-invest-account-opening-en@project-authored-synthetic-2026-07-21",
        url: "https://knowledge.demo-invest.invalid/en/account-opening",
        contentHash:
          "8523ac2eb5cae20efcf514a609f2d100562cb7e23425ae6b2ef769c4fda5a067"
      },
      "az-AZ": {
        sourceId:
          "demo-invest-account-opening-az@project-authored-synthetic-2026-07-21",
        url: "https://knowledge.demo-invest.invalid/az/account-opening",
        contentHash:
          "c67aac1fc4de4ec08c82477fea709e86f218b68e9a942703a446408ff86832db"
      }
    }
  },
  {
    key: "funding",
    target: "investments.funding.guide",
    path: "/investments/guides/funding",
    actionId: "view-investment-account-funding-guide",
    prompt: {
      "en-US": "How do I fund my investment account?",
      "az-AZ": "İnvestisiya hesabına necə mədaxil edim?"
    },
    label: {
      "en-US": "View funding steps",
      "az-AZ": "Mədaxil addımlarına bax"
    },
    heading: {
      "en-US": "Review investment-account funding",
      "az-AZ": "İnvestisiya hesabına mədaxil addımları"
    },
    noticePattern: {
      "en-US": /does not initiate a transfer/iu,
      "az-AZ": /köçürmə başlatmır/iu
    },
    source: {
      "en-US": {
        sourceId:
          "demo-invest-funding-en@project-authored-synthetic-2026-07-21",
        url: "https://knowledge.demo-invest.invalid/en/funding",
        contentHash:
          "525957899d5269a3681a1e1b8a7170eb6c9d9e53863211aca2233915168bbf0c"
      },
      "az-AZ": {
        sourceId:
          "demo-invest-funding-az@project-authored-synthetic-2026-07-21",
        url: "https://knowledge.demo-invest.invalid/az/funding",
        contentHash:
          "111648055ba6f696cccdb91f7d48c3f15fac759b71cd3360c0df9cd14277fa3f"
      }
    }
  },
  {
    key: "share-purchase",
    target: "investments.share-purchase.guide",
    path: "/investments/guides/share-purchase",
    actionId: "view-share-purchase-guide",
    prompt: {
      "en-US": "How do I buy company shares?",
      "az-AZ": "Şirkət səhmlərini necə ala bilərəm?"
    },
    label: {
      "en-US": "View share-purchase steps",
      "az-AZ": "Səhm alışı addımlarına bax"
    },
    heading: {
      "en-US": "Review the share-purchase steps",
      "az-AZ": "Səhm alışı addımlarını nəzərdən keçirin"
    },
    noticePattern: {
      "en-US": /cannot create, submit, confirm, or execute/iu,
      "az-AZ": /sifariş yarada, göndərə, təsdiqləyə və ya icra edə bilməz/iu
    },
    source: {
      "en-US": {
        sourceId:
          "demo-invest-purchase-process-en@project-authored-synthetic-2026-07-21",
        url: "https://knowledge.demo-invest.invalid/en/order-preview",
        contentHash:
          "913811301a0db26fce9b6f20b8fc53671576b1d9a2c4c014aa9eeddba7b7db66"
      },
      "az-AZ": {
        sourceId:
          "demo-invest-purchase-process-az@project-authored-synthetic-2026-07-21",
        url: "https://knowledge.demo-invest.invalid/az/order-preview",
        contentHash:
          "1189ae637d6e65c76eb3e120ecf156d6d4d7c1bc8c747ef3f569634878ab5f84"
      }
    }
  },
  {
    key: "withdrawal",
    target: "investments.withdrawal.guide",
    path: "/investments/guides/withdrawal",
    actionId: "view-investment-withdrawal-guide",
    prompt: {
      "en-US": "How do I withdraw from my investment account?",
      "az-AZ": "İnvestisiya hesabından pulu necə çıxarım?"
    },
    label: {
      "en-US": "View withdrawal steps",
      "az-AZ": "Məxaric addımlarına bax"
    },
    heading: {
      "en-US": "Review the withdrawal flow",
      "az-AZ": "Məxaric prosesini nəzərdən keçirin"
    },
    noticePattern: {
      "en-US": /cannot initiate or authorize a withdrawal/iu,
      "az-AZ": /məxaric başlada və ya təsdiqləyə bilməz/iu
    },
    source: {
      "en-US": {
        sourceId:
          "demo-invest-withdrawal-en@project-authored-synthetic-2026-07-21",
        url: "https://knowledge.demo-invest.invalid/en/withdrawals",
        contentHash:
          "98278a295cdee7e1d6e018312a4df4a209031c2ebfc2446c366a8861009751e6"
      },
      "az-AZ": {
        sourceId:
          "demo-invest-withdrawal-az@project-authored-synthetic-2026-07-21",
        url: "https://knowledge.demo-invest.invalid/az/withdrawals",
        contentHash:
          "c675669f5e2cd60332d2341de23d4632cfd8712708f1ba195d78a6ba16c200bc"
      }
    }
  }
] satisfies readonly GuideDefinition[]);

export const CHAT_PROMPTS = Object.freeze({
  "en-US": {
    cash: "What is my cash balance?",
    portfolio: "What is my current portfolio value?",
    activity: "Show my recent trading activity",
    quote: "What is the current AAPL price?"
  },
  "az-AZ": {
    cash: "Nağd balansım nə qədərdir?",
    portfolio: "Portfelimin cari dəyəri nə qədərdir?",
    activity: "Son ticarət fəaliyyətimi göstər",
    quote: "AAPL səhminin cari qiyməti nədir?"
  }
} as const);

export const READ_ONLY_NAVIGATION_TEST_PROMPTS = Object.freeze({
  mismatchedFact: "Show a cash card with a mismatched navigation fact",
  blockedDelivery: "Show a blocked cash navigation action"
});

function citationFor(
  guide: GuideDefinition,
  locale: SupportedLocale
): AssistantCitation {
  const source = guide.source[locale];
  return {
    citationId: `citation-e2e-${guide.key}-${locale}`,
    sourceId: source.sourceId,
    title:
      locale === "az-AZ"
        ? `Demo Invest ${guide.key} təlimatı`
        : `Demo Invest ${guide.key} guidance`,
    url: source.url,
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    effectiveTo: null,
    contentHash: source.contentHash
  };
}

function response(
  locale: SupportedLocale,
  message: string,
  overrides: Partial<AssistantResponse> = {}
): AssistantResponse {
  return {
    schemaVersion: "assistant-v3.response.v1",
    requestId: `request-e2e-${locale}-${message.length}`,
    conversationId: E2E_CONVERSATION_ID,
    status: "complete",
    message,
    claims: [],
    facts: [],
    citations: [],
    cards: [],
    charts: [],
    actions: [],
    notices: ["Deterministic offline browser fixture."],
    freshness: [],
    evaluations: [],
    deliveryGate: "pass",
    generationMode: "deterministic",
    provenance: {
      workflowId: "assistant-request-v3",
      workflowVersion: "3.0.0",
      workflowRunId: `workflow-e2e-${locale}-${message.length}`,
      model: null,
      toolExecutionIds: [],
      factIds: [],
      policyVersion: "3.0.0"
    },
    ...overrides
  };
}

function portfolioResponse(
  locale: SupportedLocale,
  kind: "cash" | "portfolio"
): AssistantResponse {
  const cash = kind === "cash";
  const factRef = `fact-e2e-${kind}`;
  return response(
    locale,
    locale === "az-AZ"
      ? cash
        ? "Hazırda portfelinizdə 3.200,00 ABŞ dolları nağd vəsait var."
        : "Portfelinizin cari ümumi dəyəri 13.250,50 ABŞ dollarıdır. Buraya 10 AAPL səhmi (2.102,50 ABŞ dolları), 40 NVDA səhmi (7.948,00 ABŞ dolları) və 3.200,00 ABŞ dolları nağd vəsait daxildir."
      : cash
        ? "Your current portfolio cash balance is $3,200.00."
        : "Your current total portfolio value is $13,250.50. It includes 10 AAPL shares worth $2,102.50, 40 NVDA shares worth $7,948.00, and $3,200.00 in cash.",
    {
      cards: [{
        cardId: `card-e2e-${kind}-${locale}`,
        kind: "portfolio",
        title:
          locale === "az-AZ"
            ? cash
              ? "Nağd vəsait"
              : "Portfel icmalı"
            : cash
              ? "Cash position"
              : "Portfolio snapshot",
        factRefs: [factRef],
        data: {
          totalValue: "13250.50",
          positionsValue: "10050.50",
          cashValue: "3200.00",
          currency: "USD",
          positions: [
            {
              symbol: "AAPL",
              quantity: "10.00000000",
              marketValue: "2102.50",
              currency: "USD"
            },
            {
              symbol: "NVDA",
              quantity: "40.00000000",
              marketValue: "7948.00",
              currency: "USD"
            }
          ]
        }
      }],
      actions: cash
        ? [{
            schemaVersion:
              "assistant-v3.read-only-navigation-action.v1",
            actionId: "view-portfolio-cash",
            kind: "open-read-only-view",
            target: "investments.portfolio.cash",
            label:
              locale === "az-AZ"
                ? "Nağd vəsait məlumatına bax"
                : "View cash details",
            href: "/investments/portfolio/cash",
            factRefs: [factRef],
            catalogVersion:
              "governed-investment-read-only-navigation-2026-07-29.v1"
          }]
        : []
    }
  );
}

function invalidReadOnlyNavigationResponse(
  locale: SupportedLocale,
  blocked: boolean
): AssistantResponse {
  const valid = portfolioResponse(locale, "cash");
  const action = valid.actions[0];
  if (action?.kind !== "open-read-only-view") {
    throw new Error("offline_e2e_read_only_action_fixture_missing");
  }
  return {
    ...valid,
    requestId: blocked
      ? "request-e2e-blocked-read-only"
      : "request-e2e-mismatched-read-only",
    message: blocked
      ? "This response is intentionally delivery-blocked."
      : "This response contains an intentionally mismatched action binding.",
    deliveryGate: blocked ? "blocked" : "pass",
    actions: [{
      ...action,
      factRefs: [
        blocked
          ? valid.cards[0]?.factRefs[0] ?? "fact-e2e-cash"
          : "fact-e2e-different-card"
      ]
    }]
  };
}

function activityResponse(locale: SupportedLocale): AssistantResponse {
  return response(
    locale,
    locale === "az-AZ"
      ? "İcra edilmiş alış: 2 AAPL səhmi 208,25 ABŞ dollarından, cəmi 416,50 ABŞ dolları. Açıq sifariş: 3,5 NVDA səhminin 225,25 ABŞ dolları limitlə satışı; yalnız status, icra deyil."
      : "Executed purchase: 2 AAPL shares at $208.25, totaling $416.50. Open order: sell 3.5 NVDA shares with a $225.25 limit; this is state only, not an execution.",
    {
      cards: [{
        cardId: `card-e2e-activity-${locale}`,
        kind: "activity",
        title:
          locale === "az-AZ"
            ? "Son ticarət fəaliyyəti"
            : "Recent trading activity",
        factRefs: ["fact-e2e-activity"],
        data: {
          route: "recent_trading_activity",
          asOf: E2E_AS_OF,
          limit: 10,
          matchedCount: 2,
          returnedCount: 2,
          hasMore: false,
          dataClass: "synthetic",
          records: [
            {
              recordType: "execution",
              positionEffect: "EXECUTED_TRADE",
              occurredAt: "2026-07-24T10:30:00.000Z",
              symbol: "AAPL",
              side: "BUY",
              quantity: "2.00000000",
              unitPrice: { amount: "208.25000000", currency: "USD" },
              grossAmount: { amount: "416.50000000", currency: "USD" }
            },
            {
              recordType: "order",
              positionEffect: "ORDER_STATE_ONLY",
              occurredAt: "2026-07-24T09:15:00.000Z",
              symbol: "NVDA",
              side: "SELL",
              orderType: "LIMIT",
              timeInForce: "DAY",
              status: "OPEN",
              requestedQuantity: "3.50000000",
              filledQuantity: "0.00000000",
              limitPrice: { amount: "225.25000000", currency: "USD" },
              averageFillPrice: null
            }
          ]
        }
      }]
    }
  );
}

function quoteResponse(locale: SupportedLocale): AssistantResponse {
  return response(
    locale,
    locale === "az-AZ"
      ? "AAPL üçün son indikativ bağlanış qiyməti 210,25 ABŞ dollarıdır."
      : "AAPL's latest indicative close is $210.25.",
    {
      cards: [{
        cardId: `card-e2e-quote-${locale}`,
        kind: "research",
        title: locale === "az-AZ" ? "AAPL bazar icmalı" : "AAPL market snapshot",
        factRefs: ["fact-e2e-aapl-quote"],
        data: {
          resolved: {
            symbol: "AAPL",
            displayName: "Apple Inc.",
            exchange: "NasdaqGS",
            instrumentType: "EQUITY"
          },
          snapshot: {
            price: "210.25",
            currency: "USD",
            changePercent: "0.35799523",
            marketState: "CLOSED"
          },
          summaryMetrics: {
            marketCapitalization: {
              status: "AVAILABLE",
              value: {
                value: "3250000000000.00",
                unit: "currency",
                currency: "USD"
              }
            },
            trailingPe: {
              status: "AVAILABLE",
              value: { value: "32.10", unit: "ratio" }
            }
          }
        }
      }],
      charts: [{
        chartId: `chart-e2e-aapl-10y-${locale}`,
        symbol: "AAPL",
        range: "10y",
        currency: "USD",
        asOf: E2E_AS_OF,
        source: "Offline E2E market-history fixture",
        points: [
          { timestamp: "2016-07-25T00:00:00.000Z", close: decimal("24.15") },
          { timestamp: "2019-07-25T00:00:00.000Z", close: decimal("52.20") },
          { timestamp: "2022-07-25T00:00:00.000Z", close: decimal("152.95") },
          { timestamp: "2026-07-25T00:00:00.000Z", close: decimal("210.25") }
        ]
      }],
      citations: [{
        citationId: "citation-e2e-aapl-market",
        sourceId: "offline-e2e-market-history",
        title: "AAPL deterministic browser-test market history",
        url: "https://example.invalid/e2e/aapl",
        sourceAsOf: E2E_AS_OF,
        effectiveFrom: null,
        effectiveTo: null,
        contentHash:
          "77aee3f018706c31d922894327610e582103329cf75bfa5ec8ff7fda56d901c"
      }],
      freshness: [{
        sourceId: "offline-e2e-market-history",
        asOf: E2E_AS_OF,
        status: "indicative",
        delayMinutes: "0"
      }]
    }
  );
}

function guideResponse(
  locale: SupportedLocale,
  guide: GuideDefinition
): AssistantResponse {
  const citation = citationFor(guide, locale);
  return response(
    locale,
    locale === "az-AZ"
      ? "Nəzərdən keçirilmiş addım-addım təlimatı aça bilərsiniz."
      : "You can open the reviewed step-by-step guide.",
    {
      citations: [citation],
      actions: [{
        schemaVersion: "assistant-v3.in-app-navigation-action.v1",
        actionId: guide.actionId,
        kind: "open-in-app",
        target: guide.target,
        label: guide.label[locale],
        href: guide.path,
        citationRefs: [citation.citationId],
        catalogVersion: "demo-invest-navigation-2026-07-29.v1"
      }]
    }
  );
}

export function assistantResponseFor(
  locale: SupportedLocale,
  message: string
): AssistantResponse {
  const normalized = message.normalize("NFKC").trim();
  if (normalized === CHAT_PROMPTS[locale].cash) {
    return portfolioResponse(locale, "cash");
  }
  if (normalized === CHAT_PROMPTS[locale].portfolio) {
    return portfolioResponse(locale, "portfolio");
  }
  if (normalized === CHAT_PROMPTS[locale].activity) {
    return activityResponse(locale);
  }
  if (normalized === CHAT_PROMPTS[locale].quote) {
    return quoteResponse(locale);
  }
  if (normalized === READ_ONLY_NAVIGATION_TEST_PROMPTS.mismatchedFact) {
    return invalidReadOnlyNavigationResponse(locale, false);
  }
  if (normalized === READ_ONLY_NAVIGATION_TEST_PROMPTS.blockedDelivery) {
    return invalidReadOnlyNavigationResponse(locale, true);
  }
  const guide = GUIDE_DEFINITIONS.find(
    (candidate) => candidate.prompt[locale] === normalized
  );
  if (guide) return guideResponse(locale, guide);
  return response(
    locale,
    locale === "az-AZ"
      ? "Bu offline brauzer sınağı üçün həmin sorğu tanınmadı."
      : "That request is not defined in the offline browser fixture.",
    { status: "clarification-required" }
  );
}
