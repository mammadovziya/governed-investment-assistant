# ADR-013: Add an isolated general-purpose lane beside governed finance

- Status: Proposed
- Date: 2026-07-28
- Scope: Customer-facing investment assistant V3
- If accepted, supersedes in part:
  - ADR-010's exact whole-assistant topology
  - ADR-012's prohibition on all customer transcript memory, but only for the
    isolated general lane
- Preserves:
  - ADR-011 governed retrieval
  - ADR-012's model, writer, memory, and tool boundaries for the financial lane
  - all existing financial policy, grant, evidence, citation, scorer, audit,
    order-preview, and execution-handoff controls

## Context

Assistant V3 is currently a governed investment assistant rather than a
general-purpose assistant.

`src/assistant-v3/routing.ts` recognizes a fixed product-support and investment taxonomy.
An otherwise safe request that does not match that taxonomy becomes
`clarify/no_deterministic_route`. `src/assistant-v3/conversation.ts` and
`V3AssistantRuntime.deterministicBoundary` then return a reviewed but
investment-oriented clarification. A small hard-coded out-of-scope expression
also rejects examples such as weather and recipes as outside the investment
assistant.

This behavior is intentionally coupled to a strong financial trust chain:

1. the server owns identity, locale, consent, entitlements, and feature state;
2. deterministic routing selects an existing `V3Function`;
3. `policy.ts` produces a trusted, request-bound financial policy decision;
4. workflow-owned tools require principal-, policy-, route-, argument-, and
   workflow-bound one-use grants;
5. financial writers receive bounded semantic views of signed evidence, not raw
   tool payloads or transcript facts;
6. exact values, dates, citations, and actions are rendered deterministically;
7. all eight financial P0 delivery scorers must pass;
8. audit is durably appended before memory is committed and before delivery;
9. executable orders remain outside the assistant, behind the existing signed
   handoff boundary.

Those controls must not be generalized into a permissive framework. In
particular:

- arbitrary prose cannot pass the existing material-claim lineage scorer;
- the current writers cannot safely receive raw general-purpose prompts or
  transcript history;
- adding general capabilities to `V3Function` would mix them into an exhaustive
  financial policy and tool allowlist;
- reusing the current reviewed-conversation exception for arbitrary generation
  would create an evidence bypass;
- a broad "unknown means general" fallback is unsafe unless financial
  uncertainty is resolved before entry to that fallback.

The current router also contains broad lexical matches that need contextual
hardening before a general lane can be enabled. For example, ordinary phrases
such as "buy milk" can resemble an executable order, "project risk" can resemble
security risk, and uppercase non-financial abbreviations can resemble symbols.
The goal is not to weaken the financial detectors. It is to make domain
evidence explicit and to send uncertainty to a safe clarification rather than
to the general generator.

The code is the current topology source of truth: three financial writers, five
financial workflows, thirteen approved financial boundary tools, eight
customer-response P0 scorers, and one private-Studio scorer. Some existing
architecture text and test descriptions still say eleven or twelve tools and
seven scorers. That documentation drift must be reconciled as part of this
change. ADR-012 also records exact Mastra versions that differ from the current
package manifest; dependency pinning must be reconciled before implementation
is promoted.

## Decision

Introduce a new outer assistant-lane decision and place the existing Assistant
V3 implementation inside an unchanged governed-financial subsystem. Add a
separately typed, separately authorized, separately prompted, separately
scored, separately remembered general-purpose subsystem.

The design follows four rules:

1. **Monotonic restriction.** A later classifier may promote a request to a
   stricter policy class, but it may never demote a boundary or financial
   result to the general lane.
2. **No fallback across lanes.** A financial failure, timeout, missing fact,
   policy denial, scorer failure, or quarantined route never retries in the
   general lane. A general failure never invokes a financial writer.
3. **No shared authority.** General code receives no financial tools, grants,
   evidence, writers, memory, action schema, or order-handoff types.
4. **Uncertainty is not permission.** A request with unresolved financial
   affinity receives a neutral no-tool clarification. It does not enter the
   general generator and does not assume that the customer meant investing.

The new general lane is an additional capability domain, not a less-restricted
mode of the financial assistant.

## Non-negotiable financial invariants

The implementation must preserve all of the following:

- the existing `V3Function` and `V3RouteDecision` remain financial types;
- the exact financial route precedence, including order preview versus
  execution, remains authoritative inside the financial subsystem;
- customer-controlled input cannot select a lane, route, workflow, policy,
  model, tool, grant, trusted context, action, or order state;
- `V3_APPROVED_BOUNDARY_TOOL_IDS` remains a financial-only manifest;
- `evaluateV3Policy` remains an exhaustive financial route policy;
- `V3ToolGrantAuthority` continues to require trusted, short-lived, one-use,
  canonical-argument grants;
- customer-facing financial writers remain tool-less and transcript-less;
- signed tool result to fact to claim lineage remains mandatory for material
  financial claims;
- governed product knowledge still observes locale, jurisdiction, approval,
  effective-date, revocation, and citation requirements from ADR-011;
- all eight financial delivery scorers remain blocking and fail closed;
- financial audit still succeeds durably before delivery or memory commit;
- the existing read-only order preview and signed, suspended order handoff are
  unchanged;
- no model, including the general model, can execute an order or manufacture an
  order handoff;
- financial conversation memory remains the current signed, bounded
  subject/intent pointer and never becomes transcript memory.

No general capability is added to `V3Function`, `ROUTE_POLICIES`, the financial
writer prompts, the financial response-scorer exception set, or the financial
tool registry.

## Capability taxonomy

