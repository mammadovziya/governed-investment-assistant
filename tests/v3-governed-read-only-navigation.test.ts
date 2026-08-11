import { describe, expect, it } from "vitest";

import type {
  AssistantCard,
  FactEnvelope,
  SupportedLocale,
  TrustedRequestContext
} from "../src/assistant-v3/contracts.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import {
  GOVERNED_READ_ONLY_NAVIGATION_CATALOG_VERSION,
  GovernedReadOnlyNavigationService,
  isGovernedReadOnlyNavigationPath
} from "../src/assistant-v3/governed-read-only-navigation.js";
import { routeV3Request } from "../src/assistant-v3/routing.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

function signer(): DevHmacSigner {
  return new DevHmacSigner({
    keyId: "test-read-only-navigation",
    secret: "test-read-only-navigation-secret-32-bytes-minimum"
  });
}

function context(
  locale: SupportedLocale = "en-US"
): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-read-only-navigation-1",
    sessionId: "session-read-only-navigation-1",
    conversationId: "conversation-read-only-navigation-1",
    principalRef: "principal:test",
    tenantRef: "tenant:test",
    locale,
    jurisdiction: "AZ",
    channel: "test",
    environment: "test",
    requestedAt: new Date(NOW).toISOString(),
    authentication: {
      strength: "authenticated",
      authContextRef: "auth:test"
    },
    consentVersion: "consent-v1",
    consentScopes: [
      "assistant_use",
      "portfolio_data",
      "public_market_data"
    ],
    entitlementVersion: "entitlement-v1",
    entitlements: [
      "assistant_access",
      "portfolio_read",
      "market_read"
    ],
    policyVersion: "3.0.0",
    capabilities: ["portfolio-read", "market-read"],
    featureSnapshot: {
      version: "feature-v1",
      flags: { readOnlyNavigation: true }
    }
  };
}

function evidenceFixture(input: {
  locale?: SupportedLocale;
  message: string;
  kind: string;
  subject: FactEnvelope<unknown>["subject"];
  cardKind: AssistantCard["kind"];
  alias?: string;
}) {
  const seal = signer();
  const trusted = context(input.locale);
  const evidence = new EvidenceFactory({ signer: seal, now: () => NOW });
  const args = input.subject.type === "instrument"
    ? { symbol: input.subject.ref }
    : {};
  const tool = evidence.toolSuccess({
    requestId: trusted.requestId,
    workflowRunId: "workflow-read-only-navigation-1",
    toolId: input.subject.type === "instrument"
      ? "read-market-snapshot"
      : input.kind === "portfolio.recent-trading-activity"
        ? "read-portfolio-activity"
        : "read-portfolio-snapshot",
    toolVersion: "3.0.0",
    arguments: args,
    result: { verified: true },
    source: {
      provider: "test",
      sourceId: "test-source",
      sourceUrl: null,
      licenseClass: "synthetic",
      observedAt: trusted.requestedAt,
      sourceAsOf: trusted.requestedAt
    }
  });
  const fact = evidence.fact({
    requestId: trusted.requestId,
    workflowRunId: tool.workflowRunId,
    kind: input.kind,
    subject: input.subject,
    asOf: trusted.requestedAt,
    value: input.kind === "portfolio.recent-trading-activity"
      ? { route: "recent_trading_activity" }
      : input.subject.type === "instrument"
        ? { symbol: input.subject.ref }
        : { cashValue: "100.00000000" },
    provenance: {
      toolExecutionIds: [tool.executionId],
      inputFactIds: [],
      calculation: null
    }
  });
  const card: AssistantCard = {
    cardId: `card-${fact.factId}`,
    kind: input.cardKind,
    title: "Verified details",
    factRefs: [fact.factId],
    data: fact.value
  };
  return {
    service: new GovernedReadOnlyNavigationService(),
    input: {
      context: trusted,
      route: routeV3Request(
        input.message,
        input.locale === undefined ? {} : { locale: input.locale }
      ),
      facts: [fact],
      cards: [card],
      tools: [{ envelope: tool, arguments: args }],
      factBindings: input.alias === undefined
        ? []
        : [{ alias: input.alias, factId: fact.factId }],
      signer: seal
    }
  };
}

