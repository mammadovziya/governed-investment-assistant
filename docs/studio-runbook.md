# Private Mastra Studio Runbook

Status: local developer/admin topology inspection plus a scrubbed tool playground.

Mastra Studio is not the Assistant V3 customer runtime. It must never be exposed through the customer artifact, an internet listener, or a shared unauthenticated environment.

## Start

Requirements:

- dependencies installed with `npm install`;
- repository lockfile resolved with exact versions `@mastra/core` `1.57.0` and
  `mastra` CLI `1.23.0`;
- `OPENAI_API_KEY` is available server-side, preferably through ignored `.env.local`;
- `OPENAI_MODEL`, if set, is exactly `gpt-4o`;
- `OPENAI_ESCALATION_MODEL`, if set, is exactly `gpt-4.1`;
- `ASSISTANT_STUDIO_EXPOSED` unset or `false`.

The topology page can start without an API key. Application generation and live model smoke tests require a valid OpenAI key with access to both `gpt-4o` and `gpt-4.1`.

Run:

```bash
npm run studio
```

Open [http://127.0.0.1:4111](http://127.0.0.1:4111). The npm script fixes `HOST=127.0.0.1`, supplies the exact `ASSISTANT_PRIVATE_STUDIO_LAUNCH=local-loopback` profile required by Mastra's production-mode dev bundle, and starts Mastra from `src/assistant-v3`.

When `MASTRA_OBSERVABILITY_SHARED=true`, Studio is the sole physical DuckDB
owner. Start Studio first and wait for port 4111 to become ready before starting
the application with `npm start`.

## Expected topology

Studio must display exactly:

- four agents: `financial-task-planner`, `public-research-writer`,
  `portfolio-insight-writer`, and `approved-knowledge-writer`;
- eight entries on the workflow page: five online workflows (`assistant-request-v3`, `public-research-v3`, `portfolio-insight-v3`, `approved-knowledge-v3`, and `order-ticket-handoff-v3`) plus three Mastra-materialized processor workflows (`public-research-writer-output-processor`, `portfolio-insight-writer-output-processor`, and `approved-knowledge-writer-output-processor`);
- thirteen tools: `resolve-instrument`, `read-market-snapshot`,
  `read-price-history`, `read-instrument-research`, `read-market-content`,
  `convert-currency`, `analyze-portfolio-allocation`,
  `read-portfolio-snapshot`, `read-portfolio-activity`,
  `retrieve-reviewed-investment-education`,
  `retrieve-approved-product-knowledge`, `read-order-eligibility`, and
  `create-signed-order-handoff`; and
- nine scorers: eight blocking customer-response scorer adapters plus `v3.agent.direct-tool-grounding` for direct specialist chat.

Any different count or identifier is registry drift and must block promotion.

## Tool playground data profile

Mastra derives the reserved `mastra__isStudio` value from the `x-mastra-client-type: studio` header; request JSON cannot set it. The header is a local component-profile selector, not authentication. This is safe only because Studio is loopback-only and the harness exposes public development data, fixed synthetic data, and approved documents—never customer adapters or an order write. For each permitted read/preview call, the local broker creates a short-lived synthetic session, evaluates the normal V3 route and policy, and issues a one-use grant bound to the exact tool and canonical arguments. The signed-handoff write is denied before session, policy, or grant issuance. Caller-supplied grants, tenant IDs, principals, accounts, URLs, filters, and policies are ignored or rejected.

The available evidence is deliberately scrubbed:

- public instruments, quotes, and price history use the offline synthetic adapter by default; current issuer research and news remain explicitly unavailable;
- USD/AZN conversion uses the official Central Bank of Azerbaijan rate; current-portfolio conversion revalues the synthetic Studio portfolio first;
- portfolio snapshot and activity use only the synthetic Studio principal;
- approved knowledge uses a process-memory approved-document index with server-owned eligibility filters;
- order eligibility uses the synthetic internal-pilot policy; and
- signed order handoff remains disabled and returns a structured `unavailable` envelope. It cannot create or execute an order.

Set `ASSISTANT_DEMO_MARKET_PROVIDER=yahoo-development` only as an explicit local opt-in after validating your own access and usage rights. Yahoo is indicative and development-only; it is never selected for staging or customer-production. Tool outputs remain signed `ToolExecutionEnvelope` records. Studio receives no customer prompt, account, ledger, or identity data. Direct developer runs retain their complete input/output and log-message text in the Studio-owned shared DuckDB; request context, identifiers, and structured raw errors are removed before persistence.

## Test direct Agent chat

The three Agent pages are usable component harnesses. Their tools resolve dynamically only when Mastra supplies the reserved Studio context; the same agents resolve no tools in customer/workflow writer mode. For a factual direct turn, deterministic dispatch selects one bounded tool and a signed-output processor replaces any untrusted model prose with values verified from that tool envelope.

Use these smoke prompts:

- Public Research Writer: `What is the current MSFT price?` → `read-market-snapshot`;
- Portfolio Insight Writer: `Show my recent trading activity` → `read-portfolio-activity`;
- Approved Knowledge Writer: `How do I add virtual cash to Demo Invest?` → `retrieve-approved-product-knowledge`.

After each run, the chat must display the evidence calls. Open **Scorers** to confirm `Direct specialist signed tool grounding` is registered for all three writer agents; the tool-less planner has no direct-tool scorer. An ordinary factual run must produce score `1` with the privacy-safe reason `pass:signed_tool_envelope_verified`. An explicit two-ticker comparison is the only multi-call exception: it must make exactly two signed `read-instrument-research` calls, one for each named ticker, and produce `pass:signed_two_instrument_research_envelopes_verified`. Missing, unsigned, tampered, mismatched, unsuccessful, semantically unrelated, duplicate, or any other multiple evidence calls score `0`. Greeting-only, reviewed clarification/education turns, and workflow-writer calls are not applicable.

## Observability

The private Studio enables Mastra Observability with always-on sampling and a
bounded storage exporter. After a direct Agent run:

- **Observability → Traces** must show the agent/tool execution;
- **Metrics** must expose bounded operational series, including
  `mastra_model_total_input_tokens` and
  `mastra_model_total_output_tokens` after a model generation;
- **Logs** must contain the complete info-or-higher Mastra event messages; and
- score records must remain linked to the run where Mastra emits that link.

The approved model token detail series cover text, cache read/write, reasoning,
audio, and image counts when the provider reports them. Input plus output is the
base total; detail counts are subsets and must not be summed on top. The export
boundary accepts token usage only from a `model_generation` span, checks bounded
non-negative integers and internally consistent detail totals, and keeps only
the locked provider/model values.

Mastra attaches a locally estimated `estimatedCost` and `costUnit` to recognized
model token metrics. In **Metrics**, filter to
`mastra_model_total_input_tokens` and
`mastra_model_total_output_tokens`, then sum their estimated cost for the
generation. Do not include text, cache, reasoning, audio, or image detail rows
in that cost sum because their component costs are also represented by the
total rows. The estimate comes from Mastra's bundled pricing registry; OpenAI
returns the token usage used for the estimate, not the final billed amount.

The private, loopback-only Studio trace boundary retains input/output and full
log-message text so local developer runs can be inspected. It still removes
metadata, request context, identifiers, high-cardinality labels, UUID labels,
URLs, tickers, and structured raw error details. Use only public, approved, or
synthetic content in Studio; customer application telemetry remains redacted.

In the default local shared mode, Studio is the only process that opens
`.mastra-observability-shared.duckdb`. The application sends its already
privacy-projected signals to authenticated endpoints on `127.0.0.1:4111`; it
never opens the DuckDB file as a second writer. Studio can therefore read traces,
metrics, logs, scores, and feedback from both runtimes. Filter by
`governed-investment-assistant-v3` for application records or
`governed-investment-assistant-v3-studio` for direct Studio records. This is a private
local developer topology, not an approved shared administrator deployment.

## Editor

The Agent pages expose Mastra Editor in `code` source mode. For all three V3
agents, only the description of an already code-owned tool may be changed.
Instructions, tool membership, the locked model, workflows, scorers, memory,
policy, and runtime settings are not editable.

Editor changes are written as reviewable files under
`src/assistant-v3/editor-overrides`. Treat generated files exactly like source:
review the diff, run `npm run check` and `npm run build`, then commit through the
normal review path. The application bootstrap intentionally does not mount a
Mastra Editor, so a Studio draft cannot alter customer-runtime behavior.

The eight `v3.response.*` scorers are not ordinary per-agent chat scorers. They require the customer runtime's trusted route, policy, exact tool arguments, signed fact graph, citations, rendered values, and action authorization. They execute as a blocking delivery gate inside the application workflow and are also registered in Studio for inspection. An Agent page showing a disabled **Evaluate** tab does not mean these controls are absent; inspect **Scorers**, or test the complete response through the application API.

The five workflow pages remain topology inspection surfaces because Studio cannot legitimately supply the customer HTTP edge's one-use trusted context token. Use the application for the complete authenticate → route → policy → workflow → tools → scorers → audit lifecycle:

Use these surfaces for real pilot behavior:

- the application at [http://localhost:3000](http://localhost:3000);
- `POST /v1/assistant/sessions` followed by `POST /v1/assistant/messages`;
- the automated unit, workflow, and API-contract suites; and
- a manual local browser check only as a development aid.

Browser E2E and accessibility automation runs in CI. A passing browser suite or
manual Studio run is not evidence that performance, SLO, penetration, recovery,
or customer-integration release gates pass.

Studio receives only the application's privacy-projected observability records
through the authenticated loopback bridge. It does not receive raw customer
input/output, customer adapters, or the application's principal-bound suspended
order state. Do not weaken the disabled adapters for convenience.

Application workflows and Studio workflows must also use physically separate
LibSQL databases. The application reads `MASTRA_STORAGE_URL`; Studio reads
`MASTRA_STUDIO_STORAGE_URL`. Never point both variables at the same URL. Studio's
loopback workflow-run APIs are a developer inspection surface and must contain
only Studio synthetic/public diagnostic runs, not application request snapshots.

## Agent thread memory

The three Agent pages have thread-backed memory enabled. Direct Studio chats
are saved in the private Studio LibSQL database and recall the latest ten
messages from the current thread. Semantic cross-thread recall, generated
titles, and working-memory profiles are disabled. Use only live public,
approved-document, or fixed-synthetic content in these chats; never paste
customer prompts, identifiers, portfolio data, or order details into Studio.

This does not change customer behavior. The application registry does not mount
Mastra transcript memory into writer agents. Pilot continuity remains a
separate signed, bounded subject-and-intent context committed after scoring and
audit. Public `/api/health` and `/api/ready` expose only minimal liveness and
aggregate readiness. Sanitized memory and registry diagnostics are available
only on the internal-pilot routes `/api/internal/diagnostics/readiness` and
`/api/mastra/capabilities` with the configured diagnostics bearer token. A remembered Studio message is conversation context,
never financial evidence; every factual direct turn must still use and verify a
fresh boundary-tool result.

## Troubleshooting “Studio could not reach the Mastra server”

1. Confirm the terminal running `npm run studio` remains active and has no startup exception.
2. Confirm port 4111 is listening only on loopback.
3. Open `http://127.0.0.1:4111`, not a LAN address or container hostname.
4. Confirm another process is not already using port 4111.
5. Confirm the server process loaded `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4o`, and `OPENAI_ESCALATION_MODEL=gpt-4.1`; never paste the key into logs or the tracked example file.
6. Start through `npm run studio`; confirm its local-loopback profile is intact and `ASSISTANT_STUDIO_EXPOSED` is not truthy.
7. Restart the Studio command after correcting environment or port conflicts.

If a tool still shows the generic `Error executing dev tool` toast, first reload Studio so its client reconnects to the current server, then confirm the command was started through `npm run studio`. A normal playground execution should return either a signed success envelope or a signed structured-unavailable envelope, not a rejected HTTP call.

## Production artifact exclusion

The private Studio is a separate development command, not a runtime feature flag. `npm run build` excludes `src/assistant-v3/index.ts`, every `src/assistant-v3/studio-*` module, `src/assistant-v3/editor-overrides/**`, and the synthetic/offline-only `src/assistant-v3/shadow-evaluator.ts`. The container prunes `mastra`, `@mastra/editor`, and `@mastra/memory` because they are development dependencies, and it copies only the application `dist`, static pilot UI, and production dependencies.

Release verification must confirm that no Studio entry point, Studio-only module, Editor draft, shadow evaluator, Studio transcript database, or local observability DuckDB is present in the customer artifact. Do not add `npm run studio`, port 4111, or Studio storage environment variables to the customer deployment.

The application-only internal-pilot Compose profile explicitly sets
`MASTRA_OBSERVABILITY_SHARED=false`; it does not start Studio or use the
loopback bridge.

## Shared admin deployment

There is no approved shared Studio deployment in this repository. A future administrator instance requires a separate artifact and threat model, SSO/MFA, private network access, scrubbed read-only data, least-privilege roles, short retention, administrator audit, and explicit Security/Compliance approval. It remains excluded from customer-production readiness.
