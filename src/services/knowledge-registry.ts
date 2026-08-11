import { createHash } from "node:crypto";
import type {
  KnowledgeApprovalMode,
  KnowledgeChunkMetadata,
  KnowledgeControlledApprovalVerifier,
  KnowledgeDocument,
  KnowledgeDocumentManifest,
  KnowledgeFacet,
  KnowledgeQueryContext
} from "../domain/knowledge.js";

export interface KnowledgeRegistryOptions {
  /** Trusted adapter backed by the approval system of record, not manifest data. */
  controlledApprovalVerifier?: KnowledgeControlledApprovalVerifier;
}

/**
 * The bundled open-source corpus uses a reserved, non-resolving namespace.
 * This prevents a synthetic citation from being mistaken for a third-party
 * product page. Real deployments should use controlled approvals backed by
 * their own evidence registry instead of expanding this demo allow-list.
 */
const PROJECT_PUBLICATION_HOSTS = new Set([
  "knowledge.demo-invest.invalid"
]);

const FACET_DOCUMENT_TYPES: Record<KnowledgeFacet, Set<KnowledgeDocumentManifest["documentType"]>> = {
  fees: new Set(["fee_schedule"]),
  account_opening: new Set(["product_doc"]),
  funding: new Set(["policy"]),
  withdrawal: new Set(["policy"]),
  product: new Set(["product_doc"]),
  risk_disclosure: new Set(["disclosure", "policy"]),
  research: new Set(["research"]),
  market_hours: new Set(["product_doc", "policy"]),
  purchase_process: new Set(["product_doc", "policy"]),
  sale_process: new Set(),
  asset_protection: new Set(),
  custody_registration: new Set(),
  instrument_availability: new Set(),
  taxation: new Set(),
  corporate_actions: new Set(),
  trade_restrictions: new Set(),
  support_navigation: new Set(),
  // An unclassified question must not search across every authority. Doing so
  // allowed a single generic word such as "investment", "shares", or
  // "trading" to select an unrelated policy. Unknown facets fail closed until
  // an independently approved source and deterministic classifier exist.
  general: new Set()
};

const UNTRUSTED_CONTENT_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|system|developer)\s+instructions?/iu,
  /reveal\s+(?:the\s+)?(?:system|developer)\s+prompt/iu,
  /<script\b/iu,
  /javascript\s*:/iu,
  /(?:api[_-]?key|authorization)\s*[:=]/iu
];

const APPROVAL_ROLES = new Set([
  "publisher",
  "content_owner",
  "product_owner",
  "legal",
  "compliance",
  "research_supervisor"
]);

const SAFE_APPROVAL_REFERENCE = /^[\p{L}\p{N}][\p{L}\p{N}._:/@+\-]{2,511}$/u;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedChecksum(value: string): string {
  return sha256(value.normalize("NFKC").replace(/\s+/gu, " ").trim());
}

function controlledManifestBindingSha256(manifest: KnowledgeDocumentManifest): string {
  return sha256(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    sourceId: manifest.sourceId,
    version: manifest.version,
    translationGroupId: manifest.translationGroupId ?? null,
    documentType: manifest.documentType,
    title: manifest.title,
    url: manifest.url,
    locale: manifest.locale,
    jurisdiction: manifest.jurisdiction,
    productScopes: [...manifest.productScopes].sort(),
    facets: [...manifest.facets].sort(),
    audience: manifest.audience,
    allowedChannels: [...manifest.allowedChannels].sort(),
    classification: manifest.classification,
    ownerTeam: manifest.ownerTeam,
    approvalStatus: manifest.approvalStatus,
    approvalBasis: manifest.approvalBasis,
    publishedAt: manifest.publishedAt,
    effectiveFrom: manifest.effectiveFrom,
    effectiveTo: manifest.effectiveTo,
    contentAsOf: manifest.contentAsOf,
    reviewDueAt: manifest.reviewDueAt,
    revokedAt: manifest.revokedAt,
    section: manifest.section,
    sourceChecksumSha256: manifest.sourceChecksumSha256,
    normalizedChecksumSha256: manifest.normalizedChecksumSha256,
    parserProfile: manifest.parserProfile,
    chunkingProfile: manifest.chunkingProfile,
    embeddingProfile: manifest.embeddingProfile,
    verifiedAt: manifest.verifiedAt
  }));
}

function validIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function projectPublicationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      PROJECT_PUBLICATION_HOSTS.has(url.hostname.toLowerCase()) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

function requiredControlledRoles(manifest: KnowledgeDocumentManifest): boolean {
  const roles = new Set(manifest.approvals.map(({ role }) => role));
  if (manifest.documentType === "research") {
    return roles.has("research_supervisor") && roles.has("compliance");
  }
  if (["fee_schedule", "disclosure", "policy"].includes(manifest.documentType)) {
    return roles.has("content_owner") && (roles.has("legal") || roles.has("compliance"));
  }
  return roles.has("content_owner") && roles.has("product_owner");
}

function assertDocumentIntegrity(document: KnowledgeDocument): void {
  const { manifest, content } = document;
  if (!content.trim()) throw new Error(`${manifest.sourceId}: empty knowledge content`);
  if (!projectPublicationUrl(manifest.url) && manifest.classification === "public") {
    throw new Error(
      `${manifest.sourceId}: public source URL is not an allow-listed project publication HTTPS host`
    );
  }
  if (sha256(content) !== manifest.sourceChecksumSha256) {
    throw new Error(`${manifest.sourceId}: source checksum mismatch`);
  }
  if (normalizedChecksum(content) !== manifest.normalizedChecksumSha256) {
    throw new Error(`${manifest.sourceId}: normalized checksum mismatch`);
  }
  for (const field of ["publishedAt", "effectiveFrom", "verifiedAt"] as const) {
    if (!validIso(manifest[field])) throw new Error(`${manifest.sourceId}: invalid ${field}`);
  }
  for (const value of [manifest.effectiveTo, manifest.contentAsOf, manifest.reviewDueAt, manifest.revokedAt]) {
    if (value !== null && !validIso(value)) throw new Error(`${manifest.sourceId}: invalid optional date`);
  }
  if (manifest.publishedAt > manifest.verifiedAt) {
    throw new Error(`${manifest.sourceId}: publishedAt cannot be after verifiedAt`);
  }
  if (manifest.effectiveTo !== null && manifest.effectiveTo <= manifest.effectiveFrom) {
    throw new Error(`${manifest.sourceId}: effectiveTo must be after effectiveFrom`);
  }
  const approvalIdentities = new Set<string>();
  for (const approval of manifest.approvals) {
    if (!APPROVAL_ROLES.has(approval.role)) {
      throw new Error(`${manifest.sourceId}: unsupported approval role`);
    }
    if (!SAFE_APPROVAL_REFERENCE.test(approval.actorRef) ||
      !SAFE_APPROVAL_REFERENCE.test(approval.approvalRef)) {
      throw new Error(`${manifest.sourceId}: malformed approval reference`);
    }
    if (!validIso(approval.decidedAt)) {
      throw new Error(`${manifest.sourceId}: invalid approval decidedAt`);
    }
    if (approval.decidedAt > manifest.verifiedAt) {
      throw new Error(`${manifest.sourceId}: approval decidedAt cannot be after verifiedAt`);
    }
    const identity = `${approval.role}\u0000${approval.actorRef}\u0000${approval.approvalRef}`;
    if (approvalIdentities.has(identity)) {
      throw new Error(`${manifest.sourceId}: duplicate approval record`);
    }
    approvalIdentities.add(identity);
  }
  if (manifest.approvalBasis === "controlled_approval") {
    if (manifest.classification !== "internal_approved") {
      throw new Error(`${manifest.sourceId}: controlled approval requires internal_approved classification`);
    }
    const approverActors = manifest.approvals.map(({ actorRef }) => actorRef);
    if (new Set(approverActors).size !== approverActors.length) {
      throw new Error(`${manifest.sourceId}: controlled approval requires separation of duties`);
    }
  }
  if (manifest.documentType === "research") {
    if (!manifest.contentAsOf || !manifest.effectiveTo || !manifest.reviewDueAt) {
      throw new Error(`${manifest.sourceId}: research requires contentAsOf, reviewDueAt, and effectiveTo`);
    }
    if (manifest.contentAsOf > manifest.publishedAt) {
      throw new Error(`${manifest.sourceId}: research contentAsOf cannot be after publishedAt`);
    }
    if (manifest.reviewDueAt <= manifest.verifiedAt) {
      throw new Error(`${manifest.sourceId}: research reviewDueAt must be after verifiedAt`);
    }
    if (manifest.reviewDueAt > manifest.effectiveTo) {
      throw new Error(`${manifest.sourceId}: research reviewDueAt cannot be after effectiveTo`);
    }
  }
  if (UNTRUSTED_CONTENT_PATTERNS.some((pattern) => pattern.test(content))) {
    throw new Error(`${manifest.sourceId}: content quarantine rule matched`);
  }
  if (!manifest.allowedChannels.length || !manifest.productScopes.length || !manifest.facets.length) {
    throw new Error(`${manifest.sourceId}: retrieval scope is missing`);
  }
  if (new Set(manifest.facets).size !== manifest.facets.length) {
    throw new Error(`${manifest.sourceId}: duplicate knowledge facet`);
  }
  for (const facet of manifest.facets) {
    if (facet === "general" || !FACET_DOCUMENT_TYPES[facet].has(manifest.documentType)) {
      throw new Error(`${manifest.sourceId}: document type is not authoritative for facet ${facet}`);
    }
  }
}

