export type V3FrontendLocale = "en-US" | "az-AZ";
export type V3FrontendCardKind =
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

export interface V3FrontendMoney {
  amount: string;
  currency: string;
}

export interface V3FrontendActivityExecution {
  kind: "execution";
  occurredAt: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  unitPrice: V3FrontendMoney;
  total: V3FrontendMoney;
}

export interface V3FrontendActivityOrder {
  kind: "order";
  occurredAt: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  filledQuantity: string;
  status: "FILLED" | "OPEN" | "CANCELLED";
  orderType: "MARKET" | "LIMIT";
  limitPrice: V3FrontendMoney | null;
  averageFillPrice: V3FrontendMoney | null;
}

export interface V3FrontendActivityData {
  schemaVersion: "assistant-v3.activity-card-data.v1";
  asOf: string | null;
  dataClass: "synthetic" | null;
  hasMore: boolean;
  matchedCount: number;
  items: Array<V3FrontendActivityExecution | V3FrontendActivityOrder>;
}

interface V3FrontendCardBase {
  cardId: string;
  title: string;
  factRefs: string[];
}

export interface V3FrontendActivityCard extends V3FrontendCardBase {
  kind: "activity";
  data: V3FrontendActivityData;
}

export interface V3FrontendGeneralCard extends V3FrontendCardBase {
  kind: Exclude<V3FrontendCardKind, "activity">;
  data: Record<string, unknown>;
}

export type V3FrontendCard = V3FrontendActivityCard | V3FrontendGeneralCard;

export interface V3FrontendOpenInAppAction {
  schemaVersion: "assistant-v3.in-app-navigation-action.v1";
  actionId: string;
  kind: "open-in-app";
  target:
    | "investments.account-opening.guide"
    | "investments.funding.guide"
    | "investments.share-purchase.guide"
    | "investments.withdrawal.guide";
  label: string;
  href:
    | "/investments/guides/account-opening"
    | "/investments/guides/funding"
    | "/investments/guides/share-purchase"
    | "/investments/guides/withdrawal";
  citationRefs: string[];
  catalogVersion: string;
}

export interface V3FrontendReadOnlyViewAction {
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
  factRefs: [string];
  catalogVersion: "governed-investment-read-only-navigation-2026-07-29.v1";
}

export interface V3FrontendInAppDestination {
  href: V3FrontendOpenInAppAction["href"];
  locale: V3FrontendLocale;
  sourceUrl: string;
  sourceAsOf: string;
  eyebrow: string;
  title: string;
  summary: string;
  steps: readonly string[];
  sourceLabel: string;
  notice: string;
}

export interface V3FrontendOrderPreviewAction {
  actionId: string;
  kind: "open-signed-order-ticket";
  label: string;
  href: null;
  expiresAt: string;
  intentId: string;
}

export interface V3FrontendCitation {
  citationId: string;
  sourceId: string;
  title: string;
  url: string;
  sourceAsOf: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  contentHash: string;
}

export interface V3FrontendChartPoint {
  timestamp: string;
  close: string | number;
}

export interface V3FrontendChart {
  chartId: string;
  symbol: string;
  range: "1d" | "1w" | "1m" | "6m" | "1y" | "5y" | "10y" | "max";
  currency: string;
  asOf: string;
  source: string;
  points: V3FrontendChartPoint[];
}

export interface V3FrontendAssistantResponse {
  schemaVersion: "assistant-v3.response.v1";
  message: string;
  status?: "complete" | "partial" | "unavailable" | "clarification-required";
  deliveryGate: "pass" | "blocked";
  cards: V3FrontendCard[];
  citations: V3FrontendCitation[];
  charts: V3FrontendChart[];
  actions: Array<
    | V3FrontendOpenInAppAction
    | V3FrontendReadOnlyViewAction
    | V3FrontendOrderPreviewAction
    | Record<string, unknown>
  >;
  notices: string[];
  freshness: unknown[];
  evaluations: unknown[];
  [key: string]: unknown;
}

export interface V3FrontendRequest {
  url: string;
  options: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  };
}

export function createV3SessionRequest(locale: V3FrontendLocale): V3FrontendRequest;
export function readV3SessionToken(payload: unknown): string;
export function createV3MessageRequest(token: string, message: string): V3FrontendRequest;
export function createV3OrderConfirmationRequest(
  token: string,
  intentId: string
): V3FrontendRequest;
export function createV3OrderOpenRequest(
  token: string,
  handoff: unknown
): V3FrontendRequest;
export function normalizeV3AssistantResponse(payload: unknown): V3FrontendAssistantResponse;
export function v3OrderPreviewConfirmationAction(
  card: V3FrontendCard | null | undefined,
  actions: readonly unknown[],
  now?: number
): V3FrontendOrderPreviewAction | null;
export function v3PriceHistoryCharts(
  response: Pick<V3FrontendAssistantResponse, "charts">
): V3FrontendChart[];
export function v3TenYearCharts(
  response: Pick<V3FrontendAssistantResponse, "charts">
): V3FrontendChart[];
export function safeV3CitationHref(value: unknown): string | null;
export function safeV3HandoffHref(value: unknown, origin?: string): string | null;
export function safeV3InAppHref(
  value: unknown
): V3FrontendOpenInAppAction["href"] | null;
export function safeV3ReadOnlyHref(
  value: unknown
): V3FrontendReadOnlyViewAction["href"] | null;
export function v3ReadOnlyViewAction(
  response: Pick<V3FrontendAssistantResponse, "deliveryGate" | "cards">,
  action: unknown
): V3FrontendReadOnlyViewAction | null;
export function v3InAppDestination(
  value: unknown,
  locale: V3FrontendLocale
): V3FrontendInAppDestination | null;