Capability and risk are separate dimensions. A task capability describes what
the customer wants. A policy class describes how much authority and what
restrictions the request requires.

### Governed-financial lane

The current routes remain the source of truth and are grouped as follows for
outer-lane classification:

| Family | Included capabilities | Authority |
| --- | --- | --- |
| Portfolio and account insight | current value, performance, allocation, movers, average cost, activity, bounded scenarios | Signed customer and market facts |
| Public markets and research | quote/history, events, company/research, technical context, news/move explanation, risk, comparison, decision-support factors | Signed public evidence |
| Configured products and support | approved product knowledge, fees, disclosures, navigation | Governed product evidence |
| Investment education | reviewed investment concepts and educational explanations | Reviewed catalog or governed evidence |
| Orders | read-only preview and the existing signed handoff boundary | Deterministic workflow only |
| Financial transformation | summarizing, translating, simplifying, or rewriting material financial content or a prior financial answer | Financial lane; initially only reviewed transformations |

Personalized recommendations, suitability conclusions, promises of return,
unapproved tax advice, unsupported current financial claims, and executable
orders remain unavailable or restricted under the existing policies. A
financial transformation that cannot satisfy the existing evidence and claim
contract fails closed; it is not moved to the general lane.

### General-purpose lane

The general lane supports:

| Capability ID | Scope |
| --- | --- |
| `general_knowledge` | Stable, low-stakes general knowledge without a live-data claim |
| `explanation_tutoring` | Concepts, examples, study help, and step-by-step teaching |
| `writing_rewriting` | Drafting, editing, tone, grammar, and style |
| `summarization` | Summaries of customer-provided, non-financial text |
| `translation` | Task-level translation that does not change the trusted session locale |
| `brainstorming` | Names, outlines, ideas, alternatives, and creative exploration |
| `nonfinancial_calculation` | Bounded arithmetic and reviewed unit conversions |
| `general_reasoning` | Low-stakes comparison, planning, classification, and problem solving |
| `general_conversation` | Ordinary social and multi-turn conversation |
| `general_clarification` | A neutral request for missing task information |

The initial general lane has no live web, customer-account, governed product knowledge,
market-data, file-system, shell, code-execution, messaging, connector, or
external-action capability. It must not claim that static model knowledge is
current.

### Cross-cutting policy classes

Every request also receives one or more server-owned policy labels:

- `standard`
- `financial_governed`
- `financial_high_stakes`
- `medical_educational`
- `medical_high_stakes`
- `legal_educational`
- `legal_high_stakes`
- `safety_sensitive`
- `imminent_harm`
- `privacy_sensitive`
- `prompt_injection`
- `financial_order_execution`

Medical, legal, and safety are policy classes, not routes that silently acquire
more tools. Multiple labels may be present. The resolver applies the most
restrictive compatible action.

## Route and authorization contracts

Do not add `lane` to `V3RouteDecision`. The existing financial decision is used
in exact order-state validation and should remain a closed financial contract.
Wrap it in a new discriminated outer type:

```ts
type AssistantLaneDecision =
  | {
      lane: "governed-financial";
      financialAffinity: "positive";
      invocation: V3WorkflowInvocation;
      riskClasses: readonly AssistantRiskClass[];
      decisionHash: string;
    }
  | {
      lane: "general";
      financialAffinity: "clear";
      invocation: GeneralWorkflowInvocation;
      riskClasses: readonly AssistantRiskClass[];
      decisionHash: string;
    }
  | {
      lane: "boundary";
      boundary: AssistantBoundary;
      financialAffinity: "positive" | "uncertain" | "clear";
      riskClasses: readonly AssistantRiskClass[];
      decisionHash: string;
    };
```

This decision is server-minted and bound to:

- request hash;
- tenant, principal, session, and conversation;
- trusted locale, consent, entitlement, and feature snapshot;
- lane and policy version;
- classifier/detector versions;
- creation and expiry time.

The customer cannot submit or amend it. The financial workflow re-runs or
validates its own deterministic route and requires agreement with the outer
financial handoff. The general workflow requires an independently branded
general-policy decision. Unsafe type casts or serialized look-alikes cannot
enter either authority's trusted decision set.

Financial and general grants use different types, signing domains, allowlists,
and verification authorities. A general invocation must be rejected by every
financial boundary tool even if a programming error passes it to that tool.
The financial grant binding should include the outer decision hash or a stable
financial authority-domain marker without changing the customer-visible
`V3RouteDecision` or suspended order payload.

## Routing precedence

Lane selection is server-side and deterministic for all security-relevant
decisions. Model classification may label a general subtype or escalate an
uncertain request, but it cannot authorize entry to the general lane when a
hard detector or the financial-affinity guard is not clear.

### Stage 1: normalize and inspect the complete input

- validate authentication, body shape, Unicode normalization, and size;
- scan the complete message before truncation, summarization, model calls, or
  memory writes;
- treat pasted or quoted text as untrusted data, never as policy;
- compute a request hash and immutable trusted-context snapshot.

### Stage 2: collect non-downgradable boundaries

Evaluate sensitive-data, prompt-injection, executable-order, disallowed-safety,
and imminent-harm detectors. Do not stop after the first lexical match; retain
all applicable risk labels so a composite response can, for example, avoid
echoing a secret while still showing approved urgent-safety guidance.

Any positive hard boundary prevents entry to the general lane.

- Actual credentials, authentication secrets, payment data, government IDs,
  or private account artifacts are refused or redacted before a provider call.
- Active prompt-injection attempts remain fail closed.
- An executable investment order remains a deterministic boundary globally.
- An exact, read-only order-preview request remains in the financial lane.
- Acute safety and imminent-harm responses use reviewed deterministic copy and
  an approved localized support catalog, not model-invented contact details.

