import { createHash } from "node:crypto";

import type {
  ApprovedFinancialEducationDocument,
  FinancialEducationAuthorityBinding,
  FinancialEducationAuthorityPolicy,
  FinancialEducationDocumentManifest,
  FinancialEducationProposition,
  FinancialEducationQueryContext
} from "../domain/financial-education.js";
import type { SupportedLocale } from "../domain/types.js";

const SAFE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._:/@+\-]{1,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UNTRUSTED_CONTENT_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|system|developer)\s+instructions?/iu,
  /reveal\s+(?:the\s+)?(?:system|developer)\s+prompt/iu,
  /<script\b/iu,
  /javascript\s*:/iu,
  /(?:api[_-]?key|authorization)\s*[:=]/iu
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function canonicalPropositions(
  propositions: readonly FinancialEducationProposition[]
): string {
  return JSON.stringify(
    propositions.map(({ propositionId, section, text }) => ({
      propositionId,
      section,
      text
    }))
  );
}

/** Used by the controlled ingestion pipeline when publishing a document. */
export function financialEducationContentSha256(
  propositions: readonly FinancialEducationProposition[]
): string {
  return sha256(canonicalPropositions(propositions));
}

function manifestBindingSha256(
  manifest: FinancialEducationDocumentManifest
): string {
  return sha256(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    sourceId: manifest.sourceId,
    version: manifest.version,
    translationGroupId: manifest.translationGroupId,
    title: manifest.title,
    sourceUrl: manifest.sourceUrl,
    locale: manifest.locale,
    jurisdiction: manifest.jurisdiction,
    audience: manifest.audience,
    channel: manifest.channel,
    approvalStatus: manifest.approvalStatus,
    approvalRef: manifest.approvalRef,
    publishedAt: manifest.publishedAt,
    effectiveFrom: manifest.effectiveFrom,
    effectiveTo: manifest.effectiveTo,
    reviewedAt: manifest.reviewedAt,
    reviewDueAt: manifest.reviewDueAt,
    contentSha256: manifest.contentSha256
  }));
}

export function financialEducationAuthorityBinding(
  document: ApprovedFinancialEducationDocument,
  authorityId: string
): FinancialEducationAuthorityBinding {
  return Object.freeze({
    authorityId,
    sourceId: document.manifest.sourceId,
    version: document.manifest.version,
    locale: document.manifest.locale,
    approvalRef: document.manifest.approvalRef,
    contentSha256: document.manifest.contentSha256,
    manifestBindingSha256: manifestBindingSha256(document.manifest)
  });
}

function assertHttpsAllowlistedUrl(
  value: string,
  allowedHosts: ReadonlySet<string>
): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Financial-education source URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.port.length > 0 ||
    !allowedHosts.has(parsed.hostname.toLowerCase())
  ) {
    throw new Error(
      "Financial-education source URL is outside the approved HTTPS authority."
    );
  }
}

function assertPropositions(
  sourceId: string,
  propositions: readonly FinancialEducationProposition[]
): void {
  if (propositions.length < 1 || propositions.length > 100) {
    throw new Error(`${sourceId}: proposition count is outside the approved bound.`);
  }
  const ids = new Set<string>();
  for (const proposition of propositions) {
    if (
      !SAFE_ID.test(proposition.propositionId) ||
      proposition.section.trim().length < 1 ||
      proposition.section.length > 200 ||
      proposition.text.trim() !== proposition.text ||
      proposition.text.length < 20 ||
      proposition.text.length > 1_000
    ) {
      throw new Error(`${sourceId}: proposition metadata or text is invalid.`);
    }
    if (ids.has(proposition.propositionId)) {
      throw new Error(`${sourceId}: duplicate proposition identifier.`);
    }
    ids.add(proposition.propositionId);
    if (
      UNTRUSTED_CONTENT_PATTERNS.some((pattern) =>
        pattern.test(`${proposition.section}\n${proposition.text}`)
      )
    ) {
      throw new Error(`${sourceId}: proposition content matched a quarantine rule.`);
    }
  }
}

