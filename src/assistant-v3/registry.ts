import { Mastra } from "@mastra/core/mastra";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { IMastraLogger } from "@mastra/core/logger";
import type { IMastraEditor } from "@mastra/core/editor";
import type { MastraMemory } from "@mastra/core/memory";
import type { ObservabilityEntrypoint } from "@mastra/core/observability";
import type { ApiRoute } from "@mastra/core/server";
import { InMemoryStore, type MastraCompositeStore } from "@mastra/core/storage";
import type { ToolAction } from "@mastra/core/tools";
import { createOpenAI, type OpenAIProviderSettings } from "@ai-sdk/openai";

import {
  createV3BoundaryTools,
  type V3BoundaryToolDependencies
} from "./boundary-tools.js";
import {
  createV3DirectAgentToolGroundingScorer,
  V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID
} from "./direct-agent-grounding-scorer.js";
import {
  V3_DIRECT_RENDERABLE_TOOL_IDS,
  v3DirectSemanticSlotCatalog,
  type V3DirectRenderableToolId
} from "./direct-evidence-output-processor.js";
import { deriveV3DirectPortfolioAllocationArguments } from "./direct-no-tool.js";
import { normalizeFinancialEducationQuery } from "./financial-education-query.js";
import {
  v3DirectTickerCandidates,
  v3DirectResearchComparisonSymbols,
  v3ExactDirectTicker
} from "./direct-symbols.js";
import { v3DirectTargetCurrency } from "./direct-currency.js";
import {
  V3_MODEL_POLICY,
  V3_OPENAI_ESCALATION_MODEL_ID,
  V3_OPENAI_MODEL_ID,
  V3_OPENAI_PRIMARY_MODEL_ID,
  type V3OpenAIModelId
} from "./model-policy.js";
import { createV3MastraResponseScorers } from "./mastra-scorers.js";
import { V3_APPROVED_BOUNDARY_TOOL_IDS } from "./policy.js";
import { V3_BLOCKING_RESPONSE_SCORER_IDS } from "./response-scorers.js";
import { detectV3Locale } from "./routing.js";
import { decimal } from "./fixed-decimal.js";
import {
  createV3FinancialTaskPlannerAgent,
  V3FinancialTaskPlanner,
  V3_FINANCIAL_TASK_PLANNER_AGENT_ID,
  type V3FinancialTaskPlannerAgentPort
} from "./financial-task-planner.js";
import {
  createAssistantV3Workflows,
  V3_WORKFLOW_IDS,
  type V3WorkflowDependencies
} from "./workflows.js";
import { createWriterAgents, WRITER_AGENT_IDS } from "./writers.js";
import { canonicalHash } from "./signing.js";

export {
  V3_MODEL_POLICY,
  V3_OPENAI_ESCALATION_MODEL_ID,
  V3_OPENAI_MODEL_ID,
  V3_OPENAI_MODEL_IDS,
  V3_OPENAI_PRIMARY_MODEL_ID
} from "./model-policy.js";
export type { V3ModelTier, V3OpenAIModelId } from "./model-policy.js";

export const V3_SCORER_IDS = Object.freeze([
  ...V3_BLOCKING_RESPONSE_SCORER_IDS,
  V3_DIRECT_AGENT_TOOL_GROUNDING_SCORER_ID
] as const);

/** Mastra compiles each configured agent processor into an internal workflow. */
export const V3_INTERNAL_PROCESSOR_WORKFLOW_IDS = Object.freeze(
  WRITER_AGENT_IDS.map((agentId) => `${agentId}-output-processor` as const)
);

/**
 * The one permitted V3 generation policy. The provider wrapper applies these
 * settings at the model method boundary, including Studio calls.
 */
export const V3_PRIVATE_STUDIO_POLICY = Object.freeze({
  mode: "local-private-studio" as const,
  host: "127.0.0.1" as const,
  studioHost: "127.0.0.1" as const,
  port: 4_111,
  allowedOrigins: Object.freeze([
    "http://127.0.0.1:4111",
    "http://localhost:4111"
  ] as const),
  customerExposureAllowed: false as const,
  customerAdaptersEnabled: false as const,
  directPrivateToolExecutionAllowed: false as const,
  toolPlaygroundMode: "one-use-granted-live-public-synthetic" as const,
  customerDataInToolPlayground: false as const,
  signedOrderHandoffInToolPlayground: false as const,
  persistCustomerInputs: false as const,
  observability: Object.freeze({
    enabled: true as const,
    store: "local-duckdb" as const,
    rawInputsPersisted: true as const,
    rawOutputsPersisted: true as const
  }),
  editor: Object.freeze({
    enabled: true as const,
    source: "code" as const,
    editableFields: Object.freeze(["tool-description"] as const),
    customerRuntimeOverrides: false as const
  }),
  memory: Object.freeze({
    enabled: true as const,
    scope: "thread" as const,
    store: "local-libsql" as const,
    lastMessages: 10 as const,
    semanticRecall: false as const,
    workingMemory: false as const,
    generateTitle: false as const,
    customerRuntimeMemory: false as const
  })
});