For the first release, quoted prompt-injection strings inside a requested
summary or translation also fail closed. A future provenance-separated
transform sandbox requires its own ADR and red-team evidence.

### Stage 3: run the governed-financial router

Run the current detailed financial router and preserve its internal precedence.
Harden only over-broad lexical rules by requiring relevant domain evidence:

- order execution requires an instrument, shares/quantity, brokerage, trading,
  or order context; "buy milk" is not an investment order;
- security risk requires security, market, portfolio, or instrument context;
  "project risk" is not a security-risk request;
- symbol extraction requires finance context or explicit ticker syntax;
  biological abbreviations such as DNA and RNA are not assumed to be tickers;
- session-language changes remain different from task-level translation.

An exact financial match enters the governed-financial lane. A match that is
financial but lacks a required symbol or parameter receives the existing
financial clarification.

### Stage 4: apply the independent financial-affinity shield

Before a request may enter the general lane, an independent high-recall guard
classifies it as:

- `positive`: route to governed finance or a financial clarification;
- `uncertain`: return a neutral no-tool clarification;
- `clear`: general classification is permitted.

The guard considers the current message, material lane affinity, explicit
financial entities, account/portfolio semantics, money and return semantics,
financial source text, and requested output. It does not rely on a single
keyword or uppercase-token rule.

The following remain financial:

- "Simplify that" after a financial answer;
- "Translate my portfolio advice";
- "Summarize this recommendation to buy AAPL";
- "Write an email asking my broker to sell NVDA";
- "Calculate my return if I buy ten shares";
- any mixed request containing a material financial decision, account, order,
  product, fee, or market component.

A transform containing only an isolated lexical example may be general, but a
transform containing material financial claims, actions, or prior financial
context is governed. Uncertain transform provenance receives a neutral
clarification.

The independent guard may promote a tentative general result to financial. It
may never demote an exact financial or boundary result.

### Stage 5: apply medical, legal, and safety policy

If financial affinity is clear, classify non-financial high-stakes risk:

- low-stakes medical or legal concepts may receive constrained educational
  explanations;
- diagnosis, treatment selection, dose changes, urgent symptoms, personalized
  legal conclusions, deadlines, filing strategy, evasion, or current
  jurisdiction-specific conclusions are restricted or escalated;
- harmful instructions, imminent danger, and crisis content use the approved
  safety boundary;
- current medical or legal claims are unavailable without an approved,
  separately governed retrieval source.

Required caveats, escalation wording, and localized support resources must be
approved by the deploying organization's Legal, Compliance, Risk, and Safety owners before production.

### Stage 6: select a general capability

Only a request with `financialAffinity: "clear"` and an allowing general policy
may reach the general workflow. Obvious tasks are deterministically classified.
A constrained classifier may select a subtype for residual cases, but a
classifier failure simply uses `general_reasoning` or neutral clarification; it
does not change risk authorization.

A safe but underspecified request receives a neutral response such as:

> Tell me what you would like help with, or paste the text you want explained,
> rewritten, summarized, or translated.

It must not receive investment examples merely because no deterministic
financial route matched.

### Mixed requests and conversation context

- The whole request uses the strongest applicable lane in the first release.
- Do not split one request into financial and general subcalls.
- If a useful governed answer cannot cover the non-financial part, ask the
  customer to split the request.
- Current hard signals always override remembered context toward the stricter
  lane.
- A referential follow-up to a financial response remains financial.
- A substantive general turn clears the old financial subject pointer after
  successful delivery.
- A greeting or acknowledgement may preserve the previous material lane.
- A prior general conversation can never cause a new financial request to enter
  general.

## Agents, workflows, and models

### Outer workflow

Add an outer `assistant-turn-v1` lifecycle. It validates the request, obtains the
lane decision, and invokes exactly one inner subsystem:

- the current `assistant-request-v3` financial workflow, or
- a new `general-assistant-v1` workflow, or
- a deterministic boundary responder.

The outer handoff is one-use and request-bound. The existing financial
workflow reauthorizes its exact route; disagreement blocks the request. There
is no catch-all dispatch branch and no cross-lane retry. Exhaustive switches
must use an `assertNever` equivalent.

Keeping the current financial workflow as the inner subsystem avoids widening
its exact suspended order-state schema. If framework limitations require
refactoring, the extracted financial workflow must keep the same route,
policy, grant, evidence, scorer, audit, and suspension contracts and pass the
unchanged financial golden suites before general code is enabled.

### General agent

Add one `general-assistant` agent with a purpose-built prompt and structured
output. It receives only:

- the current DLP-approved general request;
- the bounded, DLP-approved general history for the same scope;
- a general capability and policy constraint object;
- deterministic calculation results when applicable.

It never receives:

- trusted financial context;
- portfolio, account, governed product, market, citation, or order data;
- financial facts or writer semantic views;
- financial conversation memory;
- financial tool IDs, grants, schemas, descriptions, or results;
- system diagnostics or private-Studio tool context.

The agent has no customer actions and no implicit tools. It uses `toolChoice:
"none"` and a single bounded generation step. The private Studio must either
exclude this agent initially or register it with the same zero-tool customer
surface; it must not inherit the financial Studio direct-tool harness.

### Financial writers

`src/assistant-v3/writers.ts` remains financially scoped. The three existing
writers are not repurposed for general prose. Their prompts, semantic
fact/citation views, no-tool behavior, exact-value restrictions, and
deterministic rendering contract remain intact. A financial-lane assertion may
be added at their entry point as defense in depth.

