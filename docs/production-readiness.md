# Assistant V3 Production Readiness Boundary

Status: implemented for an internal pilot; not approved for customer production.

Process liveness, selected-target readiness, and customer-production readiness are separate decisions. The unauthenticated `GET /api/health` response is a constant minimal liveness contract and performs no dependency calls. `GET /api/ready` returns only aggregate selected-target status and generic error codes; dependency checks are single-flighted and cached for a bounded short TTL. It exposes no model, provider, index, topology, or blocker details. A `customer-production` process can therefore start for orchestration and deployment inspection even while required integrations are absent: it mounts a non-networking unavailable market/research/history adapter, keeps all public-market operations blocked, and reports a generic `503` readiness result. Development and test pilots use a project-authored offline synthetic market provider by default. Yahoo is constructed only when `ASSISTANT_DEMO_MARKET_PROVIDER=yahoo-development` is set explicitly for a development/test `internal-pilot`; it is never initialized in staging, production, or a customer-production target. The internal-pilot-only `GET /api/internal/diagnostics/readiness` route reports detailed sanitized diagnostics only when a valid `ASSISTANT_INTERNAL_DIAGNOSTICS_TOKEN` bearer token is supplied; the same guard protects `/api/mastra/capabilities`. The token is an optional URL-safe 32–512 character secret. When it is unset, both routes behave as absent and always return a safe `404`; a malformed configured token fails startup. Both detailed diagnostic routes are also absent in the customer-production target.

Internal-pilot dependency readiness uses bounded, independently timed probes: exact model metadata availability (not a billable generation), fresh canonical snapshots for the fixed AAPL, NVDA, and BND coverage set, a 384-dimension knowledge index with every required core facet eligible in both `en-US` and `az-AZ`, a signer sign/verify round trip, audit-chain verification plus a read-only durable-path access preflight, a one-row workflow-storage read, and an observability flush plus metrics serialization check. In local shared-observability mode, the final observability check uses the authenticated loopback bridge to probe Studio's shared store; non-shared mode uses the application's configured store directly. Probe exceptions are discarded and represented only by fixed diagnostic codes. The probes never create a customer session, invoke an assistant workflow, append an audit event, or create/confirm/open an order handoff. Readiness intentionally does not run a model generation, submit an OMS request, prove sustained bridge delivery, or prove future disk writes against races after the access preflight; those remain smoke, synthetic-monitoring, and deployment-platform responsibilities.

## Implemented for the internal pilot

