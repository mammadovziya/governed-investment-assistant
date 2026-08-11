import type {
  AssistantCitation,
  AssistantInAppAction,
  SupportedLocale,
  TrustedRequestContext
} from "./contracts.js";

/**
 * Product-owned navigation identifiers. The assistant may select one of these
 * identifiers, but it can never supply a URL, route, label, or feature name.
 */
export const GOVERNED_NAVIGATION_TARGETS = Object.freeze([
  "investments.account-opening.guide",
  "investments.funding.guide",
  "investments.share-purchase.guide",
  "investments.withdrawal.guide",
  "investments.price-alerts.create"
] as const);

export type GovernedNavigationTarget = (typeof GOVERNED_NAVIGATION_TARGETS)[number];

const ACCOUNT_OPENING_NAVIGATION_REQUEST =
  /\b(?:(?:how|where)\s+(?:do|can)\s+i\s+)?(?:open|create|register)\s+(?:an?\s+)?(?:demo\s+invest(?:ment)?\s+|investment\s+)?account\b|\b(?:investment|demo\s+invest(?:ment)?)\s+account\b[\s\S]{0,48}\b(?:open|create|register|sign\s+up)\b|(?<!\p{L})(?:(?:investisiya|demo\s+invest)\s+hesab\p{L}*[\s\S]{0,48}(?:a[cç]|yarat|qeydiyyat)\p{L}*|(?:a[cç]|yarat)\p{L}*[\s\S]{0,48}(?:investisiya|demo\s+invest)\s+hesab\p{L}*)(?!\p{L})/iu;
const PRICE_ALERT_NAVIGATION_REQUEST =
  /\b(?:create|set|add|configure|manage|open|how\s+(?:do|can)\s+i\s+(?:create|set|add))?\s*(?:a\s+)?(?:stock\s+)?price\s+alerts?\b|\balerts?\s+(?:for|when)\s+(?:a\s+)?(?:stock\s+)?price\b|(?<!\p{L})(?:qiym[əe]t\s+(?:bildiri[şs]|x[əe]b[əe]rdarl[ıi]q)\p{L}*|(?:bildiri[şs]|x[əe]b[əe]rdarl[ıi]q)\p{L}*\s+(?:yarat|qur|[əe]lav[əe])\p{L}*)(?!\p{L})/iu;
const FUNDING_NAVIGATION_REQUEST =
  /\b(?:funding|deposit|top[ -]?up)\b|\b(?:fund|add\s+(?:money|cash))\b[\s\S]{0,64}\b(?:(?:investment|brokerage|trading)\s+account|portfolio)\b|\b(?:(?:investment|brokerage|trading)\s+account|portfolio)\b[\s\S]{0,64}\b(?:fund|deposit|top[ -]?up|add\s+(?:money|cash))\b|(?<!\p{L})(?:m[əe]daxil|medaxil|maliyy[əe]l[əe][şs]dir|pul\s+[əe]lav[əe]\s+et)\p{L}*(?!\p{L})/iu;
const SHARE_PURCHASE_NAVIGATION_REQUEST =
  /\b(?:how\s+(?:is|do|can)\b[^.!?\n]{0,50}\b(?:purchase|buy)|purchase\s+(?:operation|process)|buying\s+(?:operation|process)|how\s+to\s+(?:purchase|buy))\b[^.!?\n]{0,80}\b(?:shares?|stocks?|securities)?|(?<!\p{L})(?:(?:səhm|sehm|qiymətli\s+kağız)\p{L}*[^.!?\n]{0,50}(?:necə|nece)\s+al\p{L}*|al[ıi][şs]\s+(?:əməliyyat|emeliyyat|prosesi|sifari[şs])\p{L}*|(?:necə|nece)\s+(?:səhm|sehm)\p{L}*\s+al\p{L}*)(?!\p{L})/iu;
const WITHDRAWAL_NAVIGATION_REQUEST =
  /\b(?:withdraw|withdrawal|cash[ -]?out)\b|(?<!\p{L})(?:m[əe]xaric|mexaric)\p{L}*(?!\p{L})|(?<!\p{L})(?:(?:pul|v[əe]sait|balans)\p{L}*[\s\S]{0,48}(?:çıxar|cixar)\p{L}*|(?:çıxar|cixar)\p{L}*[\s\S]{0,48}(?:pul|v[əe]sait|balans)\p{L}*)(?!\p{L})/iu;

