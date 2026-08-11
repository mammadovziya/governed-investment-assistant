import { describe, expect, it } from "vitest";

import {
  evaluateV3Policy
} from "../src/assistant-v3/policy.js";
import {
  extractV3Symbols,
  routeV3Request
} from "../src/assistant-v3/routing.js";
import {
  expectedV3DirectToolForQuery
} from "../src/assistant-v3/direct-no-tool.js";
import {
  v3DirectTickerCandidates,
  v3DirectResearchComparisonSymbols,
  v3ExactDirectTicker
} from "../src/assistant-v3/direct-symbols.js";
import {
  deriveV3DirectToolPlan
} from "../src/assistant-v3/registry.js";
import {
  V3SessionAuthority,
  type V3ConsentScope,
  type V3Entitlement
} from "../src/assistant-v3/sessions.js";

const NOW = Date.UTC(2026, 6, 28, 10, 0, 0);
const CONSENTS: readonly V3ConsentScope[] = [
  "assistant_use",
  "public_market_data"
];
const ENTITLEMENTS: readonly V3Entitlement[] = [
  "assistant_access",
  "market_read",
  "research_read"
];

function marketSession() {
  return new V3SessionAuthority({
    secret: "semantic-routing-regression-secret-at-least-32-bytes",
    now: () => NOW
  }).issue({
    tenantId: "tenant-demo-invest-az",
    principalId: "customer-semantic-routing",
    authContextId: "auth-semantic-routing",
    consentVersion: "consent-semantic-routing-v1",
    consents: CONSENTS,
    entitlementVersion: "entitlement-semantic-routing-v1",
    entitlements: ENTITLEMENTS
  }).session;
}

describe("V3 compositional multilingual routing regressions", () => {
  it.each([
    [
      "NVDA bu gün aşağı düşüb — səbəbi nə ola bilər?",
      "az-AZ"
    ],
    [
      "NVDA bu günaşağı düşüb — səbəbi nə ola bilər?",
      "az-AZ"
    ],
    [
      "NVDA niye bu gun asagi dusub?",
      "az-AZ"
    ],
    [
      "Why is NVDA down today?",
      "en-US"
    ],
    [
      "What could explain today's NVDA drop?",
      "en-US"
    ]
  ] as const)(
    "routes a causal market-move request without matching a complete canned phrase: %s",
    (message, locale) => {
      expect(routeV3Request(message)).toMatchObject({
        kind: "capability",
        route: "market_move_explanation",
        locale,
        symbols: ["NVDA"],
        requiresPortfolio: false,
        requiresMarketData: true,
        requiresKnowledge: false,
        readOnly: true
      });
    }
  );

  it("does not invent a market-move subject when no instrument is present", () => {
    expect(routeV3Request("Why is it down today?")).toMatchObject({
      kind: "clarify",
      route: null,
      symbols: []
    });
  });

  it.each([
    [
      "VOO ilə QQQ arasında əsas fərq nədir?",
      "az-AZ"
    ],
    [
      "VOO ve QQQ arasinda esas ferq nedir?",
      "az-AZ"
    ],
    [
      "What is the main difference between VOO and QQQ?",
      "en-US"
    ],
    [
      "How do VOO and QQQ differ?",
      "en-US"
    ]
  ] as const)(
    "recognizes a natural two-instrument difference relation: %s",
    (message, locale) => {
      expect(routeV3Request(message)).toMatchObject({
        kind: "capability",
        route: "company_research",
        locale,
        symbols: ["VOO", "QQQ"],
        reasonCodes: ["security_comparison_marker"],
        requiresMarketData: true
      });
    }
  );

  it.each([
    "What is the main difference between VOO?",
    "VOO, QQQ və SPY arasında əsas fərq nədir?"
  ])("does not broaden an incomplete or over-broad comparison: %s", (message) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "clarify",
      route: null
    });
  });

  it("authorizes exactly the evidence tools needed to explain a market move", () => {
    const route = routeV3Request("NVDA niyə bu gün aşağı düşüb?");
    const policy = evaluateV3Policy({
      route,
      session: marketSession(),
      now: NOW
    });

    expect(policy).toMatchObject({
      action: "allow",
      authorized: true,
      route: "market_move_explanation",
      capabilities: ["market:read", "research:read"],
      allowedToolIds: [
        "resolve-instrument",
        "read-market-snapshot",
        "read-price-history",
        "read-market-content"
      ]
    });
  });

  it.each([
    [
      "Mənə 3 aylıq yox, 5 illik plan üçün hansı ETF uyğun ola bilər?",
      "az-AZ"
    ],
    [
      "Mene 3 ayliq yox, 5 illik plan ucun hansi ETF uygun ola biler?",
      "az-AZ"
    ],
    [
      "Which ETF could fit a five-year plan rather than a three-month plan?",
      "en-US"
    ]
  ] as const)(
    "extracts investment-selection constraints and requests only the missing suitability inputs: %s",
    (message, locale) => {
      const route = routeV3Request(message);

      expect(route).toMatchObject({
        kind: "clarify",
        route: null,
        locale,
        symbols: [],
        reasonCodes: expect.arrayContaining([
          "investment_selection_inputs_required",
          "investment_asset_class:ETF",
          "investment_horizon_months:60",
          "investment_excluded_horizon_months:3",
          "investment_missing:risk_tolerance",
          "investment_missing:liquidity_needs",
          "investment_missing:portfolio_context"
        ]),
        requiresPortfolio: false,
        requiresMarketData: false,
        requiresKnowledge: false
      });
      expect(expectedV3DirectToolForQuery(message)).toBeNull();
    }
  );
});

describe("V3 public and direct entity extraction stay Unicode-safe", () => {
  it.each([
    "Mənə 3 aylıq yox, 5 illik plan üçün hansı ETF uyğun ola bilər?",
    "Nəyə baxmağımı istəyirsiniz?",
    "İllik ETF planını izah et."
  ])("does not extract an ASCII ticker prefix from an Azerbaijani word: %s", (message) => {
    expect(extractV3Symbols(message)).toEqual([]);
    expect(v3DirectTickerCandidates(message)).toEqual([]);
    expect(v3ExactDirectTicker(message)).toBeNull();
  });

  it.each([
    "VOO ilə QQQ arasında əsas fərq nədir?",
    "VOO ve QQQ arasinda esas ferq nedir?",
    "What is the main difference between VOO and QQQ?"
  ])("uses the same two-symbol relation for direct Studio dispatch: %s", (message) => {
    expect(v3DirectResearchComparisonSymbols(message)).toEqual(["VOO", "QQQ"]);
    expect(expectedV3DirectToolForQuery(message)).toBe("read-instrument-research");
    expect(deriveV3DirectToolPlan("read-instrument-research", message)).toEqual([
      { symbol: "VOO" },
      { symbol: "QQQ" }
    ]);
  });
});
