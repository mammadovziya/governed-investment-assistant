import type {
  BoundaryMarketSnapshot,
  BoundaryPriceHistory,
  CurrencyConversionArguments,
  CurrencyConversionResult
} from "./boundary-tools.js";
import type {
  DecimalString,
  FactEnvelope,
  ToolExecutionEnvelope,
  TrustedRequestContext
} from "./contracts.js";
import { EvidenceFactory } from "./evidence.js";
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
  AverageCostFact,
  CurrentPortfolioValueFact,
  OneMonthMoverFact,
  SectorAllocationFact,
  TimeWeightedReturnFact,
  YtdPnlFact
} from "./portfolio-analytics.js";
import type {
  MockPortfolioActivity,
  MockPortfolioPositionSnapshot
} from "./mock-portfolio.js";
import { canonicalHash, type DevHmacSigner } from "./signing.js";

export type PortfolioRoute =
  | "current_portfolio_value"
  | "largest_holding"
  | "ytd_gain_loss_twr"
  | "holding_average_cost"
  | "sector_allocation"
  | "one_month_mover_contribution";

export type PortfolioRouteFactValue =
  | CurrentPortfolioValueFact
  | AverageCostFact
  | YtdPnlFact
  | TimeWeightedReturnFact
  | SectorAllocationFact
  | OneMonthMoverFact;

export interface PortfolioRouteCalculation {
  route: PortfolioRoute;
  facts: readonly FactEnvelope<PortfolioRouteFactValue>[];
}

export interface PortfolioRouteCalculationInput {
  context: TrustedRequestContext;
  route: PortfolioRoute;
  portfolioExecution: ToolExecutionEnvelope<MockPortfolioPositionSnapshot>;
  activityExecution?: ToolExecutionEnvelope<MockPortfolioActivity>;
  marketExecutions?: readonly ToolExecutionEnvelope<BoundaryMarketSnapshot>[];
  historyExecutions?: readonly ToolExecutionEnvelope<BoundaryPriceHistory>[];
  currencyConversionExecution?: ToolExecutionEnvelope<CurrencyConversionResult>;
  currencyConversionArguments?: CurrencyConversionArguments;
  signer: DevHmacSigner;
}

export class PortfolioRouteCalculationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PortfolioRouteCalculationError";
  }
}

const CALCULATION_VERSION = "portfolio-route-calculators-v3.0.0";

function fail(code: string, message: string): never {
  throw new PortfolioRouteCalculationError(code, message);
}

function requireTool<TResult>(input: {
  context: TrustedRequestContext;
  envelope: ToolExecutionEnvelope<TResult> | undefined;
  toolId: string;
  signer: DevHmacSigner;
  workflowRunId?: string;
}): TResult {
  const envelope = input.envelope;
  const evidence = new EvidenceFactory({ signer: input.signer });
  if (
    !envelope ||
    envelope.toolId !== input.toolId ||
    envelope.requestId !== input.context.requestId ||
    (input.workflowRunId !== undefined && envelope.workflowRunId !== input.workflowRunId) ||
    envelope.status !== "success" ||
    envelope.result === null ||
    envelope.error !== null ||
    !evidence.verifyTool(envelope)
  ) {
    fail("INVALID_TOOL_EVIDENCE", `${input.toolId} did not provide valid signed evidence.`);
  }
  return envelope.result;
}

function addToMap(map: Map<string, FixedDecimalUnits>, key: string, value: bigint): void {
  map.set(key, addFixed(map.get(key) ?? ZERO_FIXED, value));
}

function lotsBySymbol(snapshot: MockPortfolioPositionSnapshot): Map<string, {
  quantity: FixedDecimalUnits;
  costBasis: FixedDecimalUnits;
}> {
  const result = new Map<string, { quantity: FixedDecimalUnits; costBasis: FixedDecimalUnits }>();
  for (const lot of snapshot.currentLots) {
    if (lot.unitCost.currency !== snapshot.baseCurrency) {
      fail("UNSUPPORTED_CURRENCY", "A lot uses a different currency from the portfolio.");
    }
    const quantity = parseFixedDecimal(lot.quantity);
    const unitCost = parseFixedDecimal(lot.unitCost.amount);
    if (quantity <= ZERO_FIXED || unitCost < ZERO_FIXED) {
      fail("INVALID_CLIENT_DATA", "A current lot contains invalid quantity or cost data.");
    }
    const current = result.get(lot.symbol) ?? { quantity: ZERO_FIXED, costBasis: ZERO_FIXED };
    result.set(lot.symbol, {
      quantity: addFixed(current.quantity, quantity),
      costBasis: addFixed(current.costBasis, multiplyFixed(quantity, unitCost))
    });
  }
  return result;
}