The current narrow reviewed `conversation` catalog may continue to serve
financial-lane acknowledgements and financial capability explanations. Fresh
general conversation and neutral clarification use a new
`general-conversation.ts` catalog or the general agent.

### Model policy

Keep `src/assistant-v3/model-policy.ts` unchanged for financial writers:
approved financial models, temperature zero, maximum 256 output tokens,
`store:false`, and no provider-error model fallback.

Add `general-model-policy.ts` with an independently approved provider/model,
temperature zero for the first release, `store:false`, explicit timeout and
rate limits, no automatic provider fallback, and a separate output cap. The
recommended initial maximum is 1,024 output tokens. A general model failure
returns a neutral general-unavailable response or fails closed; it never calls
a financial writer.

Provider approval for the larger raw-input and transcript surface is separate
from the existing financial writer approval.

## Tools and calculations

Writing, rewriting, summarization, translation, brainstorming, tutoring, and
stable general knowledge are model-only.

The initial production tool boundary is:

- no network or live web;
- no governed product or portfolio data;
- no financial or market tools;
- no file system, shell, interpreter, SQL, or arbitrary code execution;
- no email, calendar, messaging, connector, purchase, booking, or external
  action;
- no order preview or handoff;
- no customer-visible structured actions.

To improve non-financial arithmetic accuracy, add a workflow-owned pure
calculator after the core lane is proven. It must:

- parse a small reviewed grammar or AST and never use `eval`;
- cap expression size, nesting, operations, precision, and runtime;
- support finite arithmetic and reviewed non-sensitive unit conversions;
- reject currency, investment returns, loans, dosage, legal deadlines, and
  other high-stakes calculations for reclassification;
- have no network, file, clock, random, or process access;
- return a typed result that the general response scorer can recompute exactly.

The calculator is not added to `V3_APPROVED_BOUNDARY_TOOL_IDS` and never accepts
a `V3ToolGrant`. If represented as a framework tool, it uses a separate exact
general manifest and general grant authority. Prefer a pure workflow service
until a model-directed tool call is justified.

## Policy changes

Keep `src/assistant-v3/policy.ts` financial-only. Add:

- `general-policy.ts` for general capability, entitlement, consent, tool, model,
  memory, and retention decisions;
- `safety-policy.ts` for global risk detection and deterministic boundary
  actions;
- branded trusted decision types that cannot be serialized by the customer;
- policy version and lane-decision hash binding;
- separate lane-specific kill switches and circuit breakers.

Recommended default policy:

| Class | Default behavior |
| --- | --- |
| Financial | Existing governed workflow only |
| Financial high stakes | Existing limitations, evidence, factor-based education, and order boundary; no unsupported personalized recommendation |
| Medical educational | General concepts only, with uncertainty and non-diagnostic framing |
| Medical high stakes | No diagnosis, treatment choice, or dose change; approved escalation, deterministic urgent response where applicable |
| Legal educational | General concepts only; clearly not a current jurisdiction-specific conclusion |
| Legal high stakes | No personalized strategy, deadline, filing, evasion, or representation; approved escalation |
| Safety sensitive | Refuse harmful assistance; offer reviewed safe alternatives |
| Imminent harm | Deterministic localized support path, no ordinary generation |
| Sensitive data | Redact/refuse before provider, memory, telemetry, and audit projection |
| Prompt injection | Fail closed before lane generation |
| Executable investment order | Existing deterministic order boundary only |

Add distinct server-owned `general_assistant_access` entitlement and
`general_assistant_use` consent/version. The consent must cover model
processing and bounded session transcript retention. Denial does not route the
request to finance.

## Response contracts and UI

Do not weaken `ClaimDraft`, `AssistantResponse`, financial facts, citations,
cards, charts, actions, or provenance types. Add a sibling general contract and
a versioned outer envelope:

```ts
type AssistantTurnResponse =
  | {
      schemaVersion: "assistant-turn.response.v1";
      lane: "governed-financial";
      response: AssistantResponse;
    }
  | {
      schemaVersion: "assistant-turn.response.v1";
      lane: "general";
      response: GeneralAssistantResponse;
    }
  | {
      schemaVersion: "assistant-turn.response.v1";
      lane: "boundary";
      response: BoundaryAssistantResponse;
    };
```

`GeneralAssistantResponse` contains a message, locale, capability, policy-safe
metadata, and optional deterministic calculation provenance. It has no
financial facts, citations, cards, charts, tools, grants, order state, or
actions. Those fields should be absent rather than nullable.

The browser renders initial general output as plain text using `textContent`.
It must not infer actions, links, HTML, or Markdown behavior from model prose.
Only the existing structured financial action contract can render an
authorized action.

The API migration should be versioned or feature-negotiated so existing clients
do not accidentally interpret general prose as a financial V3 response.

## Memory design

### Financial memory

Keep `BoundedV3ConversationMemory` unchanged:

- signed subject/intent state only;
- no transcript or generated summary;
- existing tenant/principal/session/conversation and auth/policy scope;
- current TTL, hop, symbol, and byte limits;
- CAS commit only after scorer and audit success;
- safety/order boundaries clear or quarantine it.

### Lane affinity

Add a small signed `LaneAffinityStore` containing only:

- last material lane;
- capability family;
- request/response hash references;
- creation/expiry time;
- bounded follow-up hop count and version.

It contains no prose. It exists so referential financial follow-ups cannot be
downgraded. It is advisory only toward the stricter lane and cannot override
current boundaries.

### General memory

Add a separate `GeneralConversationMemory` with the recommended defaults:

