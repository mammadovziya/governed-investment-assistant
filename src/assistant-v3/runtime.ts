import { randomUUID } from "node:crypto";
import { SpanType, type TracingContext } from "@mastra/core/observability";
import { RequestContext } from "@mastra/core/request-context";

import type { KnowledgeToolResult } from "../domain/knowledge.js";
import type {
  ApprovedKnowledgeEvidenceValue,
  ApprovedKnowledgeServicePort
} from "./approved-knowledge.js";
import { projectApprovedKnowledgeEvidence } from "./approved-knowledge.js";
import {
  V3_BOUNDARY_EXECUTION_CONTEXT_KEY,
  type BoundaryMarketSnapshot,
  type BoundaryPriceHistory,
  type CurrencyConversionArguments,
  type CurrencyConversionResult,
  type V3BoundaryExecutionContext,
  type V3BoundaryTools
} from "./boundary-tools.js";
import {
  buildKnowledgeCapabilityPresentation,
  buildPublicCapabilityPresentation,
  buildReviewedEducationCapabilityPresentation,
  buildSecurityDecisionSupportPresentation,
  type CapabilityPresentation
} from "./capability-presentations.js";
import {
  type AssistantAction,
  type AssistantCitation,
  type AssistantResponse,
  type ClaimDraft,
  type DecimalString,
  type FactEnvelope,
  type SupportedLocale,
  type ToolExecutionEnvelope,
  type TrustedRequestContext
} from "./contracts.js";
import {
  BoundedV3ConversationMemory,
  type V3ConversationMemoryReadResult,
  type V3ConversationMemoryScope
} from "./conversation-memory.js";
import {
  reviewedConversationDefinition,
  reviewedGenericClarificationDefinition
} from "./conversation.js";
import {
  OrderConfirmationAuthority,
  TrustedRequestContextAuthority
} from "./context-authority.js";
import { EvidenceFactory } from "./evidence.js";
import {
  financialEducationRouteReason,
  normalizeFinancialEducationQuery
} from "./financial-education-query.js";
import { calculatePublishedCommission } from "./fees.js";
import type { V3FinancialTaskPlannerPort } from "./financial-task-planner.js";
import {
  decimal,
  divideFixed,
  formatFixedDecimal,
  parseFixedDecimal
} from "./fixed-decimal.js";
import { V3ToolGrantAuthority } from "./grants.js";
import {
  detectGovernedNavigationTarget,
  GovernedInAppNavigationService
} from "./governed-navigation.js";
import { GovernedReadOnlyNavigationService } from "./governed-read-only-navigation.js";
import {
  V3HttpRuntimeError,
  type V3AssistantHttpRuntime,
  type V3HttpCreatedSession
} from "./http.js";
import type {
  MockPortfolioActivity,
  MockPortfolioPositionSnapshot,
  RecentTradingActivityResult
} from "./mock-portfolio.js";
import {
  OrderHandoffStore,
  orderHandoffScreenState,
  type OrderEligibility,
  type OrderHandoffScreenState,
  type SignedOrderHandoff
} from "./order-handoff.js";
import { reviewOrderPreviewIntent } from "./order-intent.js";
import {
  authorizeV3OrderHandoffConfirmation,
  enforceV3PolicyAgreement,
  evaluateV3Policy,
  type V3ApprovedBoundaryToolId,
  type V3PolicyDecision
} from "./policy.js";
import { calculatePortfolioRoute, type PortfolioRoute } from "./portfolio-route-calculators.js";
import {
  buildPortfolioActivityPresentation,
  portfolioActivityToolArguments,
  projectPortfolioActivityFact,
  type PortfolioActivityRoute
} from "./portfolio-activity.js";
import {
  buildCurrentPortfolioAllocationPresentation,
  buildHypotheticalPortfolioPresentation,
  buildHypotheticalPositionPresentation,
  parseHypotheticalPortfolioScenario,
  parseHypotheticalPositionScenario
} from "./portfolio-scenarios.js";
import type { PortfolioAllocationAnalysisArguments } from "./portfolio-allocation-analysis.js";
import { buildPortfolioRoutePresentation, formatDecimalExact, formatMoneyExact } from "./presentation.js";
import { sealRenderableFact } from "./rendering.js";
import { scoreV3ResponseForDelivery } from "./response-scorers.js";
import {
  applyV3ConversationRouteContext,
  hasV3ConversationFollowUpMarker,
  isV3ConversationContextRoute,
  marketHistoryRangeFromRoute,
  routeV3Request,
  type V3Function,
  type V3RouteDecision
} from "./routing.js";
import {
  V3SessionAuthority,
  V3SessionError,
  v3PrincipalFingerprint,
  type V3TrustedSession
} from "./sessions.js";
import type { DevHmacSigner } from "./signing.js";
import { canonicalHash } from "./signing.js";
import type {
  V3Gate,
  V3Intent,
  V3TelemetryMetrics,
  V3Workflow
} from "./telemetry.js";
import { V3AuditOutbox } from "./audit.js";
import type {
  AssistantV3Workflows,
  V3CapabilityBundle,
  V3PreparedResponse,
  V3WorkflowDependencies,
  V3WorkflowInvocation
} from "./workflows.js";

interface V3RuntimeTopology {
  tools: V3BoundaryTools;
  workflows: AssistantV3Workflows;
}

interface RuntimeSessionRecord {
  conversationId: string;
  preferredLocale: SupportedLocale;
  expiresAt: number;
}

type V3ConversationMemoryPort = Pick<
  BoundedV3ConversationMemory,
  "read" | "peek" | "write" | "commitAssisted" | "clear" | "purgeExpired"
>;

interface PendingMemoryAssistance {
  expectedVersion: number;
  expectedRevision: string;
}

interface ExecutedTool {
  envelope: ToolExecutionEnvelope<unknown>;
  arguments: unknown;
}

interface SuspendedOrderRecord {
  runId: string;
  prepared: V3PreparedResponse;
  sessionId: string;
  principalRef: string;
  expiresAt: number;
  run: { resume(input: { step: string; resumeData: unknown }): Promise<unknown> };
}

interface IssuedOrderHandoffRecord {
  sessionId: string;
  principalRef: string;
  handoff: SignedOrderHandoff;
}

export interface V3AssistantRuntimeOptions {
  signer: DevHmacSigner;
  sessionAuthority: V3SessionAuthority;
  contextAuthority: TrustedRequestContextAuthority;
  confirmationAuthority: OrderConfirmationAuthority;
  grantAuthority: V3ToolGrantAuthority;
  orderHandoffStore: OrderHandoffStore;
  approvedKnowledge: ApprovedKnowledgeServicePort;
  audit?: V3AuditOutbox;
  telemetry?: V3TelemetryMetrics;
  environment?: TrustedRequestContext["environment"];
  sessionTtlMs?: number;
  modelTimeoutMs?: number;
  /** Bounds live process-local session records for the internal pilot. */
  sessionCapacity?: number;
  /** Bounds each process-local order-state phase. */
  orderStateCapacity?: number;
  now?: () => number;
  /** `false` disables bounded conversation continuity for this runtime. */
  conversationMemory?: V3ConversationMemoryPort | false;
  /** `false` keeps downstream product/fee knowledge out of the public runtime. */
  productKnowledgeEnabled?: boolean;
}

const PORTFOLIO_ROUTES = new Set<V3Function>([
  "recent_trading_activity",
  "purchase_history",
  "current_portfolio_value",
  "largest_holding",
  "ytd_gain_loss_twr",
  "holding_average_cost",
  "sector_allocation",
  "one_month_mover_contribution",
  "security_decision_support",
  "portfolio_allocation_analysis",
  "hypothetical_portfolio_analysis",
  "hypothetical_position_analysis"
]);
const SYMBOL_REQUIRED_ROUTES = new Set<V3Function>([
  "holding_average_cost",
  "market_quote",
  "market_history",
  "market_event",
  "company_research",
  "technical_analysis",
  "news_sentiment",
  "market_move_explanation",
  "security_risk",
  "security_decision_support",
  "hypothetical_position_analysis",
  "etf_explanation_risk",
  "order_ticket_preview"
]);
const SINGLE_SYMBOL_ROUTES = new Set<V3Function>([
  "holding_average_cost",
  "market_move_explanation",
  "security_decision_support",
  "hypothetical_position_analysis",
  "order_ticket_preview"
]);
const DEFAULT_RUNTIME_SESSION_CAPACITY = 1_024;
const DEFAULT_RUNTIME_ORDER_STATE_CAPACITY = 1_024;
const MAX_RUNTIME_STATE_CAPACITY = 100_000;

function runtimeStateCapacity(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_RUNTIME_STATE_CAPACITY
  ) {
    throw new RangeError(
      `${label} must be an integer between 1 and ${String(MAX_RUNTIME_STATE_CAPACITY)}.`
    );
  }
  return resolved;
}

function unavailableMessage(locale: SupportedLocale): string {
  return locale === "az-AZ"
    ? "Bu məlumatı indi etibarlı mənbələrdən tam yoxlaya bilmədim. Təxmin etməyəcəyəm; zəhmət olmasa bir qədər sonra yenidən cəhd edin."
    : "I couldn’t verify all of the required evidence just now. I won’t guess; please try again shortly.";
}

function investmentSelectionClarificationMessage(
  route: V3RouteDecision,
  locale: SupportedLocale
): string {
  const reasonNumber = (prefix: string): number | null => {
    const raw = route.reasonCodes.find((code) => code.startsWith(prefix))
      ?.slice(prefix.length);
    if (raw === undefined || !/^\d{1,4}$/u.test(raw)) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };
  const includedMonths = reasonNumber("investment_horizon_months:");
  const excludedMonths = reasonNumber("investment_excluded_horizon_months:");
  const duration = (
    months: number | null,
    azSuffix: "üfüqünü" | "müddəti"
  ): string | null => {
    if (months === null) return null;
    const azNumbers = [
      "",
      "bir",
      "iki",
      "üç",
      "dörd",
      "beş",
      "altı",
      "yeddi",
      "səkkiz",
      "doqquz",
      "on"
    ] as const;
    const enNumbers = [
      "",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten"
    ] as const;
    const amountText = (amount: number): string =>
      locale === "az-AZ"
        ? azNumbers[amount] ?? "uzunmüddətli"
        : enNumbers[amount] ?? "long-term";
    if (locale === "az-AZ") {
      return months % 12 === 0
        ? `${amountText(months / 12)} illik ${azSuffix}`
        : `${amountText(months)} aylıq ${azSuffix}`;
    }
    return months % 12 === 0
      ? `${amountText(months / 12)}-year horizon`
      : `${amountText(months)}-month horizon`;
  };
  const included = duration(includedMonths, "üfüqünü");
  const excluded = duration(excludedMonths, "müddəti");
  if (locale === "az-AZ") {
    const horizonContext = included === null
      ? ""
      : excluded === null
        ? `${included[0]!.toLocaleUpperCase("az-AZ")}${included.slice(1)} nəzərə aldım. `
        : `${included[0]!.toLocaleUpperCase("az-AZ")}${included.slice(1)} və ${excluded} istəmədiyinizi nəzərə aldım. `;
    return `${horizonContext}Konkret ETF-i sizə uyğun kimi qiymətləndirmək üçün risk və itkiyə dözümlülüyünüzü, likvidlik ehtiyacınızı və mövcud portfelinizin əsas bölgüsünü yazın. İki konkret ticker versəniz, onları yoxlanmış alət məlumatları ilə müqayisə edə bilərəm; uyğunluq və ya al/sat nəticəsi çıxarmayacağam.`;
  }
  const horizonContext = included === null
    ? ""
    : excluded === null
      ? `I noted the ${included}. `
      : `I noted the ${included} and that you excluded the ${excluded}. `;
  return `${horizonContext}To assess ETF fit without guessing, provide your loss tolerance, liquidity needs, and the main allocation of your existing portfolio. If you name two exact tickers, I can compare them using verified tool evidence without producing a suitability or buy/sell conclusion.`;
}