function windowsOverlap(left: KnowledgeDocumentManifest, right: KnowledgeDocumentManifest): boolean {
  const leftEnd = left.effectiveTo ?? "9999-12-31T23:59:59.999Z";
  const rightEnd = right.effectiveTo ?? "9999-12-31T23:59:59.999Z";
  return left.effectiveFrom < rightEnd && right.effectiveFrom < leftEnd;
}

export function detectKnowledgeFacet(query: string): KnowledgeFacet {
  if (/\b(?:fees?|commissions?|charges?|tariffs?|trading\s+costs?)\b|(?:komissiya|tarif|ticarət\s+xərc|xidmət\s+haqq)\p{L}*/iu.test(query)) return "fees";
  if (/\b(?:stock\s+)?price\s+alerts?\b|\balerts?\s+(?:for|when)\s+(?:a\s+)?(?:stock\s+)?price\b|(?<!\p{L})(?:qiym[əe]t\s+(?:bildiri[şs]|x[əe]b[əe]rdarl[ıi]q)\p{L}*|(?:bildiri[şs]|x[əe]b[əe]rdarl[ıi]q)\p{L}*\s+(?:yarat|qur|[əe]lav[əe])\p{L}*)(?!\p{L})/iu.test(query)) return "support_navigation";
  if (/\b(?:open|create|register)\b[^.!?]{0,50}\b(?:investment\s+)?account\b|\bminimum\s+(?:top[ -]?up|deposit)\b|(?:hesab\p{L}*[^.!?\n]{0,40}aç|qeydiyyat|rəqəmsal\s+imza|ən\s+azı[^.!?]{0,40}mədaxil)/iu.test(query)) return "account_opening";
  if (
    /\b(?:funding|deposit|top[ -]?up)\b|\bfund\b[^.!?\n]{0,50}\b(?:my\s+)?(?:investment\s+)?account\b|\b(?:mədaxil|medaxil|maliyyələşdir)\p{L}*\b/iu.test(query)
  ) return "funding";
  if (/\b(?:withdraw|withdrawal|cash\s+out|settlement)\b/iu.test(query) || /(?:məxaric\p{L}*|mexaric\p{L}*|(?:pul|vəsait|hesab|balans)\p{L}*[^.!?\n]{0,60}çıxar\p{L}*|çıxar\p{L}*[^.!?\n]{0,60}(?:pul|vəsait|hesab|balans|limit)\p{L}*|hesablaşma\p{L}*)/iu.test(query)) return "withdrawal";
  if (
    /\b(?:(?:market|trading|exchange)\s+(?:days?\s+and\s+)?hours?|pre[ -]?market|after[ -]?market(?:\s+hours?)?|after[ -]?hours?|non[ -]?trading\s+hours?|(?:stock\s+)?exchanges?\s+(?:open|close))\b/iu.test(query) ||
    /(?<!\p{L})(?:(?:bazar|ticarət|birja)\s+(?:gün\p{L}*\s+və\s+)?saat\p{L}*|birja\p{L}*[^.!?\n]{0,30}(?:açıl|bağlan)\p{L}*|qeyri[\s-]*ticarət\s+saat\p{L}*)(?!\p{L})/iu.test(query)
  ) return "market_hours";
  if (
    /\b(?:how\s+(?:is|do|can)\b[^.!?\n]{0,50}\b(?:purchase|buy)|purchase\s+(?:operation|process)|buying\s+(?:operation|process)|how\s+to\s+(?:purchase|buy))\b[^.!?\n]{0,80}\b(?:shares?|stocks?|securities)?/iu.test(query) ||
    /(?<!\p{L})(?:(?:səhm|sehm|qiymətli\s+kağız)\p{L}*[^.!?\n]{0,50}(?:necə|nece)\s+al\p{L}*|al[ıi][şs]\s+(?:əməliyyat|emeliyyat|prosesi|sifari[şs])\p{L}*|(?:necə|nece)\s+(?:səhm|sehm)\p{L}*\s+al\p{L}*)(?!\p{L})/iu.test(query)
  ) return "purchase_process";
  if (
    /\b(?:sale|selling)\s+(?:operation|operaton|process)\b|\bhow\s+(?:is|do|can)\b[^.!?\n]{0,50}\b(?:sell|sale)\b/iu.test(query) ||
    /(?<!\p{L})(?:sat[ıi][şs]\s+(?:əməliyyat|emeliyyat|prosesi)\p{L}*|(?:necə|nece)\s+(?:səhm|sehm|qiymətli\s+kağız)\p{L}*\s+sat\p{L}*)(?!\p{L})/iu.test(query)
  ) return "sale_process";
  if (
    /\b(?:insurance|insurence|insured|protection|protected)\b[^.!?\n]{0,90}\b(?:securities|shares?|cash|investment|loss)\b|\b(?:securities|shares?|cash|investment)\b[^.!?\n]{0,90}\b(?:insurance|insurence|insured|protection|protected)\b/iu.test(query) ||
    /(?<!\p{L})(?:sığorta\p{L}*[^.!?\n]{0,90}(?:qiymətli\s+kağız|səhm|nağd|vəsait|itki)|(?:qiymətli\s+kağız|səhm|nağd|vəsait|itki)\p{L}*[^.!?\n]{0,90}sığorta\p{L}*)(?!\p{L})/iu.test(query)
  ) return "asset_protection";
  if (
    /\b(?:whose\s+name|name\s+of\s+(?:the\s+)?(?:owner|holder))\b[^.!?\n]{0,90}\b(?:securities|shares?)\b|\b(?:securities|shares?)\b[^.!?\n]{0,90}\b(?:registered|reegistered|registration|custody|custodian|held)\b/iu.test(query) ||
    /(?<!\p{L})(?:qiymətli\s+kağız|səhm)\p{L}*[^.!?\n]{0,90}(?:kimin\s+adına|qeydiyyat|saxlan)\p{L}*(?!\p{L})/iu.test(query)
  ) return "custody_registration";
  if (
    /\b(?:what|which)\s+(?:types?\s+of\s+)?investment\s+instruments?\b[^.!?\n]{0,60}\b(?:available|trade|offered)\b|\b(?:available|offered)\b[^.!?\n]{0,60}\binvestment\s+instruments?\b/iu.test(query) ||
    /(?<!\p{L})(?:hansı|necə)\s+investisiya\s+alət\p{L}*[^.!?\n]{0,60}(?:mövcud|ticarət|təklif)\p{L}*(?!\p{L})/iu.test(query)
  ) return "instrument_availability";
  if (
    /\b(?:tax|taxation|taxable)\b[^.!?\n]{0,90}\b(?:investment|profit|gain|dividend|securit)\p{L}*|\b(?:investment|profit|gain|dividend)\p{L}*[^.!?\n]{0,90}\b(?:tax|taxation|taxable)\b/iu.test(query) ||
    /(?<!\p{L})(?:vergi\p{L}*[^.!?\n]{0,90}(?:investisiya|gəlir|mənfəət|dividend)|(?:investisiya|gəlir|mənfəət|dividend)\p{L}*[^.!?\n]{0,90}vergi\p{L}*)(?!\p{L})/iu.test(query)
  ) return "taxation";
  if (
    /\b(?:number|quantity)\s+of\s+shares?\b[^.!?\n]{0,90}\b(?:changed?|different)\b|\b(?:stock\s+split|reverse\s+split|corporate\s+action)\b/iu.test(query) ||
    /(?<!\p{L})(?:səhm|sehm)\p{L}*\s+(?:say|sayım|miqdar)\p{L}*[^.!?\n]{0,90}(?:dəyiş|ferqli|fərqli)\p{L}*|korporativ\s+hərəkət\p{L}*(?!\p{L})/iu.test(query)
  ) return "corporate_actions";
  if (
    /\b(?:trade|trande|trading)\s+restrictions?\b|\brestrictions?\s+(?:on|for)\s+(?:trade|trande|trading)\b/iu.test(query) ||
    /(?<!\p{L})(?:ticarət\s+məhdudiyyət\p{L}*|ticarət\p{L}*[^.!?\n]{0,50}məhdudiyyət\p{L}*)(?!\p{L})/iu.test(query)
  ) return "trade_restrictions";
  if (/\b(?:contact\s+support|help\s+center|customer\s+support)\b|\b(?:dəstək|destek)\s+(?:mərkəz|merkez|xətt|xett)\p{L}*\b/iu.test(query)) return "support_navigation";
  if (/\b(?:disclosure|margin\s+risk|risk\s+warning)\b|(?:risk\s+açıqlama\p{L}*|marja\s+ticarət\p{L}*)/iu.test(query)) return "risk_disclosure";
  if (/\b(?:research|weekly\s+(?:review|outlook)|market\s+review)\b|(?:araşdırma\p{L}*|həftəlik\s+icmal\p{L}*)/iu.test(query)) return "research";
  if (/\b(?:demo\s+invest|investment\s+(?:product|service)|investments\s+section|terms?\s+(?:of|for)\s+(?:the\s+)?investment\s+service)\b|(?:[iİ]nvestisiya\p{L}*\s+(?:məhsul|xidmət|bölmə)\p{L}*)/iu.test(query)) return "product";
  return "general";
}

