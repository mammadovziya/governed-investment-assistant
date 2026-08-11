export type V3SemanticAssetClass = "ETF" | null;

export interface V3SemanticDuration {
  readonly months: number;
  readonly excluded: boolean;
  readonly sourceText: string;
}

/**
 * A small, compositional intent frame shared by the customer router and the
 * private Studio dispatch layer. It contains no answer text and never invents
 * an instrument: ticker extraction remains a separate deterministic boundary.
 */
export interface V3SemanticFrame {
  readonly normalized: string;
  readonly folded: string;
  readonly causalQuestion: boolean;
  readonly priceMovement: boolean;
  readonly comparisonRelation: boolean;
  readonly selectionQuestion: boolean;
  readonly assetClass: V3SemanticAssetClass;
  readonly durations: readonly V3SemanticDuration[];
  readonly includedHorizonMonths: readonly number[];
  readonly excludedHorizonMonths: readonly number[];
  readonly marketMoveExplanation: boolean;
  readonly securityComparison: boolean;
  readonly investmentSelection: boolean;
}

function normalizeSemanticText(message: string): string {
  return message
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function foldAzerbaijani(value: string): string {
  return value
    .replaceAll("ə", "e")
    .replaceAll("ğ", "g")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ş", "s")
    .replaceAll("ü", "u")
    .replaceAll("ç", "c")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

function uniqueSorted(values: readonly number[]): readonly number[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left - right));
}

function durationUnitMonths(unit: string): number | null {
  const folded = foldAzerbaijani(unit);
  if (/^(?:m|mo|mos|month|months|ay|ayliq)$/u.test(folded)) return 1;
  if (/^(?:y|yr|yrs|year|years|il|illik)$/u.test(folded)) return 12;
  return null;
}

interface RawDuration {
  readonly start: number;
  readonly end: number;
  readonly months: number;
  readonly sourceText: string;
}

function semanticDurations(normalized: string): readonly V3SemanticDuration[] {
  const raw: RawDuration[] = [];
  const durationPattern =
    /(?<![\p{L}\p{N}])(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:-\s*)?(m|mo|mos|months?|y|yr|yrs|years?|ay(?:lıq|liq)?|il(?:lik)?)(?!\p{L})/giu;
  const wordAmounts: Readonly<Record<string, number>> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };
  for (const match of normalized.matchAll(durationPattern)) {
    const amountText = match[1];
    const unitText = match[2];
    const sourceText = match[0];
    const start = match.index;
    if (
      amountText === undefined ||
      unitText === undefined ||
      sourceText === undefined ||
      start === undefined
    ) {
      continue;
    }
    const amount = /^\d+$/u.test(amountText)
      ? Number.parseInt(amountText, 10)
      : wordAmounts[amountText.toLocaleLowerCase("en-US")] ?? Number.NaN;
    const unitMonths = durationUnitMonths(unitText);
    if (
      unitMonths === null ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 100
    ) {
      continue;
    }
    raw.push({
      start,
      end: start + sourceText.length,
      months: amount * unitMonths,
      sourceText
    });
  }

  return Object.freeze(raw.map((duration, index) => {
    const previousEnd = raw[index - 1]?.end ?? Math.max(0, duration.start - 24);
    const nextStart = raw[index + 1]?.start ?? Math.min(
      normalized.length,
      duration.end + 24
    );
    const before = foldAzerbaijani(
      normalized.slice(previousEnd, duration.start)
    );
    const after = foldAzerbaijani(
      normalized.slice(duration.end, nextStart)
    );
    const excluded =
      /(?:^|[\s,;:(])(?:not|yox|deyil|instead\s+of|rather\s+than)\s+(?:(?:a|an|the)\s+)?$/u
        .test(before) ||
      /^\s*(?:plan\p{L}*\s+)?(?:yox|deyil|not)\b/u.test(after);
    return Object.freeze({
      months: duration.months,
      excluded,
      sourceText: duration.sourceText
    });
  }));
}

export function analyzeV3SemanticFrame(message: string): V3SemanticFrame {
  const normalized = normalizeSemanticText(message);
  const folded = foldAzerbaijani(normalized);
  const causalQuestion =
    /(?<!\p{L})(?:why|explain\p{L}*|what\s+(?:is|was)\s+the\s+(?:reason|cause)|reason|cause|niye|ne\s+ucun|neye\s+gore|sebeb\p{L}*)(?!\p{L})/iu
      .test(folded);
  const priceMovement =
    /(?<!\p{L})(?:price|stock|share|market|qiymet\p{L}*|sehm\p{L}*|kotirovka\p{L}*)(?!\p{L})/iu
      .test(folded) &&
      /(?<!\p{L})(?:down|drop\p{L}*|fall\p{L}*|fell|declin\p{L}*|slid\p{L}*|lower|sell[\s-]*off|up|rise|rose|rall\p{L}*|gain\p{L}*|dus\p{L}*|asagi|azal\p{L}*|enib|geril\p{L}*|qalx\p{L}*|yuxari|art\p{L}*)(?!\p{L})/iu
        .test(folded) ||
    /(?<!\p{L})(?:down|drop\p{L}*|fall\p{L}*|fell|declin\p{L}*|slid\p{L}*|lower|up|rise|rose|rall\p{L}*|dus\p{L}*|asagi|azal\p{L}*|enib|geril\p{L}*|qalx\p{L}*|yuxari|art\p{L}*)(?!\p{L})/iu
      .test(folded);
  const comparisonRelation =
    /(?<!\p{L})(?:compare\p{L}*|comparison|versus|vs|difference|different|differ\p{L}*|muqayise\p{L}*|ferq\p{L}*)(?!\p{L})/iu
      .test(folded) ||
    /(?<!\p{L})(?:ile|ve)\b[\s\S]{0,48}\barasinda\b/iu.test(folded);
  const assetClass: V3SemanticAssetClass =
    /(?<![\p{L}\p{N}_])etfs?(?![\p{L}\p{N}_])/iu.test(folded)
      ? "ETF"
      : null;
  const selectionQuestion =
    /(?<!\p{L})(?:which|suitable|suit\p{L}*|fit|appropriate|best|choose|select\p{L}*|hansi|uygun\p{L}*|sec\p{L}*)(?!\p{L})/iu
      .test(folded);
  const durations = semanticDurations(normalized);
  const includedHorizonMonths = uniqueSorted(
    durations.filter(({ excluded }) => !excluded).map(({ months }) => months)
  );
  const excludedHorizonMonths = uniqueSorted(
    durations.filter(({ excluded }) => excluded).map(({ months }) => months)
  );

  return Object.freeze({
    normalized,
    folded,
    causalQuestion,
    priceMovement,
    comparisonRelation,
    selectionQuestion,
    assetClass,
    durations,
    includedHorizonMonths,
    excludedHorizonMonths,
    marketMoveExplanation: causalQuestion && priceMovement,
    securityComparison: comparisonRelation,
    investmentSelection: assetClass !== null && selectionQuestion
  });
}