function workflowIdFor(route: V3RouteDecision): V3CapabilityBundle["workflowId"] {
  if (route.route === "conversation") return "assistant-request-v3";
  if (route.route === "order_ticket_preview") return "order-ticket-handoff-v3";
  if (
    route.route === "fees_tariff" ||
    route.route === "approved_knowledge" ||
    route.route === "education"
  ) {
    return "approved-knowledge-v3";
  }
  if (route.route !== null && PORTFOLIO_ROUTES.has(route.route)) return "portfolio-insight-v3";
  if (route.kind === "boundary" || route.kind === "clarify") return "assistant-request-v3";
  return "public-research-v3";
}

function telemetryWorkflowFor(route: V3RouteDecision): V3Workflow {
  const workflowId = workflowIdFor(route);
  return workflowId.replaceAll("-", "_") as V3Workflow;
}

function telemetryIntentFor(route: V3RouteDecision): V3Intent {
  if (route.kind === "boundary") return "safety";
  if (route.route === "conversation") return "unknown";
  if (route.route === "order_ticket_preview") return "order_handoff";
  if (route.route === "education") return "education";
  if (
    route.route === "fees_tariff" ||
    route.route === "approved_knowledge"
  ) {
    return "approved_knowledge";
  }
  if (route.route !== null && PORTFOLIO_ROUTES.has(route.route)) return "portfolio";
  if (route.kind === "clarify") return "unknown";
  return "market_research";
}

const RESPONSE_SCORER_GATES: Readonly<Record<string, V3Gate>> = {
  "v3.response.required-tool-set": "required_tool",
  "v3.response.tool-envelope-integrity": "evidence_signature",
  "v3.response.fact-derivation": "numeric_integrity",
  "v3.response.material-claim-lineage": "evidence_signature",
  "v3.response.navigation-integrity": "route_fidelity",
  "v3.response.citation-integrity": "citation_grounding",
  "v3.response.numeric-date-grounding": "numeric_integrity",
  "v3.response.conversational-quality": "language"
};

function safeClarification(route: V3RouteDecision): V3RouteDecision {
  return Object.freeze({
    ...route,
    kind: "clarify" as const,
    route: null,
    mvpFunction: null,
    researchFacet: null,
    boundary: null,
    confidence: 1,
    reasonCodes: Object.freeze(["instrument_symbol_required"]),
    requiresPortfolio: false,
    requiresMarketData: false,
    requiresKnowledge: false,
    readOnly: true
  });
}

function productKnowledgeProfileClarification(
  route: V3RouteDecision
): V3RouteDecision {
  return Object.freeze({
    ...route,
    kind: "clarify" as const,
    route: null,
    mvpFunction: null,
    researchFacet: null,
    boundary: null,
    confidence: 1,
    reasonCodes: Object.freeze(["product_knowledge_profile_not_configured"]),
    requiresPortfolio: false,
    requiresMarketData: false,
    requiresKnowledge: false,
    readOnly: true
  });
}

function asEnvelope<TResult>(value: ToolExecutionEnvelope<unknown>): ToolExecutionEnvelope<TResult> {
  return value as ToolExecutionEnvelope<TResult>;
}

function orderAction(
  prepared: V3PreparedResponse
): AssistantAction & {
  kind: "open-signed-order-ticket";
  intentId: string;
  expiresAt: string;
} {
  const action = prepared.actions.find((candidate) =>
    candidate.kind === "open-signed-order-ticket"
  );
  if (
    action?.kind !== "open-signed-order-ticket" ||
    action.intentId === null ||
    action.expiresAt === null ||
    !Number.isFinite(Date.parse(action.expiresAt))
  ) {
    throw new Error("The suspended order preview has no valid intent or expiry binding.");
  }
  return action as AssistantAction & {
    kind: "open-signed-order-ticket";
    intentId: string;
    expiresAt: string;
  };
}

function actionIntent(prepared: V3PreparedResponse): string {
  return orderAction(prepared).intentId;
}

function buildToolArgumentRecords(executed: readonly ExecutedTool[]) {
  return executed.map(({ envelope, arguments: args }) => ({
    executionId: envelope.executionId,
    arguments: args
  }));
}

function elapsedMetricMs(startedAt: number): number {
  return Math.min(600_000, Math.max(0, performance.now() - startedAt));
}

export class V3AssistantRuntime implements V3AssistantHttpRuntime {
  readonly #signer: DevHmacSigner;
  readonly #sessionAuthority: V3SessionAuthority;
  readonly #contextAuthority: TrustedRequestContextAuthority;
  readonly #confirmationAuthority: OrderConfirmationAuthority;
  readonly #grantAuthority: V3ToolGrantAuthority;
  readonly #orderHandoffStore: OrderHandoffStore;
  readonly #approvedKnowledge: ApprovedKnowledgeServicePort;
  readonly #governedNavigation = new GovernedInAppNavigationService();
  readonly #governedReadOnlyNavigation = new GovernedReadOnlyNavigationService();
  readonly #audit: V3AuditOutbox;
  readonly #telemetry: V3TelemetryMetrics | undefined;
  readonly #environment: TrustedRequestContext["environment"];
  readonly #sessionTtlMs: number;
  readonly #modelTimeoutMs: number;
  readonly #sessionCapacity: number;
  readonly #orderStateCapacity: number;
  readonly #now: () => number;
  readonly #conversationMemory: V3ConversationMemoryPort | null;
  readonly #productKnowledgeEnabled: boolean;
  readonly #sessions = new Map<string, RuntimeSessionRecord>();
  readonly #sessionTurnTails = new Map<string, Promise<void>>();
  readonly #pendingMemoryAssistance = new Map<string, PendingMemoryAssistance>();
  /**
   * Fail-closed, process-local quarantine for a session whose memory boundary
   * failed. A recovered backing store must not make its previous subject
   * visible again until that exact scope is successfully cleared or replaced
   * by a new explicit anchor.
   */
  readonly #blockedConversationMemorySessions = new Set<string>();
  readonly #suspendedOrders = new Map<string, SuspendedOrderRecord>();
  readonly #confirmedHandoffs = new Map<string, SignedOrderHandoff>();
  readonly #issuedOrderHandoffs = new Map<string, IssuedOrderHandoffRecord>();
  readonly #disabledRoutes = new Set<V3Function>();
  #topology: V3RuntimeTopology | null = null;
  #financialTaskPlanner: V3FinancialTaskPlannerPort | null = null;

