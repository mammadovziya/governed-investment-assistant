import { WORKFLOW_WRITER_INSTRUCTIONS } from "../src/assistant-v3/writers.js";

const OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3:0.6b";
const ALLOWED_LOCAL_MODELS = new Set([
  "qwen3:0.6b",
  "qwen3:4b",
  "qwen3.5:4b"
]);
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_-]{0,31})\}\}/gu;
const UNSIGNED_LITERAL =
  /\b(?:AAPL|NVDA|Apple|NVIDIA|Yahoo)\b|https?:\/\/|www\.|[$€£₼%]|\d/iu;
const ADVICE_LANGUAGE =
  /\b(?:buy|sell|hold|recommend|undervalued|overvalued|should\s+invest)\b|(?<!\p{L})(?:al|sat|saxla|tövsiyə|investisiya\s+etməlisən)(?!\p{L})/iu;

interface SemanticFact {
  ref: string;
  kind: string;
  subjectType: "instrument";
  subjectRef: string;
  asOfRef: string;
  availability: "complete";
  required: true;
  meaning: string;
}

interface EvaluationCase {
  id: string;
  locale: "en-US" | "az-AZ";
  interaction: "direct-question" | "comparison";
  goal: string;
  facts: SemanticFact[];
  subjectPrefixes: string[];
}

interface WriterClaim {
  claimId: string;
  textTemplate: string;
  factRefs: string[];
  citationRefs: string[];
  limitations: string[];
}

interface WriterOutput {
  claims: WriterClaim[];
}

class EvaluationFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const writerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "claimId",
          "textTemplate",
          "factRefs",
          "citationRefs",
          "limitations"
        ],
        properties: {
          claimId: { type: "string", minLength: 1, maxLength: 80 },
          textTemplate: { type: "string", minLength: 1, maxLength: 500 },
          factRefs: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 80 }
          },
          citationRefs: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 80 }
          },
          limitations: {
            type: "array",
            maxItems: 0,
            items: { type: "string" }
          }
        }
      }
    }
  }
} as const;

function factsFor(
  prefix: string,
  subjectRef: string,
  type: "quote" | "research"
): SemanticFact[] {
  const definitions: ReadonlyArray<readonly [
    suffix: string,
    kind: string,
    meaning: string
  ]> = type === "quote"
    ? [
        ["IDENTITY", "instrument.identity", "the verified instrument identity"],
        ["PRICE", "market.quote", "the verified current market price"],
        ["CHANGE", "market.quote", "the verified previous-close change"],
        ["SOURCE", "market.quote", "the verified observation time and source"]
      ]
    : [
        ["IDENTITY", "instrument.identity", "the verified instrument identity"],
        [
          "QUOTE",
          "market.quote",
          "the verified current price and previous-close change"
        ],
        [
          "MARKET_CAP",
          "instrument.research",
          "the verified market capitalization"
        ],
        [
          "TRAILING_PE",
          "instrument.research",
          "the verified trailing price-to-earnings ratio"
        ],
        [
          "SOURCE",
          "instrument.research",
          "the verified research time and source"
        ]
      ];
  return definitions.map(([suffix, kind, meaning]) => {
    const ref = `${prefix}_${suffix}`;
    return {
      ref,
      kind,
      subjectType: "instrument",
      subjectRef,
      asOfRef: `as-of-${ref}`,
      availability: "complete",
      required: true,
      meaning
    };
  });
}

const cases: EvaluationCase[] = [
  {
    id: "quote-en",
    locale: "en-US",
    interaction: "direct-question",
    goal: "answer the current quote directly",
    facts: factsFor("F1", "NVDA", "quote"),
    subjectPrefixes: ["F1"]
  },
  {
    id: "comparison-en",
    locale: "en-US",
    interaction: "comparison",
    goal: "compare the two instruments using only the supplied research slots",
    facts: [
      ...factsFor("F1", "NVDA", "research"),
      ...factsFor("F2", "AAPL", "research")
    ],
    subjectPrefixes: ["F1", "F2"]
  },
  {
    id: "quote-az",
    locale: "az-AZ",
    interaction: "direct-question",
    goal: "cari kotirovkanı birbaşa izah et",
    facts: factsFor("F1", "NVDA", "quote"),
    subjectPrefixes: ["F1"]
  },
  {
    id: "comparison-az",
    locale: "az-AZ",
    interaction: "comparison",
    goal: "iki aləti yalnız təqdim edilmiş araşdırma sahələri ilə müqayisə et",
    facts: [
      ...factsFor("F1", "NVDA", "research"),
      ...factsFor("F2", "AAPL", "research")
    ],
    subjectPrefixes: ["F1", "F2"]
  }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new EvaluationFailure(code);
  }
  return value;
}