function successfulMarketMap(input: PortfolioRouteCalculationInput, workflowRunId: string) {
  const results = new Map<string, BoundaryMarketSnapshot>();
  for (const envelope of input.marketExecutions ?? []) {
    const snapshot = requireTool({
      context: input.context,
      envelope,
      toolId: "read-market-snapshot",
      signer: input.signer,
      workflowRunId
    });
    if (results.has(snapshot.symbol)) fail("DUPLICATE_MARKET_EVIDENCE", snapshot.symbol);
    results.set(snapshot.symbol, snapshot);
  }
  return results;
}

function successfulHistoryMap(input: PortfolioRouteCalculationInput, workflowRunId: string) {
  const results = new Map<string, BoundaryPriceHistory>();
  for (const envelope of input.historyExecutions ?? []) {
    const history = requireTool({
      context: input.context,
      envelope,
      toolId: "read-price-history",
      signer: input.signer,
      workflowRunId
    });
    if (results.has(history.symbol)) fail("DUPLICATE_HISTORY_EVIDENCE", history.symbol);
    results.set(history.symbol, history);
  }
  return results;
}

function sourceIds(envelopes: readonly ToolExecutionEnvelope<unknown>[]): string[] {
  return envelopes.map(({ executionId }) => executionId);
}

function createFact<TValue>(input: {
  context: TrustedRequestContext;
  workflowRunId: string;
  kind: string;
  value: TValue;
  asOf: string;
  formulaId: string;
  toolExecutionIds: readonly string[];
  signer: DevHmacSigner;
}): FactEnvelope<TValue> {
  const requestedAt = Date.parse(input.context.requestedAt);
  if (!Number.isFinite(requestedAt)) {
    fail("UNTRUSTED_CONTEXT", "The trusted request timestamp is invalid.");
  }
  return new EvidenceFactory({
    signer: input.signer,
    now: () => requestedAt
  }).fact({
    requestId: input.context.requestId,
    workflowRunId: input.workflowRunId,
    kind: input.kind,
    subject: { type: "portfolio", ref: "portfolio:primary" },
    asOf: input.asOf,
    value: input.value,
    provenance: {
      toolExecutionIds: [...input.toolExecutionIds],
      inputFactIds: [],
      calculation: {
        id: "portfolio-route-calculators",
        version: CALCULATION_VERSION,
        formulaId: input.formulaId
      }
    },
    quality: {
      status: "complete",
      coverage: formatFixedDecimal(ONE_FIXED),
      flags: ["SYNTHETIC_CLIENT_DATA", "PUBLIC_DEVELOPMENT_MARKET_FEED"]
    }
  });
}

function validateBase(input: PortfolioRouteCalculationInput): {
  snapshot: MockPortfolioPositionSnapshot;
  workflowRunId: string;
} {
  if (
    input.context.schemaVersion !== "assistant-v3.request-context.v1" ||
    input.context.jurisdiction !== "AZ" ||
    input.context.principalRef.length === 0
  ) {
    fail("UNTRUSTED_CONTEXT", "A trusted request context is required.");
  }
  const workflowRunId = input.portfolioExecution.workflowRunId;
  const snapshot = requireTool({
    context: input.context,
    envelope: input.portfolioExecution,
    toolId: "read-portfolio-snapshot",
    signer: input.signer,
    workflowRunId
  });
  if (snapshot.principalRef !== input.context.principalRef) {
    fail("CLIENT_SCOPE_MISMATCH", "Portfolio evidence belongs to another principal.");
  }
  if (
    snapshot.currentCash.currency !== snapshot.baseCurrency ||
    snapshot.openingCash.currency !== snapshot.baseCurrency
  ) {
    fail("UNSUPPORTED_CURRENCY", "The portfolio is not reconciled in one base currency.");
  }
  return { snapshot, workflowRunId };
}