describe("governed fact-bound read-only navigation", () => {
  it.each([
    {
      locale: "en-US" as const,
      message: "What is my current portfolio value?",
      kind: "portfolio.current-value",
      subject: { type: "portfolio" as const, ref: "portfolio:primary" },
      cardKind: "portfolio" as const,
      target: "investments.portfolio.overview",
      href: "/investments/portfolio",
      label: "View portfolio overview"
    },
    {
      locale: "az-AZ" as const,
      message: "Nağd balansım nə qədərdir?",
      kind: "portfolio.current-value",
      subject: { type: "portfolio" as const, ref: "portfolio:primary" },
      cardKind: "portfolio" as const,
      alias: "F1_CASH_VALUE",
      target: "investments.portfolio.cash",
      href: "/investments/portfolio/cash",
      label: "Nağd vəsait məlumatına bax"
    },
    {
      locale: "en-US" as const,
      message: "Show my recent trading activity",
      kind: "portfolio.recent-trading-activity",
      subject: { type: "portfolio" as const, ref: "portfolio:primary" },
      cardKind: "activity" as const,
      target: "investments.portfolio.activity",
      href: "/investments/activity",
      label: "View recent activity"
    },
    {
      locale: "az-AZ" as const,
      message: "AAPL səhminin cari qiyməti nədir?",
      kind: "market.quote",
      subject: { type: "instrument" as const, ref: "AAPL" },
      cardKind: "market" as const,
      target: "investments.instrument.overview",
      href: "/investments/instruments",
      label: "Alət icmalına bax"
    }
  ])("builds the exact catalog action for $target", (testCase) => {
    const { service, input } = evidenceFixture(testCase);
    const decision = service.evaluate(input);
    expect(decision).toMatchObject({
      status: "allowed",
      target: testCase.target,
      action: {
        schemaVersion: "assistant-v3.read-only-navigation-action.v1",
        target: testCase.target,
        href: testCase.href,
        label: testCase.label,
        catalogVersion: GOVERNED_READ_ONLY_NAVIGATION_CATALOG_VERSION
      }
    });
    if (decision.status === "allowed") {
      expect(decision.action.factRefs).toEqual([input.facts[0]?.factId]);
      expect(Object.isFrozen(decision.action)).toBe(true);
      expect(Object.isFrozen(decision.action.factRefs)).toBe(true);
    }
  });

  it("fails closed when the feature, signed ancestry, card, or cash binding is absent", () => {
    const { service, input } = evidenceFixture({
      locale: "en-US",
      message: "What is my cash balance?",
      kind: "portfolio.current-value",
      subject: { type: "portfolio", ref: "portfolio:primary" },
      cardKind: "portfolio"
    });
    expect(service.evaluate(input)).toMatchObject({
      status: "denied",
      reasonCodes: expect.arrayContaining(["FACT_BINDING_INVALID"])
    });
    expect(service.evaluate({
      ...input,
      context: {
        ...input.context,
        featureSnapshot: {
          ...input.context.featureSnapshot,
          flags: { readOnlyNavigation: false }
        }
      },
      cards: [],
      tools: [{ ...input.tools[0]!, arguments: { tampered: true } }]
    })).toMatchObject({
      status: "denied",
      reasonCodes: expect.arrayContaining([
        "FEATURE_DISABLED",
        "FACT_ANCESTRY_INVALID",
        "CARD_BINDING_INVALID",
        "FACT_BINDING_INVALID"
      ])
    });
  });

  it("does not authorize comparisons, wrong subjects, duplicate facts, or Studio", () => {
    const fixture = evidenceFixture({
      locale: "en-US",
      message: "What is the current AAPL price?",
      kind: "market.quote",
      subject: { type: "instrument", ref: "AAPL" },
      cardKind: "market"
    });
    expect(fixture.service.evaluate({
      ...fixture.input,
      route: routeV3Request("Compare AAPL and NVDA prices", { locale: "en-US" })
    })).toMatchObject({
      status: "denied",
      reasonCodes: ["ROUTE_NOT_ELIGIBLE"]
    });
    expect(fixture.service.evaluate({
      ...fixture.input,
      facts: [fixture.input.facts[0]!, fixture.input.facts[0]!]
    })).toMatchObject({
      status: "denied",
      reasonCodes: expect.arrayContaining(["FACT_COUNT_INVALID"])
    });
    expect(fixture.service.evaluate({
      ...fixture.input,
      context: { ...fixture.input.context, channel: "mastra-studio" }
    })).toMatchObject({
      status: "denied",
      reasonCodes: expect.arrayContaining(["CHANNEL_DENIED"])
    });
  });

  it.each([
    "https://example.com/investments/portfolio",
    "//example.com/investments/portfolio",
    "/investments/portfolio/",
    "/investments/portfolio?account=1",
    "/investments/portfolio#cash",
    "/investments/%70ortfolio",
    "/investments/../portfolio",
    "/investments/portfolio\\cash",
    " /investments/portfolio",
    "/investments/portfolio\n"
  ])("rejects the unreviewed route %j", (candidate) => {
    expect(isGovernedReadOnlyNavigationPath(candidate)).toBe(false);
  });
});
