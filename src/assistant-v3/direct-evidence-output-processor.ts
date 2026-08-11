import type {
  MastraDBMessage,
  MastraMessagePart
} from "@mastra/core/agent/message-list";
import type {
  OutputResult,
  ProcessOutputResultArgs,
  ProcessOutputStreamArgs,
  Processor
} from "@mastra/core/processors";
import type { ChunkType } from "@mastra/core/stream";

import type {
  FinancialEducationRetrievalResult
} from "../domain/financial-education.js";
import type {
  SupportedLocale,
  ToolExecutionEnvelope
} from "./contracts.js";
import {
  financialEducationQueryHash,
  normalizeFinancialEducationQuery
} from "./financial-education-query.js";
import {
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal
} from "./fixed-decimal.js";
import type {
  PortfolioAllocationAnalysisResult,
  PortfolioAllocationRiskSignalCode
} from "./portfolio-allocation-analysis.js";
import { canonicalHash, type DevHmacSigner, verifyEnvelope } from "./signing.js";

export const V3_DIRECT_EVIDENCE_OUTPUT_PROCESSOR_ID =
  "v3-direct-evidence-output" as const;

export const V3_DIRECT_RENDERABLE_TOOL_IDS = [
  "resolve-instrument",
  "read-market-snapshot",
  "read-price-history",
  "read-instrument-research",
  "read-market-content",
  "convert-currency",
  "analyze-portfolio-allocation",
  "read-portfolio-snapshot",
  "read-portfolio-activity",
  "retrieve-reviewed-investment-education",
  "retrieve-approved-product-knowledge"
] as const;

export type V3DirectRenderableToolId =
  (typeof V3_DIRECT_RENDERABLE_TOOL_IDS)[number];

export interface V3DirectSemanticSlotDefinition {
  readonly alias: string;
  readonly meaning: string;
  readonly required: boolean;
}

export interface V3DirectGroundedSlot extends V3DirectSemanticSlotDefinition {
  readonly display: string;
}

export type V3DirectEvidenceFailureCode =
  | "query_missing"
  | "tool_not_called"
  | "tool_result_missing"
  | "tool_result_failed"
  | "tool_result_malformed"
  | "tool_result_tampered"
  | "tool_result_hash_mismatch"
  | "tool_arguments_hash_mismatch"
  | "tool_identity_mismatch"
  | "tool_not_allowed"
  | "tool_result_shape_invalid"
  | "too_many_tool_results"
  | "assistant_response_missing";

export interface V3DirectEvidenceTripwireMetadata {
  readonly processorId: typeof V3_DIRECT_EVIDENCE_OUTPUT_PROCESSOR_ID;
  readonly code: V3DirectEvidenceFailureCode;
  readonly toolId?: string;
}

export interface V3DirectEvidenceOutputProcessorOptions {
  readonly signer: DevHmacSigner;
  /** Exact least-privilege tool set assigned to the owning specialist. */
  readonly allowedToolIds: readonly V3DirectRenderableToolId[];
  /**
   * Optional, code-owned response/validator for reviewed conversational turns
   * that intentionally require no boundary tool. Classification never depends
   * on model text; returning null keeps the normal fail-closed behavior.
   */
  readonly reviewedNoToolResponse?: (input: {
    readonly query: string;
    readonly locale: SupportedLocale;
    /** May be retained only after the code-owned selector validates it. */
    readonly modelText: string;
  }) => string | null;
}

interface CompletedToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly isError: boolean;
}

interface VerifiedEvidence {
  readonly envelope: ToolExecutionEnvelope<unknown>;
  readonly toolId: V3DirectRenderableToolId;
  readonly args: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return isString(value) && Number.isFinite(Date.parse(value));
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^-?(?:0|[1-9]\d*)\.\d+$/u.test(value);
}

function isCanonicalNonNegativeDecimal(value: unknown): value is string {
  return typeof value === "string" &&
    /^(?:0|[1-9]\d*)\.\d{8}$/u.test(value);
}

function isCanonicalPositiveDecimal(value: unknown): value is string {
  return isCanonicalNonNegativeDecimal(value) &&
    parseFixedDecimal(value) > 0n;
}

function isMoney(value: unknown): value is { amount: string; currency: string } {
  return isRecord(value) && isDecimalString(value.amount) && isString(value.currency);
}

function textFromContent(value: unknown, depth = 0): string {
  if (depth > 8) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => textFromContent(item, depth + 1)).join(" ");
  }
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  return textFromContent(value.parts ?? value.content ?? "", depth + 1);
}

function latestUserQuery(
  messages: readonly MastraDBMessage[],
  messageList: { getLatestUserContent?: () => string | null }
): string {
  const fromMessageList = messageList.getLatestUserContent?.();
  if (typeof fromMessageList === "string" && fromMessageList.trim().length > 0) {
    return fromMessageList.normalize("NFKC").trim();
  }
  const latest = [...messages].reverse().find(({ role }) => role === "user");
  return textFromContent(latest?.content).normalize("NFKC").trim();
}

function isGreetingOnly(query: string): boolean {
  return /^(?:hello|hi|hey|salam|salamlar|good\s+(?:morning|afternoon|evening))[!.?\s]*$/iu
    .test(query);
}

function localeFor(query: string): SupportedLocale {
  return /[əğıöşüç]|\b(?:qiymət|qiymeti|portfel|portfelim|səhm|sehm|xəbər|xeber|haqqında|gəlir|gelir|zərər|zerer|əməliyyat|emeliyyat|komissiya|göstər|goster|neçə|nedir|cari|mənim|riskləri|riskleri|sag\s+ol|komek|sade|qisa|izah)\b/iu
    .test(query)
    ? "az-AZ"
    : "en-US";
}

function tripwire(
  _args: ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>,
  code: V3DirectEvidenceFailureCode,
  toolId?: string
): never {
  const metadata: V3DirectEvidenceTripwireMetadata = toolId === undefined
    ? { processorId: V3_DIRECT_EVIDENCE_OUTPUT_PROCESSOR_ID, code }
    : { processorId: V3_DIRECT_EVIDENCE_OUTPUT_PROCESSOR_ID, code, toolId };
  throw new V3DirectEvidenceValidationError(metadata);
}

class V3DirectEvidenceValidationError extends Error {
  constructor(readonly metadata: V3DirectEvidenceTripwireMetadata) {
    super("Direct specialist response failed signed-evidence validation.");
    this.name = "V3DirectEvidenceValidationError";
  }
}

function stableHash(value: unknown): string | null {
  try {
    return canonicalHash(value);
  } catch {
    return null;
  }
}

function boundaryToolArgs(value: unknown): unknown {
  if (!isRecord(value) || !("__mastraMetadata" in value)) return value;
  const { __mastraMetadata: _metadata, ...args } = value;
  return args;
}

function collectCompletedToolResults(
  result: OutputResult,
  args: ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>
): CompletedToolResult[] {
  const calls = new Map<string, { toolName: string; args: unknown }>();
  const results = new Map<string, CompletedToolResult>();

  for (const step of result.steps) {
    if (step.tripwire !== undefined || (step.pendingToolCalls?.length ?? 0) > 0) {
      return tripwire(args, "tool_result_missing");
    }
    const stepCalls = [
      ...(step.toolCalls ?? []),
      ...(step.staticToolCalls ?? []),
      ...(step.dynamicToolCalls ?? [])
    ];
    for (const call of stepCalls) {
      const payload = call.payload;
      const prior = calls.get(payload.toolCallId);
      const callArgs = boundaryToolArgs(payload.args ?? {});
      if (
        prior !== undefined &&
        (prior.toolName !== payload.toolName ||
          stableHash(prior.args) !== stableHash(callArgs))
      ) {
        return tripwire(args, "tool_identity_mismatch", payload.toolName);
      }
      calls.set(payload.toolCallId, {
        toolName: payload.toolName,
        args: callArgs
      });
    }

    const stepResults = [
      ...(step.toolResults ?? []),
      ...(step.staticToolResults ?? []),
      ...(step.dynamicToolResults ?? [])
    ];
    for (const toolResult of stepResults) {
      const payload = toolResult.payload;
      const call = calls.get(payload.toolCallId);
      const resolvedArgs = call?.args ?? boundaryToolArgs(payload.args ?? {});
      const candidate: CompletedToolResult = {
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        args: resolvedArgs,
        result: payload.result,
        isError: payload.isError === true
      };
      const prior = results.get(payload.toolCallId);
      if (
        prior !== undefined &&
        (prior.toolName !== candidate.toolName ||
          stableHash(prior.result) !== stableHash(candidate.result))
      ) {
        return tripwire(args, "tool_identity_mismatch", payload.toolName);
      }
      results.set(payload.toolCallId, candidate);
    }
  }

  if (calls.size === 0) return [];
  for (const [toolCallId, call] of calls) {
    const completed = results.get(toolCallId);
    if (completed === undefined) {
      return tripwire(args, "tool_result_missing", call.toolName);
    }
    if (completed.toolName !== call.toolName) {
      return tripwire(args, "tool_identity_mismatch", completed.toolName);
    }
  }
  for (const completed of results.values()) {
    if (!calls.has(completed.toolCallId)) {
      return tripwire(args, "tool_identity_mismatch", completed.toolName);
    }
  }
  return [...results.values()];
}

function envelopeCandidate(value: unknown): ToolExecutionEnvelope<unknown> | null {
  const candidates = [
    value,
    isRecord(value) ? value.envelope : undefined,
    isRecord(value) ? value.value : undefined,
    isRecord(value) ? value.output : undefined
  ].filter((candidate) =>
    isRecord(candidate) &&
    candidate.schemaVersion === "assistant-v3.tool-execution.v1"
  );
  const unique = [...new Set(candidates)];
  return unique.length === 1
    ? unique[0] as unknown as ToolExecutionEnvelope<unknown>
    : null;
}

function structurallyValidEnvelope(value: ToolExecutionEnvelope<unknown>): boolean {
  return value.schemaVersion === "assistant-v3.tool-execution.v1" &&
    isString(value.executionId) &&
    isString(value.requestId) &&
    isString(value.workflowRunId) &&
    isString(value.toolId) &&
    isString(value.toolVersion) &&
    isIsoTimestamp(value.startedAt) &&
    isIsoTimestamp(value.completedAt) &&
    isString(value.argumentsHash) &&
    isRecord(value.source) &&
    isString(value.source.provider) &&
    isString(value.source.sourceId) &&
    isIsoTimestamp(value.source.observedAt) &&
    isIsoTimestamp(value.source.sourceAsOf) &&
    isRecord(value.integrity);
}

function asRenderableToolId(value: string): V3DirectRenderableToolId | null {
  return (V3_DIRECT_RENDERABLE_TOOL_IDS as readonly string[]).includes(value)
    ? value as V3DirectRenderableToolId
    : null;
}

function verifyEvidence(
  completed: CompletedToolResult,
  options: V3DirectEvidenceOutputProcessorOptions,
  args: ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>
): VerifiedEvidence {
  if (completed.isError) {
    return tripwire(args, "tool_result_failed", completed.toolName);
  }
  const envelope = envelopeCandidate(completed.result);
  if (envelope === null || !structurallyValidEnvelope(envelope)) {
    return tripwire(args, "tool_result_malformed", completed.toolName);
  }
  let signatureValid = false;
  try {
    signatureValid = verifyEnvelope(envelope, options.signer);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return tripwire(args, "tool_result_tampered", completed.toolName);
  }
  if (envelope.toolId !== completed.toolName) {
    return tripwire(args, "tool_identity_mismatch", completed.toolName);
  }
  const toolId = asRenderableToolId(envelope.toolId);
  if (toolId === null || !options.allowedToolIds.includes(toolId)) {
    return tripwire(args, "tool_not_allowed", envelope.toolId);
  }
  if (envelope.argumentsHash !== stableHash(completed.args)) {
    return tripwire(args, "tool_arguments_hash_mismatch", toolId);
  }
  if (
    envelope.status !== "success" ||
    envelope.result === null ||
    envelope.error !== null ||
    envelope.resultHash === null
  ) {
    return tripwire(args, "tool_result_failed", toolId);
  }
  if (envelope.resultHash !== stableHash(envelope.result)) {
    return tripwire(args, "tool_result_hash_mismatch", toolId);
  }
  return { envelope, toolId, args: completed.args };
}

function plainText(value: string, maxLength = 220): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  const shortened = normalized.slice(0, maxLength + 1);
  const boundary = Math.max(shortened.lastIndexOf(". "), shortened.lastIndexOf("; "));
  return `${shortened.slice(0, boundary >= 80 ? boundary + 1 : maxLength).trimEnd()}…`;
}

function instrumentLabel(displayName: string, symbol: string): string {
  const normalizedName = plainText(displayName);
  const normalizedSymbol = plainText(symbol);
  let name = normalizedName;
  const suffixes = [
    ` (${normalizedSymbol})`,
    `(${normalizedSymbol})`,
    ` — ${normalizedSymbol}`,
    ` – ${normalizedSymbol}`,
    ` - ${normalizedSymbol}`
  ];
  let removedSuffix = true;
  while (removedSuffix) {
    removedSuffix = false;
    for (const suffix of suffixes) {
      if (name.toLocaleUpperCase("en-US").endsWith(suffix.toLocaleUpperCase("en-US"))) {
        name = name.slice(0, -suffix.length).trimEnd();
        removedSuffix = true;
        break;
      }
    }
  }
  if (name.length === 0) return normalizedSymbol;
  if (name.toLocaleUpperCase("en-US") === normalizedSymbol.toLocaleUpperCase("en-US")) {
    return normalizedSymbol;
  }
  return `${name} (${normalizedSymbol})`;
}

function displayDecimal(value: string): string {
  if (!isDecimalString(value)) throw new TypeError("Invalid decimal value.");
  const [integer, fraction] = value.split(".");
  const trimmed = fraction?.replace(/0+$/u, "") ?? "";
  return trimmed.length === 0 ? integer! : `${integer}.${trimmed}`;
}

function sourceLabel(envelope: ToolExecutionEnvelope<unknown>): string {
  return plainText(envelope.source.provider, 80);
}

function resultRecord(evidence: VerifiedEvidence): Record<string, unknown> {
  if (!isRecord(evidence.envelope.result)) throw new TypeError("Result must be an object.");
  return evidence.envelope.result;
}

function renderResolvedInstrument(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): string {
  const value = resultRecord(evidence);
  if (
    !isString(value.symbol) || !isString(value.displayName) ||
    !["EQUITY", "ETF", "BOND"].includes(String(value.instrumentType)) ||
    !isString(value.exchange) || !isString(value.currency) ||
    !isIsoTimestamp(value.resolvedAt)
  ) {
    throw new TypeError("Invalid resolved instrument result.");
  }
  return locale === "az-AZ"
    ? `${plainText(value.symbol)} — ${plainText(value.displayName)}; ${plainText(value.exchange)} birjasında ${plainText(value.currency)} valyutasında ticarət olunan ${plainText(String(value.instrumentType))} alətidir. Məlumat ${value.resolvedAt} tarixində yoxlanılıb; mənbə: ${sourceLabel(evidence.envelope)}.`
    : `${plainText(value.symbol)} resolves to ${plainText(value.displayName)}, a ${plainText(String(value.instrumentType))} instrument listed on ${plainText(value.exchange)} in ${plainText(value.currency)}. Verified at ${value.resolvedAt}; source: ${sourceLabel(evidence.envelope)}.`;
}

