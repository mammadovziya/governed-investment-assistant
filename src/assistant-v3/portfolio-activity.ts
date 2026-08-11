import type {
  AssistantCard,
  ClaimDraft,
  DecimalString,
  FactEnvelope,
  MoneyAmount,
  SupportedLocale,
  ToolExecutionEnvelope,
  TrustedRequestContext
} from "./contracts.js";
import { EvidenceFactory } from "./evidence.js";
import {
  decimal,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal
} from "./fixed-decimal.js";
import type {
  RecentTradingActivityItem,
  RecentTradingActivityResult
} from "./mock-portfolio.js";
import { formatDecimalExact, formatMoneyExact } from "./presentation.js";
import type { RenderableFact } from "./rendering.js";
import type { V3Function } from "./routing.js";
import { canonicalHash, type DevHmacSigner } from "./signing.js";

export type PortfolioActivityRoute = Extract<
  V3Function,
  "recent_trading_activity" | "purchase_history"
>;

export type PortfolioActivityToolArguments =
  | {
      readonly queryType: "recent-trading";
      readonly limit: 10;
      readonly include: "all";
      readonly symbol?: string;
    }
  | {
      readonly queryType: "recent-trading";
      readonly limit: 10;
      readonly include: "executions";
      readonly side: "BUY";
      readonly symbol?: string;
    };

/** One reviewed argument builder is shared by execution and the P0 scorer. */
export function portfolioActivityToolArguments(input: {
  route: PortfolioActivityRoute;
  symbols: readonly string[];
}): PortfolioActivityToolArguments {
  if (input.symbols.length > 1) {
    throw new PortfolioActivityProjectionError(
      "INVALID_ACTIVITY_SCOPE",
      "Portfolio activity accepts at most one instrument scope."
    );
  }
  const symbol = input.symbols.length === 1 ? input.symbols[0] : undefined;
  if (symbol !== undefined && !/^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(symbol)) {
    throw new PortfolioActivityProjectionError(
      "INVALID_ACTIVITY_SCOPE",
      "Portfolio activity received an invalid instrument scope."
    );
  }
  return input.route === "purchase_history"
    ? {
        queryType: "recent-trading",
        limit: 10,
        include: "executions",
        side: "BUY",
        ...(symbol === undefined ? {} : { symbol })
      }
    : {
        queryType: "recent-trading",
        limit: 10,
        include: "all",
        ...(symbol === undefined ? {} : { symbol })
      };
}

export interface ExecutedTradeView {
  recordType: "execution";
  positionEffect: "EXECUTED_TRADE";
  occurredAt: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: DecimalString;
  unitPrice: MoneyAmount;
  grossAmount: MoneyAmount;
}

export interface OrderStateView {
  recordType: "order";
  positionEffect: "ORDER_STATE_ONLY";
  occurredAt: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  timeInForce: "DAY" | "GOOD_TILL_CANCELLED";
  status: "FILLED" | "OPEN" | "CANCELLED";
  requestedQuantity: DecimalString;
  filledQuantity: DecimalString;
  limitPrice: MoneyAmount | null;
  averageFillPrice: MoneyAmount | null;
}

export type PortfolioActivityView = ExecutedTradeView | OrderStateView;

/**
 * Customer-safe projection. Ledger, order, instrument and linkage identifiers
 * deliberately never cross this fact boundary.
 */
export interface PortfolioActivityFactValue {
  route: PortfolioActivityRoute;
  asOf: string;
  coverage: {
    status: "complete";
    ledgerPeriodStart: string;
    ledgerPeriodEnd: string;
  };
  limit: 10;
  matchedCount: number;
  returnedCount: number;
  hasMore: boolean;
  records: readonly PortfolioActivityView[];
  dataClass: "synthetic";
}

export interface PortfolioActivityPresentation {
  facts: readonly FactEnvelope<PortfolioActivityFactValue>[];
  renderableFacts: readonly RenderableFact[];
  fallback: readonly ClaimDraft[];
  cards: readonly AssistantCard[];
  notices: readonly string[];
  writerGoal: string;
}

export class PortfolioActivityProjectionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PortfolioActivityProjectionError";
  }
}

const PROJECTION_VERSION = "portfolio-activity-projection-v3.2.0";
const SYMBOL = /^[A-Z]{1,5}(?:\.[A-Z])?$/u;

