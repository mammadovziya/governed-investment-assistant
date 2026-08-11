import { createHash } from "node:crypto";

export function normalizeFinancialEducationQuery(message: string): string | null {
  const normalized = message
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    normalized.length === 0 ||
    normalized.length > 2_000 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function financialEducationQueryHash(message: string): string | null {
  const normalized = normalizeFinancialEducationQuery(message);
  return normalized === null
    ? null
    : createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function financialEducationRouteReason(message: string): string | null {
  const hash = financialEducationQueryHash(message);
  return hash === null ? null : `education_query:${hash}`;
}
