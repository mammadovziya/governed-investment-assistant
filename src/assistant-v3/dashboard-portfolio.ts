import type {
  MarketSnapshot,
  MockClient,
  PortfolioHolding,
  PortfolioSummary
} from "../domain/types.js";
import {
  ZERO_FIXED,
  addFixed,
  divideFixed,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal,
  subtractFixed,
  sumFixed,
  type FixedDecimalUnits
} from "./fixed-decimal.js";
import {
  mockPortfolioSnapshot,
  type MockPortfolioSnapshot
} from "./mock-portfolio.js";

/**
 * The dashboard is a temporary compatibility surface. All financial work is
 * completed in fixed-point units; JavaScript numbers are introduced only by
 * the final mapping to the legacy browser contract.
 */
export interface V3DashboardPortfolioPort {
  getClient(): Omit<MockClient, "holdings" | "cash"> & { isMock: true };
  getSummary(): Promise<PortfolioSummary>;
}

export interface V3DashboardMarketPort {
  getSnapshot(symbol: string): Promise<MarketSnapshot>;
}

interface FixedHolding {
  symbol: string;
  name: string;
  assetClass: "Equity" | "ETF" | "Bond";
  currency: "USD";
  quantity: FixedDecimalUnits;
  costBasis: FixedDecimalUnits;
  averageCost: FixedDecimalUnits;
}

interface FixedValuedHolding extends FixedHolding {
  quote: MarketSnapshot | null;
  marketValue: FixedDecimalUnits | null;
  unrealizedPnl: FixedDecimalUnits | null;
  unrealizedPnlRate: FixedDecimalUnits | null;
  dayChangeValue: FixedDecimalUnits | null;
  allocationRate: FixedDecimalUnits | null;
}

const HUNDRED = parseFixedDecimal("100");

function fail(message: string): never {
  throw new Error(`Invalid V3 dashboard portfolio fixture: ${message}`);
}

function asAssetClass(value: MockPortfolioSnapshot["instrumentMetadata"][number]["instrumentType"]):
  FixedHolding["assetClass"] {
  if (value === "EQUITY") return "Equity";
  if (value === "ETF") return "ETF";
  return "Bond";
}

function marketNumberToFixed(value: number, field: string): FixedDecimalUnits {
  if (!Number.isFinite(value)) fail(`${field} is not finite.`);
  // MarketSnapshot is a transitional number-based provider contract. Normalize
  // it once at ingestion to the same eight-place scale as every V3 calculator.
  return parseFixedDecimal(value.toFixed(8));
}

function roundFixed(value: bigint, decimalPlaces: number): FixedDecimalUnits {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 8) {
    throw new RangeError("Dashboard decimal places must be between zero and eight.");
  }
  const step = 10n ** BigInt(8 - decimalPlaces);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const quotient = absolute / step;
  const remainder = absolute % step;
  const rounded = remainder * 2n >= step ? quotient + 1n : quotient;
  return ((negative ? -rounded : rounded) * step) as FixedDecimalUnits;
}

/** The only fixed-point -> JavaScript number boundary in this adapter. */
function presentationNumber(value: bigint, decimalPlaces: number): number {
  return Number(formatFixedDecimal(roundFixed(value, decimalPlaces)));
}

function percentageRate(numerator: bigint, denominator: bigint): FixedDecimalUnits | null {
  if (denominator === ZERO_FIXED) return null;
  return multiplyFixed(divideFixed(numerator, denominator), HUNDRED);
}

function clientId(principalRef: string): string {
  const marker = "principal:";
  return principalRef.startsWith(marker) ? principalRef.slice(marker.length) : principalRef;
}

/**
 * Read-only adapter for the non-assistant dashboard endpoints. It deliberately
 * consumes the exact V3 synthetic ledger fixture used by private boundary
 * tools and enriches it with the active V3 public-market provider.
 */
export class V3DashboardPortfolioAdapter implements V3DashboardPortfolioPort {
  readonly #snapshot: MockPortfolioSnapshot;

  constructor(
    private readonly market: V3DashboardMarketPort,
    snapshot: MockPortfolioSnapshot = mockPortfolioSnapshot
  ) {
    this.#snapshot = structuredClone(snapshot);
    if (this.#snapshot.baseCurrency !== "USD") {
      fail("the legacy dashboard supports USD portfolios only.");
    }
    if (this.#snapshot.currentCash.currency !== this.#snapshot.baseCurrency) {
      fail("current cash is not denominated in the base currency.");
    }
    if (this.#snapshot.costBasisPolicy.buyTradeFees !== "capitalize-pro-rata-to-remaining-lot") {
      fail("the buy-fee cost-basis policy is unsupported.");
    }
  }