export class KnowledgeRegistry {
  private readonly documentsByKey = new Map<string, KnowledgeDocument>();
  private readonly controlledApprovalVerifier: KnowledgeControlledApprovalVerifier | undefined;

  constructor(
    documents: readonly KnowledgeDocument[],
    readonly approvalMode: KnowledgeApprovalMode,
    options: KnowledgeRegistryOptions = {}
  ) {
    this.controlledApprovalVerifier = options.controlledApprovalVerifier;
    for (const document of documents) {
      assertDocumentIntegrity(document);
      const key = this.key(document.manifest.sourceId, document.manifest.version);
      if (this.documentsByKey.has(key)) throw new Error(`${key}: duplicate knowledge document`);
      this.documentsByKey.set(key, document);
    }
    this.assertNoOverlappingActiveAuthorities();
  }

  allDocuments(): KnowledgeDocument[] {
    return [...this.documentsByKey.values()];
  }

  /** Documents whose approval basis is permitted to enter the active index. */
  indexableDocuments(): KnowledgeDocument[] {
    return this.allDocuments().filter(({ manifest }) =>
      manifest.approvalStatus === "approved" &&
      manifest.revokedAt === null &&
      this.approvalAccepted(manifest)
    );
  }

  eligibleDocuments(context: KnowledgeQueryContext, facet: KnowledgeFacet): KnowledgeDocument[] {
    return this.allDocuments().filter(({ manifest }) =>
      this.isManifestEligible(manifest, context, facet)
    );
  }

