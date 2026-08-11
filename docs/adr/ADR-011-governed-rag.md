# ADR-011: Governed Retrieval for Product Knowledge

- Status: Accepted for the Assistant V3 internal pilot
- Date: 2026-07-21
- Scope: Configured product documents, disclosures, fees, policies, and published research
- Model constraint superseded by: [ADR-012](./ADR-012-runtime-model-and-memory.md)

## Context

The assistant must answer product and support questions from attributable evidence instead of model memory. A useful answer is not sufficient on its own: every supporting passage must be valid for the requested language, jurisdiction, approval state, usage rights, and point in time. The evidence must also be reconstructable after the response is delivered.

The repository demonstrates this control with original, fictional Demo Invest passages published under the repository licence and identified by reserved `.invalid` URLs. The bundled text is not copied from, affiliated with, or presented as the terms of a real financial institution. A deployer must separately verify provenance, copyright or licence rights, allowed AI use, and internal approvals for every replacement source.

## Decision

Build the knowledge path as a governed retrieval pipeline inside the Mastra-based Assistant Service, with policy enforcement outside the generative model.

In V3, the deterministic router selects `approved-knowledge-v3`; that workflow uses a principal/policy/argument-bound one-use grant to invoke `retrieve-approved-product-knowledge`. The no-tool `approved-knowledge-writer` sees only eligible bounded evidence references and returns structured claim templates. Citation, fact, claim, numeric/date, and conversational P0 gates run before the hash-chained audit append and response delivery. The customer cannot supply retrieval filters or tool arguments.

### Corpus boundary

- The demo corpus is a small, project-authored fictional product profile.
- Seeded records use `approvalBasis: official_publication` and are eligible only in the demo environment.
- In the bundled profile, `official_publication` exercises the legacy publication path for content authored by this project. It is not an internal Legal, Compliance, Risk, Product, or Knowledge Operations approval.
- A public URL does not by itself grant copying, storage, redistribution, or AI-processing rights. Replacement sources require a recorded licence or written permission compatible with the intended use.
- Before production, every eligible source version must have named owners and immutable internal approval references. Production policy must reject records supported only by `official_publication`.
- The corpus is versioned and immutable. A changed source creates a new version and checksum; it never overwrites the prior evidence.
- The customer-facing runtime does not browse the open web. Acquisition and approval are separate operational activities.

### Retrieval policy

The serving path applies metadata eligibility filters before ranking:

1. The locale must exactly match the requested supported locale (`az-AZ` or `en-US`).
2. The jurisdiction must be `AZ`.
3. The source version must be approved for the current environment.
4. The query time must be inside the source version's effective interval.
5. Revoked, expired, quarantined, superseded-for-serving, or checksum-invalid content is ineligible.

There is no silent translation and no cross-language fallback. If eligible Azerbaijani evidence is missing for an Azerbaijani request, English evidence cannot be used to manufacture an answer. The assistant fails closed in the requested language and may direct the customer to an approved support channel.

### Chunking, vectors, and model boundary

- Mastra document utilities perform bounded chunking and retain source-version and passage identifiers on every chunk.
- The demo uses deterministic hash-vector embeddings plus lexical relevance. This keeps indexing local and reproducible independently of the current locked writer-model policy in ADR-012.
- Hash-vector similarity is an MVP retrieval aid. It is **not** equivalent to a production semantic embedding model and must not be represented as one in quality claims.
- Any production embedding model, vector service, or reranker requires separate privacy, residency, security, model-risk, supply-chain, and bilingual-quality approval.
- Retrieved text is data, never an instruction. System policy and tool authorization remain outside retrieved context.

### Answers and citations

- An answer is produced only from eligible retrieved passages.
- Every material product, fee, policy, disclosure, or research claim must map to a returned citation.
- A citation carries the immutable source ID and version, passage/chunk ID, canonical reference, locale, effective interval, and checksum or an evidence-registry reference to it.
- The UI may shorten citation labels, but the structured response and trace preserve reconstructable evidence identity.
- If evidence is missing, conflicting, below threshold, or cannot be cited, the path returns an explicit unavailable/escalation response rather than using model memory.

### Observability and evaluation

- Retrieval produces a correlated trace covering eligibility filters, candidate and selected counts, source versions, ranking method, latency, citation mapping, and the final grounding decision.
- Normal production telemetry must not contain raw customer questions, customer identifiers, full source passages, portfolio data, or model prompts. Store a request correlation ID, bounded metadata, and a one-way query fingerprint where needed.
- Metrics use bounded labels only; source URLs, free-form queries, customer IDs, and passage text are not metric labels.
- Automated gates cover locale and jurisdiction isolation, approval/effective-date enforcement, citation integrity and coverage, answer faithfulness, prompt-injection resistance, corpus/version integrity, and fail-closed behavior.

## Consequences

### Positive

- Product answers are attributable to a controlled source version instead of model memory.
- Strict pre-ranking filters prevent a relevant but ineligible passage from becoming evidence.
- Immutable versions, checksums, citations, and correlated traces make answers reproducible.
- Retrieval remains local and independent from the bounded writer-model tier.
- Retrieval, generation, and policy quality can be measured independently.

### Tradeoffs

- A small curated corpus will intentionally decline questions it cannot support.
- Exact locale isolation reduces apparent coverage until both language versions are approved.
- Deterministic hash vectors have materially weaker semantic recall than a validated embedding model.
- Source review, versioning, expiry management, and bilingual evaluations add operational work.
- Public provenance alone cannot satisfy the production approval requirement.

## Rejected alternatives

- **Answer from model memory:** not attributable, time-aware, or reconstructable.
- **Browse official pages during a customer request:** bypasses version approval, effective-date checks, and reproducibility.
- **Filter after vector search:** an ineligible passage can influence ranking or generation before policy rejects it.
- **Translate English evidence when Azerbaijani evidence is missing:** hides an approval and coverage gap.
- **Treat an official URL as internal approval:** conflates publication provenance with authorization for assistant use.
- **Use another local embedding model without approval:** violates the current model boundary and adds an unreviewed dependency.

## Production acceptance conditions

The RAG path remains a demo until all of the following are complete:

1. Legal/Compliance and accountable product owners approve every production source version, use purpose, locale, jurisdiction, and effective interval.
2. Approval references are verified by an authoritative registry and enforced by production policy.
3. The acquisition, malware/content scan, injection quarantine, approval, revocation, and expiry workflow is independently operated and audited.
4. The corpus, vector store, traces, and backups run in deployer-controlled infrastructure with approved residency and access controls.
5. A production semantic/lexical retrieval design is evaluated separately for Azerbaijani and English, or the limitations of the selected design are formally accepted.
6. Citation, faithfulness, policy-filter, privacy, adversarial, and bilingual golden-set gates block promotion on failure.
7. Operational alerts, rollback, index rebuild, evidence reconstruction, retention, deletion, and incident procedures are exercised.
8. Customer-facing wording and escalation paths receive Legal/Compliance approval.

The operating procedure and promotion checklist are defined in [the knowledge runbook](../knowledge-runbook.md).
