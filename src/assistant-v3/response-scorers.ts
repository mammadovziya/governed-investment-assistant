import { createHash } from "node:crypto";

import type {
  BoundaryMarketSnapshot,
  ResolvedInstrument
} from "./boundary-tools.js";
import type {
  AssistantCitation,
  AssistantResponse,
  EnvelopeIntegrity,
  FactEnvelope,
  ToolExecutionEnvelope,
  TrustedRequestContext,
} from "./contracts.js";
import {
  isReviewedConversationDefinition,
  isReviewedGenericClarificationDefinition
} from "./conversation.js";
import { EvidenceFactory } from "./evidence.js";
import {
  financialEducationQueryHash,
  normalizeFinancialEducationQuery
} from "./financial-education-query.js";
import { GovernedInAppNavigationService } from "./governed-navigation.js";
import {
  GovernedReadOnlyNavigationService,
  isGovernedReadOnlyNavigationRoute
} from "./governed-read-only-navigation.js";
import { portfolioActivityToolArguments } from "./portfolio-activity.js";
import {
  parseHypotheticalPortfolioScenario,
  parseHypotheticalPositionScenario,
  projectHypotheticalPositionAnalysis
} from "./portfolio-scenarios.js";
import { reviewOrderPreviewIntent } from "./order-intent.js";
import {
  V3_APPROVED_BOUNDARY_TOOL_IDS,
  type V3ApprovedBoundaryToolId,
} from "./policy.js";
import {
  marketHistoryRangeFromRoute,
  type V3Function,
  type V3RouteDecision
} from "./routing.js";
import {
  runIndependentV3Scorers,
  type V3ScorerResult,
  type V3ScorerStatus,
} from "./scorers.js";
import {
  canonicalHash,
  type DevHmacSigner,
  verifyEnvelope,
} from "./signing.js";
import {
  RENDERABLE_SEMANTIC_ROLES,
  renderableFactProjectionPayload,
  type RenderableFact,
  type RenderableSemanticRole
} from "./rendering.js";

export const V3_BLOCKING_RESPONSE_SCORER_IDS = [
  "v3.response.required-tool-set",
  "v3.response.tool-envelope-integrity",
  "v3.response.fact-derivation",
  "v3.response.material-claim-lineage",
  "v3.response.navigation-integrity",
  "v3.response.citation-integrity",
  "v3.response.numeric-date-grounding",
  "v3.response.conversational-quality",
] as const;

export type V3BlockingResponseScorerId =
  (typeof V3_BLOCKING_RESPONSE_SCORER_IDS)[number];

export interface V3ToolScoringEvidence {
  readonly envelope: ToolExecutionEnvelope<unknown>;
  /** Exact canonical arguments supplied to the tool boundary. */
  readonly arguments: unknown;
  readonly maxAgeMs?: number;
}

export interface V3SignedFactDisplay {
  readonly alias: string;
  readonly factId: string;
  /**
   * Output of a deterministic formatter associated with the signed fact.
   * Multiple granular displays may share one factId.
   */
  readonly display: string;
  readonly meaning: string;
  readonly required: boolean;
  readonly semanticRoles: readonly RenderableSemanticRole[];
  readonly requiredCitationAlias?: string;
  readonly projectionIntegrity: EnvelopeIntegrity;
}

export interface V3ResponseScoringInput {
  readonly route: V3RouteDecision;
  readonly context: TrustedRequestContext;
  /** Original normalized customer text used for semantic intent checks. */
  readonly requestMessage?: string;
  readonly response: AssistantResponse;
  readonly tools: readonly V3ToolScoringEvidence[];
  readonly inputFacts?: readonly FactEnvelope<unknown>[];
  readonly factDisplays?: readonly V3SignedFactDisplay[];
  readonly signer: DevHmacSigner;
  readonly evaluatedAt?: number | string;
  readonly defaultToolMaxAgeMs?: number;
  readonly maxToolAgeMsByTool?: Readonly<
    Partial<Record<V3ApprovedBoundaryToolId, number>>
  >;
  readonly futureClockSkewMs?: number;
}

export interface V3BlockingResponseAggregate {
  readonly capability: "response-delivery";
  readonly priority: "P0";
  readonly delivery: "allow" | "block";
  readonly passed: boolean;
  readonly score: number | null;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly notApplicableCount: number;
  readonly errorCount: number;
  readonly blockedBy: readonly string[];
  readonly results: readonly V3ScorerResult[];
}

const SCORER_VERSION = "3.0.0" as const;
const DEFAULT_TOOL_MAX_AGE_MS = 10 * 60_000;
const DEFAULT_FUTURE_CLOCK_SKEW_MS = 30_000;
const MAX_INDICATIVE_MARKET_AGE_MS = 7 * 24 * 60 * 60_000;
const APPROVED_TOOL_IDS = new Set<string>(V3_APPROVED_BOUNDARY_TOOL_IDS);

const DEFAULT_MAX_AGE_BY_TOOL: Readonly<
  Record<V3ApprovedBoundaryToolId, number>
> = {
  "resolve-instrument": 10 * 60_000,
  "read-market-snapshot": 2 * 60_000,
  "read-price-history": 10 * 60_000,
  "read-instrument-research": 10 * 60_000,
  "read-market-content": 10 * 60_000,
  "convert-currency": 24 * 60 * 60_000,
  "analyze-portfolio-allocation": 2 * 60_000,
  "read-portfolio-snapshot": 2 * 60_000,
  "read-portfolio-activity": 10 * 60_000,
  "retrieve-reviewed-investment-education": 10 * 60_000,
  "retrieve-approved-product-knowledge": 10 * 60_000,
  "read-order-eligibility": 60_000,
  "create-signed-order-handoff": 60_000,
};

export const V3_REQUIRED_TOOL_SET_BY_ROUTE: Readonly<
  Record<V3Function, readonly V3ApprovedBoundaryToolId[]>
> = {
  recent_trading_activity: ["read-portfolio-activity"],
  purchase_history: ["read-portfolio-activity"],
  current_portfolio_value: ["read-portfolio-snapshot", "read-market-snapshot"],
  largest_holding: ["read-portfolio-snapshot", "read-market-snapshot"],
  ytd_gain_loss_twr: [
    "read-portfolio-snapshot",
    "read-portfolio-activity",
    "read-market-snapshot",
    "read-price-history",
  ],
  holding_average_cost: ["read-portfolio-snapshot", "read-portfolio-activity"],
  sector_allocation: ["read-portfolio-snapshot", "read-market-snapshot"],
  one_month_mover_contribution: [
    "read-portfolio-snapshot",
    "read-portfolio-activity",
    "read-price-history",
  ],
  etf_explanation_risk: [
    "resolve-instrument",
    "read-market-snapshot",
    "read-instrument-research",
    "read-price-history",
  ],
  fees_tariff: ["retrieve-approved-product-knowledge"],
  order_ticket_preview: [
    "resolve-instrument",
    "read-market-snapshot",
    "read-order-eligibility",
  ],
  market_quote: ["resolve-instrument", "read-market-snapshot", "read-price-history"],
  market_history: ["resolve-instrument", "read-price-history"],
  market_event: ["resolve-instrument", "read-market-content"],
  company_research: [
    "resolve-instrument",
    "read-market-snapshot",
    "read-instrument-research",
    "read-price-history",
  ],
  technical_analysis: ["resolve-instrument", "read-price-history"],
  news_sentiment: ["resolve-instrument", "read-market-content"],
  market_move_explanation: [
    "resolve-instrument",
    "read-market-snapshot",
    "read-price-history",
    "read-market-content",
  ],
  security_risk: [
    "resolve-instrument",
    "read-price-history",
    "read-instrument-research",
  ],
  security_decision_support: [
    "read-portfolio-snapshot",
    "resolve-instrument",
    "read-market-snapshot",
    "read-instrument-research",
    "read-market-content",
  ],
  portfolio_allocation_analysis: ["analyze-portfolio-allocation"],
  hypothetical_portfolio_analysis: ["analyze-portfolio-allocation"],
  hypothetical_position_analysis: [
    "resolve-instrument",
    "read-market-snapshot",
  ],
  approved_knowledge: ["retrieve-approved-product-knowledge"],
  education: ["retrieve-reviewed-investment-education"],
  conversation: [],
};

interface SymbolScopedToolRequirement {
  readonly toolId: V3ApprovedBoundaryToolId;
  readonly range?: "1d" | "1w" | "1m" | "6m" | "1y" | "5y" | "10y" | "max";
  readonly conversionScope?: "current-market-price";
  readonly targetCurrency?: "AZN";
}

/**
 * Public quote and research results are composed once per routed symbol. A
 * plain set-of-tool-IDs check is therefore insufficient for comparisons: one
 * symbol's evidence must not satisfy another symbol's route requirements.
 */
const SYMBOL_SCOPED_TOOL_REQUIREMENTS: Readonly<
  Partial<Record<V3Function, readonly SymbolScopedToolRequirement[]>>
> = {
  market_quote: [
    { toolId: "resolve-instrument" },
    { toolId: "read-market-snapshot" },
    { toolId: "read-price-history", range: "10y" },
  ],
  security_decision_support: [
    { toolId: "resolve-instrument" },
    { toolId: "read-market-snapshot" },
    { toolId: "read-instrument-research" },
    { toolId: "read-market-content" },
  ],
  hypothetical_position_analysis: [
    { toolId: "resolve-instrument" },
    { toolId: "read-market-snapshot" },
  ],
  company_research: [
    { toolId: "resolve-instrument" },
    { toolId: "read-market-snapshot" },
    { toolId: "read-instrument-research" },
    { toolId: "read-price-history", range: "10y" },
  ],
  market_move_explanation: [
    { toolId: "resolve-instrument" },
    { toolId: "read-market-snapshot" },
    { toolId: "read-price-history", range: "1d" },
    { toolId: "read-market-content" },
  ],
};

const CITATION_REQUIRED_ROUTES = new Set<V3Function>([
  "fees_tariff",
  "approved_knowledge",
  "education",
]);