/**
 * Conversation continuity belongs to the deterministic control plane, not to
 * an LLM transcript. The runtime remembers only a short-lived, signed subject
 * and eligible route after response scoring and the audit commit succeed.
 * Writer agents intentionally remain stateless so remembered text can never be
 * treated as financial evidence.
 */
export const V3_CONVERSATION_MEMORY_POLICY = Object.freeze({
  type: "bounded-control-plane-context" as const,
  enabledByDefault: true as const,
  writerTranscriptMemory: false as const,
  storesRawMessages: false as const,
  storesFinancialFacts: false as const,
  commitAfterAudit: true as const,
  atomicConditionalUpdates: true as const,
  physicalExpiry: true as const,
  slidingExpiry: false as const,
  safetyBoundariesClearContext: true as const,
  maximumSymbols: 2 as const,
  defaultTtlMs: 5 * 60_000,
  defaultMaximumAssistedHops: 3 as const,
  internalPilotStorage: "process-local" as const,
  customerProductionStorageRequired: "encrypted-ha-ttl-store" as const
});

export const V3_REGISTRY_IDS = Object.freeze({
  agents: Object.freeze([
    ...WRITER_AGENT_IDS,
    V3_FINANCIAL_TASK_PLANNER_AGENT_ID
  ]),
  workflows: Object.freeze([...V3_WORKFLOW_IDS]),
  tools: Object.freeze([...V3_APPROVED_BOUNDARY_TOOL_IDS]),
  scorers: V3_SCORER_IDS
});

export const V3_REGISTRY_COUNTS = Object.freeze({
  agents: 4 as const,
  workflows: 5 as const,
  tools: 13 as const,
  scorers: 9 as const
});

export const V3_REGISTRY_MANIFEST = Object.freeze({
  schemaVersion: "assistant-v3.registry.v1" as const,
  ids: V3_REGISTRY_IDS,
  counts: V3_REGISTRY_COUNTS,
  model: V3_MODEL_POLICY,
  memory: V3_CONVERSATION_MEMORY_POLICY,
  studio: V3_PRIVATE_STUDIO_POLICY
});

export type V3RegistryWorkflowDependencies = Omit<V3WorkflowDependencies, "writers">;

export interface CreateV3MastraRegistryInput {
  boundaryDependencies: V3BoundaryToolDependencies;
  workflowDependencies: V3RegistryWorkflowDependencies;
  /** Durable in the application bootstrap; explicit memory storage is test-only. */
  storage?: MastraCompositeStore;
  logger?: IMastraLogger | false;
  observability?: ObservabilityEntrypoint;
  /** Private Studio only; customer runtime intentionally omits live overrides. */
  editor?: IMastraEditor;
  /** Private Studio only; customer workflow registries intentionally omit transcript memory. */
  memory?: MastraMemory;
  /** Private Studio only; loopback ingestion for the shared observability owner. */
  serverApiRoutes?: readonly ApiRoute[];
  /** Optional ambient value to validate. It never selects a different model. */
  configuredModel?: string;
  /** Optional ambient value to validate. It never selects a different model. */
  configuredEscalationModel?: string;
  /** Server-side credential; never returned in the registry manifest. */
  openaiApiKey?: string;
  /** Validated deployment identity used only in writer-facing instructions. */
  productName?: string;
}

export function assertV3ModelLock(
  configuredModel: string | undefined,
  configuredEscalationModel?: string
): void {
  const configured = configuredModel?.trim();
  if (configured !== undefined && configured !== "" && configured !== V3_OPENAI_MODEL_ID) {
    throw new Error(`V3 OpenAI model is locked to ${V3_OPENAI_MODEL_ID}.`);
  }
  const escalation = configuredEscalationModel?.trim();
  if (
    escalation !== undefined &&
    escalation !== "" &&
    escalation !== V3_OPENAI_ESCALATION_MODEL_ID
  ) {
    throw new Error(
      `V3 OpenAI escalation model is locked to ${V3_OPENAI_ESCALATION_MODEL_ID}.`
    );
  }
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

/**
 * Overrides caller-supplied generation settings at the model method boundary
 * so Studio and workflow calls share the same reviewed OpenAI policy.
 */
export function enforceLockedV3CallSettings(
  input: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const providerOptions = recordValue(input.providerOptions);
  const assistantOptions = recordValue(providerOptions["assistant-v3"]);
  const openaiOptions = recordValue(providerOptions.openai);
  const {
    reasoningEffort: _reasoningEffort,
    textVerbosity: _textVerbosity,
    ...supportedOpenAIOptions
  } = openaiOptions;
  return {
    ...input,
    temperature: V3_MODEL_POLICY.temperature,
    maxOutputTokens: assistantOptions.modelTier === "escalation"
      ? V3_MODEL_POLICY.escalationMaxOutputTokens
      : V3_MODEL_POLICY.maxOutputTokens,
    providerOptions: {
      ...providerOptions,
      openai: {
        ...supportedOpenAIOptions,
        store: V3_MODEL_POLICY.store
      }
    }
  };
}

export function v3ModelIdForCall(
  input: Readonly<Record<string, unknown>>
): V3OpenAIModelId {
  const providerOptions = recordValue(input.providerOptions);
  const assistantOptions = recordValue(providerOptions["assistant-v3"]);
  return assistantOptions.modelTier === "escalation"
    ? V3_OPENAI_ESCALATION_MODEL_ID
    : V3_OPENAI_PRIMARY_MODEL_ID;
}

interface V3DirectToolDispatch {
  readonly calls: readonly V3DirectToolCall[];
  readonly unavailable: boolean;
}

interface V3DirectToolCall {
  readonly toolName: V3DirectRenderableToolId;
  readonly args: Readonly<Record<string, unknown>>;
  readonly toolCallId: string;
}

function modelPromptText(value: unknown, depth = 0): string {
  if (depth > 6) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => modelPromptText(item, depth + 1)).join(" ");
  if (typeof value !== "object" || value === null) return "";
  const record = value as Readonly<Record<string, unknown>>;
  if (record.type === "text" && typeof record.text === "string") return record.text;
  return modelPromptText(record.content, depth + 1);
}