| Control | V3 implementation |
|---|---|
| Framework lock | The validated lockfile resolves `@mastra/core` to `1.57.0` and the private Studio CLI to `mastra` `1.23.0`; V3 is the assistant architecture revision, not a Mastra major version |
| Bounded orchestration | Exact Mastra topology of three constrained writer agents plus one tool-less planner, five deterministic workflows, thirteen boundary tools, eight blocking response scorers, and one direct-Studio diagnostic scorer |
| Model lock | OpenAI Responses API with `gpt-4o` primary and deterministic `gpt-4.1` complex-composition tier; temperature `0`, 256-token output ceiling, `store: false`, no provider-error fallback |
| Trusted request boundary | Server-issued session and conversation identifiers; the V3 API rejects customer-supplied client/account IDs, policy filters, tool arguments, and conversation IDs |
| Conversation continuity | Signed deterministic control-plane context retains only an allow-listed public subject and intent after an audited success; five-minute TTL, 10,000-entry cap, three-hop limit, and tenant/principal/session/conversation binding |
| Identity/consent ordering | Synthetic pilot principal, tenant, consent, and entitlements are checked before routing or tool execution |
| Routing and policy | Deterministic AZ/EN routing; router/policy disagreement fails closed |
| Least privilege | Exact one-use grants bind the request, workflow, principal, policy, tool, and canonical argument hash |
| Financial correctness | Deterministic services calculate portfolio, P&L, fee, technical, risk, sentiment, and notional facts; authoritative money uses fixed-point decimal arithmetic and agents do no arithmetic |
| Provenance | Signed tool-result → fact → claim lineage with exact result and argument hashes |
| Response safety | Eight independent P0 delivery scorers cover required tools, tool-envelope integrity, fact derivation, material-claim lineage, fact-bound navigation integrity, citation integrity, numeric/date grounding, and conversational quality |
| Read-only navigation | Portfolio value, cash, recent activity, and single-symbol quote answers may attach one exact catalog-owned local action only after the independent scorer re-verifies its signed fact, tool ancestry, card binding, route, context, label, and static GET-only path |
| Scorer semantics | `pass`, `fail`, `not_applicable`, and `error` are distinct; a fail, error, missing scorer, duplicate scorer, invalid scorer result, or no applicable passing scorer blocks delivery |
| RAG governance | Exact locale, AZ jurisdiction, approval, channel, product, lifecycle, and effective-date filters run before ranking; citations are validated and missing/conflicting evidence fails closed |
| Order boundary | Preview plus explicit confirmation; Mastra suspend/resume creates only a five-minute, one-use, principal-bound signed handoff reference; the pilot consumes it once into a sanitized `/orders/preview` state with submission disabled and all OMS checks marked pending |
| Audit durability | Each delivered material response is appended to a local JSONL SHA-256 hash chain and `fsync` completes before response delivery |
| Workflow privacy | Ordinary customer workflows disable snapshots; the order-confirmation snapshot required for suspend/resume is held only in a volatile process-local workflow domain. File-backed LibSQL stores never receive customer prompts, bearer tokens, or intermediate workflow facts |
| Telemetry | In default local shared mode, Studio is the sole physical owner of `.mastra-observability-shared.duckdb`; the application sends already privacy-projected traces, metrics, logs, scores, and feedback over an authenticated `127.0.0.1` bridge. Studio reads both sources from that database and distinguishes `governed-investment-assistant-v3` from `governed-investment-assistant-v3-studio`. The application boundary removes raw input/output, request context, identifiers, portfolio values, grants, credentials/session tokens, URLs, model content, and raw errors while retaining only bounded numeric model-token usage and locked provider/model identities on model-generation spans |
| Editor governance | Private Studio uses code-source Editor files and permits tool-description changes only; instructions, tool membership, model, workflows, scorers, and policy remain code-owned, and the customer bootstrap mounts no Editor |
| Studio memory | Private Studio Agent chats persist as local LibSQL threads with ten-message current-thread recall; semantic recall, working-memory profiles, customer data, and customer-runtime transcript memory remain disabled |
| Capability containment | A P0 gate failure disables the affected capability until process restart; V3 also has an application kill switch |
| Studio isolation | Loopback-only private Studio with a physically separate LibSQL memory/non-workflow database, volatile workflow domain, and sole ownership of the shared local observability DuckDB; application telemetry reaches it only after privacy projection and through the authenticated loopback bridge. Direct agent tools resolve only under Mastra's reserved Studio context and receive one-use grants over live development public data or synthetic fixtures, never customer data; signed handoff and configured customer exposure fail closed |
| Production artifact boundary | `npm run build` excludes the Studio entry point, Studio-only modules, Editor overrides, and the synthetic/offline shadow evaluator; the container prunes Studio CLI, Editor, and Studio-memory development dependencies |
| Pilot packaging | Multi-stage, non-root container; loopback-only application-only internal-pilot Compose profile with `MASTRA_OBSERVABILITY_SHARED=false`, a read-only root filesystem, dropped capabilities, `no-new-privileges`, and a persistent local data volume |
| CI baseline | Type checking, unit/integration tests, production build, tracked-source credential-pattern scan, moderate-or-higher dependency audit, and a 30-day CycloneDX dependency-SBOM artifact; the no-push container job retains a 30-day OCI archive with attached SPDX SBOM and maximum-mode SLSA provenance, extracted exact in-toto statements, Buildx metadata, image/commit context, SHA-256 checksums, and the Buildx build record |

