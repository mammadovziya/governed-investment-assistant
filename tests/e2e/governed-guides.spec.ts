import { expect, test } from "@playwright/test";

import type { SupportedLocale } from "../../src/assistant-v3/contracts.js";
import {
  E2E_ORIGIN,
  GUIDE_DEFINITIONS
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

for (const guide of GUIDE_DEFINITIONS) {
  for (const locale of [
    "en-US",
    "az-AZ"
  ] as const satisfies readonly SupportedLocale[]) {
    test(`${guide.key} guidance renders as exact governed ${locale} chat text`, async ({
      page,
      request
    }) => {
      await openAssistant(page);
      await selectLocale(page, locale);

      const answer = await askAssistant(page, guide.prompt[locale]);
      await expect(answer.locator(".v3-response-actions")).toHaveCount(0);
      await expect(answer.locator(".v3-response-card")).toHaveCount(0);
      await expect(answer.locator("details")).toHaveCount(0);
      await expect(answer).toContainText(guide.heading[locale]);
      await expect(answer).toContainText(guide.noticePattern[locale]);
      await expect(answer).toContainText(guide.source[locale].url);
      expect(await answer.locator("p").first().innerText()).toMatch(/\n1\. /u);
      await expect(page).toHaveURL((url) =>
        url.origin === E2E_ORIGIN &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === ""
      );

      const state = await expectFixtureIsolation(request);
      const postedPaths = state.requests
        .filter(({ method }) => method === "POST")
        .map(({ path }) => path);
      expect(postedPaths.every((path) =>
        path === "/v1/assistant/sessions" ||
        path === "/v1/assistant/messages"
      )).toBe(true);
      expect(
        state.requests.some(({ path }) =>
          /execute|submit|transfer|orders?|payments?/iu.test(path)
        )
      ).toBe(false);
    });
  }
}

test("rejects near-match, parameterized, and unknown guide destinations", async ({
  request
}) => {
  const unsafePaths = [
    "/investments/guides/account-opening/",
    "/investments/guides/account-opening?next=%2Forders",
    "/investments/guides/funding/",
    "/investments/guides/funding?amount=100",
    "/investments/guides/share-purchase/",
    "/investments/guides/share-purchase?symbol=AAPL",
    "/investments/guides/withdrawal/",
    "/investments/guides/withdrawal?amount=100",
    "/investments/guides/unknown"
  ];
  for (const path of unsafePaths) {
    const response = await request.get(`${E2E_ORIGIN}${path}`);
    expect(response.status(), path).toBe(404);
  }
});