function currentAndSector(input: PortfolioRouteCalculationInput): PortfolioRouteCalculation {
  const { snapshot, workflowRunId } = validateBase(input);
  const positions = lotsBySymbol(snapshot);
  const markets = successfulMarketMap(input, workflowRunId);
  const positionRows: Array<CurrentPortfolioValueFact["positions"][number]> = [];
  const sectorValues = new Map<string, FixedDecimalUnits>();
  let positionsValue = ZERO_FIXED;

  for (const [symbol, position] of [...positions.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const market = markets.get(symbol);
    const metadata = snapshot.instrumentMetadata.find((item) => item.symbol === symbol);
    if (!market || !metadata) fail("DATA_NOT_AVAILABLE", `Coverage is missing for ${symbol}.`);
    if (market.currency !== snapshot.baseCurrency || metadata.currency !== snapshot.baseCurrency) {
      fail("UNSUPPORTED_CURRENCY", `${symbol} is not denominated in the portfolio currency.`);
    }
    const marketValue = multiplyFixed(position.quantity, parseFixedDecimal(market.price));
    positionsValue = addFixed(positionsValue, marketValue);
    addToMap(sectorValues, metadata.sector, marketValue);
    positionRows.push({
      instrumentId: metadata.instrumentId,
      symbol,
      quantity: formatFixedDecimal(position.quantity),
      unitPrice: market.price,
      marketValue: formatFixedDecimal(marketValue)
    });
  }
  const cash = parseFixedDecimal(snapshot.currentCash.amount);
  const total = addFixed(positionsValue, cash);
  if (
    (input.currencyConversionExecution === undefined) !==
      (input.currencyConversionArguments === undefined)
  ) {
    fail(
      "INVALID_TOOL_EVIDENCE",
      "Currency conversion evidence and its expected arguments must be supplied together."
    );
  }
  let conversion: CurrentPortfolioValueFact["conversion"];
  if (
    input.currencyConversionExecution !== undefined &&
    input.currencyConversionArguments !== undefined
  ) {
    if (
      input.currencyConversionExecution.argumentsHash !==
        canonicalHash(input.currencyConversionArguments)
    ) {
      fail(
        "INVALID_TOOL_EVIDENCE",
        "Currency conversion arguments did not match the signed execution."
      );
    }
    const converted = requireTool({
      context: input.context,
      envelope: input.currencyConversionExecution,
      toolId: "convert-currency",
      signer: input.signer,
      workflowRunId
    });
    const expected = input.currencyConversionArguments;
    const calculatedConvertedAmount = formatFixedDecimal(
      multiplyFixed(total, parseFixedDecimal(converted.exchangeRate))
    );
    if (
      input.route !== "current_portfolio_value" ||
      expected.scope !== "provided-amount" ||
      converted.schemaVersion !== "assistant-v3.currency-conversion.v1" ||
      converted.scope !== "provided-amount" ||
      converted.sourceCurrency !== snapshot.baseCurrency ||
      converted.sourceCurrency !== expected.sourceCurrency ||
      converted.targetCurrency !== expected.targetCurrency ||
      converted.sourceAmount !== formatFixedDecimal(total) ||
      converted.sourceAmount !== expected.amount ||
      converted.convertedAmount !== calculatedConvertedAmount ||
      converted.portfolioDataClass !== null ||
      converted.portfolioAsOf !== null ||
      converted.marketAsOf.length !== 0 ||
      !Number.isFinite(Date.parse(converted.rateAsOf)) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(converted.rateEffectiveDate) ||
      !converted.rateSourceUrl.startsWith("https://www.cbar.az/")
    ) {
      fail(
        "INVALID_TOOL_EVIDENCE",
        "Currency conversion evidence did not match the calculated portfolio value."
      );
    }
    conversion = {
      sourceCurrency: converted.sourceCurrency,
      targetCurrency: converted.targetCurrency,
      sourceAmount: converted.sourceAmount,
      exchangeRate: converted.exchangeRate,
      convertedAmount: converted.convertedAmount,
      rateEffectiveDate: converted.rateEffectiveDate,
      rateAsOf: converted.rateAsOf,
      rateSourceUrl: converted.rateSourceUrl
    };
  }
  const toolIds = sourceIds([
    input.portfolioExecution,
    ...(input.marketExecutions ?? []),
    ...(input.currencyConversionExecution === undefined
      ? []
      : [input.currencyConversionExecution])
  ]);

  if (
    input.route === "current_portfolio_value" ||
    input.route === "largest_holding"
  ) {
    const value: CurrentPortfolioValueFact = {
      currency: snapshot.baseCurrency,
      positionsValue: formatFixedDecimal(positionsValue),
      cashValue: formatFixedDecimal(cash),
      totalValue: formatFixedDecimal(total),
      positions: positionRows,
      dataClass: "synthetic",
      ...(conversion === undefined ? {} : { conversion })
    };
    return {
      route: input.route,
      facts: [createFact({
        context: input.context,
        workflowRunId,
        kind: "portfolio.current-value",
        value,
        asOf: snapshot.asOf,
        formulaId: "sum-current-lot-quantity-times-signed-price-plus-cash",
        toolExecutionIds: toolIds,
        signer: input.signer
      })]
    };
  }

  const rows = [...sectorValues.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sector, marketValue]) => ({
      sector,
      marketValue: formatFixedDecimal(marketValue),
      investedAllocationRate: positionsValue === ZERO_FIXED
        ? formatFixedDecimal(ZERO_FIXED)
        : formatFixedDecimal(divideFixed(marketValue, positionsValue)),
      totalPortfolioAllocationRate: total === ZERO_FIXED
        ? formatFixedDecimal(ZERO_FIXED)
        : formatFixedDecimal(divideFixed(marketValue, total))
    }));
  const value: SectorAllocationFact = {
    currency: snapshot.baseCurrency,
    investedValue: formatFixedDecimal(positionsValue),
    totalPortfolioValue: formatFixedDecimal(total),
    cashValue: formatFixedDecimal(cash),
    cashTotalPortfolioAllocationRate: total === ZERO_FIXED
      ? formatFixedDecimal(ZERO_FIXED)
      : formatFixedDecimal(divideFixed(cash, total)),
    sectors: rows
  };
  return {
    route: input.route,
    facts: [createFact({
      context: input.context,
      workflowRunId,
      kind: "portfolio.sector-allocation",
      value,
      asOf: snapshot.asOf,
      formulaId: "signed-sector-market-value-over-invested-and-total-portfolio-value",
      toolExecutionIds: toolIds,
      signer: input.signer
    })]
  };
}

