import type {
  DecimalString,
  FactEnvelope,
  MoneyAmount,
  ToolExecutionEnvelope,
  TrustedRequestContext
} from "./contracts.js";
import {
  ONE_FIXED,
  ZERO_FIXED,
  absoluteFixed,
  addFixed,
  divideFixed,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal,
  subtractFixed,
  sumFixed,
  type FixedDecimalUnits
} from "./fixed-decimal.js";
import type {
  InstrumentMarketObservation,
  MockPortfolioActivity,
  MockPortfolioPositionSnapshot,
  PortfolioMarketEvidence
} from "./mock-portfolio.js";
import {
  attachIntegrity,
  canonicalHash,
  type DevHmacSigner,
  verifyEnvelope
} from "./signing.js";

const ANALYTICS_VERSION = "portfolio-analytics-v3.1.0";
const COMPLETE_COVERAGE = formatFixedDecimal(ONE_FIXED);

export type PortfolioAnalyticsErrorCode =
  | "UNTRUSTED_CONTEXT"
  | "INVALID_TOOL_ENVELOPE"
  | "TOOL_RESULT_UNAVAILABLE"
  | "CLIENT_SCOPE_MISMATCH"
  | "UNSUPPORTED_CURRENCY"
  | "MISSING_MARKET_EVIDENCE"
  | "INVALID_ACTIVITY"
  | "POSITION_RECONCILIATION_FAILED"
  | "CASH_RECONCILIATION_FAILED"
  | "YTD_RECONCILIATION_FAILED"
  | "CORPORATE_ACTION_UNRESOLVED"
  | "TWR_VALUATION_MISSING"
  | "ONE_MONTH_ACTIVITY_UNSUPPORTED";

export class PortfolioAnalyticsError extends Error {
  constructor(
    public readonly code: PortfolioAnalyticsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PortfolioAnalyticsError";
  }
}

export interface CurrentValuePosition {
  instrumentId: string;
  symbol: string;
  quantity: DecimalString;
  unitPrice: DecimalString;
  marketValue: DecimalString;
}

export interface CurrentPortfolioValueFact {
  currency: string;
  positionsValue: DecimalString;
  cashValue: DecimalString;
  totalValue: DecimalString;
  positions: readonly CurrentValuePosition[];
  dataClass: "synthetic";
  conversion?: {
    sourceCurrency: string;
    targetCurrency: string;
    sourceAmount: DecimalString;
    exchangeRate: DecimalString;
    convertedAmount: DecimalString;
    rateEffectiveDate: string;
    rateAsOf: string;
    rateSourceUrl: string;
  };
}

export interface AverageCostPosition {
  instrumentId: string;
  symbol: string;
  quantity: DecimalString;
  costBasis: DecimalString;
  averageUnitCost: DecimalString;
  currency: string;
}

export interface AverageCostFact {
  methodology: "remaining-open-lot-basis-with-capitalized-buy-fees";
  policyVersion: string;
  positions: readonly AverageCostPosition[];
}

export interface UnrealizedPnlPosition extends AverageCostPosition {
  currentPrice: DecimalString;
  marketValue: DecimalString;
  unrealizedPnl: DecimalString;
  unrealizedReturnRate: DecimalString;
}

export interface UnrealizedPnlFact {
  currency: string;
  costBasis: DecimalString;
  marketValue: DecimalString;
  unrealizedPnl: DecimalString;
  unrealizedReturnRate: DecimalString;
  positions: readonly UnrealizedPnlPosition[];
}

export interface YtdPnlFact {
  currency: string;
  periodStart: string;
  periodEnd: string;
  beginningPortfolioValue: DecimalString;
  endingPortfolioValue: DecimalString;
  netExternalCashFlow: DecimalString;
  navMethodPnl: DecimalString;
  realizedPricePnl: DecimalString;
  unrealizedPricePnl: DecimalString;
  income: DecimalString;
  fees: DecimalString;
  fxImpact: DecimalString;
  componentMethodPnl: DecimalString;
  reconciliationDifference: DecimalString;
  endingCashExpected: DecimalString;
  endingCashActual: DecimalString;
  cashReconciliationDifference: DecimalString;
  reconciled: true;
}

export interface TimeWeightedReturnFact {
  periodStart: string;
  periodEnd: string;
  returnRate: DecimalString;
  subperiodCount: string;
  externalFlowCount: string;
  methodology: "geometrically-linked-pre-flow-valuations-v1";
}

export interface SectorAllocationRow {
  sector: string;
  marketValue: DecimalString;
  investedAllocationRate: DecimalString;
  totalPortfolioAllocationRate: DecimalString;
}

export interface SectorAllocationFact {
  currency: string;
  investedValue: DecimalString;
  totalPortfolioValue: DecimalString;
  cashValue: DecimalString;
  cashTotalPortfolioAllocationRate: DecimalString;
  sectors: readonly SectorAllocationRow[];
}