function fail(code: string, message: string): never {
  throw new PortfolioActivityProjectionError(code, message);
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("INVALID_ACTIVITY_DATA", `${label} is invalid.`);
  return parsed;
}

function assertDecimal(value: DecimalString, label: string, allowZero = false): bigint {
  let parsed: bigint;
  try {
    parsed = parseFixedDecimal(value);
  } catch {
    fail("INVALID_ACTIVITY_DATA", `${label} is not a canonical decimal.`);
  }
  if (formatFixedDecimal(parsed) !== value) {
    fail("INVALID_ACTIVITY_DATA", `${label} is not a canonical decimal.`);
  }
  if (allowZero ? parsed < 0n : parsed <= 0n) {
    fail("INVALID_ACTIVITY_DATA", `${label} is outside its accepted range.`);
  }
  return parsed;
}

function assertMoney(
  value: MoneyAmount | null,
  label: string,
  allowZero = false
): bigint | null {
  if (value === null) return null;
  if (!/^[A-Z]{3}$/u.test(value.currency)) {
    fail("INVALID_ACTIVITY_DATA", `${label} currency is invalid.`);
  }
  return assertDecimal(value.amount, `${label} amount`, allowZero);
}

function validateItem(
  item: RecentTradingActivityItem,
  coverageStart: number,
  coverageEnd: number,
  expected: PortfolioActivityToolArguments
): void {
  const occurredAt = timestamp(item.occurredAt, "Activity timestamp");
  if (occurredAt < coverageStart || occurredAt > coverageEnd) {
    fail("INVALID_ACTIVITY_DATA", "Activity is outside the signed ledger coverage window.");
  }
  if (item.kind === "EXECUTION") {
    if (
      item.positionEffect !== "AUTHORITATIVE_EXECUTED_TRADE" ||
      item.transaction.executionStatus !== "EXECUTED" ||
      !["BUY", "SELL"].includes(item.transaction.side) ||
      !SYMBOL.test(item.transaction.symbol) ||
      item.transaction.tradedAt !== item.occurredAt ||
      item.activityRef !== `execution:${item.transaction.transactionId}` ||
      timestamp(item.transaction.settledAt, "Execution settlement timestamp") < occurredAt
    ) {
      fail("INVALID_ACTIVITY_DATA", "An execution record is inconsistent.");
    }
    const quantity = assertDecimal(item.transaction.quantity, "Execution quantity");
    const unitPrice = assertMoney(item.transaction.unitPrice, "Execution unit price");
    const grossAmount = assertMoney(item.transaction.grossAmount, "Execution gross amount");
    if (
      unitPrice === null ||
      grossAmount === null ||
      item.transaction.unitPrice.currency !== item.transaction.grossAmount.currency ||
      grossAmount !== multiplyFixed(quantity, unitPrice)
    ) {
      fail("INVALID_ACTIVITY_DATA", "An execution amount does not reconcile.");
    }
    if (
      expected.symbol !== undefined &&
      item.transaction.symbol !== expected.symbol
    ) {
      fail("INVALID_ACTIVITY_DATA", "Recent activity escaped its requested symbol scope.");
    }
    if ("side" in expected && item.transaction.side !== expected.side) {
      fail("INVALID_ACTIVITY_DATA", "Recent activity escaped its requested side scope.");
    }
    return;
  }
  if (
    expected.include === "executions" ||
    item.positionEffect !== "NONE_ORDER_STATE_ONLY" ||
    !["BUY", "SELL"].includes(item.order.side) ||
    !["MARKET", "LIMIT"].includes(item.order.orderType) ||
    !["DAY", "GOOD_TILL_CANCELLED"].includes(item.order.timeInForce) ||
    !["FILLED", "OPEN", "CANCELLED"].includes(item.order.status) ||
    !SYMBOL.test(item.order.symbol) ||
    item.order.lastUpdatedAt !== item.occurredAt ||
    item.activityRef !== `order:${item.order.orderRef}`
  ) {
    fail("INVALID_ACTIVITY_DATA", "An order-state record is inconsistent.");
  }
  const submittedAt = timestamp(item.order.submittedAt, "Order submission timestamp");
  if (submittedAt > occurredAt) {
    fail("INVALID_ACTIVITY_DATA", "An order update precedes its submission.");
  }
  const requestedQuantity = assertDecimal(item.order.requestedQuantity, "Requested quantity");
  const filledQuantity = assertDecimal(item.order.filledQuantity, "Filled quantity", true);
  const limitPrice = assertMoney(item.order.limitPrice, "Limit price");
  const averageFillPrice = assertMoney(item.order.averageFillPrice, "Average fill price");
  const transactionIds = item.order.linkedTransactionIds;
  const uniqueTransactionIds = new Set(transactionIds);
  const hasFills = filledQuantity > 0n;
  if (
    filledQuantity > requestedQuantity ||
    (item.order.orderType === "MARKET" && limitPrice !== null) ||
    (item.order.orderType === "LIMIT" && limitPrice === null) ||
    (hasFills !== (averageFillPrice !== null)) ||
    (hasFills !== (transactionIds.length > 0)) ||
    transactionIds.some((transactionId) => transactionId.trim().length === 0) ||
    uniqueTransactionIds.size !== transactionIds.length ||
    (item.order.status === "FILLED" && filledQuantity !== requestedQuantity) ||
    (item.order.status !== "FILLED" && filledQuantity === requestedQuantity) ||
    (item.order.limitPrice !== null &&
      item.order.averageFillPrice !== null &&
      item.order.limitPrice.currency !== item.order.averageFillPrice.currency)
  ) {
    fail("INVALID_ACTIVITY_DATA", "An order lifecycle is inconsistent.");
  }
  if (expected.symbol !== undefined && item.order.symbol !== expected.symbol) {
    fail("INVALID_ACTIVITY_DATA", "Recent activity escaped its requested symbol scope.");
  }
  if ("side" in expected && item.order.side !== expected.side) {
    fail("INVALID_ACTIVITY_DATA", "Recent activity escaped its requested side scope.");
  }
}

