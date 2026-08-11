import { verifyV3AuditChain, type V3AuditEvent } from "./audit.js";
import { hashCanonicalV3Args, type V3GrantBinding } from "./grants.js";
import {
  fingerprintV3Route,
  isV3TrustedPolicyDecision,
  type V3ApprovedBoundaryToolId,
  type V3PolicyDecision,
} from "./policy.js";
import type { V3Function, V3RouteDecision } from "./routing.js";
import {
  isV3SessionCurrent,
  v3PrincipalFingerprint,
  type V3TrustedSession,
} from "./sessions.js";

export type V3ScorerStatus = "pass" | "fail" | "not_applicable" | "error";

export interface V3ScorerResult {
  readonly scorerId: string;
  readonly scorerVersion: "3.0.0";
  readonly status: V3ScorerStatus;
  readonly applicable: boolean;
  /** Always false for `not_applicable` and `error`. */
  readonly passed: boolean;
  /** 1 for pass, 0 for fail, and null when no valid score exists. */
  readonly score: 0 | 1 | null;
  readonly reasonCodes: readonly string[];
}

export interface V3ScorerAggregate {
  readonly passed: boolean;
  readonly score: number | null;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly notApplicableCount: number;
  readonly errorCount: number;
}

export interface V3GrantScorerInput {
  readonly grant: V3GrantBinding | null;
  readonly requestId: string;
  readonly workflowRunId: string;
  readonly policy: V3PolicyDecision;
  readonly session: V3TrustedSession;
  readonly toolId: V3ApprovedBoundaryToolId;
  readonly args: unknown;
}

export interface V3ScorerDefinition {
  readonly scorerId: string;
  readonly evaluate: () => V3ScorerResult;
}

const SCORER_VERSION = "3.0.0" as const;

function result(
  scorerId: string,
  status: V3ScorerStatus,
  reasonCodes: readonly string[],
): V3ScorerResult {
  return Object.freeze({
    scorerId,
    scorerVersion: SCORER_VERSION,
    status,
    applicable: status === "pass" || status === "fail",
    passed: status === "pass",
    score: status === "pass" ? 1 : status === "fail" ? 0 : null,
    reasonCodes: Object.freeze([...reasonCodes]),
  });
}

export function v3NotApplicableScore(
  scorerId: string,
  reasonCode = "not_applicable",
): V3ScorerResult {
  return result(scorerId, "not_applicable", [reasonCode]);
}

export function v3ErrorScore(
  scorerId: string,
  reasonCode = "scorer_error",
): V3ScorerResult {
  return result(scorerId, "error", [reasonCode]);
}

export function scoreV3TrustedSession(
  session: unknown,
  now: number = Date.now(),
): V3ScorerResult {
  const scorerId = "v3.trusted-session";
  try {
    return isV3SessionCurrent(session, now)
      ? result(scorerId, "pass", ["trusted_session_current"])
      : result(scorerId, "fail", ["trusted_session_missing_or_expired"]);
  } catch {
    return result(scorerId, "error", ["session_scorer_error"]);
  }
}

export function scoreV3PolicyRouteAgreement(
  route: V3RouteDecision,
  policy: unknown,
): V3ScorerResult {
  const scorerId = "v3.policy-route-agreement";
  try {
    if (!isV3TrustedPolicyDecision(policy)) {
      return result(scorerId, "fail", ["untrusted_policy_decision"]);
    }
    const agrees =
      policy.routeFingerprint === fingerprintV3Route(route) &&
      policy.route === route.route &&
      policy.routeKind === route.kind &&
      policy.boundary === route.boundary;
    return agrees
      ? result(scorerId, "pass", ["policy_route_agree"])
      : result(scorerId, "fail", ["policy_route_disagree"]);
  } catch {
    return result(scorerId, "error", ["policy_route_scorer_error"]);
  }
}

export function scoreV3GrantBinding(input: V3GrantScorerInput): V3ScorerResult {
  const scorerId = "v3.grant-binding";
  if (input.grant === null) {
    return v3NotApplicableScore(scorerId, "no_tool_grant_expected");
  }
  try {
    const grant = input.grant;
    const matches =
      grant.requestId === input.requestId &&
      grant.workflowRunId === input.workflowRunId &&
      grant.sessionId === input.session.claims.sessionId &&
      grant.tenantId === input.session.claims.tenantId &&
      grant.principalFingerprint === v3PrincipalFingerprint(input.session) &&
      grant.policyDecisionId === input.policy.decisionId &&
      grant.policyId === input.policy.policyId &&
      grant.policyVersion === input.policy.policyVersion &&
      grant.routeFingerprint === input.policy.routeFingerprint &&
      grant.toolId === input.toolId &&
      grant.canonicalArgsHash === hashCanonicalV3Args(input.args);
    return matches
      ? result(scorerId, "pass", ["grant_binding_matches"])
      : result(scorerId, "fail", ["grant_binding_mismatch"]);
  } catch {
    return result(scorerId, "error", ["grant_binding_scorer_error"]);
  }
}

