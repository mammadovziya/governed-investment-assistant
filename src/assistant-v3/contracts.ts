/**
 * Versioned contracts shared by the V3 workflow boundary, deterministic tools,
 * signed facts, constrained writers, and the response composer.
 *
 * Financial values deliberately remain decimal strings. JavaScript numbers are
 * permitted only for non-financial presentation metadata such as a citation's
 * character range.
 */

export type DecimalString = string & { readonly __decimalString: unique symbol };

export type SupportedLocale = "en-US" | "az-AZ";
export type DeploymentEnvironment = "development" | "test" | "staging" | "production";
export type AssistantChannel = "web" | "mobile" | "mastra-studio" | "test";

export interface MoneyAmount {
  amount: DecimalString;
  currency: string;
}

export interface TrustedRequestContext {
  schemaVersion: "assistant-v3.request-context.v1";
  requestId: string;
  sessionId: string;
  conversationId: string;
  /** Server-derived pseudonymous principal reference; never accepted from chat text. */
  principalRef: string;
  tenantRef: string;
  locale: SupportedLocale;
  jurisdiction: "AZ";
  channel: AssistantChannel;
  environment: DeploymentEnvironment;
  requestedAt: string;
  authentication: {
    strength: "authenticated" | "step_up";
    authContextRef: string;
  };
  consentVersion: string;
  consentScopes: readonly string[];
  entitlementVersion: string;
  entitlements: readonly string[];
  policyVersion: string;
  capabilities: readonly string[];
  featureSnapshot: {
    version: string;
    flags: Readonly<Record<string, boolean>>;
  };
}

export interface CanonicalSignature {
  algorithm: "HS256";
  keyId: string;
  /** Base64url-encoded canonical protected header, as in compact JWS. */
  protectedHeader: string;
  /** SHA-256 over the canonical JSON payload. */
  payloadHash: string;
  /** Base64url HMAC over `<protectedHeader>.<canonical-payload-base64url>`. */
  signature: string;
}

export interface EnvelopeIntegrity {
  canonicalization: "jcs-compatible-v1";
  signature: CanonicalSignature;
}

export interface ToolSource {
  provider: string;
  sourceId: string;
  sourceUrl: string | null;
  licenseClass: "public-indicative" | "licensed" | "project-internal" | "synthetic";
  observedAt: string;
  sourceAsOf: string;
}

export type ToolExecutionStatus = "success" | "unavailable" | "rejected" | "error";

export interface ToolExecutionError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolExecutionEnvelope<TResult> {
  schemaVersion: "assistant-v3.tool-execution.v1";
  executionId: string;
  requestId: string;
  workflowRunId: string;
  toolId: string;
  toolVersion: string;
  status: ToolExecutionStatus;
  startedAt: string;
  completedAt: string;
  argumentsHash: string;
  resultHash: string | null;
  result: TResult | null;
  error: ToolExecutionError | null;
  source: ToolSource;
  integrity: EnvelopeIntegrity;
}

export interface FactProvenance {
  toolExecutionIds: readonly string[];
  inputFactIds: readonly string[];
  calculation: {
    id: string;
    version: string;
    formulaId: string;
  } | null;
}

export interface FactQuality {
  status: "complete" | "partial" | "unavailable";
  coverage: DecimalString;
  flags: readonly string[];
}

export interface FactEnvelope<TValue> {
  schemaVersion: "assistant-v3.fact.v1";
  factId: string;
  requestId: string;
  workflowRunId: string;
  kind: string;
  subject: {
    type: "portfolio" | "instrument" | "product" | "order-handoff";
    ref: string;
  };
  asOf: string;
  createdAt: string;
  value: TValue;
  provenance: FactProvenance;
  quality: FactQuality;
  integrity: EnvelopeIntegrity;
}

/**
 * The model drafts prose with references; it does not emit authoritative
 * financial values. The response composer replaces fact placeholders only
 * after verifying the referenced FactEnvelope signatures.
 */
export interface ClaimDraft {
  claimId: string;
  locale: SupportedLocale;
  textTemplate: string;
  factRefs: readonly string[];
  citationRefs: readonly string[];
  limitations: readonly string[];
}

export interface AssistantCitation {
  citationId: string;
  sourceId: string;
  title: string;
  url: string;
  sourceAsOf: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  contentHash: string;
}