function currentModelUserMessage(prompt: unknown): string {
  if (!Array.isArray(prompt)) return "";
  const latest = [...prompt].reverse().find((message) =>
    typeof message === "object" && message !== null &&
    (message as Readonly<Record<string, unknown>>).role === "user"
  );
  return modelPromptText(latest).normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function directTurnQuery(input: Readonly<Record<string, unknown>>): string {
  const providerOptions = recordValue(input.providerOptions);
  const marker = recordValue(providerOptions["assistant-v3"]);
  if (
    (marker.directEvidenceDispatch === true ||
      marker.directEvidenceContinuation === true) &&
    typeof marker.currentUserMessage === "string"
  ) {
    return marker.currentUserMessage
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim();
  }
  if (!Array.isArray(input.prompt)) return "";
  const userMessageCount = input.prompt.filter((message) =>
    typeof message === "object" && message !== null &&
    (message as Readonly<Record<string, unknown>>).role === "user"
  ).length;
  // A single-message model call has no recalled subject to confuse with the
  // current turn. Multi-turn Studio calls must carry the server-derived marker
  // above; raw transcript scanning is deliberately forbidden there.
  return userMessageCount === 1 ? currentModelUserMessage(input.prompt) : "";
}

function historyRange(query: string): "1d" | "1w" | "1m" | "6m" | "1y" | "5y" | "10y" | "max" {
  const normalized = query.toLocaleLowerCase("en-US");
  if (/\b(?:max|all[ -]?time|maximum)\b|(?:bütün\s+dövr|hamısı)/u.test(normalized)) return "max";
  if (/\b(?:10\s*(?:y|yr|yrs|years?)|ten\s+years?)\b|10\s*il/u.test(normalized)) return "10y";
  if (/\b(?:5\s*(?:y|yr|yrs|years?)|five\s+years?)\b|5\s*il/u.test(normalized)) return "5y";
  if (/\b(?:6\s*(?:m|mo|mos|months?)|six\s+months?)\b|6\s*ay/u.test(normalized)) return "6m";
  if (/\b(?:1\s*(?:y|yr|year)|one\s+year|yearly)\b|(?:1\s*il|illik)/u.test(normalized)) return "1y";
  if (/\b(?:1\s*(?:m|mo|month)|one\s+month|monthly)\b|(?:1\s*ay|aylıq)/u.test(normalized)) return "1m";
  if (/\b(?:1\s*(?:w|wk|week)|one\s+week|weekly)\b|(?:1\s*həftə|həftəlik)/u.test(normalized)) return "1w";
  if (/\b(?:1\s*(?:d|day)|one\s+day|today|daily)\b|(?:1\s*gün|bu\s+gün|günlük)/u.test(normalized)) return "1d";
  return "1y";
}

function recentActivityArguments(query: string): Readonly<Record<string, unknown>> | null {
  const period = [...query.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/gu)]
    .map((match) => match[0]);
  if (period.length === 2 && Date.parse(period[0]!) <= Date.parse(period[1]!)) {
    return {
      queryType: "period-ledger",
      periodStart: period[0],
      periodEnd: period[1]
    };
  }

  const normalized = query.toLocaleLowerCase("en-US");
  const mentionsOrder = /\borders?\b|sifariş/u.test(normalized);
  const mentionsExecution = /\b(?:executions?|transactions?|trades?|bought|sold|purchases?)\b|(?:əməliyyat|ticarət|alış|satış)/u
    .test(normalized);
  const mentionsUnsupportedLedger = /\b(?:dividends?|fees?|cash\s*flows?|commissions?)\b|(?:dividend|komissiya|nağd\s*axın)/u
    .test(normalized);
  const mentionsGenericRecent = /\b(?:recent|activity|history)\b|(?:son\s+fəaliyyət|fəaliyyət|tarixçə)/u
    .test(normalized);
  if (
    !mentionsOrder && !mentionsExecution &&
    (!mentionsGenericRecent || mentionsUnsupportedLedger)
  ) return null;

  const requestedLimit = normalized.match(/\b(?:last|latest|son)\s+(\d{1,2})\b/u)?.[1];
  const limit = requestedLimit === undefined ? 10 : Number.parseInt(requestedLimit, 10);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) return null;

  const args: Record<string, unknown> = {
    queryType: "recent-trading",
    limit,
    include: mentionsOrder && !mentionsExecution
      ? "orders"
      : mentionsExecution && !mentionsOrder
        ? "executions"
        : "all"
  };
  const symbols = v3DirectTickerCandidates(query);
  if (symbols.length > 1) return null;
  if (symbols[0] !== undefined) args.symbol = symbols[0];
  const buy = /\b(?:buy|bought|purchase|purchased)\b|(?:alış|alınmış)/u.test(normalized);
  const sell = /\b(?:sell|sold|sale)\b|(?:satış|satılmış)/u.test(normalized);
  if (buy !== sell) args.side = buy ? "BUY" : "SELL";
  return args;
}