  constructor(options: V3AssistantRuntimeOptions) {
    this.#signer = options.signer;
    this.#sessionAuthority = options.sessionAuthority;
    this.#contextAuthority = options.contextAuthority;
    this.#confirmationAuthority = options.confirmationAuthority;
    this.#grantAuthority = options.grantAuthority;
    this.#orderHandoffStore = options.orderHandoffStore;
    this.#approvedKnowledge = options.approvedKnowledge;
    this.#audit = options.audit ?? new V3AuditOutbox(
      options.now === undefined ? {} : { now: options.now }
    );
    this.#telemetry = options.telemetry;
    this.#environment = options.environment ?? "development";
    this.#sessionTtlMs = options.sessionTtlMs ?? 30 * 60_000;
    this.#modelTimeoutMs = options.modelTimeoutMs ?? 12_000;
    this.#sessionCapacity = runtimeStateCapacity(
      options.sessionCapacity,
      DEFAULT_RUNTIME_SESSION_CAPACITY,
      "Runtime session capacity"
    );
    this.#orderStateCapacity = runtimeStateCapacity(
      options.orderStateCapacity,
      DEFAULT_RUNTIME_ORDER_STATE_CAPACITY,
      "Runtime order-state capacity"
    );
    this.#now = options.now ?? Date.now;
    this.#conversationMemory = options.conversationMemory === false
      ? null
      : options.conversationMemory ?? new BoundedV3ConversationMemory({
          signer: options.signer,
          now: this.#now
        });
    this.#productKnowledgeEnabled = options.productKnowledgeEnabled ?? true;
  }

  attachTopology(topology: V3RuntimeTopology): void {
    if (this.#topology !== null) throw new Error("V3 runtime topology is already attached.");
    this.#topology = topology;
  }

  attachFinancialTaskPlanner(planner: V3FinancialTaskPlannerPort): void {
    if (this.#financialTaskPlanner !== null) {
      throw new Error("V3 financial task planner is already attached.");
    }
    this.#financialTaskPlanner = planner;
  }

  workflowDependencies(): Omit<V3WorkflowDependencies, "writers"> {
    return {
      evidence: new EvidenceFactory({ signer: this.#signer, now: this.#now }),
      modelTimeoutMs: this.#modelTimeoutMs,
      ...(this.#telemetry === undefined ? {} : { telemetry: this.#telemetry }),
      authorize: (input) => this.authorize(input),
      acquirePublic: (invocation, workflowRunId) => this.acquirePublic(invocation, workflowRunId),
      acquirePortfolio: (invocation, workflowRunId, tracingContext) =>
        this.acquirePortfolio(invocation, workflowRunId, tracingContext),
      acquireKnowledge: (invocation, workflowRunId, tracingContext) =>
        this.acquireKnowledge(invocation, workflowRunId, tracingContext),
      prepareOrder: (invocation, workflowRunId) => this.prepareOrder(invocation, workflowRunId),
      confirmOrder: (prepared, token) => this.confirmOrder(prepared, token),
      deterministicBoundary: (invocation, workflowRunId) =>
        this.deterministicBoundary(invocation, workflowRunId),
      finalize: (prepared) => this.finalize(prepared),
      rememberOrderRun: (prepared, runId, run) => this.rememberOrderRun(prepared, runId, run)
    };
  }

  async createSession(input: { locale?: SupportedLocale }): Promise<V3HttpCreatedSession> {
    this.#purgeExpiredSessionState();
    if (this.#sessions.size >= this.#sessionCapacity) {
      throw new V3HttpRuntimeError(
        "unavailable",
        "Runtime session capacity is exhausted; retry after an existing session expires."
      );
    }
    const locale = input.locale ?? "az-AZ";
    const issued = this.#sessionAuthority.issue({
      tenantId: "tenant:demo-invest",
      principalId: "principal:mock-client-001",
      authContextId: `auth:${randomUUID()}`,
      consentVersion: "internal-pilot-consent-v3",
      consents: [
        "assistant_use",
        "portfolio_data",
        "public_market_data",
        ...(this.#productKnowledgeEnabled ? ["approved_knowledge" as const] : [])
      ],
      entitlementVersion: "internal-pilot-entitlements-v3",
      entitlements: [
        "assistant_access",
        "portfolio_read",
        "market_read",
        "research_read",
        ...(this.#productKnowledgeEnabled ? ["knowledge_read" as const] : []),
        "order_preview"
      ],
      ttlMs: this.#sessionTtlMs
    });
    const conversationId = randomUUID();
    this.#sessions.set(issued.session.claims.sessionId, {
      conversationId,
      preferredLocale: locale,
      expiresAt: issued.session.claims.expiresAt
    });
    return {
      sessionToken: issued.token,
      sessionId: issued.session.claims.sessionId,
      conversationId,
      locale,
      expiresAt: new Date(issued.session.claims.expiresAt).toISOString(),
      consent: {
        status: "granted",
        version: issued.session.claims.consentVersion,
        scopes: [...issued.session.claims.consents]
      },
      capabilities: [
        "public-research",
        "portfolio-insight",
        ...(this.#productKnowledgeEnabled ? ["approved-knowledge" as const] : []),
        "order-ticket-preview",
        ...(this.#conversationMemory === null ? [] : ["bounded-conversation-context"])
      ]
    };
  }

  async message(input: { sessionToken: string; message: string }): Promise<AssistantResponse> {
    const finishWorkflow = this.#telemetry?.startWorkflowTimer("assistant_request_v3");
    try {
      this.#purgeExpiredOrderState();
      const initialSession = this.#verifySession(input.sessionToken);
      return await this.#withSessionTurn(initialSession.claims.sessionId, async () => {
        const topology = this.#requireTopology();
        // Reverify after queueing because an otherwise valid session may expire
        // while an earlier turn is still running.
        const session = this.#verifySession(input.sessionToken);
        const record = this.#sessions.get(session.claims.sessionId);
        if (!record) {
          throw new V3HttpRuntimeError("invalid_session", "Session state is missing.");
        }
        const context = this.#trustedContext(session, record);
        try {
          const contextToken = this.#contextAuthority.issue(context, session);
          const run = await topology.workflows.assistantRequest.createRun({
            resourceId: session.tokenHash
          });
          const result = await run.start({ inputData: { message: input.message, contextToken } });
          if (result.status !== "success") {
            throw new V3HttpRuntimeError(
              "unavailable",
              `V3 workflow failed with ${result.status}.`
            );
          }
          finishWorkflow?.("success");
          return result.result;
        } finally {
          this.#pendingMemoryAssistance.delete(context.requestId);
        }
      });
    } catch (error) {
      finishWorkflow?.("error");
      throw error;
    }
  }

  async confirmOrderHandoff(input: {
    sessionToken: string;
    intentId: string;
    confirmed: true;
  }): Promise<SignedOrderHandoff> {
    this.#purgeExpiredOrderState();
    const session = this.#verifySession(input.sessionToken);
    const previouslyIssued = this.#issuedOrderHandoffs.get(input.intentId);
    if (previouslyIssued) {
      if (Date.parse(previouslyIssued.handoff.expiresAt) <= this.#now()) {
        this.#issuedOrderHandoffs.delete(input.intentId);
      } else if (
        previouslyIssued.sessionId !== session.claims.sessionId ||
        previouslyIssued.principalRef !== session.claims.principalId
      ) {
        throw new V3HttpRuntimeError(
          "forbidden",
          "Order handoff belongs to another session or principal."
        );
      } else {
        return structuredClone(previouslyIssued.handoff);
      }
    }
    const suspended = this.#suspendedOrders.get(input.intentId);
    if (!suspended) throw new V3HttpRuntimeError("expired", "Order preview is missing.");
    if (
      suspended.sessionId !== session.claims.sessionId ||
      suspended.principalRef !== session.claims.principalId
    ) {
      throw new V3HttpRuntimeError("forbidden", "Order preview principal mismatch.");
    }
    if (
      !this.#issuedOrderHandoffs.has(input.intentId) &&
      this.#issuedOrderHandoffs.size >= this.#orderStateCapacity
    ) {
      throw new V3HttpRuntimeError(
        "unavailable",
        "Order handoff capacity is exhausted; retry after an existing handoff expires or is opened."
      );
    }
    const token = this.#confirmationAuthority.issue({
      intentId: input.intentId,
      sessionId: suspended.sessionId,
      principalRef: suspended.principalRef
    });
    const result = await suspended.run.resume({
      step: "await-explicit-order-confirmation",
      resumeData: { confirmed: true, confirmationToken: token }
    }) as { status?: string };
    if (result.status !== "success") {
      throw new V3HttpRuntimeError("conflict", `Order workflow resume returned ${result.status}.`);
    }
    const handoff = this.#confirmedHandoffs.get(input.intentId);
    if (!handoff) throw new V3HttpRuntimeError("unavailable", "Signed handoff was not produced.");
    this.#purgeExpiredOrderState();
    if (
      !this.#issuedOrderHandoffs.has(input.intentId) &&
      this.#issuedOrderHandoffs.size >= this.#orderStateCapacity
    ) {
      throw new V3HttpRuntimeError(
        "unavailable",
        "Order handoff capacity was exhausted before the handoff could be retained."
      );
    }
    this.#audit.append({
      eventType: "order-handoff-confirmed",
      requestId: suspended.prepared.invocation.context.requestId,
      workflowRunId: suspended.prepared.workflowRunId,
      tenantId: session.claims.tenantId,
      principalFingerprint: v3PrincipalFingerprint(session),
      payload: {
        intentId: input.intentId,
        handoffId: handoff.payload.handoffId,
        expiresAt: handoff.expiresAt,
        executionAllowed: false
      }
    });
    this.#issuedOrderHandoffs.set(input.intentId, {
      sessionId: session.claims.sessionId,
      principalRef: session.claims.principalId,
      handoff: structuredClone(handoff)
    });
    this.#suspendedOrders.delete(input.intentId);
    this.#confirmedHandoffs.delete(input.intentId);
    return structuredClone(handoff);
  }

  async openOrderHandoff(input: {
    sessionToken: string;
    handoff: SignedOrderHandoff;
  }): Promise<OrderHandoffScreenState> {
    this.#purgeExpiredOrderState();
    const session = this.#verifySession(input.sessionToken);
    const record = this.#sessions.get(session.claims.sessionId);
    if (!record) {
      throw new V3HttpRuntimeError("invalid_session", "Session state is missing.");
    }
    const context = this.#trustedContext(session, record);
    let payload;
    try {
      payload = this.#orderHandoffStore.consume(input.handoff, context);
    } catch (error) {
      throw new V3HttpRuntimeError(
        "forbidden",
        error instanceof Error ? error.message : "Order handoff verification failed."
      );
    }
    const screen = orderHandoffScreenState(payload);
    this.#audit.append({
      eventType: "order-handoff-opened",
      requestId: context.requestId,
      workflowRunId: null,
      tenantId: session.claims.tenantId,
      principalFingerprint: v3PrincipalFingerprint(session),
      payload: {
        handoffId: payload.handoffId,
        intentId: payload.intentId,
        expiresAt: payload.expiresAt,
        submissionAllowed: screen.submissionAllowed
      }
    });
    this.#issuedOrderHandoffs.delete(payload.intentId);
    return screen;
  }

  #verifySession(token: string): V3TrustedSession {
    try {
      return this.#sessionAuthority.verify(token, {
        tenantId: "tenant:demo-invest",
        principalId: "principal:mock-client-001"
      });
    } catch (error) {
      if (error instanceof V3SessionError) {
        throw new V3HttpRuntimeError("invalid_session", error.code);
      }
      throw error;
    }
  }

  #trustedContext(
    session: V3TrustedSession,
    record: RuntimeSessionRecord
  ): TrustedRequestContext {
    return {
      schemaVersion: "assistant-v3.request-context.v1",
      requestId: randomUUID(),
      sessionId: session.claims.sessionId,
      conversationId: record.conversationId,
      principalRef: session.claims.principalId,
      tenantRef: session.claims.tenantId,
      locale: record.preferredLocale,
      jurisdiction: "AZ",
      channel: "web",
      environment: this.#environment,
      requestedAt: new Date(this.#now()).toISOString(),
      authentication: {
        strength: session.claims.authLevel,
        authContextRef: session.claims.authContextId
      },
      consentVersion: session.claims.consentVersion,
      consentScopes: [...session.claims.consents],
      entitlementVersion: session.claims.entitlementVersion,
      entitlements: [...session.claims.entitlements],
      policyVersion: "3.0.0",
      capabilities: [
        "portfolio-read",
        "market-read",
        ...(this.#productKnowledgeEnabled ? ["approved-knowledge-read" as const] : []),
        "order-preview",
        ...(this.#conversationMemory === null ? [] : ["bounded-conversation-context"])
      ],
      featureSnapshot: {
        version: "internal-pilot-v3",
        flags: {
          publicResearch: true,
          portfolioInsight: true,
          approvedKnowledge: this.#productKnowledgeEnabled,
          signedOrderHandoff: true,
          readOnlyNavigation: true,
          boundedConversationContext: this.#conversationMemory !== null
        }
      }
    };
  }

  private async authorize(input: {
    message: string;
    contextToken: string;
  }): Promise<V3WorkflowInvocation> {
    const trusted = this.#contextAuthority.consume(input.contextToken);
    let route = routeV3Request(input.message, { locale: trusted.context.locale });
    const memoryScope: V3ConversationMemoryScope = {
      context: trusted.context,
      session: trusted.session
    };
    if (route.kind === "boundary") {
      this.#clearConversationMemory(memoryScope);
    } else if (
      this.#conversationMemory !== null &&
      route.route !== "order_ticket_preview" &&
      (isV3ConversationContextRoute(route.route) || route.kind === "clarify") &&
      hasV3ConversationFollowUpMarker(input.message, {
        explicitSymbols: route.symbols.length > 0,
        explicitFacet: isV3ConversationContextRoute(route.route)
      })
    ) {
      const memoryRead = this.#readConversationMemory(
        memoryScope,
        isV3ConversationContextRoute(route.route) ? route.route : null
      );
      if (memoryRead.status === "hit") {
        const contextualRoute = applyV3ConversationRouteContext({
          message: input.message,
          route,
          rememberedRoute: memoryRead.snapshot.lastRoute,
          rememberedSymbols: memoryRead.snapshot.symbols
        });
        if (contextualRoute !== route) {
          this.#pendingMemoryAssistance.set(trusted.context.requestId, {
            expectedVersion: memoryRead.snapshot.version,
            expectedRevision: memoryRead.snapshot.revision
          });
          route = contextualRoute;
        }
      }
    }
    if (
      route.kind === "clarify" &&
      route.route === null &&
      route.reasonCodes.length === 1 &&
      route.reasonCodes[0] === "no_deterministic_route" &&
      this.#financialTaskPlanner !== null
    ) {
      const plannedRoute = await this.#financialTaskPlanner.resolve({
        message: input.message,
        locale: trusted.context.locale
      });
      if (plannedRoute !== null) route = plannedRoute;
    }
    if (
      !this.#productKnowledgeEnabled &&
      (route.route === "fees_tariff" || route.route === "approved_knowledge")
    ) {
      route = productKnowledgeProfileClarification(route);
    }
    if (
      route.route !== null &&
      (
        (SINGLE_SYMBOL_ROUTES.has(route.route) && route.symbols.length !== 1) ||
        (SYMBOL_REQUIRED_ROUTES.has(route.route) && route.symbols.length === 0)
      )
    ) {
      route = safeClarification(route);
    }
    if (route.route !== null && this.#disabledRoutes.has(route.route)) {
      throw new V3HttpRuntimeError("unavailable", `Capability ${route.route} is disabled by a P0 gate.`);
    }
    const policy = evaluateV3Policy({ route, session: trusted.session, now: this.#now() });
    if (route.route !== null && route.kind !== "boundary" && route.kind !== "clarify") {
      enforceV3PolicyAgreement(route, policy, trusted.session, this.#now());
    }
    const telemetryIntent = telemetryIntentFor(route);
    this.#telemetry?.recordRequest({
      intent: telemetryIntent,
      workflow: telemetryWorkflowFor(route),
      locale: trusted.context.locale
    });
    this.#telemetry?.recordGate({
      gate: "authentication",
      passed: true,
      intent: telemetryIntent
    });
    this.#telemetry?.recordGate({
      gate: "route_fidelity",
      passed: route.kind !== "clarify",
      intent: telemetryIntent
    });
    if (route.kind === "boundary") {
      this.#telemetry?.recordGate({
        gate: route.boundary === "order_execution" ? "execution_boundary" : "privacy",
        passed: true,
        intent: telemetryIntent
      });
    } else if (route.kind !== "clarify") {
      this.#telemetry?.recordGate({
        gate: "authorization",
        passed: policy.authorized,
        intent: telemetryIntent
      });
    }
    return {
      message: input.message,
      context: trusted.context,
      session: trusted.session,
      policy,
      route
    };
  }

  async #executeTool(
    invocation: V3WorkflowInvocation,
    workflowRunId: string,
    toolId: V3ApprovedBoundaryToolId,
    args: unknown,
    policy: V3PolicyDecision = invocation.policy,
    tracingContext?: TracingContext
  ): Promise<ExecutedTool> {
    const topology = this.#requireTopology();
    const grant = this.#grantAuthority.issue({
      requestId: invocation.context.requestId,
      workflowRunId,
      route: invocation.route,
      policy,
      session: invocation.session,
      toolId,
      args
    });
    const execution: V3BoundaryExecutionContext = {
      grantToken: grant.token,
      requestId: invocation.context.requestId,
      workflowRunId,
      policy,
      session: invocation.session,
      trustedContext: invocation.context
    };
    const requestContext = new RequestContext<unknown>([
      [V3_BOUNDARY_EXECUTION_CONTEXT_KEY, execution]
    ]);
    const tool = topology.tools[toolId] as unknown as {
      execute?: (args: unknown, runtime: {
        requestContext: RequestContext<unknown>;
        tracingContext?: TracingContext;
      }) => Promise<unknown>;
    };
    if (!tool.execute) throw new Error(`${toolId} has no execution boundary.`);
    const toolSpan = tracingContext?.currentSpan?.createChildSpan({
      name: toolId,
      type: SpanType.TOOL_CALL,
      attributes: {
        toolType: "signed-boundary",
        toolDescription: "Policy-authorized signed evidence boundary"
      }
    });
    try {
      const envelope = await tool.execute(args, {
        requestContext,
        ...(toolSpan === undefined
          ? tracingContext === undefined ? {} : { tracingContext }
          : { tracingContext: { currentSpan: toolSpan } })
      }) as ToolExecutionEnvelope<unknown>;
      toolSpan?.end({
        attributes: { success: envelope.status === "success" }
      });
      this.#telemetry?.recordTool({
        tool: toolId,
        result: envelope.status === "success" ? "success" : "error"
      });
      return { envelope, arguments: args };
    } catch (error) {
      toolSpan?.end({ attributes: { success: false } });
      throw error;
    }
  }

  #baseBundle(input: {
    invocation: V3WorkflowInvocation;
    workflowRunId: string;
    executed: ExecutedTool[];
    presentation?: CapabilityPresentation;
    actions?: AssistantAction[];
    deterministicMessage?: string;
  }): V3CapabilityBundle {
    const presentation = input.presentation;
    const projectionEvidence = new EvidenceFactory({
      signer: this.#signer,
      now: this.#now
    });
    const readOnlyNavigation = presentation?.status === "complete"
      ? this.#governedReadOnlyNavigation.evaluate({
          context: input.invocation.context,
          route: input.invocation.route,
          facts: presentation.facts,
          cards: presentation.cards,
          tools: input.executed.map(({ envelope, arguments: args }) => ({
            envelope,
            arguments: args
          })),
          factBindings: presentation.renderableFacts.map(({ alias, fact }) => ({
            alias,
            factId: fact.factId
          })),
          signer: this.#signer
        })
      : null;
    const actions = [
      ...(input.actions ?? []),
      ...(readOnlyNavigation?.status === "allowed"
        ? [readOnlyNavigation.action]
        : [])
    ];
    return {
      invocation: input.invocation,
      workflowId: workflowIdFor(input.invocation.route),
      workflowRunId: input.workflowRunId,
      status: presentation?.status ?? "unavailable",
      tools: input.executed.map(({ envelope }) => envelope),
      toolArguments: buildToolArgumentRecords(input.executed),
      facts: presentation?.facts ?? [],
      citations: presentation?.citations ?? [],
      cards: presentation?.cards ?? [],
      charts: presentation?.charts ?? [],
      actions,
      notices: presentation?.notices ?? [],
      freshness: presentation?.freshness ?? [],
      renderableFacts: (presentation?.renderableFacts ?? []).map((item) =>
        sealRenderableFact(item, projectionEvidence)
      ),
      renderableCitations: presentation?.renderableCitations ?? [],
      fallback: presentation?.fallback ?? [],
      writerGoal: presentation?.writerGoal ?? "explain an unavailable evidence result",
      deterministicMessage: input.deterministicMessage ?? null
    };
  }

  private async acquirePublic(
    invocation: V3WorkflowInvocation,
    workflowRunId: string
  ): Promise<V3CapabilityBundle> {
    const route = invocation.route.route;
    if (
      route !== "market_quote" &&
      route !== "market_history" &&
      route !== "market_event" &&
      route !== "company_research" &&
      route !== "technical_analysis" &&
      route !== "news_sentiment" &&
      route !== "market_move_explanation" &&
      route !== "security_risk" &&
      route !== "etf_explanation_risk"
    ) throw new Error("Public workflow received an unsupported route.");
    const executed: ExecutedTool[] = [];
    const requestedQuoteCurrency = invocation.route.reasonCodes.includes(
      "market_quote_currency:AZN"
    )
      ? "AZN" as const
      : null;
    for (const symbol of invocation.route.symbols) {
      executed.push(await this.#executeTool(invocation, workflowRunId, "resolve-instrument", { symbol }));
      if (route === "market_quote") {
        executed.push(await this.#executeTool(
          invocation,
          workflowRunId,
          requestedQuoteCurrency === null
            ? "read-market-snapshot"
            : "convert-currency",
          requestedQuoteCurrency === null
            ? { symbol }
            : {
                scope: "current-market-price",
                symbol,
                targetCurrency: requestedQuoteCurrency
              }
        ));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-price-history", { symbol, range: "10y" }));
      } else if (route === "market_history") {
        const range = marketHistoryRangeFromRoute(invocation.route);
        if (range === null) throw new Error("Market-history route has no reviewed range.");
        executed.push(await this.#executeTool(
          invocation,
          workflowRunId,
          "read-price-history",
          { symbol, range }
        ));
      } else if (route === "company_research") {
        if (invocation.route.researchFacet === "listing") continue;
        if (invocation.route.researchFacet !== "general") {
          executed.push(await this.#executeTool(invocation, workflowRunId, "read-instrument-research", { symbol }));
          continue;
        }
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-market-snapshot", { symbol }));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-instrument-research", { symbol }));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-price-history", { symbol, range: "10y" }));
      } else if (route === "etf_explanation_risk") {
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-market-snapshot", { symbol }));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-instrument-research", { symbol }));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-price-history", { symbol, range: "10y" }));
      } else if (route === "technical_analysis") {
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-price-history", { symbol, range: "1y" }));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-price-history", { symbol, range: "10y" }));
      } else if (route === "market_move_explanation") {
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-market-snapshot", { symbol }));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-price-history", { symbol, range: "1d" }));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-market-content", { symbol }));
      } else if (route === "news_sentiment" || route === "market_event") {
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-market-content", { symbol }));
      } else {
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-instrument-research", { symbol }));
        if (invocation.route.researchFacet === "risk_comparison") continue;
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-price-history", { symbol, range: "1y" }));
        executed.push(await this.#executeTool(invocation, workflowRunId, "read-price-history", { symbol, range: "10y" }));
      }
    }
    const unresolved = executed.find(({ envelope }) =>
      envelope.toolId === "resolve-instrument" &&
      envelope.status === "success" &&
      envelope.result === null
    );
    if (unresolved !== undefined) {
      const candidate = typeof unresolved.arguments === "object" &&
        unresolved.arguments !== null &&
        !Array.isArray(unresolved.arguments) &&
        "symbol" in unresolved.arguments &&
        typeof unresolved.arguments.symbol === "string"
        ? unresolved.arguments.symbol
        : null;
      return this.#baseBundle({
        invocation,
        workflowRunId,
        executed,
        deterministicMessage: invocation.context.locale === "az-AZ"
          ? candidate === null
            ? "Bu tickeri təsdiqlənmiş alət siyahısında tapa bilmədim. Yazılışı yoxlayın."
            : `${candidate} tickerini təsdiqlənmiş alət siyahısında tapa bilmədim. Yazılışı yoxlayın və ya şirkətin tam adını yazın.`
          : candidate === null
            ? "I could not verify that ticker in the instrument list. Check the spelling."
            : `I could not verify ${candidate} in the instrument list. Check the ticker spelling or provide the company name.`
      });
    }
    try {
      const presentation = buildPublicCapabilityPresentation({
        route,
        researchFacet: invocation.route.researchFacet,
        symbols: invocation.route.symbols,
        context: invocation.context,
        workflowRunId,
        tools: executed.map(({ envelope }) => envelope),
        signer: this.#signer
      });
      return this.#baseBundle({ invocation, workflowRunId, executed, presentation });
    } catch {
      return this.#baseBundle({
        invocation,
        workflowRunId,
        executed,
        deterministicMessage: unavailableMessage(invocation.context.locale)
      });
    }
  }

  private async acquirePortfolio(
    invocation: V3WorkflowInvocation,
    workflowRunId: string,
    tracingContext?: TracingContext
  ): Promise<V3CapabilityBundle> {
    const requestedRoute = invocation.route.route;
    if (requestedRoute === "portfolio_allocation_analysis") {
      const executed = [await this.#executeTool(
        invocation,
        workflowRunId,
        "analyze-portfolio-allocation",
        { scope: "current" } satisfies PortfolioAllocationAnalysisArguments,
        invocation.policy,
        tracingContext
      )];
      try {
        const presentation = buildCurrentPortfolioAllocationPresentation({
          context: invocation.context,
          workflowRunId,
          tools: executed.map(({ envelope }) => envelope),
          signer: this.#signer,
          lens: invocation.route.reasonCodes.includes(
            "portfolio_nonadvisory_review_marker"
          )
            ? "nonadvisory-review"
            : "risk"
        });
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          presentation
        });
      } catch {
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          deterministicMessage: unavailableMessage(invocation.context.locale)
        });
      }
    }
    if (requestedRoute === "hypothetical_portfolio_analysis") {
      const parsed = parseHypotheticalPortfolioScenario(invocation.message);
      if (parsed.status !== "supported") {
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed: [],
          deterministicMessage: invocation.context.locale === "az-AZ"
            ? "Hipotetik portfeli təhlil etmək üçün iki və ya daha çox faiz bölgüsü yazın; faizlər 100%-ə bərabər olmalı və nağd vəsait ayrıca göstərilməlidir."
            : "To analyze a hypothetical portfolio, provide at least two percentage allocations that total 100%, including cash as a separate allocation."
        });
      }
      const argumentsForAnalysis: PortfolioAllocationAnalysisArguments = {
        scope: "hypothetical",
        currency: parsed.scenario.currency,
        totalValue: parsed.scenario.totalValue,
        allocations: parsed.scenario.allocations
      };
      const executed = [await this.#executeTool(
        invocation,
        workflowRunId,
        "analyze-portfolio-allocation",
        argumentsForAnalysis,
        invocation.policy,
        tracingContext
      )];
      try {
        const presentation = buildHypotheticalPortfolioPresentation({
          scenario: parsed.scenario,
          context: invocation.context,
          workflowRunId,
          tools: executed.map(({ envelope }) => envelope),
          signer: this.#signer
        });
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          presentation
        });
      } catch {
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          deterministicMessage: unavailableMessage(invocation.context.locale)
        });
      }
    }
    if (requestedRoute === "hypothetical_position_analysis") {
      const symbol = invocation.route.symbols[0];
      if (!symbol || invocation.route.symbols.length !== 1) {
        throw new Error("Hypothetical position analysis requires exactly one instrument.");
      }
      const parsed = parseHypotheticalPositionScenario(invocation.message, symbol);
      if (parsed.status !== "supported") {
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed: [],
          deterministicMessage: invocation.context.locale === "az-AZ"
            ? "Hipotetik mövqeni müqayisə etmək üçün səhm sayını və səhm başına alış qiymətini yazın."
            : "To compare a hypothetical position, provide the share count and purchase price per share."
        });
      }
      const executed: ExecutedTool[] = [];
      executed.push(await this.#executeTool(
        invocation,
        workflowRunId,
        "resolve-instrument",
        { symbol }
      ));
      executed.push(await this.#executeTool(
        invocation,
        workflowRunId,
        "read-market-snapshot",
        { symbol }
      ));
      try {
        const presentation = buildHypotheticalPositionPresentation({
          scenario: parsed.scenario,
          context: invocation.context,
          workflowRunId,
          tools: executed.map(({ envelope }) => envelope),
          signer: this.#signer
        });
        return this.#baseBundle({ invocation, workflowRunId, executed, presentation });
      } catch {
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          deterministicMessage: unavailableMessage(invocation.context.locale)
        });
      }
    }
    if (requestedRoute === "security_decision_support") {
      const symbol = invocation.route.symbols[0];
      if (!symbol || invocation.route.symbols.length !== 1) {
        throw new Error("Decision support requires exactly one instrument.");
      }
      const executed: ExecutedTool[] = [];
      const portfolio = await this.#executeTool(
        invocation,
        workflowRunId,
        "read-portfolio-snapshot",
        {}
      );
      executed.push(portfolio);
      const snapshot = portfolio.envelope.status === "success"
        ? portfolio.envelope.result as MockPortfolioPositionSnapshot | null
        : null;
      const holdingSymbols = snapshot === null
        ? []
        : [...new Set(snapshot.currentLots.map((lot) => lot.symbol))].sort();
      executed.push(await this.#executeTool(
        invocation,
        workflowRunId,
        "resolve-instrument",
        { symbol }
      ));
      for (const holdingSymbol of [...new Set([...holdingSymbols, symbol])].sort()) {
        executed.push(await this.#executeTool(
          invocation,
          workflowRunId,
          "read-market-snapshot",
          { symbol: holdingSymbol }
        ));
      }
      executed.push(await this.#executeTool(
        invocation,
        workflowRunId,
        "read-instrument-research",
        { symbol }
      ));
      executed.push(await this.#executeTool(
        invocation,
        workflowRunId,
        "read-market-content",
        { symbol }
      ));
      try {
        const presentation = buildSecurityDecisionSupportPresentation({
          symbol,
          context: invocation.context,
          workflowRunId,
          tools: executed.map(({ envelope }) => envelope),
          signer: this.#signer
        });
        return this.#baseBundle({ invocation, workflowRunId, executed, presentation });
      } catch {
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          deterministicMessage: unavailableMessage(invocation.context.locale)
        });
      }
    }
    if (
      requestedRoute === "recent_trading_activity" ||
      requestedRoute === "purchase_history"
    ) {
      const route: PortfolioActivityRoute = requestedRoute;
      const argumentsForTool = portfolioActivityToolArguments({
        route,
        symbols: invocation.route.symbols
      });
      const activity = await this.#executeTool(
        invocation,
        workflowRunId,
        "read-portfolio-activity",
        argumentsForTool
      );
      const executed = [activity];
      try {
        const fact = projectPortfolioActivityFact({
          context: invocation.context,
          workflowRunId,
          route,
          expectedArguments: argumentsForTool,
          activityExecution: asEnvelope<RecentTradingActivityResult>(activity.envelope),
          signer: this.#signer
        });
        const activityPresentation = buildPortfolioActivityPresentation({
          fact,
          locale: invocation.context.locale
        });
        const presentation: CapabilityPresentation = {
          status: "complete",
          facts: [...activityPresentation.facts],
          renderableFacts: [...activityPresentation.renderableFacts],
          citations: [],
          renderableCitations: [],
          cards: [...activityPresentation.cards],
          charts: [],
          freshness: [],
          notices: [...activityPresentation.notices, "Client portfolio data is synthetic."],
          fallback: [...activityPresentation.fallback],
          writerGoal: activityPresentation.writerGoal
        };
        return this.#baseBundle({ invocation, workflowRunId, executed, presentation });
      } catch {
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          deterministicMessage: unavailableMessage(invocation.context.locale)
        });
      }
    }
    const route = requestedRoute as PortfolioRoute;
    const executed: ExecutedTool[] = [];
    const portfolio = await this.#executeTool(
      invocation,
      workflowRunId,
      "read-portfolio-snapshot",
      {}
    );
    executed.push(portfolio);
    if (portfolio.envelope.status !== "success" || portfolio.envelope.result === null) {
      return this.#baseBundle({
        invocation,
        workflowRunId,
        executed,
        deterministicMessage: unavailableMessage(invocation.context.locale)
      });
    }
    const snapshot = portfolio.envelope.result as MockPortfolioPositionSnapshot;
    let activity: ExecutedTool | undefined;
    if (
      route !== "current_portfolio_value" &&
      route !== "largest_holding" &&
      route !== "sector_allocation"
    ) {
      activity = await this.#executeTool(
        invocation,
        workflowRunId,
        "read-portfolio-activity",
        { periodStart: snapshot.periodStart, periodEnd: snapshot.asOf }
      );
      executed.push(activity);
    }
    const symbols = [...new Set([
      ...snapshot.currentLots.map(({ symbol }) => symbol),
      ...snapshot.openingPositions.map(({ symbol }) => symbol)
    ])].sort();
    const markets: ExecutedTool[] = [];
    const histories: ExecutedTool[] = [];
    if (
      route === "current_portfolio_value" ||
      route === "largest_holding" ||
      route === "sector_allocation" ||
      route === "ytd_gain_loss_twr"
    ) {
      for (const symbol of symbols) {
        const item = await this.#executeTool(
          invocation,
          workflowRunId,
          "read-market-snapshot",
          { symbol }
        );
        markets.push(item);
        executed.push(item);
      }
    }
    if (route === "ytd_gain_loss_twr" || route === "one_month_mover_contribution") {
      const range = route === "ytd_gain_loss_twr" ? "1y" : "1m";
      for (const symbol of symbols) {
        const item = await this.#executeTool(
          invocation,
          workflowRunId,
          "read-price-history",
          { symbol, range }
        );
        histories.push(item);
        executed.push(item);
      }
    }
    try {
      const cashBalanceOnly = invocation.route.reasonCodes.includes(
        "cash_balance_marker"
      );
      const calculationInput = {
        context: invocation.context,
        route,
        portfolioExecution: asEnvelope<MockPortfolioPositionSnapshot>(portfolio.envelope),
        ...(activity === undefined
          ? {}
          : { activityExecution: asEnvelope<MockPortfolioActivity>(activity.envelope) }),
        ...(markets.length === 0
          ? {}
          : { marketExecutions: markets.map(({ envelope }) => asEnvelope<BoundaryMarketSnapshot>(envelope)) }),
        ...(histories.length === 0
          ? {}
          : { historyExecutions: histories.map(({ envelope }) => asEnvelope<BoundaryPriceHistory>(envelope)) }),
        signer: this.#signer
      };
      let calculation = calculatePortfolioRoute(calculationInput);
      let conversion: ExecutedTool | undefined;
      if (
        route === "current_portfolio_value" &&
        invocation.route.reasonCodes.includes("portfolio_value_currency:AZN")
      ) {
        const currentValue = calculation.facts[0]?.value;
        if (
          typeof currentValue !== "object" ||
          currentValue === null ||
          !("totalValue" in currentValue) ||
          typeof currentValue.totalValue !== "string" ||
          !("currency" in currentValue) ||
          (currentValue.currency !== "USD" && currentValue.currency !== "AZN")
        ) {
          throw new Error("DATA_NOT_AVAILABLE: current portfolio value was not calculated.");
        }
        const conversionArguments: CurrencyConversionArguments = {
          scope: "provided-amount",
          amount: currentValue.totalValue as DecimalString,
          sourceCurrency: currentValue.currency,
          targetCurrency: "AZN"
        };
        conversion = await this.#executeTool(
          invocation,
          workflowRunId,
          "convert-currency",
          conversionArguments
        );
        executed.push(conversion);
        calculation = calculatePortfolioRoute({
          ...calculationInput,
          currencyConversionExecution: asEnvelope<CurrencyConversionResult>(
            conversion.envelope
          ),
          currencyConversionArguments: conversionArguments
        });
      }
      const portfolioPresentation = buildPortfolioRoutePresentation({
        calculation,
        locale: invocation.context.locale,
        ...(cashBalanceOnly ? { cashBalanceOnly: true } : {}),
        ...(invocation.route.symbols[0] === undefined
          ? {}
          : { symbol: invocation.route.symbols[0] })
      });
      const presentation: CapabilityPresentation = {
        status: "complete",
        facts: portfolioPresentation.facts,
        renderableFacts: portfolioPresentation.renderableFacts,
        citations: [],
        renderableCitations: [],
        cards: portfolioPresentation.cards,
        charts: [],
        freshness: [
          ...markets,
          ...histories,
          ...(conversion === undefined ? [] : [conversion])
        ].flatMap(({ envelope }) =>
          envelope.status === "success"
            ? [{
                sourceId: envelope.source.sourceId,
                asOf: envelope.source.sourceAsOf,
                status: envelope.source.licenseClass === "public-indicative"
                  ? "indicative" as const
                  : "live" as const,
                delayMinutes: null
              }]
            : []),
        notices: [
          "Client portfolio data is synthetic; market inputs use a development public feed.",
          ...(conversion === undefined
            ? []
            : ["Currency conversion uses the official Central Bank of Azerbaijan rate."])
        ],
        fallback: portfolioPresentation.fallback,
        writerGoal: cashBalanceOnly
          ? "answer the current cash balance using only the signed cash fact"
          : route.replaceAll("_", " ")
      };
      return this.#baseBundle({ invocation, workflowRunId, executed, presentation });
    } catch {
      return this.#baseBundle({
        invocation,
        workflowRunId,
        executed,
        deterministicMessage: unavailableMessage(invocation.context.locale)
      });
    }
  }

  private async acquireKnowledge(
    invocation: V3WorkflowInvocation,
    workflowRunId: string,
    tracingContext?: TracingContext
  ): Promise<V3CapabilityBundle> {
    if (invocation.route.route === "education") {
      const query = normalizeFinancialEducationQuery(invocation.message);
      const expectedReason = financialEducationRouteReason(invocation.message);
      if (
        query === null ||
        expectedReason === null ||
        !invocation.route.reasonCodes.includes(expectedReason)
      ) {
        throw new Error("The financial-education route has no bound query.");
      }
      const executed = [await this.#executeTool(
        invocation,
        workflowRunId,
        "retrieve-reviewed-investment-education",
        { query },
        invocation.policy,
        tracingContext
      )];
      try {
        const presentation = buildReviewedEducationCapabilityPresentation({
          context: invocation.context,
          workflowRunId,
          tool: executed[0]!.envelope,
          signer: this.#signer
        });
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          presentation
        });
      } catch {
        return this.#baseBundle({
          invocation,
          workflowRunId,
          executed,
          deterministicMessage: unavailableMessage(invocation.context.locale)
        });
      }
    }
    const compound = invocation.route.reasonCodes.includes(
      "compound_approved_knowledge_marker"
    );
    const targets = compound
      ? invocation.context.locale === "az-AZ"
        ? [
            {
              query: "investisiya məhsulu və investisiya alətləri",
              sourceId: "demo-invest-product-az"
            },
            {
              query: "Demo Invest komissiyalar və tarif",
              sourceId: "demo-invest-commissions-az"
            },
            {
              query: "Demo Invest risk açıqlaması və simulyasiya riski",
              sourceId: "demo-invest-risk-disclosure-az"
            }
          ]
        : [
            {
              query: "investment product and investment instruments",
              sourceId: "demo-invest-product-en"
            },
            {
              query: "Demo Invest commissions fees and tariff",
              sourceId: "demo-invest-commissions-en"
            },
            {
              query: "Demo Invest risk disclosures and simulation documents",
              sourceId: "demo-invest-risk-disclosure-en"
            }
          ]
      : [{
          query: invocation.message.normalize("NFKC").trim(),
          sourceId: null
        }];
    const executed: ExecutedTool[] = [];
    for (const target of targets) {
      executed.push(await this.#executeTool(
        invocation,
        workflowRunId,
        "retrieve-approved-product-knowledge",
        { query: target.query }
      ));
    }
    try {
      const facts: FactEnvelope<ApprovedKnowledgeEvidenceValue>[] = [];
      const citations: AssistantCitation[] = [];
      for (const [index, item] of executed.entries()) {
        let projected;
        try {
          projected = projectApprovedKnowledgeEvidence({
            context: invocation.context,
            toolExecution: asEnvelope<KnowledgeToolResult>(item.envelope),
            service: this.#approvedKnowledge,
            signer: this.#signer
          });
        } catch {
          if (!compound) throw new Error("Approved knowledge evidence is unavailable.");
          continue;
        }
        const expectedSourceId = targets[index]?.sourceId ?? null;
        const factIndex = expectedSourceId === null
          ? 0
          : projected.facts.findIndex(({ value }) =>
              value.sourceId === expectedSourceId
            );
        if (factIndex < 0) continue;
        const fact = projected.facts[factIndex];
        const citation = projected.citations[factIndex];
        if (
          fact === undefined ||
          citation === undefined ||
          facts.some(({ value }) => value.sourceId === fact.value.sourceId)
        ) {
          continue;
        }
        facts.push(fact);
        citations.push({
          ...citation,
          citationId: `product-knowledge-${citations.length + 1}`
        });
      }
      const projected = { facts, citations };
      const route = invocation.route.route === "fees_tariff" ? "fees_tariff" : "approved_knowledge";
      const basePresentation = buildKnowledgeCapabilityPresentation({
        context: invocation.context,
        projected,
        route,
        ...(compound
          ? { maxFacts: 3, maxPropositionsPerFact: 1 }
          : {})
      });
      const presentation: CapabilityPresentation = compound
        ? {
            ...basePresentation,
            status: facts.length === targets.length ? "complete" : "partial",
            notices: [
              ...basePresentation.notices,
              ...(facts.length === targets.length
                ? []
                : [invocation.context.locale === "az-AZ"
                    ? "Sorğunun bəzi hissələri üçün ayrıca təsdiqlənmiş mənbə tapılmadı."
                    : "A separately approved source was not available for every part of the request."])
            ]
          }
        : basePresentation;
      const target = detectGovernedNavigationTarget(invocation.message);
      const action = target === null
        ? null
        : this.#governedNavigation.resolveAction({
            context: invocation.context,
            target,
            // Only citations selected into the customer response are eligible
            // to authorize a customer-visible navigation action.
            citationRefs: presentation.citations
          });
      return this.#baseBundle({
        invocation,
        workflowRunId,
        executed,
        presentation,
        ...(action === null ? {} : { actions: [action] })
      });
    } catch {
      return this.#baseBundle({
        invocation,
        workflowRunId,
        executed,
        deterministicMessage: unavailableMessage(invocation.context.locale)
      });
    }
  }

  private async prepareOrder(
    invocation: V3WorkflowInvocation,
    workflowRunId: string
  ): Promise<V3CapabilityBundle> {
    if (invocation.route.symbols.length !== 1) {
      throw new Error("Exactly one ticker is required for an order preview.");
    }
    const symbol = invocation.route.symbols[0];
    if (!symbol) throw new Error("An exact ticker is required for an order preview.");
    const reviewedIntent = reviewOrderPreviewIntent(invocation.message);
    if (reviewedIntent.status !== "supported") {
      throw new Error("An unsupported order preview reached the signed workflow.");
    }
    const requestedNotional = reviewedIntent.requestedNotional;
    const executed: ExecutedTool[] = [];
    executed.push(await this.#executeTool(invocation, workflowRunId, "resolve-instrument", { symbol }));
    const market = await this.#executeTool(
      invocation,
      workflowRunId,
      "read-market-snapshot",
      { symbol }
    );
    executed.push(market);
    const eligibility = await this.#executeTool(
      invocation,
      workflowRunId,
      "read-order-eligibility",
      { symbol, side: "BUY", requestedNotional }
    );
    executed.push(eligibility);
    try {
      const snapshot = market.envelope.result as BoundaryMarketSnapshot | null;
      const eligible = eligibility.envelope.result as OrderEligibility | null;
      if (!snapshot || !eligible?.eligible) throw new Error("Preview is not eligible.");
      const quantity = formatFixedDecimal(
        divideFixed(parseFixedDecimal(requestedNotional), parseFixedDecimal(snapshot.price))
      );
      const fee = calculatePublishedCommission({
        tariffId: eligible.tariffId,
        unitPrice: snapshot.price,
        quantity,
        currency: "USD"
      }, invocation.context.locale);
      const preview = this.#orderHandoffStore.createPreview({
        context: invocation.context,
        symbol,
        requestedNotional,
        previewPrice: snapshot.price,
        estimatedCommission: fee.commission,
        estimatedDebit: fee.estimatedDebit,
        tariffVersion: fee.tariffVersion
      });
      const previewFact = new EvidenceFactory({ signer: this.#signer, now: this.#now }).fact({
        requestId: invocation.context.requestId,
        workflowRunId,
        kind: "order-ticket.preview",
        subject: { type: "order-handoff", ref: preview.intentId },
        asOf: preview.createdAt,
        value: { preview, eligibility: eligible, fee, estimatedQuantity: quantity },
        provenance: {
          toolExecutionIds: executed.map(({ envelope }) => envelope.executionId),
          inputFactIds: [],
          calculation: {
            id: "order-preview-calculator",
            version: "3.0.0",
            formulaId: "requested-notional-divided-by-price-plus-published-commission"
          }
        },
        quality: {
          status: "complete",
          coverage: decimal("1"),
          flags: ["PREVIEW_ONLY", "NO_ORDER_EXECUTION"]
        }
      });
      const display = invocation.context.locale === "az-AZ"
        ? `${symbol} üçün ${formatMoneyExact(requestedNotional, "USD", invocation.context.locale)} alış önbaxışı: təxmini ${formatDecimalExact(quantity, invocation.context.locale, 4)} səhm, istinad qiyməti ${formatMoneyExact(snapshot.price, "USD", invocation.context.locale)}, komissiya ${formatMoneyExact(fee.commission, "USD", invocation.context.locale)}, ümumi debet ${formatMoneyExact(fee.estimatedDebit, "USD", invocation.context.locale)}; ${preview.expiresAt} tarixinədək keçərlidir. Bu sifariş deyil.`
        : `${formatMoneyExact(requestedNotional, "USD", invocation.context.locale)} ${symbol} buy preview: about ${formatDecimalExact(quantity, invocation.context.locale, 4)} shares at the reference price ${formatMoneyExact(snapshot.price, "USD", invocation.context.locale)}, commission ${formatMoneyExact(fee.commission, "USD", invocation.context.locale)}, estimated debit ${formatMoneyExact(fee.estimatedDebit, "USD", invocation.context.locale)}; valid until ${preview.expiresAt}. This is not an order.`;
      const fallback: ClaimDraft[] = [{
        claimId: "order-ticket-preview",
        locale: invocation.context.locale,
        textTemplate: invocation.context.locale === "az-AZ"
          ? "Sizin üçün yalnız baxış məqsədli bilet hazırladım: {{F1}} Davam etmək üçün ayrıca düyməni seçin."
          : "I prepared a review-only ticket: {{F1}} Use the separate confirmation button if you want to open it.",
        factRefs: ["F1"],
        citationRefs: [],
        limitations: []
      }];
      return {
        invocation,
        workflowId: "order-ticket-handoff-v3",
        workflowRunId,
        status: "complete",
        tools: executed.map(({ envelope }) => envelope),
        toolArguments: buildToolArgumentRecords(executed),
        facts: [previewFact],
        citations: [],
        cards: [{
          cardId: `card-order-preview-${preview.intentId}`,
          kind: "order-preview",
          title: invocation.context.locale === "az-AZ" ? "Alış bileti önbaxışı" : "Buy ticket preview",
          factRefs: [previewFact.factId],
          // Keep the signed preview fields at the card boundary expected by
          // the UI; fee detail remains available without forcing the client to
          // understand an internal `{ preview: ... }` wrapper.
          data: { ...preview, estimatedQuantity: quantity, fee }
        }],
        charts: [],
        actions: [{
          actionId: `confirm-${preview.intentId}`,
          kind: "open-signed-order-ticket",
          label: preview.confirmationLabel,
          href: null,
          expiresAt: preview.expiresAt,
          intentId: preview.intentId
        }],
        notices: [...preview.notices],
        freshness: [{
          sourceId: market.envelope.source.sourceId,
          asOf: snapshot.asOf,
          status: snapshot.freshness,
          delayMinutes: String(snapshot.delayMinutes)
        }],
        renderableFacts: [sealRenderableFact({
          alias: "F1",
          fact: previewFact,
          meaning: "the verified non-executable order ticket preview",
          required: true,
          display
        }, new EvidenceFactory({ signer: this.#signer, now: this.#now }))],
        renderableCitations: [],
        fallback,
        writerGoal: "explain a non-executable order ticket preview",
        deterministicMessage: null
      };
    } catch {
      return this.#baseBundle({
        invocation,
        workflowRunId,
        executed,
        deterministicMessage: unavailableMessage(invocation.context.locale)
      });
    }
  }

  private async confirmOrder(
    resumedPrepared: V3PreparedResponse,
    confirmationToken: string
  ): Promise<V3PreparedResponse> {
    // Mastra 1.51+ restores suspended step input as a structural clone. That
    // clone intentionally does not retain the WeakSet trust marks attached to
    // server-issued session and policy objects. It may identify a candidate
    // intent, but it is never authoritative: bind its complete canonical value
    // to the original strictly extracted, process-local suspended record and
    // continue with that original object only.
    const intentId = actionIntent(resumedPrepared);
    const suspended = this.#suspendedOrders.get(intentId);
    if (!suspended) throw new Error("The suspended order preview is missing or expired.");
    if (canonicalHash(resumedPrepared) !== canonicalHash(suspended.prepared)) {
      throw new Error("The resumed order preview does not match the trusted suspension.");
    }
    const prepared = suspended.prepared;
    this.#confirmationAuthority.consume(confirmationToken, {
      intentId,
      sessionId: prepared.invocation.session.claims.sessionId,
      principalRef: prepared.invocation.context.principalRef
    });
    const freshPreviewPolicy = evaluateV3Policy({
      route: prepared.invocation.route,
      session: prepared.invocation.session,
      now: this.#now()
    });
    const confirmationPolicy = authorizeV3OrderHandoffConfirmation({
      route: prepared.invocation.route,
      previewPolicy: freshPreviewPolicy,
      session: prepared.invocation.session,
      now: this.#now()
    });
    const executed = await this.#executeTool(
      prepared.invocation,
      prepared.workflowRunId,
      "create-signed-order-handoff",
      { intentId, explicitConfirmation: true },
      confirmationPolicy
    );
    const handoff = executed.envelope.result as SignedOrderHandoff | null;
    if (executed.envelope.status !== "success" || !handoff) {
      throw new Error("The signed order handoff could not be created.");
    }
    this.#purgeExpiredOrderState();
    if (
      !this.#confirmedHandoffs.has(intentId) &&
      this.#confirmedHandoffs.size >= this.#orderStateCapacity
    ) {
      throw new Error("Confirmed order-handoff capacity is exhausted.");
    }
    this.#confirmedHandoffs.set(intentId, handoff);
    return {
      ...prepared,
      tools: [...prepared.tools, executed.envelope],
      toolArguments: [
        ...prepared.toolArguments,
        { executionId: executed.envelope.executionId, arguments: executed.arguments }
      ],
      message: prepared.invocation.context.locale === "az-AZ"
        ? "İmzalanmış, birdəfəlik alış bileti keçidi hazırdır. Ayrı sifariş ekranı qiyməti, komissiyanı, balansı və uyğunluğu yenidən yoxlayacaq."
        : "Your signed one-use ticket handoff is ready. The separate order screen will recheck price, fees, balance, disclosures, and eligibility.",
      generationMode: "deterministic-fallback"
    };
  }

  private deterministicBoundary(
    invocation: V3WorkflowInvocation,
    workflowRunId: string
  ): Promise<V3PreparedResponse> {
    const locale = invocation.context.locale;
    const conversation = invocation.route.route === "conversation";
    const genericClarification =
      invocation.route.kind === "clarify" &&
      invocation.route.reasonCodes.includes("no_deterministic_route");
    const conversationDefinition = conversation
      ? reviewedConversationDefinition(invocation.message, locale)
      : null;
    const genericClarificationDefinition = genericClarification
      ? reviewedGenericClarificationDefinition(locale)
      : null;
    if (conversation && conversationDefinition === null) {
      throw new Error("A conversational route has no reviewed definition.");
    }
    const reviewedDefinition = conversation
      ? conversationDefinition
      : genericClarification
        ? genericClarificationDefinition
        : null;
    const modelAuthoredDefinition =
      conversation || genericClarification;
    const message = modelAuthoredDefinition
      ? reviewedDefinition!.answer
      : invocation.route.kind === "clarify"
      ? invocation.route.reasonCodes.includes(
          "product_knowledge_profile_not_configured"
        )
        ? locale === "az-AZ"
          ? "Bu yerləşdirmə üçün aşağı axın məhsul məlumat paketi konfiqurasiya edilməyib. Yenə də portfel, açıq bazar və yoxlanılmış investisiya təhsili suallarında kömək edə bilərəm."
          : "No downstream product knowledge pack is configured for this deployment. I can still help with portfolios, public markets, and reviewed investment education."
        : invocation.route.reasonCodes.includes("order_preview_sell_not_supported")
        ? locale === "az-AZ"
          ? "Bu pilot yalnız ABŞ dolları məbləği ilə alış önbaxışını dəstəkləyir. Satış önbaxışı yaratmayacağam."
          : "This pilot supports USD-notional buy previews only. I will not turn a sell request into a buy preview."
        : invocation.route.reasonCodes.includes("order_preview_limit_not_supported")
          ? locale === "az-AZ"
            ? "Limit sifarişi önbaxışı hələ dəstəklənmir. Limit qiymətini bazar önbaxışına çevirməyəcəyəm."
            : "Limit-order previews are not supported yet. I will not reinterpret a limit price as a market-preview amount."
          : invocation.route.reasonCodes.includes(
              "order_preview_order_type_not_supported"
            )
            ? locale === "az-AZ"
              ? "Bu pilot stop, treylinq, bazar və digər sifariş növlərini önbaxış kimi dəstəkləmir. Sorğunu başqa sifariş növünə çevirməyəcəyəm."
              : "This pilot does not support stop, trailing, market, or other order types as previews. I will not reinterpret the requested order type."
          : invocation.route.reasonCodes.includes(
              "order_preview_buy_side_required"
            )
            ? locale === "az-AZ"
              ? "Önbaxış üçün alış tərəfini açıq yazın. Tərəfi sizin əvəzinizə təxmin etməyəcəyəm."
              : "State the BUY side explicitly for a preview. I will not infer the order side for you."
          : invocation.route.reasonCodes.includes(
              "order_preview_single_instrument_required"
            )
            ? locale === "az-AZ"
              ? "Alış önbaxışı üçün yalnız bir dəqiq ticker yazın."
              : "Provide exactly one ticker for a buy preview."
          : invocation.route.reasonCodes.includes("order_preview_quantity_not_supported")
            ? locale === "az-AZ"
              ? "Səhm sayı ilə önbaxış hələ dəstəklənmir. Yalnız bir dəqiq ABŞ dolları alış məbləği yaza bilərsiniz, məsələn AAPL üçün dollar məbləği ilə alış önbaxışı istəyin."
              : "Share-quantity previews are not supported yet. Use one explicit USD buy amount instead, for example ask for an AAPL buy preview with a dollar amount."
            : invocation.route.reasonCodes.includes(
                "order_preview_amount_outside_pilot_limit"
              )
              ? locale === "az-AZ"
                ? "İstənilən alış məbləği pilot önbaxış limitindən kənardadır. Daha kiçik ABŞ dolları məbləği yazın."
                : "The requested buy amount is outside the pilot preview limit. Provide a smaller USD amount."
            : invocation.route.reasonCodes.some((code) =>
                code === "order_preview_usd_notional_required" ||
                code === "order_preview_amount_ambiguous" ||
                code === "order_preview_amount_invalid"
              )
              ? locale === "az-AZ"
                ? "Önbaxış üçün bir dəqiq, müsbət ABŞ dolları alış məbləği yazın."
                : "Provide one explicit positive USD buy amount."
              : invocation.route.reasonCodes.includes(
                  "market_history_custom_range_unsupported"
                )
                ? locale === "az-AZ"
                  ? "Fərdi başlanğıc və bitiş tarixləri hələ dəstəklənmir. Gündəlik, həftəlik, aylıq, altı aylıq, illik, beş illik, on illik və ya bütün dövrü seçin."
                  : "Custom start and end dates are not supported yet. Choose daily, weekly, monthly, six-month, yearly, five-year, ten-year, or all-time history."
                : invocation.route.reasonCodes.includes(
                    "activity_date_range_unsupported"
                  )
                  ? locale === "az-AZ"
                    ? "Hesab fəaliyyətini fərdi tarix aralığı üzrə süzmək hələ dəstəklənmir. Yanlış dövr göstərmək əvəzinə yalnız son ticarət qeydlərini və ya son alışları göstərə bilərəm."
                    : "Custom date filtering for account activity is not supported yet. Rather than show records outside your dates, I can show the latest trading records or latest purchases."
                  : invocation.route.reasonCodes.includes(
                      "account_fee_dividend_activity_unsupported"
                    )
                    ? locale === "az-AZ"
                      ? "Hesaba aid komissiya və dividend tarixçəsi bu pilotda hələ təqdim edilmir. Konfiqurasiya edilmiş məhsulun açıq tarifini ayrıca izah edə bilərəm."
                      : "Account-specific fee and dividend history is not available in this pilot yet. I can explain the configured product's public tariff separately."
                    : invocation.route.reasonCodes.includes(
                        "language_switch_requires_new_session"
                      )
                      ? locale === "az-AZ"
                        ? "Bu sessiyanın dili Azərbaycan dili kimi təhlükəsiz şəkildə sabitlənib. İngilis dili üçün yeni sessiya başladın."
                        : "This session is securely fixed to English. Start a new Azerbaijani session to change the response language."
                      : invocation.route.reasonCodes.includes(
                          "out_of_scope_request"
                        )
                        ? locale === "az-AZ"
                          ? "Bu köməkçi investisiya portfeli, açıq bazar məlumatları, investisiya təhsili və konfiqurasiya edilmiş məhsul məlumatı ilə məhdudlaşır. Hava, idman və digər ümumi mövzulara cavab vermirəm."
                          : "This assistant is limited to investment portfolios, public-market information, investment education, and configured product information. I do not answer weather, sports, or other general-purpose questions."
      : invocation.route.reasonCodes.includes("activity_single_instrument_required")
        ? locale === "az-AZ"
          ? "Ticarət tarixçəsini bir dəfədə yalnız bir ticker üzrə göstərə bilərəm. Zəhmət olmasa NVDA və ya AAPL-dan birini seçin."
          : "I can show trading history for one ticker at a time. Please choose either NVDA or AAPL."
        : invocation.route.reasonCodes.includes(
            "investment_selection_inputs_required"
          )
          ? investmentSelectionClarificationMessage(invocation.route, locale)
        : invocation.route.reasonCodes.includes("yield_symbol_and_definition_required")
          ? locale === "az-AZ"
            ? "Dəqiq ticker-i və nəzərdə tutduğunuz gəlirlilik növünü yazın: məsələn, paylanma gəlirliliyi, SEC gəlirliliyi və ya istiqraz üçün ödəmə müddətinədək gəlirlilik."
            : "Please name the exact ticker and the yield definition you mean—for example distribution yield, SEC yield, or yield to maturity for a bond."
        : locale === "az-AZ"
          ? "Nəyə baxmağımı istəyirsiniz? Məsələn, portfel dəyəri, gəlir, komissiya və ya konkret bir ticker üzrə qiymət və təhlil soruşa bilərsiniz."
          : "What would you like me to check? You can ask about portfolio value, performance, fees, or name a ticker for a price or analysis."
      : invocation.route.boundary === "order_execution"
        ? locale === "az-AZ"
          ? "Çatda sifariş yerləşdirə bilmirəm, amma nəzərdən keçirməyiniz üçün alış bileti önbaxışı hazırlaya bilərəm."
          : "I can’t place or submit an order from chat, but I can prepare a reviewable buy-ticket preview."
        : invocation.route.boundary === "sensitive_support"
          ? locale === "az-AZ"
            ? "Zəhmət olmasa parol, PIN və ya kart məlumatı göndərməyin. Xidmət təminatçınızın autentifikasiya edilmiş dəstək kanalından istifadə edin."
            : "Please don’t send passwords, PINs, or card details here. Use your service provider's authenticated support channel instead."
          : locale === "az-AZ"
            ? "Maliyyə sualınıza kömək edə bilərəm, amma daxili göstərişləri açıqlaya və ya təhlükəsizlik nəzarətlərini keçə bilmərəm."
            : "I can help with the financial question, but I can’t reveal internal instructions or bypass security controls.";
    const reviewedFact = reviewedDefinition !== null
      ? new EvidenceFactory({ signer: this.#signer, now: this.#now }).fact({
          requestId: invocation.context.requestId,
          workflowRunId,
          kind: conversation
            ? "assistant.reviewed-conversation"
            : "assistant.reviewed-clarification",
          subject: {
            type: "product",
            ref: conversation
              ? "ASSISTANT_CONVERSATION"
              : "ASSISTANT_GENERIC_CLARIFICATION"
          },
          asOf: invocation.context.requestedAt,
          value: {
            ...reviewedDefinition
          },
          provenance: {
            toolExecutionIds: [],
            inputFactIds: [],
            calculation: {
              id: conversation
                ? "deterministic-conversation-catalog"
                : "deterministic-clarification-catalog",
              version: "1.0.0",
              formulaId: conversation
                ? "reviewed-conversation-lookup"
                : "reviewed-generic-clarification-lookup"
            }
          },
          quality: {
            status: "complete",
            coverage: decimal("1"),
            flags: [
              conversation
                ? "REVIEWED_CONVERSATION"
                : "REVIEWED_GENERIC_CLARIFICATION",
              locale
            ]
          }
        })
      : null;
    let reviewedFallbackTemplate: string | null = null;
    if (conversationDefinition !== null) {
      reviewedFallbackTemplate = conversationDefinition.answer;
    } else if (genericClarificationDefinition !== null) {
      reviewedFallbackTemplate = genericClarificationDefinition.answer;
    }
    const reviewedFallback: ClaimDraft[] = reviewedFact === null ||
      reviewedDefinition === null ||
      reviewedFallbackTemplate === null
      ? []
      : [{
          claimId: conversation
            ? `conversation-${conversationDefinition!.kind}`
            : "generic-clarification",
          locale,
          textTemplate: reviewedFallbackTemplate,
          factRefs: reviewedDefinition.statements.map(({ alias }) => alias),
          citationRefs: [],
          limitations: []
        }];
    return Promise.resolve({
      invocation,
      workflowId: "assistant-request-v3",
      workflowRunId,
      status: conversation
        ? "complete"
        : invocation.route.kind === "clarify"
          ? "clarification-required"
          : "unavailable",
      tools: [],
      toolArguments: [],
      facts: reviewedFact === null ? [] : [reviewedFact],
      citations: [],
      cards: [],
      charts: [],
      actions: [],
      notices: [],
      freshness: [],
      renderableFacts: reviewedFact === null || reviewedDefinition === null
        ? []
        : reviewedDefinition.statements.map((statement) =>
            sealRenderableFact({
              alias: statement.alias,
              fact: reviewedFact,
              meaning: statement.meaning,
              required: statement.required,
              display: statement.text
            }, new EvidenceFactory({ signer: this.#signer, now: this.#now }))
          ),
      renderableCitations: [],
      fallback: reviewedFallback,
      writerGoal: conversation
        ? "respond naturally to this social or conversational turn using every reviewed semantic slot, without adding a financial fact, recommendation, or tool claim"
        : genericClarification
          ? "ask one natural clarification using every reviewed semantic slot, without adding a financial fact, recommendation, capability, or tool claim"
          : "deterministic safety boundary",
      deterministicMessage: modelAuthoredDefinition ? null : message,
      message,
      claims: reviewedFallback,
      generationMode: modelAuthoredDefinition
        ? "deterministic-fallback"
        : "deterministic"
    });
  }

  private async finalize(prepared: V3PreparedResponse): Promise<AssistantResponse> {
    const model = prepared.generationMode === "gpt-4o" ||
      prepared.generationMode === "gpt-4.1"
      ? prepared.generationMode
      : null;
    const response: AssistantResponse = {
      schemaVersion: "assistant-v3.response.v1",
      requestId: prepared.invocation.context.requestId,
      conversationId: prepared.invocation.context.conversationId,
      status: prepared.status,
      message: prepared.message,
      claims: prepared.claims,
      facts: prepared.facts,
      citations: prepared.citations,
      cards: prepared.cards,
      charts: prepared.charts,
      actions: prepared.actions,
      notices: prepared.notices,
      freshness: prepared.freshness,
      evaluations: [],
      deliveryGate: "pass",
      generationMode: prepared.generationMode,
      provenance: {
        workflowId: prepared.workflowId,
        workflowVersion: "3.0.0",
        workflowRunId: prepared.workflowRunId,
        model,
        toolExecutionIds: prepared.tools.map(({ executionId }) => executionId),
        factIds: prepared.facts.map(({ factId }) => factId),
        policyVersion: prepared.invocation.policy.policyVersion
      }
    };
    const scoring = scoreV3ResponseForDelivery({
      route: prepared.invocation.route,
      context: prepared.invocation.context,
      requestMessage: prepared.invocation.message,
      response,
      tools: prepared.tools.map((envelope) => {
        const record = prepared.toolArguments.find(({ executionId }) =>
          executionId === envelope.executionId
        );
        if (!record) throw new Error("A tool argument record is missing.");
        return { envelope, arguments: record.arguments };
      }),
      factDisplays: prepared.renderableFacts.map(({
        alias,
        fact,
        display,
        meaning,
        required,
        semanticRoles,
        requiredCitationAlias,
        projectionIntegrity
      }) => {
        if (projectionIntegrity === undefined) {
          throw new Error("A signed fact display projection is missing.");
        }
        return {
        alias,
        factId: fact.factId,
        display,
        meaning,
        required,
        semanticRoles: semanticRoles ?? [],
        ...(requiredCitationAlias === undefined
          ? {}
          : { requiredCitationAlias }),
        projectionIntegrity
      };
      }),
      signer: this.#signer,
      evaluatedAt: this.#now()
    });
    const telemetryIntent = telemetryIntentFor(prepared.invocation.route);
    for (const item of scoring.results) {
      const gate = RESPONSE_SCORER_GATES[item.scorerId];
      if (gate && item.applicable) {
        this.#telemetry?.recordGate({
          gate,
          passed: item.status === "pass",
          intent: telemetryIntent
        });
      }
    }
    const evaluated: AssistantResponse = {
      ...response,
      evaluations: scoring.results.map((item) => ({
        scorerId: item.scorerId,
        status: item.status,
        passed: item.passed,
        score: item.score,
        reasonCodes: item.reasonCodes
      })),
      deliveryGate: scoring.passed ? "pass" : "blocked"
    };
    if (!scoring.passed) {
      if (prepared.invocation.route.route !== null) {
        this.#disabledRoutes.add(prepared.invocation.route.route);
      }
      this.#audit.append({
        eventType: "assistant-response-blocked",
        requestId: prepared.invocation.context.requestId,
        workflowRunId: prepared.workflowRunId,
        tenantId: prepared.invocation.context.tenantRef,
        principalFingerprint: v3PrincipalFingerprint(prepared.invocation.session),
        payload: {
          route: prepared.invocation.route.route,
          blockedBy: scoring.blockedBy,
          failedChecks: scoring.results
            .filter(({ status }) => status === "fail" || status === "error")
            .map(({ scorerId, reasonCodes }) => ({
              scorerId,
              reasonCodes: [...reasonCodes]
            }))
        }
      });
      throw new V3HttpRuntimeError(
        "unavailable",
        `P0 response gate blocked: ${scoring.blockedBy.join(",")}; ${scoring.results
          .filter(({ status }) => status === "fail" || status === "error")
          .flatMap(({ scorerId, reasonCodes }) => reasonCodes.map((reason) => `${scorerId}:${reason}`))
          .join(",")}`
      );
    }
    const pendingConversationContext = this.#pendingMemoryAssistance.get(
      prepared.invocation.context.requestId
    );
    this.#audit.append({
      eventType: "assistant-response-committed",
      requestId: prepared.invocation.context.requestId,
      workflowRunId: prepared.workflowRunId,
      tenantId: prepared.invocation.context.tenantRef,
      principalFingerprint: v3PrincipalFingerprint(prepared.invocation.session),
      payload: {
        route: prepared.invocation.route.route,
        status: evaluated.status,
        responseHash: canonicalHash({
          message: evaluated.message,
          factIds: evaluated.provenance.factIds,
          toolExecutionIds: evaluated.provenance.toolExecutionIds,
          actions: evaluated.actions
        }),
        conversationContextPlan: this.#conversationMemory === null
          ? "disabled"
          : prepared.invocation.route.route === "conversation"
            ? "preserve"
          : isV3ConversationContextRoute(prepared.invocation.route.route)
            ? evaluated.status === "unavailable" || evaluated.status === "clarification-required"
              ? "preserve"
              : prepared.invocation.route.reasonCodes.includes("conversation_symbol_context")
                ? "assisted"
                : "anchor"
            : "clear",
        conversationContextExpectedVersion:
          pendingConversationContext?.expectedVersion ?? null,
        conversationContextExpectedRevision:
          pendingConversationContext?.expectedRevision ?? null,
        scorerStatuses: evaluated.evaluations.map(({ scorerId, status }) => ({ scorerId, status }))
      }
    });
    this.#commitConversationMemory(prepared, evaluated);
    return evaluated;
  }

  #readConversationMemory(
    scope: V3ConversationMemoryScope,
    route: V3Function | null
  ): V3ConversationMemoryReadResult {
    if (this.#conversationMemory === null) {
      return Object.freeze({ status: "miss", snapshot: null });
    }
    const startedAt = performance.now();
    const sessionId = scope.session.claims.sessionId;
    if (this.#blockedConversationMemorySessions.has(sessionId)) {
      this.#telemetry?.recordConversationMemory({
        operation: "read",
        result: "success",
        durationMs: elapsedMetricMs(startedAt),
        outcome: "bypass"
      });
      return Object.freeze({ status: "miss", snapshot: null });
    }
    try {
      const result = route === null
        ? this.#conversationMemory.peek(scope)
        : this.#conversationMemory.read(scope, route);
      this.#telemetry?.recordConversationMemory({
        operation: "read",
        result: "success",
        durationMs: elapsedMetricMs(startedAt),
        outcome: result.status === "hit"
          ? "hit"
          : result.status === "miss"
            ? "miss"
            : "stale"
      });
      return result;
    } catch {
      this.#blockedConversationMemorySessions.add(sessionId);
      this.#telemetry?.recordConversationMemory({
        operation: "read",
        result: "error",
        durationMs: elapsedMetricMs(startedAt),
        outcome: "bypass"
      });
      return Object.freeze({ status: "miss", snapshot: null });
    }
  }

  #clearConversationMemory(scope: V3ConversationMemoryScope): void {
    if (this.#conversationMemory === null) return;
    const startedAt = performance.now();
    const sessionId = scope.session.claims.sessionId;
    try {
      const removed = this.#conversationMemory.clear(scope);
      this.#blockedConversationMemorySessions.delete(sessionId);
      this.#telemetry?.recordConversationMemory({
        operation: "clear",
        result: "success",
        durationMs: elapsedMetricMs(startedAt),
        outcome: removed ? "hit" : "miss"
      });
    } catch {
      this.#blockedConversationMemorySessions.add(sessionId);
      this.#telemetry?.recordConversationMemory({
        operation: "clear",
        result: "error",
        durationMs: elapsedMetricMs(startedAt),
        outcome: "bypass"
      });
    }
  }

  #commitConversationMemory(
    prepared: V3PreparedResponse,
    response: AssistantResponse
  ): void {
    if (this.#conversationMemory === null) return;
    const { context, session, route } = prepared.invocation;
    const scope: V3ConversationMemoryScope = { context, session };
    const pending = this.#pendingMemoryAssistance.get(context.requestId);
    // A social acknowledgement or capability exchange is not a subject
    // boundary. Preserve the last explicitly grounded ticker so a later,
    // separately routed follow-up can still use the bounded context.
    if (route.route === "conversation") return;
    if (
      isV3ConversationContextRoute(route.route) &&
      route.symbols.length > 0
    ) {
      if (response.status === "unavailable" || response.status === "clarification-required") {
        return;
      }
      const startedAt = performance.now();
      const sessionId = session.claims.sessionId;
      try {
        const usedRememberedSymbols = route.reasonCodes.includes(
          "conversation_symbol_context"
        );
        if (usedRememberedSymbols) {
          // Never relabel inferred subjects as explicit anchors. If the
          // authorize-stage CAS token is unavailable, preserving the previous
          // state is safer than writing a new one.
          if (pending === undefined) return;
          this.#conversationMemory.commitAssisted(scope, {
            expectedVersion: pending.expectedVersion,
            expectedRevision: pending.expectedRevision,
            route: route.route
          });
        } else {
          this.#conversationMemory.write(scope, {
            symbols: route.symbols,
            route: route.route
          });
          // A successful explicit subject overwrites any stale record and is
          // therefore the only write path allowed to lift a quarantine.
          this.#blockedConversationMemorySessions.delete(sessionId);
        }
        this.#telemetry?.recordConversationMemory({
          operation: "write",
          result: "success",
          durationMs: elapsedMetricMs(startedAt)
        });
      } catch {
        this.#blockedConversationMemorySessions.add(sessionId);
        // Memory continuity is non-authoritative. A failed post-audit update
        // must not suppress an already scored and durably audited answer.
        this.#telemetry?.recordConversationMemory({
          operation: "write",
          result: "error",
          durationMs: elapsedMetricMs(startedAt),
          outcome: "bypass"
        });
      }
      return;
    }

    // A delivered safety, clarification, order, portfolio, knowledge, or
    // education turn is a context boundary. It cannot resurrect a stale public
    // ticker on a later turn.
    this.#clearConversationMemory(scope);
  }

  #purgeExpiredSessionState(): void {
    const now = this.#now();
    const expiredSessionIds = new Set<string>();
    for (const [sessionId, record] of this.#sessions) {
      if (record.expiresAt <= now) {
        this.#sessions.delete(sessionId);
        this.#blockedConversationMemorySessions.delete(sessionId);
        expiredSessionIds.add(sessionId);
      }
    }
    this.#purgeExpiredOrderState(expiredSessionIds);
    if (this.#conversationMemory === null) return;
    const startedAt = performance.now();
    try {
      this.#conversationMemory.purgeExpired();
      this.#telemetry?.recordConversationMemory({
        operation: "clear",
        result: "success",
        durationMs: elapsedMetricMs(startedAt),
        outcome: "bypass"
      });
    } catch {
      // The purge is global, so an unknown stale record may belong to any
      // live session. Quarantine all currently active sessions until their
      // own clear or explicit-anchor overwrite succeeds.
      for (const sessionId of this.#sessions.keys()) {
        this.#blockedConversationMemorySessions.add(sessionId);
      }
      this.#telemetry?.recordConversationMemory({
        operation: "clear",
        result: "error",
        durationMs: elapsedMetricMs(startedAt),
        outcome: "bypass"
      });
    }
  }

  #purgeExpiredOrderState(
    expiredSessionIds: ReadonlySet<string> = new Set()
  ): void {
    const now = this.#now();
    for (const [intentId, record] of this.#suspendedOrders) {
      if (
        record.expiresAt <= now ||
        expiredSessionIds.has(record.sessionId)
      ) {
        this.#suspendedOrders.delete(intentId);
      }
    }
    for (const [intentId, handoff] of this.#confirmedHandoffs) {
      const expiresAt = Date.parse(handoff.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        this.#confirmedHandoffs.delete(intentId);
      }
    }
    for (const [intentId, record] of this.#issuedOrderHandoffs) {
      const expiresAt = Date.parse(record.handoff.expiresAt);
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= now ||
        expiredSessionIds.has(record.sessionId)
      ) {
        this.#issuedOrderHandoffs.delete(intentId);
      }
    }
  }

  async #withSessionTurn<TResult>(
    sessionId: string,
    run: () => Promise<TResult>
  ): Promise<TResult> {
    const prior = this.#sessionTurnTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.catch(() => undefined).then(() => gate);
    this.#sessionTurnTails.set(sessionId, tail);
    await prior.catch(() => undefined);
    try {
      return await run();
    } finally {
      release();
      if (this.#sessionTurnTails.get(sessionId) === tail) {
        this.#sessionTurnTails.delete(sessionId);
      }
    }
  }

  private rememberOrderRun(
    prepared: V3PreparedResponse,
    runId: string,
    run: SuspendedOrderRecord["run"]
  ): void {
    this.#purgeExpiredOrderState();
    const action = orderAction(prepared);
    const intentId = action.intentId;
    if (
      !this.#suspendedOrders.has(intentId) &&
      this.#suspendedOrders.size >= this.#orderStateCapacity
    ) {
      throw new Error("Suspended order-preview capacity is exhausted.");
    }
    this.#suspendedOrders.set(intentId, {
      runId,
      prepared,
      sessionId: prepared.invocation.session.claims.sessionId,
      principalRef: prepared.invocation.context.principalRef,
      expiresAt: Date.parse(action.expiresAt),
      run
    });
  }

  #requireTopology(): V3RuntimeTopology {
    if (!this.#topology) throw new V3HttpRuntimeError("unavailable", "V3 topology is not attached.");
    return this.#topology;
  }
}