The pilot deliberately uses a synthetic client ledger and an offline synthetic market feed. Values and history are generated locally, are not current market observations, and cannot support current-news or issuer-fundamental claims. Developers can opt in to the Yahoo development adapter only after validating their own rights; it remains indicative, development-only, and unavailable to customer-production.

Local durability has an explicit limit: scrubbed application and private-Studio observability records coexist in the Studio-owned shared DuckDB and survive a normal restart, as do private Studio chat threads and the audit file. Workflow snapshots, session authority, bounded customer conversation context, and suspended order-handoff state remain process-local. Ordinary customer workflows create no snapshots; only an active order-confirmation suspension occupies the volatile workflow store. The customer conversation store is not a transcript or profile store: it excludes prompts, responses, facts, financial values, account/order data, and citations, and it is never exposed as customer-runtime writer-agent memory. Studio threads are a separate developer-only transcript store restricted to public, approved, and synthetic data. The shared DuckDB is private local developer storage and is not approved for raw customer content. Local LibSQL, embedded DuckDB, process memory, and a local JSONL hash chain are not highly available, centrally retained, or independently tamper-evident storage.

An upgrade does not silently delete workflow snapshots written by an older build. Operators must stop the prior processes and explicitly archive or remove historical development database files according to the approved local-data retention procedure before the workspace is shared or retained.

The order review page is also a pilot-only safety demonstration. It proves signed handoff verification, one-use consumption, and secret-free browser state, but it cannot execute and does not perform authoritative OMS checks. A customer release requires the deploying institution's existing order screen to revalidate current price, fees, available balance, disclosures, suitability/eligibility, authentication, and final user intent.

## Automatic customer-production blockers

Customer-production readiness is `false` when any of these P0 conditions is present:

| Blocker | Affected capability | Required replacement |
|---|---|---|
| `MOCK_IDENTITY` | All | Institution-managed OIDC, authentication strength, tenant/account entitlements, and device/session risk |
| `UNAUTHENTICATED_SESSION_EDGE` | All | Gateway-authenticated session creation; anonymous self-issued privileged sessions are forbidden |
| `SYNTHETIC_LEDGER` | Private portfolio | Read-only authoritative ledger adapter with reconciliation and signed input snapshots |
| `UNLICENSED_MARKET_FEED` | Public market | Approved licensed feed with entitlement, attribution, redistribution, delay, and retention controls |
| `DEVELOPMENT_SIGNING_KEY` | Order handoff | Managed, rotated, non-development signing keys and independent verification |
| `SYMMETRIC_PROCESS_SIGNER` | All | Purpose-bound managed asymmetric signing with rotation, revocation, and independent verification |
| `LOCAL_STORAGE` | All | Approved remote HA storage, backups, PITR, migrations, encryption, and residency controls |
| `PROCESS_LOCAL_AUTHORITY_STATE` | All | Atomic distributed session, grant, revocation, quarantine, and one-use handoff state |
| `LOCAL_AUDIT_CHAIN` | All | Transactional outbox and independently retained tamper-evident/WORM archive |
| `UNAUTHENTICATED_LEGACY_ROUTES` | All | Remove or authenticate compatibility, portfolio, market, research, metrics, and streaming routes |
| `EXTERNAL_MODEL_GOVERNANCE` | All | Approved OpenAI data-processing, privacy, residency, procurement, and model-risk controls |
| `UNCONTROLLED_KNOWLEDGE_APPROVAL` | Approved knowledge | Controlled Legal, Compliance, Product, or Research approval for each exact source version and effective interval |
| `SYNTHETIC_ORDER_HANDOFF` | Order handoff | Institution-managed order-screen integration that independently revalidates every material check |
| `PROCESS_LOCAL_CONVERSATION_MEMORY` | All | Disable conversation memory or use an approved encrypted HA TTL store with bounded eviction and atomic tenant/principal/session isolation |
| `STUDIO_EXPOSED` | All | Remove Studio from the customer artifact; separately protect any admin Studio with SSO/MFA and network controls |

## Additional requirements before customer use