function currencyConversionArguments(
  query: string
): Readonly<Record<string, unknown>> | null {
  const normalized = query.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const targetCurrency = v3DirectTargetCurrency(normalized);
  if (targetCurrency === null) return null;

  const amountMatch =
    /\b(USD|AZN)\s+(\d+(?:[.,]\d{1,8})?)\b/iu.exec(normalized) ??
    /\b(\d+(?:[.,]\d{1,8})?)\s*(USD|AZN)\b/iu.exec(normalized);
  if (amountMatch !== null) {
    const currencyFirst = /^(?:USD|AZN)$/iu.test(amountMatch[1] ?? "");
    const sourceCurrency = (
      currencyFirst ? amountMatch[1] : amountMatch[2]
    )?.toLocaleUpperCase("en-US");
    const rawAmount = currencyFirst ? amountMatch[2] : amountMatch[1];
    if (
      (sourceCurrency !== "USD" && sourceCurrency !== "AZN") ||
      rawAmount === undefined
    ) {
      return null;
    }
    try {
      return {
        scope: "provided-amount",
        amount: decimal(rawAmount.replace(",", ".")),
        sourceCurrency,
        targetCurrency
      };
    } catch {
      return null;
    }
  }

  const symbol = v3ExactDirectTicker(normalized);
  if (
    symbol !== null &&
    /\b(?:current|latest|now|price|quote|worth|cost)\b|(?:cari|hazırkı|son\s+qiymət|qiyməti)/iu
      .test(normalized)
  ) {
    return {
      scope: "current-market-price",
      symbol,
      targetCurrency
    };
  }

  if (
    /\b(?:portfolio|holdings?|portfolio\s+value|it|that|value|amount)\b|(?<!\p{L})(?:portfel\p{L}*|onu|bunu|d[əe]y[əe]ri|m[əe]bl[əe][ğg]i)(?!\p{L})/iu
      .test(normalized)
  ) {
    return {
      scope: "current-portfolio-value",
      targetCurrency
    };
  }
  return null;
}

/**
 * Deterministically converts a one-tool Studio turn into reviewed boundary
 * arguments. It intentionally rejects comparisons, missing tickers, and
 * activity scopes that cannot be represented by a bounded tool contract.
 */
export function deriveV3DirectToolArguments(
  toolName: V3DirectRenderableToolId,
  query: string
): Readonly<Record<string, unknown>> | null {
  const normalized = query.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return null;
  if (toolName === "retrieve-approved-product-knowledge") {
    return normalized.length <= 2_000 ? { query: normalized } : null;
  }
  if (toolName === "retrieve-reviewed-investment-education") {
    const educationQuery = normalizeFinancialEducationQuery(normalized);
    return educationQuery === null ? null : { query: educationQuery };
  }
  if (toolName === "convert-currency") {
    return currencyConversionArguments(normalized);
  }
  if (toolName === "analyze-portfolio-allocation") {
    return deriveV3DirectPortfolioAllocationArguments(normalized);
  }
  if (toolName === "read-portfolio-snapshot") return {};
  if (toolName === "read-portfolio-activity") return recentActivityArguments(normalized);
  const symbol = v3ExactDirectTicker(normalized);
  if (symbol === null) return null;
  if (toolName === "read-price-history") {
    return { symbol, range: historyRange(normalized) };
  }
  return { symbol };
}

export function deriveV3DirectToolPlan(
  toolName: V3DirectRenderableToolId,
  query: string
): readonly Readonly<Record<string, unknown>>[] | null {
  const normalized = query.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (toolName === "read-instrument-research") {
    const symbols = v3DirectResearchComparisonSymbols(normalized);
    if (symbols !== null) {
      return Object.freeze(
        symbols.map((symbol) => Object.freeze({ symbol }))
      );
    }
  }
  const args = deriveV3DirectToolArguments(toolName, normalized);
  return args === null ? null : Object.freeze([args]);
}

