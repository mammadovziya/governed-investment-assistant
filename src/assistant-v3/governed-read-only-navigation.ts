import type {
  AssistantCard,
  AssistantReadOnlyViewAction,
  FactEnvelope,
  SupportedLocale,
  ToolExecutionEnvelope,
  TrustedRequestContext
} from "./contracts.js";
import { EvidenceFactory } from "./evidence.js";
import type { V3RouteDecision } from "./routing.js";
import {
  canonicalHash,
  type DevHmacSigner
} from "./signing.js";

export const GOVERNED_READ_ONLY_NAVIGATION_CATALOG_VERSION =
  "governed-investment-read-only-navigation-2026-07-29.v1" as const;

export const GOVERNED_READ_ONLY_NAVIGATION_TARGETS = Object.freeze([
  "investments.portfolio.overview",
  "investments.portfolio.cash",
  "investments.portfolio.activity",
  "investments.instrument.overview"
] as const);

export type GovernedReadOnlyNavigationTarget =
  (typeof GOVERNED_READ_ONLY_NAVIGATION_TARGETS)[number];

export const GOVERNED_READ_ONLY_NAVIGATION_PATHS = Object.freeze([
  "/investments/portfolio",
  "/investments/portfolio/cash",
  "/investments/activity",
  "/investments/instruments"
] as const);

export type GovernedReadOnlyNavigationPath =
  (typeof GOVERNED_READ_ONLY_NAVIGATION_PATHS)[number];

export interface ReadOnlyNavigationToolEvidence {
  readonly envelope: ToolExecutionEnvelope<unknown>;
  readonly arguments: unknown;
}

export interface ReadOnlyNavigationFactBinding {
  readonly alias: string;
  readonly factId: string;
}

export type GovernedReadOnlyNavigationDenialCode =
  | "ROUTE_NOT_ELIGIBLE"
  | "INVALID_TRUSTED_CONTEXT"
  | "CHANNEL_DENIED"
  | "FEATURE_DISABLED"
  | "CONSENT_DENIED"
  | "ENTITLEMENT_DENIED"
  | "CAPABILITY_DENIED"
  | "FACT_COUNT_INVALID"
  | "FACT_SCOPE_INVALID"
  | "FACT_QUALITY_INVALID"
  | "FACT_ANCESTRY_INVALID"
  | "FACT_BINDING_INVALID"
  | "CARD_BINDING_INVALID"
  | "ROUTE_NOT_ALLOWLISTED";

export type GovernedReadOnlyNavigationDecision =
  | Readonly<{
      status: "allowed";
      target: GovernedReadOnlyNavigationTarget;
      action: AssistantReadOnlyViewAction;
      reasonCodes: readonly [];
    }>
  | Readonly<{
      status: "denied";
      target: GovernedReadOnlyNavigationTarget | null;
      action: null;
      reasonCodes: readonly GovernedReadOnlyNavigationDenialCode[];
    }>;

interface CatalogEntry {
  readonly target: GovernedReadOnlyNavigationTarget;
  readonly actionId: AssistantReadOnlyViewAction["actionId"];
  readonly path: GovernedReadOnlyNavigationPath;
  readonly labels: Readonly<Record<SupportedLocale, string>>;
  readonly factKind: string;
  readonly cardKind: AssistantCard["kind"];
  readonly access: "portfolio" | "market";
}

const CATALOG: Readonly<Record<GovernedReadOnlyNavigationTarget, CatalogEntry>> =
  Object.freeze({
    "investments.portfolio.overview": Object.freeze({
      target: "investments.portfolio.overview",
      actionId: "view-portfolio-overview",
      path: "/investments/portfolio",
      labels: Object.freeze({
        "en-US": "View portfolio overview",
        "az-AZ": "Portfel icmalına bax"
      }),
      factKind: "portfolio.current-value",
      cardKind: "portfolio",
      access: "portfolio"
    }),
    "investments.portfolio.cash": Object.freeze({
      target: "investments.portfolio.cash",
      actionId: "view-portfolio-cash",
      path: "/investments/portfolio/cash",
      labels: Object.freeze({
        "en-US": "View cash details",
        "az-AZ": "Nağd vəsait məlumatına bax"
      }),
      factKind: "portfolio.current-value",
      cardKind: "portfolio",
      access: "portfolio"
    }),
    "investments.portfolio.activity": Object.freeze({
      target: "investments.portfolio.activity",
      actionId: "view-recent-activity",
      path: "/investments/activity",
      labels: Object.freeze({
        "en-US": "View recent activity",
        "az-AZ": "Son əməliyyatlara bax"
      }),
      factKind: "portfolio.recent-trading-activity",
      cardKind: "activity",
      access: "portfolio"
    }),
    "investments.instrument.overview": Object.freeze({
      target: "investments.instrument.overview",
      actionId: "view-instrument-overview",
      path: "/investments/instruments",
      labels: Object.freeze({
        "en-US": "View instrument overview",
        "az-AZ": "Alət icmalına bax"
      }),
      factKind: "market.quote",
      cardKind: "market",
      access: "market"
    })
  });

