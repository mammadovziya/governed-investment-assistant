import { randomUUID } from "node:crypto";

import type {
  V3BoundaryExecutionContext,
  V3PrivateStudioExecutionDenial,
  V3PrivateStudioExecutionBrokerPort
} from "./boundary-tools.js";
import type { TrustedRequestContext } from "./contracts.js";
import type { V3ToolGrantAuthority } from "./grants.js";
import {
  evaluateV3Policy,
  type V3ApprovedBoundaryToolId
} from "./policy.js";
import {
  routeKnownV3Capability,
  detectV3Locale,
  type V3Function
} from "./routing.js";
import { V3SessionAuthority } from "./sessions.js";
import {
  financialEducationRouteReason,
  normalizeFinancialEducationQuery,
} from "./financial-education-query.js";

const STUDIO_TENANT = "tenant:investment-assistant-studio" as const;
const STUDIO_PRINCIPAL = "principal:synthetic-studio-client" as const;
const STUDIO_FEATURE_VERSION = "private-studio-synthetic-v1" as const;

export class V3PrivateStudioExecutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "V3PrivateStudioExecutionError";
  }
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new V3PrivateStudioExecutionError(
      "invalid_studio_tool_arguments",
      "Private Studio tool arguments must be a plain object."
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function studioSymbol(args: unknown): string {
  const symbol = plainRecord(args).symbol;
  if (typeof symbol !== "string" || !/^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(symbol)) {
    throw new V3PrivateStudioExecutionError(
      "invalid_studio_symbol",
      "Private Studio requires one canonical uppercase public ticker."
    );
  }
  return symbol;
}

function studioEducationQuery(args: unknown): string {
  const record = plainRecord(args);
  const normalized = typeof record.query === "string"
    ? normalizeFinancialEducationQuery(record.query)
    : null;
  if (
    normalized === null ||
    record.query !== normalized ||
    Object.keys(record).length !== 1
  ) {
    throw new V3PrivateStudioExecutionError(
      "invalid_studio_education_query",
      "Private Studio reviewed education requires one normalized query."
    );
  }
  return normalized;
}

function routeForTool(
  toolId: V3ApprovedBoundaryToolId,
  args: unknown
): V3Function {
  switch (toolId) {
    case "resolve-instrument":
    case "read-market-snapshot":
    case "read-price-history":
      return "market_quote";
    case "read-instrument-research":
      return "company_research";
    case "read-market-content":
      return "news_sentiment";
    case "convert-currency":
      return plainRecord(args).scope === "current-market-price"
        ? "market_quote"
        : "current_portfolio_value";
    case "read-portfolio-snapshot":
      return "current_portfolio_value";
    case "analyze-portfolio-allocation": {
      const scope = plainRecord(args).scope;
      if (scope === "current") return "portfolio_allocation_analysis";
      if (scope === "hypothetical") return "hypothetical_portfolio_analysis";
      throw new V3PrivateStudioExecutionError(
        "invalid_studio_allocation_scope",
        "Private Studio portfolio-allocation analysis requires a reviewed scope."
      );
    }
    case "read-portfolio-activity":
      return "ytd_gain_loss_twr";
    case "retrieve-reviewed-investment-education":
      return "education";
    case "retrieve-approved-product-knowledge":
      return "approved_knowledge";
    case "read-order-eligibility":
    case "create-signed-order-handoff":
      return "order_ticket_preview";
  }
}

function routeSymbols(
  toolId: V3ApprovedBoundaryToolId,
  args: unknown
): readonly string[] {
  const symbolBoundTool = [
    "resolve-instrument",
    "read-market-snapshot",
    "read-price-history",
    "read-instrument-research",
    "read-market-content",
    "read-order-eligibility"
  ].includes(toolId) ||
    (
      toolId === "convert-currency" &&
      plainRecord(args).scope === "current-market-price"
    );
  return symbolBoundTool
    ? Object.freeze([studioSymbol(args)])
    : Object.freeze([]);
}

function trustedContext(input: {
  requestId: string;
  policyVersion: string;
  sessionId: string;
  authContextId: string;
  consentVersion: string;
  consentScopes: readonly string[];
  entitlementVersion: string;
  entitlements: readonly string[];
  requestedAt: string;
  locale?: "en-US" | "az-AZ";
}): TrustedRequestContext {
  return Object.freeze({
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: input.requestId,
    sessionId: input.sessionId,
    conversationId: randomUUID(),
    principalRef: STUDIO_PRINCIPAL,
    tenantRef: STUDIO_TENANT,
    locale: input.locale ?? "en-US",
    jurisdiction: "AZ",
    channel: "mastra-studio",
    environment: "test",
    requestedAt: input.requestedAt,
    authentication: Object.freeze({
      strength: "authenticated" as const,
      authContextRef: input.authContextId
    }),
    consentVersion: input.consentVersion,
    consentScopes: Object.freeze([...input.consentScopes]),
    entitlementVersion: input.entitlementVersion,
    entitlements: Object.freeze([...input.entitlements]),
    policyVersion: input.policyVersion,
    capabilities: Object.freeze([
      "portfolio-read",
      "market-read",
      "approved-knowledge-read",
      "order-preview"
    ]),
    featureSnapshot: Object.freeze({
      version: STUDIO_FEATURE_VERSION,
      flags: Object.freeze({
        customerData: false,
        liveDevelopmentMarketData: true,
        syntheticPortfolio: true,
        orderExecution: false
      })
    })
  });
}

/**
 * Issues short-lived grants solely for the loopback Studio component harness.
 * `x-mastra-client-type: studio` selects this profile but is not authentication;
 * safety comes from loopback binding plus public/synthetic read-only adapters.
 * Identity, tenant, policy, locale, account, URL, and grant material never come
 * from the playground request.
 */
export class V3PrivateStudioExecutionBroker
implements V3PrivateStudioExecutionBrokerPort {
  readonly #grantAuthority: V3ToolGrantAuthority;
  readonly #sessionAuthority: V3SessionAuthority;
  readonly #now: () => number;
  readonly #trustedContexts = new WeakSet<object>();
  readonly #trustedDenials = new WeakSet<object>();

  constructor(input: {
    grantAuthority: V3ToolGrantAuthority;
    now?: () => number;
  }) {
    this.#grantAuthority = input.grantAuthority;
    this.#now = input.now ?? Date.now;
    this.#sessionAuthority = new V3SessionAuthority({
      secret: "assistant-v3-private-studio-session-secret-only",
      issuer: "governed-investment-assistant-v3-private-studio",
      defaultTtlMs: 60_000,
      now: this.#now
    });
  }

  issue(input: {
    toolId: V3ApprovedBoundaryToolId;
    args: unknown;
  }): V3BoundaryExecutionContext | V3PrivateStudioExecutionDenial {
    const requestId = randomUUID();
    const workflowRunId = randomUUID();
    if (input.toolId === "create-signed-order-handoff") {
      const denial = Object.freeze({
        denied: true as const,
        requestId,
        workflowRunId,
        toolId: input.toolId,
        code: "STUDIO_ORDER_HANDOFF_DISABLED",
        message: "Signed order handoff is disabled in the Studio tool playground; use the application preview and explicit confirmation flow.",
        requestedAt: new Date(this.#now()).toISOString()
      });
      this.#trustedDenials.add(denial);
      return denial;
    }
    const issued = this.#sessionAuthority.issue({
      tenantId: STUDIO_TENANT,
      principalId: STUDIO_PRINCIPAL,
      authContextId: `studio:${randomUUID()}`,
      consentVersion: "private-studio-synthetic-consent-v1",
      consents: [
        "assistant_use",
        "portfolio_data",
        "public_market_data",
        "approved_knowledge"
      ],
      entitlementVersion: "private-studio-synthetic-entitlements-v1",
      entitlements: [
        "assistant_access",
        "portfolio_read",
        "market_read",
        "research_read",
        "knowledge_read",
        "order_preview"
      ]
    });
    const educationQuery = input.toolId ===
      "retrieve-reviewed-investment-education"
      ? studioEducationQuery(input.args)
      : null;
    const educationLocale = educationQuery === null
      ? "en-US"
      : detectV3Locale(educationQuery);
    const educationReason = educationQuery === null
      ? null
      : financialEducationRouteReason(educationQuery);
    if (educationQuery !== null && educationReason === null) {
      throw new V3PrivateStudioExecutionError(
        "invalid_studio_education_query",
        "Private Studio reviewed education query could not be bound."
      );
    }
    const route = routeKnownV3Capability({
      route: routeForTool(input.toolId, input.args),
      locale: educationLocale,
      symbols: routeSymbols(input.toolId, input.args),
      reasonCode: input.toolId === "retrieve-reviewed-investment-education"
        ? educationReason!
        : `private-studio-tool:${input.toolId}`
    });
    const previewPolicy = evaluateV3Policy({
      route,
      session: issued.session,
      now: this.#now()
    });
    const policy = previewPolicy;
    const context = trustedContext({
      requestId,
      policyVersion: policy.policyVersion,
      sessionId: issued.session.claims.sessionId,
      authContextId: issued.session.claims.authContextId,
      consentVersion: issued.session.claims.consentVersion,
      consentScopes: issued.session.claims.consents,
      entitlementVersion: issued.session.claims.entitlementVersion,
      entitlements: issued.session.claims.entitlements,
      requestedAt: new Date(this.#now()).toISOString(),
      locale: educationLocale
    });
    const grant = this.#grantAuthority.issue({
      requestId,
      workflowRunId,
      route,
      policy,
      session: issued.session,
      toolId: input.toolId,
      args: input.args,
      ttlMs: 10_000
    });
    const execution = Object.freeze({
      grantToken: grant.token,
      requestId,
      workflowRunId,
      policy,
      session: issued.session,
      trustedContext: context
    });
    this.#trustedContexts.add(execution);
    return execution;
  }

  isTrusted(context: V3BoundaryExecutionContext): boolean {
    return this.#trustedContexts.has(context) &&
      context.trustedContext.channel === "mastra-studio" &&
      context.trustedContext.environment === "test" &&
      context.trustedContext.tenantRef === STUDIO_TENANT &&
      context.trustedContext.principalRef === STUDIO_PRINCIPAL &&
      context.trustedContext.featureSnapshot.version === STUDIO_FEATURE_VERSION;
  }

  isDenied(value: unknown): value is V3PrivateStudioExecutionDenial {
    return typeof value === "object" && value !== null &&
      this.#trustedDenials.has(value);
  }
}

export const V3_PRIVATE_STUDIO_SYNTHETIC_SCOPE = Object.freeze({
  tenantRef: STUDIO_TENANT,
  principalRef: STUDIO_PRINCIPAL,
  featureVersion: STUDIO_FEATURE_VERSION
});
