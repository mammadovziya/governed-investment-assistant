# Governed Knowledge Runbook

Status: operating guide for the Assistant V3 internal pilot; not authorization for customer deployment.

## Purpose and boundary

This runbook covers ingestion, retrieval, verification, monitoring, and incident handling for configured product documents, disclosures, fees, policies, and published research.

The repository seeds original, fictional Demo Invest passages in Azerbaijani and English. They are authored for this project, distributed under the repository licence, and use canonical references below the reserved `knowledge.demo-invest.invalid` namespace. Those references are immutable evidence identities, not live websites or claims of affiliation with a financial institution. The records use the legacy approval-basis value `official_publication` to exercise the publication path; that value is not Legal or Compliance approval.

Before production, Knowledge Operations must replace the fictional corpus with content the deployer is entitled to use, plus immutable internal Legal/Compliance approval references and an accountable product/content owner. Production policy must reject an official-publication-only record.

## V3 runtime and Studio boundary

Governed questions enter through `POST /v1/assistant/messages` with a server-issued session. The deterministic router selects the `approved-knowledge-v3` workflow. That workflow, not the model, invokes `retrieve-approved-product-knowledge` with a one-use grant bound to the request, workflow, principal, policy decision, and canonical server-derived query context.

The customer cannot submit locale overrides, jurisdiction, approval state, product scope, lifecycle state, effective date, vector filters, source URLs, or tool arguments. Those values come from trusted session and policy context. In customer/workflow mode the `approved-knowledge-writer` resolves no tools and receives only bounded semantic fact/citation references; exact dates, governed wording, and citation display are inserted and checked deterministically. Its loopback Studio diagnostic view may call only `retrieve-approved-product-knowledge` through the fixed synthetic profile and signed-envelope renderer.

Before delivery, the V3 P0 gate verifies the required tool set, signed tool envelope, fact derivation, material claim lineage, citation eligibility/integrity, exact numeric/date grounding, and conversational quality. Any fail or scorer error blocks the response. A successfully delivered result is appended to the local hash-chained audit outbox and flushed before return.

Local operating sequence:

```bash
npm run knowledge:ingest
npm start
curl http://localhost:3000/api/ready
```

The public readiness response shows only aggregate selected-target status. To inspect the internal-pilot index, configure the diagnostics token through an approved secret source and run:

```bash
curl \
  -H "Authorization: Bearer $ASSISTANT_INTERNAL_DIAGNOSTICS_TOKEN" \
  http://localhost:3000/api/internal/diagnostics/readiness
```

The authenticated diagnostic response must show an available approved-knowledge index. Never put the token in a URL, command history shared with others, or logs. Ingestion creates or verifies an immutable generation; it must not mutate a live generation in place.

`npm run studio` starts a loopback-only Mastra Studio at `127.0.0.1:4111`. Its component-level knowledge tool uses a process-memory index of the repository's approved demonstration documents and a fixed synthetic principal. Mastra derives the Studio selector from a client header, so it is not authentication; isolation comes from loopback binding and the absence of customer adapters. Permitted reads still receive a one-use policy grant and apply server-owned locale, jurisdiction, approval, product, channel, and effective-date filters; the signed-handoff write is denied before grant issuance. The playground does not exercise final response scorers or audit, is not a customer-data surface, and must never be exposed to customers.

The pilot vector index and Mastra workflow store are local LibSQL files. The pilot audit outbox is a local `fsync`-committed JSONL hash chain. Customer production requires approved HA storage and an independently operated tamper-evident audit publisher/archive.

## Pilot coverage and known gaps

The repository's demonstration corpus currently covers, in both Azerbaijani and English, commissions, account opening, funding, withdrawal, the product overview, market hours, and the share-purchase process. The Azerbaijani corpus also contains one margin-risk disclosure and one time-bounded research item. General investment concepts use a separate query-bound, bilingual approved-education retriever. It returns signed source propositions and citations for model composition; it does not select a stored answer or topic template.

