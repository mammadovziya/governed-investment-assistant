# Customizing the Governed AI Financial Assistant

This guide explains how to adapt the Governed Investment Assistant V3 reference
architecture to another financial product, brand, market-data provider,
knowledge corpus, or supported language. It focuses on reusable architecture,
not on adding canned answers for individual questions.

The repository is an Apache-2.0 internal-pilot demonstration with fictional,
synthetic defaults. Before redistributing a branded fork, verify that you have
rights to every downstream name, corpus, provider, and visual asset; review
third-party data and model terms; and complete the security, privacy, legal,
compliance, and production-readiness work applicable to your deployment.

## Design principle

The model is not the authority boundary. A safe extension keeps this sequence:

```text
untrusted user text
→ safety and execution boundaries
→ deterministic route or bounded semantic plan
→ trusted route compiler
→ policy and one-use tool grants
→ typed provider data
→ signed evidence
→ constrained language composition
→ deterministic value insertion
→ blocking scorers and audit
→ response
```

This division makes the assistant flexible in how users ask questions while
keeping financial facts, tool arguments, permissions, arithmetic, and actions
under deterministic control.

## Project extension map

| Concern | Primary files |
|---|---|
| Capability and locale routing | `src/assistant-v3/routing.ts`, `src/assistant-v3/semantic-frame.ts` |
| Semantic fallback planner | `src/assistant-v3/financial-task-planner.ts` |
| Route authorization and tool allowlists | `src/assistant-v3/policy.ts` |
| Mastra agents and registry | `src/assistant-v3/registry.ts`, `src/assistant-v3/writers.ts` |
| Workflow orchestration | `src/assistant-v3/workflows.ts`, `src/assistant-v3/runtime.ts` |
| Boundary tools and evidence | `src/assistant-v3/boundary-tools.ts`, `src/assistant-v3/evidence.ts` |
| Deterministic presentation | `src/assistant-v3/capability-presentations.ts`, `src/assistant-v3/presentation.ts`, `src/assistant-v3/rendering.ts` |
| Delivery validation | `src/assistant-v3/response-scorers.ts`, `src/assistant-v3/mastra-scorers.ts` |
| Market and research adapters | `src/services/market-data.ts`, `src/services/market-history.ts`, `src/services/security-research.ts`, `src/services/news-sentiment.ts` |
| Portfolio demonstration data | `src/assistant-v3/mock-portfolio.ts` |
| Governed product knowledge | `knowledge/`, `src/assistant-v3/approved-knowledge.ts`, `src/services/knowledge-retrieval.ts` |
| Runtime configuration | `.env.example`, `src/config.ts`, `src/assistant-v3/bootstrap.ts` |
| Demo UI | `public/index.html`, `public/app.js`, `public/styles.css` |
| Verification | `tests/`, `tests/e2e/`, `scripts/verify-production-dist.mjs` |

## Rebrand the demo

1. Choose `ASSISTANT_PRODUCT_PROFILE=generic` to disable the bundled
   product-specific knowledge and guides, or retain `demo-invest` while
   developing against the fictional example pack.
2. Set `ASSISTANT_PUBLIC_BRAND_NAME`, `ASSISTANT_PUBLIC_BRAND_MARK`, and
   `ASSISTANT_PUBLIC_PRODUCT_NAME` for display-only branding.
3. Replace the fictional product documents and manifests under `knowledge/`
   with material you are authorized to store, index, and redistribute.
4. Rename product-specific service identifiers, audit subjects, and
   demonstration principals only through reviewed source changes. Do not turn
   them into customer-supplied request fields.
5. Update the response limitations and production-readiness documentation.
6. Keep synthetic data visibly labeled until authoritative customer adapters
   and identity controls exist.

Search for remaining brand references before publishing:

```bash
rg -n "Demo Invest|demo-invest|tenant:demo" \
  README.md ARCHITECTURE.md docs knowledge public src tests
```

## Add a financial capability

Add capabilities by data contract rather than by writing an answer template for
each expected question.

1. Define the capability identifier and its subject cardinality.
2. Add compositional semantic signals to the deterministic router. Normalize
   language variants once; avoid full-sentence allowlists.
