import { z } from "zod";

import type { SupportedLocale } from "./contracts.js";

export const V3_SHADOW_EVALUATOR_MODEL = "gpt-4.1" as const;
export const V3_SHADOW_EVALUATOR_SCHEMA_VERSION =
  "assistant-v3.shadow-evaluation.v1" as const;

const MAX_REQUEST_LENGTH = 2_000;
const MAX_SUMMARY_LENGTH = 6_000;
const MAX_EXPECTATION_COUNT = 12;
const MAX_EXPECTATION_LENGTH = 500;
const DEFAULT_TIMEOUT_MS = 20_000;

const binaryScore = z.union([z.literal(0), z.literal(1)]);

export const v3ShadowEvaluationResultSchema = z.object({
  schemaVersion: z.literal(V3_SHADOW_EVALUATOR_SCHEMA_VERSION),
  verdict: z.enum(["pass", "review", "fail"]),
  scores: z.object({
    intentFulfillment: binaryScore,
    parameterFidelity: binaryScore,
    contradictionFree: binaryScore,
    timeframeFulfillment: binaryScore,
    localeAdherence: binaryScore,
    visibleProvenance: binaryScore,
    safeUnsupportedHandling: binaryScore
  }).strict(),
  riskCodes: z.array(z.enum([
    "intent_not_fulfilled",
    "parameter_mismatch",
    "action_contradiction",
    "timeframe_not_fulfilled",
    "locale_mismatch",
    "provenance_not_visible",
    "unsafe_unsupported_handling",
    "none"
  ])).min(1).max(8),
  rationale: z.string().min(1).max(800)
}).strict();

export type V3ShadowEvaluationResult = z.infer<
  typeof v3ShadowEvaluationResultSchema
>;

export interface V3SyntheticShadowEvaluationCase {
  /**
   * The shadow evaluator is deliberately restricted to synthetic test data.
   * Customer-private requests, portfolio facts, identifiers, and credentials
   * must never be sent to this external judge.
   */
  readonly dataClass: "synthetic";
  readonly scenarioId: string;
  readonly locale: SupportedLocale;
  readonly request: string;
  readonly routeSummary: string;
  readonly responseSummary: string;
  readonly expectedBehaviors: readonly string[];
}

export interface V3ShadowEvaluationClient {
  evaluate(
    input: V3SyntheticShadowEvaluationCase
  ): Promise<V3ShadowEvaluationResult>;
}

export interface OpenAIV3ShadowEvaluatorOptions {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly endpoint?: string;
}

interface OpenAIResponseBody {
  readonly status?: unknown;
  readonly error?: unknown;
  readonly output?: unknown;
}

function boundedText(value: string, maximum: number, field: string): string {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`${field} must contain between 1 and ${maximum} characters.`);
  }
  return normalized;
}

function normalizeCase(
  input: V3SyntheticShadowEvaluationCase
): V3SyntheticShadowEvaluationCase {
  if (input.dataClass !== "synthetic") {
    throw new Error("The external shadow evaluator accepts synthetic data only.");
  }
  if (
    input.expectedBehaviors.length === 0 ||
    input.expectedBehaviors.length > MAX_EXPECTATION_COUNT
  ) {
    throw new Error(
      `expectedBehaviors must contain between 1 and ${MAX_EXPECTATION_COUNT} items.`
    );
  }
  return {
    dataClass: "synthetic",
    scenarioId: boundedText(input.scenarioId, 120, "scenarioId"),
    locale: input.locale,
    request: boundedText(input.request, MAX_REQUEST_LENGTH, "request"),
    routeSummary: boundedText(
      input.routeSummary,
      MAX_SUMMARY_LENGTH,
      "routeSummary"
    ),
    responseSummary: boundedText(
      input.responseSummary,
      MAX_SUMMARY_LENGTH,
      "responseSummary"
    ),
    expectedBehaviors: input.expectedBehaviors.map((behavior, index) =>
      boundedText(
        behavior,
        MAX_EXPECTATION_LENGTH,
        `expectedBehaviors[${index}]`
      )
    )
  };
}

