import { expect, test } from "@playwright/test";

import type { SupportedLocale } from "../../src/assistant-v3/contracts.js";
import {
  CHAT_PROMPTS,
  E2E_ORIGIN,
  GUIDE_DEFINITIONS
} from "./fixture-data.js";
import {
  askAssistant,
  expectFixtureIsolation,
  expectNoAxeViolations,
  expectNoExternalResponse,
  installOfflineBrowserGuard,
  openAssistant,
  resetFixture,
  selectLocale,
  type OfflineBrowserGuard
} from "./support.js";

let offlineGuard: OfflineBrowserGuard;
let pageErrors: string[];

test.beforeEach(async ({ context, page, request }) => {
  await resetFixture(request);
  offlineGuard = await installOfflineBrowserGuard(context);
  pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
});

test.afterEach(async ({ request }) => {
  expectNoExternalResponse(offlineGuard);
  expect(pageErrors, "The rendered browser flow must not raise page errors.").toEqual([]);
  await expectFixtureIsolation(request);
});

for (const locale of ["en-US", "az-AZ"] as const satisfies readonly SupportedLocale[]) {
  test(`@a11y chat responses satisfy WCAG A/AA in ${locale}`, async ({ page }) => {
    await openAssistant(page);
    await selectLocale(page, locale);
    for (const prompt of Object.values(CHAT_PROMPTS[locale])) {
      await askAssistant(page, prompt);
    }
    await expectNoAxeViolations(page, `${locale} dashboard and chat responses`);
  });
}

for (const guide of GUIDE_DEFINITIONS) {
  for (const locale of [
    "en-US",
    "az-AZ"
  ] as const satisfies readonly SupportedLocale[]) {
    test(`@a11y ${guide.key} destination satisfies WCAG A/AA in ${locale}`, async ({
      page
    }) => {
      await page.goto(guide.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#assistant-mode")).toHaveText(
        "Ready · Secure V3 session"
      );
      if (locale === "az-AZ") await selectLocale(page, locale);
      await expect(page).toHaveURL((url) =>
        url.origin === E2E_ORIGIN && url.pathname === guide.path
      );
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: guide.heading[locale]
        })
      ).toBeVisible();
      await expectNoAxeViolations(
        page,
        `${locale} ${guide.key} governed destination`
      );
    });
  }
}

test("@a11y keyboard-only chat submission restores focus to the composer", async ({
  page
}) => {
  await openAssistant(page);
  const input = page.locator("#message-input");
  await input.focus();
  await input.fill(CHAT_PROMPTS["en-US"].cash);
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/v1/assistant/messages"
  );
  await page.keyboard.press("Enter");
  expect((await response).status()).toBe(200);
  await expect(input).toBeFocused();
  await expect(
    page.locator("#messages .assistant-message:not(.typing)").last()
  ).toContainText("$3,200.00");
});