3. If varied wording needs the semantic planner, add only the capability name
   and meaning to its strict schema. The planner must still have no tools and
   no authority to construct arguments.
4. Compile planner output into the same trusted route type used by
   deterministic routing.
5. Declare the exact policy capabilities, consents, entitlements, and boundary
   tools.
6. Add typed tool arguments and results. Bind each call to the request,
   workflow, principal, policy decision, and canonical argument hash.
7. Project signed facts and granular renderable slots. The writer should see
   meanings and placeholders, not raw authoritative values it can alter.
8. Add required-tool, fact-lineage, numeric/date, semantic-role, and
   conversational-quality checks.
9. Add Azerbaijani and English routing, workflow, failure, and adversarial
   regression tests.
10. Update the registry-count test and public capability documentation.

A capability is incomplete if it has a route but no policy, a tool but no
signed fact projection, or a response but no blocking scorer coverage.

## Improve natural-language coverage

The semantic planner is the generality layer for otherwise unmatched, safe
financial questions. It is not a replacement for safety boundaries or a
model-selected tool loop.

For language robustness:

- normalize Unicode and punctuation before matching;
- fold Azerbaijani diacritics and common keyboard transliterations into
  reusable semantic tokens;
- detect slots such as subject, task, time range, currency, comparison, and
  advice class independently;
- keep ticker extraction deterministic;
- validate the number of subjects for the selected capability;
- derive ranges, currencies, and research facets from the current user turn,
  never from the model proposal;
- return clarification when certainty, subject, or authority is insufficient.

Prefer table-driven normalization tests over one test per exact sentence. A
useful matrix includes canonical Azerbaijani, ASCII transliteration, Turkish
keyboard variants, English, reordered noun phrases, punctuation changes, and
short in-session follow-ups.

## Replace the market-data provider

The zero-configuration adapter is project-authored and offline synthetic.
Yahoo is available only through the explicit
`ASSISTANT_DEMO_MARKET_PROVIDER=yahoo-development` opt-in and is not an
approved production feed. Validate your own access and usage rights before
enabling any external provider.

To introduce a licensed provider:

1. Implement the existing market, history, research, and content ports.
2. Normalize provider payloads into the existing domain types.
3. Preserve source identity, observation time, currency, market state, and
   availability instead of filling missing fields from model memory.
4. Apply timeouts, response-size limits, cache rules, and symbol validation.
5. Mark partial and unavailable sections explicitly.
6. Add contract fixtures for malformed, delayed, stale, partial, and
   unavailable responses.
7. Configure production bootstrap to fail closed if the licensed adapter is
   missing.

Do not expose provider credentials, unrestricted URLs, raw payloads, or
customer-controlled provider selection to the writer.

## Replace synthetic portfolio data

`src/assistant-v3/mock-portfolio.ts` exists only for the local pilot. A real
portfolio adapter needs:

- authenticated principal, tenant, account, and entitlement binding;
- authoritative holdings, lots, cash, activity, fees, income, and cash flows;
- snapshot timestamps and reconciliation status;
- fixed-point decimal handling for money and quantities;
- corporate-action and FX treatment;
- field-level data minimization;
- durable revocation and audit semantics;
- tests proving one customer cannot influence or read another customer's
  scope.

Do not accept account IDs, client IDs, portfolio filters, or policy context
directly from the chat body.

## Customize governed RAG

The knowledge path is for approved product information, policies, fees,
disclosures, and support content.

1. Put source documents under `knowledge/sources/`.
2. Add versioned manifests with locale, jurisdiction, approval, effective
   dates, lifecycle, checksum, and product scope.
3. Update the allowlisted knowledge registry.
4. Rebuild the local development index:

   ```bash
   npm run knowledge:ingest
   ```

5. Run retrieval-quality, citation, expiry, revocation, and cross-locale
   isolation tests.

Customer requests must not control approval filters, source URLs, locale
fallback, jurisdiction, effective date, or citation identity. See the
[governed knowledge runbook](knowledge-runbook.md) for the complete lifecycle.

## Add another language

Adding a locale affects more than translation:

1. Extend the locale contract and session validation.
2. Add semantic normalization, route coverage, conversation phrases, and
   deterministic limitation text.