function deterministicDirectDispatch(input: Readonly<Record<string, unknown>>): V3DirectToolDispatch | null {
  const toolChoice = recordValue(input.toolChoice);
  if (toolChoice.type !== "required" && toolChoice.type !== "tool") return null;
  if (!Array.isArray(input.tools)) return null;
  const availableTools = input.tools
    .map((tool) => recordValue(tool))
    .filter((tool) =>
      tool.type === "function" &&
      typeof tool.name === "string" &&
      (V3_DIRECT_RENDERABLE_TOOL_IDS as readonly string[]).includes(tool.name)
    );
  const tool = toolChoice.type === "tool"
    ? availableTools.find(({ name }) => name === toolChoice.toolName)
    : availableTools.length === 1
      ? availableTools[0]
      : undefined;
  if (tool === undefined) return null;
  if (tool.type !== "function" || typeof tool.name !== "string") return null;
  const toolName = tool.name as V3DirectRenderableToolId;
  const query = directTurnQuery(input);
  const plan = deriveV3DirectToolPlan(toolName, query);
  if (plan === null) return { calls: Object.freeze([]), unavailable: true };
  const calls = plan.map((args, index) => {
    const digest = canonicalHash({ toolName, args, query, index })
      .slice("sha256:".length, "sha256:".length + 24);
    return Object.freeze({
      toolName,
      args,
      toolCallId: `v3-direct-${digest}`
    });
  });
  return {
    calls: Object.freeze(calls),
    unavailable: false
  };
}

function directContinuationToolNames(
  input: Readonly<Record<string, unknown>>
): readonly V3DirectRenderableToolId[] | null {
  const toolChoice = recordValue(input.toolChoice);
  const providerOptions = recordValue(input.providerOptions);
  const marker = recordValue(providerOptions["assistant-v3"]);
  if (toolChoice.type !== "none" || marker.directEvidenceContinuation !== true) {
    return null;
  }
  const query = directTurnQuery(input);
  if (
    query.length === 0 ||
    !Array.isArray(input.prompt)
  ) {
    return null;
  }
  const currentUserIndex = input.prompt.findLastIndex((message) => {
    if (typeof message !== "object" || message === null) return false;
    const role = (message as Readonly<Record<string, unknown>>).role;
    return (role === "user" || role === "signal") &&
      modelPromptText(message).normalize("NFKC").replace(/\s+/gu, " ").trim() === query;
  });
  if (currentUserIndex < 0) return null;

  const calls = new Map<string, V3DirectRenderableToolId>();
  const results = new Set<string>();
  for (const message of input.prompt.slice(currentUserIndex + 1)) {
    if (typeof message !== "object" || message === null) continue;
    const content = (message as Readonly<Record<string, unknown>>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const value = recordValue(part);
      if (
        value.type === "tool-call" &&
        typeof value.toolCallId === "string" &&
        value.toolCallId.startsWith("v3-direct-") &&
        typeof value.toolName === "string" &&
        (V3_DIRECT_RENDERABLE_TOOL_IDS as readonly string[]).includes(value.toolName)
      ) {
        calls.set(
          value.toolCallId,
          value.toolName as V3DirectRenderableToolId
        );
      }
      if (
        value.type === "tool-result" &&
        typeof value.toolCallId === "string" &&
        typeof value.toolName === "string" &&
        calls.get(value.toolCallId) === value.toolName
      ) {
        results.add(value.toolCallId);
      }
    }
  }
  if (calls.size < 1 || calls.size > 2 || results.size !== calls.size) {
    return null;
  }
  return Object.freeze([...calls.values()]);
}

function isMarkedDirectContinuation(
  input: Readonly<Record<string, unknown>>
): boolean {
  const providerOptions = recordValue(input.providerOptions);
  return recordValue(providerOptions["assistant-v3"]).directEvidenceContinuation === true;
}

const DIRECT_NATURALIZATION_SYSTEM_PROMPT = `
You are the conversational phrasing stage for a verified financial assistant.
Verified values are hidden from you and will be inserted after validation.
You receive semantic placeholders. Use every required placeholder exactly once and do not invent any placeholder.
Compose a concise, natural answer in the requested language. You may reorder placeholders and connect them into readable sentences.
Treat each placeholder as a complete verified phrase. Every factual clause must be represented by a placeholder.
Do not copy a value from the user request or add any fact, number, date, URL, price, percentage, source, calculation, conclusion, recommendation, prediction, or investment opinion.
Do not use headings, bullets, Markdown, quotation marks, or code fences.
Keep the template to at most six short sentences.
Safe connecting language includes: I checked the relevant evidence; according to the verified data; here is what I found; if you want, I can explain a specific part.
Safe Azerbaijani connecting language includes: Müvafiq sübutu yoxladım; təsdiqlənmiş məlumata əsasən; tapdığım budur; istəsəniz, konkret hissəni izah edə bilərəm.
`.trim();

type DirectSpeechAct =
  | "comparison"
  | "explanation"
  | "history"
  | "portfolio-summary"
  | "policy-explanation"
  | "factual-lookup";

