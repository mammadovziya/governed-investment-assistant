import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DecimalString, TrustedRequestContext } from "./contracts.js";
import { canonicalJson, DevHmacSigner } from "./signing.js";

export interface OrderEligibility {
  eligible: boolean;
  currency: "USD";
  maximumNotional: DecimalString;
  tariffId: "investor" | "trader";
  requiredDisclosureCodes: readonly string[];
  checkedAt: string;
  reasonCodes: readonly string[];
}

export interface OrderTicketPreview {
  intentId: string;
  status: "awaiting-explicit-confirmation";
  side: "BUY";
  symbol: string;
  requestedNotional: DecimalString;
  currency: "USD";
  previewPrice: DecimalString;
  estimatedCommission: DecimalString;
  estimatedDebit: DecimalString;
  tariffVersion: string;
  createdAt: string;
  expiresAt: string;
  confirmationLabel: string;
  notices: readonly string[];
}

export interface SignedOrderHandoffPayload {
  schemaVersion: "assistant-v3.order-handoff.v1";
  handoffId: string;
  intentId: string;
  principalRef: string;
  tenantRef: string;
  previewRequestId: string;
  side: "BUY";
  symbol: string;
  requestedNotional: DecimalString;
  currency: "USD";
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  executionAllowed: false;
}

export interface SignedOrderHandoff {
  handoffRef: string;
  payload: SignedOrderHandoffPayload;
  expiresAt: string;
  oneUse: true;
  destination: "/orders/preview";
}

export interface OrderHandoffScreenState {
  schemaVersion: "assistant-v3.order-screen-state.v1";
  status: "external-order-screen-not-integrated";
  handoffId: string;
  intentId: string;
  side: "BUY";
  symbol: string;
  requestedNotional: DecimalString;
  currency: "USD";
  expiresAt: string;
  destination: "/orders/preview";
  oneUseHandoffConsumed: true;
  submissionAllowed: false;
  requiredRechecks: readonly [
    "live-price",
    "fees",
    "available-balance",
    "disclosures",
    "eligibility",
    "final-confirmation"
  ];
}

const ORDER_HANDOFF_SIGNATURE_PURPOSE =
  "assistant-v3.order-handoff.signed.v1" as const;
const decimalStringSchema = z.custom<DecimalString>(
  (value) =>
    typeof value === "string" &&
    /^(?:0|[1-9]\d*)\.\d{8}$/u.test(value)
);
const signedOrderHandoffPayloadSchema: z.ZodType<SignedOrderHandoffPayload> = z
  .object({
    schemaVersion: z.literal("assistant-v3.order-handoff.v1"),
    handoffId: z.string().uuid(),
    intentId: z.string().uuid(),
    principalRef: z.string().min(1).max(256),
    tenantRef: z.string().min(1).max(256),
    previewRequestId: z.string().min(1).max(256),
    side: z.literal("BUY"),
    symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/u),
    requestedNotional: decimalStringSchema,
    currency: z.literal("USD"),
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    nonce: z.string().uuid(),
    executionAllowed: z.literal(false)
  })
  .strict();
const signedOrderHandoffJwsSchema = z
  .object({
    purpose: z.literal(ORDER_HANDOFF_SIGNATURE_PURPOSE),
    payload: signedOrderHandoffPayloadSchema
  })
  .strict();
const signedOrderHandoffSchema: z.ZodType<SignedOrderHandoff> = z
  .object({
    handoffRef: z
      .string()
      .min(32)
      .max(8_192)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u),
    payload: signedOrderHandoffPayloadSchema,
    expiresAt: z.string().datetime({ offset: true }),
    oneUse: z.literal(true),
    destination: z.literal("/orders/preview")
  })
  .strict();