The following product-specific facets intentionally return `NO_ELIGIBLE_EVIDENCE`: protection or insurance of securities and cash, custody and registration name, the complete list of tradable instruments, the sale process, taxation, and trading restrictions. They must remain unavailable until Knowledge Operations onboards an exact-locale authoritative source with an effective interval, documented usage rights, and the required production approvals. A generic product page, fee schedule, funding page, or withdrawal page must never be used as a substitute.

Useful bilingual demo questions include:

- `What is the Demo Invest product?`
- `How do I add virtual cash to the Demo Invest sandbox?`
- `Demo Invest nümunə komissiyaları necə hesablanır?`
- `Demo Invest sifariş önbaxışı necə işləyir?`

An unclassified `general` query has no eligible document types. This is deliberate: it prevents a generic word such as “investment,” “shares,” or “trading” from selecting an unrelated source. Every newly supported FAQ family requires a deterministic facet, an authoritative document type, bilingual negative tests, and a new immutable index generation.

## Roles

| Role | Responsibility |
|---|---|
| Source owner | Owns accuracy, locale, product scope, effective interval, and replacement timing |
| Knowledge Operations | Acquires, normalizes, versions, checksums, chunks, indexes, revokes, and reconstructs content |
| Legal/Compliance | Approves the exact source version, purpose, jurisdiction, locale, disclosures, and customer wording |
| Security | Reviews acquisition, content scanning, prompt-injection handling, access, encryption, and telemetry |
| Model/Retrieval owner | Owns ranking configuration, thresholds, bilingual evaluation, and model allow-lists |
| Service owner | Owns SLOs, metrics, alerts, rollback, and incident response |
| Independent reviewer | Confirms that evidence and response can be reconstructed from immutable records |

One person may cover several roles in a local demo. Production promotion must preserve the deployer's required separation of duties.

## Evidence metadata contract

Every source version and every derived chunk must resolve to the following metadata:

| Field | Requirement |
|---|---|
| `sourceId` | Stable logical source identifier |
| `version` | Immutable source-version identifier; never reused for changed content |
| `title` | Human-readable source title in the declared locale |
| `documentType` | Bounded value: `product_doc`, `fee_schedule`, `policy`, `disclosure`, or `research` |
| `url` | Verified canonical official URL or approved document-registry reference |
| `locale` | Exact supported locale; currently `az-AZ` or `en-US` |
| `jurisdiction` | Exact jurisdiction; currently `AZ` |
| `productScopes` | Bounded product/capability identifiers, never free-form customer data |
| `facets` | Bounded answer domains such as `fees`, `funding`, or `withdrawal`; retrieval must match the query facet exactly |
| `ownerTeam` | Accountable content or product owner |
| `approvalStatus` | Bounded lifecycle state such as `pending`, `approved`, `revoked`, or `expired` |
| `approvalBasis` | Demo value `official_publication`, or an approved production basis |
| `approvals` | Role, actor, immutable decision reference, and decision time; production requires the governed Legal/Compliance records |
| `effectiveFrom` | First valid UTC date/instant for use |
| `effectiveTo` | First invalid UTC date/instant, or `null` for an explicitly governed open-ended interval |
| `publishedAt` | Source publication timestamp when supplied by the publisher |
| `verifiedAt` | Source verification/acquisition timestamp |
| `sourceChecksumSha256` | SHA-256 of the captured immutable source text |
| `normalizedChecksumSha256` | SHA-256 of its deterministic normalized representation |
| `allowedChannels` | Explicit serving-channel allow-list |
| `classification` | Bounded data classification |
| `reviewDueAt` / `revokedAt` | Review and emergency lifecycle controls |
| `chunkId` | Stable passage identifier derived from the immutable version and chunk position |

