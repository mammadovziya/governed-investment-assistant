import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { createV3ActivityCardView } from "../public/v3-activity.js";

import {
  createV3MessageRequest,
  createV3OrderConfirmationRequest,
  createV3OrderOpenRequest,
  createV3SessionRequest,
  normalizeV3AssistantResponse,
  readV3SessionToken,
  safeV3CitationHref,
  safeV3HandoffHref,
  safeV3InAppHref,
  safeV3ReadOnlyHref,
  v3InAppDestination,
  v3OrderPreviewConfirmationAction,
  v3ReadOnlyViewAction,
  v3PriceHistoryCharts,
} from "../public/v3-api.js";

const TOKEN = "server-issued-v3-session-token";

describe("public V3 assistant request contract", () => {
  it("initializes a server-owned session with locale only", () => {
    const request = createV3SessionRequest("az-AZ");

    expect(request).toMatchObject({
      url: "/v1/assistant/sessions",
      options: {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
    });
    expect(JSON.parse(request.options.body)).toEqual({ locale: "az-AZ" });
    expect(request.options.body).not.toMatch(/client|account|conversation|principal/iu);
  });

  it("sends messages with the server token and no client-owned identity", () => {
    const request = createV3MessageRequest(TOKEN, "  Analyze NVDA  ");

    expect(request.url).toBe("/v1/assistant/messages");
    expect(request.options.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(request.options.body)).toEqual({ message: "Analyze NVDA" });
    expect(request.options.body).not.toMatch(/clientId|accountId|conversationId|sessionId/u);
  });

  it("creates an explicit one-intent order confirmation request", () => {
    const request = createV3OrderConfirmationRequest(TOKEN, "intent/AAPL 100");

    expect(request.url).toBe(
      "/v1/assistant/order-handoffs/intent%2FAAPL%20100/confirm",
    );
    expect(request.options.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(request.options.body)).toEqual({ confirmed: true });
  });

  it("opens the exact signed handoff without putting it in a URL", () => {
    const handoff = {
      handoffRef:
        "eyJhbGciOiJIUzI1NiJ9.eyJwdXJwb3NlIjoib3JkZXItaGFuZG9mZiJ9.c2lnbmF0dXJl", // gitleaks:allow -- synthetic unsigned JWT fixture
      payload: {
        handoffId: "00000000-0000-4000-8000-000000000001",
        intentId: "00000000-0000-4000-8000-000000000002"
      },
      oneUse: true,
      destination: "/orders/preview"
    };
    const request = createV3OrderOpenRequest(TOKEN, handoff);

    expect(request.url).toBe("/v1/assistant/order-handoffs/open");
    expect(request.options.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(request.options.body)).toEqual({ handoff });
    expect(request.url).not.toContain("handoffRef");
  });

  it("accepts common server-token envelopes and rejects missing tokens", () => {
    expect(readV3SessionToken({ token: TOKEN })).toBe(TOKEN);
    expect(readV3SessionToken({ sessionToken: TOKEN })).toBe(TOKEN);
    expect(readV3SessionToken({ session: { token: TOKEN } })).toBe(TOKEN);
    expect(() => readV3SessionToken({ sessionId: "client-controlled" })).toThrow(
      /server token/iu,
    );
  });
});

describe("public typed V3 response normalization", () => {
  it("retains typed response data and selects every price-history chart range", () => {
    const kinds = [
      "market",
      "portfolio",
      "allocation",
      "performance",
      "knowledge",
      "research",
      "decision-support",
      "position-analysis",
      "fee",
      "activity",
      "order-preview",
    ] as const;
    const response = normalizeV3AssistantResponse({
      schemaVersion: "assistant-v3.response.v1",
      message: "  Here is the result.  ",
      deliveryGate: "pass",
      cards: [
        ...kinds.map((kind) => ({
          cardId: `card-${kind}`,
          kind,
          title: kind,
          factRefs: [`fact-${kind}`],
          data: kind === "order-preview" ? { intentId: "intent-1" } : { value: "1" },
        })),
        { cardId: "bad", kind: "raw-json", title: "Bad", data: {} },
      ],
      citations: [],
      charts: [
        {
          chartId: "chart-10y",
          symbol: "nvda",
          range: "10y",
          currency: "USD",
          asOf: "2026-07-22T08:00:00.000Z",
          source: "licensed-feed",
          points: [{ timestamp: "2016-07-22T00:00:00.000Z", close: "1.20" }],
        },
        {
          chartId: "chart-1y",
          symbol: "AAPL",
          range: "1y",
          currency: "USD",
          asOf: "2026-07-22T08:00:00.000Z",
          source: "licensed-feed",
          points: [],
        },
      ],
    });

    expect(response.message).toBe("Here is the result.");
    expect(response.cards.map(({ kind }) => kind)).toEqual(kinds);
    expect(response.cards.at(-1)?.data).toEqual({ intentId: "intent-1" });
    expect(v3PriceHistoryCharts(response)).toEqual([
      expect.objectContaining({ chartId: "chart-10y", symbol: "NVDA", range: "10y" }),
      expect.objectContaining({ chartId: "chart-1y", symbol: "AAPL", range: "1y" }),
    ]);
  });

  it("fails closed on non-V3 response payloads", () => {
    expect(() => normalizeV3AssistantResponse({ text: "legacy response" })).toThrow(
      /invalid V3 response/iu,
    );
  });

  it.each([
    [undefined, "blocked"],
    [null, "blocked"],
    ["", "blocked"],
    ["PASS", "blocked"],
    ["allow", "blocked"],
    ["blocked", "blocked"],
    ["pass", "pass"],
  ] as const)("normalizes delivery gate %j to %s", (deliveryGate, expected) => {
    const response = normalizeV3AssistantResponse({
      schemaVersion: "assistant-v3.response.v1",
      message: "Verified response.",
      ...(deliveryGate === undefined ? {} : { deliveryGate }),
    });

    expect(response.deliveryGate).toBe(expected);
  });

  it("allows safe citation and handoff destinations only", () => {
    expect(safeV3CitationHref("https://knowledge.demo-invest.invalid/en/fees")).toBe(
      "https://knowledge.demo-invest.invalid/en/fees",
    );
    expect(safeV3CitationHref("javascript:alert(1)")).toBeNull();
    expect(safeV3CitationHref("https://user:password@example.com/source")).toBeNull();

    expect(safeV3HandoffHref("/orders/preview", "http://localhost:3000")).toBe(
      "/orders/preview",
    );
    expect(safeV3HandoffHref("invest-assistant://orders/preview", "http://localhost:3000")).toBe(
      "invest-assistant://orders/preview",
    );
    expect(safeV3HandoffHref("https://evil.example/order", "http://localhost:3000")).toBeNull();
  });

  it("normalizes a bounded activity card without exposing ledger or order references", () => {
    const items = Array.from({ length: 12 }, (_, index) => {
      const occurredAt = new Date(Date.UTC(2026, 6, 22, 10, index)).toISOString();
      if (index === 1) {
        return {
          kind: "ORDER",
          activityRef: "order:private-order-1",
          occurredAt,
          positionEffect: "NONE_ORDER_STATE_ONLY",
          order: {
            orderRef: "private-order-1",
            instrumentId: "private-instrument-1",
            linkedTransactionIds: ["private-transaction-1"],
            symbol: "NVDA",
            side: "SELL",
            orderType: "LIMIT",
            status: "OPEN",
            submittedAt: occurredAt,
            lastUpdatedAt: occurredAt,
            requestedQuantity: "3.50000000",
            filledQuantity: "0.00000000",
            limitPrice: { amount: "225.25000000", currency: "USD" },
            averageFillPrice: null,
          },
        };
      }
      return {
        kind: "EXECUTION",
        activityRef: `execution:private-${index}`,
        occurredAt,
        positionEffect: "AUTHORITATIVE_EXECUTED_TRADE",
        transaction: {
          transactionId: `private-${index}`,
          orderRef: `private-order-${index}`,
          instrumentId: "private-instrument-2",
          feeIds: ["private-fee-1"],
          executionStatus: "EXECUTED",
          symbol: "AAPL",
          side: "BUY",
          tradedAt: occurredAt,
          quantity: "2.00000000",
          unitPrice: { amount: "210.12500000", currency: "USD" },
          grossAmount: { amount: "420.25000000", currency: "USD" },
        },
      };
    });
    const response = normalizeV3AssistantResponse({
      schemaVersion: "assistant-v3.response.v1",
      message: "Here is your latest activity.",
      cards: [{
        cardId: "recent-activity",
        kind: "activity",
        title: "Recent trading activity",
        factRefs: ["fact-activity"],
        data: {
          schemaVersion: "assistant-v3.recent-trading-activity.v1",
          dataClass: "synthetic",
          asOf: "2026-07-22T12:00:00.000Z",
          coverage: { matchedCount: 12, returnedCount: 12 },
          hasMore: true,
          items,
        },
      }],
    });

    const activityCard = response.cards[0];
    if (activityCard?.kind !== "activity") throw new Error("Expected an activity card.");
    const activity = activityCard.data;
    expect(activity.items).toHaveLength(10);
    expect(activity.items[0]).toEqual({
      kind: "execution",
      occurredAt: "2026-07-22T10:00:00.000Z",
      symbol: "AAPL",
      side: "BUY",
      quantity: "2.00000000",
      unitPrice: { amount: "210.12500000", currency: "USD" },
      total: { amount: "420.25000000", currency: "USD" },
    });
    expect(activity.items[1]).toMatchObject({
      kind: "order",
      status: "OPEN",
      orderType: "LIMIT",
      quantity: "3.50000000",
      filledQuantity: "0.00000000",
    });
    expect(activity).toMatchObject({
      asOf: "2026-07-22T12:00:00.000Z",
      hasMore: true,
      matchedCount: 12,
    });
    expect(JSON.stringify(activity)).not.toMatch(
      /activityRef|transactionId|orderRef|instrumentId|feeIds|linkedTransactionIds|positionEffect/u,
    );
  });

  it("renders the signed portfolio activity projection as executions and state-only orders", () => {
    const response = normalizeV3AssistantResponse({
      schemaVersion: "assistant-v3.response.v1",
      message: "Here is your latest activity.",
      cards: [{
        cardId: "recent-activity",
        kind: "activity",
        title: "Recent trading activity",
        factRefs: ["fact-activity"],
        data: {
          route: "recent_trading_activity",
          asOf: "2026-07-22T12:00:00.000Z",
          limit: 10,
          matchedCount: 6,
          returnedCount: 6,
          hasMore: false,
          dataClass: "synthetic",
          records: [{
            recordType: "execution",
            positionEffect: "EXECUTED_TRADE",
            occurredAt: "2026-07-22T10:00:00.000Z",
            symbol: "AAPL",
            side: "BUY",
            quantity: "2.00000000",
            unitPrice: { amount: "210.12500000", currency: "USD" },
            grossAmount: { amount: "420.25000000", currency: "USD" }
          }, {
            recordType: "order",
            positionEffect: "ORDER_STATE_ONLY",
            occurredAt: "2026-07-21T10:00:00.000Z",
            symbol: "NVDA",
            side: "SELL",
            orderType: "LIMIT",
            timeInForce: "DAY",
            status: "OPEN",
            requestedQuantity: "3.50000000",
            filledQuantity: "0.00000000",
            limitPrice: { amount: "225.25000000", currency: "USD" },
            averageFillPrice: null
          }]
        }
      }]
    });

    const card = response.cards[0];
    if (card?.kind !== "activity") throw new Error("Expected an activity card.");
    expect(card.data.items).toHaveLength(2);
    const rendered = createV3ActivityCardView(card.data, "en-US");
    expect(rendered.rows).toEqual([
      expect.objectContaining({
        title: "Buy AAPL",
        label: "Executed purchase",
        primary: "USD 420.25",
        secondary: "2 × USD 210.125"
      }),
      expect.objectContaining({
        title: "Sell NVDA",
        label: "Open order · state only, not an execution",
        primary: "USD 225.25",
        secondary: "Requested: 3.5"
      })
    ]);
    const renderedText = JSON.stringify(rendered);
    expect(renderedText).not.toContain("Returned Count");
    expect(renderedText).not.toContain("Matched Count");
    expect(renderedText).not.toContain("+6.00%");
  });

  it("accepts only exact governed target/path pairs", () => {
    const fundingAction = {
      schemaVersion: "assistant-v3.in-app-navigation-action.v1",
      actionId: "view-investment-account-funding-guide",
      kind: "open-in-app",
      target: "investments.funding.guide",
      label: "<img src=x onerror=alert(1)> View funding steps",
      href: "/investments/guides/funding",
      citationRefs: ["citation-funding"],
      catalogVersion: "demo-invest-navigation-2026-07-29.v1",
    };
    const accountOpeningAction = {
      ...fundingAction,
      actionId: "view-investment-account-opening-guide",
      target: "investments.account-opening.guide",
      label: "View account-opening steps",
      href: "/investments/guides/account-opening",
    };
    const withdrawalAction = {
      ...fundingAction,
      actionId: "view-investment-withdrawal-guide",
      target: "investments.withdrawal.guide",
      label: "View withdrawal steps",
      href: "/investments/guides/withdrawal",
    };
    const sharePurchaseAction = {
      ...fundingAction,
      actionId: "view-share-purchase-guide",
      target: "investments.share-purchase.guide",
      label: "View share-purchase steps",
      href: "/investments/guides/share-purchase",
    };
    const response = normalizeV3AssistantResponse({
      schemaVersion: "assistant-v3.response.v1",
      message: "Open funding.",
      actions: [
        fundingAction,
        accountOpeningAction,
        sharePurchaseAction,
        withdrawalAction,
        { ...fundingAction, href: "/investments/guides/funding?amount=100" },
        { ...fundingAction, href: "/investments/guides/funding#confirm" },
        { ...fundingAction, href: "/orders/preview" },
        { ...fundingAction, href: "//evil.example/investments/guides/funding" },
        { ...fundingAction, target: "investments.account-opening.guide" },
        { ...fundingAction, target: "investments.price-alerts.create" },
      ],
    });

    expect(response.actions).toEqual([
      fundingAction,
      accountOpeningAction,
      sharePurchaseAction,
      withdrawalAction
    ]);
    expect(safeV3InAppHref("/investments/guides/account-opening")).toBe(
      "/investments/guides/account-opening"
    );
    expect(safeV3InAppHref("/investments/guides/funding")).toBe(
      "/investments/guides/funding"
    );
    expect(safeV3InAppHref("/investments/guides/share-purchase")).toBe(
      "/investments/guides/share-purchase"
    );
    expect(safeV3InAppHref("/investments/guides/withdrawal")).toBe(
      "/investments/guides/withdrawal"
    );
    for (const unsafe of [
      "/investments/guides/funding/",
      "/investments/guides/funding?amount=100",
      "/investments/guides/funding#confirm",
      "/orders/preview",
      "//evil.example/investments/guides/funding",
      "https://example.com/investments/guides/funding",
      " /investments/guides/funding",
    ]) {
      expect(safeV3InAppHref(unsafe)).toBeNull();
    }
  });

  it("returns bilingual, non-executable guide content only for reviewed paths", () => {
    const accountOpening = v3InAppDestination(
      "/investments/guides/account-opening",
      "en-US"
    );
    const withdrawalAz = v3InAppDestination(
      "/investments/guides/withdrawal",
      "az-AZ"
    );
    const funding = v3InAppDestination("/investments/guides/funding", "en-US");
    const sharePurchaseAz = v3InAppDestination(
      "/investments/guides/share-purchase",
      "az-AZ"
    );

    expect(accountOpening).toMatchObject({
      locale: "en-US",
      title: "Open an investment account",
      sourceUrl:
        "https://knowledge.demo-invest.invalid/en/account-opening"
    });
    expect(accountOpening?.steps).toHaveLength(5);
    expect(accountOpening?.notice).toMatch(/guidance only/iu);
    expect(withdrawalAz).toMatchObject({
      locale: "az-AZ",
      title: "Məxaric prosesini nəzərdən keçirin",
      sourceUrl: "https://knowledge.demo-invest.invalid/az/withdrawals"
    });
    expect(withdrawalAz?.notice).toMatch(/başlada|təsdiqləyə/iu);
    expect(funding?.notice).toMatch(/does not initiate a transfer/iu);
    expect(sharePurchaseAz).toMatchObject({
      locale: "az-AZ",
      title: "Səhm alışı addımlarını nəzərdən keçirin",
      sourceUrl:
        "https://knowledge.demo-invest.invalid/az/order-preview"
    });
    expect(sharePurchaseAz?.notice).toMatch(/yarada|göndərə|təsdiqləyə|icra/iu);
    expect(Object.isFrozen(accountOpening)).toBe(true);
    expect(Object.isFrozen(accountOpening?.steps)).toBe(true);

    expect(v3InAppDestination("/orders/preview", "en-US")).toBeNull();
    expect(v3InAppDestination("/investments/price-alerts/create", "en-US")).toBeNull();
    expect(v3InAppDestination("//evil.example", "en-US")).toBeNull();
  });

  it("keeps only delivery-approved read-only actions bound to one compatible card", () => {
    const action = {
      schemaVersion: "assistant-v3.read-only-navigation-action.v1",
      actionId: "view-portfolio-cash",
      kind: "open-read-only-view",
      target: "investments.portfolio.cash",
      label: "View cash details",
      href: "/investments/portfolio/cash",
      factRefs: ["fact-cash-1"],
      catalogVersion: "governed-investment-read-only-navigation-2026-07-29.v1"
    };
    const payload = {
      schemaVersion: "assistant-v3.response.v1",
      message: "You currently have $100 in cash.",
      deliveryGate: "pass",
      cards: [{
        cardId: "card-cash",
        kind: "portfolio",
        title: "Cash balance",
        factRefs: ["fact-cash-1"],
        data: { cashValue: "100.00000000", currency: "USD" }
      }],
      actions: [
        action,
        { ...action, label: "Buy now" },
        { ...action, href: "/investments/portfolio/cash?account=1" },
        { ...action, target: "investments.portfolio.overview" },
        { ...action, factRefs: ["fact-cash-1", "fact-cash-2"] },
        { ...action, catalogVersion: "tampered-v9" }
      ]
    };
    const response = normalizeV3AssistantResponse(payload);

    expect(response.actions).toEqual([action]);
    expect(v3ReadOnlyViewAction(response, response.actions[0])).toEqual(action);
    expect(safeV3ReadOnlyHref("/investments/portfolio/cash")).toBe(
      "/investments/portfolio/cash"
    );
    for (const unsafe of [
      "/investments/portfolio/cash/",
      "/investments/portfolio/cash?account=1",
      "/investments/portfolio/cash#details",
      "/investments/%70ortfolio/cash",
      "/investments/../portfolio/cash",
      "//evil.example/investments/portfolio/cash",
      "https://evil.example/investments/portfolio/cash",
      "/orders/preview"
    ]) {
      expect(safeV3ReadOnlyHref(unsafe)).toBeNull();
    }

    const blocked = normalizeV3AssistantResponse({
      ...payload,
      deliveryGate: "blocked",
      actions: [action]
    });
    expect(blocked.actions).toEqual([]);
    expect(v3ReadOnlyViewAction({
      ...response,
      cards: [{ ...response.cards[0]!, factRefs: ["another-fact"] }]
    }, action)).toBeNull();
  });

  it("unlocks an order-preview confirmation only from one action bound to the card", () => {
    const intentId = "00000000-0000-4000-8000-000000000321";
    const expiresAt = "2026-07-22T12:05:00.000Z";
    const action = {
      actionId: `confirm-${intentId}`,
      kind: "open-signed-order-ticket",
      label: "Open buy ticket",
      href: null,
      expiresAt,
      intentId,
    };
    const response = normalizeV3AssistantResponse({
      schemaVersion: "assistant-v3.response.v1",
      message: "Review the preview.",
      cards: [{
        cardId: `card-order-preview-${intentId}`,
        kind: "order-preview",
        title: "Buy ticket preview",
        factRefs: ["fact-preview"],
        data: {
          intentId,
          expiresAt,
          confirmationLabel: action.label,
        },
      }],
      actions: [action],
    });
    const card = response.cards[0];
    const beforeExpiry = Date.parse("2026-07-22T12:00:00.000Z");

    expect(v3OrderPreviewConfirmationAction(card, response.actions, beforeExpiry)).toEqual(action);
    expect(v3OrderPreviewConfirmationAction(card, [], beforeExpiry)).toBeNull();
    expect(v3OrderPreviewConfirmationAction(card, [action, action], beforeExpiry)).toBeNull();
    expect(v3OrderPreviewConfirmationAction(card, [{
      ...action,
      intentId: "00000000-0000-4000-8000-000000000999",
    }], beforeExpiry)).toBeNull();
    expect(v3OrderPreviewConfirmationAction(card, [{
      ...action,
      label: "Buy now",
    }], beforeExpiry)).toBeNull();
    expect(v3OrderPreviewConfirmationAction(card, [action], Date.parse(expiresAt))).toBeNull();

    const withoutFactBinding = card ? { ...card, factRefs: [] } : null;
    expect(v3OrderPreviewConfirmationAction(
      withoutFactBinding,
      [action],
      beforeExpiry,
    )).toBeNull();
  });
});

describe("public V3 application wiring", () => {
  it("contains no legacy chat identity payload and retains accessible status controls", async () => {
    const appPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
    const indexPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
    const [app, index] = await Promise.all([
      readFile(appPath, "utf8"),
      readFile(indexPath, "utf8"),
    ]);

    expect(app).not.toContain("/api/chat");
    expect(app).not.toMatch(/clientId|accountId|state\.conversationId/u);
    expect(app).toContain("createV3MessageRequest");
    expect(app).toContain("createV3OrderConfirmationRequest");
    expect(app).toContain("v3OrderPreviewConfirmationAction(cardData, actions)");
    expect(app).toContain("confirmationAction.intentId");
    expect(app).not.toContain('typeof data.intentId === "string"');
    expect(app).toContain('status.setAttribute("aria-live", "polite")');
    expect(app).toContain('if (cardData.kind === "activity")');
    expect(app).toContain("createV3ActivityCardView(data, state.locale)");
    expect(app).toContain("function attachV3Actions");
    expect(app).toContain('createElement("a", "v3-order-link v3-in-app-action", action.label)');
    expect(app).toContain('navigation.setAttribute("aria-label", "Assistant actions")');
    expect(app).toContain("attachV3PriceHistoryCharts(element, response)");
    expect(app).not.toContain("attachV3Cards(element, response)");
    expect(app).not.toContain("attachV3Citations(element, response)");
    expect(app).not.toContain("attachV3Actions(element, response)");
    expect(app).not.toContain("attachNotices(element, response)");
    expect(app).toContain("function renderGovernedInAppDestination");
    expect(app).toContain('back.href = "/"');
    expect(app).toContain('destination.setAttribute("aria-labelledby", "in-app-destination-title")');
    expect(index).toContain('id="messages"');
    expect(index).toContain('role="log"');
    expect(index).toContain('aria-live="polite"');
    expect(index).toContain('enterkeyhint="send"');
  });

  it("binds an accessible persisted EN/AZ locale to new V3 sessions", async () => {
    const appPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
    const indexPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
    const [app, index] = await Promise.all([
      readFile(appPath, "utf8"),
      readFile(indexPath, "utf8"),
    ]);

    expect(index).toContain('id="locale-selector"');
    expect(index).toContain('role="group"');
    expect(index).toContain('data-locale="en-US"');
    expect(index).toContain('data-locale="az-AZ"');
    expect(index).toContain('aria-pressed="true"');
    expect(index).toContain('data-suggestion-index="0"');
    expect(app).toContain('const LOCALE_STORAGE_KEY = "invest-assistant-v3.locale"');
    expect(app).toContain('new Set(["en-US", "az-AZ"])');
    expect(app).toContain("createV3SessionRequest(state.locale)");
    expect(app).toContain("document.documentElement.lang = state.locale");
    expect(app).toContain("state.sessionToken = null");
    expect(app).toContain("resetConversationForLocale()");
    expect(app).toContain("Portfelimin cari dəyəri nə qədərdir?");
  });

  it("localizes order review without persisting its one-use handoff", async () => {
    const htmlPath = fileURLToPath(new URL("../public/order-preview.html", import.meta.url));
    const scriptPath = fileURLToPath(new URL("../public/order-preview.js", import.meta.url));
    const [html, script] = await Promise.all([
      readFile(htmlPath, "utf8"),
      readFile(scriptPath, "utf8"),
    ]);

    expect(html).toContain('id="order-locale-selector"');
    expect(html).toContain('data-order-i18n="warning"');
    expect(script).toContain('const LOCALE_STORAGE_KEY = "invest-assistant-v3.locale"');
    expect(script).toContain("Date.parse(value.expiresAt) > Date.now()");
    expect(script).toContain("sessionStorage.getItem(STORAGE_KEY)");
    expect(script).toContain("sessionStorage.removeItem(STORAGE_KEY)");
    expect(script).not.toContain("localStorage?.setItem(STORAGE_KEY");
    expect(script).toContain("Etibarlı birdəfəlik sifariş keçidi yoxdur.");
  });

  it("consumes and rejects an expired order-review handoff before rendering", async () => {
    const scriptPath = fileURLToPath(new URL("../public/order-preview.js", import.meta.url));
    const script = await readFile(scriptPath, "utf8");
    const expiredState = {
      schemaVersion: "assistant-v3.order-screen-state.v1",
      status: "external-order-screen-not-integrated",
      destination: "/orders/preview",
      oneUseHandoffConsumed: true,
      submissionAllowed: false,
      side: "BUY",
      symbol: "AAPL",
      requestedNotional: "100.00000000",
      currency: "USD",
      expiresAt: "2000-01-01T00:00:00.000Z",
      requiredRechecks: [
        "live-price",
        "fees",
        "available-balance",
        "disclosures",
        "eligibility",
        "final-confirmation",
      ],
    };
    const status = { textContent: "" };
    const content = { hidden: false };
    const selector = {
      setAttribute() {},
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
    };
    let removedKey: string | null = null;

    runInNewContext(script, {
      document: {
        documentElement: { lang: "en" },
        title: "",
        querySelectorAll() {
          return [];
        },
        getElementById(id: string) {
          if (id === "order-review-status") return status;
          if (id === "order-review-content") return content;
          if (id === "order-locale-selector") return selector;
          return {};
        },
      },
      localStorage: {
        getItem() {
          return "en-US";
        },
        setItem() {},
      },
      sessionStorage: {
        getItem(key: string) {
          return key === "invest-assistant-v3.order-screen-state"
            ? JSON.stringify(expiredState)
            : null;
        },
        removeItem(key: string) {
          removedKey = key;
        },
      },
    });

    expect(removedKey).toBe("invest-assistant-v3.order-screen-state");
    expect(content.hidden).toBe(true);
    expect(status.textContent).toContain("No valid one-use order handoff");
  });
});