3. Add separately approved knowledge evidence for the locale.
4. Add locale-aware number, money, percent, date, and citation formatting.
5. Extend writer label hints and semantic-role validation.
6. Add paired capability, failure, prompt-injection, and grounding tests.

Do not silently fall back to evidence approved for another locale.

## Change models

The current runtime deliberately locks the primary and complex-composition
models in `src/assistant-v3/model-policy.ts` and `src/config.ts`. A model change
is an architecture and evaluation change, not just an environment-variable
edit.

Review at least:

- structured-output compatibility;
- placeholder and semantic-role fidelity;
- bilingual quality;
- tool isolation;
- prompt-injection behavior;
- timeout and deterministic fallback behavior;
- token and cost telemetry;
- privacy, retention, residency, and provider terms;
- all blocking response scorers and release gates.

Keep model selection deterministic and server-owned. Provider failure must not
silently promote a request to a more capable or more expensive model.

## Traces, metrics, and model cost

For local shared observability, Mastra Studio is the only process that opens
the DuckDB file. Start it before the application:

```bash
# Terminal 1
npm run studio

# Terminal 2
npm start
```

Then open:

- demo application: `http://127.0.0.1:3000`;
- Mastra Studio: `http://127.0.0.1:4111`;
- JSON metrics: `http://127.0.0.1:3000/api/metrics`;
- Prometheus metrics: `http://127.0.0.1:3000/metrics`.

Application traces are privacy-projected across an authenticated loopback
bridge into the Studio-owned `.mastra-observability-shared.duckdb`. Studio
distinguishes application and direct-Studio records by their bounded service
names.

For model cost, sum only the estimated cost attached to total input and total
output token metrics. Detail metrics repeat category costs. The application
counter `investment_assistant_model_estimated_cost_usd_total` is an operational estimate,
not a provider invoice.

Never use prompts, answers, account IDs, request IDs, symbols, source URLs,
errors, or other unbounded customer data as metric labels. See the
[Studio runbook](studio-runbook.md) for privacy and troubleshooting details.

## Safety invariants to preserve

- A model cannot issue a trusted route, policy decision, grant, tool argument,
  fact, citation, calculation, or command action.
- Executable-order language is handled before any semantic fallback planner.
- Customer-workflow writers have no tools or transcript memory.
- Tool calls use route-specific one-use grants and signed envelopes.
- Exact financial values come from typed tools and deterministic calculations.
- A missing fact remains unavailable; it is never completed from model memory.
- Personalized recommendations and unrestricted allocation instructions remain
  outside the implemented advice boundary.
- A read-only preview cannot submit, modify, or cancel an order.
- Every delivered material claim has verified fact or citation lineage.
- Any blocking scorer failure stops delivery.
- Customer inputs, secrets, portfolio data, and raw model text stay out of
  normal telemetry.

## Verification workflow

Run the smallest relevant tests while developing, then the full gates:

```bash
npm run typecheck
npm test
npm run build
npm run security:scan
npm run license:verify
npm run open-source:verify
```

Before a release candidate:

```bash
npm run release:verify
```

For browser flows:

```bash
npm run test:e2e
npm run test:e2e:a11y
```

The internal pilot passing these commands is not evidence of customer
production readiness. Review
[`docs/production-readiness.md`](production-readiness.md) and the production
boundary in the main [README](../README.md#production-boundary).

## Suggested public-repository metadata

If this project is published on GitHub, useful repository topics include:

Suggested repository description:

> Governed bilingual AI financial assistant built with TypeScript, Mastra,
> OpenAI Responses API, signed tool evidence, portfolio analytics, RAG, and
> DuckDB/Prometheus observability.

```text
ai-finance
financial-assistant
investment-assistant
portfolio-analytics
mastra
openai-responses-api
typescript
rag
tool-calling
llm-observability
duckdb
prometheus
azerbaijani
fintech
```

The repository is licensed under Apache-2.0; preserve `LICENSE`, `NOTICE`, and
`THIRD_PARTY_NOTICES.md` in redistributed source. Replace badge or status
claims only when the corresponding public workflow, report, or release exists.