function renderMarketSnapshot(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): string {
  const value = resultRecord(evidence);
  if (
    !isString(value.symbol) || !isString(value.displayName) ||
    !isString(value.currency) || !isDecimalString(value.price) ||
    !isString(value.marketState) || !isString(value.freshness) ||
    !isIsoTimestamp(value.asOf)
  ) {
    throw new TypeError("Invalid market snapshot result.");
  }
  return locale === "az-AZ"
    ? `${plainText(value.displayName)} (${plainText(value.symbol)}) üçün son qiymət ${plainText(value.currency)} ${displayDecimal(value.price)}-dir; vaxt: ${value.asOf}. Bazar: ${plainText(value.marketState)}, məlumatın statusu: ${plainText(value.freshness)}; mənbə: ${sourceLabel(evidence.envelope)}.`
    : `${plainText(value.displayName)} (${plainText(value.symbol)}) is ${plainText(value.currency)} ${displayDecimal(value.price)} as of ${value.asOf}. Market: ${plainText(value.marketState)}; freshness: ${plainText(value.freshness)}; source: ${sourceLabel(evidence.envelope)}.`;
}

function renderPriceHistory(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): string {
  const value = resultRecord(evidence);
  if (
    !isString(value.symbol) || !isString(value.range) ||
    !isString(value.currency) || !isIsoTimestamp(value.asOf) ||
    !Array.isArray(value.points) || value.points.length === 0
  ) {
    throw new TypeError("Invalid price history result.");
  }
  const points = value.points;
  const first = points[0];
  const last = points.at(-1);
  if (
    !isRecord(first) || !isRecord(last) ||
    !isIsoTimestamp(first.timestamp) || !isDecimalString(first.close) ||
    !isIsoTimestamp(last.timestamp) || !isDecimalString(last.close)
  ) {
    throw new TypeError("Invalid price history point.");
  }
  return locale === "az-AZ"
    ? `${plainText(value.symbol)} üzrə ${plainText(value.range)} qiymət tarixçəsi ${first.timestamp} tarixində ${plainText(value.currency)} ${displayDecimal(first.close)} bağlanışından ${last.timestamp} tarixində ${plainText(value.currency)} ${displayDecimal(last.close)} bağlanışına qədərdir. Məlumatın vaxtı: ${value.asOf}; mənbə: ${sourceLabel(evidence.envelope)}.`
    : `${plainText(value.symbol)} ${plainText(value.range)} history runs from a ${plainText(value.currency)} ${displayDecimal(first.close)} close at ${first.timestamp} to a ${plainText(value.currency)} ${displayDecimal(last.close)} close at ${last.timestamp}. Data as of ${value.asOf}; source: ${sourceLabel(evidence.envelope)}.`;
}

interface DisplayMetric {
  readonly label: string;
  readonly value: string;
  readonly rawValue: string;
  readonly unit: string;
  readonly currency: string | null;
  readonly period: string | null;
  readonly asOf: string;
}

function availableMetric(value: unknown): DisplayMetric | null {
  if (!isRecord(value) || value.status !== "AVAILABLE") return null;
  if (!isRecord(value.value)) throw new TypeError("Invalid available metric.");
  const metric = value.value;
  if (!isString(metric.label) || !isDecimalString(metric.value) || !isIsoTimestamp(metric.asOf)) {
    throw new TypeError("Invalid available metric.");
  }
  const currency = isString(metric.currency) ? `${plainText(metric.currency)} ` : "";
  const suffix = metric.unit === "percent"
    ? "%"
    : metric.unit === "ratio"
      ? "x"
      : metric.unit === "shares"
        ? " shares"
        : metric.unit === "years"
          ? " years"
          : "";
  return {
    label: plainText(metric.label),
    value: `${currency}${displayDecimal(metric.value)}${suffix}`,
    rawValue: metric.value,
    unit: isString(metric.unit) ? plainText(metric.unit) : "",
    currency: isString(metric.currency) ? plainText(metric.currency) : null,
    period: isString(metric.period) ? plainText(metric.period) : null,
    asOf: metric.asOf
  };
}

interface DisplayAnalystConsensus {
  readonly recommendation: string;
  readonly analystCount: number;
  readonly targetPrice: string;
  readonly currency: string;
  readonly asOf: string;
}

function availableAnalystConsensus(value: unknown): DisplayAnalystConsensus | null {
  if (!isRecord(value) || value.status !== "AVAILABLE") return null;
  if (
    !isRecord(value.value) || !isString(value.value.recommendation) ||
    !Number.isSafeInteger(value.value.analystCount) ||
    (value.value.analystCount as number) < 0 ||
    !isDecimalString(value.value.targetPrice) || !isString(value.value.currency) ||
    !isIsoTimestamp(value.value.asOf)
  ) {
    throw new TypeError("Invalid available analyst consensus.");
  }
  return {
    recommendation: plainText(value.value.recommendation),
    analystCount: value.value.analystCount as number,
    targetPrice: displayDecimal(value.value.targetPrice),
    currency: plainText(value.value.currency),
    asOf: value.value.asOf
  };
}

function availableHolders(value: unknown): string | null {
  if (!isRecord(value) || value.status !== "AVAILABLE") return null;
  if (!isRecord(value.value) || !Array.isArray(value.value.entries)) {
    throw new TypeError("Invalid available holder facts.");
  }
  const holders = value.value.entries.slice(0, 3).map((entry) => {
    if (
      !isRecord(entry) || !isString(entry.name) ||
      !isDecimalString(entry.ownershipPercent) || !isIsoTimestamp(entry.asOf)
    ) {
      throw new TypeError("Invalid holder entry.");
    }
    return `${plainText(entry.name, 100)}: ${displayDecimal(entry.ownershipPercent)}% (${entry.asOf})`;
  });
  return holders.length === 0 ? null : holders.join("; ");
}

function compactMagnitude(
  value: string,
  locale: SupportedLocale
): string {
  if (!isDecimalString(value)) throw new TypeError("Invalid compact decimal value.");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [rawInteger, rawFraction = ""] = unsigned.split(".");
  const integer = rawInteger!.replace(/^0+(?=\d)/u, "");
  const magnitudes = locale === "az-AZ"
    ? [
        { digits: 12, label: "trilyon" },
        { digits: 9, label: "milyard" },
        { digits: 6, label: "milyon" }
      ]
    : [
        { digits: 12, label: "trillion" },
        { digits: 9, label: "billion" },
        { digits: 6, label: "million" }
      ];
  const magnitude = magnitudes.find(({ digits }) => integer.length > digits);
  if (magnitude === undefined) return displayDecimal(value);
  const leadingLength = integer.length - magnitude.digits;
  const leading = integer.slice(0, leadingLength);
  const fraction = `${integer.slice(leadingLength)}${rawFraction}`
    .slice(0, 2)
    .replace(/0+$/u, "");
  return `${negative ? "-" : ""}${leading}${fraction.length > 0 ? `.${fraction}` : ""} ${magnitude.label}`;
}

function compactMarketCapitalization(
  metric: DisplayMetric,
  locale: SupportedLocale
): string {
  const currency = metric.currency === null ? "" : `${metric.currency} `;
  return `${currency}${compactMagnitude(metric.rawValue, locale)}`.trim();
}

type ResearchIntent =
  | "listing"
  | "market-cap"
  | "pe"
  | "dividend"
  | "price-range"
  | "analyst"
  | "holders"
  | "risk"
  | "profitability"
  | "valuation"
  | "unsupported";

function researchIntent(query: string): ResearchIntent {
  const normalized = query.toLocaleLowerCase("en-US");
  if (
    /\b(?:where|which\s+exchange).{0,50}\blist(?:ed|ing)\b|\blist(?:ed|ing)\b.{0,50}\b(?:where|exchange)\b|\bexchange\b|(?:hansı|harada).{0,50}\bbirja|birjada/iu
      .test(normalized)
  ) {
    return "listing";
  }
  if (/market\s*cap(?:italization)?|bazar\s+kapitallaş/iu.test(normalized)) {
    return "market-cap";
  }
  if (/\bp\s*\/\s*e\b|price[-\s]*to[-\s]*earnings|trailing\s+p\/?e|forward\s+p\/?e|\bttm\b/iu.test(normalized)) {
    return "pe";
  }
  if (/dividend|divident/iu.test(normalized)) return "dividend";
  if (
    /52[-\s]*(?:week|həftə)|(?:one|1)[-\s]*year.{0,30}(?:high|low)|(?:high|low).{0,30}(?:one|1)[-\s]*year|(?:illik|bir\s+illik).{0,30}(?:yüksək|aşağı)/iu
      .test(normalized)
  ) {
    return "price-range";
  }
  if (/analyst|target|rating|consensus|analitik|hədəf/iu.test(normalized)) {
    return "analyst";
  }
  if (/holder|ownership|shareholder|sahib|payçı/iu.test(normalized)) {
    return "holders";
  }
  if (/risk|volatil|drawdown|riskləri/iu.test(normalized)) return "risk";
  if (/margin|profit|income|revenue|roe|marja|gəlir/iu.test(normalized)) {
    return "profitability";
  }
  if (/valuation|fundamental|overview|analy[sz](?:e|is)|təhlil/iu.test(normalized)) {
    return "valuation";
  }
  return "unsupported";
}

interface DirectSlotField {
  readonly name: string;
  readonly meaning: string;
  readonly required?: boolean;
}

const DIRECT_SLOT_FIELDS = Object.freeze({
  "resolve-instrument": Object.freeze([
    { name: "IDENTITY", meaning: "verified instrument name and ticker" },
    { name: "LISTING", meaning: "verified instrument type, listing venue, and trading currency" },
    { name: "PROVENANCE", meaning: "verification time and approved source" }
  ]),
  "read-market-snapshot": Object.freeze([
    { name: "IDENTITY", meaning: "verified instrument name and ticker" },
    { name: "QUOTE", meaning: "latest verified price with currency" },
    { name: "MARKET_CONTEXT", meaning: "market state and freshness classification" },
    { name: "PROVENANCE", meaning: "price observation time and approved source" }
  ]),
  "read-price-history": Object.freeze([
    { name: "HISTORY_SCOPE", meaning: "verified ticker and requested history range" },
    { name: "START_POINT", meaning: "first verified closing price and timestamp" },
    { name: "END_POINT", meaning: "latest verified closing price and timestamp" },
    { name: "PROVENANCE", meaning: "history observation time and approved source" }
  ]),
  "read-instrument-research": Object.freeze([
    { name: "IDENTITY", meaning: "verified instrument name and ticker" },
    { name: "PRIMARY_FACTS", meaning: "verified research facts that directly answer the request" },
    { name: "CONTEXT", meaning: "verified limitation or interpretation boundary for those facts" },
    { name: "PROVENANCE", meaning: "research observation time and approved source" }
  ]),
  "read-market-content": Object.freeze([
    { name: "CONTENT", meaning: "verified attributable market-content items, or the verified absence of them" },
    { name: "PROVENANCE", meaning: "content observation time and approved source" }
  ]),
  "convert-currency": Object.freeze([
    { name: "CONVERTED_AMOUNT", meaning: "verified amount in the requested target currency" },
    { name: "SOURCE_AMOUNT", meaning: "verified source amount and source currency" },
    { name: "EXCHANGE_RATE", meaning: "official exchange rate and its direction" },
    { name: "PROVENANCE", meaning: "official rate effective date and source" }
  ]),
  "analyze-portfolio-allocation": Object.freeze([
    { name: "SCOPE", meaning: "verified current or hypothetical portfolio-analysis scope and total value" },
    { name: "ALLOCATIONS", meaning: "verified portfolio allocation rows, rates, and available amounts" },
    { name: "LARGEST_POSITION", meaning: "verified largest individual position and allocation rate" },
    { name: "TOP_TWO", meaning: "verified combined allocation rate of the two largest positions" },
    { name: "THEME_EXPOSURE", meaning: "verified technology and technology-dependent allocation rate" },
    { name: "CASH", meaning: "verified cash allocation rate" },
    { name: "RISK_SIGNALS", meaning: "verified rule-based concentration, correlation, and cash risk bands" },
    { name: "REVIEW_DIMENSIONS", meaning: "verified factors relevant to a professional allocation review" },
    { name: "PROFILE_CONTEXT", meaning: "verified risk-profile target comparison, or its absence" },
    { name: "OBSERVATION", meaning: "analysis observation time and approved source" },
    { name: "BOUNDARY", meaning: "verified non-advisory recommendation boundary" }
  ]),
  "read-portfolio-snapshot": Object.freeze([
    { name: "SCOPE", meaning: "verified synthetic-portfolio scope" },
    { name: "CASH", meaning: "verified cash amount and currency" },
    { name: "HOLDINGS", meaning: "verified open-holding symbols" },
    { name: "OBSERVATION", meaning: "portfolio snapshot timestamp" },
    { name: "LIMITATION", meaning: "verified coverage limitation of this snapshot" }
  ]),
  "read-portfolio-activity": Object.freeze([
    { name: "ACTIVITY", meaning: "verified synthetic portfolio activity matching the request" },
    { name: "OBSERVATION", meaning: "activity coverage or observation time" },
    { name: "LIMITATION", meaning: "verified activity coverage limitation" }
  ]),
  "retrieve-reviewed-investment-education": Object.freeze([
    { name: "PROPOSITIONS", meaning: "approved education propositions retrieved for the exact normalized query" },
    { name: "CITATIONS", meaning: "one-to-one approved citations for the retrieved propositions" },
    { name: "PROVENANCE", meaning: "query-bound retrieval scope and approved source observation time" }
  ]),
  "retrieve-approved-product-knowledge": Object.freeze([
    { name: "DOCUMENT", meaning: "approved product document title and section" },
    { name: "ANSWER", meaning: "approved answer excerpt relevant to the request" },
    { name: "CITATION", meaning: "approved citation URL" },
    { name: "EFFECTIVE_DATE", meaning: "document effective date" }
  ])
} as const satisfies Readonly<
  Record<V3DirectRenderableToolId, readonly DirectSlotField[]>
>);

/**
 * Returns a value-free slot catalog safe to send to the continuation model.
 * The aliases depend only on reviewed tool identity and order—not tool output.
 */
export function v3DirectSemanticSlotCatalog(
  toolIds: readonly V3DirectRenderableToolId[]
): readonly V3DirectSemanticSlotDefinition[] {
  return Object.freeze(toolIds.flatMap((toolId, index) =>
    DIRECT_SLOT_FIELDS[toolId].map((field) => Object.freeze({
      alias: `E${String(index + 1)}_${field.name}`,
      meaning: field.meaning,
      required: (field as DirectSlotField).required ?? true
    }))
  ));
}

type InstrumentResearchRecord = Record<string, unknown> & {
  symbol: string;
  displayName: string;
  instrumentType: string;
  exchange: string;
  currency: string;
  generatedAt: string;
  valuation: Record<string, unknown>;
  profitability: Record<string, unknown>;
  financialHealth: Record<string, unknown>;
  fund?: Record<string, unknown>;
  instrumentSpecificRisks: Record<string, unknown>;
};

function instrumentResearchRecord(evidence: VerifiedEvidence): InstrumentResearchRecord {
  const value = resultRecord(evidence);
  if (
    value.schemaVersion !== "3.0.0" || !isString(value.symbol) ||
    !isString(value.displayName) || !isString(value.instrumentType) ||
    !isString(value.exchange) || !isString(value.currency) ||
    !isIsoTimestamp(value.generatedAt) ||
    !isRecord(value.valuation) || !isRecord(value.profitability) ||
    !isRecord(value.financialHealth) || !isRecord(value.instrumentSpecificRisks)
  ) {
    throw new TypeError("Invalid instrument research result.");
  }
  if (value.instrumentType === "ETF" && !isRecord(value.fund)) {
    throw new TypeError("Invalid ETF research result.");
  }
  return value as InstrumentResearchRecord;
}

function researchSourceSuffix(
  evidence: VerifiedEvidence,
  value: InstrumentResearchRecord,
  locale: SupportedLocale
): string {
  return locale === "az-AZ"
    ? ` Məlumat ${String(value.generatedAt)} tarixinədir; mənbə: ${sourceLabel(evidence.envelope)}.`
    : ` Data as of ${String(value.generatedAt)}; source: ${sourceLabel(evidence.envelope)}.`;
}