function requireActivity(
  input: PortfolioRouteCalculationInput,
  workflowRunId: string
): MockPortfolioActivity {
  return requireTool({
    context: input.context,
    envelope: input.activityExecution,
    toolId: "read-portfolio-activity",
    signer: input.signer,
    workflowRunId
  });
}

function averageCost(input: PortfolioRouteCalculationInput): PortfolioRouteCalculation {
  const { snapshot, workflowRunId } = validateBase(input);
  const activity = requireActivity(input, workflowRunId);
  const positions = lotsBySymbol(snapshot);
  const feesById = new Map(activity.fees.map((fee) => [fee.feeId, fee]));

  for (const transaction of activity.transactions) {
    if (transaction.side !== "BUY") continue;
    const originalQuantity = parseFixedDecimal(transaction.quantity);
    const remainingQuantity = sumFixed(snapshot.currentLots
      .filter((lot) => lot.symbol === transaction.symbol && lot.acquiredAt === transaction.tradedAt)
      .map((lot) => parseFixedDecimal(lot.quantity)));
    if (remainingQuantity === ZERO_FIXED) continue;
    if (remainingQuantity > originalQuantity) {
      fail("INVALID_CLIENT_DATA", "Remaining quantity exceeds its originating buy.");
    }
    const tradeFees = sumFixed(transaction.feeIds.map((feeId) => {
      const fee = feesById.get(feeId);
      if (!fee || fee.category !== "trade" || fee.amount.currency !== snapshot.baseCurrency) {
        fail("INVALID_CLIENT_DATA", "A buy references an invalid trade fee.");
      }
      return parseFixedDecimal(fee.amount.amount);
    }));
    const capitalized = multiplyFixed(tradeFees, divideFixed(remainingQuantity, originalQuantity));
    const position = positions.get(transaction.symbol);
    if (!position) fail("INVALID_CLIENT_DATA", "A remaining buy lot is missing.");
    position.costBasis = addFixed(position.costBasis, capitalized);
  }

  const value: AverageCostFact = {
    methodology: "remaining-open-lot-basis-with-capitalized-buy-fees",
    policyVersion: snapshot.costBasisPolicy.version,
    positions: [...positions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([symbol, position]) => {
        const metadata = snapshot.instrumentMetadata.find((item) => item.symbol === symbol);
        if (!metadata) fail("DATA_NOT_AVAILABLE", `Instrument metadata is missing for ${symbol}.`);
        return {
          instrumentId: metadata.instrumentId,
          symbol,
          quantity: formatFixedDecimal(position.quantity),
          costBasis: formatFixedDecimal(position.costBasis),
          averageUnitCost: formatFixedDecimal(divideFixed(position.costBasis, position.quantity)),
          currency: snapshot.baseCurrency
        };
      })
  };
  return {
    route: input.route,
    facts: [createFact({
      context: input.context,
      workflowRunId,
      kind: "portfolio.average-cost",
      value,
      asOf: snapshot.asOf,
      formulaId: "remaining-open-lot-basis-plus-pro-rata-buy-fees-divided-by-quantity",
      toolExecutionIds: sourceIds([input.portfolioExecution, input.activityExecution!]),
      signer: input.signer
    })]
  };
}