function directNaturalizationSpeechAct(
  query: string,
  toolNames: readonly V3DirectRenderableToolId[]
): DirectSpeechAct {
  if (toolNames.length > 1) return "comparison";
  switch (toolNames[0]) {
    case "read-price-history":
      return "history";
    case "convert-currency":
      return /\b(?:current|latest|now|price|quote|worth|cost)\b|(?:cari|hazırkı|son\s+qiymət|qiyməti)/iu
        .test(query)
        ? "factual-lookup"
        : "portfolio-summary";
    case "read-portfolio-snapshot":
    case "analyze-portfolio-allocation":
    case "read-portfolio-activity":
      return "portfolio-summary";
    case "retrieve-approved-product-knowledge":
      return "policy-explanation";
    case "retrieve-reviewed-investment-education":
      return "explanation";
    default:
      return /\b(?:explain|analyse|analyze|overview|risk|why|how)\b|(?:izah|təhlil|niyə|necə|risk)/iu
        .test(query)
        ? "explanation"
        : "factual-lookup";
  }
}

function directNaturalizationLocale(query: string): "en-US" | "az-AZ" {
  return detectV3Locale(query);
}

function directNaturalizationCall(
  input: Readonly<Record<string, unknown>>,
  toolNames: readonly V3DirectRenderableToolId[]
): Record<string, unknown> {
  const query = directTurnQuery(input);
  const locale = directNaturalizationLocale(query);
  const speechAct = directNaturalizationSpeechAct(query, toolNames);
  const slots = v3DirectSemanticSlotCatalog(toolNames);
  const semantics = slots
    .map((slot) =>
      `{{${slot.alias}}} (${slot.required ? "required" : "optional"}): ${slot.meaning}`
    )
    .join("\n");
  return {
    ...input,
    prompt: [
      {
        role: "system",
        content: DIRECT_NATURALIZATION_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: [{
          type: "text",
          text: [
            `Locale: ${locale}`,
            `Speech act: ${speechAct}`,
            "Semantic placeholders:",
            semantics,
            "Write the conversational template now."
          ].join("\n")
        }]
      }
    ],
    tools: [],
    toolChoice: { type: "none" },
    // The provider must never receive a previous response identifier for a
    // direct naturalization call because that could recover the raw tool turn.
    providerOptions: {
      "assistant-v3": {
        modelTier: speechAct === "comparison" ? "escalation" : "primary",
        selectionReasonCode:
          speechAct === "comparison"
            ? "comparison_requires_instruction_fidelity"
            : "primary_default"
      },
      openai: {
        ...recordValue(recordValue(input.providerOptions).openai),
        previousResponseId: undefined
      }
    }
  };
}

function isUnavailableDispatch(dispatch: V3DirectToolDispatch): boolean {
  return dispatch.unavailable;
}

function directUnavailableText(query: string): string {
  return /[əğıöşüç]/iu.test(query)
    ? "Bu sorğu üçün təhlükəsiz alət arqumentlərini müəyyən edə bilmədim, ona görə faktiki cavab verməyəcəyəm. Zəhmət olmasa bir dəqiq ticker və ya daha konkret sorğu yazın."
    : "I couldn't derive safe tool arguments for this request, so I won't provide a factual answer. Please include one exact ticker or a more specific request.";
}

function zeroV4Usage() {
  return {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    outputTokens: {
      total: 0,
      text: 0,
      reasoning: 0
    }
  };
}

function v4FinishReason(unified: "stop" | "tool-calls") {
  return { unified, raw: undefined };
}

function deterministicGenerateResponse(dispatch: V3DirectToolDispatch, query: string) {
  if (isUnavailableDispatch(dispatch)) {
    return {
      content: [{ type: "text" as const, text: directUnavailableText(query) }],
      finishReason: v4FinishReason("stop"),
      usage: zeroV4Usage(),
      warnings: []
    };
  }
  return {
    content: dispatch.calls.map((call) => ({
      type: "tool-call" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: JSON.stringify(call.args)
    })),
    finishReason: v4FinishReason("tool-calls"),
    usage: zeroV4Usage(),
    warnings: []
  };
}

function deterministicStreamResponse(dispatch: V3DirectToolDispatch, query: string) {
  const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
  if (isUnavailableDispatch(dispatch)) {
    const id = "v3-direct-unavailable-text";
    parts.push(
      { type: "text-start", id },
      { type: "text-delta", id, delta: directUnavailableText(query) },
      { type: "text-end", id },
      {
        type: "finish",
        finishReason: v4FinishReason("stop"),
        usage: zeroV4Usage()
      }
    );
  } else {
    for (const call of dispatch.calls) {
      const toolInput = JSON.stringify(call.args);
      parts.push(
        { type: "tool-input-start", id: call.toolCallId, toolName: call.toolName },
        { type: "tool-input-delta", id: call.toolCallId, delta: toolInput },
        { type: "tool-input-end", id: call.toolCallId },
        {
          type: "tool-call",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: toolInput
        }
      );
    }
    parts.push({
      type: "finish",
      finishReason: v4FinishReason("tool-calls"),
      usage: zeroV4Usage()
    });
  }
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      }
    })
  };
}

