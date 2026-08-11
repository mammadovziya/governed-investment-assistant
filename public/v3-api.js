const CARD_KINDS = new Set([
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
  "order-preview"
]);

const CHART_RANGES = new Set(["1d", "1w", "1m", "6m", "1y", "5y", "10y", "max"]);
const LEGACY_ACTION_KINDS = new Set([
  "clarify",
  "open-signed-order-ticket",
  "open-official-source"
]);
const IN_APP_ACTIONS = Object.freeze({
  "investments.account-opening.guide": "/investments/guides/account-opening",
  "investments.funding.guide": "/investments/guides/funding",
  "investments.share-purchase.guide": "/investments/guides/share-purchase",
  "investments.withdrawal.guide": "/investments/guides/withdrawal"
});
const IN_APP_PATHS = new Set(Object.values(IN_APP_ACTIONS));
const READ_ONLY_NAVIGATION_CATALOG_VERSION =
  "governed-investment-read-only-navigation-2026-07-29.v1";
const READ_ONLY_ACTIONS = Object.freeze({
  "investments.portfolio.overview": Object.freeze({
    actionId: "view-portfolio-overview",
    href: "/investments/portfolio",
    cardKind: "portfolio",
    labels: Object.freeze(["View portfolio overview", "Portfel icmalına bax"])
  }),
  "investments.portfolio.cash": Object.freeze({
    actionId: "view-portfolio-cash",
    href: "/investments/portfolio/cash",
    cardKind: "portfolio",
    labels: Object.freeze(["View cash details", "Nağd vəsait məlumatına bax"])
  }),
  "investments.portfolio.activity": Object.freeze({
    actionId: "view-recent-activity",
    href: "/investments/activity",
    cardKind: "activity",
    labels: Object.freeze(["View recent activity", "Son əməliyyatlara bax"])
  }),
  "investments.instrument.overview": Object.freeze({
    actionId: "view-instrument-overview",
    href: "/investments/instruments",
    cardKind: "market",
    labels: Object.freeze(["View instrument overview", "Alət icmalına bax"])
  })
});
const READ_ONLY_PATHS = new Set(
  Object.values(READ_ONLY_ACTIONS).map(({ href }) => href)
);
const IN_APP_DESTINATIONS = Object.freeze({
  "/investments/guides/account-opening": Object.freeze({
    sourceUrl: "https://knowledge.demo-invest.invalid/en/account-opening",
    sourceUrlAz: "https://knowledge.demo-invest.invalid/az/account-opening",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    "en-US": Object.freeze({
      eyebrow: "Guided help · no account action started",
      title: "Open an investment account",
      summary:
        "Follow this fictional Demo Invest flow to inspect the integration boundary. The assistant cannot register, identify, or sign for you.",
      steps: Object.freeze([
        "Open the fictional Demo Invest account area.",
        "Review the synthetic identity and eligibility checklist.",
        "Read the sample account documents before continuing.",
        "Inspect the mock confirmation screen; it cannot sign or submit anything.",
        "Verify the demo status without creating or funding a real account."
      ]),
      sourceLabel: "Open the synthetic account-opening reference",
      notice:
        "This project-authored page is demonstration guidance only. No real registration, signing, or funding is available."
    }),
    "az-AZ": Object.freeze({
      eyebrow: "Addım-addım kömək · hesab əməliyyatı başladılmayıb",
      title: "İnvestisiya hesabını açın",
      summary:
        "İnteqrasiya sərhədini yoxlamaq üçün bu uydurma Demo Invest prosesinə baxın. Köməkçi sizin adınızdan qeydiyyat, identifikasiya və ya imza əməliyyatı etmir.",
      steps: Object.freeze([
        "Uydurma Demo Invest hesab bölməsini açın.",
        "Sintetik identifikasiya və uyğunluq siyahısını nəzərdən keçirin.",
        "Davam etməzdən əvvəl nümunə hesab sənədlərini oxuyun.",
        "Maketi yoxlayın; o, heç nə imzalamır və göndərmir.",
        "Real hesab yaratmadan və maliyyələşdirmədən demo statusunu yoxlayın."
      ]),
      sourceLabel: "Sintetik hesab açılışı mənbəyini aç",
      notice:
        "Layihə tərəfindən yazılmış bu səhifə yalnız təlimat və nümayiş üçündür. Real qeydiyyat, imzalama və mədaxil mümkün deyil."
    })
  }),
  "/investments/guides/funding": Object.freeze({
    sourceUrl: "https://knowledge.demo-invest.invalid/en/funding",
    sourceUrlAz: "https://knowledge.demo-invest.invalid/az/funding",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    "en-US": Object.freeze({
      eyebrow: "Guided help · no transfer started",
      title: "Review investment-account funding",
      summary:
        "Use this fictional checklist to inspect a funding integration. The assistant cannot collect payment details or move money.",
      steps: Object.freeze([
        "Open the fictional Demo Invest funding area.",
        "Choose a synthetic cash source from the demo fixtures.",
        "Enter a demonstration amount without real payment information.",
        "Review the non-executable preview and any simulated currency details.",
        "Confirm that the demo balance and every external transfer remain unchanged."
      ]),
      sourceLabel: "Open the synthetic funding reference",
      notice:
        "This page does not initiate a transfer, collect payment details, or represent a real broker."
    }),
    "az-AZ": Object.freeze({
      eyebrow: "Addım-addım kömək · köçürmə başladılmayıb",
      title: "İnvestisiya hesabına mədaxil addımları",
      summary:
        "Mədaxil inteqrasiyasını yoxlamaq üçün bu uydurma siyahıdan istifadə edin. Köməkçi ödəniş məlumatı toplamır və pul köçürmür.",
      steps: Object.freeze([
        "Uydurma Demo Invest mədaxil bölməsini açın.",
        "Demo məlumatlarından sintetik pul mənbəyi seçin.",
        "Real ödəniş məlumatı daxil etmədən nümunə məbləğ yazın.",
        "İcra olunmayan ilkin baxışı və simulyasiya edilmiş valyuta məlumatını yoxlayın.",
        "Demo balansının və bütün xarici köçürmələrin dəyişmədiyini təsdiqləyin."
      ]),
      sourceLabel: "Sintetik mədaxil mənbəyini aç",
      notice:
        "Bu səhifə köçürmə başlatmır, ödəniş məlumatı toplamır və real brokeri təmsil etmir."
    })
  }),
  "/investments/guides/share-purchase": Object.freeze({
    sourceUrl: "https://knowledge.demo-invest.invalid/en/order-preview",
    sourceUrlAz: "https://knowledge.demo-invest.invalid/az/order-preview",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    "en-US": Object.freeze({
      eyebrow: "Guided help · no order started",
      title: "Review the share-purchase steps",
      summary:
        "Use this fictional read-only checklist to inspect an order integration. The assistant cannot place or confirm an order.",
      steps: Object.freeze([
        "Review the synthetic cash balance in the demo portfolio.",
        "Search for an instrument and inspect its synthetic or explicitly licensed evidence.",
        "Enter a demonstration quantity or notional amount.",
        "Inspect the read-only preview and all required external rechecks.",
        "Close the preview without creating, confirming, or executing an order."
      ]),
      sourceLabel: "Open the synthetic order-preview reference",
      notice:
        "This page is guidance only. It cannot create, submit, confirm, or execute an order."
    }),
    "az-AZ": Object.freeze({
      eyebrow: "Addım-addım kömək · sifariş başladılmayıb",
      title: "Səhm alışı addımlarını nəzərdən keçirin",
      summary:
        "Sifariş inteqrasiyasını yoxlamaq üçün bu uydurma yalnız oxuma siyahısından istifadə edin. Köməkçi sifariş yerləşdirə və ya təsdiqləyə bilməz.",
      steps: Object.freeze([
        "Demo portfeldəki sintetik pul balansını yoxlayın.",
        "Aləti axtarın və onun sintetik və ya açıq şəkildə lisenziyalaşdırılmış sübutlarını nəzərdən keçirin.",
        "Nümunə səhm sayı və ya investisiya məbləği daxil edin.",
        "Yalnız oxuma ilkin baxışını və tələb olunan xarici yoxlamaları nəzərdən keçirin.",
        "Sifariş yaratmadan, təsdiqləmədən və icra etmədən ilkin baxışı bağlayın."
      ]),
      sourceLabel: "Sintetik sifariş ilkin baxış mənbəyini aç",
      notice:
        "Bu səhifə yalnız təlimat üçündür. Sifariş yarada, göndərə, təsdiqləyə və ya icra edə bilməz."
    })
  }),
  "/investments/guides/withdrawal": Object.freeze({
    sourceUrl: "https://knowledge.demo-invest.invalid/en/withdrawals",
    sourceUrlAz: "https://knowledge.demo-invest.invalid/az/withdrawals",
    sourceAsOf: "2026-07-21T00:00:00.000Z",
    "en-US": Object.freeze({
      eyebrow: "Guided help · no withdrawal started",
      title: "Review the withdrawal flow",
      summary:
        "Use this fictional flow to inspect the withdrawal boundary. The assistant cannot move or withdraw money.",
      steps: Object.freeze([
        "Open the fictional Demo Invest withdrawal area.",
        "Review the synthetic available balance and simulated settlement status.",
        "Enter a demonstration amount without a real destination account.",
        "Inspect the disabled confirmation state and required external checks."
      ]),
      sourceLabel: "Open the synthetic withdrawal reference",
      notice:
        "This page is informational and cannot initiate or authorize a withdrawal."
    }),
    "az-AZ": Object.freeze({
      eyebrow: "Addım-addım kömək · məxaric başladılmayıb",
      title: "Məxaric prosesini nəzərdən keçirin",
      summary:
        "Məxaric sərhədini yoxlamaq üçün bu uydurma prosesdən istifadə edin. Köməkçi pul köçürmür və çıxarmır.",
      steps: Object.freeze([
        "Uydurma Demo Invest məxaric bölməsini açın.",
        "Sintetik əlçatan balansı və simulyasiya edilmiş hesablaşma vəziyyətini yoxlayın.",
        "Real təyinat hesabı olmadan nümunə məbləğ daxil edin.",
        "Deaktiv təsdiq vəziyyətini və tələb olunan xarici yoxlamaları nəzərdən keçirin."
      ]),
      sourceLabel: "Sintetik məxaric mənbəyini aç",
      notice:
        "Bu səhifə məlumat xarakterlidir və məxaric başlada və ya təsdiqləyə bilməz."
    })
  })
});
const DECIMAL_STRING = /^-?(?:0|[1-9]\d{0,29})(?:\.\d{1,8})?$/u;
const SAFE_SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,14}$/u;
const ORDER_INTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function jsonHeaders(token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{16,4096}$/u.test(value);
}