function within(timestamp: string, start: string, end: string): boolean {
  return timestamp >= start && timestamp <= end;
}

function historyStartPrice(history: BoundaryPriceHistory, start: string): {
  price: DecimalString;
  timestamp: string;
} {
  const before = history.points.filter(({ timestamp }) => timestamp <= start).at(-1);
  const point = before ?? history.points.find(({ timestamp }) => timestamp >= start);
  if (!point) fail("DATA_NOT_AVAILABLE", `No start-period history exists for ${history.symbol}.`);
  return { price: point.close, timestamp: point.timestamp };
}

function ytd(input: PortfolioRouteCalculationInput): PortfolioRouteCalculation {
  const { snapshot, workflowRunId } = validateBase(input);
  const activity = requireActivity(input, workflowRunId);
  const markets = successfulMarketMap(input, workflowRunId);
  const histories = successfulHistoryMap(input, workflowRunId);
  const current = lotsBySymbol(snapshot);
  const opening = new Map<string, FixedDecimalUnits>();
  const buys = new Map<string, FixedDecimalUnits>();
  const sells = new Map<string, FixedDecimalUnits>();
  const buyGross = new Map<string, FixedDecimalUnits>();
  const sellGross = new Map<string, FixedDecimalUnits>();

  for (const position of snapshot.openingPositions) {
    addToMap(opening, position.symbol, parseFixedDecimal(position.quantity));
  }
  for (const transaction of activity.transactions) {
    if (!within(transaction.tradedAt, snapshot.periodStart, snapshot.asOf)) continue;
    if (
      transaction.unitPrice.currency !== snapshot.baseCurrency ||
      transaction.grossAmount.currency !== snapshot.baseCurrency
    ) fail("UNSUPPORTED_CURRENCY", "A transaction uses another currency.");
    const quantity = parseFixedDecimal(transaction.quantity);
    const unitPrice = parseFixedDecimal(transaction.unitPrice.amount);
    const gross = parseFixedDecimal(transaction.grossAmount.amount);
    if (gross !== multiplyFixed(quantity, unitPrice)) {
      fail("INVALID_CLIENT_DATA", "A transaction gross amount does not reconcile.");
    }
    addToMap(transaction.side === "BUY" ? buys : sells, transaction.symbol, quantity);
    addToMap(transaction.side === "BUY" ? buyGross : sellGross, transaction.symbol, gross);
  }
  const allSymbols = [...new Set([...opening.keys(), ...current.keys(), ...buys.keys(), ...sells.keys()])].sort();
  for (const symbol of allSymbols) {
    const expected = subtractFixed(
      addFixed(opening.get(symbol) ?? ZERO_FIXED, buys.get(symbol) ?? ZERO_FIXED),
      sells.get(symbol) ?? ZERO_FIXED
    );
    if (expected !== (current.get(symbol)?.quantity ?? ZERO_FIXED)) {
      fail("POSITION_RECONCILIATION_FAILED", `${symbol} quantity does not reconcile.`);
    }
    if (!markets.has(symbol) || !histories.has(symbol)) {
      fail("DATA_NOT_AVAILABLE", `YTD market coverage is missing for ${symbol}.`);
    }
  }

  let endingPositions = ZERO_FIXED;
  let beginningPositions = ZERO_FIXED;
  let positionPricePnl = ZERO_FIXED;
  let realizedPricePnl = ZERO_FIXED;
  for (const symbol of allSymbols) {
    const market = markets.get(symbol)!;
    const history = histories.get(symbol)!;
    const startPrice = parseFixedDecimal(historyStartPrice(history, snapshot.periodStart).price);
    const currentPrice = parseFixedDecimal(market.price);
    const endingValue = multiplyFixed(current.get(symbol)?.quantity ?? ZERO_FIXED, currentPrice);
    const beginningValue = multiplyFixed(opening.get(symbol) ?? ZERO_FIXED, startPrice);
    endingPositions = addFixed(endingPositions, endingValue);
    beginningPositions = addFixed(beginningPositions, beginningValue);
    positionPricePnl = addFixed(positionPricePnl,
      addFixed(
        subtractFixed(subtractFixed(endingValue, beginningValue), buyGross.get(symbol) ?? ZERO_FIXED),
        sellGross.get(symbol) ?? ZERO_FIXED
      ));
    realizedPricePnl = addFixed(realizedPricePnl,
      subtractFixed(
        sellGross.get(symbol) ?? ZERO_FIXED,
        multiplyFixed(sells.get(symbol) ?? ZERO_FIXED, startPrice)
      ));
  }

  const openingCash = parseFixedDecimal(snapshot.openingCash.amount);
  const endingCash = parseFixedDecimal(snapshot.currentCash.amount);
  let deposits = ZERO_FIXED;
  let withdrawals = ZERO_FIXED;
  let netExternalFlow = ZERO_FIXED;
  for (const flow of activity.externalCashFlows) {
    if (!within(flow.occurredAt, snapshot.periodStart, snapshot.asOf)) continue;
    if (flow.amount.currency !== snapshot.baseCurrency) fail("UNSUPPORTED_CURRENCY", "Cash-flow currency mismatch.");
    const amount = parseFixedDecimal(flow.amount.amount);
    if (flow.direction === "DEPOSIT") {
      deposits = addFixed(deposits, amount);
      netExternalFlow = addFixed(netExternalFlow, amount);
    } else {
      withdrawals = addFixed(withdrawals, amount);
      netExternalFlow = subtractFixed(netExternalFlow, amount);
    }
  }
  let income = ZERO_FIXED;
  for (const dividend of activity.dividends) {
    if (!within(dividend.paidAt, snapshot.periodStart, snapshot.asOf)) continue;
    const gross = parseFixedDecimal(dividend.grossAmount.amount);
    const tax = parseFixedDecimal(dividend.withholdingTax.amount);
    const net = parseFixedDecimal(dividend.netAmount.amount);
    if (
      dividend.grossAmount.currency !== snapshot.baseCurrency ||
      dividend.withholdingTax.currency !== snapshot.baseCurrency ||
      dividend.netAmount.currency !== snapshot.baseCurrency ||
      subtractFixed(gross, tax) !== net
    ) fail("INVALID_CLIENT_DATA", "Dividend data does not reconcile.");
    income = addFixed(income, net);
  }
  let fees = ZERO_FIXED;
  for (const fee of activity.fees) {
    if (!within(fee.chargedAt, snapshot.periodStart, snapshot.asOf)) continue;
    if (fee.amount.currency !== snapshot.baseCurrency) fail("UNSUPPORTED_CURRENCY", "Fee currency mismatch.");
    fees = addFixed(fees, parseFixedDecimal(fee.amount.amount));
  }
  const expectedCash = subtractFixed(
    addFixed(
      subtractFixed(
        addFixed(addFixed(openingCash, deposits), sumFixed(sellGross.values())),
        addFixed(withdrawals, sumFixed(buyGross.values()))
      ),
      income
    ),
    fees
  );
  const cashDifference = subtractFixed(endingCash, expectedCash);
  if (cashDifference !== ZERO_FIXED) fail("CASH_RECONCILIATION_FAILED", "Ending cash does not reconcile.");

  const beginningValue = addFixed(beginningPositions, openingCash);
  const endingValue = addFixed(endingPositions, endingCash);
  const navPnl = subtractFixed(subtractFixed(endingValue, beginningValue), netExternalFlow);
  const unrealizedPricePnl = subtractFixed(positionPricePnl, realizedPricePnl);
  const componentPnl = subtractFixed(addFixed(positionPricePnl, income), fees);
  const reconciliationDifference = subtractFixed(navPnl, componentPnl);
  if (reconciliationDifference !== ZERO_FIXED) {
    fail("YTD_RECONCILIATION_FAILED", "NAV and component P&L do not reconcile.");
  }

  const valuations = new Map(activity.performanceFlowValuations.map((item) => [item.cashFlowId, item]));
  const flows = activity.externalCashFlows
    .filter((flow) => within(flow.occurredAt, snapshot.periodStart, snapshot.asOf))
    .slice()
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  let linkedFactor = ONE_FIXED;
  let subperiodStart = beginningValue;
  for (const flow of flows) {
    const valuation = valuations.get(flow.cashFlowId);
    if (!valuation || valuation.portfolioValueBeforeFlow.currency !== snapshot.baseCurrency) {
      fail("DATA_NOT_AVAILABLE", "A pre-flow valuation is missing.");
    }
    const preFlow = parseFixedDecimal(valuation.portfolioValueBeforeFlow.amount);
    if (preFlow <= ZERO_FIXED || subperiodStart <= ZERO_FIXED) fail("DATA_NOT_AVAILABLE", "TWR valuation is invalid.");
    linkedFactor = multiplyFixed(linkedFactor, divideFixed(preFlow, subperiodStart));
    const signedFlow = flow.direction === "DEPOSIT"
      ? parseFixedDecimal(flow.amount.amount)
      : -parseFixedDecimal(flow.amount.amount);
    subperiodStart = addFixed(preFlow, signedFlow);
  }
  if (endingValue <= ZERO_FIXED || subperiodStart <= ZERO_FIXED) fail("DATA_NOT_AVAILABLE", "TWR cannot be calculated.");
  const twr = subtractFixed(
    multiplyFixed(linkedFactor, divideFixed(endingValue, subperiodStart)),
    ONE_FIXED
  );

  const pnlValue: YtdPnlFact = {
    currency: snapshot.baseCurrency,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.asOf,
    beginningPortfolioValue: formatFixedDecimal(beginningValue),
    endingPortfolioValue: formatFixedDecimal(endingValue),
    netExternalCashFlow: formatFixedDecimal(netExternalFlow),
    navMethodPnl: formatFixedDecimal(navPnl),
    realizedPricePnl: formatFixedDecimal(realizedPricePnl),
    unrealizedPricePnl: formatFixedDecimal(unrealizedPricePnl),
    income: formatFixedDecimal(income),
    fees: formatFixedDecimal(fees),
    fxImpact: formatFixedDecimal(ZERO_FIXED),
    componentMethodPnl: formatFixedDecimal(componentPnl),
    reconciliationDifference: formatFixedDecimal(reconciliationDifference),
    endingCashExpected: formatFixedDecimal(expectedCash),
    endingCashActual: formatFixedDecimal(endingCash),
    cashReconciliationDifference: formatFixedDecimal(cashDifference),
    reconciled: true
  };
  const twrValue: TimeWeightedReturnFact = {
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.asOf,
    returnRate: formatFixedDecimal(twr),
    subperiodCount: String(flows.length + 1),
    externalFlowCount: String(flows.length),
    methodology: "geometrically-linked-pre-flow-valuations-v1"
  };
  const toolIds = sourceIds([
    input.portfolioExecution,
    input.activityExecution!,
    ...(input.marketExecutions ?? []),
    ...(input.historyExecutions ?? [])
  ]);
  return {
    route: input.route,
    facts: [
      createFact({
        context: input.context,
        workflowRunId,
        kind: "portfolio.ytd-pnl",
        value: pnlValue,
        asOf: snapshot.asOf,
        formulaId: "reconciled-realized-plus-unrealized-plus-income-minus-fees-plus-fx",
        toolExecutionIds: toolIds,
        signer: input.signer
      }),
      createFact({
        context: input.context,
        workflowRunId,
        kind: "portfolio.time-weighted-return",
        value: twrValue,
        asOf: snapshot.asOf,
        formulaId: "geometrically-linked-pre-flow-valuations",
        toolExecutionIds: toolIds,
        signer: input.signer
      })
    ]
  };
}

