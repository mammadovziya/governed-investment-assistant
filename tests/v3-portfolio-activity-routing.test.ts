import { describe, expect, it } from "vitest";

import { evaluateV3Policy } from "../src/assistant-v3/policy.js";
import { requiredV3ToolSet } from "../src/assistant-v3/response-scorers.js";
import { portfolioActivityToolArguments } from "../src/assistant-v3/portfolio-activity.js";
import { routeV3Request } from "../src/assistant-v3/routing.js";
import { V3SessionAuthority } from "../src/assistant-v3/sessions.js";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

function portfolioSession() {
  return new V3SessionAuthority({
    secret: "portfolio-activity-routing-test-secret-at-least-32-bytes",
    now: () => NOW
  }).issue({
    tenantId: "tenant:demo-invest",
    principalId: "principal:mock-client-001",
    authContextId: "auth:activity-test",
    consentVersion: "consent-v3",
    consents: ["assistant_use", "portfolio_data"],
    entitlementVersion: "entitlements-v3",
    entitlements: ["assistant_access", "portfolio_read"]
  }).session;
}

describe("V3 portfolio activity routing and policy", () => {
  it.each([
    ["Show my 10 latest trades and orders", "recent_trading_activity", "en-US"],
    ["Son 10 ticarət əməliyyatımı göstər", "recent_trading_activity", "az-AZ"],
    ["Show my purchase history", "purchase_history", "en-US"],
    ["AAPL alış tarixçəmi göstər", "purchase_history", "az-AZ"]
  ] as const)("routes %s to the private portfolio workflow", (message, route, locale) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "capability",
      route,
      locale,
      requiresPortfolio: true,
      requiresMarketData: false,
      requiresKnowledge: false,
      readOnly: true
    });
  });

  it("does not weaken the executable order boundary", () => {
    expect(routeV3Request("Buy 2 AAPL shares now")).toMatchObject({
      kind: "boundary",
      boundary: "order_execution",
      route: null
    });
    expect(routeV3Request("Can you buy AAPL and show my recent orders?")).toMatchObject({
      kind: "boundary",
      boundary: "order_execution",
      route: null
    });
    expect(routeV3Request(
      "AAPL səhmini ala bilərsən və son sifarişlərimi göstərə bilərsən?"
    )).toMatchObject({
      kind: "boundary",
      boundary: "order_execution",
      route: null,
      locale: "az-AZ"
    });
  });

  it.each([
    ["Show my recent activity for NVDA and AAPL", "en-US"],
    ["NVDA və AAPL üzrə son əməliyyatlarımı göstər", "az-AZ"]
  ] as const)("clarifies multi-symbol activity instead of broadening %s", (message, locale) => {
    expect(routeV3Request(message)).toMatchObject({
      kind: "clarify",
      route: null,
      locale,
      symbols: ["NVDA", "AAPL"],
      reasonCodes: ["activity_single_instrument_required"],
      requiresPortfolio: false
    });
  });

  it("rejects a multi-symbol activity scope at the argument builder boundary", () => {
    expect(() => portfolioActivityToolArguments({
      route: "recent_trading_activity",
      symbols: ["NVDA", "AAPL"]
    })).toThrow("at most one instrument scope");
  });

  it.each([
    "Show my 10 latest trades and orders",
    "Show my purchase history"
  ])("authorizes exactly the activity boundary for %s", (message) => {
    const route = routeV3Request(message);
    const policy = evaluateV3Policy({ route, session: portfolioSession(), now: NOW });
    expect(policy).toMatchObject({
      authorized: true,
      capabilities: ["portfolio:read"],
      allowedToolIds: ["read-portfolio-activity"]
    });
    expect(requiredV3ToolSet(route)).toEqual(["read-portfolio-activity"]);
  });
});
