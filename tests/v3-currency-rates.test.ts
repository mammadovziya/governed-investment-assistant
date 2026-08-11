import { describe, expect, it, vi } from "vitest";

import {
  CbarCurrencyRateProvider,
  CurrencyRateProviderError
} from "../src/assistant-v3/currency-rates.js";

const SUNDAY_IN_BAKU = Date.parse("2026-07-26T08:00:00.000Z");
const OFFICIAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ValCurs Date="24.07.2026" Name="Azərbaycan Respublikası Mərkəzi Bankının valyuta məzənnələri">
  <ValType Type="Xarici valyutalar">
    <Valute Code="USD">
      <Nominal>1</Nominal>
      <Name>1 ABŞ dolları</Name>
      <Value>1.7000</Value>
    </Valute>
  </ValType>
</ValCurs>`;

describe("official CBA currency-rate provider", () => {
  it("uses bounded holiday lookback, caches the official document, and derives both directions", async () => {
    const requested: string[] = [];
    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (!url.endsWith("/24.07.2026.xml")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(OFFICIAL_XML, {
        status: 200,
        headers: {
          "content-type": "application/xml",
          "content-length": String(Buffer.byteLength(OFFICIAL_XML))
        }
      });
    });
    const provider = new CbarCurrencyRateProvider({
      fetch: fetchStub as typeof fetch,
      now: () => SUNDAY_IN_BAKU,
      cacheMs: 60_000,
      maximumLookbackDays: 3
    });

    await expect(provider.getRate("USD", "AZN")).resolves.toEqual({
      sourceCurrency: "USD",
      targetCurrency: "AZN",
      exchangeRate: "1.70000000",
      effectiveDate: "2026-07-24",
      asOf: "2026-07-24T00:00:00+04:00",
      sourceUrl: "https://www.cbar.az/currencies/24.07.2026.xml"
    });
    await expect(provider.getRate("AZN", "USD")).resolves.toMatchObject({
      sourceCurrency: "AZN",
      targetCurrency: "USD",
      exchangeRate: "0.58823529",
      effectiveDate: "2026-07-24"
    });
    expect(requested).toEqual([
      "https://www.cbar.az/currencies/26.07.2026.xml",
      "https://www.cbar.az/currencies/25.07.2026.xml",
      "https://www.cbar.az/currencies/24.07.2026.xml"
    ]);
  });

  it("returns an exact identity rate without calling the network", async () => {
    const fetchStub = vi.fn();
    const provider = new CbarCurrencyRateProvider({
      fetch: fetchStub as typeof fetch,
      now: () => SUNDAY_IN_BAKU
    });

    await expect(provider.getRate("AZN", "AZN")).resolves.toMatchObject({
      sourceCurrency: "AZN",
      targetCurrency: "AZN",
      exchangeRate: "1.00000000"
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("fails closed when the official USD entry is malformed", async () => {
    const provider = new CbarCurrencyRateProvider({
      fetch: vi.fn(async () =>
        new Response("<ValCurs><Valute Code=\"EUR\"></Valute></ValCurs>", {
          status: 200
        })
      ) as typeof fetch,
      now: () => SUNDAY_IN_BAKU
    });

    await expect(provider.getRate("USD", "AZN")).rejects.toMatchObject({
      name: "CurrencyRateProviderError",
      code: "CURRENCY_RATE_RESPONSE_INVALID",
      retryable: false
    } satisfies Partial<CurrencyRateProviderError>);
  });

  it("fails closed when no recent official rate is published", async () => {
    const provider = new CbarCurrencyRateProvider({
      fetch: vi.fn(async () => new Response("not found", { status: 404 })) as typeof fetch,
      now: () => SUNDAY_IN_BAKU,
      maximumLookbackDays: 2
    });

    await expect(provider.getRate("USD", "AZN")).rejects.toMatchObject({
      name: "CurrencyRateProviderError",
      code: "CURRENCY_RATE_NOT_PUBLISHED",
      retryable: true
    } satisfies Partial<CurrencyRateProviderError>);
  });
});
