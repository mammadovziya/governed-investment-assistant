import type { DecimalString } from "./contracts.js";

/** Eight decimal places cover fractional shares while retaining exact cents. */
export const FIXED_DECIMAL_SCALE = 8;
export const FIXED_DECIMAL_FACTOR = 100_000_000n;

export type FixedDecimalUnits = bigint & { readonly __fixedDecimalUnits: unique symbol };

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d*))?$/u;

function asUnits(value: bigint): FixedDecimalUnits {
  return value as FixedDecimalUnits;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Cannot divide a fixed decimal by zero.");
  if (numerator === 0n) return 0n;

  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function parseFixedDecimal(value: string): FixedDecimalUnits {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) throw new TypeError(`Invalid decimal string: ${value}`);

  const sign = match[1] === "-" ? -1n : 1n;
  const integerPart = match[2] ?? "0";
  const rawFraction = match[3] ?? "";
  const significantExtra = rawFraction.slice(FIXED_DECIMAL_SCALE);
  if (significantExtra.replace(/0/gu, "") !== "") {
    throw new RangeError(
      `Decimal value exceeds the supported ${FIXED_DECIMAL_SCALE}-place scale: ${value}`
    );
  }
  const fraction = rawFraction.slice(0, FIXED_DECIMAL_SCALE).padEnd(FIXED_DECIMAL_SCALE, "0");
  return asUnits(sign * (BigInt(integerPart) * FIXED_DECIMAL_FACTOR + BigInt(fraction)));
}

export function formatFixedDecimal(value: bigint): DecimalString {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const integerPart = absolute / FIXED_DECIMAL_FACTOR;
  const fraction = (absolute % FIXED_DECIMAL_FACTOR)
    .toString()
    .padStart(FIXED_DECIMAL_SCALE, "0");
  return `${negative ? "-" : ""}${integerPart}.${fraction}` as DecimalString;
}

export function decimal(value: string): DecimalString {
  return formatFixedDecimal(parseFixedDecimal(value));
}

export function addFixed(left: bigint, right: bigint): FixedDecimalUnits {
  return asUnits(left + right);
}

export function subtractFixed(left: bigint, right: bigint): FixedDecimalUnits {
  return asUnits(left - right);
}

export function multiplyFixed(left: bigint, right: bigint): FixedDecimalUnits {
  return asUnits(divideRounded(left * right, FIXED_DECIMAL_FACTOR));
}

export function divideFixed(left: bigint, right: bigint): FixedDecimalUnits {
  return asUnits(divideRounded(left * FIXED_DECIMAL_FACTOR, right));
}

export function absoluteFixed(value: bigint): FixedDecimalUnits {
  return asUnits(value < 0n ? -value : value);
}

export function sumFixed(values: Iterable<bigint>): FixedDecimalUnits {
  let total = 0n;
  for (const value of values) total += value;
  return asUnits(total);
}

export function minimumFixed(left: bigint, right: bigint): FixedDecimalUnits {
  return asUnits(left <= right ? left : right);
}

export function maximumFixed(left: bigint, right: bigint): FixedDecimalUnits {
  return asUnits(left >= right ? left : right);
}

export function isZeroFixed(value: bigint): boolean {
  return value === 0n;
}

export const ZERO_FIXED = asUnits(0n);
export const ONE_FIXED = asUnits(FIXED_DECIMAL_FACTOR);