export function createV3SessionRequest(locale) {
  if (locale !== "en-US" && locale !== "az-AZ") {
    throw new TypeError("V3 assistant locale must be en-US or az-AZ.");
  }
  return {
    url: "/v1/assistant/sessions",
    options: {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ locale })
    }
  };
}

export function readV3SessionToken(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("The assistant session response is invalid.");
  }
  const candidates = [
    payload.sessionToken,
    payload.token,
    payload.accessToken,
    payload.session && typeof payload.session === "object" ? payload.session.token : null
  ];
  const token = candidates.find(validToken);
  if (!token) throw new TypeError("The assistant session did not return a server token.");
  return token;
}

export function createV3MessageRequest(token, message) {
  if (!validToken(token)) throw new TypeError("A valid server session token is required.");
  const normalized = typeof message === "string" ? message.normalize("NFKC").trim() : "";
  if (!normalized || normalized.length > 2_000) {
    throw new TypeError("Assistant messages must contain 1-2,000 characters.");
  }
  return {
    url: "/v1/assistant/messages",
    options: {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ message: normalized })
    }
  };
}

export function createV3OrderConfirmationRequest(token, intentId) {
  if (!validToken(token)) throw new TypeError("A valid server session token is required.");
  const normalized = typeof intentId === "string" ? intentId.trim() : "";
  if (!normalized || normalized.length > 160) {
    throw new TypeError("A valid order-preview intent ID is required.");
  }
  return {
    url: `/v1/assistant/order-handoffs/${encodeURIComponent(normalized)}/confirm`,
    options: {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ confirmed: true })
    }
  };
}