Dates must be ISO 8601. Eligibility uses the half-open interval `effectiveFrom <= asOf < effectiveTo`; `effectiveTo` is the first invalid instant. `effectiveTo: null` means explicitly open-ended, while a missing field is invalid. The registry, LibSQL predicate, post-query validator, tests, and audit reconstruction all use this same convention.

## Source onboarding

1. **Acquire outside the request path.** Capture content only from an approved official location or controlled document repository. Record redirect history, retrieval time, response content type, and acquisition identity.
2. **Verify provenance and rights.** Confirm the domain or registry, TLS, document identity, locale, publisher, version, copyright owner, licence or written permission, allowed purpose, attribution requirements, redistribution limits, retention limits, and whether machine or AI processing is permitted. Search results, snippets, and mere public accessibility are not evidence of usage rights.
3. **Scan and quarantine.** Run malware, archive, markup, hidden-text, link, and prompt-injection checks. Treat all source text as untrusted data. Quarantined content cannot be indexed.
4. **Normalize deterministically.** Preserve headings, tables, currency units, footnotes, dates, and material qualifications. Do not silently translate. Retain only content the organization is entitled to store, process, quote, and display under the recorded rights profile.
5. **Classify.** Assign document type, locale, jurisdiction, product scope, owner, publication date, effective interval, and expiry/review policy.
6. **Version and checksum.** Calculate the normalized source checksum and assign a new immutable version. A changed checksum requires a new version.
7. **Approve.** In the demo, record `official_publication` and environment eligibility `demo`. For production, attach verified internal Legal/Compliance and owner approval references for the exact checksum.
8. **Chunk.** Create bounded chunks with overlap appropriate to headings and tables. Every chunk inherits the full eligibility metadata and receives a stable `chunkId`.
9. **Embed and index.** The MVP uses deterministic hash-vector embeddings plus lexical scoring. Record the embedding/ranking version and corpus manifest checksum.
10. **Evaluate before promotion.** Run metadata-policy, bilingual retrieval, citation, faithfulness, injection, and negative-answer sets. A failed required gate prevents promotion.
11. **Promote atomically.** Publish a signed/controlled manifest and index generation together. Never expose a partially built index.

## Demo model and retrieval limitations

- OpenAI `gpt-4o` is the primary generative model; the deterministic policy permits `gpt-4.1` only for complex evidence composition.
- Deterministic hash-vector embeddings are a local, reproducible mathematical feature transform; they do not introduce another generative model.
- Hash vectors are not equivalent to a production multilingual semantic embedding model. Expect lower paraphrase recall and validate all supported Azerbaijani and English query families.
- Do not add an embedding or reranking model by changing an environment variable. A new model is a governed dependency and requires review, version pinning, data-flow approval, and separate evaluation.
- Generation may phrase eligible evidence conversationally, but it cannot change values, omit material qualifications, create uncited product claims, or fill coverage gaps from memory.

## Serving sequence

For every knowledge request:

1. Validate the request, supported locale, jurisdiction, and correlation ID.
2. Derive `asOf` from an authoritative service clock; do not accept an untrusted future date without a separately authorized historical-query capability.
3. Build exact eligibility filters for locale, jurisdiction, environment approval, lifecycle state, and effective interval.
4. Apply eligibility filters **before** lexical/vector ranking.
5. Retrieve and rerank only eligible chunks with a bounded candidate count and score threshold.
6. Detect conflicts, weak coverage, checksum/manifest mismatch, and source expiry. Do not ask the model to resolve an ungoverned conflict.
7. Compose from selected passages and attach numbered, structured citations.
8. Validate that every material claim maps to an eligible selected passage and that quoted numbers, dates, currencies, limits, and qualifications match it.
9. Emit the response only if grounding and policy checks pass; otherwise fail closed.
10. Record bounded metrics, a privacy-safe retrieval trace, and the final grounding decision under the same correlation ID.