/**
 * Maps chat text only to a semantic catalog target. Routes, labels, and URLs
 * remain catalog-owned and can never be supplied by the model or customer.
 */
export function detectGovernedNavigationTarget(
  message: string
): GovernedNavigationTarget | null {
  const normalized = message
    .normalize("NFKC")
    .replaceAll("İ", "i")
    .trim()
    .toLocaleLowerCase("en-US");
  if (PRICE_ALERT_NAVIGATION_REQUEST.test(normalized)) {
    return "investments.price-alerts.create";
  }
  if (ACCOUNT_OPENING_NAVIGATION_REQUEST.test(normalized)) {
    return "investments.account-opening.guide";
  }
  if (FUNDING_NAVIGATION_REQUEST.test(normalized)) {
    return "investments.funding.guide";
  }
  if (SHARE_PURCHASE_NAVIGATION_REQUEST.test(normalized)) {
    return "investments.share-purchase.guide";
  }
  if (WITHDRAWAL_NAVIGATION_REQUEST.test(normalized)) {
    return "investments.withdrawal.guide";
  }
  return null;
}

export type GovernedNavigationCitationRef = Readonly<Pick<
  AssistantCitation,
  | "citationId"
  | "sourceId"
  | "url"
  | "sourceAsOf"
  | "effectiveFrom"
  | "effectiveTo"
  | "contentHash"
>>;

export interface GovernedInAppNavigationAction extends AssistantInAppAction {
  readonly target: GovernedNavigationTarget;
  /** A reviewed app-relative route. It is never read from input or environment. */
  readonly href: AllowlistedInAppPath;
  readonly catalogVersion: typeof GOVERNED_NAVIGATION_CATALOG_VERSION;
}

export type GovernedNavigationDenialCode =
  | "INVALID_TRUSTED_CONTEXT"
  | "TARGET_NOT_ALLOWLISTED"
  | "TARGET_DISABLED"
  | "CHANNEL_DENIED"
  | "CONSENT_DENIED"
  | "ENTITLEMENT_DENIED"
  | "CAPABILITY_DENIED"
  | "FEATURE_DISABLED"
  | "CATALOG_NOT_EFFECTIVE"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_INELIGIBLE"
  | "ROUTE_NOT_ALLOWLISTED";

export type GovernedNavigationDecision =
  | Readonly<{
      status: "allowed";
      target: GovernedNavigationTarget;
      action: GovernedInAppNavigationAction;
      reasonCodes: readonly [];
    }>
  | Readonly<{
      status: "denied";
      target: string;
      action: null;
      reasonCodes: readonly GovernedNavigationDenialCode[];
    }>;

interface CatalogEvidence {
  readonly sourceId: string;
  readonly url: string;
  readonly sourceAsOf: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly contentHash: string;
}

interface EnabledCatalogEntry {
  readonly target: GovernedNavigationTarget;
  readonly status: "enabled";
  readonly actionId: string;
  readonly path: AllowlistedInAppPath;
  readonly labels: Readonly<Record<SupportedLocale, string>>;
  readonly requiredFeatureFlag: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly evidence: Readonly<Record<SupportedLocale, CatalogEvidence>>;
}

interface DisabledCatalogEntry {
  readonly target: GovernedNavigationTarget;
  readonly status: "disabled";
  readonly reason: "MISSING_APPROVED_BILINGUAL_EVIDENCE";
  readonly requiredFeatureFlag: string;
}

type CatalogEntry = EnabledCatalogEntry | DisabledCatalogEntry;

const ALLOWLISTED_IN_APP_PATHS = Object.freeze([
  "/investments/guides/account-opening",
  "/investments/guides/funding",
  "/investments/guides/share-purchase",
  "/investments/guides/withdrawal",
  "/investments/price-alerts/create"
] as const);

export type AllowlistedInAppPath = (typeof ALLOWLISTED_IN_APP_PATHS)[number];

export const GOVERNED_NAVIGATION_CATALOG_VERSION =
  "demo-invest-navigation-2026-07-29.v1" as const;

const ACCOUNT_OPENING_EN_EVIDENCE = Object.freeze({
  sourceId:
    "demo-invest-account-opening-en@project-authored-synthetic-2026-07-21",
  url: "https://knowledge.demo-invest.invalid/en/account-opening",
  sourceAsOf: "2026-07-21T00:00:00.000Z",
  effectiveFrom: "2026-07-21T00:00:00.000Z",
  effectiveTo: null,
  contentHash: "8523ac2eb5cae20efcf514a609f2d100562cb7e23425ae6b2ef769c4fda5a067"
} satisfies CatalogEvidence);

