import type { DecimalString } from "./contracts.js";
import {
  ONE_FIXED,
  ZERO_FIXED,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal,
  sumFixed
} from "./fixed-decimal.js";

export type PortfolioAllocationTheme =
  | "technology"
  | "technology-dependent"
  | "cash"
  | "unclassified";

export interface PortfolioAllocationInputRow {
  readonly label: string;
  readonly symbol: string | null;
  readonly category: string;
  readonly theme: PortfolioAllocationTheme;
  readonly allocationRate: DecimalString;
  readonly amount: DecimalString | null;
}

export type PortfolioAllocationAnalysisArguments =
  | {
      readonly scope: "current";
    }
  | {
      readonly scope: "hypothetical";
      readonly currency: "USD";
      readonly totalValue: DecimalString | null;
      readonly allocations: readonly PortfolioAllocationInputRow[];
    };

export interface PortfolioAllocationRiskProfile {
  readonly riskBand: "MODERATE";
  readonly objective: "LONG_TERM_GROWTH";
  readonly timeHorizonYears: number;
  readonly singleStockTargetMaxAllocationRate: DecimalString;
  readonly rebalancePreference: "GRADUAL";
  readonly reviewedAt: string;
}

export type PortfolioAllocationRiskSignalCode =
  | "SINGLE_COMPANY_CONCENTRATION"
  | "TOP_TWO_CONCENTRATION"
  | "THEME_CORRELATION"
  | "CASH_PURCHASING_POWER";

export interface PortfolioAllocationRiskSignal {
  readonly code: PortfolioAllocationRiskSignalCode;
  readonly band: "low" | "moderate" | "elevated";
  readonly observedRate: DecimalString;
  readonly ruleVersion: "allocation-risk-bands-v1";
}

export interface PortfolioAllocationAnalysisResult {
  readonly schemaVersion: "assistant-v3.portfolio-allocation-analysis.v1";
  readonly scope: "current" | "hypothetical";
  readonly dataClass: "synthetic" | "user-supplied-hypothetical";
  readonly currency: string;
  readonly asOf: string;
  readonly totalValue: DecimalString | null;
  readonly allocations: readonly (PortfolioAllocationInputRow & {
    readonly isCash: boolean;
  })[];
  readonly metrics: {
    readonly largestPosition: string;
    readonly largestAllocationRate: DecimalString;
    readonly topTwoAllocationRate: DecimalString;
    readonly technologyAndTechnologyDependentRate: DecimalString;
    readonly cashAllocationRate: DecimalString;
  };
  readonly riskSignals: readonly PortfolioAllocationRiskSignal[];
  readonly reviewDimensions: readonly [
    "COMPANY_CONCENTRATION",
    "SECTOR_DIVERSIFICATION",
    "INDIVIDUAL_STOCK_VOLATILITY",
    "VALUATION_SENSITIVITY",
    "LIQUIDITY_NEEDS",
    "TIME_HORIZON",
    "LOSS_CAPACITY",
    "FEES_TAXES"
  ];
  readonly riskProfile: PortfolioAllocationRiskProfile | null;
  readonly largestPositionExceedsProfileTarget: boolean | null;
  readonly recommendationAllowed: false;
}

export interface CanonicalPortfolioAllocationAnalysisInput {
  readonly scope: PortfolioAllocationAnalysisResult["scope"];
  readonly dataClass: PortfolioAllocationAnalysisResult["dataClass"];
  readonly currency: string;
  readonly asOf: string;
  readonly totalValue: DecimalString | null;
  readonly allocations: readonly PortfolioAllocationInputRow[];
  readonly riskProfile: PortfolioAllocationRiskProfile | null;
}

const RATE_15 = parseFixedDecimal("0.15");
const RATE_30 = parseFixedDecimal("0.30");
const RATE_40 = parseFixedDecimal("0.40");
const RATE_60 = parseFixedDecimal("0.60");
const RATE_70 = parseFixedDecimal("0.70");
const RULE_VERSION = "allocation-risk-bands-v1" as const;

function band(
  value: bigint,
  moderateAt: bigint,
  elevatedAt: bigint
): PortfolioAllocationRiskSignal["band"] {
  if (value >= elevatedAt) return "elevated";
  if (value >= moderateAt) return "moderate";
  return "low";
}

function assertCanonicalInput(input: CanonicalPortfolioAllocationAnalysisInput): void {
  if (
    input.allocations.length < 2 ||
    input.allocations.length > 8 ||
    input.currency.length < 3 ||
    input.currency.length > 8 ||
    !Number.isFinite(Date.parse(input.asOf))
  ) {
    throw new Error("Portfolio allocation analysis input is outside the supported bounds.");
  }

  const keys = new Set<string>();
  let cashCount = 0;
  for (const allocation of input.allocations) {
    const key = allocation.symbol ?? "CASH";
    if (keys.has(key)) throw new Error("Portfolio allocations must be unique.");
    keys.add(key);
    if (allocation.theme === "cash") {
      cashCount += 1;
      if (allocation.symbol !== null) {
        throw new Error("Cash cannot have a security symbol.");
      }
    } else if (allocation.symbol === null) {
      throw new Error("A non-cash allocation requires a security symbol.");
    }
    const rate = parseFixedDecimal(allocation.allocationRate);
    if (rate < ZERO_FIXED || rate > ONE_FIXED) {
      throw new Error("Portfolio allocation rates must be between zero and one.");
    }
    if (input.totalValue === null) {
      if (allocation.amount !== null) {
        throw new Error("Allocation amounts require a total portfolio value.");
      }
    } else if (input.scope === "hypothetical") {
      const expectedAmount = formatFixedDecimal(
        multiplyFixed(parseFixedDecimal(input.totalValue), rate)
      );
      if (allocation.amount !== expectedAmount) {
        throw new Error("Allocation amount does not reconcile to its rate.");
      }
    }
  }
  if (cashCount !== 1) throw new Error("Exactly one cash allocation is required.");
  const totalRate = sumFixed(
    input.allocations.map(({ allocationRate }) =>
      parseFixedDecimal(allocationRate)
    )
  );
  if (totalRate !== ONE_FIXED) {
    throw new Error("Portfolio allocations must total exactly one.");
  }
  if (
    input.totalValue !== null &&
    parseFixedDecimal(input.totalValue) <= ZERO_FIXED
  ) {
    throw new Error("A supplied portfolio value must be positive.");
  }
}