export function createV3OrderOpenRequest(token, handoff) {
  if (!validToken(token)) throw new TypeError("A valid server session token is required.");
  const value = asObject(handoff);
  const payload = asObject(value.payload);
  if (
    typeof value.handoffRef !== "string" ||
    value.handoffRef.length < 32 ||
    value.handoffRef.length > 8_192 ||
    value.oneUse !== true ||
    value.destination !== "/orders/preview" ||
    typeof payload.handoffId !== "string" ||
    typeof payload.intentId !== "string"
  ) {
    throw new TypeError("A valid signed order handoff is required.");
  }
  return {
    url: "/v1/assistant/order-handoffs/open",
    options: {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ handoff: value })
    }
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function decimalString(value) {
  return typeof value === "string" && DECIMAL_STRING.test(value) ? value : null;
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString() === value ? value : null;
}

function currencyCode(value) {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value) ? value : null;
}

function normalizeMoney(value) {
  const money = asObject(value);
  const amount = decimalString(money.amount);
  const currency = currencyCode(money.currency);
  return amount !== null && currency !== null ? { amount, currency } : null;
}

function normalizeActivityItem(item) {
  const value = asObject(item);
  const recordType = value.recordType === "execution" || value.recordType === "order"
    ? value.recordType
    : null;
  const kind = recordType === "execution"
    ? "EXECUTION"
    : recordType === "order"
      ? "ORDER"
      : String(value.kind || "").toUpperCase();
  if (
    (recordType === "execution" && value.positionEffect !== "EXECUTED_TRADE") ||
    (recordType === "order" && value.positionEffect !== "ORDER_STATE_ONLY")
  ) {
    return null;
  }
  const details = recordType === null
    ? asObject(kind === "EXECUTION" ? value.transaction : value.order)
    : value;
  const source = Object.keys(details).length ? details : value;
  const symbol = normalizedText(source.symbol, 15)?.toUpperCase() || null;
  const side = source.side === "BUY" || source.side === "SELL" ? source.side : null;
  const quantity = decimalString(
    kind === "EXECUTION" ? source.quantity : source.requestedQuantity ?? source.quantity
  );
  const occurredAt = canonicalTimestamp(
    value.occurredAt ||
      (kind === "EXECUTION" ? source.tradedAt : source.lastUpdatedAt || source.submittedAt)
  );
  if (!SAFE_SYMBOL.test(symbol || "") || side === null || quantity === null || occurredAt === null) {
    return null;
  }

  if (kind === "EXECUTION") {
    if (source.executionStatus !== undefined && source.executionStatus !== "EXECUTED") return null;
    const unitPrice = normalizeMoney(source.unitPrice);
    const total = normalizeMoney(source.grossAmount || source.total);
    if (unitPrice === null || total === null) return null;
    return {
      kind: "execution",
      occurredAt,
      symbol,
      side,
      quantity,
      unitPrice,
      total
    };
  }

  if (kind !== "ORDER") return null;
  if (!new Set(["FILLED", "OPEN", "CANCELLED"]).has(source.status)) return null;
  if (!new Set(["MARKET", "LIMIT"]).has(source.orderType)) return null;
  const filledQuantity = decimalString(source.filledQuantity);
  if (filledQuantity === null) return null;
  const limitPrice = source.limitPrice === null || source.limitPrice === undefined
    ? null
    : normalizeMoney(source.limitPrice);
  const averageFillPrice = source.averageFillPrice === null || source.averageFillPrice === undefined
    ? null
    : normalizeMoney(source.averageFillPrice);
  if (
    (source.limitPrice !== null && source.limitPrice !== undefined && limitPrice === null) ||
    (source.averageFillPrice !== null && source.averageFillPrice !== undefined && averageFillPrice === null)
  ) {
    return null;
  }
  return {
    kind: "order",
    occurredAt,
    symbol,
    side,
    quantity,
    filledQuantity,
    status: source.status,
    orderType: source.orderType,
    limitPrice,
    averageFillPrice
  };
}

