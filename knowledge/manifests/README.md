# Knowledge Manifests

This directory is reserved for immutable, reviewable manifests that bind an approved source version to its normalized content, serving metadata, and index generation.

## Important approval distinction

The local demo seeds original fictional Demo Invest passages identified by
reserved `.invalid` references. To exercise the public-provenance path, those
records use:

```json
{ "approvalBasis": "official_publication" }
```

In this repository, `official_publication` is demonstration metadata—not a
claim that the fictional text was officially published or approved.
In a real corpus, that value verifies public provenance only. It is **not**
evidence of internal Legal, Compliance, Risk, Product, or Knowledge Operations
approval for use by a generative assistant. Before production, each exact
source version and checksum must be linked to immutable internal approval
records and an accountable owner. The runtime approval mode, not the model,
decides environment eligibility; controlled/production mode must reject a
manifest whose only basis is `official_publication`.

## Manifest properties

- **Immutable:** changing normalized content or governed metadata creates a new `version` and manifest entry.
- **Content-addressed:** the checksum is calculated from deterministic normalized content.
- **Time-aware:** the effective interval is part of evidence identity, not an optional search hint.
- **Locale-specific:** Azerbaijani and English versions are distinct sources or source versions. One cannot authorize or substitute for the other.
- **Environment-scoped:** demo eligibility never implies production eligibility.
- **Reconstructable:** a citation must resolve back to the exact source version, chunk, checksum, and approval state used at response time.

## Minimum record

The concrete schema is owned by the implementation, but a manifest record must carry equivalent information to:

```json
{
  "schemaVersion": "1.0.0",
  "sourceId": "demo-invest-policy-az",
  "version": "project-authored-synthetic-2026-07-29",
  "title": "Example title",
  "documentType": "policy",
  "url": "https://knowledge.demo-invest.invalid/az/example-policy",
  "locale": "az-AZ",
  "jurisdiction": "AZ",
  "productScopes": ["DEMO_INVEST"],
  "facets": ["withdrawal"],
  "audience": "customer",
  "allowedChannels": ["customer_chat"],
  "classification": "public",
  "ownerTeam": "Example product governance",
  "approvalStatus": "approved",
  "approvalBasis": "official_publication",
  "approvals": [
    {
      "role": "publisher",
      "actorRef": "team:example-product-governance",
      "approvalRef": "approval:demo-invest:example-policy:2026-07-29",
      "decidedAt": "2026-07-29T00:00:00Z"
    }
  ],
  "publishedAt": "2026-07-29T00:00:00Z",
  "effectiveFrom": "2026-07-29T00:00:00Z",
  "effectiveTo": null,
  "contentAsOf": null,
  "reviewDueAt": null,
  "revokedAt": null,
  "section": "Example section",
  "sourceChecksumSha256": "<captured-content-digest>",
  "normalizedChecksumSha256": "<normalized-content-digest>",
  "parserProfile": "curated-versioned-source-v1",
  "chunkingProfile": "mastra-recursive-900-120-v1",
  "embeddingProfile": "deterministic-hash-384-v1",
  "verifiedAt": "2026-07-29T00:00:00Z"
}
```

The example is illustrative, not a production-approved record. `effectiveTo: null` is the schema's explicit open-ended value; omitting the field is invalid. In controlled/production mode, `approvalBasis` must be `controlled_approval` and the `approvals` list must contain the required verified internal decision records.

## Validation rules

A manifest promotion must fail when any of these checks fail:

1. The schema, bounded enum, date, or URL/reference format is invalid.
2. `locale` is not an exact supported locale or `jurisdiction` is not `AZ`.
3. The effective interval is empty, ambiguous, or inconsistent with the source/approval decision.
4. The normalized content checksum differs from the manifest.
5. A `(sourceId, version)` was previously used with different bytes or governed metadata.
6. A production record lacks verified internal approval references or an accountable owner.
7. A production record relies only on `official_publication`.
8. A revoked, expired, quarantined, or pending source is marked serveable.
9. The canonical reference is not in the approved source registry.
10. A locale is represented by an unapproved machine translation.
11. The source contains secrets, customer data, prohibited personal data, executable payloads, or unresolved injection findings.
12. Chunk records cannot resolve to the source version and checksum.
13. A source is assigned to an answer facet it was not approved to support (for example, a funding policy labeled as withdrawal evidence).

## Version and lifecycle rules

- Correcting text, values, dates, tables, disclaimers, locale, jurisdiction, approval references, or effective intervals creates a new version.
- Lifecycle state can immediately make a version ineligible, even before physical vector deletion.
- A successor does not erase its predecessor. Retain the prior immutable evidence under the approved audit/retention policy for reconstruction.
- Promotion publishes a complete manifest and corresponding index generation atomically.
- Rollback is allowed only to a generation whose evidence remains approved and effective at the time of serving.
- Research sources require explicit publication dates and a governed freshness/expiry policy; they must not be presented as current merely because their URL remains reachable.

## Citation linkage

Each indexed chunk must inherit or reference all serving metadata and include a stable `chunkId`. Delivered structured citations must resolve at least:

```text
sourceId + version + chunkId -> url + locale +
jurisdiction + effective interval + checksum + approval evidence
```

The UI may show a compact title and link, but shortening the presentation must not weaken the stored evidence identity.

## Security and review

Manifest changes are code/data changes subject to review. Production should require signed releases, least-privilege write access, independent approval verification, tamper-evident audit, encrypted storage, and atomic promotion. Do not put customer identifiers, raw questions, secrets, access tokens, or model prompts in manifests.