export interface OneMonthPositionMove {
  instrumentId: string;
  symbol: string;
  quantity: DecimalString;
  startPrice: DecimalString;
  endPrice: DecimalString;
  returnRate: DecimalString;
  changeValue: DecimalString;
  contributionToPortfolioRate: DecimalString;
}

export interface OneMonthMoverFact {
  periodStart: string;
  periodEnd: string;
  largestAbsolutePriceReturn: OneMonthPositionMove;
  largestAbsolutePortfolioContribution: OneMonthPositionMove;
  portfolioStartValue: DecimalString;
  portfolioPriceChange: DecimalString;
  portfolioPriceChangeRate: DecimalString;
  currency: string;
}

export interface PortfolioAnalyticsResult {
  schemaVersion: "assistant-v3.portfolio-analytics.v1";
  workflowRunId: string;
  facts: {
    currentValue: FactEnvelope<CurrentPortfolioValueFact>;
    averageCost: FactEnvelope<AverageCostFact>;
    unrealizedPnl: FactEnvelope<UnrealizedPnlFact>;
    ytdPnl: FactEnvelope<YtdPnlFact>;
    timeWeightedReturn: FactEnvelope<TimeWeightedReturnFact>;
    sectorAllocation: FactEnvelope<SectorAllocationFact>;
    oneMonthMover: FactEnvelope<OneMonthMoverFact>;
  };
}

export interface PortfolioAnalyticsInput {
  context: TrustedRequestContext;
  portfolioExecution: ToolExecutionEnvelope<MockPortfolioPositionSnapshot>;
  activityExecution: ToolExecutionEnvelope<MockPortfolioActivity>;
  marketExecution: ToolExecutionEnvelope<PortfolioMarketEvidence>;
  signer: DevHmacSigner;
}

interface PositionCalculation {
  instrumentId: string;
  symbol: string;
  quantity: FixedDecimalUnits;
  costBasis: FixedDecimalUnits;
  marketValue: FixedDecimalUnits;
  monthStartValue: FixedDecimalUnits;
  observation: InstrumentMarketObservation;
}

function fail(code: PortfolioAnalyticsErrorCode, message: string): never {
  throw new PortfolioAnalyticsError(code, message);
}

function moneyUnits(value: MoneyAmount, currency: string): FixedDecimalUnits {
  if (value.currency !== currency) {
    fail("UNSUPPORTED_CURRENCY", `Expected ${currency}, received ${value.currency}.`);
  }
  return parseFixedDecimal(value.amount);
}

function withinPeriod(timestamp: string, start: string, end: string): boolean {
  return timestamp >= start && timestamp <= end;
}

function requireSuccessfulExecution<TResult>(
  envelope: ToolExecutionEnvelope<TResult>,
  context: TrustedRequestContext,
  expectedToolId: string,
  signer: DevHmacSigner
): TResult {
  if (envelope.requestId !== context.requestId || envelope.toolId !== expectedToolId) {
    fail("INVALID_TOOL_ENVELOPE", `${expectedToolId} is not bound to this request.`);
  }
  if (!verifyEnvelope(envelope, signer)) {
    fail("INVALID_TOOL_ENVELOPE", `${expectedToolId} has an invalid signature.`);
  }
  if (envelope.status !== "success" || envelope.result === null || envelope.error !== null) {
    fail("TOOL_RESULT_UNAVAILABLE", `${expectedToolId} did not return a usable result.`);
  }
  if (envelope.resultHash !== canonicalHash(envelope.result)) {
    fail("INVALID_TOOL_ENVELOPE", `${expectedToolId} result hash does not match its payload.`);
  }
  return envelope.result;
}

function addToMap(map: Map<string, FixedDecimalUnits>, key: string, amount: bigint): void {
  map.set(key, addFixed(map.get(key) ?? ZERO_FIXED, amount));
}

