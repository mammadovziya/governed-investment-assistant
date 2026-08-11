# Contributing

Thank you for helping improve Governed Investment Assistant. Contributions are welcome
for runtime behavior, adapters, tests, documentation, accessibility, developer
experience, and security hardening.

This repository is an open-source reference implementation and an internal
pilot. It is not a customer-production investment service. Never use real
customer, account, portfolio, order, credential, or other confidential data in
an issue, test, fixture, trace, screenshot, or pull request.

## Before you start

- Search existing issues and pull requests before proposing duplicate work.
- Use an issue to discuss broad architectural, policy, or public-contract
  changes before investing in a large implementation.
- Report suspected vulnerabilities privately according to
  [SECURITY.md](SECURITY.md), not in an issue or pull request.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in every project space.

## Development setup

You need Node.js 22.13 or newer.

```bash
npm ci
umask 077 && cp .env.example .env.local
npm run knowledge:ingest
npm run check
```

An OpenAI API key is needed only for live model-backed development. The normal
unit, integration, and browser fixture tests must not depend on a contributor's
credential or make billable model calls. Store local secrets only in an ignored
environment file such as `.env.local`.

To run the complete local interface, start the loopback-only Studio before the
application:

```bash
# Terminal 1
npm run studio

# Terminal 2
npm start
```

See [README.md](README.md) for setup details and
[docs/studio-runbook.md](docs/studio-runbook.md) for Studio's privacy and data
boundaries.

## Design constraints

Changes must preserve the project's trust model:

- Substantive financial answers come from verified tool evidence and signed
  facts. Do not add a catalog of ready-written financial answers.
- Authorization, policy, arithmetic, argument construction, signing, evidence
  lineage, and delivery scoring remain deterministic and server-owned.
- Models do not receive authority to invent identifiers, select privileged
  tools, execute trades, or bypass policy.
- Portfolio, order, and default market fixtures remain synthetic. Any external
  market feed must be an explicit adapter with reviewed access and usage terms.
- The assistant supports Azerbaijani and English. User-visible behavior changes
  should include relevant tests for both locales.
- Mastra Studio remains a loopback-only developer surface and stays out of the
  customer production artifact.
- Order flows remain read-only previews. This project must not gain a path to
  submit, modify, or cancel an order.

Read [ARCHITECTURE.md](ARCHITECTURE.md) and
[docs/production-readiness.md](docs/production-readiness.md) before changing a
security, privacy, policy, evidence, storage, or execution boundary.

## Make a focused change

1. Create a branch from the current default branch.
2. Keep the change narrowly scoped and avoid unrelated formatting rewrites.
3. Add or update tests that fail before the change and pass afterward.
4. Update documentation when behavior, configuration, APIs, or operational
   requirements change.
5. Run the verification commands below.
6. Open a pull request using the repository template.

Do not commit generated runtime databases, observability stores, audit files,
test reports, API keys, bearer tokens, raw model transcripts, or customer data.

## Verification

Run the checks relevant to your change:

```bash
npm run check
npm run build
npm run security:scan
npm run license:verify
npm run docs:verify
npm run open-source:verify
```

For browser or user-interface changes, also run:

```bash
npx playwright install chromium
npm run test:e2e
npm run test:e2e:a11y
```

Maintainers may require focused failure-injection, bilingual golden, RAG,
numeric-replay, container, or live-provider evidence when a pull request changes
the corresponding boundary. A local test result is not customer-production
approval.

## Pull request expectations

A reviewable pull request:

- explains the problem, approach, and user-visible effect;
- identifies affected trust boundaries and failure behavior;
- lists the exact verification performed;
- includes screenshots or recordings for visual changes, with sensitive
  information removed;
- adds release or migration notes when configuration or persisted formats
  change; and
- does not weaken a safety check merely to make a test pass.

Reviews may request smaller commits, additional tests, documentation, or an
architecture decision record for durable design choices. Maintainers decide
when a change is ready to merge.

## Licensing contributions

Unless you explicitly state otherwise, an intentional contribution submitted
for inclusion in this project is provided under the
[Apache License 2.0](LICENSE), as described in section 5 of that license. You
must have the right to submit the contribution and must preserve applicable
third-party notices.
