export type V3DirectCurrency = "USD" | "AZN";

const AZN_WORD_TARGET =
  /(?<!\p{L})(?:az[əe]rbaycan(?:[ıi]n)?\s+)?manat(?:[ıi])?(?:\s+il[əe]|la|l[əe]|da|d[əe]|a|[əe]|d[ıi]r|\s+olaraq|\s+cinsind[əe]|\s+ekvivalent\p{L}*)?(?!\p{L})/iu;

/**
 * Extracts only an explicitly requested USD/AZN target from the current turn.
 * The shared parser keeps direct selection, argument derivation, and grounding
 * authorization aligned for English and natural Azerbaijani wording.
 */
export function v3DirectTargetCurrency(
  query: string
): V3DirectCurrency | null {
  const normalized = query.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const codeMatch =
    /(?:\b(?:to|into|in)\s+|\btarget(?:\s+currency)?\s*[:=]\s*)(USD|AZN)\b/iu
      .exec(normalized) ??
    /\b(USD|AZN)(?:-[əa])?\s+(?:çevir|convert)\b/iu.exec(normalized) ??
    /\b(USD|AZN)(?:\s+il[əe]|-l[əa]|-d[əa]|\s+olaraq|\s+cinsind[əe])(?!\p{L})/iu
      .exec(normalized) ??
    /\b(USD|AZN)\s+ekvivalent\p{L}*(?!\p{L})/iu.exec(normalized);
  const code = codeMatch?.[1]?.toLocaleUpperCase("en-US");
  if (code === "USD" || code === "AZN") return code;
  return AZN_WORD_TARGET.test(normalized) ? "AZN" : null;
}
