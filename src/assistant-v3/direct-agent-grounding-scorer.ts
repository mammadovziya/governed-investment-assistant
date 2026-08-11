import {
  createScorer,
  extractTrajectory,
  type ScorerRunInputForAgent,
  type ScorerRunOutputForAgent,
  type ToolCallStep,
} from "@mastra/core/evals";
import type { ToolExecutionEnvelope } from "./contracts.js";
import {
  classifyV3ReviewedNoToolTurn,
  deriveV3DirectPortfolioAllocationArguments,
  expectedV3DirectToolForQuery,
} from "./direct-no-tool.js";
import {
  V3_DIRECT_RENDERABLE_TOOL_IDS,
  type V3DirectRenderableToolId,
} from "./direct-evidence-output-processor.js";
import { normalizeFinancialEducationQuery } from "./financial-education-query.js";
import {
  v3DirectResearchComparisonSymbols,
  v3DirectTickerCandidates,
} from "./direct-symbols.js";
import { analyzeV3SemanticFrame } from "./semantic-frame.js";
import { v3DirectTargetCurrency } from "./direct-currency.js";
import {
  canonicalHash,
  type DevHmacSigner,
  verifyEnvelope,
} from "./signing.js";
import { decimal } from "./fixed-decimal.js";

export const V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID =
  "v3.agent.direct-tool-grounding" as const;

const V3_DIRECT_AGENT_TOOL_GROUNDING_ADAPTER_VERSION = "2.1.0" as const;

export type V3DirectAgentToolGroundingStatus =
  | "pass"
  | "fail"
  | "not_applicable"
  | "error";

export interface V3DirectAgentToolGroundingAnalysis {
  readonly adapterVersion: typeof V3_DIRECT_AGENT_TOOL_GROUNDING_ADAPTER_VERSION;
  readonly scorerId: typeof V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID;
  readonly status: V3DirectAgentToolGroundingStatus;
  readonly applicable: boolean;
  readonly passed: boolean;
  readonly toolCallCount: number;
  readonly successfulToolResultCount: number;
  readonly successfulToolNames: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly implementation: "deterministic-function";
  readonly authoritativeDeliveryGate: false;
}

/** Studio-facing metadata. This scorer never invokes a model or judge. */
export const V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_METADATA = Object.freeze({
  id: V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID,
  name: "Direct specialist signed tool grounding",
  description:
    "Deterministically verifies the signed boundary-tool envelope, tool identity, arguments, result, and request/run binding for a factual direct specialist-agent run.",
  adapterVersion: V3_DIRECT_AGENT_TOOL_GROUNDING_ADAPTER_VERSION,
  implementation: "deterministic-function" as const,
  nativePassScore: 1 as const,
  nativeNonPassScore: 0 as const,
  authoritativeDeliveryGate: false as const,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromMessageContent(value: unknown, depth = 0): string {
  if (depth > 8) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => textFromMessageContent(item, depth + 1))
      .filter(Boolean)
      .join(" ");
  }
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if ("parts" in value) return textFromMessageContent(value.parts, depth + 1);
  if ("content" in value) return textFromMessageContent(value.content, depth + 1);
  return "";
}

function lastInputMessageText(input: ScorerRunInputForAgent): string {
  const inputMessages = Array.isArray(input.inputMessages)
    ? input.inputMessages
    : [];
  const userMessages = inputMessages.filter((message) => message.role === "user");
  const message = userMessages.at(-1) ?? inputMessages.at(-1);
  return textFromMessageContent(message?.content).normalize("NFKC").trim();
}