- same tenant, principal, session, and conversation only;
- maximum four user/assistant exchanges, eight messages total;
- maximum 16 KiB of retained text after normalization;
- 15-minute absolute TTL, not a sliding indefinite TTL;
- no cross-session recall, profile, working-memory document, embedding,
  semantic recall, generated title, or generated summary;
- DLP and high-stakes classification before write and again before read;
- no financial, order, medical/legal high-stakes, safety-boundary, credential,
  attachment, or blocked content retention;
- encryption and an approved HA TTL store in production;
- CAS/versioned updates;
- write only after general scoring and durable audit succeed.

Financial writers and workflows never read general memory. General workflows
never read financial facts or subject memory. A substantive lane transition
clears the other lane's prose context. A boundary clears or quarantines both as
specified by policy.

If general memory is unavailable, the assistant remains stateless or asks a
neutral general clarification. It must not infer context from financial memory
or route to finance as a fallback. Process-local general transcript memory is
development-only and a production-readiness blocker.

## Scoring and delivery

Split finalization by lane.

### Financial finalizer

The current `scoreV3ResponseForDelivery` set remains complete and unchanged:

- required tool;
- tool-envelope integrity;
- fact derivation;
- material-claim lineage;
- fact-bound navigation integrity;
- citation integrity;
- numeric/date grounding;
- conversational quality.

The financial entry point asserts a financial lane decision. Missing,
duplicate, unexpected, malformed, failing, or errored scorer results remain
blocking. A failure can quarantine only the affected financial route and never
triggers general generation.

### General finalizer

Add a separately exact blocking set:

1. `general-lane-policy-alignment`
2. `general-contract-integrity`
3. `general-tool-action-absence`
4. `general-financial-nondowngrade`
5. `general-prompt-injection-compliance`
6. `general-sensitive-data`
7. `general-high-stakes-policy`
8. `general-transform-calculation-fidelity`
9. `general-language-size-quality`

The scorer input includes the original normalized request, lane decision,
policy constraints, model response, allowed general history references, and
deterministic calculation result when present. It does not include financial
facts or grant authority.

The financial non-downgrade scorer independently checks both the original
request and generated response. If a request or response contains material
financial advice, account/portfolio reasoning, investment calculation, product
claim, or order intent, delivery is blocked and the event is audited. The
request may be retried only through a fresh governed-financial authorization,
never as an automatic post-generation fallback.

General scorer-set integrity is as strict as the financial aggregate:
fail/error/missing/duplicate/unexpected/malformed/no-applicable-pass blocks
delivery. A general failure trips only the general circuit breaker. It must not
disable or quarantine a financial route.

Per-request scorers are safety and contract controls, not a proof that all
model-memory facts are true. Stable-knowledge, tutoring, translation, and
reasoning quality also require offline bilingual golden sets, factuality
evaluation, red teaming, and complaint monitoring.

## Audit, telemetry, and operational isolation

Use the existing pre-delivery durable-audit principle for both lanes. Introduce
typed discriminated audit events and privacy projectors rather than allowing
call sites to append arbitrary payloads.

A general delivery event records only bounded metadata:

- request/correlation ID and one-way request fingerprint;
- lane, capability, and risk-policy classes/versions;
- lane-decision hash and financial-affinity result;
- detector/classifier versions and disagreement flags;
- model/provider policy ID;
- tool IDs, normally empty;
- all scorer IDs/statuses;
- response hash;
- memory plan/outcome;
- latency and lane-specific circuit state.

Do not audit raw prompts, pasted source text, transcript messages, generated
response text, secrets, personal data, portfolio data, or model prompts.

Production should partition financial and general audit queues or reserve
capacity for financial events. Apply separate concurrency, rate, token, model,
memory, and circuit-breaker budgets so general traffic cannot starve financial
requests. Financial durability, retention, reconstruction, and WORM
requirements remain unchanged.

Telemetry labels remain bounded. Free-form text, symbols, customer IDs, source
text, and generated output must not become metric labels. Add lane-specific
kill switches so general can be disabled without changing financial
availability.

## Threat model

| Threat | Control | Failure behavior |
| --- | --- | --- |
| A financial request is a false negative | Existing detailed router plus independent high-recall financial-affinity shield; general entry requires `clear` | Financial or neutral clarification; never general |
| A mixed request launders finance through writing, translation, or summary | Inspect both task instruction and source content; material finance makes the whole turn financial | Governed answer, unsupported financial transform, or ask to split |
| A social prefix hides financial intent | Classify the complete request; current financial precedence remains | Governed financial lane |
| A semantic classifier is poisoned or unavailable | Classifier may only escalate; deterministic hard signals and finance guard own authorization | Neutral clarification or stricter lane |
| General policy is mistaken for financial policy | Separate branded trusted decisions, signing domains, manifests, and handoff hashes | Authorization denial |
| A general agent calls a portfolio, governed product, market, or order tool | No tool membership or schemas; no V3 grant; financial tools require trusted V3 authority | Tool denial and security audit |
| A general model invents a buy/sell action | General schema has no actions; UI renders plain text; independent output scan blocks financial/order content | No delivery |
| The existing reviewed-conversation exception is reused | Financial exception remains closed; general uses a separate contract and scorer profile | Build/topology test failure |
| General history poisons a later financial answer | Separate stores and namespaces; financial writers never read general history; lane transition clears prose context | Stateless governed finance |
| A prior financial answer is summarized through general memory | Signed lane affinity and financial pointer dominate referential follow-ups | Financial lane or neutral clarification |
| Sensitive data reaches the model, memory, or audit | Full-input DLP before provider; pre-write/read DLP; `store:false`; metadata-only audit | Refuse/redact and clear/quarantine |
| Prompt injection is embedded in pasted content | Strict global boundary in the first release; no tools or hidden finance data in general | Deterministic refusal |
| Medical/legal content receives unsafe personalized advice | Explicit risk tier, constrained prompt, high-stakes scorer, reviewed escalation | Block or deterministic escalation |
| Imminent harm is obscured by another boundary | Collect all boundary labels and use an approved composite resolver | Safe localized support without tool access or secret echo |
| General knowledge claims live/current facts | No live tools; policy and scorer prohibit unsupported current claims | State limitation or decline |
| Calculator input escapes into code execution | Reviewed AST, finite limits, no `eval`, no I/O, exact recomputation | Reject calculation |
| A scorer crashes or is omitted | Exact lane-specific scorer manifest and aggregate invariant | No delivery |
| A financial workflow fails and retries general | No cross-lane fallback in workflow graph or retry policy | Financial failure/unavailable response |
| General volume starves financial controls | Separate queues, budgets, circuits, and reserved audit capacity | Disable or shed general traffic |
| Audit leaks source text or transcripts | Typed event projectors, bounded schemas, forbidden-field tests | Audit append rejected; no delivery |