  isChunkEligible(
    metadata: KnowledgeChunkMetadata,
    context: KnowledgeQueryContext,
    facet: KnowledgeFacet
  ): boolean {
    const document = this.documentsByKey.get(this.key(metadata.sourceId, metadata.version));
    if (!document || !this.isManifestEligible(document.manifest, context, facet)) return false;
    const manifest = document.manifest;
    return metadata.sourceChecksumSha256 === manifest.sourceChecksumSha256 &&
      metadata.title === manifest.title &&
      metadata.url === manifest.url &&
      metadata.locale === manifest.locale &&
      metadata.jurisdiction === manifest.jurisdiction &&
      metadata.approvalStatus === manifest.approvalStatus &&
      metadata.approvalBasis === manifest.approvalBasis &&
      metadata.effectiveFrom === manifest.effectiveFrom &&
      metadata.effectiveTo === (manifest.effectiveTo ?? "9999-12-31T23:59:59.999Z") &&
      metadata.productScope === "DEMO_INVEST" &&
      metadata.channel === context.channel;
  }

  private isManifestEligible(
    manifest: KnowledgeDocumentManifest,
    context: KnowledgeQueryContext,
    facet: KnowledgeFacet
  ): boolean {
    if (manifest.approvalStatus !== "approved" || manifest.revokedAt !== null) return false;
    if (manifest.locale !== context.locale || manifest.jurisdiction !== context.jurisdiction) return false;
    if (manifest.audience !== "customer" || !manifest.allowedChannels.includes(context.channel)) return false;
    if (!manifest.productScopes.some((scope) => context.productScopes.includes(scope))) return false;
    if (context.asOf < manifest.verifiedAt) return false;
    if (manifest.effectiveFrom > context.asOf) return false;
    if (manifest.effectiveTo !== null && context.asOf >= manifest.effectiveTo) return false;
    if (manifest.documentType === "research") {
      if (!manifest.contentAsOf || !manifest.reviewDueAt) return false;
      if (context.asOf < manifest.contentAsOf || context.asOf >= manifest.reviewDueAt) return false;
    }
    if (!FACET_DOCUMENT_TYPES[facet].has(manifest.documentType)) return false;
    if (facet !== "general" && !manifest.facets.includes(facet)) return false;

    return this.approvalAccepted(manifest, context.asOf);
  }