const ACCOUNT_OPENING_AZ_EVIDENCE = Object.freeze({
  sourceId:
    "demo-invest-account-opening-az@project-authored-synthetic-2026-07-21",
  url: "https://knowledge.demo-invest.invalid/az/account-opening",
  sourceAsOf: "2026-07-21T00:00:00.000Z",
  effectiveFrom: "2026-07-21T00:00:00.000Z",
  effectiveTo: null,
  contentHash: "c67aac1fc4de4ec08c82477fea709e86f218b68e9a942703a446408ff86832db"
} satisfies CatalogEvidence);

const FUNDING_EN_EVIDENCE = Object.freeze({
  sourceId:
    "demo-invest-funding-en@project-authored-synthetic-2026-07-21",
  url: "https://knowledge.demo-invest.invalid/en/funding",
  sourceAsOf: "2026-07-21T00:00:00.000Z",
  effectiveFrom: "2026-07-21T00:00:00.000Z",
  effectiveTo: null,
  contentHash: "525957899d5269a3681a1e1b8a7170eb6c9d9e53863211aca2233915168bbf0c"
} satisfies CatalogEvidence);

const FUNDING_AZ_EVIDENCE = Object.freeze({
  sourceId:
    "demo-invest-funding-az@project-authored-synthetic-2026-07-21",
  url: "https://knowledge.demo-invest.invalid/az/funding",
  sourceAsOf: "2026-07-21T00:00:00.000Z",
  effectiveFrom: "2026-07-21T00:00:00.000Z",
  effectiveTo: null,
  contentHash: "111648055ba6f696cccdb91f7d48c3f15fac759b71cd3360c0df9cd14277fa3f"
} satisfies CatalogEvidence);

const SHARE_PURCHASE_EN_EVIDENCE = Object.freeze({
  sourceId:
    "demo-invest-purchase-process-en@project-authored-synthetic-2026-07-21",
  url: "https://knowledge.demo-invest.invalid/en/order-preview",
  sourceAsOf: "2026-07-21T00:00:00.000Z",
  effectiveFrom: "2026-07-21T00:00:00.000Z",
  effectiveTo: null,
  contentHash: "913811301a0db26fce9b6f20b8fc53671576b1d9a2c4c014aa9eeddba7b7db66"
} satisfies CatalogEvidence);

const SHARE_PURCHASE_AZ_EVIDENCE = Object.freeze({
  sourceId:
    "demo-invest-purchase-process-az@project-authored-synthetic-2026-07-21",
  url: "https://knowledge.demo-invest.invalid/az/order-preview",
  sourceAsOf: "2026-07-21T00:00:00.000Z",
  effectiveFrom: "2026-07-21T00:00:00.000Z",
  effectiveTo: null,
  contentHash: "1189ae637d6e65c76eb3e120ecf156d6d4d7c1bc8c747ef3f569634878ab5f84"
} satisfies CatalogEvidence);

const WITHDRAWAL_EN_EVIDENCE = Object.freeze({
  sourceId:
    "demo-invest-withdrawal-en@project-authored-synthetic-2026-07-21",
  url: "https://knowledge.demo-invest.invalid/en/withdrawals",
  sourceAsOf: "2026-07-21T00:00:00.000Z",
  effectiveFrom: "2026-07-21T00:00:00.000Z",
  effectiveTo: null,
  contentHash: "98278a295cdee7e1d6e018312a4df4a209031c2ebfc2446c366a8861009751e6"
} satisfies CatalogEvidence);

const WITHDRAWAL_AZ_EVIDENCE = Object.freeze({
  sourceId:
    "demo-invest-withdrawal-az@project-authored-synthetic-2026-07-21",
  url: "https://knowledge.demo-invest.invalid/az/withdrawals",
  sourceAsOf: "2026-07-21T00:00:00.000Z",
  effectiveFrom: "2026-07-21T00:00:00.000Z",
  effectiveTo: null,
  contentHash: "c675669f5e2cd60332d2341de23d4632cfd8712708f1ba195d78a6ba16c200bc"
} satisfies CatalogEvidence);