function unavailableResearchFacet(
  value: InstrumentResearchRecord,
  facet: string,
  locale: SupportedLocale
): string {
  return locale === "az-AZ"
    ? `Bu mənbədə ${plainText(String(value.symbol))} üçün ${facet} yoxdur.`
    : `This source does not include ${facet} for ${plainText(String(value.symbol))}.`;
}

function riskMetrics(value: InstrumentResearchRecord): DisplayMetric[] {
  const risks = value.instrumentSpecificRisks;
  return [
    availableMetric(risks.annualizedVolatility),
    availableMetric(risks.maximumDrawdown),
    availableMetric(risks.downsideVolatility),
    availableMetric(risks.leverage),
    availableMetric(risks.duration),
    availableMetric(risks.yieldToMaturity),
    availableMetric(risks.expenseRatio)
  ].filter((item): item is DisplayMetric => item !== null);
}

function renderMetricList(metrics: readonly DisplayMetric[]): string {
  return metrics.map((metric) =>
    `${metric.label.toLocaleLowerCase("en-US")} ${metric.value} (${metric.asOf})`
  ).join(", ");
}

function boundedInlineText(value: string, maxLength: number): string {
  return plainText(value, maxLength)
    .replace(/[.!?;:]+/gu, ",")
    .replace(/\s*,\s*/gu, ", ")
    .replace(/,+$/gu, "")
    .trim();
}

function availableStringFact(value: unknown, maxLength: number): string | null {
  return isRecord(value) && value.status === "AVAILABLE" && isString(value.value)
    ? boundedInlineText(value.value, maxLength)
    : null;
}

function directConcentration(value: unknown, locale: SupportedLocale): string {
  if (
    !isRecord(value) ||
    value.status !== "AVAILABLE" ||
    !isRecord(value.value) ||
    !isDecimalString(value.value.largestHoldingPercent) ||
    !isDecimalString(value.value.topTenHoldingsPercent)
  ) {
    return locale === "az-AZ" ? "mövcud deyil" : "unavailable";
  }
  const largest = plainText(displayDecimal(value.value.largestHoldingPercent), 18);
  const topTen = plainText(displayDecimal(value.value.topTenHoldingsPercent), 18);
  return locale === "az-AZ"
    ? `ən böyük ${largest}%, ilk 10 ${topTen}%`
    : `largest ${largest}%, top 10 ${topTen}%`;
}

function directCreditQuality(value: unknown, locale: SupportedLocale): string {
  if (
    !isRecord(value) ||
    value.status !== "AVAILABLE" ||
    !isRecord(value.value) ||
    !Array.isArray(value.value.entries)
  ) {
    return locale === "az-AZ" ? "mövcud deyil" : "unavailable";
  }
  const labels: Readonly<Record<string, string | undefined>> = {
    BELOW_B: "below B",
    US_GOVERNMENT: locale === "az-AZ" ? "ABŞ dövlət kağızları" : "US government",
    OTHER: locale === "az-AZ" ? "digər" : "other"
  };
  const entries = value.value.entries.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.rating) ||
      !isDecimalString(entry.weightPercent)
    ) return [];
    return [{
      label: boundedInlineText(labels[entry.rating] ?? entry.rating, 16),
      weight: plainText(displayDecimal(entry.weightPercent), 16)
    }];
  }).filter(({ weight }) => !/^0(?:\.0+)?$/u.test(weight)).slice(0, 2);
  return entries.length === 0
    ? locale === "az-AZ" ? "mövcud deyil" : "unavailable"
    : entries.map(({ label, weight }) => `${label} ${displayDecimal(weight)}%`).join(", ");
}

function renderEtfResearch(
  value: InstrumentResearchRecord,
  locale: SupportedLocale
): string {
  const fund = value.fund;
  if (!fund) throw new TypeError("ETF fund facts are missing.");
  const risks = value.instrumentSpecificRisks;
  const symbol = boundedInlineText(value.symbol, 12);
  const name = boundedInlineText(value.displayName, 48);
  const unavailable = locale === "az-AZ" ? "mövcud deyil" : "unavailable";
  const category = availableStringFact(fund.category, 28) ?? unavailable;
  const family = availableStringFact(fund.fundFamily, 28) ?? unavailable;
  const objective = availableStringFact(fund.objective, 32) ?? unavailable;
  const trackedIndex = availableStringFact(fund.trackedIndex, 28) ?? unavailable;
  const expense = availableMetric(fund.expenseRatio);
  const totalAssets = availableMetric(fund.totalAssets);
  const volume = availableMetric(fund.averageDailyVolume);
  const distribution = availableMetric(fund.distributionYield);
  const duration = availableMetric(risks.duration);
  const maturity = availableMetric(risks.maturity);
  const volatility = availableMetric(risks.annualizedVolatility);
  const drawdown = availableMetric(risks.maximumDrawdown);
  const trackingMissing = availableMetric(risks.trackingDifference) === null;
  const totalAssetsText = totalAssets === null
    ? unavailable
    : plainText(compactMarketCapitalization(totalAssets, locale), 36);
  const metric = (candidate: DisplayMetric | null): string => {
    if (candidate === null) return unavailable;
    const localized = locale === "az-AZ"
      ? candidate.value.replace(/ shares$/u, " səhm").replace(/ years$/u, " il")
      : candidate.value;
    return plainText(localized, 24);
  };
  const identity = locale === "az-AZ"
    ? `${name} (${symbol}) — ETF; kateqoriya ${category}; fond ailəsi ${family}; məqsəd ${objective}; indeks ${trackedIndex}.`
    : `${name} (${symbol}) — ETF; category ${category}; family ${family}; objective ${objective}; index ${trackedIndex}.`;
  const summary = locale === "az-AZ"
    ? `Xərc ${metric(expense)}; aktivlər ${totalAssetsText}; orta həcm ${metric(volume)}; bölüşdürmə ${metric(distribution)}; konsentrasiya ${directConcentration(risks.concentration, locale)}; izləmə fərqi ${trackingMissing ? unavailable : metric(availableMetric(risks.trackingDifference))}.`
    : `Cost ${metric(expense)}; assets ${totalAssetsText}; average volume ${metric(volume)}; distribution ${metric(distribution)}; concentration ${directConcentration(risks.concentration, locale)}; tracking ${trackingMissing ? unavailable : metric(availableMetric(risks.trackingDifference))}.`;
  const risk = locale === "az-AZ"
    ? `Faiz/kredit: müddət ${metric(duration)}; ödəmə müddəti ${metric(maturity)}; kredit ${directCreditQuality(risks.creditQuality, locale)}; tarixi 1 illik volatillik ${metric(volatility)}; maksimum eniş ${metric(drawdown)}.`
    : `Rate/credit: duration ${metric(duration)}; maturity ${metric(maturity)}; credit ${directCreditQuality(risks.creditQuality, locale)}; historical 1Y volatility ${metric(volatility)}; maximum drawdown ${metric(drawdown)}.`;
  return `${identity} ${summary} ${risk}`;
}

function renderInstrumentResearch(
  evidence: VerifiedEvidence,
  locale: SupportedLocale,
  query: string
): string {
  const value = instrumentResearchRecord(evidence);
  const symbol = plainText(String(value.symbol));
  const displayName = plainText(String(value.displayName));
  const intent = researchIntent(query);
  let answer: string;

  if (value.instrumentType === "ETF") {
    answer = renderEtfResearch(value, locale);
  } else if (intent === "listing") {
    const label = instrumentLabel(displayName, symbol);
    answer = locale === "az-AZ"
      ? `${label} ${plainText(String(value.exchange))} birjasında siyahıya alınıb və ${plainText(String(value.currency))} ilə ticarət olunur.`
      : `${label} is listed on ${plainText(String(value.exchange))} and trades in ${plainText(String(value.currency))}.`;
  } else if (intent === "market-cap") {
    const marketCap = availableMetric(value.valuation.marketCapitalization);
    answer = marketCap === null
      ? unavailableResearchFacet(value, locale === "az-AZ" ? "bazar kapitallaşması məlumatı" : "market capitalization data", locale)
      : locale === "az-AZ"
        ? `${symbol} şirkətinin bazar kapitallaşması təxminən ${compactMarketCapitalization(marketCap, locale)}-dir (${marketCap.asOf}).`
        : `${symbol}'s market capitalization is about ${compactMarketCapitalization(marketCap, locale)} (as of ${marketCap.asOf}).`;
  } else if (intent === "pe") {
    const trailing = availableMetric(value.valuation.trailingPe);
    const forward = availableMetric(value.valuation.forwardPe);
    if (trailing === null && forward === null) {
      answer = locale === "az-AZ"
        ? `Bu mənbədə ${symbol} üçün TTM və ya proqnoz P/E məlumatı yoxdur.`
        : `This source does not include trailing (TTM) or forward P/E data for ${symbol}.`;
    } else if (trailing !== null && forward !== null && trailing.asOf === forward.asOf) {
      answer = locale === "az-AZ"
        ? `${symbol} üçün TTM P/E ${trailing.value}, proqnoz P/E isə ${forward.value}-dir (${trailing.asOf}).`
        : `For ${symbol}, trailing (TTM) P/E is ${trailing.value} and forward P/E is ${forward.value} (as of ${trailing.asOf}).`;
    } else {
      const parts = locale === "az-AZ"
        ? [
            trailing === null
              ? "TTM P/E bu mənbədə mövcud deyil"
              : `TTM P/E ${trailing.value}-dir (${trailing.asOf})`,
            forward === null
              ? "proqnoz P/E bu mənbədə mövcud deyil"
              : `proqnoz P/E ${forward.value}-dir (${forward.asOf})`
          ]
        : [
            trailing === null
              ? "trailing (TTM) P/E is unavailable from this source"
              : `trailing (TTM) P/E is ${trailing.value} (as of ${trailing.asOf})`,
            forward === null
              ? "forward P/E is unavailable from this source"
              : `forward P/E is ${forward.value} (as of ${forward.asOf})`
          ];
      answer = locale === "az-AZ"
        ? `${symbol} üçün ${parts.join(", ")}.`
        : `For ${symbol}, ${parts.join("; ")}.`;
    }
  } else if (intent === "dividend") {
    const dividendYield = availableMetric(value.dividendYield);
    const asksLastDividend = /\b(?:last|latest|when|paid|payment)\b|son\s+dividend|nə\s+vaxt/iu
      .test(query);
    answer = dividendYield === null
      ? unavailableResearchFacet(
          value,
          locale === "az-AZ" ? "dividend gəlirliliyi məlumatı" : "dividend yield data",
          locale
        )
      : locale === "az-AZ"
        ? `${symbol} üçün dividend gəlirliliyi ${dividendYield.value}-dir (${dividendYield.asOf}).`
        : `${symbol}'s dividend yield is ${dividendYield.value} (as of ${dividendYield.asOf}).`;
    if (asksLastDividend) {
      answer += locale === "az-AZ"
        ? " Bu mənbədə son dividendin məbləği və ödəniş tarixi yoxdur."
        : " This source does not include the last dividend amount or payment date.";
    }
  } else if (intent === "price-range") {
    const high = availableMetric(value.instrumentSpecificRisks.periodHigh);
    const low = availableMetric(value.instrumentSpecificRisks.periodLow);
    if (high === null && low === null) {
      answer = unavailableResearchFacet(
        value,
        locale === "az-AZ" ? "bir illik yüksək/aşağı bağlanış məlumatı" : "one-year high/low closing-price data",
        locale
      );
    } else {
      const period = high?.period ?? low?.period ?? "1Y";
      const highText = high === null
        ? locale === "az-AZ" ? "yüksək bağlanış mövcud deyil" : "high close is unavailable"
        : locale === "az-AZ" ? `yüksək bağlanış ${high.value}` : `high close is ${high.value}`;
      const lowText = low === null
        ? locale === "az-AZ" ? "aşağı bağlanış mövcud deyil" : "low close is unavailable"
        : locale === "az-AZ" ? `aşağı bağlanış ${low.value}` : `low close is ${low.value}`;
      answer = locale === "az-AZ"
        ? `${symbol} üçün ${plainText(period)} dövründə ${highText}, ${lowText}. Bunlar gün ərzindəki maksimum və minimum deyil, bağlanış qiymətləridir.`
        : `For ${symbol}'s ${plainText(period)} period, the ${highText} and the ${lowText}. These are closing-price levels, not intraday highs and lows.`;
    }
  } else if (intent === "analyst") {
    const consensus = availableAnalystConsensus(value.analystConsensus);
    answer = consensus === null
      ? unavailableResearchFacet(
          value,
          locale === "az-AZ" ? "analitik konsensusu" : "analyst consensus",
          locale
        )
      : locale === "az-AZ"
        ? `${symbol} üzrə analitik konsensusu “${consensus.recommendation}”dır; ${String(consensus.analystCount)} analitikin hədəf qiyməti ${consensus.currency} ${consensus.targetPrice}-dir (${consensus.asOf}).`
        : `The analyst consensus for ${symbol} is “${consensus.recommendation},” based on ${String(consensus.analystCount)} analysts, with a ${consensus.currency} ${consensus.targetPrice} target price (${consensus.asOf}).`;
  } else if (intent === "holders") {
    const holders = availableHolders(value.holders);
    answer = holders === null
      ? unavailableResearchFacet(value, locale === "az-AZ" ? "sahiblik məlumatı" : "ownership data", locale)
      : locale === "az-AZ"
        ? `${symbol} üzrə mənbədə göstərilən əsas sahiblik mövqeləri: ${holders}.`
        : `The leading ownership positions reported for ${symbol} are ${holders}.`;
  } else if (intent === "risk") {
    const metrics = riskMetrics(value);
    answer = metrics.length === 0
      ? unavailableResearchFacet(value, locale === "az-AZ" ? "tarixi risk göstəriciləri" : "historical risk measures", locale)
      : locale === "az-AZ"
        ? `${symbol} üçün tarixi risk göstəriciləri: ${renderMetricList(metrics)}.`
        : `${symbol}'s historical risk measures are ${renderMetricList(metrics)}.`;
  } else if (intent === "profitability") {
    const metrics = [
      availableMetric(value.profitability.quarterlyRevenue),
      availableMetric(value.profitability.quarterlyNetIncome),
      availableMetric(value.profitability.quarterlyGrossMargin),
      availableMetric(value.returnOnEquity)
    ].filter((item): item is DisplayMetric => item !== null);
    answer = metrics.length === 0
      ? unavailableResearchFacet(value, locale === "az-AZ" ? "mənfəətlilik göstəriciləri" : "profitability measures", locale)
      : locale === "az-AZ"
        ? `${symbol} üçün təsdiqlənmiş mənfəətlilik göstəriciləri: ${renderMetricList(metrics)}.`
        : `For ${symbol}, the verified profitability measures are ${renderMetricList(metrics)}.`;
  } else if (intent === "valuation") {
    const metrics = [
      availableMetric(value.valuation.marketCapitalization),
      availableMetric(value.valuation.trailingPe),
      availableMetric(value.valuation.forwardPe)
    ].filter((item): item is DisplayMetric => item !== null);
    answer = metrics.length === 0
      ? unavailableResearchFacet(value, locale === "az-AZ" ? "qiymətləndirmə göstəriciləri" : "valuation measures", locale)
      : locale === "az-AZ"
        ? `${symbol} üçün təsdiqlənmiş qiymətləndirmə göstəriciləri: ${renderMetricList(metrics)}.`
        : `For ${symbol}, the verified valuation measures are ${renderMetricList(metrics)}.`;
  } else {
    answer = locale === "az-AZ"
      ? `Bu imzalanmış ${symbol} araşdırması soruşulan məsələni cavablandırmaq üçün yetərli fakt vermir.`
      : `This signed ${symbol} research result does not contain the facts needed to answer that question.`;
  }
  return `${answer}${researchSourceSuffix(evidence, value, locale)}`;
}