function parseWriterOutput(value: unknown): WriterOutput {
  if (!isRecord(value) || !Array.isArray(value.claims)) {
    throw new EvaluationFailure("schema_claims_missing");
  }
  const claims = value.claims.map((candidate, index): WriterClaim => {
    if (!isRecord(candidate)) {
      throw new EvaluationFailure(`schema_claim_${index}_invalid`);
    }
    if (
      typeof candidate.claimId !== "string" ||
      typeof candidate.textTemplate !== "string"
    ) {
      throw new EvaluationFailure(`schema_claim_${index}_fields_invalid`);
    }
    return {
      claimId: candidate.claimId,
      textTemplate: candidate.textTemplate,
      factRefs: stringArray(
        candidate.factRefs,
        `schema_claim_${index}_fact_refs_invalid`
      ),
      citationRefs: stringArray(
        candidate.citationRefs,
        `schema_claim_${index}_citation_refs_invalid`
      ),
      limitations: stringArray(
        candidate.limitations,
        `schema_claim_${index}_limitations_invalid`
      )
    };
  });
  if (claims.length < 1 || claims.length > 5) {
    throw new EvaluationFailure("schema_claim_count_invalid");
  }
  return { claims };
}

function duplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function validateOutput(testCase: EvaluationCase, output: WriterOutput): void {
  if (output.claims.length !== testCase.subjectPrefixes.length) {
    throw new EvaluationFailure("claim_count_not_one_per_subject");
  }
  const expectedRefs = testCase.facts.map(({ ref }) => ref);
  const expected = new Set(expectedRefs);
  const allPlaceholders: string[] = [];
  const allFactRefs: string[] = [];
  const claimIds = output.claims.map(({ claimId }) => claimId);
  if (duplicates(claimIds)) {
    throw new EvaluationFailure("duplicate_claim_id");
  }

  for (const claim of output.claims) {
    if (claim.limitations.length !== 0) {
      throw new EvaluationFailure("model_owned_limitation");
    }
    if (claim.citationRefs.length !== 0) {
      throw new EvaluationFailure("unexpected_citation_ref");
    }
    if (duplicates(claim.factRefs)) {
      throw new EvaluationFailure("duplicate_fact_ref");
    }
    if (claim.factRefs.some((ref) => !expected.has(ref))) {
      throw new EvaluationFailure("invented_fact_ref");
    }
    const placeholders = [
      ...claim.textTemplate.matchAll(PLACEHOLDER)
    ].map((match) => match[1]!);
    if (duplicates(placeholders)) {
      throw new EvaluationFailure("duplicate_placeholder_in_claim");
    }
    if (
      sorted(placeholders).join("\n") !==
      sorted(claim.factRefs).join("\n")
    ) {
      throw new EvaluationFailure("placeholder_ref_mismatch");
    }
    const shell = claim.textTemplate.replace(PLACEHOLDER, " ");
    if (UNSIGNED_LITERAL.test(shell)) {
      throw new EvaluationFailure("unsigned_literal_in_template");
    }
    if (ADVICE_LANGUAGE.test(shell)) {
      throw new EvaluationFailure("advice_language_in_template");
    }
    const prefixes = new Set(
      placeholders
        .map((ref) => ref.match(/^(F\d+)_/u)?.[1] ?? null)
        .filter((prefix): prefix is string => prefix !== null)
    );
    if (prefixes.size !== 1) {
      throw new EvaluationFailure("mixed_subjects_in_claim");
    }
    allPlaceholders.push(...placeholders);
    allFactRefs.push(...claim.factRefs);
  }

  if (
    sorted(allPlaceholders).join("\n") !== sorted(expectedRefs).join("\n") ||
    duplicates(allPlaceholders)
  ) {
    throw new EvaluationFailure("required_placeholder_coverage_invalid");
  }
  if (
    sorted(allFactRefs).join("\n") !== sorted(expectedRefs).join("\n") ||
    duplicates(allFactRefs)
  ) {
    throw new EvaluationFailure("required_ref_coverage_invalid");
  }
  const coveredPrefixes = new Set(
    output.claims.map(({ factRefs }) => factRefs[0]?.match(/^(F\d+)_/u)?.[1])
  );
  if (
    testCase.subjectPrefixes.some((prefix) => !coveredPrefixes.has(prefix))
  ) {
    throw new EvaluationFailure("subject_coverage_invalid");
  }
}