const NAVIGATION_CATALOG: Readonly<Record<GovernedNavigationTarget, CatalogEntry>> =
  Object.freeze({
    "investments.account-opening.guide": Object.freeze({
      target: "investments.account-opening.guide",
      status: "enabled",
      actionId: "view-investment-account-opening-guide",
      path: "/investments/guides/account-opening",
      labels: Object.freeze({
        "en-US": "View account-opening steps",
        "az-AZ": "Hesabın açılması addımlarına bax"
      }),
      requiredFeatureFlag: "approvedKnowledge",
      effectiveFrom: "2026-07-21T00:00:00.000Z",
      effectiveTo: null,
      evidence: Object.freeze({
        "en-US": ACCOUNT_OPENING_EN_EVIDENCE,
        "az-AZ": ACCOUNT_OPENING_AZ_EVIDENCE
      })
    } satisfies EnabledCatalogEntry),
    "investments.funding.guide": Object.freeze({
      target: "investments.funding.guide",
      status: "enabled",
      actionId: "view-investment-account-funding-guide",
      path: "/investments/guides/funding",
      labels: Object.freeze({
        "en-US": "View funding steps",
        "az-AZ": "Mədaxil addımlarına bax"
      }),
      requiredFeatureFlag: "approvedKnowledge",
      effectiveFrom: "2026-07-21T00:00:00.000Z",
      effectiveTo: null,
      evidence: Object.freeze({
        "en-US": FUNDING_EN_EVIDENCE,
        "az-AZ": FUNDING_AZ_EVIDENCE
      })
    } satisfies EnabledCatalogEntry),
    "investments.share-purchase.guide": Object.freeze({
      target: "investments.share-purchase.guide",
      status: "enabled",
      actionId: "view-share-purchase-guide",
      path: "/investments/guides/share-purchase",
      labels: Object.freeze({
        "en-US": "View share-purchase steps",
        "az-AZ": "Səhm alışı addımlarına bax"
      }),
      requiredFeatureFlag: "approvedKnowledge",
      effectiveFrom: "2026-07-21T00:00:00.000Z",
      effectiveTo: null,
      evidence: Object.freeze({
        "en-US": SHARE_PURCHASE_EN_EVIDENCE,
        "az-AZ": SHARE_PURCHASE_AZ_EVIDENCE
      })
    } satisfies EnabledCatalogEntry),
    "investments.withdrawal.guide": Object.freeze({
      target: "investments.withdrawal.guide",
      status: "enabled",
      actionId: "view-investment-withdrawal-guide",
      path: "/investments/guides/withdrawal",
      labels: Object.freeze({
        "en-US": "View withdrawal steps",
        "az-AZ": "Məxaric addımlarına bax"
      }),
      requiredFeatureFlag: "approvedKnowledge",
      effectiveFrom: "2026-07-21T00:00:00.000Z",
      effectiveTo: null,
      evidence: Object.freeze({
        "en-US": WITHDRAWAL_EN_EVIDENCE,
        "az-AZ": WITHDRAWAL_AZ_EVIDENCE
      })
    } satisfies EnabledCatalogEntry),
    "investments.price-alerts.create": Object.freeze({
      target: "investments.price-alerts.create",
      status: "disabled",
      reason: "MISSING_APPROVED_BILINGUAL_EVIDENCE",
      requiredFeatureFlag: "priceAlerts"
    } satisfies DisabledCatalogEntry)
  });

export interface GovernedNavigationCatalogEntryMetadata {
  readonly target: GovernedNavigationTarget;
  readonly status: "enabled" | "disabled";
  readonly requiredFeatureFlag: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly evidenceLocales: readonly SupportedLocale[];
  readonly readinessBlocker: "MISSING_APPROVED_BILINGUAL_EVIDENCE" | null;
}

export interface GovernedNavigationCatalogMetadata {
  readonly schemaVersion: "assistant-v3.navigation-catalog-metadata.v1";
  readonly catalogVersion: typeof GOVERNED_NAVIGATION_CATALOG_VERSION;
  readonly entries: readonly GovernedNavigationCatalogEntryMetadata[];
}

