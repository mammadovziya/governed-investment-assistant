# Local Ollama writer-contract evaluation — 2026-07-25

## Scope

This is a non-billable developer diagnostic, not a provider acceptance test.
The evaluator used only fixed synthetic semantic references and the loopback
Ollama API at `http://127.0.0.1:11434`. OpenAI environment variables were
removed from the evaluator process. The application and Mastra Studio were not
started.

The evaluator requires:

- structured JSON matching the reviewed claim schema;
- one claim per instrument;
- exact one-time coverage of every required fact placeholder and reference;
- no invented, concatenated, duplicated, or misplaced references;
- no unsigned number, money value, percentage, date, ticker, URL, or source;
- no recommendation or trade language; and
- separate English and Azerbaijani quote and two-instrument comparison cases.

## Retained result

Command:

```bash
env -u OPENAI_API_KEY \
  -u OPENAI_PRIMARY_MODEL \
  -u OPENAI_ESCALATION_MODEL \
  OLLAMA_TEST_MODEL=qwen3:0.6b \
  ./node_modules/.bin/tsx scripts/evaluate-local-writer.ts
```

`qwen3:0.6b` passed 1 of 4 cases:

| Case | Result | Reason code |
|---|---|---|
| English quote | Pass | — |
| English comparison | Fail | `claim_count_not_one_per_subject` |
| Azerbaijani quote | Fail | `placeholder_ref_mismatch` |
| Azerbaijani comparison | Fail | `writer_output_not_json` |

An exploratory `qwen3.5:4b` run exceeded the bounded local evaluation time and
was stopped. It is not retained as a pass or a complete comparative result.

## Decision

`qwen3:0.6b` is not eligible to replace the production writer policy. The
failures are handled by rejecting the draft and using the deterministic
renderer; scorer rules are not weakened to accommodate the model.

The deployed policy remains `gpt-4o` primary and deterministic `gpt-4.1`
escalation for reviewed complex compositions. This local result does not prove
OpenAI availability, production latency, provider governance, or customer
readiness.