function renderMarketContent(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): string {
  const result = evidence.envelope.result;
  if (!Array.isArray(result)) throw new TypeError("Invalid market content result.");
  if (result.length === 0) {
    return locale === "az-AZ"
      ? `Bu alət üçün istinad edilə bilən bazar xəbəri tapılmadı. Mənbə: ${sourceLabel(evidence.envelope)}; məlumatın vaxtı: ${evidence.envelope.source.sourceAsOf}.`
      : `No attributable market content was found for this instrument. Source: ${sourceLabel(evidence.envelope)}; data as of ${evidence.envelope.source.sourceAsOf}.`;
  }
  const items = result.slice(0, 3).map((item) => {
    if (!isRecord(item) || !isString(item.title) || !isIsoTimestamp(item.publishedAt)) {
      throw new TypeError("Invalid market content item.");
    }
    const attribution = Array.isArray(item.attributions) && isRecord(item.attributions[0])
      ? item.attributions[0]
      : null;
    const publisher = attribution !== null && isString(attribution.label)
      ? ` — ${plainText(attribution.label, 80)}`
      : "";
    return `“${plainText(item.title, 160)}”${publisher}, ${item.publishedAt}`;
  }).join("; ");
  return locale === "az-AZ"
    ? `Tapdığım son istinad edilə bilən materiallar bunlardır: ${items}. Mənbə: ${sourceLabel(evidence.envelope)}; məlumatın vaxtı: ${evidence.envelope.source.sourceAsOf}.`
    : `The latest attributable items I found are ${items}. Source: ${sourceLabel(evidence.envelope)}; data as of ${evidence.envelope.source.sourceAsOf}.`;
}

function currencyConversionRecord(
  evidence: VerifiedEvidence
): Record<string, unknown> {
  const value = resultRecord(evidence);
  const args = evidence.args;
  if (
    !isRecord(args) ||
    value.schemaVersion !== "assistant-v3.currency-conversion.v1" ||
    ![
      "provided-amount",
      "current-market-price",
      "current-portfolio-value"
    ].includes(String(value.scope)) ||
    !["USD", "AZN"].includes(String(value.sourceCurrency)) ||
    !["USD", "AZN"].includes(String(value.targetCurrency)) ||
    !isCanonicalNonNegativeDecimal(value.sourceAmount) ||
    !isCanonicalPositiveDecimal(value.exchangeRate) ||
    !isCanonicalNonNegativeDecimal(value.convertedAmount) ||
    !isString(value.rateEffectiveDate) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value.rateEffectiveDate) ||
    !isIsoTimestamp(value.rateAsOf) ||
    !isString(value.rateSourceUrl) ||
    !value.rateSourceUrl.startsWith("https://www.cbar.az/") ||
    !Array.isArray(value.marketAsOf) ||
    args.scope !== value.scope ||
    args.targetCurrency !== value.targetCurrency ||
    value.convertedAmount !== formatFixedDecimal(
      multiplyFixed(
        parseFixedDecimal(value.sourceAmount),
        parseFixedDecimal(value.exchangeRate)
      )
    )
  ) {
    throw new TypeError("Invalid currency conversion result.");
  }
  if (
    value.scope === "current-portfolio-value" &&
    (
      value.portfolioDataClass !== "synthetic" ||
      !isIsoTimestamp(value.portfolioAsOf) ||
      value.marketAsOf.some((item) =>
        !isRecord(item) || !isString(item.symbol) || !isIsoTimestamp(item.asOf)
      )
    )
  ) {
    throw new TypeError("Invalid current-portfolio currency conversion result.");
  }
  if (value.scope === "current-market-price") {
    const observation = value.marketAsOf[0];
    const snapshot = value.marketSnapshot;
    const marketSource = value.marketSource;
    if (
      value.portfolioDataClass !== null ||
      value.portfolioAsOf !== null ||
      args.symbol !== value.symbol ||
      !isString(value.symbol) ||
      !isString(value.displayName) ||
      value.marketAsOf.length !== 1 ||
      !isRecord(observation) ||
      observation.symbol !== value.symbol ||
      !isIsoTimestamp(observation.asOf) ||
      !isRecord(snapshot) ||
      snapshot.symbol !== value.symbol ||
      snapshot.displayName !== value.displayName ||
      snapshot.currency !== value.sourceCurrency ||
      snapshot.price !== value.sourceAmount ||
      snapshot.asOf !== observation.asOf ||
      !isCanonicalPositiveDecimal(value.sourceAmount) ||
      !isCanonicalPositiveDecimal(value.convertedAmount) ||
      !isRecord(marketSource) ||
      !isString(marketSource.provider) ||
      !isString(marketSource.sourceId) ||
      !isIsoTimestamp(marketSource.sourceAsOf)
    ) {
      throw new TypeError("Invalid current-market-price conversion result.");
    }
  }
  if (
    value.scope === "provided-amount" &&
    (
      args.amount !== value.sourceAmount ||
      args.sourceCurrency !== value.sourceCurrency ||
      value.portfolioDataClass !== null ||
      value.portfolioAsOf !== null ||
      value.marketAsOf.length !== 0
    )
  ) {
    throw new TypeError("Invalid provided-amount currency conversion result.");
  }
  return value;
}

function renderCurrencyConversion(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): string {
  const value = currencyConversionRecord(evidence);
  const converted = `${plainText(String(value.targetCurrency))} ${displayDecimal(
    String(value.convertedAmount)
  )}`;
  const source = `${plainText(String(value.sourceCurrency))} ${displayDecimal(
    String(value.sourceAmount)
  )}`;
  const rate = `1 ${plainText(String(value.sourceCurrency))} = ${displayDecimal(
    String(value.exchangeRate)
  )} ${plainText(String(value.targetCurrency))}`;
  if (value.scope === "current-market-price") {
    const observation = (
      value.marketAsOf as readonly Readonly<Record<string, unknown>>[]
    )[0] as Readonly<Record<string, unknown>>;
    const marketSource = value.marketSource as Readonly<Record<string, unknown>>;
    const identity = instrumentLabel(
      String(value.displayName),
      String(value.symbol)
    );
    if (locale === "az-AZ") {
      return `${identity} üçün cari bazar kotirovkası ${source}-dir; bu, ${rate} rəsmi məzənnəsi ilə ${converted} ekvivalentidir. Bazar məlumatı ${plainText(String(observation.asOf))} tarixinə ${plainText(String(marketSource.provider))} mənbəsindəndir. Məzənnənin qüvvədə olma tarixi ${plainText(String(value.rateEffectiveDate))}, mənbə: ${sourceLabel(evidence.envelope)}.`;
    }
    return `${identity}'s current market quote is ${source}, equivalent to ${converted} at the official rate ${rate}. Market data as of ${plainText(String(observation.asOf))} from ${plainText(String(marketSource.provider))}; rate effective ${plainText(String(value.rateEffectiveDate))}, source: ${sourceLabel(evidence.envelope)}.`;
  }
  if (locale === "az-AZ") {
    return value.scope === "current-portfolio-value"
      ? `Sintetik portfelinizin cari dəyəri ${converted}-dir. İlkin dəyər ${source}, rəsmi məzənnə ${rate}; məzənnənin qüvvədə olma tarixi ${plainText(String(value.rateEffectiveDate))}, mənbə: ${sourceLabel(evidence.envelope)}.`
      : `${source} məbləği ${converted} edir. İstifadə olunan rəsmi məzənnə ${rate}; qüvvədə olma tarixi ${plainText(String(value.rateEffectiveDate))}, mənbə: ${sourceLabel(evidence.envelope)}.`;
  }
  return value.scope === "current-portfolio-value"
    ? `Your current synthetic portfolio value is ${converted}. The source value is ${source}, using the official rate ${rate}, effective ${plainText(String(value.rateEffectiveDate))}; source: ${sourceLabel(evidence.envelope)}.`
    : `${source} converts to ${converted}. The official rate used is ${rate}, effective ${plainText(String(value.rateEffectiveDate))}; source: ${sourceLabel(evidence.envelope)}.`;
}

function renderPortfolioSnapshot(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): string {
  const value = resultRecord(evidence);
  if (
    value.dataClass !== "synthetic" || !isString(value.baseCurrency) ||
    !isIsoTimestamp(value.asOf) || !isMoney(value.currentCash) ||
    !Array.isArray(value.currentLots)
  ) {
    throw new TypeError("Invalid portfolio snapshot result.");
  }
  const symbols = [...new Set(value.currentLots.map((lot) => {
    if (!isRecord(lot) || !isString(lot.symbol) || !isDecimalString(lot.quantity)) {
      throw new TypeError("Invalid portfolio lot.");
    }
    return plainText(lot.symbol);
  }))];
  const holdings = symbols.length === 0 ? "none" : symbols.join(", ");
  return locale === "az-AZ"
    ? `Sintetik portfel snapshotunda nağd vəsait ${plainText(value.currentCash.currency)} ${displayDecimal(value.currentCash.amount)}, açıq aktivlər isə ${holdings}-dir. Snapshot vaxtı: ${value.asOf}; bu məlumat təkbaşına portfelin canlı ümumi dəyərini hesablamır.`
    : `The synthetic portfolio snapshot shows ${plainText(value.currentCash.currency)} ${displayDecimal(value.currentCash.amount)} in cash and open holdings in ${holdings}. Snapshot as of ${value.asOf}; this evidence alone does not calculate a live total portfolio value.`;
}

const PORTFOLIO_ALLOCATION_THEMES = new Set([
  "technology",
  "technology-dependent",
  "cash",
  "unclassified"
]);

const PORTFOLIO_ALLOCATION_RISK_CODES = new Set<
  PortfolioAllocationRiskSignalCode
>([
  "SINGLE_COMPANY_CONCENTRATION",
  "TOP_TWO_CONCENTRATION",
  "THEME_CORRELATION",
  "CASH_PURCHASING_POWER"
]);

const PORTFOLIO_ALLOCATION_REVIEW_DIMENSIONS = [
  "COMPANY_CONCENTRATION",
  "SECTOR_DIVERSIFICATION",
  "INDIVIDUAL_STOCK_VOLATILITY",
  "VALUATION_SENSITIVITY",
  "LIQUIDITY_NEEDS",
  "TIME_HORIZON",
  "LOSS_CAPACITY",
  "FEES_TAXES"
] as const;

function displayAllocationRate(value: string): string {
  if (!isCanonicalNonNegativeDecimal(value)) {
    throw new TypeError("Invalid portfolio allocation rate.");
  }
  return `${displayDecimal(formatFixedDecimal(
    multiplyFixed(parseFixedDecimal(value), parseFixedDecimal("100"))
  ))}%`;
}

function portfolioAllocationAnalysisResult(
  evidence: VerifiedEvidence
): PortfolioAllocationAnalysisResult {
  const value = resultRecord(evidence);
  const metrics = value.metrics;
  const reviewDimensions = value.reviewDimensions;
  if (
    value.schemaVersion !== "assistant-v3.portfolio-allocation-analysis.v1" ||
    !["current", "hypothetical"].includes(String(value.scope)) ||
    !["synthetic", "user-supplied-hypothetical"].includes(
      String(value.dataClass)
    ) ||
    !isString(value.currency) ||
    !isIsoTimestamp(value.asOf) ||
    !(
      value.totalValue === null ||
      isCanonicalPositiveDecimal(value.totalValue)
    ) ||
    !Array.isArray(value.allocations) ||
    value.allocations.length < 2 ||
    value.allocations.length > 8 ||
    !isRecord(metrics) ||
    !isString(metrics.largestPosition) ||
    !isCanonicalNonNegativeDecimal(metrics.largestAllocationRate) ||
    !isCanonicalNonNegativeDecimal(metrics.topTwoAllocationRate) ||
    !isCanonicalNonNegativeDecimal(
      metrics.technologyAndTechnologyDependentRate
    ) ||
    !isCanonicalNonNegativeDecimal(metrics.cashAllocationRate) ||
    !Array.isArray(value.riskSignals) ||
    value.riskSignals.length !== PORTFOLIO_ALLOCATION_RISK_CODES.size ||
    !Array.isArray(reviewDimensions) ||
    reviewDimensions.length !==
      PORTFOLIO_ALLOCATION_REVIEW_DIMENSIONS.length ||
    !PORTFOLIO_ALLOCATION_REVIEW_DIMENSIONS.every(
      (dimension, index) => reviewDimensions[index] === dimension
    ) ||
    !(
      value.largestPositionExceedsProfileTarget === null ||
      typeof value.largestPositionExceedsProfileTarget === "boolean"
    ) ||
    value.recommendationAllowed !== false
  ) {
    throw new TypeError("Invalid portfolio allocation analysis result.");
  }

  const allocationKeys = new Set<string>();
  for (const allocation of value.allocations) {
    if (
      !isRecord(allocation) ||
      !isString(allocation.label) ||
      !(
        allocation.symbol === null ||
        (
          isString(allocation.symbol) &&
          /^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(allocation.symbol)
        )
      ) ||
      !isString(allocation.category) ||
      !PORTFOLIO_ALLOCATION_THEMES.has(String(allocation.theme)) ||
      !isCanonicalNonNegativeDecimal(allocation.allocationRate) ||
      !(
        allocation.amount === null ||
        isCanonicalNonNegativeDecimal(allocation.amount)
      ) ||
      typeof allocation.isCash !== "boolean" ||
      allocation.isCash !== (allocation.theme === "cash") ||
      (allocation.isCash && allocation.symbol !== null) ||
      (!allocation.isCash && allocation.symbol === null)
    ) {
      throw new TypeError("Invalid portfolio allocation analysis row.");
    }
    const key = allocation.symbol ?? "CASH";
    if (allocationKeys.has(key)) {
      throw new TypeError("Duplicate portfolio allocation analysis row.");
    }
    allocationKeys.add(key);
  }

  const signalCodes = new Set<string>();
  for (const signal of value.riskSignals) {
    if (
      !isRecord(signal) ||
      !isString(signal.code) ||
      !PORTFOLIO_ALLOCATION_RISK_CODES.has(
        signal.code as PortfolioAllocationRiskSignalCode
      ) ||
      !["low", "moderate", "elevated"].includes(String(signal.band)) ||
      !isCanonicalNonNegativeDecimal(signal.observedRate) ||
      signal.ruleVersion !== "allocation-risk-bands-v1" ||
      signalCodes.has(signal.code)
    ) {
      throw new TypeError("Invalid portfolio allocation risk signal.");
    }
    signalCodes.add(signal.code);
  }

  if (value.riskProfile === null) {
    if (value.largestPositionExceedsProfileTarget !== null) {
      throw new TypeError("Unexpected portfolio risk-profile comparison.");
    }
  } else if (
    !isRecord(value.riskProfile) ||
    value.riskProfile.riskBand !== "MODERATE" ||
    value.riskProfile.objective !== "LONG_TERM_GROWTH" ||
    !Number.isSafeInteger(value.riskProfile.timeHorizonYears) ||
    (value.riskProfile.timeHorizonYears as number) < 1 ||
    !isCanonicalPositiveDecimal(
      value.riskProfile.singleStockTargetMaxAllocationRate
    ) ||
    value.riskProfile.rebalancePreference !== "GRADUAL" ||
    !isIsoTimestamp(value.riskProfile.reviewedAt) ||
    typeof value.largestPositionExceedsProfileTarget !== "boolean"
  ) {
    throw new TypeError("Invalid portfolio allocation risk profile.");
  }

  return value as unknown as PortfolioAllocationAnalysisResult;
}

