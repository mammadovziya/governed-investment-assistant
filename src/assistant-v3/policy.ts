import { createHash, randomUUID } from "node:crypto";

import type { V3Function, V3RouteDecision } from "./routing.js";
import {
  isV3SessionCurrent,
  isV3TrustedSession,
  v3PrincipalFingerprint,
  type V3ConsentScope,
  type V3Entitlement,
  type V3TrustedSession,
} from "./sessions.js";

export type V3PolicyAction = "allow" | "deny" | "redirect" | "escalate";
export type V3Capability =
  | "portfolio:read"
  | "market:read"
  | "research:read"
  | "knowledge:read"
  | "order:preview";

export const V3_APPROVED_BOUNDARY_TOOL_IDS = [
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
] as const;

export type V3ApprovedBoundaryToolId =
  (typeof V3_APPROVED_BOUNDARY_TOOL_IDS)[number];

export interface V3PolicyDecision {
  readonly decisionId: string;
  readonly policyId: "investment-assistant-v3";
  readonly policyVersion: "3.0.0";
  readonly action: V3PolicyAction;
  readonly authorized: boolean;
  readonly route: V3Function | null;
  readonly routeKind: V3RouteDecision["kind"];
  readonly boundary: V3RouteDecision["boundary"];
  readonly routeFingerprint: string;
  readonly sessionId: string | null;
  readonly tenantId: string | null;
  readonly principalFingerprint: string | null;
  readonly capabilities: readonly V3Capability[];
  readonly requiredConsents: readonly V3ConsentScope[];
  readonly requiredEntitlements: readonly V3Entitlement[];
  readonly allowedToolIds: readonly V3ApprovedBoundaryToolId[];
  readonly reasonCodes: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface V3EvaluatePolicyInput {
  readonly route: V3RouteDecision;
  readonly session: unknown;
  readonly now?: number;
  readonly decisionTtlMs?: number;
}

export class V3PolicyError extends Error {
  readonly code: string;
  readonly reasonCodes: readonly string[];