function normalizeActivityData(data) {
  const value = asObject(data);
  const source = Object.keys(asObject(value.activity)).length ? asObject(value.activity) : value;
  const items = asArray(source.records || source.items || source.rows)
    .map(normalizeActivityItem)
    .filter(Boolean)
    .slice(0, 10);
  const asOf = canonicalTimestamp(source.asOf);
  const coverage = asObject(source.coverage);
  const matchedCount = Number.isInteger(source.matchedCount) && source.matchedCount >= 0
    ? source.matchedCount
    : coverage.matchedCount;
  return {
    schemaVersion: "assistant-v3.activity-card-data.v1",
    asOf,
    dataClass: source.dataClass === "synthetic" ? "synthetic" : null,
    hasMore: source.hasMore === true,
    matchedCount: Number.isInteger(matchedCount) && matchedCount >= 0
      ? matchedCount
      : items.length,
    items
  };
}

function normalizeCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card) || !CARD_KINDS.has(card.kind)) {
    return null;
  }
  if (typeof card.cardId !== "string" || !card.cardId || typeof card.title !== "string") {
    return null;
  }
  return {
    cardId: card.cardId,
    kind: card.kind,
    title: card.title.normalize("NFKC").trim() || "Details",
    factRefs: asArray(card.factRefs).filter((value) => typeof value === "string"),
    data: card.kind === "activity"
      ? normalizeActivityData(card.data)
      : asObject(card.data)
  };
}

function normalizeAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  if (action.kind === "open-in-app") {
    const actionId = normalizedText(action.actionId, 160);
    const label = normalizedText(action.label, 120);
    const href = safeV3InAppHref(action.href);
    if (
      action.schemaVersion !== "assistant-v3.in-app-navigation-action.v1" ||
      actionId === null ||
      label === null ||
      href === null ||
      IN_APP_ACTIONS[action.target] !== href
    ) {
      return null;
    }
    return {
      schemaVersion: action.schemaVersion,
      actionId,
      kind: action.kind,
      target: action.target,
      label,
      href,
      citationRefs: asArray(action.citationRefs)
        .filter((value) => typeof value === "string" && value.length <= 160)
        .slice(0, 10),
      catalogVersion: typeof action.catalogVersion === "string" ? action.catalogVersion : ""
    };
  }
  if (action.kind === "open-read-only-view") {
    const catalog = READ_ONLY_ACTIONS[action.target];
    const label = normalizedText(action.label, 120);
    const factRefs = asArray(action.factRefs).filter(
      (value) =>
        typeof value === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)
    );
    if (
      action.schemaVersion !== "assistant-v3.read-only-navigation-action.v1" ||
      catalog === undefined ||
      action.actionId !== catalog.actionId ||
      action.href !== catalog.href ||
      action.catalogVersion !== READ_ONLY_NAVIGATION_CATALOG_VERSION ||
      label === null ||
      !catalog.labels.includes(label) ||
      factRefs.length !== 1 ||
      asArray(action.factRefs).length !== 1
    ) {
      return null;
    }
    return {
      schemaVersion: action.schemaVersion,
      actionId: catalog.actionId,
      kind: action.kind,
      target: action.target,
      label,
      href: catalog.href,
      factRefs,
      catalogVersion: READ_ONLY_NAVIGATION_CATALOG_VERSION
    };
  }
  if (action.kind === "open-signed-order-ticket") {
    const intentId = normalizedText(action.intentId, 160);
    const label = normalizedText(action.label, 120);
    const expiresAt = canonicalTimestamp(action.expiresAt);
    if (
      intentId === null ||
      !ORDER_INTENT_ID.test(intentId) ||
      action.actionId !== `confirm-${intentId}` ||
      label === null ||
      action.href !== null ||
      expiresAt === null
    ) {
      return null;
    }
    return {
      actionId: action.actionId,
      kind: action.kind,
      label,
      href: null,
      expiresAt,
      intentId
    };
  }
  if (!LEGACY_ACTION_KINDS.has(action.kind)) return null;
  return action;
}

