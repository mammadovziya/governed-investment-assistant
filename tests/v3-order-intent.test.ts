import { describe, expect, it } from "vitest";
import { reviewOrderPreviewIntent } from "../src/assistant-v3/order-intent.js";

describe("reviewed order-preview intent", () => {
  it.each([
    ["Open a $100 AAPL buy ticket", "100.00000000"],
    ["AAPL üçün 125 USD alış önbaxışı", "125.00000000"],
    ["AAPL üçün 125,50 USD-lik alış önbaxışı", "125.50000000"],
    [
      "AAPL üçün 100 ABŞ dolları məbləğində yalnız baxış üçün alış bileti hazırla",
      "100.00000000"
    ],
    [
      "AAPL almaq üçün 100 USD-lik yalnız baxış bileti hazırla",
      "100.00000000"
    ],
    [
      "AAPL üçün 100 USD-lik alış etmək istəyirəm",
      "100.00000000"
    ]
  ])("accepts one explicit USD BUY notional: %s", (message, requestedNotional) => {
    expect(reviewOrderPreviewIntent(message)).toEqual({
      status: "supported",
      side: "BUY",
      fundingMode: "USD_NOTIONAL",
      orderType: "REFERENCE_PRICE_PREVIEW",
      requestedNotional
    });
  });

  it.each([
    [
      "Sell 3 shares of AAPL at market. Preview only.",
      "order_preview_sell_not_supported"
    ],
    [
      "Preview buying 10 NVDA shares",
      "order_preview_quantity_not_supported"
    ],
    [
      "Buy AAPL limit at $150. Preview only.",
      "order_preview_limit_not_supported"
    ],
    [
      "Simulate an AAPL stop order for $100",
      "order_preview_order_type_not_supported"
    ],
    [
      "Preview a $100 market order to buy AAPL",
      "order_preview_order_type_not_supported"
    ],
    [
      "Preview a $100 order for AAPL",
      "order_preview_buy_side_required"
    ],
    [
      "Draft a $100 AAPL ticket",
      "order_preview_buy_side_required"
    ],
    [
      "AAPL aləti üçün 100 USD önbaxış bileti",
      "order_preview_buy_side_required"
    ],
    [
      "AAPL alternativi üçün 100 USD önbaxış",
      "order_preview_buy_side_required"
    ],
    [
      "Allocate $100 to AAPL in a preview ticket",
      "order_preview_buy_side_required"
    ],
    [
      "Do not buy $100 of AAPL",
      "order_preview_buy_side_required"
    ],
    [
      "Don't buy $100 of AAPL",
      "order_preview_buy_side_required"
    ],
    [
      "I do not want to buy $100 of AAPL",
      "order_preview_buy_side_required"
    ],
    [
      "I don’t want to purchase $100 of AAPL",
      "order_preview_buy_side_required"
    ],
    [
      "I don't want a $100 AAPL buy ticket",
      "order_preview_buy_side_required"
    ],
    [
      "AAPL-i 100 USD məbləğində almaq istəmirəm",
      "order_preview_buy_side_required"
    ],
    [
      "AAPL-i 100 USD mebleginde almaq istemirem",
      "order_preview_buy_side_required"
    ],
    [
      "100 USD-lik AAPL alma",
      "order_preview_buy_side_required"
    ],
    [
      "100 USD-lik AAPL almayın",
      "order_preview_buy_side_required"
    ],
    [
      "AAPL üçün 100 USD-lik alış etmə",
      "order_preview_buy_side_required"
    ],
    [
      "AAPL üçün 100 USD-lik alış etməyin",
      "order_preview_buy_side_required"
    ],
    [
      "Open an AAPL buy preview",
      "order_preview_usd_notional_required"
    ],
    [
      "Preview $100 plus $20 fees for an AAPL buy",
      "order_preview_amount_ambiguous"
    ],
    [
      "Preview a $1,2,3 AAPL buy",
      "order_preview_amount_invalid"
    ],
    [
      "Preview a $3,000,000,000 AAPL buy",
      "order_preview_amount_outside_pilot_limit"
    ],
    [
      "Preview -$100 AAPL buy ticket",
      "order_preview_amount_invalid"
    ],
    [
      "Preview a $1e3 AAPL buy ticket",
      "order_preview_amount_invalid"
    ],
    [
      "Preview a $100abc AAPL buy ticket",
      "order_preview_amount_invalid"
    ]
  ])("rejects unsupported or ambiguous semantics: %s", (message, reasonCode) => {
    expect(reviewOrderPreviewIntent(message)).toEqual({
      status: "rejected",
      reasonCode
    });
  });
});