  constructor(code: string, message: string, reasonCodes: readonly string[] = [code]) {
    super(message);
    this.name = "V3PolicyError";
    this.code = code;
    this.reasonCodes = Object.freeze([...reasonCodes]);
  }
}

interface RoutePolicy {
  readonly capabilities: readonly V3Capability[];
  readonly consents: readonly V3ConsentScope[];
  readonly entitlements: readonly V3Entitlement[];
  readonly tools: readonly V3ApprovedBoundaryToolId[];
}

const POLICY_ID = "investment-assistant-v3" as const;
const POLICY_VERSION = "3.0.0" as const;
const MAX_DECISION_TTL_MS = 60_000;
const trustedDecisions = new WeakSet<object>();

const ROUTE_POLICIES: Readonly<Record<V3Function, RoutePolicy>> = {
  recent_trading_activity: {
    capabilities: ["portfolio:read"],
    consents: ["assistant_use", "portfolio_data"],
    entitlements: ["assistant_access", "portfolio_read"],
    tools: ["read-portfolio-activity"],
  },
  purchase_history: {
    capabilities: ["portfolio:read"],
    consents: ["assistant_use", "portfolio_data"],
    entitlements: ["assistant_access", "portfolio_read"],
    tools: ["read-portfolio-activity"],
  },
  current_portfolio_value: {
    capabilities: ["portfolio:read", "market:read"],
    consents: ["assistant_use", "portfolio_data", "public_market_data"],
    entitlements: ["assistant_access", "portfolio_read", "market_read"],
    tools: [
      "read-portfolio-snapshot",
      "read-market-snapshot",
      "convert-currency"
    ],
  },
  largest_holding: {
    capabilities: ["portfolio:read", "market:read"],
    consents: ["assistant_use", "portfolio_data", "public_market_data"],
    entitlements: ["assistant_access", "portfolio_read", "market_read"],
    tools: ["read-portfolio-snapshot", "read-market-snapshot"],
  },
  ytd_gain_loss_twr: {
    capabilities: ["portfolio:read", "market:read"],
    consents: ["assistant_use", "portfolio_data", "public_market_data"],
    entitlements: ["assistant_access", "portfolio_read", "market_read"],
    tools: [
      "read-portfolio-snapshot",
      "read-portfolio-activity",
      "read-market-snapshot",
      "read-price-history",
    ],
  },
  holding_average_cost: {
    capabilities: ["portfolio:read"],
    consents: ["assistant_use", "portfolio_data"],
    entitlements: ["assistant_access", "portfolio_read"],
    tools: ["read-portfolio-snapshot", "read-portfolio-activity"],
  },
  sector_allocation: {
    capabilities: ["portfolio:read", "market:read"],
    consents: ["assistant_use", "portfolio_data", "public_market_data"],
    entitlements: ["assistant_access", "portfolio_read", "market_read"],
    tools: ["read-portfolio-snapshot", "read-market-snapshot"],
  },
  one_month_mover_contribution: {
    capabilities: ["portfolio:read", "market:read"],
    consents: ["assistant_use", "portfolio_data", "public_market_data"],
    entitlements: ["assistant_access", "portfolio_read", "market_read"],
    tools: [
      "read-portfolio-snapshot",
      "read-portfolio-activity",
      "read-price-history",
    ],
  },
  etf_explanation_risk: {
    capabilities: ["market:read", "research:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read", "research_read"],
    tools: [
      "resolve-instrument",
      "read-market-snapshot",
      "read-instrument-research",
      "read-price-history",
    ],
  },
  fees_tariff: {
    capabilities: ["knowledge:read"],
    consents: ["assistant_use", "approved_knowledge"],
    entitlements: ["assistant_access", "knowledge_read"],
    tools: ["retrieve-approved-product-knowledge"],
  },
  order_ticket_preview: {
    capabilities: ["order:preview", "market:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "order_preview", "market_read"],
    tools: ["resolve-instrument", "read-market-snapshot", "read-order-eligibility"],
  },
  market_quote: {
    capabilities: ["market:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read"],
    tools: [
      "resolve-instrument",
      "read-market-snapshot",
      "convert-currency",
      "read-price-history"
    ],
  },
  market_history: {
    capabilities: ["market:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read"],
    tools: ["resolve-instrument", "read-price-history"],
  },
  market_event: {
    capabilities: ["market:read", "research:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read", "research_read"],
    tools: ["resolve-instrument", "read-market-content"],
  },
  company_research: {
    capabilities: ["market:read", "research:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read", "research_read"],
    tools: [
      "resolve-instrument",
      "read-market-snapshot",
      "read-instrument-research",
      "read-price-history",
    ],
  },
  technical_analysis: {
    capabilities: ["market:read", "research:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read", "research_read"],
    tools: ["resolve-instrument", "read-price-history"],
  },
  news_sentiment: {
    capabilities: ["market:read", "research:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read", "research_read"],
    tools: ["resolve-instrument", "read-market-content"],
  },
  market_move_explanation: {
    capabilities: ["market:read", "research:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read", "research_read"],
    tools: [
      "resolve-instrument",
      "read-market-snapshot",
      "read-price-history",
      "read-market-content",
    ],
  },
  security_risk: {
    capabilities: ["market:read", "research:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read", "research_read"],
    tools: ["resolve-instrument", "read-price-history", "read-instrument-research"],
  },
  security_decision_support: {
    capabilities: ["portfolio:read", "market:read", "research:read"],
    consents: ["assistant_use", "portfolio_data", "public_market_data"],
    entitlements: ["assistant_access", "portfolio_read", "market_read", "research_read"],
    tools: [
      "read-portfolio-snapshot",
      "resolve-instrument",
      "read-market-snapshot",
      "read-instrument-research",
      "read-market-content",
    ],
  },
  portfolio_allocation_analysis: {
    capabilities: ["portfolio:read", "market:read"],
    consents: ["assistant_use", "portfolio_data", "public_market_data"],
    entitlements: ["assistant_access", "portfolio_read", "market_read"],
    tools: ["analyze-portfolio-allocation"],
  },
  hypothetical_portfolio_analysis: {
    capabilities: [],
    consents: ["assistant_use"],
    entitlements: ["assistant_access"],
    tools: ["analyze-portfolio-allocation"],
  },
  hypothetical_position_analysis: {
    capabilities: ["market:read"],
    consents: ["assistant_use", "public_market_data"],
    entitlements: ["assistant_access", "market_read"],
    tools: ["resolve-instrument", "read-market-snapshot"],
  },
  approved_knowledge: {
    capabilities: ["knowledge:read"],
    consents: ["assistant_use", "approved_knowledge"],
    entitlements: ["assistant_access", "knowledge_read"],
    tools: ["retrieve-approved-product-knowledge"],
  },
  education: {
    capabilities: ["knowledge:read"],
    consents: ["assistant_use", "approved_knowledge"],
    entitlements: ["assistant_access", "knowledge_read"],
    tools: ["retrieve-reviewed-investment-education"],
  },
  conversation: {
    capabilities: [],
    consents: ["assistant_use"],
    entitlements: ["assistant_access"],
    tools: [],
  },
};

export function fingerprintV3Route(route: V3RouteDecision): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: route.kind,
        route: route.route,
        researchFacet: route.researchFacet,
        boundary: route.boundary,
        locale: route.locale,
        symbols: [...route.symbols],
        reasonCodes: [...route.reasonCodes],
        readOnly: route.readOnly,
      }),
    )
    .digest("hex");
}