/**
 * Pure, fixed-decimal projection used inside the signed analysis boundary and
 * independently by delivery scorers. It returns structured observations only;
 * it never writes customer-facing financial prose or chooses an action.
 */
export function projectPortfolioAllocationAnalysis(
  input: CanonicalPortfolioAllocationAnalysisInput
): PortfolioAllocationAnalysisResult {
  assertCanonicalInput(input);
  const investments = input.allocations
    .filter(({ theme }) => theme !== "cash")
    .sort((left, right) => {
      const leftRate = parseFixedDecimal(left.allocationRate);
      const rightRate = parseFixedDecimal(right.allocationRate);
      if (leftRate === rightRate) {
        return (left.symbol ?? left.label).localeCompare(
          right.symbol ?? right.label
        );
      }
      return leftRate > rightRate ? -1 : 1;
    });
  const largest = investments[0];
  const cash = input.allocations.find(({ theme }) => theme === "cash");
  if (largest === undefined || cash === undefined) {
    throw new Error("Portfolio allocation analysis requires cash and an investment.");
  }

  const largestRate = parseFixedDecimal(largest.allocationRate);
  const topTwoRate = sumFixed(
    investments
      .slice(0, 2)
      .map(({ allocationRate }) => parseFixedDecimal(allocationRate))
  );
  const technologyRate = sumFixed(
    investments
      .filter(({ theme }) =>
        theme === "technology" || theme === "technology-dependent"
      )
      .map(({ allocationRate }) => parseFixedDecimal(allocationRate))
  );
  const cashRate = parseFixedDecimal(cash.allocationRate);

  const riskSignals: PortfolioAllocationRiskSignal[] = [
    {
      code: "SINGLE_COMPANY_CONCENTRATION",
      band: band(largestRate, RATE_15, RATE_30),
      observedRate: formatFixedDecimal(largestRate),
      ruleVersion: RULE_VERSION
    },
    {
      code: "TOP_TWO_CONCENTRATION",
      band: band(topTwoRate, RATE_40, RATE_60),
      observedRate: formatFixedDecimal(topTwoRate),
      ruleVersion: RULE_VERSION
    },
    {
      code: "THEME_CORRELATION",
      band: band(technologyRate, RATE_40, RATE_70),
      observedRate: formatFixedDecimal(technologyRate),
      ruleVersion: RULE_VERSION
    },
    {
      code: "CASH_PURCHASING_POWER",
      band: cashRate > ZERO_FIXED ? "moderate" : "low",
      observedRate: formatFixedDecimal(cashRate),
      ruleVersion: RULE_VERSION
    }
  ];

  return Object.freeze({
    schemaVersion: "assistant-v3.portfolio-allocation-analysis.v1" as const,
    scope: input.scope,
    dataClass: input.dataClass,
    currency: input.currency,
    asOf: input.asOf,
    totalValue: input.totalValue,
    allocations: Object.freeze(input.allocations.map((allocation) =>
      Object.freeze({
        ...allocation,
        isCash: allocation.theme === "cash"
      })
    )),
    metrics: Object.freeze({
      largestPosition: largest.symbol ?? largest.label,
      largestAllocationRate: formatFixedDecimal(largestRate),
      topTwoAllocationRate: formatFixedDecimal(topTwoRate),
      technologyAndTechnologyDependentRate: formatFixedDecimal(technologyRate),
      cashAllocationRate: formatFixedDecimal(cashRate)
    }),
    riskSignals: Object.freeze(
      riskSignals.map((signal) => Object.freeze({ ...signal }))
    ),
    reviewDimensions: Object.freeze([
      "COMPANY_CONCENTRATION",
      "SECTOR_DIVERSIFICATION",
      "INDIVIDUAL_STOCK_VOLATILITY",
      "VALUATION_SENSITIVITY",
      "LIQUIDITY_NEEDS",
      "TIME_HORIZON",
      "LOSS_CAPACITY",
      "FEES_TAXES"
    ] as const),
    riskProfile: input.riskProfile === null
      ? null
      : Object.freeze({ ...input.riskProfile }),
    largestPositionExceedsProfileTarget: input.riskProfile === null
      ? null
      : largestRate >
        parseFixedDecimal(input.riskProfile.singleStockTargetMaxAllocationRate),
    recommendationAllowed: false as const
  });
}