function projectItem(item: RecentTradingActivityItem): PortfolioActivityView {
  if (item.kind === "EXECUTION") {
    return {
      recordType: "execution",
      positionEffect: "EXECUTED_TRADE",
      occurredAt: item.transaction.tradedAt,
      symbol: item.transaction.symbol,
      side: item.transaction.side,
      quantity: item.transaction.quantity,
      unitPrice: structuredClone(item.transaction.unitPrice),
      grossAmount: structuredClone(item.transaction.grossAmount)
    };
  }
  return {
    recordType: "order",
    positionEffect: "ORDER_STATE_ONLY",
    occurredAt: item.order.lastUpdatedAt,
    symbol: item.order.symbol,
    side: item.order.side,
    orderType: item.order.orderType,
    timeInForce: item.order.timeInForce,
    status: item.order.status,
    requestedQuantity: item.order.requestedQuantity,
    filledQuantity: item.order.filledQuantity,
    limitPrice: structuredClone(item.order.limitPrice),
    averageFillPrice: structuredClone(item.order.averageFillPrice)
  };
}

export function projectPortfolioActivityFact(input: {
  context: TrustedRequestContext;
  workflowRunId: string;
  route: PortfolioActivityRoute;
  expectedArguments: PortfolioActivityToolArguments;
  activityExecution: ToolExecutionEnvelope<RecentTradingActivityResult>;
  signer: DevHmacSigner;
}): FactEnvelope<PortfolioActivityFactValue> {
  const evidence = new EvidenceFactory({ signer: input.signer });
  const envelope = input.activityExecution;
  if (
    envelope.toolId !== "read-portfolio-activity" ||
    envelope.requestId !== input.context.requestId ||
    envelope.workflowRunId !== input.workflowRunId ||
    envelope.argumentsHash !== canonicalHash(input.expectedArguments) ||
    envelope.status !== "success" ||
    envelope.result === null ||
    envelope.error !== null ||
    !evidence.verifyTool(envelope)
  ) {
    fail("INVALID_TOOL_EVIDENCE", "Recent activity did not provide valid signed evidence.");
  }
  const result = envelope.result;
  const asOf = timestamp(result.asOf, "Activity as-of timestamp");
  const coverageStart = timestamp(
    result.coverage.ledgerPeriodStart,
    "Activity coverage start"
  );
  const coverageEnd = timestamp(
    result.coverage.ledgerPeriodEnd,
    "Activity coverage end"
  );
  if (
    result.schemaVersion !== "assistant-v3.recent-trading-activity.v1" ||
    result.queryType !== "recent-trading" ||
    result.dataClass !== "synthetic" ||
    input.expectedArguments.queryType !== result.queryType ||
    result.coverage.status !== "complete" ||
    coverageStart > coverageEnd ||
    coverageEnd !== asOf ||
    envelope.source.sourceAsOf !== result.asOf ||
    !Number.isInteger(result.coverage.matchedCount) ||
    !Number.isInteger(result.coverage.returnedCount) ||
    result.coverage.matchedCount < 0 ||
    result.coverage.returnedCount !== result.items.length ||
    result.coverage.matchedCount < result.coverage.returnedCount ||
    result.items.length > input.expectedArguments.limit ||
    result.coverage.returnedCount !== Math.min(
      result.coverage.matchedCount,
      input.expectedArguments.limit
    ) ||
    result.hasMore !== (result.coverage.matchedCount > result.coverage.returnedCount)
  ) {
    fail("INVALID_ACTIVITY_DATA", "Recent activity coverage is inconsistent.");
  }
  const references = new Set<string>();
  let previousTimestamp = Number.POSITIVE_INFINITY;
  for (const item of result.items) {
    validateItem(item, coverageStart, coverageEnd, input.expectedArguments);
    if (references.has(item.activityRef)) {
      fail("INVALID_ACTIVITY_DATA", "Recent activity contains duplicate records.");
    }
    references.add(item.activityRef);
    const occurredAt = timestamp(item.occurredAt, "Activity timestamp");
    if (occurredAt > previousTimestamp) {
      fail("INVALID_ACTIVITY_DATA", "Recent activity is not newest-first.");
    }
    previousTimestamp = occurredAt;
    if (
      input.route === "purchase_history" &&
      (item.kind !== "EXECUTION" || item.transaction.side !== "BUY")
    ) {
      fail("INVALID_ACTIVITY_DATA", "Purchase history contained a non-purchase record.");
    }
  }
  const requestedAt = timestamp(input.context.requestedAt, "Trusted request timestamp");
  const value: PortfolioActivityFactValue = {
    route: input.route,
    asOf: result.asOf,
    coverage: {
      status: result.coverage.status,
      ledgerPeriodStart: result.coverage.ledgerPeriodStart,
      ledgerPeriodEnd: result.coverage.ledgerPeriodEnd
    },
    limit: input.expectedArguments.limit,
    matchedCount: result.coverage.matchedCount,
    returnedCount: result.coverage.returnedCount,
    hasMore: result.hasMore,
    records: result.items.map(projectItem),
    dataClass: "synthetic"
  };
  return new EvidenceFactory({ signer: input.signer, now: () => requestedAt }).fact({
    requestId: input.context.requestId,
    workflowRunId: input.workflowRunId,
    kind: input.route === "purchase_history"
      ? "portfolio.purchase-history"
      : "portfolio.recent-trading-activity",
    subject: { type: "portfolio", ref: "portfolio:primary" },
    asOf: result.asOf,
    value,
    provenance: {
      toolExecutionIds: [envelope.executionId],
      inputFactIds: [],
      calculation: {
        id: "portfolio-activity-projection",
        version: PROJECTION_VERSION,
        formulaId: input.route === "purchase_history"
          ? "newest-ten-executed-buy-records-with-identifiers-redacted"
          : "newest-ten-executions-and-order-states-with-identifiers-redacted"
      }
    },
    quality: {
      status: "complete",
      coverage: decimal("1"),
      flags: ["SYNTHETIC_CLIENT_DATA", "INTERNAL_IDENTIFIERS_REDACTED"]
    }
  });
}