function hasEvery<T>(actual: readonly T[], required: readonly T[]): boolean {
  const values = new Set(actual);
  return required.every((item) => values.has(item));
}

function freezeDecision(decision: V3PolicyDecision): V3PolicyDecision {
  const frozen = Object.freeze({
    ...decision,
    capabilities: Object.freeze([...decision.capabilities]),
    requiredConsents: Object.freeze([...decision.requiredConsents]),
    requiredEntitlements: Object.freeze([...decision.requiredEntitlements]),
    allowedToolIds: Object.freeze([...decision.allowedToolIds]),
    reasonCodes: Object.freeze([...decision.reasonCodes]),
  });
  trustedDecisions.add(frozen);
  return frozen;
}

function routeAllowedTools(
  route: V3RouteDecision,
  policy: RoutePolicy
): readonly V3ApprovedBoundaryToolId[] {
  if (
    route.route !== "market_quote" &&
    route.route !== "current_portfolio_value"
  ) {
    return policy.tools;
  }
  const converterRequested = route.reasonCodes.includes(
    route.route === "market_quote"
      ? "market_quote_currency:AZN"
      : "portfolio_value_currency:AZN"
  ) || route.reasonCodes.includes("private-studio-tool:convert-currency");
  return converterRequested
    ? policy.tools
    : policy.tools.filter((toolId) => toolId !== "convert-currency");
}

export function isV3TrustedPolicyDecision(value: unknown): value is V3PolicyDecision {
  return typeof value === "object" && value !== null && trustedDecisions.has(value);
}

export function evaluateV3Policy(input: V3EvaluatePolicyInput): V3PolicyDecision {
  const now = input.now ?? Date.now();
  const decisionTtlMs = input.decisionTtlMs ?? 30_000;
  if (
    !Number.isSafeInteger(decisionTtlMs) ||
    decisionTtlMs <= 0 ||
    decisionTtlMs > MAX_DECISION_TTL_MS
  ) {
    throw new V3PolicyError("invalid_policy_ttl", "Policy decision TTL is invalid.");
  }

  const base = {
    decisionId: randomUUID(),
    policyId: POLICY_ID,
    policyVersion: POLICY_VERSION,
    route: input.route.route,
    routeKind: input.route.kind,
    boundary: input.route.boundary,
    routeFingerprint: fingerprintV3Route(input.route),
    issuedAt: now,
  } as const;

  if (!isV3TrustedSession(input.session) || !isV3SessionCurrent(input.session, now)) {
    return freezeDecision({
      ...base,
      action: "deny",
      authorized: false,
      sessionId: null,
      tenantId: null,
      principalFingerprint: null,
      capabilities: [],
      requiredConsents: ["assistant_use"],
      requiredEntitlements: ["assistant_access"],
      allowedToolIds: [],
      reasonCodes: ["trusted_current_session_required"],
      expiresAt: now + decisionTtlMs,
    });
  }

  const session = input.session;
  const sessionExpiry = session.claims.expiresAt;
  const expiresAt = Math.min(now + decisionTtlMs, sessionExpiry);
  const identity = {
    sessionId: session.claims.sessionId,
    tenantId: session.claims.tenantId,
    principalFingerprint: v3PrincipalFingerprint(session),
  } as const;

  if (input.route.kind === "boundary") {
    return freezeDecision({
      ...base,
      ...identity,
      action: input.route.boundary === "sensitive_support" ? "escalate" : "deny",
      authorized: false,
      capabilities: [],
      requiredConsents: ["assistant_use"],
      requiredEntitlements: ["assistant_access"],
      allowedToolIds: [],
      reasonCodes: [`boundary:${input.route.boundary ?? "unknown"}`],
      expiresAt,
    });
  }
  if (input.route.kind === "clarify" || input.route.route === null) {
    return freezeDecision({
      ...base,
      ...identity,
      action: "redirect",
      authorized: false,
      capabilities: [],
      requiredConsents: ["assistant_use"],
      requiredEntitlements: ["assistant_access"],
      allowedToolIds: [],
      reasonCodes: ["route_not_actionable"],
      expiresAt,
    });
  }

  const routePolicy = ROUTE_POLICIES[input.route.route];
  const allowedTools = routeAllowedTools(input.route, routePolicy);
  const missingConsents = routePolicy.consents.filter(
    (scope) => !session.claims.consents.includes(scope),
  );
  const missingEntitlements = routePolicy.entitlements.filter(
    (entitlement) => !session.claims.entitlements.includes(entitlement),
  );
  const authorized =
    hasEvery(session.claims.consents, routePolicy.consents) &&
    hasEvery(session.claims.entitlements, routePolicy.entitlements);

  return freezeDecision({
    ...base,
    ...identity,
    action: authorized ? "allow" : "deny",
    authorized,
    capabilities: authorized ? routePolicy.capabilities : [],
    requiredConsents: routePolicy.consents,
    requiredEntitlements: routePolicy.entitlements,
    allowedToolIds: authorized ? allowedTools : [],
    reasonCodes: authorized
      ? ["policy_allow"]
      : [
          ...missingConsents.map((scope) => `missing_consent:${scope}`),
          ...missingEntitlements.map(
            (entitlement) => `missing_entitlement:${entitlement}`,
          ),
        ],
    expiresAt,
  });
}