/**
 * A preview card can display estimates by itself, but it can only render a
 * confirmation control when one independently authorized response action is
 * canonically bound to that exact preview. The returned intent always comes
 * from the action, never from card data alone.
 */
export function v3OrderPreviewConfirmationAction(card, actions, now = Date.now()) {
  if (!card || card.kind !== "order-preview" || !Number.isFinite(now)) return null;
  const data = asObject(card.data);
  const intentId = normalizedText(data.intentId, 160);
  const expiresAt = canonicalTimestamp(data.expiresAt);
  const confirmationLabel = normalizedText(data.confirmationLabel, 120);
  if (
    intentId === null ||
    !ORDER_INTENT_ID.test(intentId) ||
    expiresAt === null ||
    confirmationLabel === null ||
    Date.parse(expiresAt) <= now ||
    !Array.isArray(card.factRefs) ||
    card.factRefs.length !== 1
  ) {
    return null;
  }
  const matching = asArray(actions).filter((action) =>
    action &&
    action.kind === "open-signed-order-ticket" &&
    action.actionId === `confirm-${intentId}` &&
    action.intentId === intentId &&
    action.expiresAt === expiresAt &&
    action.label === confirmationLabel &&
    action.href === null
  );
  return matching.length === 1 ? matching[0] : null;
}

function normalizeCitation(citation) {
  if (!citation || typeof citation !== "object" || Array.isArray(citation)) return null;
  if (
    typeof citation.citationId !== "string" ||
    typeof citation.title !== "string" ||
    typeof citation.url !== "string"
  ) {
    return null;
  }
  return {
    citationId: citation.citationId,
    sourceId: typeof citation.sourceId === "string" ? citation.sourceId : "",
    title: citation.title.normalize("NFKC").trim() || "Source",
    url: citation.url,
    sourceAsOf: typeof citation.sourceAsOf === "string" ? citation.sourceAsOf : "",
    effectiveFrom: typeof citation.effectiveFrom === "string" ? citation.effectiveFrom : null,
    effectiveTo: typeof citation.effectiveTo === "string" ? citation.effectiveTo : null,
    contentHash: typeof citation.contentHash === "string" ? citation.contentHash : ""
  };
}

function normalizeChart(chart) {
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) return null;
  if (
    typeof chart.chartId !== "string" ||
    typeof chart.symbol !== "string" ||
    !CHART_RANGES.has(chart.range)
  ) {
    return null;
  }
  const points = asArray(chart.points).filter(
    (point) =>
      point &&
      typeof point === "object" &&
      !Array.isArray(point) &&
      typeof point.timestamp === "string" &&
      (typeof point.close === "string" || typeof point.close === "number")
  );
  return {
    chartId: chart.chartId,
    symbol: chart.symbol.normalize("NFKC").trim().toUpperCase(),
    range: chart.range,
    currency: typeof chart.currency === "string" ? chart.currency : "USD",
    asOf: typeof chart.asOf === "string" ? chart.asOf : "",
    source: typeof chart.source === "string" ? chart.source : "Market history",
    points
  };
}