  private approvalAccepted(manifest: KnowledgeDocumentManifest, asOf?: string): boolean {
    if (manifest.approvalBasis === "controlled_approval") {
      if (!this.controlledApprovalVerifier || !requiredControlledRoles(manifest)) return false;
      if (asOf && manifest.approvals.some(({ decidedAt }) => decidedAt > asOf)) return false;
      try {
        const manifestBindingSha256 = controlledManifestBindingSha256(manifest);
        return manifest.approvals.every((approval) => this.controlledApprovalVerifier?.verify({
          sourceId: manifest.sourceId,
          version: manifest.version,
          sourceChecksumSha256: manifest.sourceChecksumSha256,
          manifestBindingSha256,
          ...approval
        }) === true);
      } catch {
        return false;
      }
    }
    if (this.approvalMode === "controlled") return false;
    return projectPublicationUrl(manifest.url) &&
      manifest.approvals.some(({ role, approvalRef }) => role === "publisher" && approvalRef === manifest.url);
  }

  private assertNoOverlappingActiveAuthorities(): void {
    const documents = this.allDocuments().map(({ manifest }) => manifest);
    for (let index = 0; index < documents.length; index += 1) {
      const left = documents[index];
      if (!left || left.approvalStatus !== "approved" || left.revokedAt !== null ||
        !this.approvalAccepted(left)) continue;
      for (let otherIndex = index + 1; otherIndex < documents.length; otherIndex += 1) {
        const right = documents[otherIndex];
        if (!right || right.approvalStatus !== "approved" || right.revokedAt !== null ||
          !this.approvalAccepted(right)) continue;
        const productOverlap = left.productScopes.some((scope) => right.productScopes.includes(scope));
        const leftAuthorityFacets = left.facets.filter((facet) =>
          FACET_DOCUMENT_TYPES[facet].has(left.documentType)
        );
        const facetOverlap = leftAuthorityFacets.some((facet) =>
          right.facets.includes(facet) && FACET_DOCUMENT_TYPES[facet].has(right.documentType)
        );
        const channelOverlap = left.allowedChannels.some((channel) => right.allowedChannels.includes(channel));
        if (
          left.locale === right.locale && left.jurisdiction === right.jurisdiction &&
          left.audience === right.audience && productOverlap && facetOverlap && channelOverlap &&
          windowsOverlap(left, right)
        ) {
          throw new Error(
            `${left.sourceId} and ${right.sourceId}: overlapping authoritative effective windows`
          );
        }
      }
    }
  }

  private key(sourceId: string, version: string): string {
    return `${sourceId}@${version}`;
  }
}
