import type { DecimalString } from "./contracts.js";
import { decimal, parseFixedDecimal } from "./fixed-decimal.js";

export const ORDER_PREVIEW_REJECTION_CODES = [
  "order_preview_sell_not_supported",
  "order_preview_limit_not_supported",
  "order_preview_order_type_not_supported",
  "order_preview_buy_side_required",
  "order_preview_quantity_not_supported",
  "order_preview_usd_notional_required",
  "order_preview_amount_ambiguous",
  "order_preview_amount_invalid",
  "order_preview_amount_outside_pilot_limit"
] as const;

export type OrderPreviewRejectionCode =
  (typeof ORDER_PREVIEW_REJECTION_CODES)[number];

export interface SupportedOrderPreviewIntent {
  readonly status: "supported";
  readonly side: "BUY";
  readonly fundingMode: "USD_NOTIONAL";
  readonly orderType: "REFERENCE_PRICE_PREVIEW";
  readonly requestedNotional: DecimalString;
}

export interface RejectedOrderPreviewIntent {
  readonly status: "rejected";
  readonly reasonCode: OrderPreviewRejectionCode;
}

export type ReviewedOrderPreviewIntent =
  | SupportedOrderPreviewIntent
  | RejectedOrderPreviewIntent;

const SELL_LANGUAGE =
  /\b(?:sell|selling|sale)\b|(?<!\p{L})(?:sat|satmaq|satış|satis)(?!\p{L})/iu;
const LIMIT_LANGUAGE =
  /\blimit(?:ed)?(?:\s+(?:order|price))?\b|(?<!\p{L})limit(?:\s+qiym[əe]t\p{L}*|\s+sifari[şs]\p{L}*)?(?!\p{L})/iu;
const UNSUPPORTED_ORDER_TYPE_LANGUAGE =
  /\b(?:stop(?:[- ]?(?:loss|limit))?|trailing(?:[- ]?stop)?|market[- ]on[- ]close|limit[- ]on[- ]close|MOC|LOC|GTC|IOC|FOK|good[- ]til{1,2}[- ]cancel(?:led|ed)?|day\s+order|market\s+order)\b|(?<!\p{L})(?:stop|treylinq|bazar\s+sifari[şs]i|g[uü]nl[uü]k\s+sifari[şs])\p{L}*(?!\p{L})/iu;
const NEGATED_ENGLISH_BUY_LANGUAGE =
  /\b(?:do\s+not|don['’]?t|dont|never|not)\b[^.!?;]{0,120}\b(?:buy|buying|purchase|purchasing)\b/iu;
const NEGATED_AZERBAIJANI_BUY_LANGUAGE =
  /(?<!\p{L})(?:alma(?:maq|mağ[ıi]|y[ıi]n)?|(?:almaq|almağ[ıi]|al[ıi][şs]\s+etm[əe]k)\s+ist[əe]mir\p{L}*|al[ıi][şs]\s+etm[əe](?:y[ıi]n)?)(?!\p{L})/iu;
const BUY_LANGUAGE =
  /\b(?:buy|buying|purchase|purchasing)\b|(?<!\p{L})(?:al|almaq|al[ıi][şs](?:[ıi]|[ıi]n|[ıi]n[ıi]|[ıi]na)?)(?!\p{L})/iu;
const QUANTITY_LANGUAGE =
  /(?:^|[^\p{L}\d])\d[\d.,]*\s*(?:[A-Z]{1,5}(?:\.[A-Z])?\s+)?(?:shares?|stocks?|units?|s[əe]hm|ədəd|eded)(?!\p{L})/iu;

const USD_AMOUNT =
  /(?<![\p{L}\p{N}_.+$-])(?:\$\s*(\d(?:\d|[.,](?=\d))*))(?![\p{L}\p{N}_.])|(?<![\p{L}\p{N}_.+$-])(\d(?:\d|[.,](?=\d))*)\s*(?:USD|ABŞ\s*dolları)(?:-l[ıi]k)?(?![\p{L}\p{N}_])/giu;
const USD_MARKER = /\$|\bUSD\b|ABŞ\s*dolları/iu;

function canonicalAmount(raw: string): DecimalString | null {
  const normalized = raw.normalize("NFKC").replace(/\s+/gu, "");
  let numeric = normalized;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(numeric)) {
    numeric = numeric.replaceAll(",", "");
  } else if (/^\d+,\d{1,8}$/u.test(numeric)) {
    numeric = numeric.replace(",", ".");
  } else if (!/^\d+(?:\.\d{1,8})?$/u.test(numeric)) {
    return null;
  }
  try {
    const value = decimal(numeric);
    return value === "0.00000000" ? null : value;
  } catch {
    return null;
  }
}

/**
 * The internal pilot can authorize only BUY previews funded by one explicit
 * USD notional. Quantity, SELL, and limit semantics are rejected before any
 * eligibility tool or signed handoff is created.
 */
export function reviewOrderPreviewIntent(
  message: string
): ReviewedOrderPreviewIntent {
  const normalized = message.normalize("NFKC");
  if (
    NEGATED_ENGLISH_BUY_LANGUAGE.test(normalized) ||
    NEGATED_AZERBAIJANI_BUY_LANGUAGE.test(normalized)
  ) {
    return {
      status: "rejected",
      reasonCode: "order_preview_buy_side_required"
    };
  }
  if (SELL_LANGUAGE.test(normalized)) {
    return { status: "rejected", reasonCode: "order_preview_sell_not_supported" };
  }
  if (LIMIT_LANGUAGE.test(normalized)) {
    return { status: "rejected", reasonCode: "order_preview_limit_not_supported" };
  }
  if (UNSUPPORTED_ORDER_TYPE_LANGUAGE.test(normalized)) {
    return {
      status: "rejected",
      reasonCode: "order_preview_order_type_not_supported"
    };
  }
  if (!BUY_LANGUAGE.test(normalized)) {
    return {
      status: "rejected",
      reasonCode: "order_preview_buy_side_required"
    };
  }
  const quantityCandidate = normalized.replace(USD_AMOUNT, " ");
  if (QUANTITY_LANGUAGE.test(quantityCandidate)) {
    return { status: "rejected", reasonCode: "order_preview_quantity_not_supported" };
  }

  const rawAmounts = [...normalized.matchAll(USD_AMOUNT)].map((match) =>
    match[1] ?? match[2] ?? ""
  );
  if (rawAmounts.length === 0) {
    return {
      status: "rejected",
      reasonCode: USD_MARKER.test(normalized)
        ? "order_preview_amount_invalid"
        : "order_preview_usd_notional_required"
    };
  }
  if (rawAmounts.length !== 1) {
    return { status: "rejected", reasonCode: "order_preview_amount_ambiguous" };
  }
  const requestedNotional = canonicalAmount(rawAmounts[0]!);
  if (requestedNotional === null) {
    return { status: "rejected", reasonCode: "order_preview_amount_invalid" };
  }
  if (parseFixedDecimal(requestedNotional) > parseFixedDecimal(decimal("2500"))) {
    return {
      status: "rejected",
      reasonCode: "order_preview_amount_outside_pilot_limit"
    };
  }
  return {
    status: "supported",
    side: "BUY",
    fundingMode: "USD_NOTIONAL",
    orderType: "REFERENCE_PRICE_PREVIEW",
    requestedNotional
  };
}