function outputText(body: OpenAIResponseBody): string | null {
  if (!Array.isArray(body.output)) return null;
  for (const item of body.output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

const RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "verdict", "scores", "riskCodes", "rationale"],
  properties: {
    schemaVersion: {
      type: "string",
      const: V3_SHADOW_EVALUATOR_SCHEMA_VERSION
    },
    verdict: {
      type: "string",
      enum: ["pass", "review", "fail"]
    },
    scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "intentFulfillment",
        "parameterFidelity",
        "contradictionFree",
        "timeframeFulfillment",
        "localeAdherence",
        "visibleProvenance",
        "safeUnsupportedHandling"
      ],
      properties: {
        intentFulfillment: { type: "integer", enum: [0, 1] },
        parameterFidelity: { type: "integer", enum: [0, 1] },
        contradictionFree: { type: "integer", enum: [0, 1] },
        timeframeFulfillment: { type: "integer", enum: [0, 1] },
        localeAdherence: { type: "integer", enum: [0, 1] },
        visibleProvenance: { type: "integer", enum: [0, 1] },
        safeUnsupportedHandling: { type: "integer", enum: [0, 1] }
      }
    },
    riskCodes: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "string",
        enum: [
          "intent_not_fulfilled",
          "parameter_mismatch",
          "action_contradiction",
          "timeframe_not_fulfilled",
          "locale_mismatch",
          "provenance_not_visible",
          "unsafe_unsupported_handling",
          "none"
        ]
      }
    },
    rationale: {
      type: "string",
      minLength: 1,
      maxLength: 800
    }
  }
} as const;

export function createOpenAIV3ShadowEvaluator(
  options: OpenAIV3ShadowEvaluatorOptions
): V3ShadowEvaluationClient {
  const apiKey = options.apiKey.trim();
  if (apiKey.length === 0) {
    throw new Error("An OpenAI API key is required for the shadow evaluator.");
  }
  const request = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? "https://api.openai.com/v1/responses";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new Error("Shadow evaluator timeout must be between 1000 and 60000 ms.");
  }

  return {
    async evaluate(rawInput): Promise<V3ShadowEvaluationResult> {
      const input = normalizeCase(rawInput);
      const response = await request(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: V3_SHADOW_EVALUATOR_MODEL,
          store: false,
          max_output_tokens: 800,
          instructions: [
            "You are a strict financial-assistant quality evaluator.",
            "Judge only the supplied synthetic test case.",
            "A response fails if it reverses or changes a requested financial action, amount, symbol, order type, date range, or locale.",
            "Unsupported requests pass safeUnsupportedHandling only when the answer clearly refuses or asks for the exact missing input.",
            "Do not award visibleProvenance for hidden metadata; the response summary must visibly name source or as-of context when a factual answer requires it.",
            "Use riskCodes=['none'] only when verdict='pass'. Keep rationale concise and do not add facts."
          ].join(" "),
          input: JSON.stringify(input),
          text: {
            format: {
              type: "json_schema",
              name: "assistant_v3_shadow_evaluation",
              strict: true,
              schema: RESULT_JSON_SCHEMA
            }
          }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`OpenAI shadow evaluation failed with HTTP ${response.status}.`);
      }
      const body = await response.json() as OpenAIResponseBody;
      if (body.status !== "completed") {
        throw new Error("OpenAI shadow evaluation did not complete.");
      }
      const text = outputText(body);
      if (text === null) {
        throw new Error("OpenAI shadow evaluation returned no structured output.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("OpenAI shadow evaluation returned invalid JSON.");
      }
      const result = v3ShadowEvaluationResultSchema.parse(parsed);
      if (
        (result.verdict === "pass") !==
          (result.riskCodes.length === 1 && result.riskCodes[0] === "none")
      ) {
        throw new Error("OpenAI shadow evaluation verdict and risk codes disagree.");
      }
      return result;
    }
  };
}