async function ollamaJson(
  path: "/api/tags" | "/api/chat",
  init?: RequestInit
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_ORIGIN}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new EvaluationFailure("ollama_request_timeout");
    }
    throw new EvaluationFailure("ollama_loopback_unreachable");
  }
  if (!response.ok) {
    throw new EvaluationFailure(`ollama_http_${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new EvaluationFailure("ollama_response_not_json");
  }
}

async function installedModelNames(): Promise<Set<string>> {
  const payload = await ollamaJson("/api/tags");
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new EvaluationFailure("ollama_tags_schema_invalid");
  }
  return new Set(payload.models.flatMap((model) =>
    isRecord(model) && typeof model.name === "string" ? [model.name] : []
  ));
}

async function generate(testCase: EvaluationCase, model: string): Promise<unknown> {
  const userPrompt = [
    `Locale: ${testCase.locale}`,
    `Sanitized conversation intent: ${JSON.stringify({
      locale: testCase.locale,
      responseStyle: "concise",
      interaction: testCase.interaction,
      politeness: "neutral"
    })}`,
    `Reviewed answer goal: ${testCase.goal}`,
    `Semantic facts: ${JSON.stringify(testCase.facts)}`,
    "Eligible citations: []",
    "Return claim templates now."
  ].join("\n\n");
  const payload = await ollamaJson("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: WORKFLOW_WRITER_INSTRUCTIONS },
        { role: "user", content: userPrompt }
      ],
      stream: false,
      think: false,
      format: writerOutputSchema,
      keep_alive: "5m",
      options: {
        temperature: 0,
        seed: 42,
        num_predict: 256
      }
    })
  });
  if (
    !isRecord(payload) ||
    !isRecord(payload.message) ||
    typeof payload.message.content !== "string"
  ) {
    throw new EvaluationFailure("ollama_chat_schema_invalid");
  }
  try {
    return JSON.parse(payload.message.content);
  } catch {
    throw new EvaluationFailure("writer_output_not_json");
  }
}

async function main(): Promise<void> {
  const model = process.env.OLLAMA_TEST_MODEL?.trim() || DEFAULT_MODEL;
  if (!ALLOWED_LOCAL_MODELS.has(model)) {
    throw new EvaluationFailure("local_model_not_allowlisted");
  }
  const installed = await installedModelNames();
  if (!installed.has(model)) {
    throw new EvaluationFailure("local_model_not_installed");
  }

  const results: Array<{
    caseId: string;
    status: "pass" | "fail";
    reasonCode?: string;
  }> = [];
  for (const testCase of cases) {
    try {
      const raw = await generate(testCase, model);
      validateOutput(testCase, parseWriterOutput(raw));
      results.push({ caseId: testCase.id, status: "pass" });
    } catch (error) {
      results.push({
        caseId: testCase.id,
        status: "fail",
        reasonCode: error instanceof EvaluationFailure
          ? error.code
          : "unexpected_local_evaluator_error"
      });
    }
  }

  const failed = results.filter(({ status }) => status === "fail").length;
  process.stdout.write(`${JSON.stringify({
    evaluator: "assistant-v3.local-ollama-writer-contract",
    transport: "loopback-only",
    model,
    passed: results.length - failed,
    failed,
    cases: results
  }, null, 2)}\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  const reasonCode = error instanceof EvaluationFailure
    ? error.code
    : "unexpected_local_evaluator_error";
  process.stderr.write(`${JSON.stringify({
    evaluator: "assistant-v3.local-ollama-writer-contract",
    transport: "loopback-only",
    status: "error",
    reasonCode
  })}\n`);
  process.exitCode = 1;
});