export interface AssistantCard {
  cardId: string;
  kind:
    | "market"
    | "portfolio"
    | "allocation"
    | "performance"
    | "knowledge"
    | "research"
    | "decision-support"
    | "position-analysis"
    | "fee"
    | "activity"
    | "order-preview";
  title: string;
  factRefs: readonly string[];
  data: unknown;
}

export interface AssistantCommandAction {
  actionId: string;
  kind: "clarify" | "open-signed-order-ticket" | "open-official-source";
  label: string;
  href: string | null;
  expiresAt: string | null;
  intentId: string | null;
}

/**
 * Product-owned navigation action. The runtime can select only a semantic
 * target; every customer-visible route, label, and evidence reference is
 * resolved from the reviewed navigation catalog.
 */
export interface AssistantInAppAction {
  schemaVersion: "assistant-v3.in-app-navigation-action.v1";
  actionId: string;
  kind: "open-in-app";
  target:
    | "investments.account-opening.guide"
    | "investments.funding.guide"
    | "investments.share-purchase.guide"
    | "investments.withdrawal.guide"
    | "investments.price-alerts.create";
  label: string;
  href:
    | "/investments/guides/account-opening"
    | "/investments/guides/funding"
    | "/investments/guides/share-purchase"
    | "/investments/guides/withdrawal"
    | "/investments/price-alerts/create";
  citationRefs: readonly string[];
  catalogVersion: string;
}

/**
 * Product-owned, read-only navigation bound to one signed fact that is already
 * present in the delivered response. Unlike help-guide navigation, this action
 * does not rely on a citation and cannot contain account, subject, or symbol
 * identifiers in its route.
 */
export interface AssistantReadOnlyViewAction {
  schemaVersion: "assistant-v3.read-only-navigation-action.v1";
  actionId:
    | "view-portfolio-overview"
    | "view-portfolio-cash"
    | "view-recent-activity"
    | "view-instrument-overview";
  kind: "open-read-only-view";
  target:
    | "investments.portfolio.overview"
    | "investments.portfolio.cash"
    | "investments.portfolio.activity"
    | "investments.instrument.overview";
  label: string;
  href:
    | "/investments/portfolio"
    | "/investments/portfolio/cash"
    | "/investments/activity"
    | "/investments/instruments";
  factRefs: readonly [string];
  catalogVersion: "governed-investment-read-only-navigation-2026-07-29.v1";
}

export type AssistantAction =
  | AssistantCommandAction
  | AssistantInAppAction
  | AssistantReadOnlyViewAction;

export interface AssistantChartPoint {
  timestamp: string;
  close: DecimalString;
}

export interface AssistantChart {
  chartId: string;
  symbol: string;
  range: "1d" | "1w" | "1m" | "6m" | "1y" | "5y" | "10y" | "max";
  currency: string;
  asOf: string;
  source: string;
  points: readonly AssistantChartPoint[];
}

export interface AssistantFreshness {
  sourceId: string;
  asOf: string;
  status: "live" | "delayed" | "indicative" | "stale" | "document-effective";
  delayMinutes: string | null;
}

export interface AssistantEvaluation {
  scorerId: string;
  status: "pass" | "fail" | "not_applicable" | "error";
  passed: boolean;
  score: 0 | 1 | null;
  reasonCodes: readonly string[];
}

export interface AssistantResponse {
  schemaVersion: "assistant-v3.response.v1";
  requestId: string;
  conversationId: string;
  status: "complete" | "partial" | "unavailable" | "clarification-required";
  message: string;
  claims: readonly ClaimDraft[];
  facts: readonly FactEnvelope<unknown>[];
  citations: readonly AssistantCitation[];
  cards: readonly AssistantCard[];
  charts: readonly AssistantChart[];
  actions: readonly AssistantAction[];
  notices: readonly string[];
  freshness: readonly AssistantFreshness[];
  evaluations: readonly AssistantEvaluation[];
  deliveryGate: "pass" | "blocked";
  generationMode:
    | "gpt-4o"
    | "gpt-4.1"
    | "deterministic-fallback"
    | "deterministic";
  provenance: {
    workflowId: string;
    workflowVersion: string;
    workflowRunId: string;
    model: "gpt-4o" | "gpt-4.1" | null;
    toolExecutionIds: readonly string[];
    factIds: readonly string[];
    policyVersion: string;
  };
}