function scorerResult(
  scorerId: V3BlockingResponseScorerId,
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

function pass(
  scorerId: V3BlockingResponseScorerId,
  reasonCode: string,
): V3ScorerResult {
  return scorerResult(scorerId, "pass", [reasonCode]);
}

function fail(
  scorerId: V3BlockingResponseScorerId,
  reasonCodes: readonly string[],
): V3ScorerResult {
  return scorerResult(scorerId, "fail", reasonCodes);
}

function notApplicable(
  scorerId: V3BlockingResponseScorerId,
  reasonCode: string,
): V3ScorerResult {
  return scorerResult(scorerId, "not_applicable", [reasonCode]);
}

function scorerError(
  scorerId: V3BlockingResponseScorerId,
  reasonCode: string,
): V3ScorerResult {
  return scorerResult(scorerId, "error", [reasonCode]);
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluationTime(input: V3ResponseScoringInput): number {
  if (input.evaluatedAt === undefined) return Date.now();
  const value =
    typeof input.evaluatedAt === "number"
      ? input.evaluatedAt
      : Date.parse(input.evaluatedAt);
  if (!Number.isFinite(value)) throw new TypeError("evaluatedAt is invalid.");
  return value;
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function equalStringSets(left: readonly string[], right: readonly string[]): boolean {
  return (
    uniqueStrings(left) &&
    uniqueStrings(right) &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function toolEnvelopes(
  input: V3ResponseScoringInput,
): readonly ToolExecutionEnvelope<unknown>[] {
  return input.tools.map(({ envelope }) => envelope);
}

export function requiredV3ToolSet(
  route: V3RouteDecision,
): readonly V3ApprovedBoundaryToolId[] {
  if (route.route === null || route.kind === "boundary" || route.kind === "clarify") {
    return [];
  }
  if (route.route === "company_research") {
    if (route.researchFacet === "listing") return ["resolve-instrument"];
    if (route.researchFacet !== "general") {
      return ["resolve-instrument", "read-instrument-research"];
    }
  }
  if (
    route.route === "security_risk" &&
    route.researchFacet === "risk_comparison"
  ) {
    return ["resolve-instrument", "read-instrument-research"];
  }
  if (
    route.route === "current_portfolio_value" &&
    route.reasonCodes.includes("portfolio_value_currency:AZN")
  ) {
    return [
      ...V3_REQUIRED_TOOL_SET_BY_ROUTE.current_portfolio_value,
      "convert-currency"
    ];
  }
  if (
    route.route === "market_quote" &&
    route.reasonCodes.includes("market_quote_currency:AZN")
  ) {
    return [
      "resolve-instrument",
      "convert-currency",
      "read-price-history"
    ];
  }
  return V3_REQUIRED_TOOL_SET_BY_ROUTE[route.route];
}

function symbolScopedRequirements(
  route: V3RouteDecision
): readonly SymbolScopedToolRequirement[] {
  if (
    route.route === "market_quote" &&
    route.reasonCodes.includes("market_quote_currency:AZN")
  ) {
    return [
      { toolId: "resolve-instrument" },
      {
        toolId: "convert-currency",
        conversionScope: "current-market-price",
        targetCurrency: "AZN"
      },
      { toolId: "read-price-history", range: "10y" }
    ];
  }
  if (route.route === "market_history") {
    const range = marketHistoryRangeFromRoute(route);
    return range === null
      ? []
      : [
          { toolId: "resolve-instrument" },
          { toolId: "read-price-history", range }
        ];
  }
  if (route.route === "market_event") {
    return [
      { toolId: "resolve-instrument" },
      { toolId: "read-market-content" }
    ];
  }
  if (route.route === "company_research") {
    if (route.researchFacet === "listing") {
      return [{ toolId: "resolve-instrument" }];
    }
    if (route.researchFacet !== "general") {
      return [
        { toolId: "resolve-instrument" },
        { toolId: "read-instrument-research" }
      ];
    }
  }
  if (
    route.route === "security_risk" &&
    route.researchFacet === "risk_comparison"
  ) {
    return [
      { toolId: "resolve-instrument" },
      { toolId: "read-instrument-research" }
    ];
  }
  return route.route === null
    ? []
    : SYMBOL_SCOPED_TOOL_REQUIREMENTS[route.route] ?? [];
}

/** Requires every route-specific boundary tool, not one representative tool. */
export function scoreV3RequiredToolSet(
  input: V3ResponseScoringInput,
): V3ScorerResult {
  const scorerId = "v3.response.required-tool-set" as const;
  try {
    const required = requiredV3ToolSet(input.route);
    if (required.length === 0) {
      return notApplicable(scorerId, "route_has_no_required_tool_set");
    }
    const completedResponse = input.response.status === "complete";
    const missing = required.filter(
      (toolId) =>
        !input.tools.some(
          ({ envelope }) =>
            envelope.toolId === toolId &&
            (!completedResponse || envelope.status === "success"),
        ),
    );
    const scopedMissing: string[] = [];
    const activityArgumentProblems: string[] = [];
    const route = input.route.route;
    const scopedRequirements = symbolScopedRequirements(input.route);
    if (scopedRequirements.length > 0 && input.route.symbols.length > 0) {
      const suppliedToolIds = new Set(
        input.tools.map(({ envelope }) => envelope.toolId),
      );
      for (const symbol of input.route.symbols) {
        for (const requirement of scopedRequirements) {
          // The route-level reason above is clearer when this tool ID was not
          // attempted at all. Scoped reasons identify incomplete comparisons
          // or an incorrect long-term history range.
          if (!suppliedToolIds.has(requirement.toolId)) continue;
          const present = input.tools.some(({ envelope, arguments: args }) => {
            if (
              envelope.toolId !== requirement.toolId ||
              (completedResponse && envelope.status !== "success") ||
              typeof args !== "object" ||
              args === null ||
              Array.isArray(args)
            ) {
              return false;
            }
            const record = args as Readonly<Record<string, unknown>>;
            return record.symbol === symbol &&
              (requirement.range === undefined || record.range === requirement.range) &&
              (
                requirement.conversionScope === undefined ||
                record.scope === requirement.conversionScope
              ) &&
              (
                requirement.targetCurrency === undefined ||
                record.targetCurrency === requirement.targetCurrency
              );
          });
          if (!present) {
            scopedMissing.push(
              `required_tool_scope_missing:${requirement.toolId}:${symbol}${
                requirement.range === undefined ? "" : `:${requirement.range}`
              }`,
            );
          }
        }
      }
    }
    if (route === "recent_trading_activity" || route === "purchase_history") {
      const activityTools = input.tools.filter(
        ({ envelope }) => envelope.toolId === "read-portfolio-activity"
      );
      if (activityTools.length !== 1) {
        activityArgumentProblems.push("activity_tool_count_invalid");
      } else {
        try {
          const expectedArguments = portfolioActivityToolArguments({
            route,
            symbols: input.route.symbols
          });
          if (canonicalHash(activityTools[0]!.arguments) !== canonicalHash(expectedArguments)) {
            activityArgumentProblems.push("activity_tool_arguments_mismatch");
          }
        } catch {
          activityArgumentProblems.push("activity_tool_scope_invalid");
        }
      }
    }
    if (route === "education") {
      const educationTools = input.tools.filter(
        ({ envelope }) =>
          envelope.toolId === "retrieve-reviewed-investment-education"
      );
      const queryReason = input.route.reasonCodes.find((reason) =>
        reason.startsWith("education_query:")
      );
      const queryHash = queryReason?.slice("education_query:".length) ?? null;
      if (
        educationTools.length !== 1 ||
        queryHash === null ||
        !/^[a-f0-9]{64}$/u.test(queryHash)
      ) {
        activityArgumentProblems.push("education_tool_scope_invalid");
      } else {
        const args = educationTools[0]!.arguments;
        const queryValue =
          typeof args === "object" &&
          args !== null &&
          !Array.isArray(args)
            ? (args as Readonly<Record<string, unknown>>).query
            : null;
        const query = typeof queryValue === "string" ? queryValue : null;
        const normalizedRequest = input.requestMessage === undefined
          ? null
          : normalizeFinancialEducationQuery(input.requestMessage);
        if (
          query === null ||
          normalizeFinancialEducationQuery(query) !== query ||
          financialEducationQueryHash(query) !== queryHash ||
          (
            normalizedRequest !== null &&
            query !== normalizedRequest
          )
        ) {
          activityArgumentProblems.push("education_tool_arguments_mismatch");
        }
      }
    }
    const problems = [
      ...missing.map((toolId) => `required_tool_missing:${toolId}`),
      ...scopedMissing,
      ...activityArgumentProblems,
    ];
    return problems.length === 0
      ? pass(scorerId, "all_required_route_tools_present")
      : fail(scorerId, problems);
  } catch {
    return scorerError(scorerId, "required_tool_set_scorer_error");
  }
}

export function scoreV3ToolEnvelopeIntegrity(
  input: V3ResponseScoringInput,
): V3ScorerResult {
  const scorerId = "v3.response.tool-envelope-integrity" as const;
  try {
    if (input.tools.length === 0) {
      return requiredV3ToolSet(input.route).length === 0
        ? notApplicable(scorerId, "no_tool_envelopes_expected")
        : fail(scorerId, ["tool_envelopes_missing"]);
    }
    const now = evaluationTime(input);
    const requestTime = parseTimestamp(input.context.requestedAt);
    if (requestTime === null) return fail(scorerId, ["request_timestamp_invalid"]);
    const futureSkew = input.futureClockSkewMs ?? DEFAULT_FUTURE_CLOCK_SKEW_MS;
    const defaultMaxAge = input.defaultToolMaxAgeMs ?? DEFAULT_TOOL_MAX_AGE_MS;
    if (futureSkew < 0 || defaultMaxAge <= 0) {
      return fail(scorerId, ["freshness_configuration_invalid"]);
    }

    const evidence = new EvidenceFactory({ signer: input.signer, now: () => now });
    const problems: string[] = [];
    const executionIds = input.tools.map(({ envelope }) => envelope.executionId);
    if (!uniqueStrings(executionIds)) problems.push("duplicate_tool_execution_id");

    for (const item of input.tools) {
      const { envelope } = item;
      const label = envelope.executionId || "missing-execution-id";
      if (!APPROVED_TOOL_IDS.has(envelope.toolId)) {
        problems.push(`unapproved_tool_id:${envelope.toolId || label}`);
      }
      if (
        envelope.schemaVersion !== "assistant-v3.tool-execution.v1" ||
        !envelope.executionId ||
        !envelope.toolVersion ||
        !envelope.source.provider ||
        !envelope.source.sourceId
      ) {
        problems.push(`tool_shape_invalid:${label}`);
      }
      if (
        envelope.requestId !== input.context.requestId ||
        envelope.requestId !== input.response.requestId
      ) {
        problems.push(`tool_request_mismatch:${label}`);
      }
      if (envelope.workflowRunId !== input.response.provenance.workflowRunId) {
        problems.push(`tool_workflow_mismatch:${label}`);
      }
      if (!evidence.verifyTool(envelope)) {
        problems.push(`tool_signature_or_result_hash_invalid:${label}`);
      }
      if (envelope.argumentsHash !== canonicalHash(item.arguments)) {
        problems.push(`tool_arguments_hash_invalid:${label}`);
      }

      const startedAt = parseTimestamp(envelope.startedAt);
      const completedAt = parseTimestamp(envelope.completedAt);
      const observedAt = parseTimestamp(envelope.source.observedAt);
      const sourceAsOf = parseTimestamp(envelope.source.sourceAsOf);
      if (
        startedAt === null ||
        completedAt === null ||
        observedAt === null ||
        sourceAsOf === null
      ) {
        problems.push(`tool_timestamp_invalid:${label}`);
        continue;
      }
      const approvedToolId = APPROVED_TOOL_IDS.has(envelope.toolId)
        ? (envelope.toolId as V3ApprovedBoundaryToolId)
        : null;
      const maxAge =
        item.maxAgeMs ??
        (approvedToolId === null
          ? defaultMaxAge
          : input.maxToolAgeMsByTool?.[approvedToolId] ??
            DEFAULT_MAX_AGE_BY_TOOL[approvedToolId] ??
            defaultMaxAge);
      if (!Number.isFinite(maxAge) || maxAge <= 0) {
        problems.push(`tool_max_age_invalid:${label}`);
      } else if (
        startedAt > completedAt ||
        completedAt > now + futureSkew ||
        observedAt > now + futureSkew ||
        sourceAsOf > now + futureSkew ||
        now - completedAt > maxAge ||
        now - observedAt > maxAge ||
        startedAt < requestTime - maxAge
      ) {
        problems.push(`tool_freshness_invalid:${label}`);
      }
      if (
        approvedToolId === "convert-currency" &&
        recordValue(envelope.result)?.scope === "current-market-price"
      ) {
        const result = recordValue(envelope.result);
        const snapshot = recordValue(result?.marketSnapshot);
        const marketSource = recordValue(result?.marketSource);
        const marketAsOf = typeof snapshot?.asOf === "string"
          ? parseTimestamp(snapshot.asOf)
          : null;
        const marketObservedAt = typeof marketSource?.observedAt === "string"
          ? parseTimestamp(marketSource.observedAt)
          : null;
        const marketSourceAsOf = typeof marketSource?.sourceAsOf === "string"
          ? parseTimestamp(marketSource.sourceAsOf)
          : null;
        const resultMarketAsOf = Array.isArray(result?.marketAsOf)
          ? recordValue(result.marketAsOf[0])
          : null;
        const resultMarketTimestamp = typeof resultMarketAsOf?.asOf === "string"
          ? parseTimestamp(resultMarketAsOf.asOf)
          : null;
        const marketMaxAge =
          input.maxToolAgeMsByTool?.["read-market-snapshot"] ??
          DEFAULT_MAX_AGE_BY_TOOL["read-market-snapshot"];
        const freshness = snapshot?.freshness;
        const delayMinutes = snapshot?.delayMinutes;
        const evidenceMaxAge = freshness === "indicative"
          ? MAX_INDICATIVE_MARKET_AGE_MS
          : freshness === "delayed" &&
              typeof delayMinutes === "number" &&
              Number.isFinite(delayMinutes) &&
              delayMinutes >= 0
            ? Math.max(
                marketMaxAge,
                delayMinutes * 60_000 + futureSkew
              )
            : marketMaxAge;
        if (
          marketAsOf === null ||
          marketObservedAt === null ||
          marketSourceAsOf === null ||
          resultMarketTimestamp === null ||
          !["live", "delayed", "indicative"].includes(String(freshness)) ||
          marketSourceAsOf !== marketAsOf ||
          resultMarketTimestamp !== marketAsOf ||
          marketAsOf > now + futureSkew ||
          marketObservedAt > now + futureSkew ||
          marketSourceAsOf > now + futureSkew ||
          now - marketObservedAt > marketMaxAge ||
          now - marketAsOf > evidenceMaxAge
        ) {
          problems.push(`tool_nested_market_freshness_invalid:${label}`);
        }
      }
    }

    const suppliedIds = input.tools.map(({ envelope }) => envelope.executionId);
    if (!equalStringSets(suppliedIds, input.response.provenance.toolExecutionIds)) {
      problems.push("response_tool_provenance_mismatch");
    }
    return problems.length === 0
      ? pass(scorerId, "tool_envelopes_verified")
      : fail(scorerId, problems);
  } catch {
    return scorerError(scorerId, "tool_envelope_scorer_error");
  }
}

interface FactGraphCheck {
  readonly problems: readonly string[];
  readonly factsById: ReadonlyMap<string, FactEnvelope<unknown>>;
}

function checkFactGraph(input: V3ResponseScoringInput): FactGraphCheck {
  const tools = toolEnvelopes(input);
  const evidence = new EvidenceFactory({ signer: input.signer });
  const responseFacts = [...input.response.facts];
  const inputFacts = [...(input.inputFacts ?? [])];
  const allFacts = [...responseFacts, ...inputFacts];
  const factsById = new Map<string, FactEnvelope<unknown>>();
  const toolsById = new Map<string, ToolExecutionEnvelope<unknown>>();
  const problems: string[] = [];

  for (const tool of tools) {
    if (toolsById.has(tool.executionId)) {
      problems.push(`duplicate_tool_execution_id:${tool.executionId}`);
    } else {
      toolsById.set(tool.executionId, tool);
    }
  }
  for (const fact of allFacts) {
    if (factsById.has(fact.factId)) {
      problems.push(`duplicate_fact_id:${fact.factId}`);
    } else {
      factsById.set(fact.factId, fact);
    }
  }

  const now = evaluationTime(input);
  const checked = new Set<string>();
  const visiting = new Set<string>();
  const approvedEducationToolFact = (
    fact: FactEnvelope<unknown>
  ): boolean => {
    const value = recordValue(fact.value);
    const queryReason = input.route.reasonCodes.find((reason) =>
      reason.startsWith("education_query:")
    );
    const queryHash = queryReason?.slice("education_query:".length) ?? null;
    const retrieval = recordValue(value?.retrieval);
    if (
      input.route.route !== "education" ||
      queryHash === null ||
      !/^[a-f0-9]{64}$/u.test(queryHash) ||
      fact.kind !== "education.approved-retrieval" ||
      fact.subject.type !== "product" ||
      fact.subject.ref !== `GENERAL_FINANCIAL_EDUCATION:${queryHash}` ||
      fact.provenance.calculation !== null ||
      fact.provenance.toolExecutionIds.length !== 1 ||
      !fact.quality.flags.includes("APPROVED_FINANCIAL_EDUCATION") ||
      value?.schemaVersion !== "assistant-v3.financial-education-retrieval.v1" ||
      value.status !== "grounded" ||
      value.requestId !== input.context.requestId ||
      value.locale !== input.context.locale ||
      value.queryHash !== queryHash ||
      retrieval?.queryHash !== queryHash ||
      retrieval.locale !== input.context.locale ||
      !Array.isArray(value.propositions) ||
      value.propositions.length < 1 ||
      value.propositions.length > 5 ||
      !Array.isArray(value.citations) ||
      value.citations.length !== value.propositions.length
    ) {
      return false;
    }
    const tool = toolsById.get(fact.provenance.toolExecutionIds[0]!);
    return tool?.toolId === "retrieve-reviewed-investment-education" &&
      tool.status === "success" &&
      canonicalHash(tool.result) === canonicalHash(fact.value);
  };
  const reviewedConversationRoot = (fact: FactEnvelope<unknown>): boolean => {
    const value = recordValue(fact.value);
    const calculation = fact.provenance.calculation;
    return input.route.route === "conversation" &&
      fact.kind === "assistant.reviewed-conversation" &&
      fact.subject.type === "product" &&
      fact.subject.ref === "ASSISTANT_CONVERSATION" &&
      calculation?.id === "deterministic-conversation-catalog" &&
      calculation.version === "1.0.0" &&
      calculation.formulaId === "reviewed-conversation-lookup" &&
      fact.quality.flags.includes("REVIEWED_CONVERSATION") &&
      isReviewedConversationDefinition(value, input.context.locale);
  };
  const reviewedGenericClarificationRoot = (
    fact: FactEnvelope<unknown>
  ): boolean => {
    const value = recordValue(fact.value);
    const calculation = fact.provenance.calculation;
    return input.route.kind === "clarify" &&
      input.route.route === null &&
      input.route.reasonCodes.includes("no_deterministic_route") &&
      fact.kind === "assistant.reviewed-clarification" &&
      fact.subject.type === "product" &&
      fact.subject.ref === "ASSISTANT_GENERIC_CLARIFICATION" &&
      calculation?.id === "deterministic-clarification-catalog" &&
      calculation.version === "1.0.0" &&
      calculation.formulaId === "reviewed-generic-clarification-lookup" &&
      fact.quality.flags.includes("REVIEWED_GENERIC_CLARIFICATION") &&
      isReviewedGenericClarificationDefinition(value, input.context.locale);
  };
  const visit = (factId: string): void => {
    if (checked.has(factId)) return;
    if (visiting.has(factId)) {
      problems.push(`fact_ancestry_cycle:${factId}`);
      return;
    }
    const fact = factsById.get(factId);
    if (fact === undefined) {
      problems.push(`input_fact_missing:${factId}`);
      return;
    }
    visiting.add(factId);
    if (
      fact.schemaVersion !== "assistant-v3.fact.v1" ||
      !fact.factId ||
      !fact.kind ||
      !fact.subject.ref
    ) {
      problems.push(`fact_shape_invalid:${factId}`);
    }
    if (!verifyEnvelope(fact, input.signer)) {
      problems.push(`fact_signature_invalid:${factId}`);
    }
    if (
      fact.requestId !== input.context.requestId ||
      fact.requestId !== input.response.requestId
    ) {
      problems.push(`fact_request_mismatch:${factId}`);
    }
    if (fact.workflowRunId !== input.response.provenance.workflowRunId) {
      problems.push(`fact_workflow_mismatch:${factId}`);
    }
    const asOf = parseTimestamp(fact.asOf);
    const createdAt = parseTimestamp(fact.createdAt);
    if (
      asOf === null ||
      createdAt === null ||
      asOf > now + DEFAULT_FUTURE_CLOCK_SKEW_MS ||
      createdAt > now + DEFAULT_FUTURE_CLOCK_SKEW_MS
    ) {
      problems.push(`fact_timestamp_invalid:${factId}`);
    }
    const coverage = Number(fact.quality.coverage);
    if (
      !Number.isFinite(coverage) ||
      coverage < 0 ||
      coverage > 1 ||
      !uniqueStrings(fact.quality.flags)
    ) {
      problems.push(`fact_quality_invalid:${factId}`);
    }
    const provenance = fact.provenance;
    if (
      provenance.toolExecutionIds.length === 0 &&
      provenance.inputFactIds.length === 0 &&
      !reviewedConversationRoot(fact) &&
      !reviewedGenericClarificationRoot(fact)
    ) {
      problems.push(`fact_ancestry_missing:${factId}`);
    }
    if (
      !uniqueStrings(provenance.toolExecutionIds) ||
      !uniqueStrings(provenance.inputFactIds)
    ) {
      problems.push(`fact_ancestry_duplicate:${factId}`);
    }
    if (
      provenance.calculation !== null &&
      (!provenance.calculation.id ||
        !provenance.calculation.version ||
        !provenance.calculation.formulaId)
    ) {
      problems.push(`fact_calculation_invalid:${factId}`);
    }
    for (const executionId of provenance.toolExecutionIds) {
      const tool = toolsById.get(executionId);
      if (tool === undefined) {
        problems.push(`fact_tool_ancestor_missing:${factId}:${executionId}`);
      } else if (
        tool.requestId !== fact.requestId ||
        tool.workflowRunId !== fact.workflowRunId ||
        tool.status !== "success" ||
        !evidence.verifyTool(tool)
      ) {
        problems.push(`fact_tool_ancestor_invalid:${factId}:${executionId}`);
      }
    }
    for (const inputFactId of provenance.inputFactIds) visit(inputFactId);
    if (
      input.route.route === "education" &&
      fact.kind === "education.approved-retrieval" &&
      !approvedEducationToolFact(fact)
    ) {
      problems.push(`education_tool_fact_invalid:${factId}`);
    }
    if (!evidence.verifyFact(fact, tools, allFacts)) {
      problems.push(`fact_derivation_invalid:${factId}`);
    }
    visiting.delete(factId);
    checked.add(factId);
  };

  for (const fact of responseFacts) visit(fact.factId);
  return { problems, factsById };
}

export function scoreV3FactDerivation(
  input: V3ResponseScoringInput,
): V3ScorerResult {
  const scorerId = "v3.response.fact-derivation" as const;
  try {
    if (input.response.facts.length === 0) {
      return input.response.status === "unavailable" ||
        input.response.status === "clarification-required"
        ? notApplicable(scorerId, "response_has_no_facts")
        : fail(scorerId, ["complete_or_partial_response_has_no_facts"]);
    }
    const checked = checkFactGraph(input);
    const responseFactIds = input.response.facts.map(({ factId }) => factId);
    const provenanceFactIds = input.response.provenance.factIds;
    const problems = [...checked.problems];
    if (!equalStringSets(responseFactIds, provenanceFactIds)) {
      problems.push("response_fact_provenance_mismatch");
    }
    return problems.length === 0
      ? pass(scorerId, "fact_signatures_and_ancestry_verified")
      : fail(scorerId, problems);
  } catch {
    return scorerError(scorerId, "fact_derivation_scorer_error");
  }
}

function isNonMaterialConversationalClaim(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .replace(/\{\{[A-Z][A-Z0-9_-]{0,31}\}\}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  return /^(?:here(?:'s| is) what i found:?|əlbəttə[.!]?|buyurun[.!]?|let me know if you want more detail[.!]?)$/iu.test(
    normalized,
  );
}

function commandActionProblems(input: V3ResponseScoringInput): string[] {
  const actions = input.response.actions.filter((action) =>
    action.kind !== "open-in-app" &&
    action.kind !== "open-read-only-view"
  );
  const problems: string[] = [];
  const orderActions = actions.filter((action) =>
    action.kind === "open-signed-order-ticket"
  );
  const unsupportedActions = actions.filter((action) =>
    action.kind !== "open-signed-order-ticket"
  );
  for (const action of unsupportedActions) {
    // No V3 workflow currently owns a reviewed effect manifest for these
    // command shapes. Keep them in the transport union for compatibility, but
    // fail closed until a deterministic authorizer is added.
    problems.push(`command_action_not_authorized:${action.kind}`);
  }
  const orderRoute = input.route.route === "order_ticket_preview";
  if (orderRoute && orderActions.length !== 1) {
    problems.push("order_action_count_invalid");
  }
  if (!orderRoute && orderActions.length > 0) {
    problems.push("order_action_route_invalid");
  }
  if (orderActions.length === 0) return problems;

  const previewFacts = input.response.facts.filter((fact) =>
    fact.kind === "order-ticket.preview" && fact.subject.type === "order-handoff"
  );
  if (previewFacts.length !== 1) {
    problems.push("order_action_preview_fact_count_invalid");
  }

  const now = evaluationTime(input);
  const evidence = new EvidenceFactory({ signer: input.signer });
  for (const action of orderActions) {
    if (action.intentId === null) {
      problems.push("order_action_intent_missing");
      continue;
    }
    const matchingFacts = input.response.facts.filter((fact) =>
      fact.kind === "order-ticket.preview" &&
      fact.subject.type === "order-handoff" &&
      fact.subject.ref === action.intentId
    );
    if (matchingFacts.length !== 1) {
      problems.push("order_action_preview_fact_invalid");
      continue;
    }
    const fact = matchingFacts[0]!;
    if (!evidence.verifyFact(
      fact,
      toolEnvelopes(input),
      input.inputFacts ?? [],
    )) {
      problems.push("order_action_preview_fact_unverified");
      continue;
    }
    const value = recordValue(fact.value);
    const preview = value === null ? null : recordValue(value.preview);
    if (preview === null) {
      problems.push("order_action_preview_value_invalid");
      continue;
    }
    const intentId = preview.intentId;
    const expiresAt = preview.expiresAt;
    const createdAt = preview.createdAt;
    const confirmationLabel = preview.confirmationLabel;
    if (orderRoute) {
      if (input.requestMessage === undefined) {
        problems.push("order_action_request_message_missing");
      } else if (input.route.symbols.length !== 1) {
        problems.push("order_action_request_symbol_scope_invalid");
      } else {
        const reviewedIntent = reviewOrderPreviewIntent(input.requestMessage);
        if (reviewedIntent.status !== "supported") {
          problems.push("order_action_request_semantics_unsupported");
        } else if (
          preview.side !== reviewedIntent.side ||
          preview.requestedNotional !== reviewedIntent.requestedNotional ||
          preview.symbol !== input.route.symbols[0]
        ) {
          problems.push("order_action_request_semantics_mismatch");
        }
      }
    }
    const createdAtMs = typeof createdAt === "string" ? parseTimestamp(createdAt) : null;
    const expiresAtMs = typeof expiresAt === "string" ? parseTimestamp(expiresAt) : null;
    if (
      typeof intentId !== "string" ||
      intentId !== action.intentId ||
      typeof confirmationLabel !== "string" ||
      confirmationLabel.trim().length === 0 ||
      createdAtMs === null ||
      expiresAtMs === null ||
      createdAtMs > now + DEFAULT_FUTURE_CLOCK_SKEW_MS ||
      expiresAtMs <= now ||
      expiresAtMs <= createdAtMs ||
      expiresAtMs - createdAtMs > 5 * 60_000
    ) {
      problems.push("order_action_preview_binding_invalid");
      continue;
    }
    const expectedAction = {
      actionId: `confirm-${intentId}`,
      kind: "open-signed-order-ticket" as const,
      label: confirmationLabel,
      href: null,
      expiresAt,
      intentId,
    };
    if (canonicalHash(action) !== canonicalHash(expectedAction)) {
      problems.push("order_action_signed_preview_mismatch");
    }

    const matchingCards = input.response.cards.filter((card) =>
      card.kind === "order-preview"
    );
    const fee = value?.fee;
    const estimatedQuantity = value?.estimatedQuantity;
    const expectedCard = {
      cardId: `card-order-preview-${intentId}`,
      kind: "order-preview" as const,
      title: input.context.locale === "az-AZ"
        ? "Alış bileti önbaxışı"
        : "Buy ticket preview",
      factRefs: [fact.factId],
      data: {
        ...preview,
        estimatedQuantity,
        fee,
      },
    };
    if (
      matchingCards.length !== 1 ||
      canonicalHash(matchingCards[0]) !== canonicalHash(expectedCard)
    ) {
      problems.push("order_action_preview_card_mismatch");
    }
  }
  return problems;
}

/**
 * Independently reconstructs any fact-bound read-only action from the signed
 * response evidence. The response may select no route, label, URL, or action
 * metadata itself.
 */
export function scoreV3NavigationIntegrity(
  input: V3ResponseScoringInput,
): V3ScorerResult {
  const scorerId = "v3.response.navigation-integrity" as const;
  try {
    const actions = input.response.actions.filter((action) =>
      action.kind === "open-read-only-view"
    );
    const routeEligible = isGovernedReadOnlyNavigationRoute(input.route);
    const featureEnabled =
      input.context.featureSnapshot.flags.readOnlyNavigation === true;
    const shouldProduce =
      routeEligible &&
      featureEnabled &&
      input.response.status === "complete";

    if (!shouldProduce) {
      return actions.length === 0
        ? notApplicable(
            scorerId,
            featureEnabled
              ? "response_route_has_no_read_only_navigation"
              : "read_only_navigation_feature_disabled"
          )
        : fail(scorerId, ["read_only_navigation_action_not_authorized"]);
    }

    const decision = new GovernedReadOnlyNavigationService().evaluate({
      context: input.context,
      route: input.route,
      facts: input.response.facts,
      cards: input.response.cards,
      tools: input.tools.map(({ envelope, arguments: args }) => ({
        envelope,
        arguments: args
      })),
      factBindings: (input.factDisplays ?? []).map(({ alias, factId }) => ({
        alias,
        factId
      })),
      signer: input.signer
    });
    if (decision.status !== "allowed") {
      return fail(scorerId, [
        "read_only_navigation_expected_but_denied",
        ...decision.reasonCodes.map((reason) =>
          `read_only_navigation_denied:${reason}`
        )
      ]);
    }
    const problems: string[] = [];
    if (actions.length !== 1) {
      problems.push("read_only_navigation_action_count_invalid");
    }
    const action = actions[0];
    if (
      action !== undefined &&
      canonicalHash(action) !== canonicalHash(decision.action)
    ) {
      problems.push("read_only_navigation_action_mismatch");
    }
    if (
      action !== undefined &&
      (action.factRefs.length !== 1 ||
        !input.response.provenance.factIds.includes(action.factRefs[0] ?? ""))
    ) {
      problems.push("read_only_navigation_provenance_binding_invalid");
    }
    return problems.length === 0
      ? pass(scorerId, "fact_bound_read_only_navigation_verified")
      : fail(scorerId, problems);
  } catch {
    return scorerError(scorerId, "navigation_integrity_scorer_error");
  }
}

const ACTIVITY_FACT_KIND_BY_ROUTE = {
  recent_trading_activity: "portfolio.recent-trading-activity",
  purchase_history: "portfolio.purchase-history",
} as const;

function validActivityFactValue(
  value: Readonly<Record<string, unknown>>,
  route: "recent_trading_activity" | "purchase_history",
): boolean {
  const records = value.records;
  if (
    value.route !== route ||
    value.limit !== 10 ||
    value.dataClass !== "synthetic" ||
    typeof value.asOf !== "string" ||
    parseTimestamp(value.asOf) === null ||
    !Number.isInteger(value.matchedCount) ||
    !Number.isInteger(value.returnedCount) ||
    (value.matchedCount as number) < 0 ||
    (value.returnedCount as number) < 0 ||
    !Array.isArray(records) ||
    records.length !== value.returnedCount ||
    records.length > 10 ||
    (value.matchedCount as number) < records.length ||
    value.hasMore !== ((value.matchedCount as number) > records.length)
  ) {
    return false;
  }

  const symbol = /^[A-Z]{1,5}(?:\.[A-Z])?$/u;
  let previousTime = Number.POSITIVE_INFINITY;
  for (const candidate of records) {
    const record = recordValue(candidate);
    if (record === null) return false;
    const occurredAt = typeof record.occurredAt === "string"
      ? parseTimestamp(record.occurredAt)
      : null;
    if (
      occurredAt === null ||
      occurredAt > previousTime ||
      typeof record.symbol !== "string" ||
      !symbol.test(record.symbol) ||
      (record.side !== "BUY" && record.side !== "SELL")
    ) {
      return false;
    }
    previousTime = occurredAt;
    if (record.recordType === "execution") {
      if (
        record.positionEffect !== "EXECUTED_TRADE" ||
        (route === "purchase_history" && record.side !== "BUY")
      ) {
        return false;
      }
      continue;
    }
    if (
      record.recordType !== "order" ||
      record.positionEffect !== "ORDER_STATE_ONLY" ||
      route === "purchase_history"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Activity is a private-data projection, so the display card is authorized
 * from one signed projection fact rather than trusted as an independent JSON
 * payload. Canonical comparison binds every record discriminator and field.
 */
function activityCardProblems(input: V3ResponseScoringInput): string[] {
  const cards = input.response.cards.filter((card) => card.kind === "activity");
  const route = input.route.route;
  if (route !== "recent_trading_activity" && route !== "purchase_history") {
    return cards.length === 0 ? [] : ["activity_card_route_invalid"];
  }
  const activityRoute = route;
  const expectedFactKind = ACTIVITY_FACT_KIND_BY_ROUTE[activityRoute];

  const problems: string[] = [];
  if (cards.length !== 1) problems.push("activity_card_count_invalid");
  const activityFacts = input.response.facts.filter((fact) =>
    fact.kind === "portfolio.recent-trading-activity" ||
    fact.kind === "portfolio.purchase-history"
  );
  if (activityFacts.length !== 1) {
    problems.push("activity_card_fact_count_invalid");
    return problems;
  }
  const fact = activityFacts[0]!;
  const value = recordValue(fact.value);
  const evidence = new EvidenceFactory({ signer: input.signer });
  if (
    fact.kind !== expectedFactKind ||
    value === null ||
    !validActivityFactValue(value, activityRoute) ||
    !evidence.verifyFact(fact, toolEnvelopes(input), input.inputFacts ?? [])
  ) {
    problems.push("activity_card_fact_invalid");
    return problems;
  }
  if (cards.length !== 1) return problems;
  const expectedCard = {
    cardId: `card-${fact.factId}`,
    kind: "activity" as const,
    title: activityRoute === "purchase_history"
      ? input.context.locale === "az-AZ" ? "Alış tarixçəsi" : "Purchase history"
      : input.context.locale === "az-AZ" ? "Son ticarət qeydləri" : "Recent trading activity",
    factRefs: [fact.factId],
    data: fact.value,
  };
  if (canonicalHash(cards[0]) !== canonicalHash(expectedCard)) {
    problems.push("activity_card_signed_fact_mismatch");
  }
  return problems;
}

interface ClaimMaterialRoleRule {
  readonly code: string;
  readonly pattern: RegExp;
  readonly roles: readonly RenderableSemanticRole[];
}

/*
 * This scorer intentionally owns a second material-term vocabulary instead of
 * trusting the renderer's earlier semantic check. The renderer is the first
 * boundary; this independent P0 scorer verifies the already-signed projection
 * and then rebinds English and Azerbaijani labels to their local placeholders.
 */
const CLAIM_MATERIAL_ROLE_RULES: readonly ClaimMaterialRoleRule[] = [
  {
    code: "instrument_identity",
    pattern:
      /\b(?:company|instrument|security|ticker|name)\b|(?<!\p{L})(?:şirkət\p{L}{0,6}|alət\p{L}{0,6}|tiker\p{L}{0,6}|ad)(?!\p{L})/iu,
    roles: ["instrument.identity"]
  },
  {
    code: "instrument_type",
    pattern:
      /\b(?:stock|share|fund|etf|bond)\b|(?<!\p{L})(?:səhm\p{L}{0,8}|fond\p{L}{0,8}|etf|istiqraz\p{L}{0,8})(?!\p{L})/iu,
    roles: ["instrument.type"]
  },
  {
    code: "instrument_listing",
    pattern:
      /\b(?:listing|listed|exchange)\b|(?<!\p{L})(?:listinq\p{L}{0,8}|siyahıya\s+alınıb|birja\p{L}{0,8})(?!\p{L})/iu,
    roles: ["instrument.listing"]
  },
  {
    code: "instrument_currency",
    pattern:
      /\bcurrency\b|(?<!\p{L})valyuta\p{L}{0,8}(?!\p{L})/iu,
    roles: ["instrument.currency", "portfolio.fx"]
  },
  {
    code: "market_price",
    pattern:
      /\b(?:price(?!\s+(?:move|change|return))|quote|trading\s+price)\b|(?<!\p{L})(?:qiym[əe]t(?:i|in|inin|iniz|inizin|imiz|imizin|l[əe]ri|l[əe]rinin|-?(?:d[ıi]r|dir|dur|d[üu]r))?(?!\s+d[əe]yi[şs])|kotirovka\p{L}{0,8}|ticar[əe]t\s+qiym[əe]ti\p{L}{0,8})(?!\p{L})/iu,
    roles: ["market.price", "market.close", "portfolio.cost"]
  },
  {
    code: "market_close",
    pattern:
      /\b(?:latest\s+close|closing\s+price)\b|(?<!\p{L})(?:son\s+ba[ğg]lan[ıi][şs]|ba[ğg]lan[ıi][şs]\s+qiym[əe]ti\p{L}{0,8})(?!\p{L})/iu,
    roles: ["market.close"]
  },
  {
    code: "market_state",
    pattern:
      /\b(?:market\s+(?:state|open|closed)|market\s+is)\b|(?<!\p{L})(?:bazar[ıi]n?\s+v[əe]ziyy[əe]ti|bazar\s+(?:a[cç][ıi]q|ba[ğg]l[ıi]))(?!\p{L})/iu,
    roles: ["market.state"]
  },
  {
    code: "market_change",
    pattern:
      /\b(?:change|move|previous\s+close)\b|(?<!\p{L})(?:d[əe]yi[şs](?:iklik\p{L}{0,6}|m[əe]\p{L}{0,6}|ib|ir)?|h[əe]r[əe]k[əe]t\p{L}{0,6}|[əe]vv[əe]lki\s+ba[ğg]lan[ıi][şs]\p{L}{0,6})(?!\p{L})/iu,
    roles: [
      "market.change",
      "portfolio.mover",
      "portfolio.contribution",
      "portfolio.pnl"
    ]
  },
  {
    code: "market_context",
    pattern:
      /\b(?:headline|news|market\s+context|possible\s+context)\b|(?<!\p{L})(?:ba[şs]l[ıi]q\p{L}{0,8}|x[əe]b[əe]r\p{L}{0,8}|bazar\s+konteksti\p{L}{0,8}|m[üu]mk[üu]n\s+kontekst\p{L}{0,8})(?!\p{L})/iu,
    roles: ["market.context"]
  },
  {
    code: "source_identity",
    pattern:
      /\b(?:source|provider|evidence)\b|(?<!\p{L})(?:m[əe]nb[əe]\p{L}{0,8}|provayder\p{L}{0,8}|s[üu]but\p{L}{0,8})(?!\p{L})/iu,
    roles: ["source.identity", "source.limitation"]
  },
  {
    code: "source_time",
    pattern:
      /\b(?:as\s+of|observation\s+time|timestamp|date|time)\b|(?<!\p{L})(?:tarix\p{L}{0,8}|vaxt\p{L}{0,8}|m[üu][şs]ahid[əe]\s+vaxt[ıi]\p{L}{0,8})(?!\p{L})/iu,
    roles: ["source.time"]
  },
  {
    code: "source_freshness",
    pattern:
      /\bfreshness\b|(?<!\p{L})t[əe]z[əe]lik\p{L}{0,8}(?!\p{L})/iu,
    roles: ["source.freshness"]
  },
  {
    code: "source_limitation",
    pattern:
      /\b(?:causality|causal\s+link|evidence\s+limit(?:ation)?)\b|(?<!\p{L})(?:s[əe]b[əe]b\s+[əe]laq[əe]si\p{L}{0,8}|s[üu]but\s+m[əe]hdudiyy[əe]ti\p{L}{0,8})(?!\p{L})/iu,
    roles: ["source.limitation"]
  },
  {
    code: "valuation_market_cap",
    pattern:
      /\b(?:capitalization|market\s+cap)\b|(?<!\p{L})bazar\s+kapitalla[şs]mas[ıi]\p{L}{0,8}(?!\p{L})/iu,
    roles: ["valuation.market_cap"]
  },
  {
    code: "valuation_pe",
    pattern:
      /\b(?:p\/?e|price-to-earnings)\b|(?<!\p{L})qiym[əe]t-g[əe]lir\s+nisb[əe]ti\p{L}{0,8}(?!\p{L})/iu,
    roles: ["valuation.pe"]
  },
  {
    code: "fundamental_earnings",
    pattern:
      /\bearnings\b|(?<!\p{L})(?:şirk[əe]t\s+m[əe]nf[əe][əe]ti\p{L}{0,8}|s[əe]hm[əe]\s+d[üu]ş[əe]n\s+g[əe]lir\p{L}{0,8})(?!\p{L})/iu,
    roles: ["fundamental.earnings"]
  },
  {
    code: "fundamental_dividend",
    pattern:
      /\bdividend\b(?!\s+yield)/iu,
    roles: ["fundamental.dividend_amount"]
  },
  {
    code: "fundamental_yield",
    pattern:
      /\b(?:dividend\s+yield|distribution\s+yield|yield)\b|(?<!\p{L})(?:(?:dividend|paylanma)\s+g[əe]lirlili(?:k|y)\p{L}{0,8}|g[əe]lirlilik\p{L}{0,8})(?!\p{L})/iu,
    roles: ["fundamental.dividend_yield"]
  },
  {
    code: "fundamental_revenue",
    pattern:
      /\brevenue\b|(?<!\p{L})(?:sat[ıi][şs]\s+g[əe]liri\p{L}{0,8}|[üu]mumi\s+g[əe]lir\p{L}{0,8})(?!\p{L})/iu,
    roles: ["fundamental.revenue"]
  },
  {
    code: "income",
    pattern:
      /\bincome\b|(?<!\p{L})xalis\s+g[əe]lir\p{L}{0,8}(?!\p{L})/iu,
    roles: ["fundamental.income", "portfolio.income"]
  },
  {
    code: "fundamental_margin",
    pattern:
      /\bmargin\b|(?<!\p{L})marja\p{L}{0,8}(?!\p{L})/iu,
    roles: ["fundamental.margin"]
  },
  {
    code: "fundamental_roe",
    pattern:
      /\b(?:roe|return\s+on\s+equity)\b|(?<!\p{L})(?:kapital\s+g[əe]lirliliyi\p{L}{0,8}|roe)(?!\p{L})/iu,
    roles: ["fundamental.roe"]
  },
  {
    code: "analyst_rating",
    pattern:
      /\b(?:analyst(?:\s+(?:rating|consensus))?|rating|consensus)\b|(?<!\p{L})(?:analitik(?:\s+(?:reytinq|konsensus)\p{L}{0,8})?|reytinq\p{L}{0,8}|konsensus\p{L}{0,8})(?!\p{L})/iu,
    roles: ["analyst.rating"]
  },
  {
    code: "analyst_target",
    pattern:
      /\btarget\b|(?<!\p{L})h[əe]d[əe]f\p{L}{0,8}(?!\p{L})/iu,
    roles: ["analyst.target"]
  },
  {
    code: "risk_generic",
    pattern:
      /\brisk\b|(?<!\p{L})risk\p{L}{0,8}(?!\p{L})/iu,
    roles: [
      "risk.generic",
      "risk.volatility",
      "risk.drawdown",
      "risk.downside",
      "risk.duration",
      "risk.maturity",
      "risk.concentration",
      "risk.credit"
    ]
  },
  {
    code: "risk_volatility",
    pattern:
      /\bvolatility\b|(?<!\p{L})(?:d[əe]yi[şs]k[əe]nlik\p{L}{0,8}|volatillik\p{L}{0,8})(?!\p{L})/iu,
    roles: ["risk.volatility"]
  },
  {
    code: "risk_drawdown",
    pattern:
      /\bdrawdown\b|(?<!\p{L})(?:geril[əe]m[əe]\p{L}{0,8}|maksimum\s+eni[şs]\p{L}{0,8})(?!\p{L})/iu,
    roles: ["risk.drawdown"]
  },
  {
    code: "risk_downside",
    pattern:
      /\bdownside\b|(?<!\p{L})(?:a[şs]a[ğg][ıi]\s+y[öo]nl[üu]\s+risk\p{L}{0,8}|enm[əe]\s+riski\p{L}{0,8})(?!\p{L})/iu,
    roles: ["risk.downside"]
  },
  {
    code: "risk_duration",
    pattern:
      /\bduration\b|(?<!\p{L})d[üu]rasiya\p{L}{0,8}(?!\p{L})/iu,
    roles: ["risk.duration"]
  },
  {
    code: "risk_maturity",
    pattern:
      /\bmaturity\b|(?<!\p{L})(?:[öo]d[əe]m[əe]\s+m[üu]dd[əe]ti\p{L}{0,8}|m[üu]dd[əe]tin\s+sonu\p{L}{0,8})(?!\p{L})/iu,
    roles: ["risk.maturity"]
  },
  {
    code: "risk_concentration",
    pattern:
      /\bconcentration\b|(?<!\p{L})konsentrasiya\p{L}{0,8}(?!\p{L})/iu,
    roles: ["risk.concentration"]
  },
  {
    code: "risk_credit",
    pattern:
      /\bcredit\b|(?<!\p{L})kredit\p{L}{0,8}(?!\p{L})/iu,
    roles: ["risk.credit"]
  },
  {
    code: "portfolio_identity",
    pattern:
      /\bportfolio\b|(?<!\p{L})portfel\p{L}{0,8}(?!\p{L})/iu,
    roles: [
      "portfolio.identity",
      "portfolio.holding_value",
      "portfolio.cash",
      "portfolio.balance",
      "portfolio.allocation",
      "portfolio.return",
      "portfolio.pnl"
    ]
  },
  {
    code: "portfolio_holding",
    pattern:
      /\b(?:holding|position)\b|(?<!\p{L})m[öo]vqe\p{L}{0,8}(?!\p{L})/iu,
    roles: ["portfolio.identity", "portfolio.holding_value"]
  },
  {
    code: "portfolio_cash",
    pattern:
      /\bcash\b(?!-flow)|(?<!\p{L})(?:na[ğg]d\p{L}{0,8}|v[əe]sait\p{L}{0,8})(?!\p{L})/iu,
    roles: ["portfolio.cash", "portfolio.allocation"]
  },
  {
    code: "portfolio_cost",
    pattern:
      /\bcost\b|(?<!\p{L})maya\s+d[əe]y[əe]ri\p{L}{0,8}(?!\p{L})/iu,
    roles: ["portfolio.cost"]
  },
  {
    code: "portfolio_balance",
    pattern:
      /\bbalance\b|(?<!\p{L})balans\p{L}{0,8}(?!\p{L})/iu,
    roles: ["portfolio.balance"]
  },
  {
    code: "portfolio_allocation",
    pattern:
      /\ballocation\b|(?<!\p{L})b[öo]lg[üu]\p{L}{0,8}(?!\p{L})/iu,
    roles: ["portfolio.allocation"]
  },
  {
    code: "portfolio_sector",
    pattern:
      /\bsector\b|(?<!\p{L})sektor\p{L}{0,8}(?!\p{L})/iu,
    roles: ["portfolio.sector"]
  },
  {
    code: "portfolio_return",
    pattern:
      /\b(?:performance|return)\b|(?<!\p{L})performans\p{L}{0,8}(?!\p{L})/iu,
    roles: ["portfolio.return", "market.change"]
  },
  {
    code: "az_gelir",
    pattern:
      /(?<!dividend )(?<!paylanma )(?<!\p{L})g[əe]lir\p{L}{0,8}(?!\p{L})/iu,
    roles: [
      "portfolio.return",
      "market.change",
      "portfolio.income",
      "portfolio.pnl",
      "fundamental.income",
      "fundamental.revenue",
      "fundamental.earnings",
      "fundamental.dividend_yield"
    ]
  },
  {
    code: "portfolio_contribution",
    pattern:
      /\bcontribution\b|(?<!\p{L})t[öo]hf[əe]\p{L}{0,8}(?!\p{L})/iu,
    roles: [
      "portfolio.identity",
      "portfolio.contribution"
    ]
  },
  {
    code: "portfolio_mover",
    pattern:
      /\bmover\b|(?<!\p{L})(?:[əe]n\s+[cç]ox\s+d[əe]yi[şs][əe]n\p{L}{0,8})(?!\p{L})/iu,
    roles: ["portfolio.mover"]
  },
  {
    code: "portfolio_pnl",
    pattern:
      /\b(?:profit|loss|net\s+result|p\s*&\s*l)\b|(?<!\p{L})(?:qazanc\p{L}{0,8}|z[əe]r[əe]r\p{L}{0,8}|xalis\s+n[əe]tic[əe]\p{L}{0,8})(?!\p{L})/iu,
    roles: ["portfolio.pnl"]
  },
  {
    code: "knowledge_fee",
    pattern:
      /\bfees?\b|(?<!\p{L})haqq\p{L}{0,8}(?!\p{L})/iu,
    roles: ["portfolio.fees", "portfolio.cost", "knowledge.fee"]
  },
  {
    code: "knowledge_commission",
    pattern:
      /\bcommission\b|(?<!\p{L})komissiya\p{L}{0,8}(?!\p{L})/iu,
    roles: ["portfolio.cost", "portfolio.fees", "knowledge.commission"]
  },
  {
    code: "knowledge_tariff",
    pattern:
      /\btariff\b|(?<!\p{L})tarif\p{L}{0,8}(?!\p{L})/iu,
    roles: ["knowledge.tariff"]
  },
  {
    code: "knowledge_policy",
    pattern:
      /\bpolicy\b|(?<!\p{L})siyas[əe]t\p{L}{0,8}(?!\p{L})/iu,
    roles: ["knowledge.policy"]
  },
  {
    code: "knowledge_disclosure",
    pattern:
      /\bdisclosure\b|(?<!\p{L})a[cç][ıi]qlama\p{L}{0,8}(?!\p{L})/iu,
    roles: ["knowledge.disclosure"]
  },
  {
    code: "knowledge_support",
    pattern:
      /\bsupport\b|(?<!\p{L})d[əe]st[əe]k\p{L}{0,8}(?!\p{L})/iu,
    roles: ["knowledge.support"]
  },
  {
    code: "knowledge_product",
    pattern:
      /\bproduct\b|(?<!\p{L})m[əe]hsul\p{L}{0,8}(?!\p{L})/iu,
    roles: ["knowledge.product"]
  },
  {
    code: "knowledge_education",
    pattern:
      /\b(?:education|concept|principle|key\s+point)\b|(?<!\p{L})(?:t[əe]hsil|anlay[ıi][şs]|prinsip|[əe]sas\s+m[əe]qam)\p{L}{0,8}(?!\p{L})/iu,
    roles: ["knowledge.education"]
  },
  {
    code: "activity",
    pattern:
      /\b(?:transaction|activity|trade)\b|(?<!\p{L})(?:[əe]m[əe]liyyat\p{L}{0,8}|aktivlik\p{L}{0,8}|ticar[əe]t\s+(?:aktivliyi|[əe]m[əe]liyyat[ıi]))(?!\p{L})/iu,
    roles: ["activity.summary", "activity.record", "activity.coverage"]
  }
] as const;

const CLAIM_PLACEHOLDER = /\{\{([A-Z][A-Z0-9_-]{0,31})\}\}/gu;
const APPROVED_RENDERABLE_ROLES = new Set<string>(RENDERABLE_SEMANTIC_ROLES);
const LOCAL_SEMANTIC_BOUNDARY =
  /[,;.!?]|\b(?:and|but|while|whereas|however)\b|(?<!\p{L})(?:v[əe]|amma|lakin|halbuki)(?!\p{L})/iu;
const LOCAL_NEXT_CONNECTOR =
  /^\s*(?::|(?:is|are|was|were|equals?|at|on|of|for|to|is[əe]|-?(?:d[ıi]r|dir|dur|d[üu]r))\b)/iu;
const LOCAL_PREVIOUS_COPULA =
  /\b(?:is|are|was|were|equals?)\b[^,;.!?]*$|(?<!\p{L})(?:d[ıi]r|dir|dur|d[üu]r|is[əe])\p{L}*[^,;.!?]*$/iu;
const CAPITALIZED_COST_QUALIFIER =
  /\b(?:capitalized\s+buy\s+fees?|fees?\s+capitalized\s+into\s+cost)\b|(?<!\p{L})kapitalla[şs]d[ıi]r[ıi]lm[ıi][şs]\s+al[ıi][şs]\s+komissiyas[ıi]\p{L}{0,8}(?!\p{L})/iu;

function allMaterialTermMatches(
  shell: string,
  rule: ClaimMaterialRoleRule
): readonly RegExpExecArray[] {
  const pattern = new RegExp(
    rule.pattern.source,
    `${rule.pattern.flags.replaceAll("g", "")}g`
  );
  return [...shell.matchAll(pattern)];
}

function locallyBoundAliases(input: {
  shell: string;
  matchIndex: number;
  matchLength: number;
  previousAlias: string | null;
  nextAlias: string | null;
}): readonly string[] {
  const { previousAlias, nextAlias } = input;
  if (previousAlias === null) return nextAlias === null ? [] : [nextAlias];
  if (nextAlias === null) return [previousAlias];

  const before = input.shell.slice(0, input.matchIndex);
  const after = input.shell.slice(input.matchIndex + input.matchLength);
  if (LOCAL_NEXT_CONNECTOR.test(after)) return [nextAlias];
  if (LOCAL_PREVIOUS_COPULA.test(before)) return [previousAlias];

  const boundaryBefore = LOCAL_SEMANTIC_BOUNDARY.test(before);
  const boundaryAfter = LOCAL_SEMANTIC_BOUNDARY.test(after);
  if (boundaryBefore && !boundaryAfter) return [nextAlias];
  if (boundaryAfter && !boundaryBefore) return [previousAlias];

  const distanceFromPrevious = input.matchIndex;
  const distanceFromNext =
    input.shell.length - (input.matchIndex + input.matchLength);
  if (distanceFromPrevious < distanceFromNext) return [previousAlias];
  if (distanceFromNext < distanceFromPrevious) return [nextAlias];
  // Ambiguous text must be authorized by both adjacent signed projections.
  return [previousAlias, nextAlias];
}

function claimSemanticRoleProblems(input: V3ResponseScoringInput): string[] {
  const problems: string[] = [];
  const factsById = new Map(
    input.response.facts.map((fact) => [fact.factId, fact])
  );
  const displaysByAlias = new Map<string, V3SignedFactDisplay[]>();
  for (const display of input.factDisplays ?? []) {
    const current = displaysByAlias.get(display.alias) ?? [];
    current.push(display);
    displaysByAlias.set(display.alias, current);
  }
  const projectionEvidence = new EvidenceFactory({ signer: input.signer });

  for (const claim of input.response.claims) {
    const aliases = [...claim.textTemplate.matchAll(CLAIM_PLACEHOLDER)]
      .map((match) => match[1])
      .filter((alias): alias is string => alias !== undefined);
    const claimFactIds = new Set(claim.factRefs);
    const verifiedBindings = new Map<string, V3SignedFactDisplay>();

    for (const alias of new Set(aliases)) {
      const candidates = displaysByAlias.get(alias);
      if (candidates === undefined) continue;
      if (candidates.length !== 1) {
        problems.push(
          `claim_semantic_projection_ambiguous:${claim.claimId}:${alias}`
        );
        continue;
      }
      const display = candidates[0]!;
      const fact = factsById.get(display.factId);
      const rolesAreValid =
        new Set(display.semanticRoles).size === display.semanticRoles.length &&
        display.semanticRoles.every((role) => APPROVED_RENDERABLE_ROLES.has(role));
      const projection = fact === undefined
        ? null
        : {
            alias: display.alias,
            fact,
            display: display.display,
            meaning: display.meaning,
            required: display.required,
            semanticRoles: display.semanticRoles,
            ...(display.requiredCitationAlias === undefined
              ? {}
              : { requiredCitationAlias: display.requiredCitationAlias }),
            projectionIntegrity: display.projectionIntegrity
          } satisfies RenderableFact;
      if (
        fact === undefined ||
        projection === null ||
        !claimFactIds.has(display.factId) ||
        !rolesAreValid ||
        !projectionEvidence.verifyProjection(
          renderableFactProjectionPayload(projection),
          display.projectionIntegrity
        )
      ) {
        problems.push(
          `claim_semantic_projection_invalid:${claim.claimId}:${alias}`
        );
        continue;
      }
      verifiedBindings.set(alias, display);
    }

    for (const factId of claim.factRefs) {
      const bound = [...verifiedBindings.values()].some(
        (display) => display.factId === factId
      );
      if (!bound) {
        problems.push(
          `claim_semantic_projection_missing:${claim.claimId}:${factId}`
        );
      }
    }

    const pieces = claim.textTemplate.split(
      /(\{\{[A-Z][A-Z0-9_-]{0,31}\}\})/gu
    );
    const aliasAt = (index: number, direction: -1 | 1): string | null => {
      for (
        let cursor = index + direction;
        cursor >= 0 && cursor < pieces.length;
        cursor += direction
      ) {
        const match = pieces[cursor]?.match(
          /^\{\{([A-Z][A-Z0-9_-]{0,31})\}\}$/u
        );
        const alias = match?.[1];
        if (alias !== undefined && verifiedBindings.has(alias)) return alias;
      }
      return null;
    };

    for (let index = 0; index < pieces.length; index += 2) {
      const shell = pieces[index] ?? "";
      if (!shell.trim()) continue;
      const previousAlias = aliasAt(index, -1);
      const nextAlias = aliasAt(index, 1);
      for (const rule of CLAIM_MATERIAL_ROLE_RULES) {
        for (const match of allMaterialTermMatches(shell, rule)) {
          const boundAliases = locallyBoundAliases({
            shell,
            matchIndex: match.index,
            matchLength: match[0].length,
            previousAlias,
            nextAlias
          });
          if (boundAliases.length === 0) {
            problems.push(
              `claim_semantic_role_unbound:${claim.claimId}:${rule.code}`
            );
            continue;
          }
          for (const alias of boundAliases) {
            const roles = verifiedBindings.get(alias)?.semanticRoles ?? [];
            const supportedByBoundProjection = rule.roles.some((role) =>
              roles.includes(role)
            );
            const supportedCapitalizedCostQualifier =
              (rule.code === "knowledge_fee" ||
                rule.code === "knowledge_commission") &&
              CAPITALIZED_COST_QUALIFIER.test(shell) &&
              [...verifiedBindings.values()].some((display) =>
                display.semanticRoles.includes("portfolio.cost")
              );
            if (
              !supportedByBoundProjection &&
              !supportedCapitalizedCostQualifier
            ) {
              problems.push(
                `claim_semantic_role_binding_invalid:${claim.claimId}:${alias}:${rule.code}`
              );
            }
          }
        }
      }
    }
  }
  return [...new Set(problems)];
}

export function scoreV3MaterialClaimLineage(
  input: V3ResponseScoringInput,
): V3ScorerResult {
  const scorerId = "v3.response.material-claim-lineage" as const;
  try {
    const { response } = input;
    const actionProblems = [
      ...commandActionProblems(input),
      ...activityCardProblems(input),
      ...claimSemanticRoleProblems(input),
    ];
    if (response.claims.length === 0) {
      if (actionProblems.length > 0) return fail(scorerId, actionProblems);
      return response.status === "unavailable" ||
        response.status === "clarification-required"
        ? notApplicable(scorerId, "no_material_claims_for_response_status")
        : fail(scorerId, ["material_claims_missing"]);
    }
    const factIds = response.facts.map(({ factId }) => factId);
    const citationIds = response.citations.map(({ citationId }) => citationId);
    const claimIds = response.claims.map(({ claimId }) => claimId);
    const cardIds = response.cards.map(({ cardId }) => cardId);
    const actionIds = response.actions.map(({ actionId }) => actionId);
    const problems: string[] = [...actionProblems];
    if (!uniqueStrings(factIds)) problems.push("duplicate_response_fact_id");
    if (!uniqueStrings(citationIds)) problems.push("duplicate_response_citation_id");
    if (!uniqueStrings(claimIds)) problems.push("duplicate_claim_id");
    if (!uniqueStrings(cardIds)) problems.push("duplicate_card_id");
    if (!uniqueStrings(actionIds)) problems.push("duplicate_action_id");
    if (
      response.requestId !== input.context.requestId ||
      response.conversationId !== input.context.conversationId
    ) {
      problems.push("response_context_mismatch");
    }

    const referencedFacts = new Set<string>();
    const referencedCitations = new Set<string>();
    for (const claim of response.claims) {
      if (!claim.claimId || !claim.textTemplate.trim() || claim.locale !== input.context.locale) {
        problems.push(`claim_shape_or_locale_invalid:${claim.claimId || "missing"}`);
      }
      if (!uniqueStrings(claim.factRefs) || !uniqueStrings(claim.citationRefs)) {
        problems.push(`claim_references_duplicate:${claim.claimId}`);
      }
      for (const factId of claim.factRefs) {
        referencedFacts.add(factId);
        if (!factIds.includes(factId)) {
          problems.push(`claim_fact_missing:${claim.claimId}:${factId}`);
        }
      }
      for (const citationId of claim.citationRefs) {
        referencedCitations.add(citationId);
        if (!citationIds.includes(citationId)) {
          problems.push(`claim_citation_missing:${claim.claimId}:${citationId}`);
        }
      }
      const material = !isNonMaterialConversationalClaim(claim.textTemplate);
      if (
        material &&
        claim.factRefs.length === 0 &&
        claim.citationRefs.length === 0 &&
        response.status !== "unavailable" &&
        response.status !== "clarification-required"
      ) {
        problems.push(`material_claim_ungrounded:${claim.claimId}`);
      }
      if (
        material &&
        input.route.route !== null &&
        CITATION_REQUIRED_ROUTES.has(input.route.route) &&
        claim.citationRefs.length === 0
      ) {
        problems.push(`material_claim_citation_missing:${claim.claimId}`);
      }
    }

    for (const card of response.cards) {
      if (!uniqueStrings(card.factRefs)) {
        problems.push(`card_fact_references_duplicate:${card.cardId}`);
      }
      for (const factId of card.factRefs) {
        referencedFacts.add(factId);
        if (!factIds.includes(factId)) {
          problems.push(`card_fact_missing:${card.cardId}:${factId}`);
        }
      }
    }
    for (const citationId of citationIds) {
      if (!referencedCitations.has(citationId)) {
        problems.push(`orphan_citation:${citationId}`);
      }
    }
    for (const factId of factIds) {
      if (!referencedFacts.has(factId)) problems.push(`orphan_fact:${factId}`);
    }
    if (!equalStringSets(factIds, response.provenance.factIds)) {
      problems.push("claim_response_fact_lineage_mismatch");
    }
    return problems.length === 0
      ? pass(scorerId, "material_claim_lineage_complete")
      : fail(scorerId, problems);
  } catch {
    return scorerError(scorerId, "material_claim_lineage_scorer_error");
  }
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedHash(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/^sha256:/u, "");
}

function citationMatchesKnowledgeFact(
  citation: AssistantCitation,
  fact: FactEnvelope<unknown>,
  input: V3ResponseScoringInput,
): boolean {
  if (fact.kind !== "approved-knowledge.evidence") return false;
  const value = recordValue(fact.value);
  if (value === null) return false;
  const sourceId = value.sourceId;
  const version = value.version;
  const effectiveTo = value.effectiveTo;
  if (
    typeof sourceId !== "string" ||
    typeof version !== "string" ||
    typeof value.title !== "string" ||
    typeof value.url !== "string" ||
    typeof value.contentAsOf !== "string" ||
    typeof value.effectiveFrom !== "string" ||
    (effectiveTo !== null && typeof effectiveTo !== "string") ||
    typeof value.chunkChecksumSha256 !== "string" ||
    typeof value.text !== "string" ||
    value.locale !== input.context.locale ||
    value.jurisdiction !== input.context.jurisdiction ||
    !fact.quality.flags.includes("APPROVED")
  ) {
    return false;
  }
  if (
    createHash("sha256").update(value.text, "utf8").digest("hex") !==
    normalizedHash(value.chunkChecksumSha256)
  ) {
    return false;
  }
  const evidence = new EvidenceFactory({ signer: input.signer });
  return (
    evidence.verifyFact(
      fact,
      toolEnvelopes(input),
      input.inputFacts ?? [],
    ) &&
    citation.sourceId === `${sourceId}@${version}` &&
    citation.title === value.title &&
    citation.url === value.url &&
    citation.sourceAsOf === value.contentAsOf &&
    citation.effectiveFrom === value.effectiveFrom &&
    citation.effectiveTo === effectiveTo &&
    normalizedHash(citation.contentHash) ===
      normalizedHash(value.chunkChecksumSha256)
  );
}

function citationMatchesEducationFact(
  citation: AssistantCitation,
  fact: FactEnvelope<unknown>,
  input: V3ResponseScoringInput,
): boolean {
  if (fact.kind !== "education.approved-retrieval") return false;
  const value = recordValue(fact.value);
  if (
    value?.schemaVersion !== "assistant-v3.financial-education-retrieval.v1" ||
    value.status !== "grounded" ||
    value.locale !== input.context.locale ||
    !Array.isArray(value.propositions) ||
    !Array.isArray(value.citations)
  ) {
    return false;
  }
  const source = value.citations.find((candidate) =>
    recordValue(candidate)?.citationId === citation.citationId
  );
  const sourceRecord = recordValue(source);
  if (
    sourceRecord === null ||
    typeof sourceRecord.sourceId !== "string" ||
    typeof sourceRecord.version !== "string" ||
    typeof sourceRecord.title !== "string" ||
    typeof sourceRecord.sourceUrl !== "string" ||
    typeof sourceRecord.reviewedAt !== "string" ||
    typeof sourceRecord.effectiveFrom !== "string" ||
    (
      sourceRecord.effectiveTo !== null &&
      typeof sourceRecord.effectiveTo !== "string"
    ) ||
    typeof sourceRecord.contentSha256 !== "string" ||
    typeof sourceRecord.propositionId !== "string" ||
    typeof sourceRecord.excerpt !== "string" ||
    sourceRecord.locale !== input.context.locale ||
    sourceRecord.jurisdiction !== "AZ"
  ) {
    return false;
  }
  const proposition = value.propositions.find((candidate) => {
    const record = recordValue(candidate);
    return record?.citationId === citation.citationId &&
      record.propositionId === sourceRecord.propositionId &&
      record.text === sourceRecord.excerpt &&
      record.sourceId === sourceRecord.sourceId &&
      record.sourceVersion === sourceRecord.version;
  });
  if (proposition === undefined) return false;
  const evidence = new EvidenceFactory({ signer: input.signer });
  return (
    evidence.verifyFact(
      fact,
      toolEnvelopes(input),
      input.inputFacts ?? [],
    ) &&
    citation.sourceId ===
      `${sourceRecord.sourceId}@${sourceRecord.version}` &&
    citation.title === sourceRecord.title &&
    citation.url === sourceRecord.sourceUrl &&
    citation.sourceAsOf === sourceRecord.reviewedAt &&
    citation.effectiveFrom === sourceRecord.effectiveFrom &&
    citation.effectiveTo === sourceRecord.effectiveTo &&
    normalizedHash(citation.contentHash) ===
      normalizedHash(sourceRecord.contentSha256)
  );
}

function citationMatchesTool(
  citation: AssistantCitation,
  tool: ToolExecutionEnvelope<unknown>,
  signer: DevHmacSigner,
): boolean {
  if (
    tool.status !== "success" ||
    tool.resultHash === null ||
    tool.source.sourceUrl === null ||
    !verifyEnvelope(tool, signer) ||
    tool.resultHash !== canonicalHash(tool.result)
  ) {
    return false;
  }
  return (
    citation.sourceId === tool.source.sourceId &&
    citation.url === tool.source.sourceUrl &&
    citation.sourceAsOf === tool.source.sourceAsOf &&
    normalizedHash(citation.contentHash) === normalizedHash(tool.resultHash)
  );
}

function governedNavigationActionProblems(input: V3ResponseScoringInput): string[] {
  const actions = input.response.actions.filter((action) => action.kind === "open-in-app");
  if (actions.length === 0) return [];
  const problems: string[] = [];
  if (actions.length !== 1) problems.push("governed_navigation_action_count_invalid");
  if (input.route.route !== "approved_knowledge") {
    problems.push("governed_navigation_route_invalid");
  }
  const navigation = new GovernedInAppNavigationService();
  for (const action of actions) {
    const decision = navigation.evaluate({
      context: input.context,
      target: action.target,
      // Re-evaluate from the response's actual governed citations. No action
      // fields are trusted as service inputs other than the semantic target.
      citationRefs: input.response.citations
    });
    if (decision.status !== "allowed") {
      problems.push(...decision.reasonCodes.map((reason) =>
        `governed_navigation_denied:${reason}`
      ));
      continue;
    }
    // Canonical comparison binds every material action field (catalog version,
    // target, route, label, and citation references) to the independent result.
    if (canonicalHash(action) !== canonicalHash(decision.action)) {
      problems.push("governed_navigation_action_mismatch");
    }
  }
  return problems;
}

export function scoreV3CitationIntegrity(
  input: V3ResponseScoringInput,
): V3ScorerResult {
  const scorerId = "v3.response.citation-integrity" as const;
  try {
    const citationRequired =
      input.route.route !== null && CITATION_REQUIRED_ROUTES.has(input.route.route);
    const navigationProblems = governedNavigationActionProblems(input);
    if (input.response.citations.length === 0) {
      if (navigationProblems.length > 0) {
        return fail(scorerId, ["governed_navigation_citations_missing", ...navigationProblems]);
      }
      return citationRequired &&
        (input.response.status === "complete" || input.response.status === "partial")
        ? fail(scorerId, ["required_citations_missing"])
        : notApplicable(scorerId, "response_has_no_citations");
    }
    const now = evaluationTime(input);
    const citationIds = input.response.citations.map(({ citationId }) => citationId);
    const referenced = new Set(
      input.response.claims.flatMap(({ citationRefs }) => citationRefs),
    );
    const problems: string[] = [...navigationProblems];
    if (!uniqueStrings(citationIds)) problems.push("duplicate_citation_id");
    for (const citation of input.response.citations) {
      const effectiveFrom =
        citation.effectiveFrom === null
          ? null
          : parseTimestamp(citation.effectiveFrom);
      const effectiveTo =
        citation.effectiveTo === null ? null : parseTimestamp(citation.effectiveTo);
      const sourceAsOf = parseTimestamp(citation.sourceAsOf);
      if (
        !citation.citationId ||
        !citation.sourceId ||
        !citation.title.trim() ||
        !validHttpsUrl(citation.url) ||
        sourceAsOf === null ||
        sourceAsOf > now + DEFAULT_FUTURE_CLOCK_SKEW_MS ||
        (citation.effectiveFrom !== null && effectiveFrom === null) ||
        (citation.effectiveTo !== null && effectiveTo === null) ||
        (effectiveFrom !== null && effectiveFrom > now) ||
        (effectiveTo !== null && effectiveTo <= now) ||
        (effectiveFrom !== null &&
          effectiveTo !== null &&
          effectiveFrom >= effectiveTo) ||
        !/^(?:sha256:)?[a-f0-9]{64}$/iu.test(citation.contentHash)
      ) {
        problems.push(`citation_eligibility_invalid:${citation.citationId}`);
      }
      if (!referenced.has(citation.citationId)) {
        problems.push(`citation_not_referenced:${citation.citationId}`);
      }
      const matchesFact = input.response.facts.some((fact) =>
        citationMatchesKnowledgeFact(citation, fact, input) ||
        citationMatchesEducationFact(citation, fact, input),
      );
      const matchesTool = input.tools.some(({ envelope }) =>
        citationMatchesTool(citation, envelope, input.signer),
      );
      if (!matchesFact && !matchesTool) {
        problems.push(`citation_signed_lineage_missing:${citation.citationId}`);
      }
    }
    const factsById = new Map(
      input.response.facts.map((fact) => [fact.factId, fact])
    );
    const citationsById = new Map(
      input.response.citations.map((citation) => [citation.citationId, citation])
    );
    for (const claim of input.response.claims) {
      const knowledgeFacts = claim.factRefs.flatMap((factId) => {
        const fact = factsById.get(factId);
        return fact?.kind === "approved-knowledge.evidence" ? [fact] : [];
      });
      if (knowledgeFacts.length > 0) {
        if (claim.citationRefs.length !== knowledgeFacts.length) {
          problems.push(`claim_knowledge_citation_count_invalid:${claim.claimId}`);
        } else {
          knowledgeFacts.forEach((fact, index) => {
            const citationId = claim.citationRefs[index];
            const citation = citationId === undefined
              ? undefined
              : citationsById.get(citationId);
            if (
              citation === undefined ||
              !citationMatchesKnowledgeFact(citation, fact, input)
            ) {
              problems.push(`claim_knowledge_citation_pair_invalid:${claim.claimId}`);
            }
          });
        }
      }

      const educationFacts = claim.factRefs.flatMap((factId) => {
        const fact = factsById.get(factId);
        return fact?.kind === "education.approved-retrieval" ? [fact] : [];
      });
      if (educationFacts.length === 0) continue;
      const educationFact = educationFacts[0]!;
      const expectedCitationIds = [
        ...claim.textTemplate.matchAll(/\{\{E([1-5])\}\}/gu)
      ].flatMap((match) => {
        const value = recordValue(educationFact.value);
        const propositions = Array.isArray(value?.propositions)
          ? value.propositions
          : [];
        const proposition = recordValue(
          propositions[Number(match[1]) - 1]
        );
        return typeof proposition?.citationId === "string"
          ? [proposition.citationId]
          : [];
      });
      if (
        expectedCitationIds.length === 0 ||
        !equalStringSets(expectedCitationIds, claim.citationRefs) ||
        claim.citationRefs.some((citationId) => {
          const candidate = citationsById.get(citationId);
          return candidate === undefined ||
            !citationMatchesEducationFact(candidate, educationFact, input);
        })
      ) {
        problems.push(
          `claim_education_citation_pair_invalid:${claim.claimId}`
        );
      }
    }
    return problems.length === 0
      ? pass(scorerId, "citations_eligible_and_integrity_verified")
      : fail(scorerId, problems);
  } catch {
    return scorerError(scorerId, "citation_integrity_scorer_error");
  }
}

const TEXT_DATE = new RegExp(
  String.raw`\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr)\s+\d{1,2}(?:,\s*\d{4})?\b|\b\d{1,2}\s+(?:yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr)(?:\s+\d{4})?\b`,
  "giu",
);
const ISO_OR_SLASH_DATE =
  /\b\d{4}-\d{1,2}-\d{1,2}(?:T\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z?)?\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/giu;
const EXACT_NUMBER =
  /[+-]?(?:[$€£₼]\s*)?(?:\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?!\d|[.,]\d)\s*%?/gu;

function normalizedDisplay(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

function exactNumericAndDateTokens(value: string): readonly string[] {
  const withoutCitationMarkers = value
    .normalize("NFKC")
    .replace(/\[\d+\]/gu, " ");
  const tokens = [
    ...withoutCitationMarkers.matchAll(TEXT_DATE),
    ...withoutCitationMarkers.matchAll(ISO_OR_SLASH_DATE),
    ...withoutCitationMarkers.matchAll(EXACT_NUMBER),
  ]
    .map((match) => match[0])
    .filter((token): token is string => token !== undefined)
    .map(normalizedDisplay)
    .filter(Boolean);
  return [...new Set(tokens)];
}

function containsNonAsciiNumericCodePoint(value: string): boolean {
  return [...value].some((character) =>
    /\p{N}/u.test(character) && !/[0-9]/u.test(character)
  );
}

function numericComparisonKey(token: string): string | null {
  if (!/\d/u.test(token)) return null;
  const percent = token.trim().endsWith("%");
  let value = token
    .replace(/[$€£₼%\s]/gu, "")
    .replace(/^\+/u, "");
  if (!/^-?[\d.,]+$/u.test(value)) return null;
  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const thousandsSeparator = decimalSeparator === "." ? /,/gu : /\./gu;
    value = value.replace(thousandsSeparator, "");
    if (decimalSeparator === ",") value = value.replace(/,/gu, ".");
  } else if (lastComma >= 0) {
    const decimalDigits = value.length - lastComma - 1;
    value =
      decimalDigits > 0 && decimalDigits !== 3
        ? value.replace(/,/gu, ".")
        : value.replace(/,/gu, "");
  } else if (lastDot >= 0) {
    const decimalDigits = value.length - lastDot - 1;
    if (decimalDigits === 3 && /^-?\d{1,3}(?:\.\d{3})+$/u.test(value)) {
      value = value.replace(/\./gu, "");
    }
  }
  const negative = value.startsWith("-");
  if (negative) value = value.slice(1);
  const [integer = "0", fraction = ""] = value.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/u, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/u, "");
  const normalized = `${negative ? "-" : ""}${normalizedInteger}${
    normalizedFraction ? `.${normalizedFraction}` : ""
  }`;
  return `${percent ? "percent" : "number"}:${normalized}`;
}

function tokenAppearsInDisplays(token: string, displayTokens: readonly string[]): boolean {
  if (displayTokens.includes(token)) return true;
  const key = numericComparisonKey(token);
  return key !== null && displayTokens.some((candidate) => numericComparisonKey(candidate) === key);
}

function exactDecimalScalarKey(value: string): string | null {
  const normalized = value.normalize("NFKC").trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/^[+-]/u, "");
  const [integer = "0", fraction = ""] = unsigned.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/u, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/u, "");
  return `number:${negative ? "-" : ""}${normalizedInteger}${
    normalizedFraction ? `.${normalizedFraction}` : ""
  }`;
}

function scaleNumericKey(factKey: string, decimalPower: number): string | null {
  const match = /^number:(-?)(\d+)(?:\.(\d+))?$/u.exec(factKey);
  if (match === null) return null;
  const negative = match[1] === "-";
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? "";
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + decimalPower;
  const scaled = decimalIndex >= digits.length
    ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
    : decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return exactDecimalScalarKey(`${negative ? "-" : ""}${scaled}`);
}

function projectionNumericKeysFromText(value: string): readonly string[] {
  let withoutDates = value.normalize("NFKC").replaceAll("−", "-");
  const dateMatches = [
    ...withoutDates.matchAll(TEXT_DATE),
    ...withoutDates.matchAll(ISO_OR_SLASH_DATE)
  ].map((match) => match[0]);
  const keys: string[] = [];
  for (const date of dateMatches) {
    for (const component of date.match(/\d+/gu) ?? []) {
      const key = exactDecimalScalarKey(component);
      if (key !== null) keys.push(key);
    }
    withoutDates = withoutDates.replaceAll(date, " ");
  }
  const scaledAmounts = [
    ...withoutDates.matchAll(
      /(?:[$€£₼]\s*)?([+-]?\d+(?:[.,]\d+)?)\s*(million|billion|trillion|milyon|milyard|trilyon)\b/giu
    ),
    ...withoutDates.matchAll(
      /(?:[$€£₼]\s*|[A-Z]{3}\s+)([+-]?\d+(?:[.,]\d+)?)([MBT])\b/gu
    ),
  ];
  for (const match of scaledAmounts) {
    const numeric = numericComparisonKey(match[1] ?? "");
    const unit = (match[2] ?? "").toLocaleLowerCase("en-US");
    const power =
      unit === "million" || unit === "milyon" || unit === "m" ? 6
      : unit === "billion" || unit === "milyard" || unit === "b" ? 9
      : 12;
    const normalizedNumeric = numeric?.replace(/^percent:/u, "number:") ?? null;
    if (normalizedNumeric !== null) {
      keys.push(`compact:${power}:${normalizedNumeric.slice("number:".length)}`);
    }
    withoutDates = withoutDates.replace(match[0], " ");
  }
  for (const token of exactNumericAndDateTokens(withoutDates)) {
    const key = numericComparisonKey(token);
    if (key !== null) keys.push(key);
  }
  return [...new Set(keys)];
}

function factProjectionNumericKeys(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): readonly string[] {
  if (typeof value === "string") {
    const scalar = exactDecimalScalarKey(value);
    return scalar === null ? projectionNumericKeysFromText(value) : [scalar];
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? [exactDecimalScalarKey(String(value))].filter(
          (item): item is string => item !== null
        )
      : [];
  }
  if (typeof value === "bigint") return [`number:${value.toString()}`];
  if (typeof value !== "object" || value === null) return [];
  if (seen.has(value)) throw new TypeError("Structured fact data contains a cycle.");
  seen.add(value);
  const children = Array.isArray(value)
    ? value
    : Object.values(value as Readonly<Record<string, unknown>>);
  const keys = children.flatMap((child) => factProjectionNumericKeys(child, seen));
  seen.delete(value);
  return [...new Set(keys)];
}

function roundedNumericKey(
  factKey: string,
  decimalPlaces: number
): string | null {
  const match = /^number:(-?)(\d+)(?:\.(\d+))?$/u.exec(factKey);
  if (match === null) return null;
  const negative = match[1] === "-";
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? "";
  if (fraction.length <= decimalPlaces) return factKey;
  const retained = fraction.slice(0, decimalPlaces);
  const discarded = fraction.slice(decimalPlaces);
  const scale = 10n ** BigInt(decimalPlaces);
  let absolute = BigInt(integer) * scale +
    BigInt(retained.padEnd(decimalPlaces, "0") || "0");
  if ((discarded[0] ?? "0") >= "5") absolute += 1n;
  const roundedInteger = absolute / scale;
  const roundedFraction = decimalPlaces === 0
    ? ""
    : (absolute % scale).toString().padStart(decimalPlaces, "0").replace(/0+$/u, "");
  return `number:${negative ? "-" : ""}${roundedInteger}${
    roundedFraction ? `.${roundedFraction}` : ""
  }`;
}

function projectedNumericKeyMatches(
  projectedKey: string,
  factKeys: readonly string[]
): boolean {
  // A signed textual fact can itself contain a compact amount (for example,
  // a verbatim headline containing "$50 billion"). In that case both the
  // fact and its sealed display produce the same compact comparison key.
  // Accept that exact match before attempting to derive a compact display
  // from an unscaled numeric fact such as a raw market-cap value.
  if (factKeys.includes(projectedKey)) return true;
  const compact = /^compact:(6|9|12):(-?\d+(?:\.(\d+))?)$/u.exec(projectedKey);
  if (compact !== null) {
    const decimalPower = Number(compact[1]);
    const projectedValue = `number:${compact[2]}`;
    const decimalPlaces = compact[3]?.length ?? 0;
    return factKeys.some((factKey) => {
      const scaled = scaleNumericKey(factKey, -decimalPower);
      return scaled !== null &&
        roundedNumericKey(scaled, decimalPlaces) === projectedValue;
    });
  }
  const percent = projectedKey.startsWith("percent:");
  const normalizedProjected = projectedKey.replace(/^percent:/u, "number:");
  const normalizedFactKeys = factKeys.map((factKey) =>
    factKey.replace(/^percent:/u, "number:")
  );
  const comparableFactKeys = percent
    ? [
        ...normalizedFactKeys,
        ...normalizedFactKeys.flatMap((factKey) => {
          const scaled = scaleNumericKey(factKey, 2);
          return scaled === null ? [] : [scaled];
        })
      ]
    : factKeys;
  if (comparableFactKeys.includes(normalizedProjected)) return true;
  const projected = /^number:-?\d+(?:\.(\d+))?$/u.exec(normalizedProjected);
  if (projected === null) return false;
  const decimalPlaces = projected[1]?.length ?? 0;
  return comparableFactKeys.some((factKey) =>
    roundedNumericKey(factKey, decimalPlaces) === normalizedProjected
  );
}

function exactTokensFromStructuredValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): readonly string[] {
  if (typeof value === "string") return exactNumericAndDateTokens(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? exactNumericAndDateTokens(String(value)) : [];
  }
  if (typeof value !== "object" || value === null) return [];
  if (seen.has(value)) throw new TypeError("Structured response data contains a cycle.");
  seen.add(value);
  const children = Array.isArray(value)
    ? value
    : Object.values(value as Readonly<Record<string, unknown>>);
  const tokens = children.flatMap((child) => exactTokensFromStructuredValue(child, seen));
  seen.delete(value);
  return [...new Set(tokens)];
}

function cardExactValueProblems(
  input: V3ResponseScoringInput,
  factsById: ReadonlyMap<string, FactEnvelope<unknown>>,
): string[] {
  const problems: string[] = [];
  for (const card of input.response.cards) {
    const facts = card.factRefs
      .map((factId) => factsById.get(factId))
      .filter((fact): fact is FactEnvelope<unknown> => fact !== undefined);
    const allowed = facts.flatMap((fact) => exactTokensFromStructuredValue({
      value: fact.value,
      asOf: fact.asOf,
      createdAt: fact.createdAt,
    }));
    for (const token of exactTokensFromStructuredValue(card.data)) {
      if (!tokenAppearsInDisplays(token, allowed)) {
        problems.push(`ungrounded_card_exact_value:${card.cardId}:${token}`);
      }
    }
  }
  return problems;
}

function chartEvidenceProblems(input: V3ResponseScoringInput): string[] {
  const problems: string[] = [];
  for (const chart of input.response.charts) {
    const matchingHistory = input.tools.some(({ envelope, arguments: args }) => {
      if (
        envelope.toolId !== "read-price-history" ||
        envelope.status !== "success" ||
        envelope.result === null ||
        !verifyEnvelope(envelope, input.signer) ||
        envelope.resultHash !== canonicalHash(envelope.result)
      ) return false;
      const argumentRecord = recordValue(args);
      const result = recordValue(envelope.result);
      return argumentRecord?.symbol === chart.symbol &&
        argumentRecord.range === chart.range &&
        result?.symbol === chart.symbol &&
        result.range === chart.range &&
        result.currency === chart.currency &&
        result.asOf === chart.asOf &&
        canonicalHash(result.points) === canonicalHash(chart.points);
    });
    if (!matchingHistory) problems.push(`chart_history_evidence_mismatch:${chart.chartId}`);
  }
  return problems;
}

export function scoreV3NumericDateGrounding(
  input: V3ResponseScoringInput,
): V3ScorerResult {
  const scorerId = "v3.response.numeric-date-grounding" as const;
  try {
    const tokens = exactNumericAndDateTokens(input.response.message);
    const graph = checkFactGraph(input);
    const responseFactIds = new Set(input.response.facts.map(({ factId }) => factId));
    const displays: string[] = [];
    const invalidDisplays: string[] = [];
    const displaysByFactId = new Map<string, string[]>();
    const projectionEvidence = new EvidenceFactory({ signer: input.signer });
    for (const item of input.factDisplays ?? []) {
      const fact = graph.factsById.get(item.factId);
      const projection = fact === undefined
        ? null
        : {
            alias: item.alias,
            fact,
            display: item.display,
            meaning: item.meaning,
            required: item.required,
            semanticRoles: item.semanticRoles,
            ...(item.requiredCitationAlias === undefined
              ? {}
              : { requiredCitationAlias: item.requiredCitationAlias }),
            projectionIntegrity: item.projectionIntegrity
          } satisfies RenderableFact;
      if (
        fact === undefined ||
        projection === null ||
        !responseFactIds.has(item.factId) ||
        !input.response.provenance.factIds.includes(item.factId) ||
        !verifyEnvelope(fact, input.signer) ||
        !projectionEvidence.verifyProjection(
          renderableFactProjectionPayload(projection),
          item.projectionIntegrity
        ) ||
        !item.display.trim()
      ) {
        invalidDisplays.push(`signed_fact_display_invalid:${item.factId}`);
        continue;
      }
      const factNumericKeys = factProjectionNumericKeys({
        value: fact.value,
        asOf: fact.asOf,
        createdAt: fact.createdAt
      });
      const projectedNumericKeys = projectionNumericKeysFromText(item.display);
      const projectionMismatch = projectedNumericKeys.some((key) =>
        !projectedNumericKeyMatches(key, factNumericKeys)
      );
      if (
        containsNonAsciiNumericCodePoint(item.display) ||
        projectionMismatch
      ) {
        invalidDisplays.push(`fact_display_value_mismatch:${item.factId}:${item.alias}`);
        continue;
      }
      const grouped = displaysByFactId.get(item.factId) ?? [];
      grouped.push(normalizedDisplay(item.display));
      displaysByFactId.set(item.factId, grouped);
    }
    for (const grouped of displaysByFactId.values()) {
      // One signed fact may expose several narrowly formatted conversational
      // slots (for example price, change, and as-of). Aggregate those slots
      // for exact-token grounding while retaining a single parent lineage.
      displays.push(grouped.join(" "));
    }
    const displayTokens = displays.flatMap(exactNumericAndDateTokens);
    const missing = tokens.filter((token) => !tokenAppearsInDisplays(token, displayTokens));
    const problems = [
      ...invalidDisplays,
      ...(containsNonAsciiNumericCodePoint(input.response.message)
        ? ["ungrounded_non_ascii_numeric"]
        : []),
      ...missing.map((token) => `ungrounded_exact_value:${token}`),
      ...cardExactValueProblems(input, graph.factsById),
      ...chartEvidenceProblems(input),
    ];
    const hasStructuredExactValue = input.response.cards.some((card) =>
      exactTokensFromStructuredValue(card.data).length > 0
    );
    if (
      tokens.length === 0 &&
      !hasStructuredExactValue &&
      input.response.charts.length === 0 &&
      problems.length === 0
    ) {
      return notApplicable(scorerId, "response_has_no_exact_number_or_date");
    }
    return problems.length === 0
      ? pass(scorerId, "all_exact_numbers_dates_cards_and_charts_are_grounded")
      : fail(scorerId, problems);
  } catch {
    return scorerError(scorerId, "numeric_date_grounding_scorer_error");
  }
}

function conversationalSentenceFragments(message: string): string[] {
  // Decimal money/quantity values and fractional ISO seconds are not sentence
  // boundaries. Counting their dots made concise financial previews appear to
  // contain six or more sentences.
  const withoutDecimalDots = message.replace(/([\p{N}])\.(?=[\p{N}])/gu, "$1");
  return withoutDecimalDots
    .split(/[.!?]+/gu)
    .map((sentence) => normalizedDisplay(sentence))
    .filter(Boolean);
}

function duplicatedSentences(message: string): boolean {
  const sentences = conversationalSentenceFragments(message)
    .filter((sentence) => sentence.length >= 20);
  return new Set(sentences).size !== sentences.length;
}

function decisionSupportNonAdvisoryProblems(
  input: V3ResponseScoringInput,
  message: string
): string[] {
  if (input.response.status !== "complete") return [];
  const protectedRoutes = new Set<V3Function>([
    "security_decision_support",
    "portfolio_allocation_analysis",
    "hypothetical_portfolio_analysis",
    "hypothetical_position_analysis"
  ]);
  const route = input.route.route;
  if (route === null || !protectedRoutes.has(route)) return [];
  const problems: string[] = [];
  const visibleBoundaryText = [
    message,
    ...input.response.notices
  ].join(" ");
  const boundary = input.context.locale === "az-AZ"
    ? /(?:tövsiyə\s+(?:verə|edə)\s+bilmərəm|tövsiyə\s+(?:deyil|etmir))/iu
    : /\b(?:cannot|can['’]t|does\s+not)\s+recommend\b/iu;
  if (!boundary.test(visibleBoundaryText)) {
    problems.push("decision_support_non_advisory_boundary_missing");
  }
  const forbiddenRecommendation =
    /\b(?:you\s+should|i\s+would|i\s+recommend|we\s+recommend|consider\s+(?:buying|selling|reducing|adding|trimming|reallocating|shifting)|hold\s+and\s+monitor|profile-aligned\s+option|recommended\s+action|(?:reduce|increase|trim|add|reallocate|shift)\s+(?:the|your|this)\s+(?:position|allocation|portfolio))\b|(?<!\p{L})(?:al(?:mağ|mag)\p{L}*\s+tövsiyə|sat(?:mağ|mag)\p{L}*\s+tövsiyə|azaltmağı\s+nəzərdən\s+keçir)(?!\p{L})/iu;
  if (forbiddenRecommendation.test(message)) {
    problems.push("decision_support_recommendation_language_forbidden");
  }

  const expectedFactKind = route === "security_decision_support"
    ? "portfolio.security-decision-support"
    : route === "portfolio_allocation_analysis"
      ? "portfolio.allocation-risk-analysis"
    : route === "hypothetical_portfolio_analysis"
      ? "portfolio.hypothetical-allocation-analysis"
      : "portfolio.hypothetical-position-analysis";
  const facts = input.response.facts.filter(({ kind }) => kind === expectedFactKind);
  if (facts.length !== 1) {
    return ["decision_support_fact_count_invalid"];
  }
  const fact = facts[0]!;
  const value = recordValue(fact.value);

  if (
    route === "portfolio_allocation_analysis" ||
    route === "hypothetical_portfolio_analysis"
  ) {
    const analysisToolEvidence = input.tools.find(
      ({ envelope }) => envelope.toolId === "analyze-portfolio-allocation"
    );
    const analysisTool = analysisToolEvidence?.envelope;
    const expectedScope = route === "portfolio_allocation_analysis"
      ? "current"
      : "hypothetical";
    if (
      value === null ||
      value.schemaVersion !== "assistant-v3.portfolio-allocation-analysis.v1" ||
      value.scope !== expectedScope ||
      value.recommendationAllowed !== false ||
      Object.prototype.hasOwnProperty.call(value, "action") ||
      Object.prototype.hasOwnProperty.call(value, "targetAllocation") ||
      analysisTool?.status !== "success" ||
      analysisTool.result === null ||
      canonicalHash(value) !== canonicalHash(analysisTool.result) ||
      !fact.provenance.toolExecutionIds.includes(analysisTool.executionId)
    ) {
      problems.push("hypothetical_portfolio_recommendation_boundary_invalid");
    }
    const toolArguments = analysisToolEvidence?.arguments;
    if (
      route === "portfolio_allocation_analysis" &&
      canonicalHash(toolArguments) !== canonicalHash({ scope: "current" })
    ) {
      problems.push("portfolio_allocation_tool_arguments_invalid");
    }
    if (route === "hypothetical_portfolio_analysis") {
      const parsed = input.requestMessage === undefined
        ? null
        : parseHypotheticalPortfolioScenario(input.requestMessage);
      const expectedArguments = parsed?.status === "supported"
        ? {
            scope: "hypothetical" as const,
            currency: parsed.scenario.currency,
            totalValue: parsed.scenario.totalValue,
            allocations: parsed.scenario.allocations
          }
        : null;
      if (
        expectedArguments === null ||
        canonicalHash(toolArguments) !== canonicalHash(expectedArguments)
      ) {
        problems.push("hypothetical_portfolio_tool_arguments_invalid");
      }
    }
    const cards = input.response.cards.filter((card) => card.kind === "allocation");
    const expectedCard = {
      cardId: `card-${fact.factId}`,
      kind: "allocation" as const,
      title: route === "portfolio_allocation_analysis"
        ? input.context.locale === "az-AZ"
          ? "Portfel bölgüsü üzrə risk baxışı"
          : "Portfolio allocation risk review"
        : input.context.locale === "az-AZ"
          ? "Hipotetik portfel bölgüsü"
          : "Hypothetical portfolio allocation",
      factRefs: [fact.factId],
      data: fact.value
    };
    if (
      cards.length !== 1 ||
      canonicalHash(cards[0]) !== canonicalHash(expectedCard)
    ) {
      problems.push("portfolio_allocation_card_fact_mismatch");
    }
    if (input.response.actions.length !== 0) {
      problems.push("portfolio_allocation_action_forbidden");
    }
    return problems;
  }

  if (route === "hypothetical_position_analysis") {
    const perspectives = value?.perspectives;
    if (
      value === null ||
      value.recommendationAllowed !== false ||
      Object.prototype.hasOwnProperty.call(value, "action") ||
      !Array.isArray(perspectives)
    ) {
      problems.push("hypothetical_position_recommendation_boundary_invalid");
    } else {
      const perspectiveIds = perspectives.flatMap((candidate) => {
        const perspective = recordValue(candidate);
        return typeof perspective?.id === "string" ? [perspective.id] : [];
      });
      const expectedIds = ["ADD_EXPOSURE", "KEEP_EXPOSURE", "REDUCE_EXPOSURE"];
      if (
        perspectiveIds.length !== expectedIds.length ||
        expectedIds.some((id) => !perspectiveIds.includes(id))
      ) {
        problems.push("hypothetical_position_perspectives_invalid");
      }
    }
    const symbol = input.route.symbols[0];
    const parsed = symbol === undefined || input.requestMessage === undefined
      ? null
      : parseHypotheticalPositionScenario(input.requestMessage, symbol);
    const tools = toolEnvelopes(input);
    const resolvedTool = tools.find(({ toolId }) => toolId === "resolve-instrument");
    const marketTool = tools.find(({ toolId }) => toolId === "read-market-snapshot");
    const calculation = fact.provenance.calculation;
    if (
      parsed === null ||
      parsed.status !== "supported" ||
      resolvedTool?.status !== "success" ||
      resolvedTool.result === null ||
      marketTool?.status !== "success" ||
      marketTool.result === null ||
      fact.subject.type !== "instrument" ||
      fact.subject.ref !== symbol ||
      calculation?.id !== "reviewed-hypothetical-position-analysis" ||
      calculation.version !== "1.0.0" ||
      calculation.formulaId !==
        "user-supplied-position-current-market-comparison-v1" ||
      !fact.quality.flags.includes("USER_SUPPLIED_HYPOTHETICAL") ||
      !fact.quality.flags.includes("PUBLIC_DEVELOPMENT_MARKET_FEED") ||
      !fact.quality.flags.includes("NON_ADVISORY")
    ) {
      problems.push("hypothetical_position_evidence_binding_invalid");
    } else {
      try {
        const expectedValue = projectHypotheticalPositionAnalysis({
          scenario: parsed.scenario,
          resolved: resolvedTool.result as ResolvedInstrument,
          market: marketTool.result as BoundaryMarketSnapshot
        });
        if (canonicalHash(value) !== canonicalHash(expectedValue)) {
          problems.push("hypothetical_position_calculation_mismatch");
        }
      } catch {
        problems.push("hypothetical_position_calculation_invalid");
      }
    }
    const cards = input.response.cards.filter((card) =>
      card.kind === "position-analysis"
    );
    const expectedCard = symbol === undefined
      ? null
      : {
          cardId: `card-${fact.factId}`,
          kind: "position-analysis" as const,
          title: input.context.locale === "az-AZ"
            ? `${symbol} hipotetik mövqe təhlili`
            : `${symbol} hypothetical position`,
          factRefs: [fact.factId],
          data: fact.value
        };
    if (
      expectedCard === null ||
      cards.length !== 1 ||
      canonicalHash(cards[0]) !== canonicalHash(expectedCard)
    ) {
      problems.push("hypothetical_position_card_fact_mismatch");
    }
    return problems;
  }

  const assessment = value === null ? null : recordValue(value.assessment);
  const options = assessment?.options;
  if (
    value === null ||
    assessment === null ||
    Object.prototype.hasOwnProperty.call(assessment, "action") ||
    !Array.isArray(options)
  ) {
    problems.push("decision_support_selected_action_forbidden");
  } else {
    const optionIds = options.flatMap((candidate) => {
      const option = recordValue(candidate);
      return typeof option?.id === "string" ? [option.id] : [];
    });
    const expectedIds = ["ADD_EXPOSURE", "KEEP_EXPOSURE", "REDUCE_EXPOSURE"];
    if (
      optionIds.length !== expectedIds.length ||
      expectedIds.some((id) => !optionIds.includes(id))
    ) {
      problems.push("decision_support_perspectives_invalid");
    }
  }

  const symbol = input.route.symbols[0];
  const cards = input.response.cards.filter((card) =>
    card.kind === "decision-support"
  );
  const expectedCard = symbol === undefined
    ? null
    : {
        cardId: `card-decision-support-${symbol}`,
        kind: "decision-support" as const,
        title: input.context.locale === "az-AZ"
          ? `${symbol} qərar dəstəyi`
          : `${symbol} decision support`,
        factRefs: [fact.factId],
        data: fact.value
      };
  if (
    expectedCard === null ||
    cards.length !== 1 ||
    canonicalHash(cards[0]) !== canonicalHash(expectedCard)
  ) {
    problems.push("decision_support_card_fact_mismatch");
  }
  return problems;
}

function marketMoveCausalityProblems(
  input: V3ResponseScoringInput,
  message: string
): string[] {
  if (input.route.route !== "market_move_explanation") return [];
  const problems: string[] = [];
  const symbol = input.route.symbols[0];
  const facts = input.response.facts.filter(({ kind }) =>
    kind === "market.move-explanation"
  );
  if (
    symbol === undefined ||
    input.route.symbols.length !== 1 ||
    facts.length !== 1 ||
    facts[0]?.subject.type !== "instrument" ||
    facts[0]?.subject.ref !== symbol
  ) {
    return ["market_move_fact_scope_invalid"];
  }
  const value = recordValue(facts[0].value);
  if (
    value === null ||
    value.schemaVersion !== "assistant-v3.market-move-explanation.v1" ||
    value.symbol !== symbol ||
    value.causalityEstablished !== false ||
    recordValue(value.observedMove) === null ||
    recordValue(value.intradayEvidence) === null ||
    recordValue(value.possibleContext) === null
  ) {
    problems.push("market_move_causality_boundary_invalid");
  }
  const visibleText = [message, ...input.response.notices].join(" ");
  const requiredLimitation = input.context.locale === "az-AZ"
    ? /səbəb\s+əlaqəsi[\s\S]{0,100}(?:müəyyən\s+edilməyib|təsdiqləmir)|yalnız\s+mümkün\s+kontekst/iu
    : /causality[\s\S]{0,100}(?:not\s+established|not\s+confirmed)|possible\s+context\s+only/iu;
  if (!requiredLimitation.test(visibleText)) {
    problems.push("market_move_causality_limitation_missing");
  }
  const unsupportedCausalConclusion = input.context.locale === "az-AZ"
    ? /(?:\bsəbəbi\s+(?:budur|odur|.+(?:dır|dir|dur|dür))\b|(?:buna|ona)\s+görə\s+(?:düş|qalx)\p{L}*|səbəbindən\s+(?:düş|qalx)\p{L}*)/iu
    : /\b(?:was|is|were|are)\s+caused\s+by\b|\bthe\s+(?:main\s+)?reason\s+(?:was|is)\b|\bdue\s+to\b/iu;
  if (unsupportedCausalConclusion.test(message)) {
    problems.push("market_move_unsupported_causal_conclusion");
  }
  return problems;
}

export function scoreV3ConversationalQuality(
  input: V3ResponseScoringInput,
): V3ScorerResult {
  const scorerId = "v3.response.conversational-quality" as const;
  try {
    const message = input.response.message.normalize("NFKC").trim();
    const problems: string[] = [];
    const words = message.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) ?? [];
    const sentences = conversationalSentenceFragments(message);
    const paragraphs = message.split(/\n\s*\n/gu).filter((part) => part.trim()).length;
    if (!message) problems.push("response_message_empty");
    if (message.length > 900 || words.length > 140) problems.push("response_too_long");
    if (sentences.length > 5 || paragraphs > 4) problems.push("response_not_concise");
    if (duplicatedSentences(message)) problems.push("response_repeats_sentences");
    if (
      /^\s*[\[{]/u.test(message) ||
      /```|^\s*#{1,6}\s|\|\s*:?-{3,}:?\s*\||"(?:text|mode|notices|markets)"\s*:/imu
        .test(message)
    ) {
      problems.push("response_uses_machine_or_report_format");
    }
    if (
      /\b(?:DETERMINISTIC RESPONSE|GROUNDING PASSED|INFORMATIONAL ONLY|MARKET ANALYST|GET-MARKET-SNAPSHOT|YAHOO FINANCE CHART ENDPOINT)\b/iu.test(
        message,
      ) ||
      /\b(?:read-market-snapshot|retrieve-approved-product-knowledge|toolExecutionIds|workflowRunId)\b/iu.test(
        message,
      )
    ) {
      problems.push("response_exposes_internal_or_machine_labels");
    }
    problems.push(...decisionSupportNonAdvisoryProblems(input, message));
    problems.push(...marketMoveCausalityProblems(input, message));
    return problems.length === 0
      ? pass(scorerId, "response_is_concise_and_conversational")
      : fail(scorerId, problems);
  } catch {
    return scorerError(scorerId, "conversational_quality_scorer_error");
  }
}

function validScorerInvariant(score: V3ScorerResult): boolean {
  switch (score.status) {
    case "pass":
      return score.applicable && score.passed && score.score === 1;
    case "fail":
      return score.applicable && !score.passed && score.score === 0;
    case "not_applicable":
    case "error":
      return !score.applicable && !score.passed && score.score === null;
  }
}

/**
 * P0 delivery gate: any fail, scorer error, missing scorer, duplicate scorer,
 * or malformed result blocks customer delivery. N/A is never counted as pass.
 */
export function aggregateV3ResponseScores(
  scores: readonly V3ScorerResult[],
): V3BlockingResponseAggregate {
  const expected = new Set<string>(V3_BLOCKING_RESPONSE_SCORER_IDS);
  const seen = new Set<string>();
  const blockedBy: string[] = [];
  for (const score of scores) {
    if (!expected.has(score.scorerId)) blockedBy.push(`unexpected_scorer:${score.scorerId}`);
    if (seen.has(score.scorerId)) blockedBy.push(`duplicate_scorer:${score.scorerId}`);
    seen.add(score.scorerId);
    if (!validScorerInvariant(score)) blockedBy.push(`invalid_scorer_result:${score.scorerId}`);
    if (score.status === "fail" || score.status === "error") {
      blockedBy.push(`${score.status}:${score.scorerId}`);
    }
  }
  for (const scorerId of V3_BLOCKING_RESPONSE_SCORER_IDS) {
    if (!seen.has(scorerId)) blockedBy.push(`missing_scorer:${scorerId}`);
  }
  const passedCount = scores.filter((score) => score.status === "pass").length;
  const failedCount = scores.filter((score) => score.status === "fail").length;
  const notApplicableCount = scores.filter(
    (score) => score.status === "not_applicable",
  ).length;
  const errorCount = scores.filter((score) => score.status === "error").length;
  const applicableCount = passedCount + failedCount;
  if (passedCount === 0) blockedBy.push("no_applicable_scorer_passed");
  const uniqueBlockedBy = [...new Set(blockedBy)];
  const passed = uniqueBlockedBy.length === 0;
  return Object.freeze({
    capability: "response-delivery",
    priority: "P0",
    delivery: passed ? "allow" : "block",
    passed,
    score: applicableCount === 0 ? null : passedCount / applicableCount,
    passedCount,
    failedCount,
    notApplicableCount,
    errorCount,
    blockedBy: Object.freeze(uniqueBlockedBy),
    results: Object.freeze([...scores]),
  });
}

/** Runs every blocking scorer independently, then applies the P0 gate. */
export function scoreV3ResponseForDelivery(
  input: V3ResponseScoringInput,
): V3BlockingResponseAggregate {
  const results = runIndependentV3Scorers([
    {
      scorerId: "v3.response.required-tool-set",
      evaluate: () => scoreV3RequiredToolSet(input),
    },
    {
      scorerId: "v3.response.tool-envelope-integrity",
      evaluate: () => scoreV3ToolEnvelopeIntegrity(input),
    },
    {
      scorerId: "v3.response.fact-derivation",
      evaluate: () => scoreV3FactDerivation(input),
    },
    {
      scorerId: "v3.response.material-claim-lineage",
      evaluate: () => scoreV3MaterialClaimLineage(input),
    },
    {
      scorerId: "v3.response.navigation-integrity",
      evaluate: () => scoreV3NavigationIntegrity(input),
    },
    {
      scorerId: "v3.response.citation-integrity",
      evaluate: () => scoreV3CitationIntegrity(input),
    },
    {
      scorerId: "v3.response.numeric-date-grounding",
      evaluate: () => scoreV3NumericDateGrounding(input),
    },
    {
      scorerId: "v3.response.conversational-quality",
      evaluate: () => scoreV3ConversationalQuality(input),
    },
  ]);
  return aggregateV3ResponseScores(results);
}