const CATALOG_METADATA: GovernedNavigationCatalogMetadata = Object.freeze({
  schemaVersion: "assistant-v3.navigation-catalog-metadata.v1",
  catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION,
  entries: Object.freeze(GOVERNED_NAVIGATION_TARGETS.map((target) => {
    const entry = NAVIGATION_CATALOG[target];
    return Object.freeze(entry.status === "enabled"
      ? {
          target,
          status: entry.status,
          requiredFeatureFlag: entry.requiredFeatureFlag,
          effectiveFrom: entry.effectiveFrom,
          effectiveTo: entry.effectiveTo,
          evidenceLocales: Object.freeze(["en-US", "az-AZ"] as const),
          readinessBlocker: null
        }
      : {
          target,
          status: entry.status,
          requiredFeatureFlag: entry.requiredFeatureFlag,
          effectiveFrom: null,
          effectiveTo: null,
          evidenceLocales: Object.freeze([] as SupportedLocale[]),
          readinessBlocker: entry.reason
        });
  }))
});

/** Read-only catalog hook for health/readiness endpoints and release manifests. */
export function getGovernedNavigationCatalogMetadata(): GovernedNavigationCatalogMetadata {
  return CATALOG_METADATA;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function nonEmptyString(value: unknown, maxLength = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function trustedContextValid(context: TrustedRequestContext): boolean {
  return context !== null &&
    typeof context === "object" &&
    context.schemaVersion === "assistant-v3.request-context.v1" &&
    nonEmptyString(context.requestId) &&
    nonEmptyString(context.sessionId) &&
    nonEmptyString(context.principalRef) &&
    nonEmptyString(context.tenantRef) &&
    (context.locale === "en-US" || context.locale === "az-AZ") &&
    context.jurisdiction === "AZ" &&
    (context.authentication?.strength === "authenticated" ||
      context.authentication?.strength === "step_up") &&
    canonicalTimestamp(context.requestedAt) &&
    Array.isArray(context.consentScopes) &&
    Array.isArray(context.entitlements) &&
    Array.isArray(context.capabilities) &&
    context.featureSnapshot !== null &&
    typeof context.featureSnapshot === "object" &&
    context.featureSnapshot.flags !== null &&
    typeof context.featureSnapshot.flags === "object";
}

function isEffective(input: {
  asOf: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}): boolean {
  return input.asOf >= input.effectiveFrom &&
    (input.effectiveTo === null || input.asOf < input.effectiveTo);
}

function safeOfficialEvidenceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.hostname === "knowledge.demo-invest.invalid" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.href === value;
  } catch {
    return false;
  }
}

/**
 * Defense in depth for renderers. Exact matching makes protocol-relative URLs,
 * custom schemes, credentials, traversal, encoded routes, queries, fragments,
 * and every unreviewed path ineligible.
 */
export function isAllowlistedInAppPath(value: unknown): value is AllowlistedInAppPath {
  return typeof value === "string" &&
    !value.startsWith("//") &&
    !value.includes("?") &&
    !value.includes("#") &&
    (ALLOWLISTED_IN_APP_PATHS as readonly string[]).includes(value);
}

function citationIdValid(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
}

function citationShapeValid(value: unknown): value is GovernedNavigationCitationRef {
  if (value === null || typeof value !== "object") return false;
  const citation = value as Partial<GovernedNavigationCitationRef>;
  return typeof citation.citationId === "string" &&
    citationIdValid(citation.citationId) &&
    nonEmptyString(citation.sourceId) &&
    nonEmptyString(citation.url, 2_048) &&
    canonicalTimestamp(citation.sourceAsOf) &&
    (citation.effectiveFrom === null || canonicalTimestamp(citation.effectiveFrom)) &&
    (citation.effectiveTo === null || canonicalTimestamp(citation.effectiveTo)) &&
    typeof citation.contentHash === "string" &&
    /^[a-f0-9]{64}$/u.test(citation.contentHash);
}

function citationMatches(
  citation: GovernedNavigationCitationRef,
  expected: CatalogEvidence,
  asOf: string
): boolean {
  return citationIdValid(citation.citationId) &&
    citation.sourceId === expected.sourceId &&
    citation.url === expected.url &&
    safeOfficialEvidenceUrl(citation.url) &&
    citation.sourceAsOf === expected.sourceAsOf &&
    citation.effectiveFrom === expected.effectiveFrom &&
    citation.effectiveTo === expected.effectiveTo &&
    citation.contentHash === expected.contentHash &&
    isEffective({
      asOf,
      effectiveFrom: expected.effectiveFrom,
      effectiveTo: expected.effectiveTo
    });
}