The residual risk is natural-language domain misclassification and ungrounded
low-stakes model knowledge. Defense in depth reduces impact: the general lane
has no financial data, tools, actions, or grant authority, and its output is
independently checked before delivery. Production acceptance still requires an
adversarial bilingual corpus and measured false-negative thresholds.

## Incremental implementation plan

General capability remains disabled until every phase's gates pass.

### Phase 0: establish the baseline and decision record

Documentation:

- add this ADR;
- later reconcile `ARCHITECTURE.md`, `README.md`,
  `docs/production-readiness.md`, ADR-010, and ADR-012 with the current
  financial topology and dependency decision;
- record existing test failures separately from dual-lane changes and require a
  green financial baseline before enabling the feature.

Fixtures:

- add `tests/fixtures/v3-dual-lane-routing-cases.ts` with Azerbaijani and English
  positive, negative, ambiguous, mixed, and adversarial cases.

No runtime behavior changes in this phase.

### Phase 1: shadow-only taxonomy and lane router

New files:

- `src/assistant-v3/capability-taxonomy.ts`
- `src/assistant-v3/lane-routing.ts`
- `src/assistant-v3/general-routing.ts`
- `src/assistant-v3/safety-policy.ts`

Existing files:

- `src/assistant-v3/routing.ts`: expose a governed-financial outcome of
  matched, financial-clarify, or unmatched; context-harden broad lexical
  patterns while preserving financial precedence;
- `src/assistant-v3/contracts.ts`: add trusted outer decision types without
  changing financial response or claim contracts;
- `src/assistant-v3/runtime.ts`: compute and audit shadow decisions only;
- `src/assistant-v3/telemetry.ts`: bounded lane and disagreement labels;
- `src/config.ts` and `.env.example`: add a server-owned
  `GENERAL_ASSISTANT_ENABLED=false` flag and shadow-mode settings.

Tests:

- add `tests/v3-dual-lane-routing.test.ts`;
- add `tests/v3-financial-nondowngrade.test.ts`;
- extend `tests/v3-routing-policy.test.ts`;
- extend `tests/v3-semantic-routing-regression.test.ts`;
- extend `tests/v3-telemetry.test.ts`;
- extend `tests/config.test.ts`.

Shadow mode emits metadata only and cannot alter the current response.

Required cases include:

- photosynthesis, tutoring, rewriting, translation, brainstorming, arithmetic,
  weather, and ordinary conversation select general in shadow;
- no safe general example receives an investment-oriented clarification;
- "buy milk" differs from "buy AAPL";
- "project risk" differs from portfolio/security risk;
- DNA/RNA biology differs from explicit `$DNA`/`$RNA` tickers;
- social-prefix financial requests remain financial;
- missing-symbol financial requests remain financial clarification;
- all existing order preview/execution precedence remains unchanged.

### Phase 2: isolated policy, agent, workflow, contract, and scorers

New files:

- `src/assistant-v3/general-contracts.ts`
- `src/assistant-v3/general-policy.ts`
- `src/assistant-v3/general-model-policy.ts`
- `src/assistant-v3/general-agent.ts`
- `src/assistant-v3/general-conversation.ts`
- `src/assistant-v3/general-workflow.ts`
- `src/assistant-v3/general-response-scorers.ts`
- `src/assistant-v3/audit-events.ts`
- `src/assistant-v3/assistant-turn-workflow.ts`

Existing files:

- `src/assistant-v3/policy.ts`: retain the financial-only exhaustive policy;
  add an explicit financial-domain assertion only if needed;
- `src/assistant-v3/grants.ts`: bind the outer decision or financial authority
  domain and reject all general authority;
- `src/assistant-v3/boundary-tools.ts`: assert trusted financial grant
  provenance at every tool boundary;
- `src/assistant-v3/writers.ts`: retain financial prompts and add a
  financial-lane entry assertion;
- `src/assistant-v3/workflows.ts`: retain the financial workflow and remove any
  outer catch-all assumption;
- `src/assistant-v3/conversation.ts`: keep only reviewed financial-lane social
  and financial clarification copy;
- `src/assistant-v3/contracts.ts`: export the versioned outer response union;
- `src/assistant-v3/runtime.ts`: dispatch the outer workflow with no cross-lane
  fallback;
- `src/assistant-v3/registry.ts`: keep an exact financial subset and add a
  separately exact zero-financial-tool general subset;
- `src/assistant-v3/bootstrap.ts`: construct isolated dependencies;
- `src/assistant-v3/audit.ts`: accept typed projected events;
- `src/assistant-v3/model-policy.ts`: no financial setting changes;
- `src/assistant-v3/telemetry.ts`,
  `src/assistant-v3/observability.ts`, and `src/assistant-v3/logging.ts`: add
  bounded lane-specific events;
