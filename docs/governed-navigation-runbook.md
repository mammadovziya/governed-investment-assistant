# Governed in-app guidance

The assistant can attach a local app link only after an `approved_knowledge`
answer contains the exact current configured-product citation required by the
reviewed navigation catalog. The model cannot provide a route, URL, label, or
feature name.

Portfolio, cash, recent-activity, and single-symbol quote answers use a second,
independent fact-bound catalog. These actions are created only after the
deterministic workflow has produced a complete signed fact and compatible card.
They never share the citation-bound guide authorizer.

## Internal-pilot catalog

| Semantic target | Local destination | Evidence | State |
| --- | --- | --- | --- |
| `investments.account-opening.guide` | `/investments/guides/account-opening` | Approved account-opening publication in the response locale | Enabled |
| `investments.funding.guide` | `/investments/guides/funding` | Approved funding publication in the response locale | Enabled as guidance only |
| `investments.share-purchase.guide` | `/investments/guides/share-purchase` | Approved purchase-process publication in the response locale | Enabled as guidance only |
| `investments.withdrawal.guide` | `/investments/guides/withdrawal` | Approved withdrawal publication in the response locale | Enabled as guidance only |
| `investments.price-alerts.create` | `/investments/price-alerts/create` | No approved bilingual evidence | Disabled |

All enabled destinations are internal-pilot web guides rather than mobile-app
deep links. They provide bilingual step-by-step guidance, link back to
the reviewed official source, show the source review date, and state that no
account, transfer, order, purchase, or withdrawal action has started. They
contain no payment form, account identifiers, execution API, or money-movement
control.

## Fact-bound read-only views

| Semantic target | Exact local path | Required signed response evidence |
| --- | --- | --- |
| `investments.portfolio.overview` | `/investments/portfolio` | One complete `portfolio.current-value` fact for the primary portfolio |
| `investments.portfolio.cash` | `/investments/portfolio/cash` | The same signed current-value fact plus the signed `F1_CASH_VALUE` projection |
| `investments.portfolio.activity` | `/investments/activity` | One complete `portfolio.recent-trading-activity` fact |
| `investments.instrument.overview` | `/investments/instruments` | One complete `market.quote` fact for the single routed symbol |

These paths contain no principal, tenant, account, conversation, session,
request, or ticker identifier. The browser accepts the action only when the
delivery gate passed and exactly one compatible delivered card carries the same
fact reference. Clicking changes only the exact local history path and focuses
that already-rendered signed card; it performs no transaction or money-movement
request. A direct reload shows a safe empty shell asking the user to open the
view from a verified assistant answer.

The paths are internal-pilot web destinations, not approved mobile-app deep
links. Customer production requires deployer-owned authenticated destination
contracts and a separately reviewed mobile/universal-link catalog.

## Fail-closed controls

- The trusted context must be authenticated and authorized for approved
  knowledge, with the `approvedKnowledge` feature enabled.
- The response citation must exactly match the catalog's source ID, URL,
  effective dates, and SHA-256 content hash for the active locale.
- Catalog and evidence effective dates are evaluated against the trusted
  request time.
- Only exact app-relative paths are accepted. Queries, fragments, encoded
  paths, traversal, protocol-relative links, external URLs, and trailing-slash
  variants are rejected.
- The browser validates the semantic target/path pair again before rendering an
  action.
- Direct requests are served only for the four enabled exact destinations.
  There is no SPA catch-all.
- Fact-bound actions require `readOnlyNavigation`, matching portfolio or market
  consent/entitlement/capability, a complete signed fact with verified exact
  tool ancestry, and one compatible card. The eighth P0 scorer reconstructs and
  canonical-hash-compares the entire action.
- Fact-bound destinations accept exact GET only. Queries, fragments,
  trailing-slash variants, dynamic symbols, and every other HTTP method are
  rejected.

## Adding a destination

1. Add independently approved and current English and Azerbaijani knowledge
   documents.
2. Add the semantic target, exact local path, localized label, effective
   interval, and the exact evidence identities to the server catalog.
3. Add an exact target/path pair and bilingual non-executable guide to the
   browser catalog.
4. Add an exact server route for the destination; do not add a wildcard route.
5. Test evidence/version binding, locale mismatch, feature and consent denial,
   path attacks, browser target/path mismatch, bilingual copy, and exact-route
   serving.
6. Keep the feature disabled until every gate passes and the local destination
   exists.