function deterministicContinuationFallbackGenerateResponse() {
  return {
    content: [{ type: "text" as const, text: "Verified tool evidence received." }],
    finishReason: v4FinishReason("stop"),
    usage: zeroV4Usage(),
    warnings: []
  };
}

function deterministicContinuationFallbackStreamResponse() {
  const id = "v3-direct-evidence-continuation";
  const parts = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id },
    { type: "text-delta", id, delta: "Verified tool evidence received." },
    { type: "text-end", id },
    {
      type: "finish",
      finishReason: v4FinishReason("stop"),
      usage: zeroV4Usage()
    }
  ];
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      }
    })
  };
}

export function createLockedV3OpenAIModel(input: {
  configuredModel?: string;
  configuredEscalationModel?: string;
  apiKey?: string;
  /** Test/transport injection; it cannot change the locked request settings. */
  fetch?: OpenAIProviderSettings["fetch"];
} = {}): MastraModelConfig {
  assertV3ModelLock(
    input.configuredModel,
    input.configuredEscalationModel
  );
  const provider = createOpenAI({
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(input.fetch === undefined ? {} : { fetch: input.fetch })
  });
  const model = provider.responses(V3_OPENAI_PRIMARY_MODEL_ID);
  const escalationModel = provider.responses(V3_OPENAI_ESCALATION_MODEL_ID);
  const primaryGenerate = model.doGenerate.bind(model);
  const primaryStream = model.doStream.bind(model);
  const escalationGenerate = escalationModel.doGenerate.bind(escalationModel);
  const escalationStream = escalationModel.doStream.bind(escalationModel);
  const generateFor = (options: Readonly<Record<string, unknown>>) =>
    v3ModelIdForCall(options) === V3_OPENAI_ESCALATION_MODEL_ID
      ? escalationGenerate
      : primaryGenerate;
  const streamFor = (options: Readonly<Record<string, unknown>>) =>
    v3ModelIdForCall(options) === V3_OPENAI_ESCALATION_MODEL_ID
      ? escalationStream
      : primaryStream;
  model.doGenerate = (options) => {
    const locked = enforceLockedV3CallSettings(
      options as unknown as Readonly<Record<string, unknown>>
    ) as unknown as typeof options;
    const lockedRecord = locked as unknown as Readonly<Record<string, unknown>>;
    const continuationTools = directContinuationToolNames(lockedRecord);
    if (continuationTools !== null) {
      const naturalization = enforceLockedV3CallSettings(
        directNaturalizationCall(lockedRecord, continuationTools)
      ) as unknown as typeof options;
      const naturalizationGenerate = generateFor(
        naturalization as unknown as Readonly<Record<string, unknown>>
      );
      return Promise.resolve(naturalizationGenerate(naturalization)).catch(() =>
        deterministicContinuationFallbackGenerateResponse()
      );
    }
    if (isMarkedDirectContinuation(lockedRecord)) {
      return Promise.resolve(deterministicContinuationFallbackGenerateResponse());
    }
    const dispatch = deterministicDirectDispatch(
      lockedRecord
    );
    if (dispatch !== null) {
      const query = directTurnQuery(
        locked as unknown as Readonly<Record<string, unknown>>
      );
      return Promise.resolve(deterministicGenerateResponse(dispatch, query));
    }
    return generateFor(lockedRecord)(locked);
  };
  model.doStream = (options) => {
    const locked = enforceLockedV3CallSettings(
      options as unknown as Readonly<Record<string, unknown>>
    ) as unknown as typeof options;
    const lockedRecord = locked as unknown as Readonly<Record<string, unknown>>;
    const continuationTools = directContinuationToolNames(lockedRecord);
    if (continuationTools !== null) {
      const naturalization = enforceLockedV3CallSettings(
        directNaturalizationCall(lockedRecord, continuationTools)
      ) as unknown as typeof options;
      const naturalizationStream = streamFor(
        naturalization as unknown as Readonly<Record<string, unknown>>
      );
      return Promise.resolve(naturalizationStream(naturalization)).catch(() =>
        deterministicContinuationFallbackStreamResponse()
      );
    }
    if (isMarkedDirectContinuation(lockedRecord)) {
      return Promise.resolve(deterministicContinuationFallbackStreamResponse());
    }
    const dispatch = deterministicDirectDispatch(
      lockedRecord
    );
    if (dispatch !== null) {
      const query = directTurnQuery(
        locked as unknown as Readonly<Record<string, unknown>>
      );
      return Promise.resolve(deterministicStreamResponse(dispatch, query));
    }
    return streamFor(lockedRecord)(locked);
  };
  return model;
}

function assertExactIds(
  kind: "agents" | "workflows" | "tools" | "scorers",
  actual: readonly string[],
  expected: readonly string[]
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `V3 ${kind} registry drift: expected ${expected.join(", ")}; received ${actual.join(", ")}.`
    );
  }
}