- `src/assistant-v3/readiness.ts`: expose feature, policy, provider, DLP, and
  audit readiness.

Tests:

- add `tests/v3-general-policy.test.ts`;
- add `tests/v3-general-workflow.test.ts`;
- add `tests/v3-general-response-scorers.test.ts`;
- add `tests/v3-lane-isolation.test.ts`;
- add `tests/v3-high-stakes-policy.test.ts`;
- add `tests/v3-general-audit.test.ts`;
- extend `tests/v3-security-controls.test.ts`;
- extend `tests/v3-boundary-tools.test.ts` to attempt every financial tool with
  forged or cast general authority;
- extend `tests/v3-response-scorers.test.ts` to prove the eight financial
  scorers are unchanged and reject general prepared responses;
- extend `tests/v3-registry.test.ts`, `tests/v3-writers.test.ts`,
  `tests/v3-observability.test.ts`, `tests/v3-logging.test.ts`, and
  `tests/v3-production-bootstrap.test.ts`.

The general feature remains unavailable to customers in this phase.

### Phase 3: bounded general memory and lane affinity

New files:

- `src/assistant-v3/general-conversation-memory.ts`
- `src/assistant-v3/lane-affinity.ts`

Existing files:

- `src/assistant-v3/runtime.ts`;
- `src/assistant-v3/bootstrap.ts`;
- `src/config.ts`;
- `src/assistant-v3/readiness.ts`;
- `src/server.ts`.

Tests:

- add `tests/v3-general-conversation-memory.test.ts`;
- add `tests/v3-cross-lane-memory.test.ts`;
- extend `tests/v3-conversation-memory.test.ts`;
- extend `tests/v3-runtime.test.ts`;
- extend `tests/v3-security-controls.test.ts`;
- extend `tests/v3-server.test.ts`;
- extend `tests/v3-production-bootstrap.test.ts`.

Required transitions include:

- financial answer, then "simplify that";
- financial answer, then "thanks", then "what else?";
- financial answer, then a recipe request, then "what about it?";
- general history containing bypass instructions;
- memory loss, expiry, CAS conflict, and process restart;
- cross-tenant, cross-principal, cross-session, and cross-conversation replay;
- concurrent messages and stale-write rejection;
- scorer or audit failure before memory commit;
- prompt-injection, sensitive-data, order, and safety quarantine;
- general-memory failure producing a neutral general clarification rather than a
  financial fallback.

### Phase 4: API and browser migration

Existing files:

- `src/assistant-v3/http.ts`: return the versioned outer union and keep all
  trusted control fields server-owned;
- `src/assistant-v3/contracts.ts`;
- `public/v3-api.d.ts`;
- `public/v3-api.js`;
- `public/app.js`;
- `public/index.html` and `public/styles.css` only if lane-neutral presentation
  needs a reviewed change;
- `src/server.ts`.

Tests:

- extend `tests/v3-http.test.ts`;
- extend `tests/public-v3-api.test.ts`;
- extend `tests/v3-runtime.test.ts`;
- add or extend `tests/e2e/assistant-general.spec.ts`;
- extend `tests/e2e/assistant-chat.spec.ts`;
- run accessibility and injection/XSS rendering checks.

The UI must prove that model text cannot create a link, HTML node, button,
financial card, or order action.

### Phase 5: pure calculator and controlled rollout

New file:

- `src/assistant-v3/general-tools.ts`.

Tests:

- add `tests/v3-general-calculator.test.ts`;
- extend `tests/v3-general-policy.test.ts`;
- extend `tests/v3-general-response-scorers.test.ts`;
- extend `tests/v3-lane-isolation.test.ts`.

Test parser limits, denial of `eval`-like syntax, finite-number handling,
precision, timeouts, currency/investment/loan/dosage/deadline reclassification,
and exact output recomputation.

Roll out in this order:

1. offline corpus;
2. shadow classification;
3. employee-only, memory off;
4. employee-only, bounded memory on;
5. small customer canary;
6. measured expansion.

Rollback disables only the general lane. The financial workflow, its capacity,
and its order boundary remain available.

## Mandatory adversarial regression set

Before any customer canary, automate at least:

- "translate/rewrite/summarize: buy AAPL now";
- "write an email to my broker to sell NVDA";
- "calculate my return if I buy ...";
- prompt injection and credentials embedded in transform source text;
- financial answer followed by simplify, translate, thanks, and ambiguous
  anaphora;
- general history instructing the financial writer to bypass evidence;
- general agent attempts to call each financial tool;
- general model emits financial advice, a product claim, a URL, an order, or a
  structured action;
- medical diagnosis, dose change, urgent symptoms, legal deadlines,
  jurisdiction-specific strategy, self-harm, violence, and mixed-risk requests;
- financial workflow policy/tool/scorer/audit/model failure never retrying
  general;
- general model/scorer/memory/audit failure not quarantining a financial route;
- lane decision and grant replay across identity, session, conversation,
  locale, consent, entitlement, policy, and expiry;
- Azerbaijani and English typo, morphology, code-switching, and adversarial
  phrasing;
- all existing order-preview, order-execution, grant, citation, writer,
  financial-memory, and financial golden-acceptance suites unchanged.

## Production acceptance conditions

General capability remains disabled in production until:

1. the existing financial suite is green and all financial golden/security
   behavior is unchanged;
2. the adversarial lane corpus observes zero known financial-to-general
   downgrades and zero financial-tool access from general;