function date(value: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "Asia/Baku"
  }).format(new Date(value));
}

function executionDisplay(record: ExecutedTradeView, locale: SupportedLocale): string {
  const side = locale === "az-AZ"
    ? record.side === "BUY" ? "alış" : "satış"
    : record.side.toLocaleLowerCase("en-US");
  const details = `${formatDecimalExact(record.quantity, locale, 4)} @ ${formatMoneyExact(
    record.unitPrice.amount,
    record.unitPrice.currency,
    locale
  )}; ${locale === "az-AZ" ? "brüt" : "gross"} ${formatMoneyExact(
    record.grossAmount.amount,
    record.grossAmount.currency,
    locale
  )}`;
  return locale === "az-AZ"
    ? `${date(record.occurredAt, locale)} — ${record.symbol} ${side} icra olunub: ${details}`
    : `${date(record.occurredAt, locale)} — ${record.symbol} ${side} executed: ${details}`;
}

function orderDisplay(record: OrderStateView, locale: SupportedLocale): string {
  const status = locale === "az-AZ"
    ? ({ FILLED: "icra edilib", OPEN: "açıqdır", CANCELLED: "ləğv edilib" } as const)[record.status]
    : record.status.toLocaleLowerCase("en-US");
  const side = locale === "az-AZ"
    ? record.side === "BUY" ? "alış" : "satış"
    : record.side.toLocaleLowerCase("en-US");
  const limit = record.limitPrice === null
    ? ""
    : `, ${locale === "az-AZ" ? "limit" : "limit"} ${formatMoneyExact(
        record.limitPrice.amount,
        record.limitPrice.currency,
        locale
      )}`;
  return locale === "az-AZ"
    ? `Yalnız sifariş vəziyyəti — ${date(record.occurredAt, locale)} — ${record.symbol} ${side} sifarişi: ${status}, ${formatDecimalExact(record.requestedQuantity, locale, 4)} istənilib${limit}`
    : `Order state only — ${date(record.occurredAt, locale)} — ${record.symbol} ${side} order: ${status}, ${formatDecimalExact(record.requestedQuantity, locale, 4)} requested${limit}`;
}