export function assertExactV3Topology(input: {
  agents: Readonly<Record<string, unknown>>;
  workflows: Readonly<Record<string, unknown>>;
  tools: Readonly<Record<string, unknown>>;
  scorers?: Readonly<Record<string, unknown>>;
}): void {
  assertExactIds("agents", Object.keys(input.agents), V3_REGISTRY_IDS.agents);
  assertExactIds("workflows", Object.keys(input.workflows), V3_REGISTRY_IDS.workflows);
  assertExactIds("tools", Object.keys(input.tools), V3_REGISTRY_IDS.tools);
  if (input.scorers !== undefined) {
    assertExactIds("scorers", Object.keys(input.scorers), V3_REGISTRY_IDS.scorers);
  }
}

/**
 * Creates the Studio-visible V3 topology. It intentionally accepts ports and
 * workflow callbacks rather than constructing customer-facing runtime/API
 * dependencies. The local bootstrap supplies a grant-gated public/synthetic
 * tool playground while keeping customer workflow authority fail closed.
 */
export function createV3MastraRegistry(input: CreateV3MastraRegistryInput) {
  const model = createLockedV3OpenAIModel({
    ...(input.configuredModel === undefined ? {} : { configuredModel: input.configuredModel }),
    ...(input.configuredEscalationModel === undefined
      ? {}
      : { configuredEscalationModel: input.configuredEscalationModel }),
    ...(input.openaiApiKey === undefined ? {} : { apiKey: input.openaiApiKey })
  });
  const boundaryTools = createV3BoundaryTools(input.boundaryDependencies);
  // createTool() has richer conditional types than Agent's generic tool map in
  // Mastra 1.51+. Every V3 boundary entry is a concrete executable tool.
  const registeredTools = boundaryTools as unknown as Record<
    string,
    ToolAction<any, any, any, any, any, any, unknown>
  >;
  const directGroundingScorer = createV3DirectAgentToolGroundingScorer({
    signer: input.boundaryDependencies.signer
  });
  const responseScorers = createV3MastraResponseScorers({
    signer: input.boundaryDependencies.signer
  });
  const scorers = Object.freeze({
    ...responseScorers,
    [directGroundingScorer.id]: directGroundingScorer
  });
  const writers = createWriterAgents(
    model,
    registeredTools,
    input.boundaryDependencies.signer,
    directGroundingScorer,
    input.memory,
    input.productName
  );
  const financialTaskPlannerAgent = createV3FinancialTaskPlannerAgent(model);
  const financialTaskPlanner = new V3FinancialTaskPlanner({
    agent: financialTaskPlannerAgent as unknown as V3FinancialTaskPlannerAgentPort,
    timeoutMs: input.workflowDependencies.modelTimeoutMs
  });
  const createdWorkflows = createAssistantV3Workflows({
    ...input.workflowDependencies,
    writers
  });

  const agents = Object.freeze({
    "public-research-writer": writers.publicResearchWriter,
    "portfolio-insight-writer": writers.portfolioInsightWriter,
    "approved-knowledge-writer": writers.approvedKnowledgeWriter,
    [V3_FINANCIAL_TASK_PLANNER_AGENT_ID]: financialTaskPlannerAgent
  });
  const workflows = Object.freeze({
    "assistant-request-v3": createdWorkflows.assistantRequest,
    "public-research-v3": createdWorkflows.publicResearch,
    "portfolio-insight-v3": createdWorkflows.portfolioInsight,
    "approved-knowledge-v3": createdWorkflows.approvedKnowledge,
    "order-ticket-handoff-v3": createdWorkflows.orderTicketHandoff
  });

  assertExactV3Topology({ agents, workflows, tools: boundaryTools, scorers });

  const mastra = new Mastra({
    agents,
    workflows,
    tools: registeredTools,
    scorers,
    storage: input.storage ?? new InMemoryStore({ id: "assistant-v3-test-storage" }),
    logger: input.logger ?? false,
    ...(input.observability === undefined ? {} : { observability: input.observability }),
    ...(input.editor === undefined ? {} : { editor: input.editor }),
    environment: "development",
    server: {
      port: V3_PRIVATE_STUDIO_POLICY.port,
      host: V3_PRIVATE_STUDIO_POLICY.host,
      studioHost: V3_PRIVATE_STUDIO_POLICY.studioHost,
      cors: {
        origin: [...V3_PRIVATE_STUDIO_POLICY.allowedOrigins],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "x-mastra-client-type",
          "x-mastra-dev-playground"
        ],
        credentials: false
      },
      ...(input.serverApiRoutes === undefined
        ? {}
        : { apiRoutes: [...input.serverApiRoutes] })
    }
  });

  return Object.freeze({
    mastra,
    model,
    agents,
    financialTaskPlanner,
    workflows,
    tools: boundaryTools,
    scorers,
    manifest: V3_REGISTRY_MANIFEST
  });
}

export type V3MastraRegistry = ReturnType<typeof createV3MastraRegistry>;