/**
 * Narrow second-phase authorization for a confirmed preview. The caller must
 * still prove the one-use, principal-bound confirmation separately; this
 * decision only makes the handoff boundary tool grantable for a few seconds.
 */
export function authorizeV3OrderHandoffConfirmation(input: {
  route: V3RouteDecision;
  previewPolicy: V3PolicyDecision;
  session: V3TrustedSession;
  now?: number;
  decisionTtlMs?: number;
}): V3PolicyDecision {
  const now = input.now ?? Date.now();
  const ttlMs = input.decisionTtlMs ?? 15_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 30_000) {
    throw new V3PolicyError("invalid_confirmation_policy_ttl", "Confirmation policy TTL is invalid.");
  }
  const previewPolicy = enforceV3PolicyAgreement(
    input.route,
    input.previewPolicy,
    input.session,
    now
  );
  if (
    input.route.route !== "order_ticket_preview" ||
    !previewPolicy.capabilities.includes("order:preview") ||
    !input.session.claims.entitlements.includes("order_preview")
  ) {
    throw new V3PolicyError(
      "order_preview_confirmation_required",
      "Only an authorized order preview can create a handoff."
    );
  }
  return freezeDecision({
    ...previewPolicy,
    decisionId: randomUUID(),
    allowedToolIds: ["create-signed-order-handoff"],
    reasonCodes: ["explicit_principal_bound_preview_confirmation"],
    issuedAt: now,
    expiresAt: Math.min(now + ttlMs, input.session.claims.expiresAt)
  });
}

/**
 * This is the fail-closed hand-off point between routing and policy. Any stale,
 * copied, or route-mismatched decision is rejected before a grant can be made.
 */
export function enforceV3PolicyAgreement(
  route: V3RouteDecision,
  policy: unknown,
  session: unknown,
  now: number = Date.now(),
): V3PolicyDecision {
  if (!isV3TrustedPolicyDecision(policy)) {
    throw new V3PolicyError("untrusted_policy_decision", "Policy decision is not server-issued.");
  }
  if (!isV3SessionCurrent(session, now)) {
    throw new V3PolicyError("untrusted_session", "A current server-issued session is required.");
  }
  if (!policy.authorized || policy.action !== "allow") {
    throw new V3PolicyError("policy_denied", "Policy did not authorize this route.", policy.reasonCodes);
  }
  if (policy.expiresAt <= now || policy.issuedAt > now) {
    throw new V3PolicyError("policy_expired", "Policy decision is not current.");
  }
  if (
    policy.routeFingerprint !== fingerprintV3Route(route) ||
    policy.route !== route.route ||
    policy.routeKind !== route.kind ||
    policy.boundary !== route.boundary
  ) {
    throw new V3PolicyError(
      "router_policy_disagreement",
      "Router and policy decisions disagree; execution is denied.",
    );
  }
  if (
    policy.sessionId !== session.claims.sessionId ||
    policy.tenantId !== session.claims.tenantId ||
    policy.principalFingerprint !== v3PrincipalFingerprint(session)
  ) {
    throw new V3PolicyError(
      "policy_session_disagreement",
      "Policy and session identity disagree; execution is denied.",
    );
  }
  return policy;
}
