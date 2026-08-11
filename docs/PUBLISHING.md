# Public Repository and Release Checklist

Use this checklist for the first public publication and for every tagged
release. Publishing the source does not make the application customer-production
ready; the boundaries in [production readiness](production-readiness.md) remain
in force.

## 1. Prepare a clean public source tree

- [ ] Work from a reviewed, clean commit. Do not upload a ZIP of the working
  directory: ignored files can contain credentials, DuckDB databases, traces,
  audit records, browser reports, editor swap files, or other local state.
- [ ] Review every tracked path with `git ls-files` and run
  `npm run security:scan`.
- [ ] Confirm that no `.env*` file other than `.env.example`, database, trace,
  audit JSONL, test report, cache, build output, or container archive is tracked.
- [ ] Create a tracked-files-only source archive when one is needed:
  `git archive --format=tar.gz --prefix=governed-investment-assistant/ -o ../governed-investment-assistant-source.tar.gz HEAD`.
  Inspect the archive before sharing it.
- [ ] Audit the complete Git history for credentials, private names, email
  addresses, workstation paths, internal URLs, customer data, and proprietary
  material. Current-tree cleanup does not clean old commits.
- [ ] If a secret ever entered history, revoke and rotate it first. Rewrite and
  rescan history in a private clone, or create the first public repository from
  an audited source-only tree with fresh history. Do not publish the old history
  for attribution alone.
- [ ] Confirm the right to publish names, logos, screenshots, datasets, approved
  knowledge, and third-party content. Review [LICENSE](../LICENSE) and
  [NOTICE](../NOTICE); replace organization-specific branding when permission is
  uncertain.

## 2. Complete repository metadata

- [ ] Once the final owner and repository name are known, add the exact
  repository, homepage, and issue-tracker URLs to `package.json`. Add the exact
  `repository-code` URL to [CITATION.cff](../CITATION.cff). Do not commit example
  or placeholder owner URLs.
- [ ] In GitHub **About**, set a concise search-friendly description, for
  example: “Open-source bilingual investment assistant with tool-grounded
  portfolio analytics, governed RAG, evidence lineage, safety validation,
  DuckDB observability, and model-cost metrics.”
- [ ] Add focused topics such as `ai-agents`, `fintech`,
  `investment-assistant`, `mastra`, `typescript`, `rag`,
  `portfolio-analytics`, `llm-observability`, and `duckdb`.
- [ ] Upload the original
  [`docs/assets/social-preview.png`](assets/social-preview.png) in GitHub's
  social-preview setting. Regenerate it if the public project name changes; do
  not add unlicensed third-party marks.
- [ ] Verify the default branch, public license detection, README rendering,
  citation metadata, and all relative documentation links.

## 3. Enable GitHub security and governance

- [ ] Enable private vulnerability reporting and ensure
  [SECURITY.md](../SECURITY.md) describes the actual private contact path.
- [ ] Enable the dependency graph, Dependabot alerts, Dependabot security
  updates, and version updates from
  [`.github/dependabot.yml`](../.github/dependabot.yml).
- [ ] Enable secret scanning and push protection. Verify the history-aware
  [Gitleaks workflow](../.github/workflows/gitleaks.yml) on the initial public
  branch.
- [ ] Enable code scanning and verify the
  [CodeQL workflow](../.github/workflows/codeql.yml). Enable dependency review
  and require its [workflow](../.github/workflows/dependency-review.yml) on pull
  requests.
- [ ] Protect the default branch with pull requests, at least one independent
  review, dismissal of stale approvals, required passing CI checks, resolved
  conversations, and blocked force-pushes and deletions. Restrict bypass access.
- [ ] Review workflow permissions and GitHub Actions access for forks. Keep
  default token permissions read-only unless a job has a documented need.

## 4. Verify the release candidate

- [ ] Update [CHANGELOG.md](../CHANGELOG.md), `package.json`, the lockfile, and
  [CITATION.cff](../CITATION.cff) with the same version and release date.
- [ ] From a fresh clone, run `npm ci`, `npm run release:verify`, and
  `npm run test:e2e`.
- [ ] Require all application, browser/accessibility, container, CodeQL,
  dependency-review, and secret-scanning checks to pass on the exact release
  commit.
- [ ] Review the generated CycloneDX dependency SBOM and the retained no-push
  OCI evidence: image digest, SPDX SBOM, provenance attestations, build metadata,
  and checksums.
- [ ] Treat CI's OCI archive as build evidence, not as an approved production
  image. Publish a container only after the target registry, dependency
  licences, vulnerability policy, base image, runtime secrets, and production
  adapters have been independently approved.

## 5. Tag and publish

- [ ] Create an annotated, preferably signed, semantic-version tag from the
  verified commit; do not move an existing public tag.
- [ ] Publish release notes from the changelog, including security-relevant
  changes, migrations, breaking changes, known limitations, and checksums for
  downloadable source artifacts.
- [ ] Attach or link the SBOM and OCI provenance evidence generated for that
  exact commit, and record the CI run that produced them.
- [ ] Recheck the repository landing page, install instructions, release assets,
  discussions/issues, and vulnerability-reporting flow as an unauthenticated
  visitor.

## Required release disclaimers

Keep these statements visible in the README and every release:

- **Production boundary:** This is an open-source reference implementation for
  internal-pilot evaluation. It is not approved for customer production.
- **Provider boundary:** The default portfolio and market data are synthetic and
  offline, not current market observations. Any development feed is opt-in and
  requires the operator to validate access, licensing, attribution,
  redistribution, delay, and retention rights. Customer use requires approved
  identity, ledger, licensed market/research, storage, signing, audit, and order
  integrations.
- **Financial boundary:** The assistant provides educational information, not
  personalized investment, legal, or tax advice. It does not guarantee market
  data, outcomes, or suitability and must not automatically produce or execute a
  buy, hold, or sell decision. Investing involves risk, including loss of
  capital.

Use [OPEN_SOURCE_CUSTOMIZATION.md](OPEN_SOURCE_CUSTOMIZATION.md) before
publishing a branded fork and [CONTRIBUTING.md](../CONTRIBUTING.md) when opening
the project to contributors.