export function normalizeV3AssistantResponse(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.schemaVersion !== "assistant-v3.response.v1" ||
    typeof payload.message !== "string"
  ) {
    throw new TypeError("The assistant returned an invalid V3 response.");
  }
  const normalized = {
    ...payload,
    message: payload.message.normalize("NFKC").trim(),
    cards: asArray(payload.cards).map(normalizeCard).filter(Boolean),
    citations: asArray(payload.citations).map(normalizeCitation).filter(Boolean),
    charts: asArray(payload.charts).map(normalizeChart).filter(Boolean),
    actions: asArray(payload.actions).map(normalizeAction).filter(Boolean),
    notices: asArray(payload.notices).filter((value) => typeof value === "string"),
    freshness: asArray(payload.freshness),
    evaluations: asArray(payload.evaluations),
    // Delivery is an authorization decision, not a display preference. Only
    // the exact server-issued success literal may unlock financial content;
    // missing, malformed, or future values remain blocked.
    deliveryGate: payload.deliveryGate === "pass" ? "pass" : "blocked"
  };
  return {
    ...normalized,
    actions: normalized.actions.filter((action) =>
      action.kind !== "open-read-only-view" ||
      v3ReadOnlyViewAction(normalized, action) !== null
    )
  };
}

export function v3PriceHistoryCharts(response) {
  return asArray(response?.charts).filter(
    (chart) => chart && CHART_RANGES.has(chart.range) && Array.isArray(chart.points)
  );
}

export function v3TenYearCharts(response) {
  return v3PriceHistoryCharts(response).filter((chart) => chart.range === "10y");
}

export function safeV3CitationHref(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function safeV3HandoffHref(value, origin = globalThis.location?.origin) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^invest-assistant:\/\//iu.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && origin && url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}

export function safeV3InAppHref(value) {
  return typeof value === "string" && IN_APP_PATHS.has(value) ? value : null;
}

export function safeV3ReadOnlyHref(value) {
  return typeof value === "string" && READ_ONLY_PATHS.has(value) ? value : null;
}

export function v3ReadOnlyViewAction(response, action) {
  if (
    response?.deliveryGate !== "pass" ||
    !action ||
    action.kind !== "open-read-only-view"
  ) {
    return null;
  }
  const catalog = READ_ONLY_ACTIONS[action.target];
  if (
    catalog === undefined ||
    action.schemaVersion !== "assistant-v3.read-only-navigation-action.v1" ||
    action.catalogVersion !== READ_ONLY_NAVIGATION_CATALOG_VERSION ||
    action.actionId !== catalog.actionId ||
    action.href !== catalog.href ||
    !catalog.labels.includes(action.label) ||
    !Array.isArray(action.factRefs) ||
    action.factRefs.length !== 1
  ) {
    return null;
  }
  const [factRef] = action.factRefs;
  const matchingCards = asArray(response.cards).filter((card) =>
    card?.kind === catalog.cardKind &&
    Array.isArray(card.factRefs) &&
    card.factRefs.length === 1 &&
    card.factRefs[0] === factRef
  );
  return matchingCards.length === 1 ? Object.freeze({ ...action }) : null;
}

export function v3InAppDestination(value, locale) {
  const href = safeV3InAppHref(value);
  if (href === null) return null;
  const destination = IN_APP_DESTINATIONS[href];
  if (!destination) return null;
  const selectedLocale = locale === "az-AZ" ? "az-AZ" : "en-US";
  const copy = destination[selectedLocale];
  return Object.freeze({
    href,
    locale: selectedLocale,
    sourceUrl:
      selectedLocale === "az-AZ" ? destination.sourceUrlAz : destination.sourceUrl,
    sourceAsOf: destination.sourceAsOf,
    eyebrow: copy.eyebrow,
    title: copy.title,
    summary: copy.summary,
    steps: copy.steps,
    sourceLabel: copy.sourceLabel,
    notice: copy.notice
  });
}