function assertDocument(
  document: ApprovedFinancialEducationDocument,
  policy: FinancialEducationAuthorityPolicy,
  allowedHosts: ReadonlySet<string>
): void {
  const { manifest, propositions } = document;
  if (
    manifest.schemaVersion !==
      "assistant-v3.financial-education-document.v1" ||
    (manifest.locale !== "en-US" && manifest.locale !== "az-AZ") ||
    manifest.jurisdiction !== "AZ" ||
    manifest.audience !== "customer" ||
    manifest.channel !== "customer_chat" ||
    manifest.approvalStatus !== "approved"
  ) {
    throw new Error(`${manifest.sourceId}: document policy metadata is invalid.`);
  }
  for (const value of [
    manifest.sourceId,
    manifest.version,
    manifest.translationGroupId,
    manifest.approvalRef
  ]) {
    if (!SAFE_ID.test(value)) {
      throw new Error(`${manifest.sourceId}: authority identifier is invalid.`);
    }
  }
  if (
    manifest.title.trim() !== manifest.title ||
    manifest.title.length < 3 ||
    manifest.title.length > 240
  ) {
    throw new Error(`${manifest.sourceId}: title is invalid.`);
  }
  assertHttpsAllowlistedUrl(manifest.sourceUrl, allowedHosts);
  for (const value of [
    manifest.publishedAt,
    manifest.effectiveFrom,
    manifest.reviewedAt,
    manifest.reviewDueAt
  ]) {
    if (!validIso(value)) {
      throw new Error(`${manifest.sourceId}: document timestamp is invalid.`);
    }
  }
  if (manifest.effectiveTo !== null && !validIso(manifest.effectiveTo)) {
    throw new Error(`${manifest.sourceId}: effectiveTo is invalid.`);
  }
  if (
    manifest.publishedAt > manifest.reviewedAt ||
    manifest.reviewedAt > manifest.effectiveFrom ||
    manifest.reviewDueAt <= manifest.reviewedAt ||
    (
      manifest.effectiveTo !== null &&
      (
        manifest.effectiveTo <= manifest.effectiveFrom ||
        manifest.reviewDueAt > manifest.effectiveTo
      )
    )
  ) {
    throw new Error(`${manifest.sourceId}: document governance window is invalid.`);
  }
  assertPropositions(manifest.sourceId, propositions);
  const expectedContentSha256 = financialEducationContentSha256(propositions);
  if (
    !SHA256.test(manifest.contentSha256) ||
    manifest.contentSha256 !== expectedContentSha256
  ) {
    throw new Error(`${manifest.sourceId}: content checksum mismatch.`);
  }
  let approved = false;
  try {
    approved = policy.verifier.verify(
      financialEducationAuthorityBinding(document, policy.authorityId)
    );
  } catch {
    approved = false;
  }
  if (!approved) {
    throw new Error(`${manifest.sourceId}: independent approval verification failed.`);
  }
}

function endOfWindow(manifest: FinancialEducationDocumentManifest): string {
  return manifest.effectiveTo ?? "9999-12-31T23:59:59.999Z";
}

function windowsOverlap(
  left: FinancialEducationDocumentManifest,
  right: FinancialEducationDocumentManifest
): boolean {
  return left.effectiveFrom < endOfWindow(right) &&
    right.effectiveFrom < endOfWindow(left);
}

export class FinancialEducationRegistry {
  readonly authorityId: string;
  readonly requiredLocales: readonly SupportedLocale[];
  readonly #documents: readonly ApprovedFinancialEducationDocument[];

