import { expect, test } from "@playwright/test";

import type { SupportedLocale } from "../../src/assistant-v3/contracts.js";
import {
  CHAT_PROMPTS
} from "./fixture-data.js";
import {
  askAssistant,
  expectFixtureIsolation,
  expectNoExternalResponse,
  installOfflineBrowserGuard,
  openAssistant,
  resetFixture,
  selectLocale,
  type OfflineBrowserGuard
} from "./support.js";

let offlineGuard: OfflineBrowserGuard;

test.beforeEach(async ({ context, request }) => {
  await resetFixture(request);
  offlineGuard = await installOfflineBrowserGuard(context);
});

test.afterEach(async ({ request }) => {
  expectNoExternalResponse(offlineGuard);
  await expectFixtureIsolation(request);
});

for (const locale of ["en-US", "az-AZ"] as const satisfies readonly SupportedLocale[]) {
  test(`renders grounded cash, portfolio, activity, and quote/chart flows in ${locale}`, async ({
    page,
    request
  }) => {
    await openAssistant(page);
    await selectLocale(page, locale);

    const cash = await askAssistant(page, CHAT_PROMPTS[locale].cash);
    await expect(cash).toContainText(
      locale === "az-AZ" ? "3.200,00 ABŞ dolları" : "$3,200.00"
    );
    await expect(cash.locator(".v3-response-card")).toHaveCount(0);
    await expect(cash.locator(".v3-response-actions")).toHaveCount(0);
    await expect(cash.locator("details")).toHaveCount(0);

    const portfolio = await askAssistant(
      page,
      CHAT_PROMPTS[locale].portfolio
    );
    await expect(portfolio).toContainText(
      locale === "az-AZ" ? "13.250,50 ABŞ dolları" : "$13,250.50"
    );
    await expect(portfolio).toContainText("AAPL");
    await expect(portfolio).toContainText("NVDA");
    await expect(portfolio.locator(".v3-response-card")).toHaveCount(0);

    const activity = await askAssistant(
      page,
      CHAT_PROMPTS[locale].activity
    );
    await expect(activity).toContainText(
      locale === "az-AZ" ? "İcra edilmiş alış" : "Executed purchase"
    );
    await expect(activity).toContainText(
      locale === "az-AZ"
        ? "yalnız status, icra deyil"
        : "state only, not an execution"
    );
    await expect(activity).not.toContainText(
      /activityRef|transactionId|orderRef|instrumentId|linkedTransactionIds/u
    );
    await expect(activity.locator(".v3-response-card")).toHaveCount(0);

    const quote = await askAssistant(page, CHAT_PROMPTS[locale].quote);
    await expect(quote).toContainText("AAPL");
    await expect(quote).toContainText("210");
    await expect(quote.locator(".v3-response-card")).toHaveCount(0);
    await expect(quote.locator(".market-chart-card")).toHaveCount(1);
    const textPosition = await quote.locator("p").first().evaluate((paragraph) => {
      const messages = document.querySelector("#messages");
      if (!messages) throw new Error("Missing chat message container.");
      return {
        paragraphTop: paragraph.getBoundingClientRect().top,
        messagesTop: messages.getBoundingClientRect().top
      };
    });
    expect(textPosition.paragraphTop).toBeGreaterThanOrEqual(
      textPosition.messagesTop - 1
    );
    const chart = quote.locator("canvas[role='img']");
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute(
      "aria-label",
      /AAPL 10Y closing-price chart/iu
    );

    await chart.focus();
    await chart.press("End");
    const tooltip = quote.locator(".market-chart-tooltip");
    await expect(tooltip).toBeVisible();
    const latestPoint = await tooltip.textContent();
    await chart.press("ArrowLeft");
    await expect(tooltip).not.toHaveText(latestPoint ?? "");
    await chart.press("Home");
    await expect(tooltip).toBeVisible();

    await expect(quote.locator("details")).toHaveCount(0);
    await expect(quote).toContainText(
      "AAPL deterministic browser-test market history"
    );
    await expect(quote).toContainText("https://example.invalid/e2e/aapl");

    const state = await expectFixtureIsolation(request);
    const messageRequests = state.requests.filter(
      ({ method, path }) =>
        method === "POST" && path === "/v1/assistant/messages"
    );
    expect(messageRequests).toHaveLength(4);
    expect(state.requests.some(({ path }) => path === "/api/chat")).toBe(false);
    expect(
      state.requests.some(({ path }) =>
        /execute|submit|transfer|withdrawal\/confirm/iu.test(path)
      )
    ).toBe(false);
  });
}