function oneMonth(input: PortfolioRouteCalculationInput): PortfolioRouteCalculation {
  const { snapshot, workflowRunId } = validateBase(input);
  const activity = requireActivity(input, workflowRunId);
  const histories = successfulHistoryMap(input, workflowRunId);
  const positions = lotsBySymbol(snapshot);
  const firstDates = [...positions.keys()].map((symbol) => {
    const history = histories.get(symbol);
    if (!history || history.range !== "1m" || history.points.length < 2) {
      fail("DATA_NOT_AVAILABLE", `One-month history is missing for ${symbol}.`);
    }
    return history.points[0]!.timestamp;
  });
  const periodStart = firstDates.sort().at(-1);
  if (!periodStart) fail("DATA_NOT_AVAILABLE", "One-month period is unavailable.");
  const recentActivity = [
    ...activity.transactions.map(({ tradedAt }) => tradedAt),
    ...activity.externalCashFlows.map(({ occurredAt }) => occurredAt),
    ...activity.dividends.map(({ paidAt }) => paidAt),
    ...activity.fees.map(({ chargedAt }) => chargedAt),
    ...activity.corporateActions.map(({ effectiveAt }) => effectiveAt)
  ].some((timestamp) => timestamp > periodStart && timestamp <= snapshot.asOf);
  if (recentActivity) fail("DATA_NOT_AVAILABLE", "Transaction-aware one-month attribution is unavailable.");

  const cash = parseFixedDecimal(snapshot.currentCash.amount);
  const rows = [...positions.entries()].map(([symbol, position]) => {
    const history = histories.get(symbol)!;
    const start = history.points.find(({ timestamp }) => timestamp >= periodStart);
    const end = history.points.at(-1);
    const metadata = snapshot.instrumentMetadata.find((item) => item.symbol === symbol);
    if (!start || !end || !metadata) fail("DATA_NOT_AVAILABLE", `One-month coverage is incomplete for ${symbol}.`);
    const startPrice = parseFixedDecimal(start.close);
    const endPrice = parseFixedDecimal(end.close);
    if (startPrice <= ZERO_FIXED) fail("INVALID_MARKET_EVIDENCE", "A start price is not positive.");
    const changeValue = multiplyFixed(position.quantity, subtractFixed(endPrice, startPrice));
    return { symbol, position, metadata, start, end, startPrice, endPrice, changeValue };
  });
  const startPositions = sumFixed(rows.map((row) => multiplyFixed(row.position.quantity, row.startPrice)));
  const startPortfolio = addFixed(startPositions, cash);
  if (startPortfolio <= ZERO_FIXED) fail("DATA_NOT_AVAILABLE", "One-month start value is unavailable.");
  const expanded = rows.map((row) => ({
    ...row,
    returnRate: divideFixed(subtractFixed(row.endPrice, row.startPrice), row.startPrice),
    contribution: divideFixed(row.changeValue, startPortfolio)
  }));
  const byReturn = expanded.slice().sort((left, right) => {
    const difference = absoluteFixed(right.returnRate) - absoluteFixed(left.returnRate);
    return difference === 0n ? left.symbol.localeCompare(right.symbol) : difference > 0n ? 1 : -1;
  })[0];
  const byContribution = expanded.slice().sort((left, right) => {
    const difference = absoluteFixed(right.contribution) - absoluteFixed(left.contribution);
    return difference === 0n ? left.symbol.localeCompare(right.symbol) : difference > 0n ? 1 : -1;
  })[0];
  if (!byReturn || !byContribution) fail("DATA_NOT_AVAILABLE", "No positions are available.");
  const move = (row: typeof byReturn) => ({
    instrumentId: row.metadata.instrumentId,
    symbol: row.symbol,
    quantity: formatFixedDecimal(row.position.quantity),
    startPrice: formatFixedDecimal(row.startPrice),
    endPrice: formatFixedDecimal(row.endPrice),
    returnRate: formatFixedDecimal(row.returnRate),
    changeValue: formatFixedDecimal(row.changeValue),
    contributionToPortfolioRate: formatFixedDecimal(row.contribution)
  });
  const totalChange = sumFixed(expanded.map(({ changeValue }) => changeValue));
  const value: OneMonthMoverFact = {
    periodStart,
    periodEnd: expanded.map(({ end }) => end.timestamp).sort().at(0) ?? snapshot.asOf,
    largestAbsolutePriceReturn: move(byReturn),
    largestAbsolutePortfolioContribution: move(byContribution),
    portfolioStartValue: formatFixedDecimal(startPortfolio),
    portfolioPriceChange: formatFixedDecimal(totalChange),
    portfolioPriceChangeRate: formatFixedDecimal(divideFixed(totalChange, startPortfolio)),
    currency: snapshot.baseCurrency
  };
  return {
    route: input.route,
    facts: [createFact({
      context: input.context,
      workflowRunId,
      kind: "portfolio.one-month-mover",
      value,
      asOf: value.periodEnd,
      formulaId: "largest-absolute-price-return-and-portfolio-contribution-from-signed-history",
      toolExecutionIds: sourceIds([
        input.portfolioExecution,
        input.activityExecution!,
        ...(input.historyExecutions ?? [])
      ]),
      signer: input.signer
    })]
  };
}

/** Route-scoped calculations read no broader private data than policy permits. */
export function calculatePortfolioRoute(
  input: PortfolioRouteCalculationInput
): PortfolioRouteCalculation {
  if (
    input.route === "current_portfolio_value" ||
    input.route === "largest_holding" ||
    input.route === "sector_allocation"
  ) {
    return currentAndSector(input);
  }
  if (input.route === "holding_average_cost") return averageCost(input);
  if (input.route === "ytd_gain_loss_twr") return ytd(input);
  return oneMonth(input);
}