  constructor(input: {
    readonly documents: readonly ApprovedFinancialEducationDocument[];
    readonly authority: FinancialEducationAuthorityPolicy;
  }) {
    if (!SAFE_ID.test(input.authority.authorityId)) {
      throw new Error("Financial-education authority ID is invalid.");
    }
    const allowedHosts = new Set(
      input.authority.allowedSourceHosts.map((host) => host.toLowerCase())
    );
    if (allowedHosts.size === 0 || allowedHosts.has("")) {
      throw new Error("Financial-education source authority is empty.");
    }
    const requiredLocales = [...new Set(input.authority.requiredLocales)];
    if (
      requiredLocales.length !== 2 ||
      !requiredLocales.includes("en-US") ||
      !requiredLocales.includes("az-AZ")
    ) {
      throw new Error(
        "Financial-education authority must require English and Azerbaijani."
      );
    }
    for (const document of input.documents) {
      assertDocument(document, input.authority, allowedHosts);
    }
    this.assertUniqueVersions(input.documents);
    this.assertBilingualTranslationGroups(input.documents, requiredLocales);
    this.authorityId = input.authority.authorityId;
    this.requiredLocales = Object.freeze(requiredLocales);
    this.#documents = Object.freeze(
      input.documents.map((document) => Object.freeze({
        manifest: Object.freeze({ ...document.manifest }),
        propositions: Object.freeze(
          document.propositions.map((proposition) =>
            Object.freeze({ ...proposition })
          )
        )
      }))
    );
  }

  allDocuments(): readonly ApprovedFinancialEducationDocument[] {
    return this.#documents;
  }

  eligibleDocuments(
    context: FinancialEducationQueryContext
  ): readonly ApprovedFinancialEducationDocument[] {
    if (
      context.jurisdiction !== "AZ" ||
      context.channel !== "customer_chat" ||
      !this.requiredLocales.includes(context.locale) ||
      !validIso(context.asOf)
    ) {
      return [];
    }
    return this.#documents.filter(({ manifest }) =>
      manifest.locale === context.locale &&
      manifest.jurisdiction === context.jurisdiction &&
      manifest.audience === "customer" &&
      manifest.channel === context.channel &&
      manifest.approvalStatus === "approved" &&
      manifest.effectiveFrom <= context.asOf &&
      endOfWindow(manifest) > context.asOf &&
      manifest.reviewedAt <= context.asOf &&
      manifest.reviewDueAt > context.asOf
    );
  }

  #translationGroupKey(
    document: ApprovedFinancialEducationDocument
  ): string {
    return `${document.manifest.translationGroupId}@${document.manifest.version}`;
  }

  private assertUniqueVersions(
    documents: readonly ApprovedFinancialEducationDocument[]
  ): void {
    const exactKeys = new Set<string>();
    for (const document of documents) {
      const manifest = document.manifest;
      const exactKey = `${manifest.sourceId}@${manifest.version}:${manifest.locale}`;
      if (exactKeys.has(exactKey)) {
        throw new Error(`${exactKey}: duplicate financial-education document.`);
      }
      exactKeys.add(exactKey);
    }
    for (let index = 0; index < documents.length; index += 1) {
      const left = documents[index]!;
      for (let otherIndex = index + 1; otherIndex < documents.length; otherIndex += 1) {
        const right = documents[otherIndex]!;
        if (
          left.manifest.sourceId === right.manifest.sourceId &&
          left.manifest.locale === right.manifest.locale &&
          windowsOverlap(left.manifest, right.manifest)
        ) {
          throw new Error(
            `${left.manifest.sourceId}: overlapping approved source versions.`
          );
        }
      }
    }
  }

  private assertBilingualTranslationGroups(
    documents: readonly ApprovedFinancialEducationDocument[],
    requiredLocales: readonly SupportedLocale[]
  ): void {
    const groups = new Map<string, ApprovedFinancialEducationDocument[]>();
    for (const document of documents) {
      const key = this.#translationGroupKey(document);
      const group = groups.get(key) ?? [];
      group.push(document);
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      const locales = new Set(group.map(({ manifest }) => manifest.locale));
      if (
        group.length !== requiredLocales.length ||
        locales.size !== requiredLocales.length ||
        requiredLocales.some((locale) => !locales.has(locale))
      ) {
        throw new Error(`${key}: required bilingual coverage is incomplete.`);
      }
      const baseline = group[0]!;
      const baselineIds = baseline.propositions.map(({ propositionId }) =>
        propositionId
      );
      for (const document of group.slice(1)) {
        const ids = document.propositions.map(({ propositionId }) =>
          propositionId
        );
        if (
          ids.length !== baselineIds.length ||
          ids.some((id, index) => id !== baselineIds[index]) ||
          document.manifest.effectiveFrom !== baseline.manifest.effectiveFrom ||
          document.manifest.effectiveTo !== baseline.manifest.effectiveTo ||
          document.manifest.reviewDueAt !== baseline.manifest.reviewDueAt
        ) {
          throw new Error(`${key}: translated document governance is inconsistent.`);
        }
      }
    }
  }
}
