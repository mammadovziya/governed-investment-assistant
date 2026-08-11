# Security Policy

Security reports are welcome and should be handled privately.

## Supported versions

This project is an evolving reference implementation rather than a hosted
service with long-term support releases.

| Version or channel | Security support |
| --- | --- |
| Latest commit on the default branch | Supported |
| Older commits, forks, and unofficial deployments | Not supported |
| Internal-pilot demonstration deployments | No production security SLA |

The repository is not approved for customer production. See
[docs/production-readiness.md](docs/production-readiness.md) for known pilot
boundaries and required production controls.

## Report a vulnerability

Use GitHub's private vulnerability reporting flow:

1. Open the repository's **Security** tab.
2. Select **Advisories** and then **Report a vulnerability**.
3. Provide the information requested below.

Repository maintainers must enable private vulnerability reporting before
inviting public contributions.

If private vulnerability reporting is not enabled, contact the repository owner
through the private security or contact channel published on their GitHub
profile. Do not disclose the issue in a public GitHub issue, discussion, pull
request, trace, or screenshot.

Include:

- the affected commit, version, endpoint, component, or configuration;
- impact and a realistic attack scenario;
- reproduction steps or a minimal proof of concept;
- required privileges and environmental assumptions;
- whether sensitive data, signing, authorization, evidence lineage, audit,
  model/tool boundaries, or order-preview isolation are affected; and
- a safe way for maintainers to contact you.

Do not include real customer data, credentials, bearer tokens, private keys, or
other secrets. Use synthetic fixtures and redact logs.

Maintainers aim to acknowledge a complete report within three business days,
provide an initial assessment within ten business days, and coordinate a fix
and disclosure timeline based on severity. These are response targets, not a
service-level agreement. Please allow maintainers a reasonable opportunity to
investigate and remediate before public disclosure.

## Security scope

Examples of in-scope reports include:

- authentication, authorization, tenant-isolation, consent, or policy bypass;
- cross-session or cross-tenant disclosure;
- acceptance of invalid signatures, evidence, citations, or one-use grants;
- a path to submit, modify, or cancel an order;
- secret exposure or unsafe telemetry persistence;
- prompt or tool manipulation that crosses a deterministic capability boundary;
- audit-chain bypass or material response delivery without required scoring;
- arbitrary file access, code execution, request forgery, injection, or
  dependency compromise; and
- customer-production artifacts that unexpectedly contain private Studio or
  offline-evaluation code.

Known and documented pilot limitations—such as synthetic portfolios, the
offline synthetic market feed, local persistence, and lack of production
identity or order-system integrations—are not vulnerabilities by themselves.
A bypass of a control intended to contain those limitations may still be a
valid security report.

General feature requests, incorrect market data from an upstream development
feed, and financial-answer quality issues without a security impact belong in a
normal issue.

## Runtime dependency advisory

Mastra's multi-version AI SDK compatibility layer currently installs
`@ai-sdk/provider-utils` 3.0.30 under an npm alias. GitHub advisory
`GHSA-866g-f22w-33x8` describes low-severity uncontrolled resource consumption
in JSON response handling for versions through 3.0.97, and lists no patched
version as of 2026-08-11. The application's direct OpenAI adapter uses the
separate 5.x provider-utils line, but the older Mastra compatibility alias
remains in the production dependency graph.

The release gate reports this advisory and fails on moderate or higher runtime
findings. Maintainers should keep provider responses bounded, avoid enabling
unreviewed legacy provider adapters, track the upstream advisory, and upgrade
the compatibility dependency as soon as a patched Mastra release is available.

## Development-only dependency advisory

The private, loopback-only Mastra Studio toolchain currently pulls
`image-size` through `@mastra/memory`. GitHub advisories
`GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` describe denial-of-service
loops in uncommon image parsers, and no patched `image-size` release is
available as of 2026-08-11. This dependency is development-only: the
production build rejects imports of `@mastra/editor` and `@mastra/memory`,
prunes both packages, and exposes no image-upload capability.

Do not expose Mastra Studio to a network or process untrusted image attachments
with it. The release gate audits production dependencies separately with
`npm run security:audit`; maintainers should continue running the full audit,
track the upstream fix, and update immediately when a patched compatible
release becomes available.

## Safe-harbor expectations

For good-faith research:

- test only systems and data you own or are explicitly authorized to test;
- prefer a local clone with synthetic fixtures;
- do not use social engineering, denial of service, destructive actions, or
  automated high-volume traffic;
- stop if you encounter personal, customer, credential, or confidential data;
- collect only the minimum evidence needed to demonstrate impact; and
- follow applicable law and the coordinated-disclosure process above.

This policy does not authorize testing of GitHub, OpenAI, Yahoo, Mastra, a
downstream financial institution, or any other third-party service.