function sortedSymbols(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function createFact<TValue>(input: {
  context: TrustedRequestContext;
  workflowRunId: string;
  accountRef: string;
  asOf: string;
  factId: string;
  kind: string;
  value: TValue;
  toolExecutionIds: readonly string[];
  formulaId: string;
  signer: DevHmacSigner;
}): FactEnvelope<TValue> {
  const payload: Omit<FactEnvelope<TValue>, "integrity"> = {
    schemaVersion: "assistant-v3.fact.v1",
    factId: input.factId,
    requestId: input.context.requestId,
    workflowRunId: input.workflowRunId,
    kind: input.kind,
    subject: { type: "portfolio", ref: input.accountRef },
    asOf: input.asOf,
    createdAt: input.context.requestedAt,
    value: input.value,
    provenance: {
      toolExecutionIds: [...input.toolExecutionIds],
      inputFactIds: [],
      calculation: {
        id: "portfolio-analytics",
        version: ANALYTICS_VERSION,
        formulaId: input.formulaId
      }
    },
    quality: {
      status: "complete",
      coverage: COMPLETE_COVERAGE,
      flags: ["SYNTHETIC_CLIENT_DATA", "SYNTHETIC_MARKET_FIXTURE"]
    }
  };
  return attachIntegrity(payload, input.signer);
}

function validateContext(context: TrustedRequestContext): void {
  if (
    context.schemaVersion !== "assistant-v3.request-context.v1" ||
    context.jurisdiction !== "AZ" ||
    !context.requestId ||
    !context.principalRef ||
    !context.capabilities.includes("portfolio-read") ||
    !context.capabilities.includes("market-read")
  ) {
    fail("UNTRUSTED_CONTEXT", "The trusted request context is incomplete.");
  }
}

export function calculatePortfolioAnalytics(input: PortfolioAnalyticsInput): PortfolioAnalyticsResult {
  validateContext(input.context);
  const snapshot = requireSuccessfulExecution(
    input.portfolioExecution,
    input.context,
    "read-portfolio-snapshot",
    input.signer
  );
  const activity = requireSuccessfulExecution(
    input.activityExecution,
    input.context,
    "read-portfolio-activity",
    input.signer
  );
  const portfolio = { ...snapshot, activity };
  const market = requireSuccessfulExecution(
    input.marketExecution,
    input.context,
    "read-portfolio-market-evidence",
    input.signer
  );

  if (
    input.portfolioExecution.workflowRunId !== input.activityExecution.workflowRunId ||
    input.portfolioExecution.workflowRunId !== input.marketExecution.workflowRunId
  ) {
    fail("INVALID_TOOL_ENVELOPE", "Tool evidence came from different workflow runs.");
  }
  if (portfolio.principalRef !== input.context.principalRef) {
    fail("CLIENT_SCOPE_MISMATCH", "Portfolio principal does not match the trusted request.");
  }
  if (portfolio.baseCurrency !== portfolio.currentCash.currency ||
      portfolio.baseCurrency !== portfolio.openingCash.currency) {
    fail("UNSUPPORTED_CURRENCY", "The prototype supports one reconciled base currency.");
  }

  const currency = portfolio.baseCurrency;
  const observations = new Map<string, InstrumentMarketObservation>();
  for (const observation of market.observations) {
    if (observations.has(observation.symbol)) {
      fail("MISSING_MARKET_EVIDENCE", `Duplicate market evidence for ${observation.symbol}.`);
    }
    if (observation.currency !== currency) {
      fail("UNSUPPORTED_CURRENCY", `${observation.symbol} is not denominated in ${currency}.`);
    }
    observations.set(observation.symbol, observation);
  }

  const currentQuantity = new Map<string, FixedDecimalUnits>();
  const currentCostBasis = new Map<string, FixedDecimalUnits>();
  const instrumentIds = new Map<string, string>();
  for (const lot of portfolio.currentLots) {
    const quantity = parseFixedDecimal(lot.quantity);
    const unitCost = moneyUnits(lot.unitCost, currency);
    if (quantity <= ZERO_FIXED || unitCost < ZERO_FIXED) {
      fail("INVALID_ACTIVITY", `Lot ${lot.lotId} contains a non-positive quantity or negative cost.`);
    }
    addToMap(currentQuantity, lot.symbol, quantity);
    addToMap(currentCostBasis, lot.symbol, multiplyFixed(quantity, unitCost));
    const existingInstrument = instrumentIds.get(lot.symbol);
    if (existingInstrument && existingInstrument !== lot.instrumentId) {
      fail("INVALID_ACTIVITY", `Symbol ${lot.symbol} maps to multiple instruments.`);
    }
    instrumentIds.set(lot.symbol, lot.instrumentId);
  }

  const openingQuantity = new Map<string, FixedDecimalUnits>();
  for (const position of portfolio.openingPositions) {
    addToMap(openingQuantity, position.symbol, parseFixedDecimal(position.quantity));
    instrumentIds.set(position.symbol, position.instrumentId);
  }

  const buyQuantity = new Map<string, FixedDecimalUnits>();
  const sellQuantity = new Map<string, FixedDecimalUnits>();
  const buyGross = new Map<string, FixedDecimalUnits>();
  const sellGross = new Map<string, FixedDecimalUnits>();
  for (const transaction of portfolio.activity.transactions) {
    if (!withinPeriod(transaction.tradedAt, portfolio.periodStart, portfolio.asOf)) continue;
    const quantity = parseFixedDecimal(transaction.quantity);
    const unitPrice = moneyUnits(transaction.unitPrice, currency);
    const gross = moneyUnits(transaction.grossAmount, currency);
    if (quantity <= ZERO_FIXED || unitPrice < ZERO_FIXED || gross !== multiplyFixed(quantity, unitPrice)) {
      fail("INVALID_ACTIVITY", `Transaction ${transaction.transactionId} failed gross-amount validation.`);
    }
    const quantityMap = transaction.side === "BUY" ? buyQuantity : sellQuantity;
    const grossMap = transaction.side === "BUY" ? buyGross : sellGross;
    addToMap(quantityMap, transaction.symbol, quantity);
    addToMap(grossMap, transaction.symbol, gross);
  }

  // Buy-side trade fees form part of remaining open-lot cost under the
  // configured basis policy. Closed portions retain only their pro-rata share.
  const feesById = new Map(portfolio.activity.fees.map((fee) => [fee.feeId, fee]));
  for (const transaction of portfolio.activity.transactions) {
    if (transaction.side !== "BUY") continue;
    const originalQuantity = parseFixedDecimal(transaction.quantity);
    const remainingQuantity = sumFixed(
      portfolio.currentLots
        .filter((lot) => lot.symbol === transaction.symbol && lot.acquiredAt === transaction.tradedAt)
        .map((lot) => parseFixedDecimal(lot.quantity))
    );
    if (remainingQuantity === ZERO_FIXED) continue;
    if (remainingQuantity > originalQuantity) {
      fail("INVALID_ACTIVITY", `Remaining lot exceeds buy ${transaction.transactionId}.`);
    }
    const eligibleFees = sumFixed(transaction.feeIds.map((feeId) => {
      const fee = feesById.get(feeId);
      if (!fee || fee.category !== "trade") {
        fail("INVALID_ACTIVITY", `Buy ${transaction.transactionId} references an invalid fee.`);
      }
      return moneyUnits(fee.amount, currency);
    }));
    const capitalized = multiplyFixed(
      eligibleFees,
      divideFixed(remainingQuantity, originalQuantity)
    );
    addToMap(currentCostBasis, transaction.symbol, capitalized);
  }

  for (const action of portfolio.activity.corporateActions) {
    if (!withinPeriod(action.effectiveAt, portfolio.periodStart, portfolio.asOf)) continue;
    if (
      action.status !== "APPLIED" ||
      action.treatment !== "already-reflected-in-lots-and-market-evidence"
    ) {
      fail(
        "CORPORATE_ACTION_UNRESOLVED",
        `Corporate action ${action.corporateActionId} is not reflected in authoritative inputs.`
      );
    }
  }

  const allSymbols = sortedSymbols([
    ...openingQuantity.keys(),
    ...currentQuantity.keys(),
    ...buyQuantity.keys(),
    ...sellQuantity.keys()
  ]);
  for (const symbol of allSymbols) {
    const expected = addFixed(
      addFixed(openingQuantity.get(symbol) ?? ZERO_FIXED, buyQuantity.get(symbol) ?? ZERO_FIXED),
      -(sellQuantity.get(symbol) ?? ZERO_FIXED)
    );
    if (expected !== (currentQuantity.get(symbol) ?? ZERO_FIXED)) {
      fail(
        "POSITION_RECONCILIATION_FAILED",
        `${symbol} opening quantity plus activity does not equal current lots.`
      );
    }
    if (!observations.has(symbol)) {
      fail("MISSING_MARKET_EVIDENCE", `Market evidence is missing for ${symbol}.`);
    }
  }

  const positions: PositionCalculation[] = sortedSymbols(currentQuantity.keys()).map((symbol) => {
    const observation = observations.get(symbol);
    if (!observation) fail("MISSING_MARKET_EVIDENCE", `Market evidence is missing for ${symbol}.`);
    const quantity = currentQuantity.get(symbol) ?? ZERO_FIXED;
    return {
      instrumentId: instrumentIds.get(symbol) ?? observation.instrumentId,
      symbol,
      quantity,
      costBasis: currentCostBasis.get(symbol) ?? ZERO_FIXED,
      marketValue: multiplyFixed(quantity, parseFixedDecimal(observation.currentPrice)),
      monthStartValue: multiplyFixed(quantity, parseFixedDecimal(observation.oneMonthStartPrice)),
      observation
    };
  });

  const positionsValue = sumFixed(positions.map(({ marketValue }) => marketValue));
  const currentCash = moneyUnits(portfolio.currentCash, currency);
  const endingValue = addFixed(positionsValue, currentCash);

  let openingPositionsValue = ZERO_FIXED;
  for (const opening of portfolio.openingPositions) {
    const observation = observations.get(opening.symbol);
    if (!observation) fail("MISSING_MARKET_EVIDENCE", `YTD evidence is missing for ${opening.symbol}.`);
    openingPositionsValue = addFixed(
      openingPositionsValue,
      multiplyFixed(parseFixedDecimal(opening.quantity), parseFixedDecimal(observation.ytdStartPrice))
    );
  }
  const openingCash = moneyUnits(portfolio.openingCash, currency);
  const beginningValue = addFixed(openingPositionsValue, openingCash);

  let netExternalCashFlow = ZERO_FIXED;
  let deposits = ZERO_FIXED;
  let withdrawals = ZERO_FIXED;
  for (const flow of portfolio.activity.externalCashFlows) {
    if (!withinPeriod(flow.occurredAt, portfolio.periodStart, portfolio.asOf)) continue;
    const amount = moneyUnits(flow.amount, currency);
    if (amount < ZERO_FIXED) fail("INVALID_ACTIVITY", `Cash flow ${flow.cashFlowId} is negative.`);
    if (flow.direction === "DEPOSIT") {
      deposits = addFixed(deposits, amount);
      netExternalCashFlow = addFixed(netExternalCashFlow, amount);
    } else {
      withdrawals = addFixed(withdrawals, amount);
      netExternalCashFlow = subtractFixed(netExternalCashFlow, amount);
    }
  }

  let netDividends = ZERO_FIXED;
  for (const dividend of portfolio.activity.dividends) {
    if (!withinPeriod(dividend.paidAt, portfolio.periodStart, portfolio.asOf)) continue;
    const gross = moneyUnits(dividend.grossAmount, currency);
    const withholding = moneyUnits(dividend.withholdingTax, currency);
    const net = moneyUnits(dividend.netAmount, currency);
    if (subtractFixed(gross, withholding) !== net) {
      fail("INVALID_ACTIVITY", `Dividend ${dividend.dividendId} does not reconcile gross to net.`);
    }
    netDividends = addFixed(netDividends, net);
  }

  let fees = ZERO_FIXED;
  for (const fee of portfolio.activity.fees) {
    if (!withinPeriod(fee.chargedAt, portfolio.periodStart, portfolio.asOf)) continue;
    const amount = moneyUnits(fee.amount, currency);
    if (amount < ZERO_FIXED) fail("INVALID_ACTIVITY", `Fee ${fee.feeId} is negative.`);
    fees = addFixed(fees, amount);
  }

  const totalBuyGross = sumFixed(buyGross.values());
  const totalSellGross = sumFixed(sellGross.values());
  const expectedEndingCash = subtractFixed(
    addFixed(
      subtractFixed(
        addFixed(addFixed(openingCash, deposits), totalSellGross),
        addFixed(withdrawals, totalBuyGross)
      ),
      netDividends
    ),
    fees
  );
  const cashDifference = subtractFixed(currentCash, expectedEndingCash);
  if (cashDifference !== ZERO_FIXED) {
    fail(
      "CASH_RECONCILIATION_FAILED",
      `Ending cash differs from ledger activity by ${formatFixedDecimal(cashDifference)} ${currency}.`
    );
  }

  let positionPricePnl = ZERO_FIXED;
  let realizedPricePnl = ZERO_FIXED;
  for (const symbol of allSymbols) {
    const observation = observations.get(symbol);
    if (!observation) fail("MISSING_MARKET_EVIDENCE", `Market evidence is missing for ${symbol}.`);
    const endingPositionValue = multiplyFixed(
      currentQuantity.get(symbol) ?? ZERO_FIXED,
      parseFixedDecimal(observation.currentPrice)
    );
    const openingPositionValue = multiplyFixed(
      openingQuantity.get(symbol) ?? ZERO_FIXED,
      parseFixedDecimal(observation.ytdStartPrice)
    );
    positionPricePnl = addFixed(
      positionPricePnl,
      addFixed(
        subtractFixed(
          subtractFixed(endingPositionValue, openingPositionValue),
          buyGross.get(symbol) ?? ZERO_FIXED
        ),
        sellGross.get(symbol) ?? ZERO_FIXED
      )
    );
    realizedPricePnl = addFixed(
      realizedPricePnl,
      subtractFixed(
        sellGross.get(symbol) ?? ZERO_FIXED,
        multiplyFixed(
          sellQuantity.get(symbol) ?? ZERO_FIXED,
          parseFixedDecimal(observation.ytdStartPrice)
        )
      )
    );
  }
  const unrealizedPricePnl = subtractFixed(positionPricePnl, realizedPricePnl);
  const fxImpact = ZERO_FIXED;
  const componentMethodPnl = addFixed(
    subtractFixed(addFixed(realizedPricePnl, unrealizedPricePnl), fees),
    addFixed(netDividends, fxImpact)
  );
  const navMethodPnl = subtractFixed(subtractFixed(endingValue, beginningValue), netExternalCashFlow);
  const ytdDifference = subtractFixed(navMethodPnl, componentMethodPnl);
  if (ytdDifference !== ZERO_FIXED) {
    fail(
      "YTD_RECONCILIATION_FAILED",
      `NAV and component YTD P&L differ by ${formatFixedDecimal(ytdDifference)} ${currency}.`
    );
  }

  const valuationByFlow = new Map(
    portfolio.activity.performanceFlowValuations.map((valuation) => [valuation.cashFlowId, valuation])
  );
  const periodFlows = portfolio.activity.externalCashFlows
    .filter((flow) => withinPeriod(flow.occurredAt, portfolio.periodStart, portfolio.asOf))
    .slice()
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  let linkedFactor = ONE_FIXED;
  let subperiodStartValue = beginningValue;
  for (const flow of periodFlows) {
    const valuation = valuationByFlow.get(flow.cashFlowId);
    if (!valuation) {
      fail("TWR_VALUATION_MISSING", `No pre-flow valuation exists for ${flow.cashFlowId}.`);
    }
    const preFlowValue = moneyUnits(valuation.portfolioValueBeforeFlow, currency);
    if (preFlowValue <= ZERO_FIXED || subperiodStartValue <= ZERO_FIXED) {
      fail("TWR_VALUATION_MISSING", "TWR requires positive subperiod valuations.");
    }
    linkedFactor = multiplyFixed(linkedFactor, divideFixed(preFlowValue, subperiodStartValue));
    const signedFlow = flow.direction === "DEPOSIT"
      ? moneyUnits(flow.amount, currency)
      : -moneyUnits(flow.amount, currency);
    subperiodStartValue = addFixed(preFlowValue, signedFlow);
  }
  if (subperiodStartValue <= ZERO_FIXED || endingValue <= ZERO_FIXED) {
    fail("TWR_VALUATION_MISSING", "TWR requires positive opening and ending valuations.");
  }
  linkedFactor = multiplyFixed(linkedFactor, divideFixed(endingValue, subperiodStartValue));
  const twr = subtractFixed(linkedFactor, ONE_FIXED);

  const sectorValues = new Map<string, FixedDecimalUnits>();
  for (const position of positions) addToMap(sectorValues, position.observation.sector, position.marketValue);
  const sectorRows: SectorAllocationRow[] = [...sectorValues.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sector, marketValue]) => ({
      sector,
      marketValue: formatFixedDecimal(marketValue),
      investedAllocationRate: positionsValue === ZERO_FIXED
        ? formatFixedDecimal(ZERO_FIXED)
        : formatFixedDecimal(divideFixed(marketValue, positionsValue)),
      totalPortfolioAllocationRate: endingValue === ZERO_FIXED
        ? formatFixedDecimal(ZERO_FIXED)
        : formatFixedDecimal(divideFixed(marketValue, endingValue))
    }));

  const monthStartDates = new Set(positions.map(({ observation }) => observation.oneMonthStartPriceAsOf));
  if (monthStartDates.size !== 1) {
    fail("MISSING_MARKET_EVIDENCE", "One-month evidence does not use a common start timestamp.");
  }
  const monthStart = [...monthStartDates][0];
  if (!monthStart) fail("MISSING_MARKET_EVIDENCE", "One-month start timestamp is unavailable.");
  const recentActivity = [
    ...portfolio.activity.transactions.map(({ tradedAt }) => tradedAt),
    ...portfolio.activity.externalCashFlows.map(({ occurredAt }) => occurredAt),
    ...portfolio.activity.dividends.map(({ paidAt }) => paidAt),
    ...portfolio.activity.fees.map(({ chargedAt }) => chargedAt),
    ...portfolio.activity.corporateActions.map(({ effectiveAt }) => effectiveAt)
  ].some((timestamp) => timestamp > monthStart && timestamp <= portfolio.asOf);
  if (recentActivity) {
    fail(
      "ONE_MONTH_ACTIVITY_UNSUPPORTED",
      "One-month mover attribution requires transaction-aware period holdings."
    );
  }
  const monthStartPositionsValue = sumFixed(positions.map(({ monthStartValue }) => monthStartValue));
  const monthStartPortfolioValue = addFixed(monthStartPositionsValue, currentCash);
  const monthlyRows = positions.map((position) => {
    const startPrice = parseFixedDecimal(position.observation.oneMonthStartPrice);
    const endPrice = parseFixedDecimal(position.observation.currentPrice);
    const changeValue = multiplyFixed(position.quantity, subtractFixed(endPrice, startPrice));
    return {
      position,
      startPrice,
      endPrice,
      returnRate: divideFixed(subtractFixed(endPrice, startPrice), startPrice),
      changeValue,
      contributionRate: divideFixed(changeValue, monthStartPortfolioValue)
    };
  });
  const byAbsoluteReturn = monthlyRows.slice().sort((left, right) => {
    const leftMagnitude = absoluteFixed(left.returnRate);
    const rightMagnitude = absoluteFixed(right.returnRate);
    if (leftMagnitude === rightMagnitude) {
      return left.position.symbol.localeCompare(right.position.symbol);
    }
    return leftMagnitude > rightMagnitude ? -1 : 1;
  });
  const byAbsoluteContribution = monthlyRows.slice().sort((left, right) => {
    const leftMagnitude = absoluteFixed(left.contributionRate);
    const rightMagnitude = absoluteFixed(right.contributionRate);
    if (leftMagnitude === rightMagnitude) {
      return left.position.symbol.localeCompare(right.position.symbol);
    }
    return leftMagnitude > rightMagnitude ? -1 : 1;
  });
  const biggestMover = byAbsoluteReturn[0];
  const biggestContributor = byAbsoluteContribution[0];
  if (!biggestMover || !biggestContributor) {
    fail("MISSING_MARKET_EVIDENCE", "No current positions are available.");
  }
  const positionMove = (row: (typeof monthlyRows)[number]): OneMonthPositionMove => ({
    instrumentId: row.position.instrumentId,
    symbol: row.position.symbol,
    quantity: formatFixedDecimal(row.position.quantity),
    startPrice: formatFixedDecimal(row.startPrice),
    endPrice: formatFixedDecimal(row.endPrice),
    returnRate: formatFixedDecimal(row.returnRate),
    changeValue: formatFixedDecimal(row.changeValue),
    contributionToPortfolioRate: formatFixedDecimal(row.contributionRate)
  });
  const portfolioPriceChange = sumFixed(monthlyRows.map(({ changeValue }) => changeValue));

  const averageCostPositions: AverageCostPosition[] = positions.map((position) => ({
    instrumentId: position.instrumentId,
    symbol: position.symbol,
    quantity: formatFixedDecimal(position.quantity),
    costBasis: formatFixedDecimal(position.costBasis),
    averageUnitCost: formatFixedDecimal(divideFixed(position.costBasis, position.quantity)),
    currency
  }));
  const unrealizedPositions: UnrealizedPnlPosition[] = positions.map((position) => {
    const pnl = subtractFixed(position.marketValue, position.costBasis);
    return {
      ...averageCostPositions.find(({ symbol }) => symbol === position.symbol)!,
      currentPrice: position.observation.currentPrice,
      marketValue: formatFixedDecimal(position.marketValue),
      unrealizedPnl: formatFixedDecimal(pnl),
      unrealizedReturnRate: position.costBasis === ZERO_FIXED
        ? formatFixedDecimal(ZERO_FIXED)
        : formatFixedDecimal(divideFixed(pnl, position.costBasis))
    };
  });
  const totalCostBasis = sumFixed(positions.map(({ costBasis }) => costBasis));
  const totalUnrealized = subtractFixed(positionsValue, totalCostBasis);

  const currentValue: CurrentPortfolioValueFact = {
    currency,
    positionsValue: formatFixedDecimal(positionsValue),
    cashValue: formatFixedDecimal(currentCash),
    totalValue: formatFixedDecimal(endingValue),
    positions: positions.map((position) => ({
      instrumentId: position.instrumentId,
      symbol: position.symbol,
      quantity: formatFixedDecimal(position.quantity),
      unitPrice: position.observation.currentPrice,
      marketValue: formatFixedDecimal(position.marketValue)
    })),
    dataClass: "synthetic"
  };
  const averageCost: AverageCostFact = {
    methodology: "remaining-open-lot-basis-with-capitalized-buy-fees",
    policyVersion: portfolio.costBasisPolicy.version,
    positions: averageCostPositions
  };
  const unrealizedPnl: UnrealizedPnlFact = {
    currency,
    costBasis: formatFixedDecimal(totalCostBasis),
    marketValue: formatFixedDecimal(positionsValue),
    unrealizedPnl: formatFixedDecimal(totalUnrealized),
    unrealizedReturnRate: totalCostBasis === ZERO_FIXED
      ? formatFixedDecimal(ZERO_FIXED)
      : formatFixedDecimal(divideFixed(totalUnrealized, totalCostBasis)),
    positions: unrealizedPositions
  };
  const ytdPnl: YtdPnlFact = {
    currency,
    periodStart: portfolio.periodStart,
    periodEnd: portfolio.asOf,
    beginningPortfolioValue: formatFixedDecimal(beginningValue),
    endingPortfolioValue: formatFixedDecimal(endingValue),
    netExternalCashFlow: formatFixedDecimal(netExternalCashFlow),
    navMethodPnl: formatFixedDecimal(navMethodPnl),
    realizedPricePnl: formatFixedDecimal(realizedPricePnl),
    unrealizedPricePnl: formatFixedDecimal(unrealizedPricePnl),
    income: formatFixedDecimal(netDividends),
    fees: formatFixedDecimal(fees),
    fxImpact: formatFixedDecimal(fxImpact),
    componentMethodPnl: formatFixedDecimal(componentMethodPnl),
    reconciliationDifference: formatFixedDecimal(ytdDifference),
    endingCashExpected: formatFixedDecimal(expectedEndingCash),
    endingCashActual: formatFixedDecimal(currentCash),
    cashReconciliationDifference: formatFixedDecimal(cashDifference),
    reconciled: true
  };
  const timeWeightedReturn: TimeWeightedReturnFact = {
    periodStart: portfolio.periodStart,
    periodEnd: portfolio.asOf,
    returnRate: formatFixedDecimal(twr),
    subperiodCount: BigInt(periodFlows.length + 1).toString(),
    externalFlowCount: BigInt(periodFlows.length).toString(),
    methodology: "geometrically-linked-pre-flow-valuations-v1"
  };
  const sectorAllocation: SectorAllocationFact = {
    currency,
    investedValue: formatFixedDecimal(positionsValue),
    totalPortfolioValue: formatFixedDecimal(endingValue),
    cashValue: formatFixedDecimal(currentCash),
    cashTotalPortfolioAllocationRate: endingValue === ZERO_FIXED
      ? formatFixedDecimal(ZERO_FIXED)
      : formatFixedDecimal(divideFixed(currentCash, endingValue)),
    sectors: sectorRows
  };
  const oneMonthMover: OneMonthMoverFact = {
    periodStart: monthStart,
    periodEnd: portfolio.asOf,
    largestAbsolutePriceReturn: positionMove(biggestMover),
    largestAbsolutePortfolioContribution: positionMove(biggestContributor),
    portfolioStartValue: formatFixedDecimal(monthStartPortfolioValue),
    portfolioPriceChange: formatFixedDecimal(portfolioPriceChange),
    portfolioPriceChangeRate: formatFixedDecimal(
      divideFixed(portfolioPriceChange, monthStartPortfolioValue)
    ),
    currency
  };

  const common = {
    context: input.context,
    workflowRunId: input.portfolioExecution.workflowRunId,
    accountRef: portfolio.accountRef,
    asOf: portfolio.asOf,
    signer: input.signer
  };
  const portfolioToolIds = [
    input.portfolioExecution.executionId,
    input.activityExecution.executionId
  ] as const;
  const marketAndPortfolioToolIds = [
    input.portfolioExecution.executionId,
    input.marketExecution.executionId
  ] as const;

  return {
    schemaVersion: "assistant-v3.portfolio-analytics.v1",
    workflowRunId: input.portfolioExecution.workflowRunId,
    facts: {
      currentValue: createFact({
        ...common,
        factId: "portfolio-current-value",
        kind: "portfolio.current-value",
        value: currentValue,
        toolExecutionIds: marketAndPortfolioToolIds,
        formulaId: "sum-current-lot-quantity-times-price-plus-cash"
      }),
      averageCost: createFact({
        ...common,
        factId: "portfolio-average-cost",
        kind: "portfolio.average-cost",
        value: averageCost,
        toolExecutionIds: portfolioToolIds,
        formulaId: "remaining-lot-cost-basis-divided-by-quantity"
      }),
      unrealizedPnl: createFact({
        ...common,
        factId: "portfolio-unrealized-pnl",
        kind: "portfolio.unrealized-pnl",
        value: unrealizedPnl,
        toolExecutionIds: marketAndPortfolioToolIds,
        formulaId: "current-market-value-minus-remaining-lot-cost-basis"
      }),
      ytdPnl: createFact({
        ...common,
        factId: "portfolio-ytd-pnl",
        kind: "portfolio.ytd-pnl",
        value: ytdPnl,
        toolExecutionIds: marketAndPortfolioToolIds,
        formulaId: "ending-nav-minus-opening-nav-minus-net-external-flow-reconciled-to-components"
      }),
      timeWeightedReturn: createFact({
        ...common,
        factId: "portfolio-ytd-twr",
        kind: "portfolio.time-weighted-return",
        value: timeWeightedReturn,
        toolExecutionIds: marketAndPortfolioToolIds,
        formulaId: "geometric-link-of-pre-external-flow-subperiod-returns"
      }),
      sectorAllocation: createFact({
        ...common,
        factId: "portfolio-sector-allocation",
        kind: "portfolio.sector-allocation",
        value: sectorAllocation,
        toolExecutionIds: marketAndPortfolioToolIds,
        formulaId: "sector-market-value-over-invested-and-total-value"
      }),
      oneMonthMover: createFact({
        ...common,
        factId: "portfolio-one-month-mover",
        kind: "portfolio.one-month-mover",
        value: oneMonthMover,
        toolExecutionIds: marketAndPortfolioToolIds,
        formulaId: "largest-absolute-one-month-price-return-and-start-nav-contribution"
      })
    }
  };
}
