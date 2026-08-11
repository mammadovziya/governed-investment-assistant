# ADR-010: Use Mastra for Assistant V3 orchestration

- Status: Accepted for the V3 internal pilot
- Date: 2026-07-22
- Supersedes: the earlier supervisor/specialist MVP topology described by this ADR
- Superseded in part by: [ADR-012](./ADR-012-runtime-model-and-memory.md)

## Context

The assistant needs deterministic routing and policy, typed capability boundaries, suspend/resume for an explicit order-ticket preview, constrained local generation, replayable workflow state, and observable evaluations. Financial correctness, customer authorization, consent, evidence eligibility, signing, audit durability, and execution separation must remain under deployer-owned deterministic code.

The previous implementation accumulated specialist agents that could choose tools and returned repetitive single-facet answers. Its registry shape did not express the intended trust boundary. V3 is a ground-up orchestration rewrite; “V3” is this repository's architecture revision, not a Mastra major version.

## Decision

Use Mastra inside the TypeScript Assistant Service as the workflow and constrained-writer framework. The original rewrite-time dependency pin is superseded by ADR-012, which records the validated runtime lockfile versions: `@mastra/core` `1.57.0` and private Studio CLI `mastra` `1.23.0`.

The V3 registry is exact and drift-checked:

- three production tool-less writer agents—`public-research-writer`,
  `portfolio-insight-writer`, and `approved-knowledge-writer`—with a
  separately gated direct-Studio diagnostic view, plus the tool-less
  `financial-task-planner`;
- five workflows: `assistant-request-v3`, `public-research-v3`, `portfolio-insight-v3`, `approved-knowledge-v3`, and `order-ticket-handoff-v3`; and
- thirteen boundary tools: `resolve-instrument`, `read-market-snapshot`,
  `read-price-history`, `read-instrument-research`, `read-market-content`,
  `convert-currency`, `analyze-portfolio-allocation`,
  `read-portfolio-snapshot`, `read-portfolio-activity`,
  `retrieve-reviewed-investment-education`,
  `retrieve-approved-product-knowledge`, `read-order-eligibility`, and
  `create-signed-order-handoff`.

Mastra workflows own branching, tool execution, writer invocation, and order-preview suspend/resume. In the customer path, agents do not supervise one another, choose capabilities, call tools, calculate values, issue HTTP requests, generate SQL, or retain transcript/model memory. Direct Studio chat is a separate component harness: the reserved loopback-only Studio context dynamically exposes an allow-listed tool subset, deterministic dispatch selects one call, and signed evidence is rendered and scored before display.

V3 permits only bounded deterministic conversation continuity in the control plane. After response gates pass and the audit append succeeds, the pilot may sign and retain the active public instrument subject plus an allow-listed intent for at most five minutes, 10,000 total entries, and three follow-up hops. The context is bound to tenant, principal, session, and conversation; it contains no prompt or response text, facts, financial values, account/order data, citations, or model-generated profile. Boundary, sensitive-support, prompt-injection, and order-preview state are not carried through this memory. Writers never receive transcript history or authority from it.

The original rewrite used loopback Ollama `qwen3:0.6b`. That provider decision is historical and superseded by ADR-012: the current runtime uses locked OpenAI Responses tiers with `gpt-4o` primary and deterministic `gpt-4.1` complex composition. The invariant retained here is that writers return structured claim templates referencing signed facts and citations, deterministic rendering inserts exact values and dates, and invalid or unavailable output falls back to deterministic text.

Mastra does not authorize a request. Before workflow tools run, server-owned code validates the session, tenant, opaque principal, authentication strength, consent, entitlements, locale, deterministic route, and policy agreement. Each boundary call requires a one-use grant bound to the request, workflow, principal, policy decision, tool, and canonical argument hash.

Every material response must pass signed tool-result → fact → claim lineage and eight blocking P0 scorers before a durable audit append and delivery. The eighth scorer independently reauthorizes fact-bound read-only navigation. A scorer `fail` or `error`, scorer-set invariant failure, or lack of an applicable passing scorer blocks the response.

The order workflow may create only a preview, suspend for an explicit confirmation call, and then return a five-minute, one-use, principal-bound signed handoff reference. Mastra and the assistant have no OMS execution credential or network route.

The local application uses file-backed LibSQL for workflow persistence and an `fsync`-committed hash-chained JSONL audit outbox. Sessions, bounded conversation context, and suspended handoff state remain process-local in the pilot. These local stores are not a customer-production topology.

## Studio decision

Mastra Studio is a separate developer/admin surface, bound to `127.0.0.1:4111`. Its V3 bootstrap exposes the exact topology, a component-level tool playground, and direct specialist chat. Mastra derives a Studio selector from a client header; that selector is not authentication. Isolation comes from loopback binding and a fixed synthetic-only profile. Each permitted read/preview call receives a short-lived policy decision and one-use canonical-argument-bound grant; the signed-handoff write is denied before session, policy, or grant issuance. The harness permits development-only live public evidence, synthetic portfolio/eligibility data, and a process-memory approved-document index. Direct factual chat is constrained to one deterministically chosen tool and verified by a signed-envelope scorer. It never mounts customer data, conversation memory, or signed order handoff, and it refuses non-loopback binding or configured customer exposure.

Studio is excluded from the customer artifact. Any future shared admin Studio requires separate SSO/MFA, network restriction, scrubbed read-only data, retention controls, and approval.

## Consequences

### Positive

- Deterministic workflows make capability paths, failure behavior, and order confirmation explicit.
- A small writer-only agent set separates explanation quality from authority and financial correctness.
- Exact topology and boundary grants reduce accidental capability expansion.
- Workflow snapshots support a review-before-handoff interaction without granting execution authority.
- Signed, allow-listed subject/intent context supports short natural follow-ups without exposing transcripts to a writer model.
- The provider can be replaced later behind a reviewed model port without changing evidence, calculation, policy, or API contracts.
- Local workflow and audit persistence make pilot debugging and reconstruction possible.

### Tradeoffs

- Mastra, its transitive dependencies, and its storage schema require supply-chain review and controlled upgrades.
- The selected provider model remains bounded by the evidence-constrained writer contract; the deterministic fallback is part of the product behavior, not merely an error path.
- Process-local session, conversation-context, and suspended-run state prevent safe horizontal scaling.
- File-backed LibSQL and JSONL are durable on one workstation but are not HA, centrally retained, independently tamper-evident, or suitable for ephemeral deployments.
- The Studio tool playground validates individual boundary envelopes only; API contract, workflow, scorer/audit, and browser E2E tests remain authoritative for the customer flow.

## Production follow-up

Before customer deployment:

1. Replace mock identity and synthetic portfolio adapters with institution-managed OIDC, tenant/account entitlements, authoritative read-only ledger data, and reconciled signed input snapshots.
2. Replace Yahoo development endpoints with a licensed market-data facade and approved egress, attribution, delay, redistribution, and retention controls.
3. Replace development keys and local/process state with managed signing and approved HA storage. Conversation memory must be disabled or moved to an encrypted, TTL-enforced HA store with atomic tenant/principal/session isolation and bounded eviction.
4. Publish the local audit outbox transactionally to customer-controlled tamper-evident storage with reconstruction and retention controls.
5. Use only internally approved AZ/EN evidence manifests for governed RAG; official public provenance alone is insufficient.
6. Complete privacy, DLP, consent, policy, threat-model, supply-chain, regulatory, model-risk, SLO, incident, and disaster-recovery approval.
7. Keep Studio out of the customer deployment and separately secure any administrator instance.

Production readiness is fail-closed and is described in [the production-readiness boundary](../production-readiness.md).