export function scoreV3AuditIntegrity(
  events: readonly V3AuditEvent[],
): V3ScorerResult {
  const scorerId = "v3.audit-chain-integrity";
  try {
    if (events.length === 0) {
      return v3NotApplicableScore(scorerId, "no_audit_events");
    }
    const verification = verifyV3AuditChain(events);
    return verification.valid
      ? result(scorerId, "pass", ["audit_chain_valid"])
      : result(scorerId, "fail", [`audit_chain_invalid:${verification.reason}`]);
  } catch {
    return result(scorerId, "error", ["audit_chain_scorer_error"]);
  }
}

const REQUIRED_TOOL_BY_ROUTE: Readonly<
  Partial<Record<V3Function, V3ApprovedBoundaryToolId>>
> = {
  recent_trading_activity: "read-portfolio-activity",
  purchase_history: "read-portfolio-activity",
  current_portfolio_value: "read-portfolio-snapshot",
  ytd_gain_loss_twr: "read-portfolio-snapshot",
  holding_average_cost: "read-portfolio-snapshot",
  sector_allocation: "read-portfolio-snapshot",
  one_month_mover_contribution: "read-portfolio-snapshot",
  etf_explanation_risk: "read-instrument-research",
  fees_tariff: "retrieve-approved-product-knowledge",
  order_ticket_preview: "read-order-eligibility",
  market_quote: "read-market-snapshot",
  company_research: "read-instrument-research",
  technical_analysis: "read-price-history",
  news_sentiment: "read-market-content",
  market_move_explanation: "read-market-content",
  security_risk: "read-price-history",
  security_decision_support: "read-portfolio-snapshot",
  portfolio_allocation_analysis: "analyze-portfolio-allocation",
  hypothetical_portfolio_analysis: "analyze-portfolio-allocation",
  hypothetical_position_analysis: "read-market-snapshot",
  approved_knowledge: "retrieve-approved-product-knowledge",
  education: "retrieve-reviewed-investment-education",
};

export function scoreV3RequiredToolUse(
  route: V3RouteDecision,
  usedToolIds: readonly string[],
): V3ScorerResult {
  const scorerId = "v3.required-tool-use";
  try {
    if (route.route === null || route.kind === "boundary" || route.kind === "clarify") {
      return v3NotApplicableScore(scorerId, "route_does_not_require_tool");
    }
    if (route.route === "conversation") {
      return v3NotApplicableScore(scorerId, "route_does_not_require_tool");
    }
    const requiredTool = route.route === "company_research" &&
      route.researchFacet === "listing"
      ? "resolve-instrument"
      : route.route === "market_quote" &&
          route.reasonCodes.includes("market_quote_currency:AZN")
        ? "convert-currency"
      : route.route === "current_portfolio_value" &&
          route.reasonCodes.includes("portfolio_value_currency:AZN")
        ? "convert-currency"
      : (
          route.route === "company_research" ||
          (route.route === "security_risk" &&
            route.researchFacet === "risk_comparison")
        )
        ? "read-instrument-research"
        : REQUIRED_TOOL_BY_ROUTE[route.route];
    if (requiredTool === undefined) {
      return result(scorerId, "error", ["required_tool_mapping_missing"]);
    }
    return usedToolIds.includes(requiredTool)
      ? result(scorerId, "pass", [`required_tool_used:${requiredTool}`])
      : result(scorerId, "fail", [`required_tool_missing:${requiredTool}`]);
  } catch {
    return result(scorerId, "error", ["required_tool_scorer_error"]);
  }
}

/** Each scorer is isolated so one exception cannot manufacture other passes. */
export function runIndependentV3Scorers(
  definitions: readonly V3ScorerDefinition[],
): readonly V3ScorerResult[] {
  return Object.freeze(
    definitions.map(({ scorerId, evaluate }) => {
      try {
        const score = evaluate();
        if (score.scorerId !== scorerId) {
          return v3ErrorScore(scorerId, "scorer_id_mismatch");
        }
        if (score.status === "not_applicable" && score.passed) {
          return v3ErrorScore(scorerId, "not_applicable_cannot_pass");
        }
        return score;
      } catch {
        return v3ErrorScore(scorerId);
      }
    }),
  );
}

export function aggregateV3Scores(
  scores: readonly V3ScorerResult[],
): V3ScorerAggregate {
  const passedCount = scores.filter((score) => score.status === "pass").length;
  const failedCount = scores.filter((score) => score.status === "fail").length;
  const notApplicableCount = scores.filter(
    (score) => score.status === "not_applicable",
  ).length;
  const errorCount = scores.filter((score) => score.status === "error").length;
  const applicableCount = passedCount + failedCount;
  return Object.freeze({
    // An all-N/A suite cannot be reported as a pass.
    passed: applicableCount > 0 && failedCount === 0 && errorCount === 0,
    score: applicableCount > 0 ? passedCount / applicableCount : null,
    passedCount,
    failedCount,
    notApplicableCount,
    errorCount,
  });
}
