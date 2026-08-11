import type { DecimalString, ToolSource } from "./contracts.js";
import {
  ONE_FIXED,
  decimal,
  divideFixed,
  formatFixedDecimal,
  parseFixedDecimal
} from "./fixed-decimal.js";

export type SupportedCurrencyCode = "USD" | "AZN";

export interface CurrencyRateQuote {
  readonly sourceCurrency: SupportedCurrencyCode;
  readonly targetCurrency: SupportedCurrencyCode;
  /** Target-currency units for one source-currency unit. */
  readonly exchangeRate: DecimalString;
  readonly effectiveDate: string;
  readonly asOf: string;
  readonly sourceUrl: string;
}

export interface CurrencyRatePort {
  readonly source: ToolSource;
  getRate(
    sourceCurrency: SupportedCurrencyCode,
    targetCurrency: SupportedCurrencyCode
  ): Promise<CurrencyRateQuote>;
}

export class CurrencyRateProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "CurrencyRateProviderError";
  }
}

interface CachedUsdRate {
  readonly aznPerUsd: DecimalString;
  readonly effectiveDate: string;
  readonly asOf: string;
  readonly sourceUrl: string;
  readonly expiresAt: number;
}

export interface CbarCurrencyRateProviderOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly cacheMs?: number;
  readonly maximumLookbackDays?: number;
}

const CBA_RATE_PAGE = "https://www.cbar.az/currency/rates?language=en";
const CBA_XML_ROOT = "https://www.cbar.az/currencies";
const MAX_XML_BYTES = 1_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new RangeError(`${label} must be an integer between 1 and ${String(maximum)}.`);
  }
  return resolved;
}

function bakuCalendarDate(now: number): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baku",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number.parseInt(values.year ?? "", 10);
  const month = Number.parseInt(values.month ?? "", 10);
  const day = Number.parseInt(values.day ?? "", 10);
  if (![year, month, day].every(Number.isSafeInteger)) {
    throw new CurrencyRateProviderError(
      "CURRENCY_RATE_DATE_UNAVAILABLE",
      "The official-rate calendar date could not be determined.",
      false
    );
  }
  return { year, month, day };
}

function calendarDateAtLookback(
  current: { year: number; month: number; day: number },
  lookbackDays: number
): { display: string; iso: string } {
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day) - lookbackDays * DAY_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return {
    display: `${day}.${month}.${String(year)}`,
    iso: `${String(year)}-${month}-${day}`
  };
}

function xmlElement(body: string, element: string): string | null {
  const match = new RegExp(
    `<${element}\\b[^>]*>([\\s\\S]*?)<\\/${element}>`,
    "iu"
  ).exec(body);
  return match?.[1]?.trim() ?? null;
}

function canonicalProviderDecimal(value: string, label: string): DecimalString {
  const normalized = value.trim().replace(",", ".");
  try {
    const result = decimal(normalized);
    if (parseFixedDecimal(result) <= 0n) throw new Error("non-positive");
    return result;
  } catch {
    throw new CurrencyRateProviderError(
      "CURRENCY_RATE_RESPONSE_INVALID",
      `The official rate response contained an invalid ${label}.`,
      false
    );
  }
}

function parseUsdRateXml(input: {
  xml: string;
  requestedDate: { display: string; iso: string };
  sourceUrl: string;
}): Omit<CachedUsdRate, "expiresAt"> {
  const valueBlock = /<Valute\b[^>]*\bCode=(?:"USD"|'USD')[^>]*>([\s\S]*?)<\/Valute>/iu
    .exec(input.xml)?.[1];
  if (valueBlock === undefined) {
    throw new CurrencyRateProviderError(
      "CURRENCY_RATE_RESPONSE_INVALID",
      "The official rate response did not contain a USD entry.",
      false
    );
  }
  const nominalText = xmlElement(valueBlock, "Nominal");
  const valueText = xmlElement(valueBlock, "Value");
  if (nominalText === null || valueText === null) {
    throw new CurrencyRateProviderError(
      "CURRENCY_RATE_RESPONSE_INVALID",
      "The official USD rate entry was incomplete.",
      false
    );
  }
  const nominal = canonicalProviderDecimal(nominalText, "USD nominal");
  const value = canonicalProviderDecimal(valueText, "USD value");
  const aznPerUsd = formatFixedDecimal(
    divideFixed(parseFixedDecimal(value), parseFixedDecimal(nominal))
  );
  return {
    aznPerUsd,
    effectiveDate: input.requestedDate.iso,
    asOf: `${input.requestedDate.iso}T00:00:00+04:00`,
    sourceUrl: input.sourceUrl
  };
}

/**
 * Official Central Bank of the Republic of Azerbaijan rate adapter.
 *
 * The CBA publishes one XML document per effective date. Weekend and holiday
 * requests are resolved by bounded lookback to the most recent published file.
 */
