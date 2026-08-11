# ADR-012: Pin the V3 runtime, model, and memory boundaries

- Status: Accepted for the V3 internal pilot
- Date: 2026-07-23
- Supersedes: the Mastra version, Ollama model, and Studio-memory decisions in ADR-010

## Context

The V3 orchestration rewrite was completed while the internal pilot's model and
developer-harness requirements changed. ADR-010 records the original rewrite
baseline (an earlier Mastra core pin, local Ollama `qwen3:0.6b`, and no Studio
memory), but those statements no longer describe the deployed pilot.

## Decision

- Keep the lockfile-resolved `@mastra/core` `1.57.0` and private Studio CLI
  `mastra` `1.23.0` versions under review. Framework upgrades are separate
  changes and must pass topology, workflow-snapshot, scorer, storage, and
  release-artifact tests.
- Use the OpenAI Responses API with `gpt-4o` as the primary model and
  `gpt-4.1` as a deterministic complex-composition tier. Runtime code
  locks both model assignments, temperature to `0`, output to at most 256
  tokens, and `store` to `false`. There is no provider-error fallback model.
- Select the complex-composition tier before generation only for reviewed
  comparisons, multi-facet evidence, multi-citation knowledge, or
  evidence-heavy explanations. The model cannot promote itself.
- Keep customer workflow writers tool-less, stateless, and without transcript
  memory. They receive only bounded semantic fact and citation views. Exact
  numbers and dates are inserted by the deterministic renderer after inference.
- Retain customer conversational continuity only as signed, bounded
  tenant/principal/session/intent state in deterministic control-plane code.
  It is not a transcript or a source of financial evidence.
- Enable Mastra thread memory only for the three loopback private-Studio agents.
  It recalls at most the latest ten messages from the current thread using the
  Studio-only LibSQL store. Semantic recall, cross-thread recall, working
  memory, and generated titles remain disabled.
- Keep Studio tools behind the reserved loopback Studio request context and
  signed synthetic/public grants. Customer workflow calls resolve no agent
  tools and explicitly use `toolChoice: "none"`.

## Consequences

The internal pilot gets higher-quality short explanations and useful private
Studio conversations without changing workflow authority, evidence signing, or
the customer memory boundary. It also gains an external-model dependency.

Customer production remains blocked until the deploying organization approves the model/provider for
privacy, residency, retention, DLP, procurement, and model risk. A future model,
provider, Mastra, or memory change requires a new ADR and full release gates;
configuration alone cannot select an unreviewed alternative.