export function parseSignedOrderHandoff(value: unknown): SignedOrderHandoff | null {
  const parsed = signedOrderHandoffSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function orderHandoffScreenState(
  payload: SignedOrderHandoffPayload
): OrderHandoffScreenState {
  return Object.freeze({
    schemaVersion: "assistant-v3.order-screen-state.v1",
    status: "external-order-screen-not-integrated",
    handoffId: payload.handoffId,
    intentId: payload.intentId,
    side: payload.side,
    symbol: payload.symbol,
    requestedNotional: payload.requestedNotional,
    currency: payload.currency,
    expiresAt: payload.expiresAt,
    destination: "/orders/preview",
    oneUseHandoffConsumed: true,
    submissionAllowed: false,
    requiredRechecks: [
      "live-price",
      "fees",
      "available-balance",
      "disclosures",
      "eligibility",
      "final-confirmation"
    ] as const
  });
}

interface StoredIntent {
  preview: OrderTicketPreview;
  principalRef: string;
  tenantRef: string;
  previewRequestId: string;
  confirmed: boolean;
}

const DEFAULT_ORDER_INTENT_CAPACITY = 1_024;
const DEFAULT_CONSUMED_HANDOFF_CAPACITY = 4_096;
const MAX_ORDER_STORE_CAPACITY = 100_000;

function orderStoreCapacity(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_ORDER_STORE_CAPACITY
  ) {
    throw new RangeError(
      `${label} must be an integer between 1 and ${String(MAX_ORDER_STORE_CAPACITY)}.`
    );
  }
  return resolved;
}

export class OrderHandoffStore {
  readonly #intents = new Map<string, StoredIntent>();
  readonly #consumedHandoffs = new Map<string, number>();
  readonly #signer: DevHmacSigner;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #intentCapacity: number;
  readonly #consumedHandoffCapacity: number;