function denied(
  target: GovernedReadOnlyNavigationTarget | null,
  reasonCodes: readonly GovernedReadOnlyNavigationDenialCode[]
): GovernedReadOnlyNavigationDecision {
  return Object.freeze({
    status: "denied",
    target,
    action: null,
    reasonCodes: Object.freeze([...new Set(reasonCodes)])
  });
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function boundedString(value: unknown, maxLength = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function trustedContextValid(context: TrustedRequestContext): boolean {
  return context !== null &&
    typeof context === "object" &&
    context.schemaVersion === "assistant-v3.request-context.v1" &&
    boundedString(context.requestId) &&
    boundedString(context.sessionId) &&
    boundedString(context.conversationId) &&
    boundedString(context.principalRef) &&
    boundedString(context.tenantRef) &&
    (context.locale === "en-US" || context.locale === "az-AZ") &&
    context.jurisdiction === "AZ" &&
    canonicalTimestamp(context.requestedAt) &&
    (context.authentication?.strength === "authenticated" ||
      context.authentication?.strength === "step_up") &&
    Array.isArray(context.consentScopes) &&
    Array.isArray(context.entitlements) &&
    Array.isArray(context.capabilities) &&
    context.featureSnapshot !== null &&
    typeof context.featureSnapshot === "object" &&
    context.featureSnapshot.flags !== null &&
    typeof context.featureSnapshot.flags === "object";
}

function targetForRoute(
  route: V3RouteDecision
): GovernedReadOnlyNavigationTarget | null {
  if (!route.readOnly) return null;
  if (route.route === "current_portfolio_value") {
    return route.reasonCodes.includes("cash_balance_marker")
      ? "investments.portfolio.cash"
      : "investments.portfolio.overview";
  }
  if (route.route === "recent_trading_activity") {
    return "investments.portfolio.activity";
  }
  if (route.route === "market_quote" && route.symbols.length === 1) {
    return "investments.instrument.overview";
  }
  return null;
}

export function isGovernedReadOnlyNavigationRoute(
  route: V3RouteDecision
): boolean {
  return targetForRoute(route) !== null;
}

export function isGovernedReadOnlyNavigationPath(
  value: unknown
): value is GovernedReadOnlyNavigationPath {
  return typeof value === "string" &&
    value.length <= 64 &&
    !value.startsWith("//") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !value.includes("%") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    (GOVERNED_READ_ONLY_NAVIGATION_PATHS as readonly string[]).includes(value);
}

function factMatchesEntry(input: {
  fact: FactEnvelope<unknown>;
  entry: CatalogEntry;
  route: V3RouteDecision;
  context: TrustedRequestContext;
}): boolean {
  const { fact, entry, route, context } = input;
  if (
    fact.kind !== entry.factKind ||
    fact.requestId !== context.requestId ||
    fact.quality.status !== "complete" ||
    fact.quality.coverage !== "1.00000000" ||
    fact.provenance.toolExecutionIds.length === 0
  ) {
    return false;
  }
  if (entry.access === "portfolio") {
    return fact.subject.type === "portfolio" &&
      fact.subject.ref === "portfolio:primary";
  }
  const symbol = route.symbols[0];
  return symbol !== undefined &&
    fact.subject.type === "instrument" &&
    fact.subject.ref === symbol;
}

function accessProblems(
  context: TrustedRequestContext,
  access: CatalogEntry["access"]
): GovernedReadOnlyNavigationDenialCode[] {
  const problems: GovernedReadOnlyNavigationDenialCode[] = [];
  if (
    context.channel !== "web" &&
    context.channel !== "mobile" &&
    !(context.channel === "test" && context.environment === "test")
  ) {
    problems.push("CHANNEL_DENIED");
  }
  const consent = access === "portfolio" ? "portfolio_data" : "public_market_data";
  const entitlement = access === "portfolio" ? "portfolio_read" : "market_read";
  const capability = access === "portfolio" ? "portfolio-read" : "market-read";
  if (
    !context.consentScopes.includes("assistant_use") ||
    !context.consentScopes.includes(consent)
  ) {
    problems.push("CONSENT_DENIED");
  }
  if (
    !context.entitlements.includes("assistant_access") ||
    !context.entitlements.includes(entitlement)
  ) {
    problems.push("ENTITLEMENT_DENIED");
  }
  if (!context.capabilities.includes(capability)) {
    problems.push("CAPABILITY_DENIED");
  }
  return problems;
}

/**
 * Produces one local GET-only navigation action from a finalized deterministic
 * route and its signed response evidence. The caller never supplies a target,
 * action ID, label, route, or URL.
 */
export class GovernedReadOnlyNavigationService {
  evaluate(input: Readonly<{
    context: TrustedRequestContext;
    route: V3RouteDecision;
    facts: readonly FactEnvelope<unknown>[];
    cards: readonly AssistantCard[];
    tools: readonly ReadOnlyNavigationToolEvidence[];
    factBindings: readonly ReadOnlyNavigationFactBinding[];
    signer: DevHmacSigner;
  }>): GovernedReadOnlyNavigationDecision {
    const target = targetForRoute(input.route);
    if (target === null) return denied(null, ["ROUTE_NOT_ELIGIBLE"]);
    if (!trustedContextValid(input.context)) {
      return denied(target, ["INVALID_TRUSTED_CONTEXT"]);
    }
    const entry = CATALOG[target];
    const reasons: GovernedReadOnlyNavigationDenialCode[] = [];
    if (input.context.featureSnapshot.flags.readOnlyNavigation !== true) {
      reasons.push("FEATURE_DISABLED");
    }
    reasons.push(...accessProblems(input.context, entry.access));
    if (!isGovernedReadOnlyNavigationPath(entry.path)) {
      reasons.push("ROUTE_NOT_ALLOWLISTED");
    }

    const candidates = input.facts.filter((fact) =>
      factMatchesEntry({
        fact,
        entry,
        route: input.route,
        context: input.context
      })
    );
    if (candidates.length !== 1) reasons.push("FACT_COUNT_INVALID");
    const fact = candidates[0];
    if (fact !== undefined) {
      if (
        fact.requestId !== input.context.requestId ||
        (entry.access === "market" &&
          (input.route.symbols.length !== 1 ||
            fact.subject.ref !== input.route.symbols[0]))
      ) {
        reasons.push("FACT_SCOPE_INVALID");
      }
      if (fact.quality.status !== "complete" || fact.quality.coverage !== "1.00000000") {
        reasons.push("FACT_QUALITY_INVALID");
      }
      const toolRecords = input.tools.filter(({ envelope }) =>
        fact.provenance.toolExecutionIds.includes(envelope.executionId)
      );
      if (
        toolRecords.length !== fact.provenance.toolExecutionIds.length ||
        toolRecords.some(({ envelope, arguments: args }) =>
          envelope.requestId !== fact.requestId ||
          envelope.workflowRunId !== fact.workflowRunId ||
          envelope.argumentsHash !== canonicalHash(args)
        ) ||
        !new EvidenceFactory({ signer: input.signer }).verifyFact(
          fact,
          input.tools.map(({ envelope }) => envelope),
          input.facts
        )
      ) {
        reasons.push("FACT_ANCESTRY_INVALID");
      }
      const cards = input.cards.filter((card) =>
        card.kind === entry.cardKind &&
        card.factRefs.length === 1 &&
        card.factRefs[0] === fact.factId
      );
      if (cards.length !== 1) reasons.push("CARD_BINDING_INVALID");
      if (target === "investments.portfolio.cash") {
        const cashBindings = input.factBindings.filter((binding) =>
          binding.alias === "F1_CASH_VALUE" &&
          binding.factId === fact.factId
        );
        if (cashBindings.length !== 1) reasons.push("FACT_BINDING_INVALID");
      }
    }

    if (reasons.length > 0 || fact === undefined) return denied(target, reasons);

    const action: AssistantReadOnlyViewAction = Object.freeze({
      schemaVersion: "assistant-v3.read-only-navigation-action.v1",
      actionId: entry.actionId,
      kind: "open-read-only-view",
      target,
      label: entry.labels[input.context.locale],
      href: entry.path,
      factRefs: Object.freeze([fact.factId] as const),
      catalogVersion: GOVERNED_READ_ONLY_NAVIGATION_CATALOG_VERSION
    });
    return Object.freeze({
      status: "allowed",
      target,
      action,
      reasonCodes: Object.freeze([] as const)
    });
  }
}