function portfolioAllocationSignalLabel(
  code: PortfolioAllocationRiskSignalCode,
  locale: SupportedLocale
): string {
  const labels = locale === "az-AZ"
    ? {
        SINGLE_COMPANY_CONCENTRATION: "tək şirkət konsentrasiyası",
        TOP_TWO_CONCENTRATION: "ən böyük iki mövqenin konsentrasiyası",
        THEME_CORRELATION: "texnologiya və əlaqəli mövzu korrelyasiyası",
        CASH_PURCHASING_POWER: "nağd vəsaitin alıcılıq qabiliyyəti"
      }
    : {
        SINGLE_COMPANY_CONCENTRATION: "single-company concentration",
        TOP_TWO_CONCENTRATION: "top-two concentration",
        THEME_CORRELATION: "technology and related-theme correlation",
        CASH_PURCHASING_POWER: "cash purchasing-power exposure"
      };
  return labels[code];
}

function portfolioAllocationReviewDimensionLabel(
  dimension: string
): string {
  return dimension
    .toLocaleLowerCase("en-US")
    .replaceAll("_", " ");
}

function portfolioAllocationAnalysisSlotDisplays(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): readonly string[] {
  const value = portfolioAllocationAnalysisResult(evidence);
  const scope = value.scope === "current"
    ? locale === "az-AZ"
      ? "cari sintetik portfel bölgüsü"
      : "current synthetic portfolio allocation"
    : locale === "az-AZ"
      ? "istifadəçinin təqdim etdiyi hipotetik portfel bölgüsü"
      : "user-supplied hypothetical portfolio allocation";
  const total = value.totalValue === null
    ? locale === "az-AZ"
      ? "ümumi dəyər təqdim edilməyib"
      : "no total value supplied"
    : `${plainText(value.currency)} ${displayDecimal(value.totalValue)} total`;
  const allocations = value.allocations.map((allocation) => {
    const identity = allocation.symbol === null
      ? plainText(allocation.label, 80)
      : instrumentLabel(allocation.label, allocation.symbol);
    const amount = allocation.amount === null
      ? ""
      : `; ${plainText(value.currency)} ${displayDecimal(allocation.amount)}`;
    return `${identity}: ${displayAllocationRate(allocation.allocationRate)}${amount}`;
  }).join("; ");
  const signals = value.riskSignals.map((signal) =>
    `${portfolioAllocationSignalLabel(signal.code, locale)}: ${
      plainText(signal.band)
    } (${displayAllocationRate(signal.observedRate)})`
  ).join("; ");
  const dimensions = value.reviewDimensions
    .map(portfolioAllocationReviewDimensionLabel)
    .join(", ");
  const profile = value.riskProfile === null
    ? locale === "az-AZ"
      ? "bu hipotetik ssenariyə yoxlanılmış risk profili hədəfi əlavə edilməyib"
      : "no reviewed risk-profile target is attached to this hypothetical scenario"
    : locale === "az-AZ"
      ? `${plainText(value.riskProfile.riskBand)} risk profili; ${plainText(
          value.riskProfile.objective
        )}; ${String(value.riskProfile.timeHorizonYears)} il; tək səhm üçün maksimum hədəf ${
          displayAllocationRate(
            value.riskProfile.singleStockTargetMaxAllocationRate
          )
        }; ən böyük mövqe hədəfi ${
          value.largestPositionExceedsProfileTarget ? "aşır" : "aşmır"
        }; ${value.riskProfile.reviewedAt} tarixində yoxlanılıb`
      : `${plainText(value.riskProfile.riskBand)} risk profile; ${plainText(
          value.riskProfile.objective
        )}; ${String(value.riskProfile.timeHorizonYears)}-year horizon; single-stock target maximum ${
          displayAllocationRate(
            value.riskProfile.singleStockTargetMaxAllocationRate
          )
        }; largest position ${
          value.largestPositionExceedsProfileTarget
            ? "exceeds the target"
            : "does not exceed the target"
        }; reviewed ${value.riskProfile.reviewedAt}`;
  return [
    `${scope}; ${total}`,
    allocations,
    locale === "az-AZ"
      ? `ən böyük mövqe ${plainText(value.metrics.largestPosition)}: ${
          displayAllocationRate(value.metrics.largestAllocationRate)
        }`
      : `largest position ${plainText(value.metrics.largestPosition)}: ${
          displayAllocationRate(value.metrics.largestAllocationRate)
        }`,
    locale === "az-AZ"
      ? `ən böyük iki mövqenin cəmi ${
          displayAllocationRate(value.metrics.topTwoAllocationRate)
        }`
      : `top two positions combined: ${
          displayAllocationRate(value.metrics.topTwoAllocationRate)
        }`,
    locale === "az-AZ"
      ? `texnologiya və texnologiyadan asılı bölgü ${
          displayAllocationRate(
            value.metrics.technologyAndTechnologyDependentRate
          )
        }`
      : `technology and technology-dependent allocation: ${
          displayAllocationRate(
            value.metrics.technologyAndTechnologyDependentRate
          )
        }`,
    locale === "az-AZ"
      ? `nağd vəsait bölgüsü ${
          displayAllocationRate(value.metrics.cashAllocationRate)
        }`
      : `cash allocation: ${
          displayAllocationRate(value.metrics.cashAllocationRate)
        }`,
    signals,
    locale === "az-AZ"
      ? `peşəkar baxış amilləri: ${dimensions}`
      : `professional review dimensions: ${dimensions}`,
    profile,
    locale === "az-AZ"
      ? `${value.asOf} tarixinə; mənbə: ${sourceLabel(evidence.envelope)}`
      : `as of ${value.asOf}; source: ${sourceLabel(evidence.envelope)}`,
    locale === "az-AZ"
      ? "alət nəticəsi avtomatik alış, saxlama, satış və ya bölgü tövsiyəsinə icazə vermir"
      : "the tool result permits no automatic buy, hold, sell, or allocation recommendation"
  ];
}

function renderPortfolioActivity(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): string {
  const value = resultRecord(evidence);
  if (value.schemaVersion === "assistant-v3.recent-trading-activity.v1") {
    if (
      value.queryType !== "recent-trading" || value.dataClass !== "synthetic" ||
      !isIsoTimestamp(value.asOf) || !isRecord(value.coverage) ||
      value.coverage.status !== "complete" ||
      !isIsoTimestamp(value.coverage.ledgerPeriodStart) ||
      !isIsoTimestamp(value.coverage.ledgerPeriodEnd) ||
      value.coverage.ledgerPeriodEnd !== value.asOf ||
      !Number.isSafeInteger(value.coverage.matchedCount) ||
      !Number.isSafeInteger(value.coverage.returnedCount) ||
      (value.coverage.matchedCount as number) < 0 ||
      (value.coverage.returnedCount as number) < 0 ||
      (value.coverage.returnedCount as number) > (value.coverage.matchedCount as number) ||
      !Array.isArray(value.items) || value.items.length > 10 ||
      value.items.length !== value.coverage.returnedCount ||
      typeof value.hasMore !== "boolean" ||
      value.hasMore !== (
        (value.coverage.matchedCount as number) >
        (value.coverage.returnedCount as number)
      )
    ) {
      throw new TypeError("Invalid recent trading activity result.");
    }

    const renderedItems = value.items.map((item) => {
      if (
        !isRecord(item) || !isString(item.activityRef) ||
        !isIsoTimestamp(item.occurredAt)
      ) {
        throw new TypeError("Invalid recent trading activity item.");
      }
      if (item.kind === "EXECUTION") {
        const transaction = item.transaction;
        if (
          item.positionEffect !== "AUTHORITATIVE_EXECUTED_TRADE" ||
          !isRecord(transaction) || !isString(transaction.transactionId) ||
          transaction.executionStatus !== "EXECUTED" ||
          !["BUY", "SELL"].includes(String(transaction.side)) ||
          !isString(transaction.instrumentId) || !isString(transaction.symbol) ||
          !isIsoTimestamp(transaction.tradedAt) ||
          !isIsoTimestamp(transaction.settledAt) ||
          transaction.tradedAt !== item.occurredAt ||
          !isDecimalString(transaction.quantity) ||
          !isMoney(transaction.unitPrice) || !isMoney(transaction.grossAmount) ||
          transaction.unitPrice.currency !== transaction.grossAmount.currency ||
          !Array.isArray(transaction.feeIds) ||
          !transaction.feeIds.every(isString) ||
          !(transaction.orderRef === null || isString(transaction.orderRef))
        ) {
          throw new TypeError("Invalid recent execution item.");
        }
        return locale === "az-AZ"
          ? `${plainText(String(transaction.side))} ${displayDecimal(transaction.quantity)} ${plainText(transaction.symbol)} — ${plainText(transaction.unitPrice.currency)} ${displayDecimal(transaction.unitPrice.amount)}, icra vaxtı ${transaction.tradedAt}`
          : `${plainText(String(transaction.side))} ${displayDecimal(transaction.quantity)} ${plainText(transaction.symbol)} at ${plainText(transaction.unitPrice.currency)} ${displayDecimal(transaction.unitPrice.amount)}, executed ${transaction.tradedAt}`;
      }
      if (item.kind === "ORDER") {
        const order = item.order;
        if (
          item.positionEffect !== "NONE_ORDER_STATE_ONLY" ||
          !isRecord(order) || !isString(order.orderRef) ||
          !isString(order.instrumentId) || !isString(order.symbol) ||
          !["BUY", "SELL"].includes(String(order.side)) ||
          !["MARKET", "LIMIT"].includes(String(order.orderType)) ||
          !["DAY", "GOOD_TILL_CANCELLED"].includes(String(order.timeInForce)) ||
          !["FILLED", "OPEN", "CANCELLED"].includes(String(order.status)) ||
          !isIsoTimestamp(order.submittedAt) ||
          !isIsoTimestamp(order.lastUpdatedAt) ||
          order.lastUpdatedAt !== item.occurredAt ||
          !isDecimalString(order.requestedQuantity) ||
          !isDecimalString(order.filledQuantity) ||
          !(order.limitPrice === null || isMoney(order.limitPrice)) ||
          !(order.averageFillPrice === null || isMoney(order.averageFillPrice)) ||
          !Array.isArray(order.linkedTransactionIds) ||
          !order.linkedTransactionIds.every(isString)
        ) {
          throw new TypeError("Invalid recent order item.");
        }
        const limit = isMoney(order.limitPrice)
          ? locale === "az-AZ"
            ? `, limit ${plainText(order.limitPrice.currency)} ${displayDecimal(order.limitPrice.amount)}`
            : ` with a ${plainText(order.limitPrice.currency)} ${displayDecimal(order.limitPrice.amount)} limit`
          : "";
        return locale === "az-AZ"
          ? `${plainText(String(order.side))} ${displayDecimal(order.requestedQuantity)} ${plainText(order.symbol)} ${plainText(String(order.orderType))} sifarişi ${plainText(String(order.status))} statusundadır${limit}; yenilənmə ${order.lastUpdatedAt}`
          : `${plainText(String(order.side))} ${displayDecimal(order.requestedQuantity)} ${plainText(order.symbol)} ${plainText(String(order.orderType))} order is ${plainText(String(order.status))}${limit}; updated ${order.lastUpdatedAt}`;
      }
      throw new TypeError("Unsupported recent trading activity item.");
    });

    if (renderedItems.length === 0) {
      return locale === "az-AZ"
        ? `Filtrlərə uyğun sintetik icra və ya sifariş tapılmadı. Məlumatın vaxtı: ${value.asOf}.`
        : `No synthetic executions or orders matched the requested filters. Data as of ${value.asOf}.`;
    }
    const more = value.hasMore
      ? locale === "az-AZ"
        ? " Daha çox uyğun qeyd mövcuddur."
        : " More matching records are available."
      : "";
    return locale === "az-AZ"
      ? `Son sintetik ticarət fəaliyyəti: ${renderedItems.join("; ")}. Məlumatın vaxtı: ${value.asOf}.${more}`
      : `Latest synthetic trading activity: ${renderedItems.join("; ")}. Data as of ${value.asOf}.${more}`;
  }
  if (
    !Array.isArray(value.transactions) || !Array.isArray(value.externalCashFlows) ||
    !Array.isArray(value.dividends) || !Array.isArray(value.fees) ||
    !Array.isArray(value.corporateActions)
  ) {
    throw new TypeError("Invalid portfolio activity result.");
  }
  const trades = [...value.transactions].sort((left, right) => {
    if (!isRecord(left) || !isRecord(right)) return 0;
    return String(right.tradedAt).localeCompare(String(left.tradedAt));
  }).slice(0, 3).map((transaction) => {
    if (
      !isRecord(transaction) || !isString(transaction.side) ||
      !isString(transaction.symbol) || !isIsoTimestamp(transaction.tradedAt) ||
      !isDecimalString(transaction.quantity) || !isMoney(transaction.grossAmount)
    ) {
      throw new TypeError("Invalid portfolio transaction.");
    }
    return `${plainText(transaction.side)} ${displayDecimal(transaction.quantity)} ${plainText(transaction.symbol)} — ${plainText(transaction.grossAmount.currency)} ${displayDecimal(transaction.grossAmount.amount)} at ${transaction.tradedAt}`;
  });
  if (trades.length === 0) {
    return locale === "az-AZ"
      ? `Seçilmiş dövr üçün sintetik portfeldə alış və ya satış qeydi yoxdur. Mənbə snapshotunun vaxtı: ${evidence.envelope.source.sourceAsOf}.`
      : `There are no buy or sell records in the synthetic portfolio for the selected period. Source data as of ${evidence.envelope.source.sourceAsOf}.`;
  }
  return locale === "az-AZ"
    ? `Son sintetik ticarət qeydləri: ${trades.join("; ")}. Mənbə məlumatının vaxtı: ${evidence.envelope.source.sourceAsOf}.`
    : `Latest synthetic trade records: ${trades.join("; ")}. Source data as of ${evidence.envelope.source.sourceAsOf}.`;
}