function count(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: false
  }).format(value);
}

function activitySummaryDisplay(
  value: PortfolioActivityFactValue,
  locale: SupportedLocale
): string {
  if (value.records.length === 0) {
    return value.route === "purchase_history"
      ? locale === "az-AZ"
        ? "uyğun icra olunmuş alış yoxdur"
        : "no matching executed purchases"
      : locale === "az-AZ"
        ? "uyğun ticarət və ya sifariş qeydi yoxdur"
        : "no matching trade or order records";
  }
  const returned = count(value.returnedCount, locale);
  const matched = count(value.matchedCount, locale);
  const scope = value.hasMore
    ? locale === "az-AZ"
      ? `${matched} uyğun qeyddən ən yeni ${returned}-u`
      : `the latest ${returned} of ${matched} matching`
    : locale === "az-AZ"
      ? `bütün ${returned} uyğun`
      : `all ${returned} matching`;
  if (value.route === "purchase_history") {
    return locale === "az-AZ"
      ? `${scope} icra olunmuş alış, yenidən köhnəyə`
      : `${scope} executed purchase${value.returnedCount === 1 ? "" : "s"}, newest first`;
  }
  return locale === "az-AZ"
    ? `${scope} ticarət qeydi, yenidən köhnəyə`
    : `${scope} trading record${value.returnedCount === 1 ? "" : "s"}, newest first`;
}

function moreActivityDisplay(locale: SupportedLocale): string {
  return locale === "az-AZ"
    ? "daha köhnə uyğun qeydlər də mövcuddur"
    : "older matching records are also available";
}

function coverageDisplay(
  value: PortfolioActivityFactValue,
  locale: SupportedLocale
): string {
  // Keep the exact signed ISO instants in prose. Localized date rendering can
  // change the numeric token set (for example "Jan 1, 2026"), which cannot be
  // replayed byte-for-byte from the authoritative fact envelope.
  const start = value.coverage.ledgerPeriodStart;
  const end = value.coverage.ledgerPeriodEnd;
  return locale === "az-AZ"
    ? `${start}–${end} üçün tam qeyd əhatəsi`
    : `complete record coverage from ${start} through ${end}`;
}

interface ActivityPresentationSlot {
  alias: string;
  display: string;
  meaning: string;
  required: boolean;
}

const FALLBACK_ACTIVITY_ITEM_LIMIT = 3;

function activityPresentationSlots(
  value: PortfolioActivityFactValue,
  locale: SupportedLocale
): ActivityPresentationSlot[] {
  const purchase = value.route === "purchase_history";
  const slots: ActivityPresentationSlot[] = [{
    alias: "ACTIVITY_SUMMARY",
    display: activitySummaryDisplay(value, locale),
    meaning: purchase
      ? "the verified number of matching executed purchases found, their newest-first ordering, and that the complete returned page is in the structured activity card"
      : "the verified number of matching portfolio activity records found, their newest-first ordering, and that the complete returned page is in the structured activity card",
    required: true
  }];
  value.records.forEach((record, index) => {
    slots.push({
      alias: `ACTIVITY_ITEM_${String(index + 1).padStart(2, "0")}`,
      display: record.recordType === "execution"
        ? executionDisplay(record, locale)
        : orderDisplay(record, locale),
      meaning: record.recordType === "execution"
        ? "a verified individual portfolio activity record that is an executed trade and affects the position"
        : "a verified individual portfolio activity record that is an order state only and is not itself an executed trade",
      required: index < FALLBACK_ACTIVITY_ITEM_LIMIT
    });
  });
  if (value.hasMore) {
    slots.push({
      alias: "ACTIVITY_HAS_MORE",
      display: moreActivityDisplay(locale),
      meaning: "the verified indication that additional older matching portfolio activity records exist",
      required: false
    });
  }
  slots.push({
    alias: "ACTIVITY_COVERAGE",
    display: coverageDisplay(value, locale),
    meaning: "the verified complete portfolio activity record coverage window",
    required: false
  });
  return slots;
}