No cross-language fallback is allowed. An `az-AZ` request can use only eligible `az-AZ` evidence; an `en-US` request can use only eligible `en-US` evidence. Missing coverage is an operational signal, not permission to translate or use the other index.

## Citation contract

A customer-facing citation label should remain short, but its structured evidence object must identify:

- `sourceId`, `version`, and `chunkId`;
- title and canonical reference;
- locale, jurisdiction, and document type;
- effective interval and publication date where relevant;
- source checksum or evidence-registry pointer;
- retrieval/selection rank and, in the trace only, bounded relevance scores.

Citation links must use the canonical approved reference, not a search result or redirector. A response cannot cite a candidate that was not selected, an expired/revoked version, or the wrong locale. Research summaries must expose the source publication date and distinguish historical publication evidence from current market facts.

## Fail-closed behavior

Do not generate a substantive product answer when:

- the exact locale or `AZ` jurisdiction has no eligible evidence;
- the source is pending, revoked, expired, quarantined, checksum-invalid, or outside its effective interval;
- production evidence has only `official_publication` and no required internal approval reference;
- eligible sources conflict and no approved precedence rule resolves the conflict;
- retrieval is below the configured coverage threshold;
- citation construction or claim-to-passage validation fails;
- the index, manifest, approval registry, policy service, or audit dependency cannot prove a safe result;
- retrieved content attempts to alter policy, tools, identity, or instructions.

Return a concise unavailable message in the requested locale and an approved support/escalation path. Do not mention another language as though it were a substitute, and do not fall back to model memory.

## Tracing and log privacy

Correlate the request, retrieval, agent/workflow, citations, validation, and response with a request/trace ID. A normal trace may contain:

- corpus and manifest versions;
- exact applied filter values from bounded enums/dates;
- eligible, candidate, selected, rejected, and cited counts;
- source/version/chunk identifiers for selected evidence;
- ranking/embedding configuration versions and bounded scores;
- timings, outcome code, evaluation results, and failure category;
- a keyed or one-way query fingerprint when duplicate detection is required.

Normal telemetry must not contain raw customer questions, customer IDs, session tokens, portfolio data, full chunks, full model prompts/completions, secrets, or unrestricted URLs. Diagnostic capture requires an approved, time-bounded mode with masking, access control, retention, and audit. Do not use raw queries, source URLs, chunk text, or identifiers with unbounded cardinality as metric labels.

## Metrics and alerts

At minimum, dashboard the following by bounded environment, locale, document type, workflow, and outcome labels:

| Signal | Purpose |
|---|---|
| Retrieval request and outcome counts | Volume, success, fail-closed, and dependency error rates |
| Retrieval duration histogram | p50/p95/p99 latency and timeout risk |
| Eligible/candidate/selected/cited counts | Coverage and ranking health |
| Empty and below-threshold rates | Missing corpus or query-family coverage |
| Policy rejection counts | Locale, jurisdiction, approval, effective-date, expiry, quarantine, or checksum failures |
| Citation coverage/integrity pass rate | Whether delivered claims are reconstructable |
| Grounding/faithfulness pass rate | Whether answer claims match selected evidence |
| Index and manifest version gauges | Detect mixed or stale deployments |
| Corpus age and next-expiry gauges | Review and expiry readiness |
| Injection/quarantine events | Source and retrieval security signal |

Alert on sustained fail-closed spikes, citation or grounding gate failures, mixed manifest/index versions, approval-registry errors, checksum mismatch, unexpected cross-locale selection, impending expiry with no successor, index latency/error SLO breach, and any delivered answer later found to use ineligible evidence.

## Required evaluations

Promotion and continuous regression suites must include:

