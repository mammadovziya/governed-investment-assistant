# Knowledge Source Snapshots

This directory is reserved for normalized, immutable source snapshots used to build the governed knowledge index. It is not a runtime web cache and not a drop folder for arbitrary documents.

## Demo corpus boundary

The bundled demo corpus is original fictional Demo Invest material authored for
this repository and distributed under its licence. Its evidence identities use
reserved references under `knowledge.demo-invest.invalid`; they are not live
websites or claims of affiliation. The demo deliberately exercises the
`official_publication` code path, but that metadata is not evidence of real
publication or internal approval.

Before production, each replacement source's exact normalized version and
checksum must receive documented Legal/Compliance approval, an accountable
owner, a defined effective interval, and production environment eligibility.

Official pages may change without notice. Runtime serving therefore uses captured, versioned evidence; it does not fetch a live page during a customer request.

## Allowed source classes

Within the approved scope, snapshots may represent:

- product and support documentation;
- fees and tariffs;
- policies and customer procedures;
- required disclosures and risk notices;
- approved, time-bounded product research.

Each class still requires source-level approval. Being an allowed class is not approval for a particular document or version.

## Prohibited inputs

Do not ingest or serve:

- search-engine result text or snippets;
- arbitrary third-party pages, social posts, forums, or copied news;
- model-generated facts or model memory represented as documents;
- user-pasted material without a separate controlled intake and approval process;
- unapproved translations or language detection used as a substitute for a declared locale;
- pending, revoked, expired, quarantined, checksum-invalid, or future-effective material;
- customer data, portfolio data, secrets, credentials, or access tokens;
- content with unresolved malware, active content, hidden-text, or prompt-injection findings;
- a live page fetched during a customer answer and used before versioning and approval.

## Acquisition and normalization

Source acquisition must run outside the customer request path:

1. Resolve the canonical official reference and record retrieval evidence.
2. Verify TLS, redirects, content type, publisher, locale, and document identity.
3. Scan files and markup; quarantine suspicious active content, hidden instructions, or injection patterns.
4. Normalize deterministically while preserving material headings, tables, footnotes, units, dates, exceptions, and disclosures.
5. Keep excerpts or source content only to the extent the deploying
   organization is entitled and required to store, index, quote, and display.
6. Assign the exact locale and `AZ` jurisdiction. Never silently translate.
7. Calculate a SHA-256 checksum and create an immutable source version.
8. Link the version to its manifest, owner, approval state/basis/references, effective interval, and review/expiry policy.

Retrieved document text is always untrusted data. Instructions found inside a page cannot change system policy, call tools, reveal prompts, weaken citation rules, or authorize an action.

## Locale isolation

Azerbaijani (`az-AZ`) and English (`en-US`) content must be acquired, normalized, approved, indexed, evaluated, and served separately.

- An Azerbaijani request cannot fall back to an English chunk.
- An English request cannot fall back to an Azerbaijani chunk.
- Similar or linked pages do not prove that both language versions contain identical terms.
- A missing locale returns a concise coverage/unavailable response in the requested locale and an approved escalation path.

This isolation applies before ranking. Filtering a wrong-language result after generation is too late.

## Suggested immutable layout

The implementation may store normalized content elsewhere, but the equivalent identity should be obvious:

```text
knowledge/sources/
  <sourceId>/
    <version>/
      source.<locale>.<format>
      acquisition-metadata.json
```

Do not overwrite a version directory. A byte or governed-metadata change creates a new version and manifest record.

## Chunking and indexing

- Chunk boundaries should respect headings, tables, lists, and material qualifications.
- Every chunk must inherit source ID/version, locale, jurisdiction, lifecycle/approval data, effective interval, and checksum, plus a stable passage ID.
- A qualification or fee exception must not be separated so far from its subject that retrieval changes meaning.
- The demo uses deterministic hash-vector embeddings and lexical relevance. This is reproducible and local, but it is not a production semantic embedding model.
- Model selection is controlled separately from source ingestion. Introducing
  or changing any embedding, reranking, or generative model requires a
  governed dependency and data-flow review.

## Research-specific handling

Published research is time-bound evidence, not a timeless product rule:

- retain its publication date and covered period;
- assign an explicit review/freshness/expiry rule;
- cite it as historical research with its date;
- do not combine it with a current price claim unless a separately approved timestamped market source supplies that fact;
- do not imply that continued URL availability means the analysis is current.

## Promotion and removal

A source snapshot becomes serveable only through an approved manifest and a fully validated index generation. Removal or expiry must first make it ineligible in the authoritative registry; physical index cleanup follows. Preserve immutable versions required for evidence reconstruction under the approved retention policy, while ensuring they cannot be selected for new answers.

See [the governed knowledge runbook](../../docs/knowledge-runbook.md) for onboarding, evaluation, monitoring, rollback, and incident procedures.