function fallbackClaims(input: {
  slots: readonly ActivityPresentationSlot[];
  locale: SupportedLocale;
  purchase: boolean;
}): ClaimDraft[] {
  const summary = input.slots.find(({ alias }) => alias === "ACTIVITY_SUMMARY");
  if (summary === undefined) {
    fail("INVALID_ACTIVITY_PRESENTATION", "Activity summary slot is missing.");
  }
  const items = input.slots
    .filter(({ alias }) => alias.startsWith("ACTIVITY_ITEM_"))
    .slice(0, FALLBACK_ACTIVITY_ITEM_LIMIT);
  const optional = input.slots.filter(({ alias }) =>
    alias === "ACTIVITY_HAS_MORE" || alias === "ACTIVITY_COVERAGE"
  );
  const claims: ClaimDraft[] = [{
    claimId: input.purchase ? "portfolio-purchase-summary" : "portfolio-activity-summary",
    locale: input.locale,
    textTemplate: input.locale === "az-AZ"
      ? `{{${summary.alias}}}. Qaytarılan qeydlərin tam siyahısı fəaliyyət kartındadır.`
      : `I found {{${summary.alias}}}. The activity card contains the complete returned page.`,
    factRefs: [summary.alias],
    citationRefs: [],
    limitations: []
  }];
  for (let index = 0; index < items.length; index += 5) {
    const group = items.slice(index, index + 5);
    claims.push({
      claimId: `${input.purchase ? "portfolio-purchase" : "portfolio-activity"}-items-${Math.floor(index / 5) + 1}`,
      locale: input.locale,
      textTemplate: `${group.map(({ alias }) => `{{${alias}}}`).join("; ")}.`,
      factRefs: group.map(({ alias }) => alias),
      citationRefs: [],
      limitations: []
    });
  }
  if (optional.length > 0) {
    claims.push({
      claimId: input.purchase ? "portfolio-purchase-coverage" : "portfolio-activity-coverage",
      locale: input.locale,
      textTemplate: `${optional.map(({ alias }) => `{{${alias}}}`).join(". ")}.`,
      factRefs: optional.map(({ alias }) => alias),
      citationRefs: [],
      limitations: []
    });
  }
  return claims;
}

export function buildPortfolioActivityPresentation(input: {
  fact: FactEnvelope<PortfolioActivityFactValue>;
  locale: SupportedLocale;
}): PortfolioActivityPresentation {
  const purchase = input.fact.value.route === "purchase_history";
  const slots = activityPresentationSlots(input.fact.value, input.locale);
  return {
    facts: [input.fact],
    renderableFacts: slots.map((slot) => ({
      alias: slot.alias,
      fact: input.fact,
      meaning: slot.meaning,
      required: slot.required,
      display: slot.display
    })),
    fallback: fallbackClaims({
      slots,
      locale: input.locale,
      purchase
    }),
    cards: [{
      cardId: `card-${input.fact.factId}`,
      kind: "activity",
      title: purchase
        ? input.locale === "az-AZ" ? "Alış tarixçəsi" : "Purchase history"
        : input.locale === "az-AZ" ? "Son ticarət qeydləri" : "Recent trading activity",
      factRefs: [input.fact.factId],
      data: input.fact.value
    }],
    notices: purchase
      ? ["Only executed BUY transactions count as purchases; order states are excluded."]
      : ["Order records are state-only; only execution records affect portfolio positions."],
    writerGoal: purchase
      ? "summarize the customer's latest executed purchase history; the structured activity card contains the complete returned page"
      : "summarize the customer's latest executions and order states; the structured activity card contains the complete returned page"
  };
}