  constructor(input: {
    signer: DevHmacSigner;
    now?: () => number;
    ttlMs?: number;
    intentCapacity?: number;
    consumedHandoffCapacity?: number;
  }) {
    this.#signer = input.signer;
    this.#now = input.now ?? Date.now;
    this.#ttlMs = input.ttlMs ?? 5 * 60_000;
    this.#intentCapacity = orderStoreCapacity(
      input.intentCapacity,
      DEFAULT_ORDER_INTENT_CAPACITY,
      "Order preview capacity"
    );
    this.#consumedHandoffCapacity = orderStoreCapacity(
      input.consumedHandoffCapacity,
      DEFAULT_CONSUMED_HANDOFF_CAPACITY,
      "Consumed handoff capacity"
    );
    if (!Number.isFinite(this.#ttlMs) || this.#ttlMs <= 0 || this.#ttlMs > 5 * 60_000) {
      throw new RangeError("Order handoff TTL must be between 1 ms and five minutes.");
    }
  }

  createPreview(input: {
    context: TrustedRequestContext;
    symbol: string;
    requestedNotional: DecimalString;
    previewPrice: DecimalString;
    estimatedCommission: DecimalString;
    estimatedDebit: DecimalString;
    tariffVersion: string;
  }): OrderTicketPreview {
    this.#purgeExpired();
    if (this.#intents.size >= this.#intentCapacity) {
      throw new Error("Order preview capacity is exhausted.");
    }
    const createdAtMs = this.#now();
    const preview: OrderTicketPreview = {
      intentId: randomUUID(),
      status: "awaiting-explicit-confirmation",
      side: "BUY",
      symbol: input.symbol,
      requestedNotional: input.requestedNotional,
      currency: "USD",
      previewPrice: input.previewPrice,
      estimatedCommission: input.estimatedCommission,
      estimatedDebit: input.estimatedDebit,
      tariffVersion: input.tariffVersion,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.#ttlMs).toISOString(),
      confirmationLabel: input.context.locale === "az-AZ"
        ? "Alış biletini aç"
        : "Open buy ticket",
      notices: [
        "This is a preview, not an order.",
        "The order screen must recheck price, fees, balance, disclosures, and eligibility."
      ]
    };
    this.#intents.set(preview.intentId, {
      preview,
      principalRef: input.context.principalRef,
      tenantRef: input.context.tenantRef,
      previewRequestId: input.context.requestId,
      confirmed: false
    });
    return preview;
  }

  confirm(input: {
    intentId: string;
    context: TrustedRequestContext;
    explicitConfirmation: true;
  }): SignedOrderHandoff {
    this.#purgeExpired();
    const intent = this.#intents.get(input.intentId);
    if (!intent || Date.parse(intent.preview.expiresAt) <= this.#now()) {
      this.#intents.delete(input.intentId);
      throw new Error("Order ticket preview is missing or expired.");
    }
    if (
      intent.principalRef !== input.context.principalRef ||
      intent.tenantRef !== input.context.tenantRef
    ) {
      throw new Error("Order ticket preview belongs to a different principal.");
    }
    if (intent.confirmed) throw new Error("Order ticket preview was already confirmed.");

    intent.confirmed = true;
    const issuedAt = this.#now();
    const payload: SignedOrderHandoffPayload = {
      schemaVersion: "assistant-v3.order-handoff.v1",
      handoffId: randomUUID(),
      intentId: input.intentId,
      principalRef: intent.principalRef,
      tenantRef: intent.tenantRef,
      previewRequestId: intent.previewRequestId,
      side: "BUY",
      symbol: intent.preview.symbol,
      requestedNotional: intent.preview.requestedNotional,
      currency: "USD",
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(Math.min(
        issuedAt + this.#ttlMs,
        Date.parse(intent.preview.expiresAt)
      )).toISOString(),
      nonce: randomUUID(),
      executionAllowed: false
    };
    return {
      handoffRef: this.#signer.toCompactJws({
        purpose: ORDER_HANDOFF_SIGNATURE_PURPOSE,
        payload
      }),
      payload,
      expiresAt: payload.expiresAt,
      oneUse: true,
      destination: "/orders/preview"
    };
  }

  /** Simulates the separate order-screen boundary consuming a handoff once. */
  consume(handoff: SignedOrderHandoff, context: TrustedRequestContext): SignedOrderHandoffPayload {
    this.#purgeExpired();
    const verified = this.#signer.verifyAndDecodeCompactJws(handoff.handoffRef);
    const signed = signedOrderHandoffJwsSchema.safeParse(verified?.payload);
    if (!signed.success) {
      throw new Error("Order handoff signature is invalid.");
    }
    const payload = signed.data.payload;
    if (
      canonicalJson(payload) !== canonicalJson(handoff.payload) ||
      handoff.expiresAt !== payload.expiresAt ||
      handoff.oneUse !== true ||
      handoff.destination !== "/orders/preview"
    ) {
      throw new Error("Order handoff payload does not match its signed reference.");
    }
    if (this.#consumedHandoffs.has(payload.handoffId)) {
      throw new Error("Order handoff was already consumed.");
    }
    const issuedAt = Date.parse(payload.issuedAt);
    const expiresAt = Date.parse(payload.expiresAt);
    if (
      payload.principalRef !== context.principalRef ||
      payload.tenantRef !== context.tenantRef ||
      expiresAt <= this.#now() ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > this.#ttlMs
    ) {
      throw new Error("Order handoff is expired or belongs to another principal.");
    }
    const intent = this.#intents.get(payload.intentId);
    if (
      !intent ||
      !intent.confirmed ||
      intent.principalRef !== payload.principalRef ||
      intent.tenantRef !== payload.tenantRef ||
      intent.previewRequestId !== payload.previewRequestId ||
      intent.preview.symbol !== payload.symbol ||
      intent.preview.requestedNotional !== payload.requestedNotional
    ) {
      throw new Error("Order handoff no longer matches its confirmed preview.");
    }
    if (this.#consumedHandoffs.size >= this.#consumedHandoffCapacity) {
      throw new Error("Consumed order-handoff capacity is exhausted.");
    }
    this.#consumedHandoffs.set(payload.handoffId, expiresAt);
    return payload;
  }

  getPreview(intentId: string, context: TrustedRequestContext): OrderTicketPreview | null {
    this.#purgeExpired();
    const intent = this.#intents.get(intentId);
    if (!intent || Date.parse(intent.preview.expiresAt) <= this.#now()) return null;
    return intent.principalRef === context.principalRef && intent.tenantRef === context.tenantRef
      ? intent.preview
      : null;
  }

  #purgeExpired(): void {
    const now = this.#now();
    for (const [intentId, intent] of this.#intents) {
      if (Date.parse(intent.preview.expiresAt) <= now) this.#intents.delete(intentId);
    }
    for (const [handoffId, expiresAt] of this.#consumedHandoffs) {
      if (expiresAt <= now) this.#consumedHandoffs.delete(handoffId);
    }
  }
}