function uniqueCitationIds(citations: readonly GovernedNavigationCitationRef[]): boolean {
  return new Set(citations.map(({ citationId }) => citationId)).size === citations.length;
}

function denied(
  target: string,
  reasonCodes: readonly GovernedNavigationDenialCode[]
): GovernedNavigationDecision {
  return Object.freeze({
    status: "denied",
    target,
    action: null,
    reasonCodes: Object.freeze([...new Set(reasonCodes)])
  });
}

function knownTarget(target: unknown): target is GovernedNavigationTarget {
  return typeof target === "string" &&
    (GOVERNED_NAVIGATION_TARGETS as readonly string[]).includes(target);
}

/**
 * Converts a semantic target into a reviewed in-app action. This service never
 * accepts route/URL/label/catalog overrides and reads no environment values.
 */
export class GovernedInAppNavigationService {
  evaluate(input: Readonly<{
    context: TrustedRequestContext;
    target: GovernedNavigationTarget;
    citationRefs: readonly GovernedNavigationCitationRef[];
  }>): GovernedNavigationDecision {
    const rawTarget: unknown = input?.target;
    if (!knownTarget(rawTarget)) {
      return denied(typeof rawTarget === "string" ? rawTarget : "", ["TARGET_NOT_ALLOWLISTED"]);
    }

    const entry = NAVIGATION_CATALOG[rawTarget];
    if (entry.status === "disabled") {
      return denied(rawTarget, ["TARGET_DISABLED"]);
    }

    if (!trustedContextValid(input.context)) {
      return denied(rawTarget, ["INVALID_TRUSTED_CONTEXT"]);
    }

    const reasons: GovernedNavigationDenialCode[] = [];
    const context = input.context;
    if (context.channel !== "web" && context.channel !== "mobile" && context.channel !== "test") {
      reasons.push("CHANNEL_DENIED");
    }
    if (!context.consentScopes.includes("approved_knowledge")) {
      reasons.push("CONSENT_DENIED");
    }
    if (!context.entitlements.includes("assistant_access") ||
      !context.entitlements.includes("knowledge_read")) {
      reasons.push("ENTITLEMENT_DENIED");
    }
    if (!context.capabilities.includes("approved-knowledge-read")) {
      reasons.push("CAPABILITY_DENIED");
    }
    if (context.featureSnapshot.flags[entry.requiredFeatureFlag] !== true) {
      reasons.push("FEATURE_DISABLED");
    }
    if (!isEffective({
      asOf: context.requestedAt,
      effectiveFrom: entry.effectiveFrom,
      effectiveTo: entry.effectiveTo
    })) {
      reasons.push("CATALOG_NOT_EFFECTIVE");
    }
    if (!isAllowlistedInAppPath(entry.path)) {
      reasons.push("ROUTE_NOT_ALLOWLISTED");
    }

    const rawCitations: readonly unknown[] = Array.isArray(input.citationRefs)
      ? input.citationRefs
      : [];
    const citations = rawCitations.filter(citationShapeValid);
    const expectedEvidence = entry.evidence[context.locale];
    const matchingCitations = citations.filter((citation) =>
      citation !== null &&
      typeof citation === "object" &&
      citationMatches(citation, expectedEvidence, context.requestedAt)
    );
    if (matchingCitations.length === 0) {
      reasons.push("EVIDENCE_MISSING");
    }
    if (citations.length !== rawCitations.length || !uniqueCitationIds(citations)) {
      reasons.push("EVIDENCE_INELIGIBLE");
    }

    if (reasons.length > 0) return denied(rawTarget, reasons);

    const action: GovernedInAppNavigationAction = Object.freeze({
      schemaVersion: "assistant-v3.in-app-navigation-action.v1",
      actionId: entry.actionId,
      kind: "open-in-app",
      target: rawTarget,
      label: entry.labels[context.locale],
      href: entry.path,
      citationRefs: Object.freeze(matchingCitations.map(({ citationId }) => citationId)),
      catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION
    });
    return Object.freeze({
      status: "allowed",
      target: rawTarget,
      action,
      reasonCodes: Object.freeze([] as const)
    });
  }

  resolveAction(input: Readonly<{
    context: TrustedRequestContext;
    target: GovernedNavigationTarget;
    citationRefs: readonly GovernedNavigationCitationRef[];
  }>): GovernedInAppNavigationAction | null {
    const decision = this.evaluate(input);
    return decision.status === "allowed" ? decision.action : null;
  }
}