function isGreetingOnly(query: string): boolean {
  return /^(?:hello|hi|hey|salam|salamlar|good\s+(?:morning|afternoon|evening))[!.?\s]*$/iu
    .test(query);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isoTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function boundaryToolArgs(value: unknown): unknown {
  if (!isRecord(value) || !("__mastraMetadata" in value)) return value;
  const { __mastraMetadata: _metadata, ...args } = value;
  return args;
}

function stableHash(value: unknown): string | null {
  try {
    return canonicalHash(value);
  } catch {
    return null;
  }
}

function envelopeCandidate(value: unknown): ToolExecutionEnvelope<unknown> | null {
  const candidates = [
    value,
    isRecord(value) ? value.envelope : undefined,
    isRecord(value) ? value.value : undefined,
    isRecord(value) ? value.output : undefined,
  ].filter(
    (candidate) =>
      isRecord(candidate) &&
      candidate.schemaVersion === "assistant-v3.tool-execution.v1",
  );
  const unique = [...new Set(candidates)];
  return unique.length === 1
    ? (unique[0] as unknown as ToolExecutionEnvelope<unknown>)
    : null;
}

function structurallyValidEnvelope(
  envelope: ToolExecutionEnvelope<unknown>,
): boolean {
  return envelope.schemaVersion === "assistant-v3.tool-execution.v1" &&
    UUID_PATTERN.test(envelope.executionId) &&
    UUID_PATTERN.test(envelope.requestId) &&
    UUID_PATTERN.test(envelope.workflowRunId) &&
    envelope.requestId !== envelope.workflowRunId &&
    nonEmptyString(envelope.toolId) &&
    nonEmptyString(envelope.toolVersion) &&
    envelope.status === "success" &&
    isoTimestamp(envelope.startedAt) &&
    isoTimestamp(envelope.completedAt) &&
    nonEmptyString(envelope.argumentsHash) &&
    nonEmptyString(envelope.resultHash) &&
    envelope.result !== null &&
    envelope.error === null &&
    isRecord(envelope.source) &&
    nonEmptyString(envelope.source.provider) &&
    nonEmptyString(envelope.source.sourceId) &&
    isoTimestamp(envelope.source.observedAt) &&
    isoTimestamp(envelope.source.sourceAsOf) &&
    isRecord(envelope.integrity);
}

interface VerifiedDirectToolCall {
  readonly step: ToolCallStep;
  readonly envelope: ToolExecutionEnvelope<unknown>;
}

type DirectToolVerification =
  | { readonly verified: VerifiedDirectToolCall }
  | { readonly reasonCode: string };

function verifyDirectToolCall(input: {
  step: ToolCallStep;
  signer: DevHmacSigner;
  allowedToolIds: ReadonlySet<string>;
}): DirectToolVerification {
  const { step } = input;
  if (step.success !== true || step.toolResult === undefined) {
    return { reasonCode: "tool_result_not_successful" };
  }
  const envelope = envelopeCandidate(step.toolResult);
  if (envelope === null || !structurallyValidEnvelope(envelope)) {
    return { reasonCode: "tool_envelope_or_request_run_binding_invalid" };
  }
  if (!input.allowedToolIds.has(step.name) || envelope.toolId !== step.name) {
    return { reasonCode: "tool_identity_not_allowed_or_mismatched" };
  }
  let signatureValid = false;
  try {
    signatureValid = verifyEnvelope(envelope, input.signer);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return { reasonCode: "tool_envelope_signature_invalid" };
  }
  if (envelope.argumentsHash !== stableHash(boundaryToolArgs(step.toolArgs ?? {}))) {
    return { reasonCode: "tool_arguments_hash_invalid" };
  }
  if (envelope.resultHash !== stableHash(envelope.result)) {
    return { reasonCode: "tool_result_hash_invalid" };
  }
  return { verified: { step, envelope } };
}

function createAnalysis(input: {
  status: V3DirectAgentToolGroundingStatus;
  toolCalls?: readonly ToolCallStep[];
  successful?: readonly ToolCallStep[];
  reasonCode: string;
}): V3DirectAgentToolGroundingAnalysis {
  const toolCalls = input.toolCalls ?? [];
  const successful = input.successful ?? [];
  return Object.freeze({
    adapterVersion: V3_DIRECT_AGENT_TOOL_GROUNDING_ADAPTER_VERSION,
    scorerId: V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID,
    status: input.status,
    applicable: input.status === "pass" || input.status === "fail",
    passed: input.status === "pass",
    toolCallCount: toolCalls.length,
    successfulToolResultCount: successful.length,
    successfulToolNames: Object.freeze([
      ...new Set(successful.map(({ name }) => name)),
    ]),
    reasonCodes: Object.freeze([input.reasonCode]),
    implementation: "deterministic-function",
    authoritativeDeliveryGate: false,
  });
}

function canonicalResearchSymbol(step: ToolCallStep): string | null {
  const args = boundaryToolArgs(step.toolArgs ?? {});
  if (
    !isRecord(args) ||
    typeof args.symbol !== "string" ||
    !/^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(args.symbol)
  ) {
    return null;
  }
  return args.symbol;
}

const SYMBOL_BOUNDARY_TOOLS = new Set<string>([
  "resolve-instrument",
  "read-market-snapshot",
  "read-price-history",
  "read-instrument-research",
  "read-market-content",
]);

function directToolCallMatchesCurrentQuery(input: {
  query: string;
  step: ToolCallStep;
}): boolean {
  const expectedTool = expectedV3DirectToolForQuery(input.query);
  if (expectedTool === null || input.step.name !== expectedTool) return false;
  const args = boundaryToolArgs(input.step.toolArgs ?? {});
  if (!isRecord(args)) return false;
  if (SYMBOL_BOUNDARY_TOOLS.has(input.step.name)) {
    const symbol = canonicalResearchSymbol(input.step);
    const explicitSymbols = v3DirectTickerCandidates(input.query);
    return symbol !== null &&
      explicitSymbols.length === 1 &&
      explicitSymbols[0] === symbol;
  }
  if (input.step.name === "retrieve-approved-product-knowledge") {
    return typeof args.query === "string" &&
      args.query.normalize("NFKC").replace(/\s+/gu, " ").trim() ===
        input.query.normalize("NFKC").replace(/\s+/gu, " ").trim();
  }
  if (input.step.name === "retrieve-reviewed-investment-education") {
    const query = normalizeFinancialEducationQuery(input.query);
    return query !== null &&
      stableHash(args) === stableHash({ query });
  }
  if (input.step.name === "convert-currency") {
    const targetCurrency = v3DirectTargetCurrency(input.query);
    if (
      targetCurrency === null ||
      args.targetCurrency !== targetCurrency
    ) {
      return false;
    }
    if (args.scope === "current-market-price") {
      const explicitSymbols = v3DirectTickerCandidates(input.query);
      return typeof args.symbol === "string" &&
        /^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(args.symbol) &&
        explicitSymbols.length === 1 &&
        explicitSymbols[0] === args.symbol &&
        !("amount" in args) &&
        !("sourceCurrency" in args) &&
        /\b(?:current|latest|now|price|quote|worth|cost)\b|(?:cari|hazırkı|son\s+qiymət|qiyməti)/iu
          .test(input.query);
    }
    if (args.scope === "current-portfolio-value") {
      return !("amount" in args) &&
        !("sourceCurrency" in args) &&
        /\b(?:portfolio|holdings?|it|that|value|amount)\b|(?<!\p{L})(?:portfel\p{L}*|onu|bunu|d[əe]y[əe]ri|m[əe]bl[əe][ğg]i)(?!\p{L})/iu
          .test(input.query);
    }
    if (
      args.scope !== "provided-amount" ||
      typeof args.amount !== "string" ||
      (args.sourceCurrency !== "USD" && args.sourceCurrency !== "AZN")
    ) {
      return false;
    }
    const amountMatch =
      /\b(USD|AZN)\s+(\d+(?:[.,]\d{1,8})?)\b/iu.exec(input.query) ??
      /\b(\d+(?:[.,]\d{1,8})?)\s*(USD|AZN)\b/iu.exec(input.query);
    if (amountMatch === null) return false;
    const currencyFirst = /^(?:USD|AZN)$/iu.test(amountMatch[1] ?? "");
    const sourceCurrency = (
      currencyFirst ? amountMatch[1] : amountMatch[2]
    )?.toLocaleUpperCase("en-US");
    const rawAmount = currencyFirst ? amountMatch[2] : amountMatch[1];
    if (rawAmount === undefined) return false;
    try {
      return args.sourceCurrency === sourceCurrency &&
        args.amount === decimal(rawAmount.replace(",", "."));
    } catch {
      return false;
    }
  }
  if (input.step.name === "analyze-portfolio-allocation") {
    const expectedArgs = deriveV3DirectPortfolioAllocationArguments(input.query);
    return expectedArgs !== null &&
      stableHash(args) === stableHash(expectedArgs);
  }
  if (
    input.step.name === "read-portfolio-activity" &&
    typeof args.symbol === "string"
  ) {
    const explicitSymbols = v3DirectTickerCandidates(input.query);
    return /^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(args.symbol) &&
      explicitSymbols.length === 1 &&
      explicitSymbols[0] === args.symbol;
  }
  return true;
}

function isExplicitTwoInstrumentResearchComparison(input: {
  query: string;
  verified: readonly VerifiedDirectToolCall[];
  failures: readonly string[];
}): boolean {
  if (
    input.verified.length !== 2 ||
    input.failures.length !== 0 ||
    !analyzeV3SemanticFrame(input.query).securityComparison ||
    input.verified.some(({ step }) => step.name !== "read-instrument-research")
  ) {
    return false;
  }
  const symbols = input.verified.map(({ step }) => canonicalResearchSymbol(step));
  const explicitSymbols = v3DirectResearchComparisonSymbols(input.query);
  return symbols.every((symbol): symbol is string => symbol !== null) &&
    new Set(symbols).size === 2 &&
    explicitSymbols !== null &&
    symbols.every((symbol) => explicitSymbols.includes(symbol));
}

function evaluateDirectAgentGrounding(
  input: ScorerRunInputForAgent | undefined,
  output: ScorerRunOutputForAgent,
  options: {
    signer: DevHmacSigner;
    allowedToolIds: ReadonlySet<string>;
  },
): V3DirectAgentToolGroundingAnalysis {
  if (input === undefined || !Array.isArray(input.inputMessages)) {
    return createAnalysis({
      status: "error",
      reasonCode: "direct_agent_input_invalid",
    });
  }

  const query = lastInputMessageText(input);
  if (query.length === 0) {
    return createAnalysis({
      status: "error",
      reasonCode: "direct_agent_query_missing",
    });
  }
  if (isGreetingOnly(query)) {
    return createAnalysis({
      status: "not_applicable",
      reasonCode: "greeting_does_not_require_tool",
    });
  }

  try {
    const trajectory = extractTrajectory(output);
    const toolCalls = trajectory.steps.filter(
      (step): step is ToolCallStep => step.stepType === "tool_call",
    );
    const reviewedNoToolKind = classifyV3ReviewedNoToolTurn(query);
    if (toolCalls.length === 0 && reviewedNoToolKind !== null) {
      return createAnalysis({
        status: "not_applicable",
        toolCalls,
        reasonCode: `reviewed_no_tool_${reviewedNoToolKind}`,
      });
    }
    const verified: VerifiedDirectToolCall[] = [];
    const failures: string[] = [];
    for (const step of toolCalls) {
      const result = verifyDirectToolCall({
        step,
        signer: options.signer,
        allowedToolIds: options.allowedToolIds,
      });
      if ("verified" in result) verified.push(result.verified);
      else failures.push(result.reasonCode);
    }
    const requestRunBindings = new Set(
      verified.map(({ envelope }) => `${envelope.requestId}:${envelope.workflowRunId}`),
    );
    const semanticMatches = verified.every(({ step }) =>
      directToolCallMatchesCurrentQuery({ query, step })
    );
    if (
      toolCalls.length === 1 &&
      verified.length === 1 &&
      failures.length === 0 &&
      semanticMatches
    ) {
      return createAnalysis({
        status: "pass",
        toolCalls,
        successful: verified.map(({ step }) => step),
        reasonCode: "signed_tool_envelope_verified",
      });
    }
    if (isExplicitTwoInstrumentResearchComparison({
      query,
      verified,
      failures,
    })) {
      return createAnalysis({
        status: "pass",
        toolCalls,
        successful: verified.map(({ step }) => step),
        reasonCode: "signed_two_instrument_research_envelopes_verified",
      });
    }
    return createAnalysis({
      status: "fail",
      toolCalls,
      successful: verified.map(({ step }) => step),
      reasonCode: toolCalls.length === 0
        ? "factual_query_tool_not_called"
        : verified.length > 0 && !semanticMatches
          ? "tool_not_semantically_authorized_for_current_query"
        : requestRunBindings.size > 1
          ? "tool_request_run_binding_mismatch"
          : toolCalls.length > 1
            ? "factual_query_has_multiple_tool_results"
            : failures[0] ?? "factual_query_has_no_verified_tool_result",
    });
  } catch {
    return createAnalysis({
      status: "error",
      reasonCode: "direct_agent_output_invalid",
    });
  }
}

function reasonFor(analysis: V3DirectAgentToolGroundingAnalysis): string {
  const reason = analysis.reasonCodes.join(", ");
  return `${analysis.status}: ${reason}. Successful tool results: ${analysis.successfulToolResultCount}.`;
}

/**
 * Creates a native Mastra agent scorer for direct Studio/specialist runs.
 * The `agent` shortcut intentionally accepts Mastra's native Studio eval
 * input/output message format and keeps this scorer model-free.
 */
export function createV3DirectAgentToolGroundingScorer(input: {
  readonly signer: DevHmacSigner;
  readonly allowedToolIds?: readonly V3DirectRenderableToolId[];
}) {
  const allowedToolIds = new Set<string>(
    input.allowedToolIds ?? V3_DIRECT_RENDERABLE_TOOL_IDS,
  );
  return createScorer({
    id: V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID,
    name: V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_METADATA.name,
    description: V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_METADATA.description,
    type: "agent",
  })
    .analyze(({ run }) =>
      evaluateDirectAgentGrounding(run.input, run.output, {
        signer: input.signer,
        allowedToolIds,
      }))
    .generateScore(({ results }) =>
      results.analyzeStepResult.status === "pass" &&
      results.analyzeStepResult.passed
        ? 1
        : 0,
    )
    .generateReason(({ results }) => reasonFor(results.analyzeStepResult));
}

export type V3DirectAgentToolGroundingScorer = ReturnType<
  typeof createV3DirectAgentToolGroundingScorer
>;