- exact-locale positive cases for `az-AZ` and `en-US`;
- cross-language isolation and untranslated coverage-gap cases;
- `AZ` jurisdiction isolation;
- pending, revoked, expired, future-effective, and checksum-mismatch negatives;
- demo versus production approval-basis enforcement;
- source-version precedence and conflict cases, especially fee changes;
- citation identity, URL, effective-date, coverage, and numeric fidelity checks;
- answer faithfulness and material-qualification preservation;
- paraphrase, typo, short-query, and low-overlap recall by locale;
- empty, weak, dependency-down, and manifest-mismatch fail-closed cases;
- direct and indirect prompt injection, hidden text, tool-instruction, exfiltration, and multilingual bypass cases;
- proof that only the reviewed `gpt-4o` primary or deterministic `gpt-4.1` complex-composition tier is invoked;
- telemetry tests proving sensitive text is absent from logs, traces, and metric labels.

Required gates must be deterministic where possible. Model-graded quality can supplement, but cannot replace, metadata, citation, numeric, and trajectory checks.

The deterministic promotion gate is `tests/v3-rag-retrieval-quality.test.ts`. Its reviewed bilingual fixture evaluates every locale/facet pair present in the immutable pilot corpus and blocks promotion unless each pair independently achieves Recall@5 ≥ 0.90, MRR ≥ 0.90, and nDCG@5 ≥ 0.85. The same gate proves that wrong-locale, revoked, expired, and conflicting authorities produce no claims or citations. Run it with:

```bash
npx vitest run tests/v3-rag-retrieval-quality.test.ts
```

## Revocation and expiry

When a version becomes invalid:

1. Mark it revoked or expired in the authoritative registry immediately.
2. Make serving policy reject it before waiting for an index rebuild.
3. Identify successor versions and affected product/locale coverage.
4. Rebuild and atomically promote the index if physical removal is required.
5. Search immutable audit/evidence references for responses that used the version during the affected interval.
6. Let Legal/Compliance determine notification, correction, and retention actions.
7. Keep the immutable evidence needed for reconstruction under the approved retention policy; do not leave it eligible for serving.

## Rebuild and rollback

- Build a new index generation from an immutable manifest; never mutate the live generation in place.
- Verify record count, checksums, metadata distributions, locale separation, effective-date queries, and golden-set results.
- Promote the manifest and index as one release and retain the prior known-good generation.
- Roll back on policy-filter, checksum, citation, latency, or evaluation regression.
- A rollback restores an earlier technically valid generation only if its evidence is still approved and effective. Never roll back into expired or revoked content.

## Incident response

For suspected ungrounded or ineligible output:

1. Disable the affected locale, source, capability, or corpus generation with the narrowest safe kill switch.
2. Preserve request, trace, manifest, index, model, prompt, policy, and evidence identifiers; avoid copying sensitive raw text into the incident channel.
3. Reconstruct the answer from immutable selected passages and approval state as of the request time.
4. Determine whether the issue is acquisition, metadata, filter ordering, ranking, generation, citation, validation, deployment, or approval-registry failure.
5. Revoke affected evidence or roll back only to a still-approved, still-effective generation.
6. Add a regression case before re-enabling.
7. Obtain required Security, Legal/Compliance, and service-owner approval for closure.

## Production promotion checklist

- [ ] Exact source versions have accountable owners.
- [ ] Legal/Compliance approval references are present and verified; `official_publication` is not the sole basis.
- [ ] Effective and expiry intervals have been reviewed for both locales.
- [ ] Corpus storage, vector storage, keys, traces, and backups are on the deployer's approved infrastructure.
- [ ] Acquisition, scan, quarantine, approval, promotion, revocation, and expiry procedures are audited.
- [ ] Azerbaijani and English golden sets meet separately approved thresholds.
- [ ] Prompt-injection, cross-language, approval, effective-date, citation, and fail-closed gates pass.
- [ ] The retrieval/embedding limitations and any production replacement have formal model-risk acceptance.
- [ ] Metrics, SLOs, alerts, kill switches, evidence reconstruction, rollback, and incident drills pass.
- [ ] Customer wording, citations, retention, privacy, and escalation have required approvals.