function safeHttpUrl(value: unknown): string | null {
  if (!isString(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeEducationCitationUrl(value: unknown): string | null {
  if (!isString(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
        url.username.length === 0 &&
        url.password.length === 0 &&
        url.port.length === 0 &&
        url.toString().length <= 500
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeEducationIdentifier(value: unknown): value is string {
  return isString(value) &&
    value.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function safeEducationScore(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
}

function financialEducationRetrievalResult(
  evidence: VerifiedEvidence,
  locale: SupportedLocale,
  query: string
): FinancialEducationRetrievalResult {
  const value = evidence.envelope.result;
  const toolArgs = evidence.args;
  const normalizedQuery = normalizeFinancialEducationQuery(query);
  const expectedQueryHash = normalizedQuery === null
    ? null
    : financialEducationQueryHash(normalizedQuery);
  if (
    !isRecord(value) ||
    !isRecord(toolArgs) ||
    Object.keys(toolArgs).length !== 1 ||
    normalizedQuery === null ||
    expectedQueryHash === null ||
    toolArgs.query !== normalizedQuery ||
    value.schemaVersion !== "assistant-v3.financial-education-retrieval.v1" ||
    value.status !== "grounded" ||
    value.requestId !== evidence.envelope.requestId ||
    value.queryHash !== expectedQueryHash ||
    value.locale !== locale ||
    !Array.isArray(value.propositions) ||
    value.propositions.length < 1 ||
    value.propositions.length > 5 ||
    !Array.isArray(value.citations) ||
    value.citations.length !== value.propositions.length ||
    !isRecord(value.retrieval) ||
    value.retrieval.retrievalMethod !==
      "approved-corpus-deterministic-vector-plus-lexical-rerank" ||
    value.retrieval.queryHash !== expectedQueryHash ||
    value.retrieval.locale !== locale ||
    !safeEducationIdentifier(value.retrieval.authorityId) ||
    !safeEducationScore(value.retrieval.minimumScore) ||
    value.retrieval.minimumScore <= 0 ||
    !Number.isSafeInteger(value.retrieval.topK) ||
    (value.retrieval.topK as number) < 1 ||
    (value.retrieval.topK as number) > 5 ||
    value.propositions.length > (value.retrieval.topK as number) ||
    !Number.isSafeInteger(value.retrieval.eligibleDocumentCount) ||
    (value.retrieval.eligibleDocumentCount as number) < 1 ||
    !Number.isSafeInteger(value.retrieval.eligiblePropositionCount) ||
    (value.retrieval.eligiblePropositionCount as number) <
      value.propositions.length ||
    !Array.isArray(value.retrieval.selectedPropositionIds) ||
    value.retrieval.selectedPropositionIds.length !==
      value.propositions.length ||
    !Array.isArray(value.reasonCodes) ||
    value.reasonCodes.length !== 1 ||
    value.reasonCodes[0] !== "approved_evidence_retrieved"
  ) {
    throw new TypeError("Invalid financial-education retrieval result.");
  }

  const citationIds = new Set<string>();
  for (let index = 0; index < value.propositions.length; index += 1) {
    const proposition = value.propositions[index];
    const citation = value.citations[index];
    if (
      !isRecord(proposition) ||
      !isRecord(citation) ||
      !safeEducationIdentifier(proposition.propositionId) ||
      !isString(proposition.text) ||
      proposition.text.trim() !== proposition.text ||
      proposition.text.length < 20 ||
      proposition.text.length > 1_000 ||
      proposition.locale !== locale ||
      !safeEducationIdentifier(proposition.sourceId) ||
      !safeEducationIdentifier(proposition.sourceVersion) ||
      !safeEducationScore(proposition.relevanceScore) ||
      proposition.relevanceScore < (value.retrieval.minimumScore as number) ||
      !safeEducationScore(proposition.lexicalScore) ||
      proposition.lexicalScore <= 0 ||
      !safeEducationScore(proposition.vectorScore) ||
      !safeEducationIdentifier(proposition.citationId) ||
      citationIds.has(proposition.citationId) ||
      value.retrieval.selectedPropositionIds[index] !==
        proposition.propositionId ||
      citation.citationId !== proposition.citationId ||
      citation.propositionId !== proposition.propositionId ||
      citation.sourceId !== proposition.sourceId ||
      citation.version !== proposition.sourceVersion ||
      !safeEducationIdentifier(citation.translationGroupId) ||
      !isString(citation.title) ||
      citation.title.length > 240 ||
      safeEducationCitationUrl(citation.sourceUrl) === null ||
      citation.locale !== locale ||
      citation.jurisdiction !== "AZ" ||
      !isString(citation.section) ||
      citation.section.length > 200 ||
      citation.excerpt !== proposition.text ||
      !isIsoTimestamp(citation.publishedAt) ||
      !isIsoTimestamp(citation.effectiveFrom) ||
      !(
        citation.effectiveTo === null ||
        isIsoTimestamp(citation.effectiveTo)
      ) ||
      !isIsoTimestamp(citation.reviewedAt) ||
      !isIsoTimestamp(citation.reviewDueAt) ||
      !isString(citation.contentSha256) ||
      !/^[a-f0-9]{64}$/u.test(citation.contentSha256) ||
      citation.publishedAt > citation.reviewedAt ||
      citation.reviewedAt > citation.effectiveFrom ||
      citation.reviewDueAt <= citation.reviewedAt ||
      (
        citation.effectiveTo !== null &&
        (
          citation.effectiveTo <= citation.effectiveFrom ||
          citation.reviewDueAt > citation.effectiveTo
        )
      )
    ) {
      throw new TypeError("Invalid financial-education proposition or citation.");
    }
    citationIds.add(proposition.citationId);
  }
  return value as unknown as FinancialEducationRetrievalResult;
}

function financialEducationSlotDisplays(
  evidence: VerifiedEvidence,
  locale: SupportedLocale,
  query: string
): readonly [string, string, string] {
  const value = financialEducationRetrievalResult(evidence, locale, query);
  const propositions = value.propositions.map((proposition, index) =>
    `[${String(index + 1)}] ${plainText(proposition.text, 180)}`
  ).join(" ");
  const citations = value.citations.map((citation, index) => {
    const url = safeEducationCitationUrl(citation.sourceUrl);
    if (url === null) {
      throw new TypeError("Financial-education citation URL is invalid.");
    }
    return `[${String(index + 1)}] ${plainText(citation.title, 100)} — ${
      plainText(citation.section, 80)
    }; ${url}; ${
      locale === "az-AZ" ? "qüvvədədir" : "effective"
    } ${citation.effectiveFrom}`;
  }).join("; ");
  const latestReview = value.citations
    .map(({ reviewedAt }) => reviewedAt)
    .sort()
    .at(-1)!;
  const provenance = locale === "az-AZ"
    ? `dəqiq sorğu üzrə təsdiqlənmiş təhsil materialı; ${
        String(value.propositions.length)
      } müddəa; son baxış ${latestReview}; mənbə müşahidəsi ${
        evidence.envelope.source.sourceAsOf
      }; provayder: ${sourceLabel(evidence.envelope)}`
    : `approved education evidence for the exact query; ${
        String(value.propositions.length)
      } proposition(s); latest review ${latestReview}; source observed ${
        evidence.envelope.source.sourceAsOf
      }; provider: ${sourceLabel(evidence.envelope)}`;
  return [
    directSlotDisplay(propositions),
    directSlotDisplay(citations),
    directSlotDisplay(provenance)
  ];
}

function renderFinancialEducationRetrieval(
  evidence: VerifiedEvidence,
  locale: SupportedLocale,
  query: string
): string {
  const [propositions, citations, provenance] =
    financialEducationSlotDisplays(evidence, locale, query);
  return locale === "az-AZ"
    ? `${propositions} Sitatlar: ${citations}. ${provenance}.`
    : `${propositions} Citations: ${citations}. ${provenance}.`;
}

function renderApprovedKnowledge(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): string {
  const value = resultRecord(evidence);
  if (
    value.status !== "grounded" || !["en-US", "az-AZ"].includes(String(value.locale)) ||
    !Array.isArray(value.chunks) || value.chunks.length === 0 ||
    !isRecord(value.retrieval) || !isRecord(value.retrieval.trustedFilter) ||
    value.retrieval.trustedFilter.approvalStatus !== "approved"
  ) {
    throw new TypeError("Invalid approved knowledge result.");
  }
  const chunk = value.chunks[0];
  if (!isRecord(chunk) || !isRecord(chunk.metadata)) {
    throw new TypeError("Invalid approved knowledge chunk.");
  }
  const metadata = chunk.metadata;
  if (
    !isString(metadata.title) || !isString(metadata.section) ||
    !isString(metadata.text) || !isIsoTimestamp(metadata.effectiveFrom)
  ) {
    throw new TypeError("Invalid approved knowledge metadata.");
  }
  const url = safeHttpUrl(metadata.url);
  if (url === null) throw new TypeError("Approved knowledge citation URL is invalid.");
  const evidenceText = plainText(metadata.text, 320);
  return locale === "az-AZ"
    ? `${plainText(metadata.title, 120)} sənədinə əsasən: ${evidenceText} Mənbə: ${url} — ${plainText(metadata.section, 100)}, qüvvəyə minmə tarixi ${metadata.effectiveFrom}.`
    : `According to ${plainText(metadata.title, 120)}: ${evidenceText} Source: ${url} — ${plainText(metadata.section, 100)}, effective ${metadata.effectiveFrom}.`;
}

/**
 * Render only values present in a verified tool envelope. The model's text is
 * never an input to these templates.
 */
export function renderV3DirectToolEvidence(input: {
  readonly evidence: VerifiedEvidence;
  readonly locale: SupportedLocale;
  readonly query: string;
}): string {
  switch (input.evidence.toolId) {
    case "resolve-instrument":
      return renderResolvedInstrument(input.evidence, input.locale);
    case "read-market-snapshot":
      return renderMarketSnapshot(input.evidence, input.locale);
    case "read-price-history":
      return renderPriceHistory(input.evidence, input.locale);
    case "read-instrument-research":
      return renderInstrumentResearch(input.evidence, input.locale, input.query);
    case "read-market-content":
      return renderMarketContent(input.evidence, input.locale);
    case "convert-currency":
      return renderCurrencyConversion(input.evidence, input.locale);
    case "analyze-portfolio-allocation":
      return `${portfolioAllocationAnalysisSlotDisplays(
        input.evidence,
        input.locale
      ).join("; ")}.`;
    case "read-portfolio-snapshot":
      return renderPortfolioSnapshot(input.evidence, input.locale);
    case "read-portfolio-activity":
      return renderPortfolioActivity(input.evidence, input.locale);
    case "retrieve-reviewed-investment-education":
      return renderFinancialEducationRetrieval(
        input.evidence,
        input.locale,
        input.query
      );
    case "retrieve-approved-product-knowledge":
      return renderApprovedKnowledge(input.evidence, input.locale);
  }
}

function renderRiskComparison(
  evidence: readonly VerifiedEvidence[],
  locale: SupportedLocale
): string {
  const compared = evidence.map((item) => {
    const value = instrumentResearchRecord(item);
    return {
      symbol: plainText(String(value.symbol)),
      generatedAt: String(value.generatedAt),
      source: sourceLabel(item.envelope),
      metrics: riskMetrics(value)
    };
  });
  const metricDates = [
    ...new Set(compared.flatMap(({ metrics }) => metrics.map(({ asOf }) => asOf)))
  ];
  const sharedMetricDate = metricDates.length === 1 ? metricDates[0] : null;
  const summaries = compared.map((item) => {
    if (item.metrics.length === 0) {
      return locale === "az-AZ"
        ? `${item.symbol} — bu mənbədə tarixi risk göstəriciləri yoxdur`
        : `${item.symbol} — historical risk measures are unavailable from this source`;
    }
    const metricValues = item.metrics.map((metric) =>
      `${metric.label.toLocaleLowerCase("en-US")} ${metric.value}`
    ).join(", ");
    const itemDates = [...new Set(item.metrics.map(({ asOf }) => asOf))];
    if (sharedMetricDate !== null) return `${item.symbol} — ${metricValues}`;
    if (itemDates.length === 1) {
      return `${item.symbol} — ${metricValues} (as of ${itemDates[0]})`;
    }
    return `${item.symbol} — ${renderMetricList(item.metrics)}`;
  }).join("; ");
  const sources = [...new Set(compared.map(({ source }) => source))];
  const sourceLabelText = locale === "az-AZ"
    ? `${sources.length === 1 ? "mənbə" : "mənbələr"}: ${sources.join(", ")}`
    : `${sources.length === 1 ? "source" : "sources"}: ${sources.join(", ")}`;
  const evidenceDates = [...new Set(compared.map(({ generatedAt }) => generatedAt))];
  const observation = sharedMetricDate !== null
    ? locale === "az-AZ"
      ? `Məlumat ${sharedMetricDate} tarixinədir; `
      : `Data as of ${sharedMetricDate}; `
    : metricDates.length === 0 && evidenceDates.length === 1
      ? locale === "az-AZ"
        ? `Məlumat ${evidenceDates[0]} tarixində yoxlanılıb; `
        : `Evidence checked at ${evidenceDates[0]}; `
      : "";
  return locale === "az-AZ"
    ? `Tarixi risk müqayisəsi: ${summaries}. Bu göstəricilər keçmiş qiymət davranışını təsvir edir, proqnoz deyil. ${observation}${sourceLabelText}.`
    : `Historical risk comparison: ${summaries}. These measures describe past price behavior; they are not a forecast. ${observation}${sourceLabelText}.`;
}

function deterministicResponse(
  evidence: readonly VerifiedEvidence[],
  locale: SupportedLocale,
  query: string,
  args: ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>
): string {
  try {
    const researchEvidence = evidence.filter(({ toolId }) =>
      toolId === "read-instrument-research"
    );
    if (
      researchIntent(query) === "risk" &&
      researchEvidence.length === 2 &&
      evidence.length === 2
    ) {
      return renderRiskComparison(researchEvidence, locale);
    }
    const rendered = evidence.map((item) => renderV3DirectToolEvidence({
      evidence: item,
      locale,
      query
    })).join(" ").trim();
    if (rendered.length === 0) {
      return tripwire(args, "tool_result_shape_invalid", evidence.at(-1)?.toolId);
    }
    return rendered;
  } catch {
    return tripwire(args, "tool_result_shape_invalid", evidence.at(-1)?.toolId);
  }
}

function directSlotDisplay(value: string): string {
  const display = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/[{}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (display.length === 0 || display.length > 1_200) {
    throw new TypeError("Direct grounded slot display is invalid.");
  }
  return display;
}

function researchContext(
  value: InstrumentResearchRecord,
  locale: SupportedLocale,
  query: string
): string {
  if (researchIntent(query) === "risk") {
    return locale === "az-AZ"
      ? "Bu göstəricilər keçmiş qiymət davranışını təsvir edir, proqnoz deyil."
      : "These measures describe past price behavior; they are not a forecast.";
  }
  if (value.instrumentType === "ETF") {
    return locale === "az-AZ"
      ? "Bu göstəricilər fondun quruluşunu və tarixi risk müşahidələrini təsvir edir; gələcək nəticəyə zəmanət vermir."
      : "These figures describe the fund structure and historical risk observations; they do not guarantee future results.";
  }
  switch (researchIntent(query)) {
    case "analyst":
      return locale === "az-AZ"
        ? "Bu, dərc olunmuş analitik konsensusudur; assistentin investisiya tövsiyəsi deyil."
        : "This is published analyst consensus, not an investment recommendation from the assistant.";
    case "price-range":
      return locale === "az-AZ"
        ? "Bunlar bağlanış qiymətləridir, gün ərzindəki maksimum və minimum deyil."
        : "These are closing-price levels, not intraday highs and lows.";
    default:
      return locale === "az-AZ"
        ? "Bu, müəyyən vaxta aid araşdırma snapshotudur."
        : "This is a point-in-time research snapshot.";
  }
}

function researchPrimaryFacts(
  evidence: VerifiedEvidence,
  value: InstrumentResearchRecord,
  locale: SupportedLocale,
  query: string
): string {
  if (researchIntent(query) === "risk") {
    const metrics = riskMetrics(value);
    if (metrics.length === 0) {
      return unavailableResearchFacet(
        value,
        locale === "az-AZ" ? "tarixi risk göstəriciləri" : "historical risk measures",
        locale
      );
    }
    return locale === "az-AZ"
      ? `${plainText(value.symbol)} üçün tarixi risk göstəriciləri: ${renderMetricList(metrics)}.`
      : `${plainText(value.symbol)} historical risk measures: ${renderMetricList(metrics)}.`;
  }
  const rendered = renderInstrumentResearch(evidence, locale, query);
  const suffix = researchSourceSuffix(evidence, value, locale);
  if (!rendered.endsWith(suffix)) {
    throw new TypeError("Research provenance suffix is invalid.");
  }
  let body = rendered.slice(0, -suffix.length).trim();
  if (value.instrumentType === "ETF") {
    const prefix = `${boundedInlineText(value.displayName, 48)} (${boundedInlineText(value.symbol, 12)}) — `;
    if (body.startsWith(prefix)) body = body.slice(prefix.length).trim();
  }
  return body;
}

function marketContentParts(
  evidence: VerifiedEvidence,
  locale: SupportedLocale
): readonly [string, string] {
  const rendered = renderMarketContent(evidence, locale);
  const provenance = locale === "az-AZ"
    ? `Mənbə: ${sourceLabel(evidence.envelope)}; məlumatın vaxtı: ${evidence.envelope.source.sourceAsOf}.`
    : `Source: ${sourceLabel(evidence.envelope)}; data as of ${evidence.envelope.source.sourceAsOf}.`;
  const marker = locale === "az-AZ"
    ? ` Mənbə: ${sourceLabel(evidence.envelope)}; məlumatın vaxtı: ${evidence.envelope.source.sourceAsOf}.`
    : ` Source: ${sourceLabel(evidence.envelope)}; data as of ${evidence.envelope.source.sourceAsOf}.`;
  return [
    rendered.endsWith(marker)
      ? rendered.slice(0, -marker.length).trim()
      : rendered,
    provenance
  ];
}

function directEvidenceSlotDisplays(input: {
  readonly evidence: VerifiedEvidence;
  readonly locale: SupportedLocale;
  readonly query: string;
}): readonly string[] {
  const { evidence, locale, query } = input;
  const value = evidence.toolId === "read-market-content"
    ? {}
    : resultRecord(evidence);
  switch (evidence.toolId) {
    case "resolve-instrument": {
      if (
        !isString(value.symbol) || !isString(value.displayName) ||
        !["EQUITY", "ETF", "BOND"].includes(String(value.instrumentType)) ||
        !isString(value.exchange) || !isString(value.currency) ||
        !isIsoTimestamp(value.resolvedAt)
      ) throw new TypeError("Invalid resolved instrument result.");
      return [
        instrumentLabel(value.displayName, value.symbol),
        locale === "az-AZ"
          ? `${plainText(String(value.instrumentType))}; ${plainText(value.exchange)} birjasında ${plainText(value.currency)} ilə ticarət olunur`
          : `${plainText(String(value.instrumentType))}; listed on ${plainText(value.exchange)} and traded in ${plainText(value.currency)}`,
        locale === "az-AZ"
          ? `${value.resolvedAt} tarixində yoxlanılıb; mənbə: ${sourceLabel(evidence.envelope)}`
          : `verified at ${value.resolvedAt}; source: ${sourceLabel(evidence.envelope)}`
      ];
    }
    case "read-market-snapshot": {
      if (
        !isString(value.symbol) || !isString(value.displayName) ||
        !isString(value.currency) || !isDecimalString(value.price) ||
        !isString(value.marketState) || !isString(value.freshness) ||
        !isIsoTimestamp(value.asOf)
      ) throw new TypeError("Invalid market snapshot result.");
      return [
        instrumentLabel(value.displayName, value.symbol),
        `${plainText(value.currency)} ${displayDecimal(value.price)}`,
        locale === "az-AZ"
          ? `bazar ${plainText(value.marketState)}; məlumatın statusu ${plainText(value.freshness)}`
          : `market ${plainText(value.marketState)}; freshness ${plainText(value.freshness)}`,
        locale === "az-AZ"
          ? `${value.asOf} tarixinə; mənbə: ${sourceLabel(evidence.envelope)}`
          : `as of ${value.asOf}; source: ${sourceLabel(evidence.envelope)}`
      ];
    }
    case "read-price-history": {
      if (
        !isString(value.symbol) || !isString(value.range) ||
        !isString(value.currency) || !isIsoTimestamp(value.asOf) ||
        !Array.isArray(value.points) || value.points.length === 0
      ) throw new TypeError("Invalid price history result.");
      const first = value.points[0];
      const last = value.points.at(-1);
      if (
        !isRecord(first) || !isRecord(last) ||
        !isIsoTimestamp(first.timestamp) || !isDecimalString(first.close) ||
        !isIsoTimestamp(last.timestamp) || !isDecimalString(last.close)
      ) throw new TypeError("Invalid price history point.");
      return [
        `${plainText(value.symbol)} ${plainText(value.range)}`,
        locale === "az-AZ"
          ? `${first.timestamp}: bağlanış ${plainText(value.currency)} ${displayDecimal(first.close)}`
          : `${first.timestamp}: ${plainText(value.currency)} ${displayDecimal(first.close)} close`,
        locale === "az-AZ"
          ? `${last.timestamp}: bağlanış ${plainText(value.currency)} ${displayDecimal(last.close)}`
          : `${last.timestamp}: ${plainText(value.currency)} ${displayDecimal(last.close)} close`,
        locale === "az-AZ"
          ? `${value.asOf} tarixinə; mənbə: ${sourceLabel(evidence.envelope)}`
          : `data as of ${value.asOf}; source: ${sourceLabel(evidence.envelope)}`
      ];
    }
    case "read-instrument-research": {
      const research = instrumentResearchRecord(evidence);
      return [
        instrumentLabel(research.displayName, research.symbol),
        researchPrimaryFacts(evidence, research, locale, query),
        researchContext(research, locale, query),
        locale === "az-AZ"
          ? `${research.generatedAt} tarixinə; mənbə: ${sourceLabel(evidence.envelope)}`
          : `data as of ${research.generatedAt}; source: ${sourceLabel(evidence.envelope)}`
      ];
    }
    case "read-market-content":
      return marketContentParts(evidence, locale);
    case "convert-currency": {
      const converted = currencyConversionRecord(evidence);
      const marketObservation = converted.scope === "current-market-price"
        ? (
            converted.marketAsOf as readonly Readonly<Record<string, unknown>>[]
          )[0] as Readonly<Record<string, unknown>>
        : null;
      const marketSource = converted.scope === "current-market-price"
        ? converted.marketSource as Readonly<Record<string, unknown>>
        : null;
      const identity = converted.scope === "current-market-price"
        ? instrumentLabel(
            String(converted.displayName),
            String(converted.symbol)
          )
        : null;
      return [
        identity === null
          ? `${plainText(String(converted.targetCurrency))} ${displayDecimal(
              String(converted.convertedAmount)
            )}`
          : `${identity}: ${plainText(String(converted.targetCurrency))} ${displayDecimal(
              String(converted.convertedAmount)
            )} ${locale === "az-AZ" ? `${plainText(String(converted.sourceCurrency))} ${displayDecimal(
              String(converted.sourceAmount)
            )} kotirovkasının ekvivalenti` : `equivalent of ${plainText(String(converted.sourceCurrency))} ${displayDecimal(
              String(converted.sourceAmount)
            )}`}`,
        marketObservation === null
          ? `${plainText(String(converted.sourceCurrency))} ${displayDecimal(
              String(converted.sourceAmount)
            )}`
          : locale === "az-AZ"
            ? `${plainText(String(converted.sourceCurrency))} ${displayDecimal(
                String(converted.sourceAmount)
              )} bazar kotirovkası, ${plainText(String(marketObservation.asOf))} tarixinə`
            : `${plainText(String(converted.sourceCurrency))} ${displayDecimal(
                String(converted.sourceAmount)
              )} market quote as of ${plainText(String(marketObservation.asOf))}`,
        `1 ${plainText(String(converted.sourceCurrency))} = ${displayDecimal(
          String(converted.exchangeRate)
        )} ${plainText(String(converted.targetCurrency))}`,
        locale === "az-AZ"
          ? `${marketSource === null ? "" : `bazar mənbəyi ${plainText(String(marketSource.provider))}; `}${plainText(String(converted.rateEffectiveDate))} tarixindən qüvvədədir; məzənnə mənbəyi: ${sourceLabel(evidence.envelope)}`
          : `${marketSource === null ? "" : `market source ${plainText(String(marketSource.provider))}; `}effective ${plainText(String(converted.rateEffectiveDate))}; rate source: ${sourceLabel(evidence.envelope)}`
      ];
    }
    case "analyze-portfolio-allocation":
      return portfolioAllocationAnalysisSlotDisplays(evidence, locale);
    case "read-portfolio-snapshot": {
      if (
        value.dataClass !== "synthetic" || !isString(value.baseCurrency) ||
        !isIsoTimestamp(value.asOf) || !isMoney(value.currentCash) ||
        !Array.isArray(value.currentLots)
      ) throw new TypeError("Invalid portfolio snapshot result.");
      const symbols = [...new Set(value.currentLots.map((lot) => {
        if (!isRecord(lot) || !isString(lot.symbol) || !isDecimalString(lot.quantity)) {
          throw new TypeError("Invalid portfolio lot.");
        }
        return plainText(lot.symbol);
      }))];
      return [
        locale === "az-AZ" ? "sintetik portfel snapshotu" : "the synthetic portfolio snapshot",
        `${plainText(value.currentCash.currency)} ${displayDecimal(value.currentCash.amount)}`,
        symbols.length === 0
          ? locale === "az-AZ" ? "açıq aktiv yoxdur" : "no open holdings"
          : locale === "az-AZ"
            ? `açıq aktivlər: ${symbols.join(", ")}`
            : `open holdings: ${symbols.join(", ")}`,
        locale === "az-AZ" ? `${value.asOf} tarixinə` : `as of ${value.asOf}`,
        locale === "az-AZ"
          ? "bu snapshot təkbaşına portfelin canlı ümumi dəyərini hesablamır"
          : "this snapshot alone does not calculate a live total portfolio value"
      ];
    }
    case "read-portfolio-activity":
      return [
        renderPortfolioActivity(evidence, locale),
        locale === "az-AZ"
          ? `mənbə məlumatının vaxtı: ${evidence.envelope.source.sourceAsOf}`
          : `source data as of ${evidence.envelope.source.sourceAsOf}`,
        locale === "az-AZ"
          ? "yalnız imzalanmış sintetik fəaliyyət əhatə olunur"
          : "only signed synthetic activity is covered"
      ];
    case "retrieve-reviewed-investment-education":
      return financialEducationSlotDisplays(evidence, locale, query);
    case "retrieve-approved-product-knowledge": {
      if (
        value.status !== "grounded" ||
        !["en-US", "az-AZ"].includes(String(value.locale)) ||
        !Array.isArray(value.chunks) || value.chunks.length === 0 ||
        !isRecord(value.retrieval) || !isRecord(value.retrieval.trustedFilter) ||
        value.retrieval.trustedFilter.approvalStatus !== "approved"
      ) throw new TypeError("Invalid approved knowledge result.");
      const chunk = value.chunks[0];
      if (!isRecord(chunk) || !isRecord(chunk.metadata)) {
        throw new TypeError("Invalid approved knowledge chunk.");
      }
      const metadata = chunk.metadata;
      if (
        !isString(metadata.title) || !isString(metadata.section) ||
        !isString(metadata.text) || !isIsoTimestamp(metadata.effectiveFrom)
      ) throw new TypeError("Invalid approved knowledge metadata.");
      const url = safeHttpUrl(metadata.url);
      if (url === null) throw new TypeError("Approved knowledge citation URL is invalid.");
      return [
        locale === "az-AZ"
          ? `${plainText(metadata.title, 120)} — ${plainText(metadata.section, 100)}`
          : `${plainText(metadata.title, 120)} — ${plainText(metadata.section, 100)}`,
        plainText(metadata.text, 320),
        url,
        locale === "az-AZ"
          ? `qüvvəyə minmə tarixi ${metadata.effectiveFrom}`
          : `effective ${metadata.effectiveFrom}`
      ];
    }
  }
}

function directGroundedSlots(input: {
  readonly evidence: readonly VerifiedEvidence[];
  readonly locale: SupportedLocale;
  readonly query: string;
}): readonly V3DirectGroundedSlot[] {
  const catalog = v3DirectSemanticSlotCatalog(
    input.evidence.map(({ toolId }) => toolId)
  );
  const displays = input.evidence.flatMap((evidence) =>
    directEvidenceSlotDisplays({
      evidence,
      locale: input.locale,
      query: input.query
    })
  );
  if (catalog.length !== displays.length) {
    throw new TypeError("Direct semantic slot catalog drift.");
  }
  return Object.freeze(catalog.map((slot, index) => Object.freeze({
    ...slot,
    display: directSlotDisplay(displays[index]!)
  })));
}

const UNSAFE_NATURALIZATION_LANGUAGE =
  /\b(?:buy|sell|hold|invest|recommend|advice|should|must|suitable|unsuitable|cheap|expensive|undervalued|overvalued|safe|risky|guarantee|forecast|predict|expect|likely|unlikely|outperform|underperform|bullish|bearish|strong|weak|attractive|opportunity|warning|concern|positive|negative|good|bad|best|worst|increase|decrease|rise|rose|fall|fell|gain|loss|high|low|leader|leading|dominant|superior|inferior|promising|healthy|unhealthy|significant|substantial|moderate|minimal|means|implies|indicates|suggests|therefore|future|will|al(?:maq|ın|ış)|sat(?:maq|ın|ış)|saxla|investisiya\s+et|tövsiyə|məsləhət|lazımdır|uyğundur|ucuz|bahalı|dəyərindən\s+aşağı|dəyərindən\s+yuxarı|təhlükəsiz|riskli|zəmanət|proqnoz|ehtimal|art(?:ım|ıb|acaq)|azal(?:ma|ıb|acaq)|qazanc|zərər|yüksək|aşağı|lider|üstün|zəif|əhəmiyyətli|göstərir|deməkdir|nəticə)\b/iu;

const SAFE_ENGLISH_NATURALIZATION_WORDS = new Set([
  "a",
  "about",
  "according",
  "also",
  "and",
  "any",
  "are",
  "as",
  "at",
  "available",
  "based",
  "between",
  "by",
  "both",
  "can",
  "checked",
  "contains",
  "context",
  "current",
  "currently",
  "data",
  "detail",
  "details",
  "evidence",
  "explain",
  "first",
  "for",
  "found",
  "from",
  "further",
  "has",
  "have",
  "help",
  "here",
  "here's",
  "i",
  "if",
  "in",
  "includes",
  "information",
  "is",
  "it",
  "its",
  "like",
  "latest",
  "me",
  "more",
  "now",
  "of",
  "on",
  "part",
  "point",
  "relevant",
  "reported",
  "respectively",
  "review",
  "recorded",
  "result",
  "results",
  "reviewed",
  "runs",
  "see",
  "separately",
  "shows",
  "simply",
  "snapshot",
  "source",
  "specific",
  "status",
  "summary",
  "tells",
  "that",
  "the",
  "their",
  "these",
  "this",
  "those",
  "through",
  "to",
  "together",
  "trading",
  "unpack",
  "us",
  "verified",
  "was",
  "were",
  "while",
  "want",
  "what",
  "with",
  "would",
  "you",
  "your"
]);

const SAFE_AZERBAIJANI_NATURALIZATION_WORDS = new Set([
  "aid",
  "aiddir",
  "arasında",
  "əsasən",
  "əsasında",
  "ayrıca",
  "aydınlaşdıra",
  "baxaq",
  "bir",
  "bilərəm",
  "birlikdə",
  "bu",
  "budur",
  "bunlar",
  "burada",
  "cari",
  "daha",
  "də",
  "dir",
  "edə",
  "edim",
  "edər",
  "etdim",
  "faktlar",
  "gəlin",
  "görə",
  "göstərilir",
  "haqqında",
  "həmçinin",
  "hazırda",
  "hissəni",
  "hissə",
  "hansı",
  "izah",
  "istəsəniz",
  "istəyirsinizsə",
  "ilə",
  "ilk",
  "isə",
  "konkret",
  "mənbəyə",
  "məlumat",
  "məlumata",
  "məlumatlara",
  "məlumatları",
  "mən",
  "mövcud",
  "müvafiq",
  "nə",
  "nəticələri",
  "nəticəni",
  "qeyd",
  "qiymət",
  "olunur",
  "olaraq",
  "olan",
  "son",
  "status",
  "sadə",
  "snapshot",
  "sübutu",
  "sübut",
  "tapdım",
  "tapdığım",
  "təsdiqlənmiş",
  "tərəfindən",
  "üçün",
  "və",
  "yoxladım",
  "üzrə",
  "var",
  "yoxdur",
  "yoxlanmış"
]);

function safeNaturalizationVocabulary(
  shell: string,
  locale: SupportedLocale
): boolean {
  const vocabulary = locale === "az-AZ"
    ? SAFE_AZERBAIJANI_NATURALIZATION_WORDS
    : SAFE_ENGLISH_NATURALIZATION_WORDS;
  const words = shell
    .replaceAll("İ", "i")
    .toLocaleLowerCase("en-US")
    .match(/\p{L}+(?:['’]\p{L}+)?/gu) ?? [];
  return words.every((word) =>
    vocabulary.has(word.replace("’", "'"))
  );
}

/**
 * The model may choose only the conversational shell. Exact, material
 * evidence is inserted after the shell passes this deterministic gate.
 */
export function renderV3DirectNaturalizedTemplate(input: {
  readonly template: string;
  readonly slots: readonly V3DirectGroundedSlot[];
  readonly locale: SupportedLocale;
}): string | null {
  const template = input.template
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  const placeholders = [...template.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/gu)];
  const aliases = new Map(input.slots.map((slot) => [slot.alias, slot]));
  const used = placeholders.map((match) => match[1]!);
  const shell = template.replace(/\{\{[A-Z][A-Z0-9_]*\}\}/gu, " ");
  if (
    template.length === 0 ||
    template.length > 1_200 ||
    input.slots.length === 0 ||
    aliases.size !== input.slots.length ||
    input.slots.some((slot) =>
      !/^[A-Z][A-Z0-9_]*$/u.test(slot.alias) ||
      slot.display.trim().length === 0 ||
      /[{}\u0000-\u001f\u007f]/u.test(slot.display)
    ) ||
    /[\u0000-\u001f\u007f]/u.test(template) ||
    /```|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/u.test(template) ||
    /[{}]/u.test(shell) ||
    /[\p{N}$€£₼%]/u.test(shell) ||
    /https?:\/\//iu.test(shell) ||
    UNSAFE_NATURALIZATION_LANGUAGE.test(shell) ||
    !safeNaturalizationVocabulary(shell, input.locale) ||
    used.length === 0 ||
    new Set(used).size !== used.length ||
    used.some((alias) => !aliases.has(alias)) ||
    input.slots.some((slot) => slot.required && !used.includes(slot.alias))
  ) {
    return null;
  }
  const sentenceTerminators = shell.match(/[.!?](?=\s|$)/gu)?.length ?? 0;
  if (sentenceTerminators > 6) return null;
  let rendered = template;
  for (const alias of used) {
    rendered = rendered.replace(`{{${alias}}}`, aliases.get(alias)!.display);
  }
  return rendered
    .replace(/\s+/gu, " ")
    .replace(/([.!?])\1+(?=\s|$)/gu, "$1")
    .trim();
}

function naturalizedResponse(input: {
  readonly modelText: string;
  readonly evidence: readonly VerifiedEvidence[];
  readonly locale: SupportedLocale;
  readonly query: string;
  readonly args: ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>;
}): string {
  const fallback = deterministicResponse(
    input.evidence, input.locale, input.query, input.args
  );
  const slots = directGroundedSlots({
    evidence: input.evidence,
    locale: input.locale,
    query: input.query
  });
  return renderV3DirectNaturalizedTemplate({
    template: input.modelText,
    slots,
    locale: input.locale
  }) ?? fallback;
}

function replaceNewAssistantText(
  messages: readonly MastraDBMessage[],
  text: string,
  args: ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>,
  failure?: V3DirectEvidenceTripwireMetadata
): MastraDBMessage[] {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const assistantIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message, index }) => index > lastUserIndex && message.role === "assistant")
    .map(({ index }) => index);
  const finalAssistantIndex = assistantIndexes.at(-1);
  if (finalAssistantIndex === undefined) {
    return tripwire(args, "assistant_response_missing");
  }
  const responseIndexes = new Set(assistantIndexes);
  return messages.map((message, index) => {
    if (!responseIndexes.has(index)) return message;
    const retained = message.content.parts.filter((part) =>
      part.type !== "text" && part.type !== "reasoning"
    );
    const parts: MastraMessagePart[] = index === finalAssistantIndex
      ? [...retained, { type: "text", text }]
      : retained;
    return {
      ...message,
      content: {
        ...message.content,
        parts,
        content: index === finalAssistantIndex ? text : "",
        reasoning: undefined,
        ...(failure === undefined ? {} : {
          metadata: {
            ...(isRecord(message.content.metadata) ? message.content.metadata : {}),
            directEvidenceValidation: failure
          }
        })
      }
    };
  });
}

function unavailableResponse(locale: SupportedLocale): string {
  return locale === "az-AZ"
    ? "Bu sorğunu təsdiqlənmiş alət nəticəsi ilə yoxlaya bilmədim, ona görə faktiki cavab verməyəcəyəm. Zəhmət olmasa yenidən cəhd edin."
    : "I couldn't verify this request with an approved tool result, so I won't provide a factual answer. Please try again.";
}

function reviewedNoToolText(
  options: V3DirectEvidenceOutputProcessorOptions,
  query: string,
  locale: SupportedLocale,
  modelText: string
): string | null {
  if (options.reviewedNoToolResponse === undefined) return null;
  let candidate: string | null;
  try {
    candidate = options.reviewedNoToolResponse({ query, locale, modelText });
  } catch {
    return null;
  }
  if (
    typeof candidate !== "string" ||
    candidate.trim().length === 0 ||
    candidate.length > 1_200 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate)
  ) {
    return null;
  }
  return candidate.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

const STREAM_STATE_KEY = "v3DirectEvidenceStreamState" as const;
const REPROCESS_PART_KEY = "__mastraReprocessPart" as const;
const SYNTHETIC_STREAM_MARKER = "v3DirectEvidenceSynthetic" as const;

interface V3DirectEvidenceStreamState {
  readonly calls: Map<string, { toolName: string; args: unknown }>;
  readonly evidence: Map<string, VerifiedEvidence>;
  modelText: string;
  rendered: boolean;
  renderedText: string | null;
  failed: boolean;
  outputEmitted: boolean;
  syntheticQueue: ChunkType[];
}

function directStreamState(state: Record<string, unknown>): V3DirectEvidenceStreamState {
  const existing = state[STREAM_STATE_KEY];
  if (isRecord(existing) && existing.calls instanceof Map) {
    return existing as unknown as V3DirectEvidenceStreamState;
  }
  const created: V3DirectEvidenceStreamState = {
    calls: new Map(),
    evidence: new Map(),
    modelText: "",
    rendered: false,
    renderedText: null,
    failed: false,
    outputEmitted: false,
    syntheticQueue: []
  };
  state[STREAM_STATE_KEY] = created;
  return created;
}

function syntheticStreamPart(part: ChunkType): boolean {
  return isRecord(part.metadata) && part.metadata[SYNTHETIC_STREAM_MARKER] === true;
}

function markedMetadata(part: ChunkType): Record<string, unknown> {
  return {
    ...(isRecord(part.metadata) ? part.metadata : {}),
    [SYNTHETIC_STREAM_MARKER]: true
  };
}

function deterministicStreamTextParts(reference: ChunkType, text: string): ChunkType[] {
  const digest = canonicalHash({ runId: reference.runId, text })
    .slice("sha256:".length, "sha256:".length + 20);
  const id = `v3-direct-evidence-${digest}`;
  const base = {
    runId: reference.runId,
    from: reference.from,
    metadata: markedMetadata(reference)
  };
  return [
    { ...base, type: "text-start", payload: { id } },
    { ...base, type: "text-delta", payload: { id, text } },
    { ...base, type: "text-end", payload: { id } }
  ] as ChunkType[];
}

function continueSyntheticParts(
  state: Record<string, unknown>,
  streamState: V3DirectEvidenceStreamState
): void {
  const next = streamState.syntheticQueue.shift();
  if (next !== undefined) state[REPROCESS_PART_KEY] = next;
}

function replaceWithSyntheticSequence(
  state: Record<string, unknown>,
  streamState: V3DirectEvidenceStreamState,
  parts: readonly ChunkType[]
): ChunkType | null {
  const [first, ...remaining] = parts;
  if (first === undefined) return null;
  streamState.syntheticQueue.push(...remaining);
  continueSyntheticParts(state, streamState);
  return first;
}

function streamCompletedToolResult(
  part: Extract<ChunkType, { type: "tool-result" }>,
  streamState: V3DirectEvidenceStreamState
): CompletedToolResult | null {
  const payload = part.payload;
  const call = streamState.calls.get(payload.toolCallId);
  if (call === undefined || call.toolName !== payload.toolName) return null;
  return {
    toolCallId: payload.toolCallId,
    toolName: payload.toolName,
    args: call.args,
    result: payload.result,
    isError: payload.isError === true
  };
}

function verifiedStreamEvidence(input: {
  completed: CompletedToolResult;
  options: V3DirectEvidenceOutputProcessorOptions;
}): VerifiedEvidence | null {
  try {
    return verifyEvidence(
      input.completed,
      input.options,
      {} as ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>
    );
  } catch {
    return null;
  }
}

function finalizeStreamText(input: {
  state: V3DirectEvidenceStreamState;
  locale: SupportedLocale;
  query: string;
  options: V3DirectEvidenceOutputProcessorOptions;
}): string {
  if (input.state.renderedText !== null) return input.state.renderedText;
  const evidence = [...input.state.evidence.values()];
  let rendered = unavailableResponse(input.locale);
  if (!input.state.failed && evidence.length > 0 && evidence.length <= 3) {
    try {
      rendered = naturalizedResponse({
        modelText: input.state.modelText,
        evidence,
        locale: input.locale,
        query: input.query,
        args: {} as ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>
      });
    } catch {
      rendered = unavailableResponse(input.locale);
      input.state.failed = true;
    }
  } else if (
    !input.state.failed &&
    evidence.length === 0 &&
    input.state.calls.size === 0
  ) {
    const reviewed = reviewedNoToolText(
      input.options,
      input.query,
      input.locale,
      input.state.modelText
    );
    rendered = reviewed ?? unavailableResponse(input.locale);
    input.state.failed = reviewed === null;
  } else {
    input.state.failed = true;
  }
  input.state.rendered = true;
  input.state.renderedText = rendered;
  return rendered;
}

function scrubStepText(
  part: Extract<ChunkType, { type: "step-finish" }>,
  safeText: string | null
): ChunkType {
  return {
    ...part,
    payload: {
      ...part.payload,
      output: {
        ...part.payload.output,
        text: safeText ?? ""
      }
    }
  };
}

function suppressibleModelPart(part: ChunkType): boolean {
  return [
    "text-start",
    "text-delta",
    "text-end",
    "reasoning-start",
    "reasoning-delta",
    "reasoning-end",
    "reasoning-signature",
    "redacted-reasoning",
    "source",
    "file",
    "raw",
    "object",
    "object-result"
  ].includes(part.type);
}

/**
 * Fail-closed output processor for direct Mastra specialist chat.
 *
 * Integration:
 * `outputProcessors: [createV3DirectEvidenceOutputProcessor({ signer, allowedToolIds })]`
 */
export class V3DirectEvidenceOutputProcessor implements Processor<
  typeof V3_DIRECT_EVIDENCE_OUTPUT_PROCESSOR_ID,
  V3DirectEvidenceTripwireMetadata
> {
  readonly id = V3_DIRECT_EVIDENCE_OUTPUT_PROCESSOR_ID;
  readonly name = "V3 signed direct-evidence naturalizer";
  readonly description =
    "Verifies signed direct-agent tool evidence, validates a value-free conversational shell, and inserts deterministic EN/AZ facts.";
  readonly #options: V3DirectEvidenceOutputProcessorOptions;

  constructor(options: V3DirectEvidenceOutputProcessorOptions) {
    if (options.allowedToolIds.length === 0) {
      throw new TypeError("At least one direct renderable tool must be allowed.");
    }
    const unknown = options.allowedToolIds.find((toolId) =>
      !(V3_DIRECT_RENDERABLE_TOOL_IDS as readonly string[]).includes(toolId)
    );
    if (unknown !== undefined) {
      throw new TypeError(`Unsupported direct renderable tool: ${unknown}.`);
    }
    this.#options = {
      signer: options.signer,
      allowedToolIds: Object.freeze([...new Set(options.allowedToolIds)]),
      ...(options.reviewedNoToolResponse === undefined
        ? {}
        : { reviewedNoToolResponse: options.reviewedNoToolResponse })
    };
  }

  async processOutputStream(
    args: ProcessOutputStreamArgs<V3DirectEvidenceTripwireMetadata>
  ): Promise<ChunkType | null | undefined> {
    const query = latestUserQuery([], args.messageList ?? {});
    if (
      isGreetingOnly(query) &&
      this.#options.reviewedNoToolResponse === undefined
    ) {
      return args.part;
    }
    const locale = localeFor(query);
    const streamState = directStreamState(args.state);

    // Reprocessed deterministic parts must traverse the complete processor
    // chain, but must never be mistaken for model output by this processor.
    if (syntheticStreamPart(args.part)) {
      continueSyntheticParts(args.state, streamState);
      return args.part;
    }

    if (args.part.type === "tool-call") {
      const payload = args.part.payload;
      streamState.calls.set(payload.toolCallId, {
        toolName: payload.toolName,
        args: boundaryToolArgs(payload.args ?? {})
      });
      return args.part;
    }

    if (args.part.type === "tool-result") {
      const completed = streamCompletedToolResult(args.part, streamState);
      const evidence = completed === null
        ? null
        : verifiedStreamEvidence({
            completed,
            options: this.#options
          });
      if (completed === null || evidence === null) {
        streamState.failed = true;
      } else {
        streamState.evidence.set(completed.toolCallId, evidence);
      }
      return args.part;
    }

    if (args.part.type === "text-delta") {
      const payload = args.part.payload as unknown as Record<string, unknown>;
      const delta = typeof payload.text === "string"
        ? payload.text
        : typeof payload.delta === "string"
          ? payload.delta
          : "";
      streamState.modelText += delta;
      return null;
    }
    if (suppressibleModelPart(args.part)) return null;

    if (args.part.type === "step-finish") {
      const terminal = args.part.payload.stepResult.reason !== "tool-calls";
      return scrubStepText(
        args.part,
        terminal
          ? finalizeStreamText({
              state: streamState,
              locale,
              query,
              options: this.#options
            })
          : null
      );
    }

    if (args.part.type === "finish" && !streamState.outputEmitted) {
      const rendered = finalizeStreamText({
        state: streamState,
        locale,
        query,
        options: this.#options
      });
      streamState.outputEmitted = true;
      const originalFinish = {
        ...args.part,
        metadata: markedMetadata(args.part)
      } as ChunkType;
      return replaceWithSyntheticSequence(
        args.state,
        streamState,
        [...deterministicStreamTextParts(args.part, rendered), originalFinish]
      );
    }

    return args.part;
  }

  processOutputResult(
    args: ProcessOutputResultArgs<V3DirectEvidenceTripwireMetadata>
  ): MastraDBMessage[] {
    const query = latestUserQuery(args.messages, args.messageList);
    if (
      isGreetingOnly(query) &&
      this.#options.reviewedNoToolResponse === undefined
    ) {
      return args.messages;
    }
    // Mastra runs result processors after every agent loop step. A tool-call
    // step is not a user-visible terminal answer; rendering it here and again
    // after the continuation makes the top-level text concatenate twice.
    if (args.result.finishReason === "tool-calls") return args.messages;
    const locale = localeFor(query);
    try {
      if (query.length === 0) return tripwire(args, "query_missing");
      const completed = collectCompletedToolResults(args.result, args);
      if (completed.length === 0) {
        const reviewed = reviewedNoToolText(
          this.#options,
          query,
          locale,
          args.result.text
        );
        if (reviewed !== null) {
          return replaceNewAssistantText(args.messages, reviewed, args);
        }
        return tripwire(args, "tool_not_called");
      }
      if (completed.length > 3) return tripwire(args, "too_many_tool_results");
      const evidence = completed.map((item) =>
        verifyEvidence(item, this.#options, args)
      );
      const rendered = naturalizedResponse({
        modelText: args.result.text,
        evidence,
        locale,
        query,
        args
      });
      return replaceNewAssistantText(args.messages, rendered, args);
    } catch (error) {
      if (!(error instanceof V3DirectEvidenceValidationError)) throw error;
      return replaceNewAssistantText(
        args.messages,
        unavailableResponse(locale),
        args,
        error.metadata
      );
    }
  }
}

export function createV3DirectEvidenceOutputProcessor(
  options: V3DirectEvidenceOutputProcessorOptions
): V3DirectEvidenceOutputProcessor {
  return new V3DirectEvidenceOutputProcessor(options);
}