export class CbarCurrencyRateProvider implements CurrencyRatePort {
  readonly source: ToolSource = Object.freeze({
    provider: "central-bank-of-azerbaijan",
    sourceId: "official-currency-rates",
    sourceUrl: CBA_RATE_PAGE,
    licenseClass: "public-indicative",
    observedAt: "1970-01-01T00:00:00.000Z",
    sourceAsOf: "1970-01-01T00:00:00.000Z"
  });

  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #cacheMs: number;
  readonly #maximumLookbackDays: number;
  #cached: CachedUsdRate | null = null;

  constructor(options: CbarCurrencyRateProviderOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = boundedPositiveInteger(
      options.timeoutMs,
      5_000,
      30_000,
      "Currency-rate timeout"
    );
    this.#cacheMs = boundedPositiveInteger(
      options.cacheMs,
      5 * 60_000,
      DAY_MS,
      "Currency-rate cache"
    );
    this.#maximumLookbackDays = boundedPositiveInteger(
      options.maximumLookbackDays,
      10,
      31,
      "Currency-rate lookback"
    );
  }

  async #fetchUsdRate(): Promise<CachedUsdRate> {
    const now = this.#now();
    if (this.#cached !== null && this.#cached.expiresAt > now) return this.#cached;
    const current = bakuCalendarDate(now);

    for (let lookback = 0; lookback <= this.#maximumLookbackDays; lookback += 1) {
      const requestedDate = calendarDateAtLookback(current, lookback);
      const sourceUrl = `${CBA_XML_ROOT}/${requestedDate.display}.xml`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      let response: Response;
      try {
        response = await this.#fetch(sourceUrl, {
          method: "GET",
          headers: { accept: "application/xml,text/xml;q=0.9" },
          redirect: "follow",
          signal: controller.signal
        });
      } catch {
        throw new CurrencyRateProviderError(
          "CURRENCY_RATE_DEPENDENCY_UNAVAILABLE",
          "The official currency-rate service is temporarily unavailable.",
          true
        );
      } finally {
        clearTimeout(timeout);
      }
      if (response.status === 404) continue;
      if (!response.ok) {
        throw new CurrencyRateProviderError(
          "CURRENCY_RATE_DEPENDENCY_UNAVAILABLE",
          "The official currency-rate service returned an unsuccessful response.",
          response.status >= 500
        );
      }
      const declaredLength = Number.parseInt(
        response.headers.get("content-length") ?? "0",
        10
      );
      if (Number.isFinite(declaredLength) && declaredLength > MAX_XML_BYTES) {
        throw new CurrencyRateProviderError(
          "CURRENCY_RATE_RESPONSE_INVALID",
          "The official currency-rate response exceeded the allowed size.",
          false
        );
      }
      const xml = await response.text();
      if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) {
        throw new CurrencyRateProviderError(
          "CURRENCY_RATE_RESPONSE_INVALID",
          "The official currency-rate response exceeded the allowed size.",
          false
        );
      }
      const parsed = parseUsdRateXml({ xml, requestedDate, sourceUrl });
      this.#cached = Object.freeze({
        ...parsed,
        expiresAt: now + this.#cacheMs
      });
      return this.#cached;
    }

    throw new CurrencyRateProviderError(
      "CURRENCY_RATE_NOT_PUBLISHED",
      "No recent official USD/AZN rate was published within the allowed lookback window.",
      true
    );
  }

  async getRate(
    sourceCurrency: SupportedCurrencyCode,
    targetCurrency: SupportedCurrencyCode
  ): Promise<CurrencyRateQuote> {
    if (sourceCurrency === targetCurrency) {
      const now = new Date(this.#now()).toISOString();
      return Object.freeze({
        sourceCurrency,
        targetCurrency,
        exchangeRate: formatFixedDecimal(ONE_FIXED),
        effectiveDate: now.slice(0, 10),
        asOf: now,
        sourceUrl: CBA_RATE_PAGE
      });
    }
    if (
      !(
        (sourceCurrency === "USD" && targetCurrency === "AZN") ||
        (sourceCurrency === "AZN" && targetCurrency === "USD")
      )
    ) {
      throw new CurrencyRateProviderError(
        "CURRENCY_PAIR_UNSUPPORTED",
        "Only USD/AZN conversion is approved for this assistant version.",
        false
      );
    }
    const official = await this.#fetchUsdRate();
    const exchangeRate = sourceCurrency === "USD"
      ? official.aznPerUsd
      : formatFixedDecimal(
          divideFixed(ONE_FIXED, parseFixedDecimal(official.aznPerUsd))
        );
    return Object.freeze({
      sourceCurrency,
      targetCurrency,
      exchangeRate,
      effectiveDate: official.effectiveDate,
      asOf: official.asOf,
      sourceUrl: official.sourceUrl
    });
  }
}
