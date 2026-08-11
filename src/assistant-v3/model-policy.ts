export const V3_OPENAI_PRIMARY_MODEL_ID = "gpt-4o" as const;
export const V3_OPENAI_ESCALATION_MODEL_ID = "gpt-4.1" as const;
/** Backward-compatible name for the default model exposed by each agent. */
export const V3_OPENAI_MODEL_ID = V3_OPENAI_PRIMARY_MODEL_ID;
export const V3_OPENAI_MODEL_IDS = Object.freeze([
  V3_OPENAI_PRIMARY_MODEL_ID,
  V3_OPENAI_ESCALATION_MODEL_ID
] as const);

export type V3OpenAIModelId = (typeof V3_OPENAI_MODEL_IDS)[number];
export type V3ModelTier = "primary" | "escalation";

export const V3_MODEL_POLICY = Object.freeze({
  provider: "openai" as const,
  endpoint: "responses" as const,
  modelId: V3_OPENAI_PRIMARY_MODEL_ID,
  primaryModelId: V3_OPENAI_PRIMARY_MODEL_ID,
  escalationModelId: V3_OPENAI_ESCALATION_MODEL_ID,
  selectionPolicy: "deterministic-complexity-v1" as const,
  temperature: 0 as const,
  maxOutputTokens: 256,
  escalationMaxOutputTokens: 512,
  store: false as const,
  fallbackModelIds: Object.freeze([] as const)
});

export const V3_MODEL_SELECTION_REASON_CODES = [
  "primary_default",
  "comparison_requires_instruction_fidelity",
  "multi_facet_evidence_composition",
  "multi_citation_knowledge_composition",
  "explanatory_evidence_composition"
] as const;

export type V3ModelSelectionReasonCode =
  (typeof V3_MODEL_SELECTION_REASON_CODES)[number];

export interface V3WriterModelDecisionInput {
  readonly interaction: "comparison" | "follow-up" | "direct-question";
  readonly responseStyle:
    | "concise"
    | "plain-language"
    | "explanatory"
    | "standard";
  readonly factCount: number;
  readonly citationCount: number;
}

export interface V3WriterModelDecision {
  readonly tier: V3ModelTier;
  readonly modelId: V3OpenAIModelId;
  readonly reasonCode: V3ModelSelectionReasonCode;
}

/**
 * Model selection is deterministic and runs before generation. The model
 * cannot promote itself, and transport errors never trigger a more expensive
 * fallback. GPT-4.1 is used only when composing a comparison, many
 * evidence facets, multiple governed citations, or an evidence-heavy
 * explanatory answer.
 */
export function selectV3WriterModel(
  input: V3WriterModelDecisionInput
): V3WriterModelDecision {
  if (input.interaction === "comparison") {
    return {
      tier: "escalation",
      modelId: V3_OPENAI_ESCALATION_MODEL_ID,
      reasonCode: "comparison_requires_instruction_fidelity"
    };
  }
  if (input.factCount >= 6) {
    return {
      tier: "escalation",
      modelId: V3_OPENAI_ESCALATION_MODEL_ID,
      reasonCode: "multi_facet_evidence_composition"
    };
  }
  if (input.citationCount >= 2) {
    return {
      tier: "escalation",
      modelId: V3_OPENAI_ESCALATION_MODEL_ID,
      reasonCode: "multi_citation_knowledge_composition"
    };
  }
  if (
    input.responseStyle === "explanatory" &&
    input.factCount + input.citationCount >= 4
  ) {
    return {
      tier: "escalation",
      modelId: V3_OPENAI_ESCALATION_MODEL_ID,
      reasonCode: "explanatory_evidence_composition"
    };
  }
  return {
    tier: "primary",
    modelId: V3_OPENAI_PRIMARY_MODEL_ID,
    reasonCode: "primary_default"
  };
}