  getClient(): Omit<MockClient, "holdings" | "cash"> & { isMock: true } {
    return {
      id: clientId(this.#snapshot.principalRef),
      displayName: "Demo Investor",
      initials: "DI",
      locale: "az-AZ",
      accountLabel: "Demo brokerage account",
      baseCurrency: "USD",
      isMock: true
    };
  }

  async getSummary(): Promise<PortfolioSummary> {
    const fixedHoldings = this.#fixedHoldings();
    const quoteResults = await Promise.allSettled(
      fixedHoldings.map(async ({ symbol }) => {
        const quote = await this.market.getSnapshot(symbol);
        if (quote.symbol !== symbol || quote.currency !== this.#snapshot.baseCurrency) {
          throw new Error("Market evidence does not match the requested portfolio instrument.");
        }
        marketNumberToFixed(quote.price, `${symbol} price`);
        if (quote.change !== null) marketNumberToFixed(quote.change, `${symbol} change`);
        return quote;
      })
    );

    const valued: FixedValuedHolding[] = fixedHoldings.map((holding, index) => {
      const result = quoteResults[index];
      if (!result || result.status === "rejected") {
        return {
          ...holding,
          quote: null,
          marketValue: null,
          unrealizedPnl: null,
          unrealizedPnlRate: null,
          dayChangeValue: null,
          allocationRate: null
        };
      }
      const price = marketNumberToFixed(result.value.price, `${holding.symbol} price`);
      const marketValue = multiplyFixed(holding.quantity, price);
      const unrealizedPnl = subtractFixed(marketValue, holding.costBasis);
      const dayChangeValue = result.value.change === null
        ? null
        : multiplyFixed(
          holding.quantity,
          marketNumberToFixed(result.value.change, `${holding.symbol} change`)
        );
      return {
        ...holding,
        quote: result.value,
        marketValue,
        unrealizedPnl,
        unrealizedPnlRate: percentageRate(unrealizedPnl, holding.costBasis),
        dayChangeValue,
        allocationRate: null
      };
    });

    const priced = valued.filter((holding): holding is FixedValuedHolding & {
      marketValue: FixedDecimalUnits;
      unrealizedPnl: FixedDecimalUnits;
    } => holding.marketValue !== null && holding.unrealizedPnl !== null);
    const positionsValue = sumFixed(priced.map(({ marketValue }) => marketValue));
    const cashValue = parseFixedDecimal(this.#snapshot.currentCash.amount);
    const coveredValue = addFixed(positionsValue, cashValue);
    const costBasis = sumFixed(priced.map((holding) => holding.costBasis));
    const unrealizedPnl = sumFixed(priced.map((holding) => holding.unrealizedPnl));
    const dayChangeValue = sumFixed(
      valued.map(({ dayChangeValue }) => dayChangeValue ?? ZERO_FIXED)
    );
    const holdings = valued.map((holding) => this.#presentHolding({
      ...holding,
      allocationRate: holding.marketValue === null
        ? null
        : percentageRate(holding.marketValue, coveredValue)
    }));
    const coverageComplete = priced.length === valued.length;
    const notices = [
      "Demo portfolio uses the V3 synthetic ledger and live public market snapshots.",
      "Market prices are informational snapshots and are not executable quotes."
    ];
    if (!coverageComplete) {
      notices.push(
        `${valued.length - priced.length} holding(s) could not be priced; covered value is incomplete.`
      );
    }
    const quoteTimes = valued
      .map(({ quote }) => quote?.asOf)
      .filter((asOf): asOf is string => asOf !== undefined)
      .sort((left, right) => right.localeCompare(left));

    return {
      clientId: clientId(this.#snapshot.principalRef),
      baseCurrency: "USD",
      asOf: quoteTimes[0] ?? this.#snapshot.asOf,
      holdings,
      cash: [{ currency: "USD", amount: presentationNumber(cashValue, 2) }],
      positionsValue: presentationNumber(positionsValue, 2),
      cashValue: presentationNumber(cashValue, 2),
      coveredValue: presentationNumber(coveredValue, 2),
      costBasis: presentationNumber(costBasis, 2),
      unrealizedPnl: presentationNumber(unrealizedPnl, 2),
      unrealizedPnlPercent: costBasis === ZERO_FIXED
        ? null
        : presentationNumber(percentageRate(unrealizedPnl, costBasis) ?? ZERO_FIXED, 2),
      dayChangeValue: presentationNumber(dayChangeValue, 2),
      pricedHoldings: priced.length,
      totalHoldings: valued.length,
      coverageComplete,
      notices
    };
  }

  #fixedHoldings(): FixedHolding[] {
    const metadataByInstrument = new Map(
      this.#snapshot.instrumentMetadata.map((metadata) => [metadata.instrumentId, metadata])
    );
    if (metadataByInstrument.size !== this.#snapshot.instrumentMetadata.length) {
      fail("instrument metadata contains duplicate identifiers.");
    }

    const positions = new Map<string, { quantity: FixedDecimalUnits; costBasis: FixedDecimalUnits }>();
    for (const lot of this.#snapshot.currentLots) {
      const metadata = metadataByInstrument.get(lot.instrumentId);
      if (!metadata || metadata.symbol !== lot.symbol) fail(`metadata is missing for ${lot.symbol}.`);
      if (lot.unitCost.currency !== this.#snapshot.baseCurrency) {
        fail(`${lot.symbol} lot cost uses another currency.`);
      }
      const quantity = parseFixedDecimal(lot.quantity);
      const unitCost = parseFixedDecimal(lot.unitCost.amount);
      if (quantity <= ZERO_FIXED || unitCost < ZERO_FIXED) {
        fail(`${lot.symbol} lot has a non-positive quantity or negative unit cost.`);
      }
      const existing = positions.get(lot.instrumentId) ?? {
        quantity: ZERO_FIXED,
        costBasis: ZERO_FIXED
      };
      positions.set(lot.instrumentId, {
        quantity: addFixed(existing.quantity, quantity),
        costBasis: addFixed(existing.costBasis, multiplyFixed(quantity, unitCost))
      });
    }

    const feesById = new Map(this.#snapshot.activity.fees.map((fee) => [fee.feeId, fee]));
    for (const transaction of this.#snapshot.activity.transactions) {
      if (transaction.side !== "BUY") continue;
      const originalQuantity = parseFixedDecimal(transaction.quantity);
      const remainingQuantity = sumFixed(
        this.#snapshot.currentLots
          .filter((lot) =>
            lot.instrumentId === transaction.instrumentId && lot.acquiredAt === transaction.tradedAt
          )
          .map((lot) => parseFixedDecimal(lot.quantity))
      );
      if (remainingQuantity === ZERO_FIXED) continue;
      if (originalQuantity <= ZERO_FIXED || remainingQuantity > originalQuantity) {
        fail(`${transaction.transactionId} has an invalid remaining quantity.`);
      }
      const eligibleFees = sumFixed(transaction.feeIds.map((feeId) => {
        const fee = feesById.get(feeId);
        if (
          !fee ||
          fee.category !== "trade" ||
          fee.relatedTransactionId !== transaction.transactionId ||
          fee.amount.currency !== this.#snapshot.baseCurrency
        ) {
          fail(`${transaction.transactionId} references an invalid capitalized trade fee.`);
        }
        const amount = parseFixedDecimal(fee.amount.amount);
        if (amount < ZERO_FIXED) fail(`${feeId} has a negative amount.`);
        return amount;
      }));
      const capitalizedFee = multiplyFixed(
        eligibleFees,
        divideFixed(remainingQuantity, originalQuantity)
      );
      const position = positions.get(transaction.instrumentId);
      if (!position) fail(`${transaction.symbol} has a remaining buy without a current position.`);
      position.costBasis = addFixed(position.costBasis, capitalizedFee);
    }

    return this.#snapshot.instrumentMetadata
      .filter(({ instrumentId }) => positions.has(instrumentId))
      .map((metadata) => {
        const position = positions.get(metadata.instrumentId);
        if (!position) fail(`position is missing for ${metadata.instrumentId}.`);
        if (metadata.currency !== this.#snapshot.baseCurrency) {
          fail(`${metadata.symbol} metadata uses another currency.`);
        }
        return {
          symbol: metadata.symbol,
          name: metadata.displayName,
          assetClass: asAssetClass(metadata.instrumentType),
          currency: "USD" as const,
          quantity: position.quantity,
          costBasis: position.costBasis,
          averageCost: divideFixed(position.costBasis, position.quantity)
        };
      });
  }

  #presentHolding(holding: FixedValuedHolding): PortfolioHolding {
    return {
      symbol: holding.symbol,
      name: holding.name,
      assetClass: holding.assetClass,
      currency: holding.currency,
      quantity: presentationNumber(holding.quantity, 8),
      averageCost: presentationNumber(holding.averageCost, 8),
      quote: holding.quote,
      costBasis: presentationNumber(holding.costBasis, 2),
      marketValue: holding.marketValue === null
        ? null
        : presentationNumber(holding.marketValue, 2),
      unrealizedPnl: holding.unrealizedPnl === null
        ? null
        : presentationNumber(holding.unrealizedPnl, 2),
      unrealizedPnlPercent: holding.unrealizedPnlRate === null
        ? null
        : presentationNumber(holding.unrealizedPnlRate, 2),
      dayChangeValue: holding.dayChangeValue === null
        ? null
        : presentationNumber(holding.dayChangeValue, 2),
      allocationPercent: holding.allocationRate === null
        ? null
        : presentationNumber(holding.allocationRate, 2)
    };
  }
}
