import type { DecimalString } from "./contracts.js";
import {
  addFixed,
  decimal,
  formatFixedDecimal,
  maximumFixed,
  minimumFixed,
  multiplyFixed,
  parseFixedDecimal
} from "./fixed-decimal.js";

export type FeeTariffId = "investor" | "trader";

export interface FeeCalculationInput {
  tariffId: FeeTariffId;
  unitPrice: DecimalString;
  quantity: DecimalString;
  currency: "USD";
}

export interface FeeCalculation {
  tariffId: FeeTariffId;
  tariffVersion: "demo-invest-synthetic-2026-07-29-v1";
  unitPrice: DecimalString;
  quantity: DecimalString;
  grossNotional: DecimalString;
  commission: DecimalString;
  estimatedDebit: DecimalString;
  currency: "USD";
  formulaId: "percentage-with-bounds" | "per-security-with-minimum";
  sourceId: "demo-invest-commissions-en" | "demo-invest-commissions-az";
}

const FIVE_DOLLARS = parseFixedDecimal("5");
const BELOW_FIVE_PER_SECURITY = parseFixedDecimal("0.01");
const BELOW_FIVE_MINIMUM = parseFixedDecimal("0.25");
const BELOW_FIVE_MAXIMUM = parseFixedDecimal("15");

const PERCENTAGE_TARIFFS = {
  investor: {
    rate: parseFixedDecimal("0.002"),
    minimum: parseFixedDecimal("1"),
    maximum: parseFixedDecimal("20")
  },
  trader: {
    rate: parseFixedDecimal("0.001"),
    minimum: parseFixedDecimal("0.50"),
    maximum: parseFixedDecimal("15")
  }
} as const;

/**
 * Implements the fictional Demo Invest tariff with fixed-point arithmetic.
 * The caller supplies decimal strings; no authoritative monetary value is ever
 * converted through JavaScript `number`.
 */
export function calculatePublishedCommission(
  input: FeeCalculationInput,
  locale: "en-US" | "az-AZ" = "en-US"
): FeeCalculation {
  const unitPrice = parseFixedDecimal(input.unitPrice);
  const quantity = parseFixedDecimal(input.quantity);
  if (unitPrice <= 0n) throw new RangeError("Unit price must be positive.");
  if (quantity <= 0n) throw new RangeError("Quantity must be positive.");

  const grossNotional = multiplyFixed(unitPrice, quantity);
  let commission: bigint;
  let formulaId: FeeCalculation["formulaId"];
  if (unitPrice < FIVE_DOLLARS) {
    commission = maximumFixed(
      multiplyFixed(quantity, BELOW_FIVE_PER_SECURITY),
      BELOW_FIVE_MINIMUM
    );
    commission = minimumFixed(commission, BELOW_FIVE_MAXIMUM);
    formulaId = "per-security-with-minimum";
  } else {
    const tariff = PERCENTAGE_TARIFFS[input.tariffId];
    commission = minimumFixed(
      maximumFixed(multiplyFixed(grossNotional, tariff.rate), tariff.minimum),
      tariff.maximum
    );
    formulaId = "percentage-with-bounds";
  }

  return {
    tariffId: input.tariffId,
    tariffVersion: "demo-invest-synthetic-2026-07-29-v1",
    unitPrice: decimal(input.unitPrice),
    quantity: decimal(input.quantity),
    grossNotional: formatFixedDecimal(grossNotional),
    commission: formatFixedDecimal(commission),
    estimatedDebit: formatFixedDecimal(addFixed(grossNotional, commission)),
    currency: input.currency,
    formulaId,
    sourceId: locale === "az-AZ"
      ? "demo-invest-commissions-az"
      : "demo-invest-commissions-en"
  };
}
