import { describe, expect, it } from "vitest";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import { calculatePublishedCommission } from "../src/assistant-v3/fees.js";

describe("V3 deterministic tariff calculation", () => {
  it("applies the Investor percentage and minimum without floating point", () => {
    const result = calculatePublishedCommission({
      tariffId: "investor",
      unitPrice: decimal("200"),
      quantity: decimal("0.5"),
      currency: "USD"
    });
    expect(result).toMatchObject({
      grossNotional: "100.00000000",
      commission: "1.00000000",
      estimatedDebit: "101.00000000",
      formulaId: "percentage-with-bounds"
    });
  });

  it("caps the Trader percentage fee at its maximum", () => {
    const result = calculatePublishedCommission({
      tariffId: "trader",
      unitPrice: decimal("100"),
      quantity: decimal("1000"),
      currency: "USD"
    });
    expect(result.commission).toBe("15.00000000");
  });

  it("uses the per-security rule below five dollars", () => {
    const result = calculatePublishedCommission({
      tariffId: "investor",
      unitPrice: decimal("4.99"),
      quantity: decimal("20"),
      currency: "USD"
    });
    expect(result).toMatchObject({
      grossNotional: "99.80000000",
      commission: "0.25000000",
      formulaId: "per-security-with-minimum"
    });
  });

  it("rejects zero and negative monetary inputs", () => {
    expect(() => calculatePublishedCommission({
      tariffId: "investor",
      unitPrice: decimal("0"),
      quantity: decimal("1"),
      currency: "USD"
    })).toThrow(/positive/u);
    expect(() => calculatePublishedCommission({
      tariffId: "investor",
      unitPrice: decimal("10"),
      quantity: decimal("-1"),
      currency: "USD"
    })).toThrow(/positive/u);
  });
});
