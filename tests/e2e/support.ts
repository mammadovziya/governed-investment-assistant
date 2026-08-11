import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";

import type { SupportedLocale } from "../../src/assistant-v3/contracts.js";
import { E2E_ORIGIN } from "./fixture-data.js";

export interface FixtureServerState {
  readonly requests: readonly {
    readonly method: string;
    readonly path: string;
  }[];
  readonly providerPortCalls: readonly string[];
  readonly outboundFetchAttempts: readonly string[];
  readonly unexpectedRuntimeCalls: readonly string[];
}

export interface OfflineBrowserGuard {
  readonly blockedRequests: string[];
  readonly externalResponses: string[];
}

export async function installOfflineBrowserGuard(
  context: BrowserContext
): Promise<OfflineBrowserGuard> {
  const guard: OfflineBrowserGuard = {
    blockedRequests: [],
    externalResponses: []
  };

  context.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== E2E_ORIGIN && !["data:", "blob:"].includes(url.protocol)) {
      guard.externalResponses.push(response.url());
    }
  });

  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === E2E_ORIGIN ||
      ["data:", "blob:"].includes(url.protocol)
    ) {
      await route.continue();
      return;
    }
    guard.blockedRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });

  return guard;
}

export function expectNoExternalResponse(guard: OfflineBrowserGuard): void {
  expect(
    guard.externalResponses,
    "The fixture-backed browser suite must never receive a non-loopback response."
  ).toEqual([]);
}

export async function resetFixture(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${E2E_ORIGIN}/__e2e__/reset`);
  expect(response.status()).toBe(204);
}

export async function fixtureState(
  request: APIRequestContext
): Promise<FixtureServerState> {
  const response = await request.get(`${E2E_ORIGIN}/__e2e__/state`);
  expect(response.status()).toBe(200);
  return await response.json() as FixtureServerState;
}

export async function expectFixtureIsolation(
  request: APIRequestContext
): Promise<FixtureServerState> {
  const state = await fixtureState(request);
  expect(state.providerPortCalls, "No market, RAG, or readiness provider port may run.").toEqual([]);
  expect(state.outboundFetchAttempts, "The fixture server must not attempt outbound fetch.").toEqual([]);
  expect(state.unexpectedRuntimeCalls, "No transaction or handoff runtime operation may run.").toEqual([]);
  return state;
}

export async function openAssistant(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#assistant-mode")).toHaveText(
    "Ready · Secure V3 session"
  );
  await expect(page.locator("#portfolio-value")).toContainText("13,250.50");
  await expect(page.locator("#message-input")).toBeEnabled();
}

export async function selectLocale(
  page: Page,
  locale: SupportedLocale
): Promise<void> {
  if (locale === "en-US") {
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    return;
  }
  await page.locator(
    "#locale-selector button[data-locale='az-AZ']"
  ).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "az");
  await expect(page.locator("#assistant-mode")).toHaveText(
    "Hazır · Təhlükəsiz V3 sessiyası"
  );
  await expect(page.locator("#message-input")).toBeEnabled();
}

export async function askAssistant(
  page: Page,
  prompt: string
): Promise<Locator> {
  const completedMessages = page.locator(
    "#messages .assistant-message:not(.typing)"
  );
  const before = await completedMessages.count();
  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.origin === E2E_ORIGIN &&
      url.pathname === "/v1/assistant/messages" &&
      candidate.request().method() === "POST"
    );
  });
  const input = page.locator("#message-input");
  await input.fill(prompt);
  await input.press("Enter");
  expect((await response).status()).toBe(200);
  await expect(completedMessages).toHaveCount(before + 1);
  await expect(input).toBeFocused();
  return completedMessages.nth(before);
}

export async function expectNoAxeViolations(
  page: Page,
  label: string
): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa"
    ])
    .analyze();
  const compact = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target)
  }));
  expect(compact, `${label} has WCAG A/AA violations.`).toEqual([]);
}