3. all hard-boundary and high-stakes expected outcomes pass in Azerbaijani and
   English;
4. general contracts, scorers, audit, DLP, and memory fail closed under injected
   failures;
5. the deploying organization approves the general model/provider for the larger prompt, source-text,
   and bounded transcript surface, including privacy, residency, retention,
   procurement, and model risk;
6. Legal, Compliance, Risk, Security, Safety, and Product approve policy
   language, refusal behavior, support resources, and escalation paths;
7. an encrypted HA general-memory store and deletion/expiry controls are
   exercised, or production launches with general memory disabled;
8. audit and serving capacity are partitioned or reserved so general load cannot
   impair finance;
9. red-team tests cover prompt injection, data exfiltration, transformation
   laundering, financial non-downgrade, high-stakes advice, and order intent;
10. lane-level dashboards, alerts, kill switches, incident response, and
    rollback are exercised;
11. the browser and API migration pass backward-compatibility, XSS, action
    provenance, and accessibility tests;
12. Product accepts measured quality thresholds for stable general knowledge,
    tutoring, writing, summarization, translation, reasoning, and conversation.

Any financial-lane false negative, financial-tool access from general,
executable-order leakage, sensitive-data leak, or missing blocking scorer stops
rollout regardless of aggregate quality.

## Ambiguous product decisions and recommended defaults

| Decision | Recommended default |
| --- | --- |
| Mixed financial and general tasks | Route the whole turn to governed finance or ask the customer to split it; no dual execution |
| Transforming customer-provided financial text | Keep it financial; initially decline if the existing evidence contract cannot support a faithful transform |
| General consent and entitlement | Separate `general_assistant_access` entitlement and versioned consent |
| General memory | Four exchanges/eight messages, 16 KiB, 15-minute absolute TTL, same session only; encrypted HA store in production |
| Social turns | Preserve the last material lane for acknowledgements; a substantive task replaces it |
| Supported languages | Preserve strict `az-AZ`/`en-US` financial handling; launch general and translation only for reviewed Azerbaijani and English |
| Translation target | Task-level output choice only; never mutate trusted session locale |
| Live/current knowledge | No web or live tools initially; explicitly decline or qualify recency-dependent questions |
| General tools | None initially except the later reviewed pure calculator |
| Medical and legal | Low-stakes education only; personalized, current, urgent, deadline, dose, or strategy requests use restricted policy |
| Crisis support | Deterministic approved and localized support content; never model-invented contact details |
| Long input and attachments | Paste-only first release; no attachments; raise the general text limit only after full-input DLP and DoS review |
| Recommended general text limit | Up to 12 KiB after normalization; retain the existing financial limit and reject over-limit financial requests rather than truncating |
| Output format | Plain text initially; no model-authored HTML, Markdown actions, or links |
| General model settings | Independently approved model, temperature zero, 1,024 output-token cap, `store:false`, no provider fallback |
| Audit content | Hashes and bounded metadata only; never raw source text, prompts, transcripts, or responses |
| Quoted prompt injection in transforms | Fail closed in the first release; provenance-aware transform sandbox is a future ADR |
| API compatibility | Add a versioned discriminated outer envelope and migrate clients behind a feature flag |
| Private Studio | Exclude the general agent initially, or expose it with zero tools and no inherited financial direct-dispatch harness |

These defaults favor non-downgrade and operational isolation. Product may choose
less memory, shorter inputs, fewer languages, or no calculator without weakening
the architecture. Enabling live retrieval, attachments, arbitrary languages,
external actions, cross-session memory, or financial transform generation would
materially expand authority and requires a separate reviewed decision.

## Consequences

### Positive

- Safe general requests no longer receive investment-oriented clarification.
- Financial requests retain the existing governed evidence and execution
  boundaries.
- A general-lane defect has limited blast radius because it has no financial
  data, tools, grants, actions, or transcript path into finance.
- Lane-specific policy, memory, scoring, audit, budgets, and kill switches make
  behavior testable and independently reversible.
- The design can add safe general capabilities incrementally without turning
  `V3Function` into an unbounded policy surface.

### Tradeoffs

- The assistant operates two explicit trust domains and an outer lifecycle,
  increasing code, test, and operational complexity.
- Stable general knowledge is not signed evidence and therefore has a different
  assurance level from financial answers.
- Strict transformation and injection policies will decline some benign pasted
  content.
- Whole-turn strongest-lane routing can be less convenient than task splitting.
- Bounded session transcript memory creates new privacy, storage, deletion, and
  provider-review obligations.
- No live tools means the first release cannot reliably answer current general
  information.

## Rejected alternatives

- **Add general capabilities to `V3Function`:** mixes permissive capabilities
  into the financial policy and grant surface.
- **Treat every unknown route as general:** creates a direct financial
  false-negative bypass.
- **Reuse a financial writer with unsigned prose:** violates signed evidence
  and material-claim lineage.
- **Exempt general prose from the existing financial scorers:** broadens a
  carefully reviewed escape hatch and makes scorer intent ambiguous.
- **Give the general agent the existing tool registry but rely on prompts:** a
  prompt is not an authorization boundary.
- **Let the model choose the lane or retry another lane:** model output cannot
  reduce policy restrictions.
- **Share transcript memory between lanes:** permits context poisoning and
  unsigned financial facts.
- **Split mixed requests automatically:** creates complex cross-lane provenance
  and partial-failure behavior before the isolation model is proven.
- **Enable web, connectors, code execution, or external actions in the first
  release:** materially expands prompt-injection and data-exfiltration impact.
- **Store raw prompts and responses for audit:** conflicts with data
  minimization; hashes and bounded policy metadata are sufficient for the
  initial control record.