| Domain | Required addition or evidence |
|---|---|
| Consent and privacy | Authoritative versioned consent, DLP/masking proof, retention/deletion/legal hold, and approved reconstruction vault |
| Knowledge | Controlled Legal/Compliance/Product approvals for every exact AZ/EN source checksum and effective interval; `official_publication` alone is insufficient |
| Audit | Transactional outbox, independently operated publisher, customer-controlled tamper-evident archive, reconstruction tooling, retention, and legal hold |
| Distributed state | Durable server-side sessions, idempotency, one-use handoff state, replay prevention, and multi-instance consistency; conversation memory disabled or backed by an encrypted HA TTL store with deterministic eviction |
| Policy | Legal/Risk-approved policy versions, independent enforcement, escalation integration, and audited kill switches |
| Operations | WAF/gateway authorization, distributed rate limits, circuit breakers, dependency budgets, alerts, on-call runbooks, SLO evidence, capacity and disaster-recovery tests |
| Security | Threat model, key management, egress allow-lists, supply-chain review, penetration testing, tenant-isolation proof, and secrets scanning |
| Quality | Separately passing AZ/EN golden, adversarial, property, failure-injection, browser accessibility, performance, RAG, and numeric replay gates |
| Order handoff | OMS-side revalidation of price, fees, balance, disclosures, suitability/eligibility, authentication, and final user confirmation |
| Governance | Legal, Compliance, Risk, Security, Product, Operations, Model Risk, and regulatory approvals |

## Current evidence not yet available

The repository CI establishes a useful code and packaging baseline; it is not customer-production acceptance evidence. The following gates are not currently implemented or retained as passing release artifacts:

- browser E2E and accessibility automation for bilingual chat, citations, charts, and the complete handoff review flow;
- capacity, load, soak, failover, and measured SLO tests;
- an independent penetration test, threat-model sign-off, and production tenant-isolation assessment;
- disaster-recovery, backup restoration, key-rotation, incident, rollback, and kill-switch exercises;
- a governed live OpenAI smoke test in a provider environment approved by the deploying organization;
- retained local Ollama writer-contract results are optional development
  diagnostics only and do not satisfy that governed provider smoke gate;
- customer-production API/gateway, identity/ledger/market-data/knowledge/OMS integration tests; and
- formal Legal, Compliance, Risk, Security, Product, Operations, Model Risk, and regulatory approvals.

Do not describe these gates as passing based on unit tests, Studio runs, a local browser check, or a successful container build.

## Required acceptance evidence

Before any customer-production claim, retain evidence that:

- all eight required MVP prompt families pass in Azerbaijani and English, including typo, morphology, code-switching, and multi-turn variants;
- route accuracy is at least 98% independently for each locale;
- tool arguments, hashes, fact derivations, numeric replay, and material claim lineage pass 100%;
- there is zero cross-tenant disclosure, consent bypass, invalid-signature acceptance, mutation capability, ungrounded number, uncited material claim, telemetry PII, or audit bypass;
- conversation context passes symbol/intent carryover, tenant/principal/session isolation, TTL/eviction, hop-limit, tamper, failure-injection, and sensitive-data non-retention tests while every writer remains transcript-memory-free;
- governed RAG meets Recall@5 at least 0.90, MRR at least 0.90, and nDCG@5 at least 0.85 per locale/facet, while revoked, expired, conflicting, or wrong-locale evidence produces no factual answer;
- failure injection covers OpenAI, market, portfolio, RAG, policy, signer, storage, and audit dependencies;
- browser E2E covers portfolio answers, research cards, citations, charts, order preview/confirmation, and accessibility;
- `npm run check`, `npm run build`, API contracts, and a live OpenAI smoke test pass; and
- measured service levels meet the approved targets: 99.9% capability availability, deterministic p95 no more than 3 seconds, and generated research/RAG p95 no more than 12 seconds.

Passing aggregate scores cannot override a P0 control failure. The affected capability remains disabled until the failure is corrected and the blocking gate passes again.
