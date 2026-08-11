import { normalizeChartSymbol } from "/market-symbols.js";
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
  v3ReadOnlyViewAction,
  v3OrderPreviewConfirmationAction,
  v3PriceHistoryCharts
} from "/v3-api.js";
import { createV3ActivityCardView } from "/v3-activity.js";

const LOCALE_STORAGE_KEY = "invest-assistant-v3.locale";
const SUPPORTED_LOCALES = new Set(["en-US", "az-AZ"]);
const DEFAULT_BRANDING = Object.freeze({
  name: "Invest Assistant",
  mark: "IA",
  productName: "Demo Invest"
});

function readPreferredLocale() {
  try {
    const stored = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (SUPPORTED_LOCALES.has(stored)) return stored;
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
  return document.documentElement.lang.toLowerCase().startsWith("az") ? "az-AZ" : "en-US";
}

const initialLocale = readPreferredLocale();
document.documentElement.lang = initialLocale === "az-AZ" ? "az" : "en";

const UI_COPY = {
  "en-US": {
    title: "{brandName} — Open-source reference demo",
    description: "{brandName} is a tool-grounded investment assistant reference implementation with a synthetic portfolio and bounded market evidence.",
    brandHome: "{brandName} home",
    brandProduct: "{productName} demo",
    language: "Language",
    useEnglish: "Use English",
    useAzerbaijani: "Use Azerbaijani",
    mockClient: "Mock client",
    refreshMarket: "Refresh market data",
    portfolioIntelligence: "Portfolio intelligence",
    greeting: "Good evening,",
    intro: "Understand your portfolio with the available market context.",
    loadingMarket: "Loading market data",
    checkingSnapshots: "Checking latest snapshots…",
    portfolioDashboard: "Portfolio dashboard",
    coveredValue: "Covered portfolio value",
    loading: "Loading",
    unrealizedPnl: "Unrealized P&L",
    today: "Today",
    cash: "Cash",
    portfolioNotice: "Mock holdings · Informational prices",
    portfolioDataNotice: "Synthetic ledger · Informational market snapshots",
    composition: "Composition",
    allocation: "Allocation",
    allocationChart: "Portfolio allocation chart",
    invested: "invested",
    currentSnapshots: "Current snapshots",
    marketWatch: "Market watch",
    refresh: "Refresh",
    mockAccount: "Mock account",
    holdings: "Holdings",
    instrument: "Instrument",
    quantity: "Quantity",
    marketValue: "Market value",
    weight: "Weight",
    loadingSnapshots: "Loading current snapshots…",
    assistantTitle: "Invest assistant",
    connecting: "Connecting securely…",
    ready: "Ready · Secure V3 session",
    unavailable: "Assistant connection unavailable",
    conversation: "Assistant conversation",
    welcome: "Hi — I can analyze your portfolio or a hypothetical allocation, research companies and ETFs, explain investment concepts, and prepare a read-only order preview.",
    welcomeMeta: "Signed V3 evidence · mock client portfolio",
    suggestedQuestions: "Suggested questions",
    messageLabel: "Ask for portfolio analysis, market research, or a read-only preview",
    messagePlaceholder: "Describe a portfolio or ask an investment question…",
    sendMessage: "Send message",
    disclaimer: "Informational only. I can explain figures, risks, and common perspectives, but cannot recommend buying, holding, selling, or a specific allocation. Order previews never submit a trade. Client data is mock.",
    assistantThinking: "Assistant is thinking",
    sessionChanged: "Language changed · new secure session",
    completeCoverage: "Complete coverage",
    priced: "{priced}/{total} priced",
    mockPortfolio: "Mock portfolio",
    instruments: "{count} instruments",
    someDataStale: "Some data stale",
    delayedMarketData: "Delayed market data",
    snapshotsActive: "Market snapshots active",
    refreshSeconds: "{seconds}s refresh",
    latest: "Latest: {value}",
    asOf: "As of {value}",
    marketUnavailable: "Market data unavailable",
    portfolioIncomplete: "Portfolio values are incomplete",
    unavailableValue: "Unavailable",
    noQuote: "No current quote",
    tryRefresh: "Try refresh",
    requestBlocked: "I couldn’t verify this answer well enough to show it. Please try again.",
    responseWithheld: "Response withheld",
    noAnswer: "I couldn’t find an answer for that request.",
    requestFailed: "I couldn't complete that request. Please try again.",
    serviceError: "Service error",
    snapshotsLoaded: "Latest market snapshots loaded",
    marketServiceUnavailable: "Market service unavailable",
    tryAgain: "Try again in a moment",
    updateUnreadable: "A market update could not be read",
    updateDelayed: "Market update delayed",
    reconnecting: "Reconnecting market stream",
    confirmationPending: "Confirming the secure handoff…",
    verificationPending: "Verifying the one-use handoff…",
    handoffVerified: "One-use handoff verified. No order has been submitted. ",
    openTicketReview: "Open read-only ticket review",
    confirmed: "Confirmed",
    confirmationFailed: "The order ticket could not be confirmed. Please try again.",
    previewNotice: "This is a preview, not an order. The order screen will recheck price, fees, balance, disclosures, and eligibility.",
    awaitingConfirmation: "Awaiting your confirmation.",
    confirmationUnavailable: "Confirmation is unavailable for this preview.",
    side: "Side",
    requested: "Requested",
    previewPrice: "Preview price",
    estimatedFee: "Estimated fee",
    estimatedDebit: "Estimated debit",
    suggested: [
      ["Portfolio value", "What is my current portfolio value?"],
      ["Hypothetical allocation", "Imagine my portfolio is 60% NVDA, 20% AAPL, 20% cash. Analyze my allocation."],
      ["NVDA cost-basis view", "Assume I own 15 shares of NVDA bought at $170 each. Should I buy more, hold, or sell?"],
      ["AAPL decision factors", "Should I sell my AAPL shares?"],
      ["Compare ETFs", "Compare VOO and QQQ, including their main differences and risks."],
      ["Preview AAPL ticket", "Open a $100 AAPL buy ticket"]
    ]
  },
  "az-AZ": {
    title: "{brandName} — Açıq mənbəli nümunə",
    description: "{brandName} sintetik portfel və məhdud bazar sübutları ilə alət əsaslı investisiya köməkçisi nümunəsidir.",
    brandHome: "{brandName} ana səhifəsi",
    brandProduct: "{productName} demo",
    language: "Dil",
    useEnglish: "İngilis dilini seç",
    useAzerbaijani: "Azərbaycan dilini seç",
    mockClient: "Mock müştəri",
    refreshMarket: "Bazar məlumatlarını yenilə",
    portfolioIntelligence: "Portfel təhlili",
    greeting: "Axşamınız xeyir,",
    intro: "Portfelinizi mövcud bazar konteksti ilə daha yaxşı anlayın.",
    loadingMarket: "Bazar məlumatları yüklənir",
    checkingSnapshots: "Son məlumatlar yoxlanılır…",
    portfolioDashboard: "Portfel paneli",
    coveredValue: "Qiymətləndirilmiş portfel dəyəri",
    loading: "Yüklənir",
    unrealizedPnl: "Reallaşdırılmamış gəlir/zərər",
    today: "Bu gün",
    cash: "Nağd vəsait",
    portfolioNotice: "Mock aktivlər · Məlumat xarakterli qiymətlər",
    portfolioDataNotice: "Sintetik reyestr · Məlumat xarakterli bazar göstəriciləri",
    composition: "Tərkib",
    allocation: "Bölgü",
    allocationChart: "Portfel bölgüsü qrafiki",
    invested: "investisiya edilib",
    currentSnapshots: "Cari məlumatlar",
    marketWatch: "Bazar icmalı",
    refresh: "Yenilə",
    mockAccount: "Mock hesab",
    holdings: "Aktivlər",
    instrument: "Alət",
    quantity: "Miqdar",
    marketValue: "Bazar dəyəri",
    weight: "Pay",
    loadingSnapshots: "Cari məlumatlar yüklənir…",
    assistantTitle: "İnvestisiya köməkçisi",
    connecting: "Təhlükəsiz bağlantı qurulur…",
    ready: "Hazır · Təhlükəsiz V3 sessiyası",
    unavailable: "Köməkçi ilə bağlantı mövcud deyil",
    conversation: "Köməkçi ilə söhbət",
    welcome: "Salam — portfelinizi və ya hipotetik bölgünü təhlil edə, şirkətləri və ETF-ləri araşdıra, investisiya anlayışlarını izah edə və yalnız baxış üçün sifariş önbaxışı hazırlaya bilərəm.",
    welcomeMeta: "İmzalanmış V3 sübutu · mock müştəri portfeli",
    suggestedQuestions: "Təklif olunan suallar",
    messageLabel: "Portfel təhlili, bazar araşdırması və ya yalnız baxış üçün önbaxış istəyin",
    messagePlaceholder: "Portfeli təsvir edin və ya investisiya sualı yazın…",
    sendMessage: "Mesaj göndər",
    disclaimer: "Yalnız məlumat xarakterlidir. Rəqəmləri, riskləri və ümumi yanaşmaları izah edə bilərəm, lakin alış, saxlama, satış və ya konkret bölgü tövsiyə etmirəm. Önbaxış əməliyyat icra etmir. Müştəri məlumatları mock-dur.",
    assistantThinking: "Köməkçi düşünür",
    sessionChanged: "Dil dəyişdirildi · yeni təhlükəsiz sessiya",
    completeCoverage: "Tam qiymətləndirmə",
    priced: "{priced}/{total} qiymətləndirilib",
    mockPortfolio: "Mock portfel",
    instruments: "{count} alət",
    someDataStale: "Bəzi məlumatlar köhnəlib",
    delayedMarketData: "Gecikmiş bazar məlumatı",
    snapshotsActive: "Bazar məlumatları aktivdir",
    refreshSeconds: "{seconds} san. yenilənmə",
    latest: "Son məlumat: {value}",
    asOf: "{value} tarixinə",
    marketUnavailable: "Bazar məlumatı mövcud deyil",
    portfolioIncomplete: "Portfel dəyərləri natamamdır",
    unavailableValue: "Mövcud deyil",
    noQuote: "Cari qiymət yoxdur",
    tryRefresh: "Yeniləməyə çalışın",
    requestBlocked: "Bu cavabı göstərmək üçün kifayət qədər təsdiqləyə bilmədim. Yenidən cəhd edin.",
    responseWithheld: "Cavab göstərilmədi",
    noAnswer: "Bu sorğu üçün cavab tapa bilmədim.",
    requestFailed: "Sorğunu tamamlaya bilmədim. Yenidən cəhd edin.",
    serviceError: "Xidmət xətası",
    snapshotsLoaded: "Son bazar məlumatları yükləndi",
    marketServiceUnavailable: "Bazar xidməti mövcud deyil",
    tryAgain: "Bir az sonra yenidən cəhd edin",
    updateUnreadable: "Bazar yeniləməsi oxuna bilmədi",
    updateDelayed: "Bazar yeniləməsi gecikir",
    reconnecting: "Bazar axınına yenidən qoşulur",
    confirmationPending: "Təhlükəsiz keçid təsdiqlənir…",
    verificationPending: "Birdəfəlik keçid yoxlanılır…",
    handoffVerified: "Birdəfəlik keçid yoxlanıldı. Heç bir sifariş göndərilməyib. ",
    openTicketReview: "Yalnız baxış üçün bileti aç",
    confirmed: "Təsdiqləndi",
    confirmationFailed: "Alış biletini təsdiqləmək mümkün olmadı. Yenidən cəhd edin.",
    previewNotice: "Bu, sifariş deyil, yalnız ilkin baxışdır. Sifariş ekranı qiyməti, komissiyaları, balansı, açıqlamaları və uyğunluğu yenidən yoxlamalıdır.",
    awaitingConfirmation: "Təsdiqiniz gözlənilir.",
    confirmationUnavailable: "Bu ilkin baxış üçün təsdiq mövcud deyil.",
    side: "İstiqamət",
    requested: "Sorğu məbləği",
    previewPrice: "İlkin qiymət",
    estimatedFee: "Təxmini komissiya",
    estimatedDebit: "Təxmini çıxılacaq məbləğ",
    suggested: [
      ["Portfel dəyəri", "Portfelimin cari dəyəri nə qədərdir?"],
      ["Hipotetik bölgü", "Hipotetik portfel bölgüsü: 60% NVDA, 20% AAPL və 20% nağd vəsait. Təhlil et."],
      ["NVDA maya dəyəri", "Fərz et ki, 15 NVDA səhmi almışam, alış qiyməti səhm başına $170-dir. Daha çox alım, saxlayım, yoxsa satım?"],
      ["AAPL qərar amilləri", "AAPL səhmlərimi satım?"],
      ["ETF-ləri müqayisə et", "VOO və QQQ fondlarını, əsas fərqlərini və risklərini müqayisə et."],
      ["AAPL biletinə baxış", "100 USD-lik AAPL alış bileti aç"]
    ]
  }
};

const state = {
  portfolio: null,
  client: null,
  capabilities: null,
  productProfile: "demo-invest",
  branding: DEFAULT_BRANDING,
  portfolioStream: null,
  loading: false,
  historyCache: new Map(),
  locale: initialLocale,
  sessionToken: null,
  sessionPromise: null,
  sessionStatus: "connecting"
};
const ORDER_SCREEN_STATE_KEY = "invest-assistant-v3.order-screen-state";

const HISTORY_RANGES = [
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1m" },
  { label: "6M", value: "6m" },
  { label: "1Y", value: "1y" },
  { label: "5Y", value: "5y" },
  { label: "10Y", value: "10y" },
  { label: "Max", value: "max" }
];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1
});

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function byId(id) {
  return document.getElementById(id);
}

function formatUiTemplate(template, variables = {}) {
  if (typeof template !== "string") return "";
  const replacements = {
    brandName: state.branding.name,
    brandMark: state.branding.mark,
    productName: state.branding.productName,
    ...variables
  };
  return Object.entries(replacements).reduce(
    (value, [name, replacement]) =>
      value.replaceAll(`{${name}}`, String(replacement)),
    template
  );
}

function t(key, variables = {}) {
  const template = UI_COPY[state.locale]?.[key] ?? UI_COPY["en-US"][key] ?? key;
  return formatUiTemplate(template, variables);
}

function normalizePublicBranding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_BRANDING;
  }
  const rules = {
    name: 60,
    mark: 8,
    productName: 80
  };
  const branding = {};
  for (const [key, maximumLength] of Object.entries(rules)) {
    const candidate = value[key];
    if (
      typeof candidate !== "string" ||
      candidate.length < 1 ||
      candidate.length > maximumLength ||
      /[\u0000-\u001F\u007F<>]/u.test(candidate)
    ) {
      return DEFAULT_BRANDING;
    }
    branding[key] = candidate;
  }
  return Object.freeze(branding);
}

function setLocaleControls(enabled) {
  for (const button of byId("locale-selector").querySelectorAll("button[data-locale]")) {
    button.disabled = !enabled;
  }
}

function setAssistantSessionStatus(status) {
  state.sessionStatus = status;
  const assistantMode = byId("assistant-mode");
  assistantMode.dataset.i18n = status;
  assistantMode.textContent = t(status);
}

function persistLocale(locale) {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The selected locale still applies for this page when storage is unavailable.
  }
}

function applyLocale() {
  const copy = UI_COPY[state.locale];
  document.documentElement.lang = state.locale === "az-AZ" ? "az" : "en";
  document.title = t("title");
  byId("page-description")?.setAttribute("content", t("description"));
  byId("brand-mark").textContent = state.branding.mark;
  byId("brand-name").textContent = state.branding.name;
  byId("brand-product").textContent = t("brandProduct");

  for (const element of document.querySelectorAll("[data-i18n]")) {
    const value = t(element.dataset.i18n);
    if (typeof value === "string") element.textContent = value;
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    const value = t(element.dataset.i18nAriaLabel);
    if (typeof value === "string") element.setAttribute("aria-label", value);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    const value = t(element.dataset.i18nPlaceholder);
    if (typeof value === "string") element.setAttribute("placeholder", value);
  }

  const selector = byId("locale-selector");
  selector.setAttribute("aria-label", copy.language);
  for (const button of selector.querySelectorAll("button[data-locale]")) {
    const selected = button.dataset.locale === state.locale;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute(
      "aria-label",
      button.dataset.locale === "az-AZ" ? copy.useAzerbaijani : copy.useEnglish
    );
  }

  for (const button of byId("suggestions").querySelectorAll("button[data-suggestion-index]")) {
    const suggestion = copy.suggested[Number(button.dataset.suggestionIndex)];
    if (!suggestion) continue;
    button.textContent = formatUiTemplate(suggestion[0]);
    button.dataset.prompt = formatUiTemplate(suggestion[1]);
  }
}

function resetConversationForLocale() {
  const welcome = createElement("div", "message assistant-message");
  welcome.id = "welcome-message";
  welcome.append(
    createElement("p", "", t("welcome")),
    createElement("span", "", t("welcomeMeta"))
  );
  byId("messages").replaceChildren(welcome);
}

async function changeLocale(locale) {
  if (!SUPPORTED_LOCALES.has(locale) || locale === state.locale || state.loading) return;
  setAssistantControls(false);
  setLocaleControls(false);
  const pendingSession = state.sessionPromise;
  state.locale = locale;
  persistLocale(locale);
  applyLocale();
  renderGovernedInAppDestination();
  renderReadOnlyInAppDestination();
  resetConversationForLocale();
  if (state.portfolio) renderPortfolio(state.portfolio);

  try {
    if (pendingSession) await pendingSession.catch(() => undefined);
    state.sessionToken = null;
    state.sessionPromise = null;
    await initializeAssistantSession(true);
    showToast(t("sessionChanged"));
  } catch (error) {
    showToast(error.message);
  } finally {
    setLocaleControls(true);
  }
}

function resizeMessageInput(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const serverMessage = typeof body?.error?.message === "string"
      ? body.error.message
      : typeof body?.message === "string"
        ? body.message
        : `Request failed with ${response.status}`;
    const error = new Error(serverMessage);
    error.status = response.status;
    throw error;
  }
  return body;
}

function setAssistantControls(enabled) {
  const input = byId("message-input");
  const submit = byId("chat-form").querySelector("button[type='submit']");
  input.disabled = !enabled;
  submit.disabled = !enabled;
  for (const button of byId("suggestions").querySelectorAll("button")) {
    button.disabled = !enabled;
  }
}

async function initializeAssistantSession(force = false) {
  if (state.sessionToken && !force) return state.sessionToken;
  if (state.sessionPromise && !force) return state.sessionPromise;
  if (force) state.sessionToken = null;
  setAssistantControls(false);
  setAssistantSessionStatus("connecting");
  const request = createV3SessionRequest(state.locale);
  const pending = fetchJson(request.url, request.options)
    .then((payload) => {
      state.sessionToken = readV3SessionToken(payload);
      setAssistantSessionStatus("ready");
      setAssistantControls(true);
      return state.sessionToken;
    })
    .catch((error) => {
      state.sessionToken = null;
      setAssistantSessionStatus("unavailable");
      setAssistantControls(false);
      throw error;
    })
    .finally(() => {
      if (state.sessionPromise === pending) state.sessionPromise = null;
    });
  state.sessionPromise = pending;
  return pending;
}

async function fetchWithV3Session(requestFactory) {
  let token = await initializeAssistantSession();
  try {
    const request = requestFactory(token);
    return await fetchJson(request.url, request.options);
  } catch (error) {
    if (error.status !== 401) throw error;
    token = await initializeAssistantSession(true);
    const request = requestFactory(token);
    return fetchJson(request.url, request.options);
  }
}

function signedMoney(value) {
  if (value === null || value === undefined) return "—";
  return `${value >= 0 ? "+" : "−"}${currency.format(Math.abs(value))}`;
}

function signedPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function valueClass(value) {
  if (!value) return "";
  return value > 0 ? "positive" : "negative";
}

function renderClient(client) {
  byId("client-name").textContent = client.displayName;
  byId("client-avatar").textContent = client.initials;
}

function renderPortfolio(portfolio) {
  state.portfolio = portfolio;
  byId("portfolio-value").textContent = currency.format(portfolio.coveredValue);
  byId("cash-value").textContent = currency.format(portfolio.cashValue);
  byId("total-pnl").textContent = `${signedMoney(portfolio.unrealizedPnl)} · ${signedPercent(portfolio.unrealizedPnlPercent)}`;
  byId("total-pnl").className = valueClass(portfolio.unrealizedPnl);
  byId("day-change").textContent = signedMoney(portfolio.dayChangeValue);
  byId("day-change").className = valueClass(portfolio.dayChangeValue);
  byId("coverage-pill").textContent = portfolio.coverageComplete
    ? t("completeCoverage")
    : t("priced", { priced: portfolio.pricedHoldings, total: portfolio.totalHoldings });
  byId("portfolio-notice").textContent = t("portfolioDataNotice");
  byId("holding-count").textContent = t("instruments", { count: portfolio.totalHoldings });

  const latestQuotes = portfolio.holdings
    .map((holding) => holding.quote)
    .filter(Boolean)
    .sort((a, b) => new Date(b.asOf) - new Date(a.asOf));
  const latest = latestQuotes[0];
  if (latest) {
    const freshness = latestQuotes.some((quote) => quote.freshness === "stale")
      ? t("someDataStale")
      : latestQuotes.some((quote) => quote.freshness === "delayed")
        ? t("delayedMarketData")
        : t("snapshotsActive");
    const interval = state.capabilities?.marketStreamIntervalMs;
    const streamLabel = interval
      ? ` · ${t("refreshSeconds", { seconds: (interval / 1000).toFixed(0) })}`
      : "";
    byId("market-label").textContent = `${freshness}${streamLabel}`;
    byId("market-time").textContent = t("latest", {
      value: new Date(latest.asOf).toLocaleString(state.locale)
    });
    byId("allocation-as-of").textContent = t("asOf", {
      value: new Date(latest.asOf).toLocaleTimeString(state.locale, {
        hour: "2-digit",
        minute: "2-digit"
      })
    });
  } else {
    byId("market-label").textContent = t("marketUnavailable");
    byId("market-time").textContent = t("portfolioIncomplete");
  }

  renderAllocation(portfolio);
  renderHoldings(portfolio.holdings);
  renderWatchlist(portfolio.holdings);
}

function renderAllocation(portfolio) {
  const palette = ["#18a85c", "#5bc781", "#9bddb3", "#c9ead5", "#e4e9e6"];
  const segments = portfolio.holdings
    .filter((holding) => holding.allocationPercent !== null)
    .map((holding) => ({
      name: holding.symbol,
      value: holding.allocationPercent
    }));
  const cashPercent = portfolio.coveredValue
    ? (portfolio.cashValue / portfolio.coveredValue) * 100
    : 0;
  segments.push({ name: t("cash"), value: cashPercent });

  let cursor = 0;
  const gradient = segments
    .map((segment, index) => {
      const start = cursor;
      cursor += segment.value;
      return `${palette[index % palette.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    })
    .join(", ");
  byId("allocation-donut").style.background = `conic-gradient(${gradient})`;
  byId("positions-share").textContent = `${Math.max(0, 100 - cashPercent).toFixed(0)}%`;

  byId("allocation-legend").innerHTML = segments
    .map(
      (segment, index) => `
        <div class="legend-row">
          <i style="background:${palette[index % palette.length]}"></i>
          <span>${escapeHtml(segment.name)}</span>
          <strong>${segment.value.toFixed(1)}%</strong>
        </div>`
    )
    .join("");
}

function renderHoldings(holdings) {
  byId("holdings-body").innerHTML = holdings
    .map((holding) => {
      const pnlClass = valueClass(holding.unrealizedPnl);
      return `
        <tr>
          <td><strong>${escapeHtml(holding.symbol)}</strong><span>${escapeHtml(holding.name)}</span></td>
          <td>${number.format(holding.quantity)}</td>
          <td>${holding.marketValue === null ? t("unavailableValue") : currency.format(holding.marketValue)}<span>${holding.quote ? `${currency.format(holding.quote.price)} / ${state.locale === "az-AZ" ? "vahid" : "unit"}` : t("noQuote")}</span></td>
          <td class="${pnlClass}">${holding.unrealizedPnl === null ? "—" : signedMoney(holding.unrealizedPnl)}<span>${signedPercent(holding.unrealizedPnlPercent)}</span></td>
          <td>${holding.allocationPercent === null ? "—" : `${holding.allocationPercent.toFixed(1)}%`}</td>
        </tr>`;
    })
    .join("");
}

function renderWatchlist(holdings) {
  byId("watchlist").innerHTML = holdings
    .map((holding) => {
      const quote = holding.quote;
      if (!quote) {
        return `
          <div class="watch-row">
            <div class="instrument"><span class="instrument-mark">${escapeHtml(holding.symbol.slice(0, 2))}</span><div><strong>${escapeHtml(holding.symbol)}</strong><span>${escapeHtml(holding.name)}</span></div></div>
            <div class="watch-price"><strong>${t("unavailableValue")}</strong><span>${t("tryRefresh")}</span></div>
          </div>`;
      }
      return `
        <div class="watch-row">
          <div class="instrument"><span class="instrument-mark">${escapeHtml(holding.symbol.slice(0, 2))}</span><div><strong>${escapeHtml(holding.symbol)}</strong><span>${escapeHtml(holding.name)}</span></div></div>
          <div class="watch-price"><strong>${currency.format(quote.price)}</strong><span class="${valueClass(quote.changePercent)}">${signedPercent(quote.changePercent)} · ${escapeHtml(quote.freshness)}</span></div>
        </div>`;
    })
    .join("");
}

function addMessage(text, role, meta) {
  const message = document.createElement("div");
  message.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  message.append(paragraph);
  if (meta) {
    const label = document.createElement("span");
    label.textContent = meta;
    message.append(label);
  }
  byId("messages").append(message);
  byId("messages").scrollTop = byId("messages").scrollHeight;
  return message;
}

function addTyping() {
  const message = document.createElement("div");
  message.className = "message assistant-message typing";
  message.setAttribute("aria-label", t("assistantThinking"));
  message.innerHTML = "<i></i><i></i><i></i>";
  byId("messages").append(message);
  byId("messages").scrollTop = byId("messages").scrollHeight;
  return message;
}

function boundedKnowledgeText(value, maximumLength = 500) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

function knowledgeEffectiveDate(value, locale) {
  const text = boundedKnowledgeText(value, 40);
  if (!text) return "Not provided";
  if (text === "9999-12-31") return "Current (open-ended)";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text);
  if (Number.isNaN(date.getTime())) return text;
  try {
    return new Intl.DateTimeFormat(locale === "az-AZ" ? "az-AZ" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }).format(date);
  } catch {
    return text;
  }
}

function attachNotices(messageElement, result) {
  const notices = [...new Set(
    (Array.isArray(result.notices) ? result.notices : [])
      .filter((notice) => typeof notice === "string" && notice.trim())
      .map((notice) => notice.trim())
  )];
  if (!notices.length) return;

  const details = createElement("details", "assistant-notices");
  const summary = createElement("summary", "", notices.length === 1
    ? "Data & limitation"
    : `Data & limitations (${notices.length})`);
  const list = createElement("ul", "");
  for (const notice of notices) {
    list.append(createElement("li", "", notice));
  }
  details.append(summary, list);
  messageElement.append(details);
}

function priceFormatter(currencyCode, compact = false) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2
    });
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2
    });
  }
}

function historyDateFormatter(range, detailed = false) {
  if (range === "1d") {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    });
  }
  if (detailed) {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      ...(range === "1w" || range === "1m" ? { hour: "numeric", minute: "2-digit" } : {})
    });
  }
  return new Intl.DateTimeFormat("en-US", {
    year: range === "5y" || range === "10y" || range === "max" ? "numeric" : undefined,
    month: "short",
    day: range === "1w" || range === "1m" || range === "6m" || range === "1y" ? "numeric" : undefined
  });
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function finiteDecimal(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCardMoney(value, currencyCode = "USD") {
  const parsed = finiteDecimal(value);
  if (parsed === null) return "—";
  return priceFormatter(currencyCode).format(parsed);
}

function formatCardPercent(value, signed = false) {
  const parsed = finiteDecimal(value);
  if (parsed === null) return "—";
  const percentage = Math.abs(parsed) <= 2 ? parsed * 100 : parsed;
  return `${signed && percentage > 0 ? "+" : ""}${percentage.toFixed(2)}%`;
}

function formatPercentagePoints(value, signed = false) {
  const parsed = finiteDecimal(value);
  if (parsed === null) return "—";
  return `${signed && parsed > 0 ? "+" : ""}${parsed.toFixed(2)}%`;
}

function humanizeCardKey(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

function formatCardValue(key, value, data) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const lowerKey = key.toLowerCase();
  if (/date|asof|at$|periodstart|periodend|effective|expires/iu.test(lowerKey)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString(state.locale);
  }
  if (lowerKey === "changepercent") {
    return formatPercentagePoints(value, true);
  }
  if (/rate|percent|allocation|return/iu.test(lowerKey)) {
    return formatCardPercent(value, /change|return|pnl|contribution/iu.test(lowerKey));
  }
  if (/value|price|cost|pnl|income|fees?|commission|debit|notional|cash/iu.test(lowerKey)) {
    return formatCardMoney(value, data.currency || "USD");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

function appendCardMetric(container, label, value, emphasized = false) {
  if (value === undefined || value === null || value === "") return;
  const item = createElement("div", `v3-card-metric${emphasized ? " emphasized" : ""}`);
  item.append(
    createElement("dt", "", label),
    createElement("dd", "", value)
  );
  container.append(item);
}

function appendPositionRows(card, positions, currencyCode) {
  if (!Array.isArray(positions) || !positions.length) return;
  const list = createElement("div", "v3-card-rows");
  for (const position of positions.slice(0, 8)) {
    if (!isRecord(position)) continue;
    const row = createElement("div", "v3-card-row");
    const identity = createElement("div", "v3-card-row-identity");
    identity.append(
      createElement("strong", "", position.symbol || position.instrumentId || "Position"),
      createElement(
        "span",
        "",
        position.quantity ? `${position.quantity} units` : "Portfolio position"
      )
    );
    const primary = position.marketValue ?? position.averageUnitCost ?? position.currentPrice;
    row.append(identity, createElement("strong", "v3-card-row-value", formatCardMoney(primary, position.currency || currencyCode)));
    list.append(row);
  }
  card.append(list);
}

function appendGenericCardData(card, data) {
  const metrics = createElement("dl", "v3-card-metrics");
  const omitted = new Set([
    "positions",
    "sectors",
    "entries",
    "items",
    "sections",
    "notices",
    "text",
    "description",
    "currency",
    "intentId",
    "confirmationLabel"
  ]);
  let count = 0;
  for (const [key, value] of Object.entries(data)) {
    if (count >= 8 || omitted.has(key) || isRecord(value) || Array.isArray(value)) continue;
    appendCardMetric(metrics, humanizeCardKey(key), formatCardValue(key, value, data), count === 0);
    count += 1;
  }
  if (metrics.children.length) card.append(metrics);
  const narrative = data.text || data.description || data.summary;
  if (typeof narrative === "string" && narrative.trim()) {
    card.append(createElement("p", "v3-card-copy", boundedKnowledgeText(narrative, 700)));
  }
}

function renderActivityCard(card, data) {
  const view = createV3ActivityCardView(data, state.locale);
  if (!view.rows.length) {
    card.append(createElement("p", "v3-card-copy", view.emptyMessage));
    return;
  }

  const list = createElement("div", "v3-card-rows");
  for (const item of view.rows) {
    const row = createElement("div", "v3-card-row");
    const identity = createElement("div", "v3-card-row-identity");
    identity.append(
      createElement("strong", "", item.title),
      createElement("span", "", item.label),
      createElement("span", "", item.timestamp)
    );

    const values = createElement("div", "v3-card-row-identity");
    values.append(
      createElement("strong", "v3-card-row-value", item.primary),
      createElement("span", "", item.secondary)
    );
    row.append(identity, values);
    list.append(row);
  }
  card.append(list);

  if (view.footer) card.append(createElement("p", "v3-card-copy", view.footer));
}

function formatResearchMetric(metric, currencyCode = "USD") {
  if (!isRecord(metric)) return "Unavailable";
  if (metric.status === "DATA_NOT_AVAILABLE") return "Unavailable";
  const value = isRecord(metric.value) ? metric.value : metric;
  if (!isRecord(value) || value.value === undefined || value.value === null) {
    return "Unavailable";
  }
  if (value.unit === "currency") return formatCardMoney(value.value, value.currency || currencyCode);
  const parsed = finiteDecimal(value.value);
  if (parsed === null) return "Unavailable";
  if (value.unit === "percent") return `${parsed.toFixed(2)}%`;
  return parsed.toLocaleString(state.locale, { maximumFractionDigits: 2 });
}

function renderResearchCard(card, data) {
  const snapshot = isRecord(data.snapshot) ? data.snapshot : null;
  const resolved = isRecord(data.resolved) ? data.resolved : null;
  const summary = isRecord(data.summaryMetrics) ? data.summaryMetrics : null;
  const metrics = createElement("dl", "v3-card-metrics");

  if (snapshot) {
    appendCardMetric(
      metrics,
      "Latest price",
      formatCardMoney(snapshot.price, snapshot.currency || "USD"),
      true
    );
    appendCardMetric(
      metrics,
      "Previous-close move",
      formatPercentagePoints(snapshot.changePercent, true)
    );
    appendCardMetric(metrics, "Market", snapshot.marketState || "—");
  }
  if (summary) {
    appendCardMetric(metrics, "Market cap", formatResearchMetric(summary.marketCapitalization, snapshot?.currency));
    appendCardMetric(metrics, "Trailing P/E", formatResearchMetric(summary.trailingPe, snapshot?.currency));
    appendCardMetric(metrics, "Return on equity", formatResearchMetric(summary.returnOnEquity, snapshot?.currency));
    appendCardMetric(metrics, "Quarterly net income", formatResearchMetric(summary.quarterlyNetIncome, snapshot?.currency));
    appendCardMetric(metrics, "Gross margin", formatResearchMetric(summary.quarterlyGrossMargin, snapshot?.currency));
    appendCardMetric(metrics, "Net margin", formatResearchMetric(summary.quarterlyNetMargin, snapshot?.currency));
    appendCardMetric(metrics, "Annual volatility", formatResearchMetric(summary.annualizedVolatility, snapshot?.currency));
    appendCardMetric(metrics, "Maximum drawdown", formatResearchMetric(summary.maximumDrawdown, snapshot?.currency));
  }

  if (isRecord(data.sentiment)) {
    appendCardMetric(metrics, "Headline signal", data.sentiment.label || "Unavailable", true);
    appendCardMetric(metrics, "Confidence", data.sentiment.confidence || "Unavailable");
    appendCardMetric(metrics, "Items reviewed", data.sentiment.articleCount || "0");
  }

  if (Array.isArray(data.indicators)) {
    appendCardMetric(metrics, "Latest close", formatCardMoney(data.latestClose, data.currency || "USD"), true);
    for (const indicator of data.indicators.slice(0, 6)) {
      if (!isRecord(indicator) || indicator.value === null || indicator.value === undefined) continue;
      const label = indicator.label || humanizeCardKey(indicator.id || "Indicator");
      const suffix = /volatility|return|drawdown/iu.test(String(indicator.id || label)) ? "%" : "";
      appendCardMetric(metrics, label, `${Number(indicator.value).toFixed(2)}${suffix}`);
    }
  }

  if (metrics.children.length) card.append(metrics);

  const instrumentType = data.research?.instrumentType || resolved?.instrumentType;
  if (resolved || instrumentType) {
    const identity = [
      resolved?.displayName,
      resolved?.exchange,
      instrumentType
    ].filter(Boolean).join(" · ");
    if (identity) card.append(createElement("p", "v3-card-copy", identity));
  }

  if (Array.isArray(data.content) && data.content.length) {
    const list = createElement("ul", "v3-research-items");
    for (const item of data.content.slice(0, 4)) {
      if (!isRecord(item) || typeof item.title !== "string") continue;
      const entry = createElement("li", "");
      const href = safeV3CitationHref(item.url);
      if (href) {
        const link = createElement("a", "", item.title);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        entry.append(link);
      } else {
        entry.textContent = item.title;
      }
      list.append(entry);
    }
    if (list.children.length) card.append(list);
  }

  if (card.children.length === 1) appendGenericCardData(card, data);
}

function decisionCopy() {
  return state.locale === "az-AZ"
    ? {
        concentration: "Portfel konsentrasiyası",
        current: "Cari",
        profileTarget: "Profil hədəfi",
        totalPortfolio: "ümumi portfel",
        marketValue: "Mövqenin dəyəri",
        currentPrice: "Cari qiymət",
        cash: "Nağd vəsait",
        valuation: "P/E",
        newsSignal: "Xəbər siqnalı",
        evidencePath: "Təsdiqlənmiş sübut yolu",
        pipeline: [
          ["1", "Portfel", "Müştəri mövqeləri"],
          ["2", "Ekspozisiya", "Deterministik hesab"],
          ["3", "Profil qaydası", "Konsentrasiya yoxlaması"],
          ["4", "İzah", "Yalnız təsdiqlənmiş faktlar"],
          ["5", "Validator", "Çatdırılmadan əvvəl"]
        ],
        adviceBoundary: "Mən almaq, saxlamaq və ya satmaq barədə tövsiyə verə bilmərəm. Aşağıdakı məlumatlar rəqəmləri, riskləri və ümumi yanaşmaları müqayisə etməyə kömək edir.",
        support: "Ekspozisiyanı saxlamağa aid amillər",
        risks: "Nəzərə alınmalı risklər",
        objective: "Uzunmüddətli artım məqsədi davam edən ekspozisiyanı aktual edə bilər, lakin ticarət qərarını müəyyən etmir.",
        appreciation: "Qalan lotlar orta alış dəyərindən yuxarıdır.",
        concentrationRisk: "Tək səhm çəkisi seçilmiş profil hədəfini aşır.",
        volatilityRisk: "Tarixi volatillik və eniş göstəriciləri itki ehtimalını vurğulayır.",
        valuationRisk: "Yüksək qiymətləndirmə göstəricisi nəticələr məyus etdikdə sıxılma riski yarada bilər.",
        recentContext: "Son bazar konteksti",
        noHeadlines: "Təsdiqlənmiş son başlıq mövcud deyil.",
        compareActions: "Ümumi investor yanaşmaları",
        selected: "Yanaşma",
        choosePerspective: "Təsirini müqayisə etmək üçün yanaşma seçin.",
        verified: "Portfel, bazar, araşdırma və xəbər sübutu validator tərəfindən yoxlanılıb.",
        disclaimer: "Bu, almaq, saxlamaq və ya satmaq tövsiyəsi deyil. Xarici aktivlər, likvidlik ehtiyacları, vergilər və bütün xərclər qiymətləndirilməyib. Bütün investisiyalar risk daşıyır və kapitalınız risk altındadır. Bu ekran əməliyyat başlatmır."
      }
    : {
        concentration: "Portfolio concentration",
        current: "Current",
        profileTarget: "Profile target",
        totalPortfolio: "total portfolio",
        marketValue: "Position value",
        currentPrice: "Current price",
        cash: "Cash",
        valuation: "Trailing P/E",
        newsSignal: "News signal",
        evidencePath: "Verified evidence path",
        pipeline: [
          ["1", "Portfolio", "Client positions"],
          ["2", "Exposure", "Deterministic calculation"],
          ["3", "Profile rule", "Concentration check"],
          ["4", "Explanation", "Approved facts only"],
          ["5", "Validator", "Before delivery"]
        ],
        adviceBoundary: "I can’t recommend whether you should buy, hold, or sell. The information below helps compare the figures, risks, and common perspectives.",
        support: "Factors relevant to continued exposure",
        risks: "Risks to weigh",
        objective: "A long-term growth objective can make continued exposure relevant, but it does not determine a trade.",
        appreciation: "The remaining lots are above their average open-lot cost.",
        concentrationRisk: "The single-stock weight is above the selected profile target.",
        volatilityRisk: "Historical volatility and drawdown show meaningful downside variability.",
        valuationRisk: "An elevated valuation can compress if future results disappoint.",
        recentContext: "Recent market context",
        noHeadlines: "No verified recent headline is available.",
        compareActions: "Common investor perspectives",
        selected: "Perspective",
        choosePerspective: "Select a perspective to compare its possible effect.",
        verified: "Portfolio, market, research, and news evidence passed the delivery validator.",
        disclaimer: "This is not a recommendation to buy, hold, or sell. Outside assets, liquidity needs, taxes, and all costs have not been assessed. All investing carries risk, and your capital is at risk. This screen does not start a trade."
      };
}

function formatDecisionRate(value, signed = false) {
  const parsed = finiteDecimal(value);
  if (parsed === null) return "—";
  const percent = parsed * 100;
  return `${signed && percent > 0 ? "+" : ""}${percent.toLocaleString(state.locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`;
}

function formatDecisionMetric(value, suffix = "") {
  const parsed = finiteDecimal(value);
  if (parsed === null) return "—";
  return `${parsed.toLocaleString(state.locale, {
    maximumFractionDigits: 2
  })}${suffix}`;
}

function renderDecisionSupportCard(card, data) {
  const copy = decisionCopy();
  const profile = isRecord(data.profile) ? data.profile : {};
  const portfolio = isRecord(data.portfolio) ? data.portfolio : {};
  const market = isRecord(data.market) ? data.market : {};
  const news = isRecord(data.news) ? data.news : {};
  const assessment = isRecord(data.assessment) ? data.assessment : {};
  const headline = typeof assessment.headline === "string"
    ? assessment.headline
    : state.locale === "az-AZ" ? "Qərar amillərini nəzərdən keçirin" : "Review the decision factors";
  const rationale = typeof assessment.rationale === "string" ? assessment.rationale : "";

  const hero = createElement("section", "decision-hero");
  const heroCopy = createElement("div", "decision-hero-copy");
  const status = createElement(
    "span",
    `decision-status ${portfolio.targetExceeded === true ? "is-over" : "is-within"}`,
    portfolio.targetExceeded === true
      ? state.locale === "az-AZ" ? "Profil hədəfindən yuxarı" : "Above profile target"
      : state.locale === "az-AZ" ? "Profil hədəfi daxilində" : "Within profile target"
  );
  heroCopy.append(
    status,
    createElement("h4", "", headline),
    createElement("p", "", rationale)
  );
  const exposure = createElement("div", "decision-exposure");
  exposure.append(
    createElement("span", "", copy.concentration),
    createElement("strong", "", formatDecisionRate(portfolio.allocationRate))
  );
  exposure.append(createElement("small", "", copy.totalPortfolio));
  hero.append(heroCopy, exposure);
  card.append(hero);
  card.append(createElement("p", "decision-advice-boundary", copy.adviceBoundary));

  const meter = createElement("section", "decision-meter");
  const meterLabels = createElement("div", "decision-meter-labels");
  meterLabels.append(
    createElement("span", "", `${copy.current} · ${formatDecisionRate(portfolio.allocationRate)}`),
    createElement("span", "", `${copy.profileTarget} · ${formatDecisionRate(profile.singleStockTargetMaxAllocationRate)}`)
  );
  const meterTrack = createElement("div", "decision-meter-track");
  const currentRate = Math.max(0, Math.min(1, finiteDecimal(portfolio.allocationRate) ?? 0));
  const targetRate = Math.max(
    0,
    Math.min(1, finiteDecimal(profile.singleStockTargetMaxAllocationRate) ?? 0)
  );
  const fill = createElement("i", "");
  fill.style.width = `${(currentRate * 100).toFixed(2)}%`;
  const marker = createElement("b", "");
  marker.style.left = `${(targetRate * 100).toFixed(2)}%`;
  marker.setAttribute("aria-hidden", "true");
  meterTrack.append(fill, marker);
  meter.append(meterLabels, meterTrack);
  card.append(meter);

  const metrics = createElement("dl", "decision-metrics");
  const metricItems = [
    [copy.marketValue, formatCardMoney(portfolio.marketValue, portfolio.currency || "USD")],
    [copy.currentPrice, formatCardMoney(market.price, portfolio.currency || "USD")],
    [
      copy.cash,
      `${formatCardMoney(portfolio.cashValue, portfolio.currency || "USD")} · ${formatDecisionRate(portfolio.cashAllocationRate)}`
    ],
    [copy.valuation, formatDecisionMetric(market.trailingPe)],
    [copy.newsSignal, typeof news.sentiment === "string" ? news.sentiment : "—"]
  ];
  for (const [label, value] of metricItems) {
    const item = createElement("div", "");
    item.append(createElement("dt", "", label), createElement("dd", "", value));
    metrics.append(item);
  }
  card.append(metrics);

  const pipelineSection = createElement("details", "decision-pipeline-section");
  pipelineSection.append(createElement("summary", "", copy.evidencePath));
  const pipeline = createElement("ol", "decision-pipeline");
  for (const [numberLabel, label, detail] of copy.pipeline) {
    const item = createElement("li", "");
    item.append(
      createElement("span", "", numberLabel),
      (() => {
        const text = createElement("div", "");
        text.append(createElement("strong", "", label), createElement("small", "", detail));
        return text;
      })()
    );
    pipeline.append(item);
  }
  pipelineSection.append(pipeline);
  card.append(pipelineSection);

  const factors = createElement("section", "decision-factors");
  const support = createElement("div", "decision-factor is-support");
  support.append(createElement("h4", "", copy.support));
  const supportList = createElement("ul", "");
  supportList.append(
    createElement("li", "", copy.objective),
    createElement(
      "li",
      "",
      `${copy.appreciation} ${formatDecisionRate(
        portfolio.appreciationSinceAverageOpenLotCostRate,
        true
      )}`
    )
  );
  support.append(supportList);
  const risks = createElement("div", "decision-factor is-risk");
  risks.append(createElement("h4", "", copy.risks));
  const risksList = createElement("ul", "");
  if (portfolio.targetExceeded === true) {
    risksList.append(createElement("li", "", copy.concentrationRisk));
  }
  if (finiteDecimal(market.annualizedVolatility) !== null) {
    risksList.append(createElement(
      "li",
      "",
      `${copy.volatilityRisk} ${formatDecisionMetric(market.annualizedVolatility, "%")}`
    ));
  }
  if (finiteDecimal(market.trailingPe) !== null) {
    risksList.append(createElement("li", "", copy.valuationRisk));
  }
  risks.append(risksList);
  factors.append(support, risks);
  card.append(factors);

  const context = createElement("section", "decision-news");
  const contextHeading = createElement("div", "decision-section-heading");
  contextHeading.append(
    createElement("h4", "", copy.recentContext),
    createElement(
      "span",
      "",
      `${typeof news.sentiment === "string" ? news.sentiment : "—"} · ${news.articleCount || "0"}`
    )
  );
  context.append(contextHeading);
  const headlines = Array.isArray(news.headlines) ? news.headlines : [];
  const headlineList = createElement("ul", "");
  for (const item of headlines) {
    if (!isRecord(item) || typeof item.title !== "string") continue;
    const entry = createElement("li", "");
    const date = typeof item.publishedAt === "string"
      ? new Date(item.publishedAt).toLocaleDateString(state.locale, {
          month: "short",
          day: "numeric"
        })
      : "";
    entry.append(
      createElement("strong", "", item.title),
      createElement("span", "", [item.publisher, date].filter(Boolean).join(" · "))
    );
    headlineList.append(entry);
  }
  if (!headlineList.children.length) {
    headlineList.append(createElement("li", "decision-empty", copy.noHeadlines));
  }
  context.append(headlineList);
  card.append(context);

  const optionSection = createElement("section", "decision-options");
  optionSection.append(createElement("h4", "", copy.compareActions));
  const optionTabs = createElement("div", "decision-option-tabs");
  optionTabs.setAttribute("role", "group");
  optionTabs.setAttribute("aria-label", copy.compareActions);
  const optionPanel = createElement("p", "decision-option-detail");
  optionPanel.setAttribute("role", "status");
  optionPanel.setAttribute("aria-live", "polite");
  const options = Array.isArray(assessment.options)
    ? assessment.options.filter(isRecord)
    : [];
  optionPanel.textContent = copy.choosePerspective;
  const selectOption = (option, button) => {
    for (const candidate of optionTabs.querySelectorAll("button")) {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    }
    optionPanel.textContent = `${copy.selected}: ${option.label}. ${option.detail}`;
  };
  for (const option of options) {
    if (
      typeof option.id !== "string" ||
      typeof option.label !== "string" ||
      typeof option.detail !== "string"
    ) continue;
    const button = createElement("button", "", option.label);
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectOption(option, button));
    optionTabs.append(button);
  }
  optionSection.append(optionTabs, optionPanel);
  card.append(optionSection);

  const validation = createElement("footer", "decision-validation");
  validation.append(
    createElement("span", "", "✓"),
    (() => {
      const text = createElement("div", "");
      text.append(
        createElement("strong", "", copy.verified),
        createElement("p", "", copy.disclaimer)
      );
      return text;
    })()
  );
  card.append(validation);
}

async function confirmOrderPreview(intentId, card, button) {
  const status = card.querySelector(".v3-order-status");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  status.textContent = t("confirmationPending");
  try {
    const handoff = await fetchWithV3Session((token) =>
      createV3OrderConfirmationRequest(token, intentId)
    );
    status.textContent = t("verificationPending");
    const orderScreen = await fetchWithV3Session((token) =>
      createV3OrderOpenRequest(token, handoff)
    );
    sessionStorage.setItem(ORDER_SCREEN_STATE_KEY, JSON.stringify(orderScreen));
    button.removeAttribute("aria-busy");
    const href = safeV3HandoffHref(orderScreen?.destination);
    status.replaceChildren(
      createElement(
        "span",
        "",
        t("handoffVerified")
      )
    );
    if (href) {
      const link = createElement(
        "a",
        "v3-order-link",
        t("openTicketReview")
      );
      link.href = href;
      status.append(link);
    }
    button.textContent = t("confirmed");
  } catch (error) {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    status.textContent = t("confirmationFailed");
    showToast(error.message);
  }
}

function renderOrderPreviewCard(card, data, confirmationAction) {
  const metrics = createElement("dl", "v3-card-metrics");
  appendCardMetric(metrics, t("instrument"), data.symbol || "—", true);
  appendCardMetric(metrics, t("side"), data.side || "—");
  appendCardMetric(metrics, t("requested"), formatCardMoney(data.requestedNotional, data.currency));
  appendCardMetric(metrics, t("previewPrice"), formatCardMoney(data.previewPrice, data.currency));
  appendCardMetric(metrics, t("estimatedFee"), formatCardMoney(data.estimatedCommission, data.currency));
  appendCardMetric(metrics, t("estimatedDebit"), formatCardMoney(data.estimatedDebit, data.currency), true);
  card.append(metrics);

  const notice = createElement(
    "p",
    "v3-order-notice",
    t("previewNotice")
  );
  card.append(notice);
  const status = createElement(
    "p",
    "v3-order-status",
    confirmationAction ? t("awaitingConfirmation") : t("confirmationUnavailable")
  );
  status.id = `order-status-${card.dataset.cardId}`;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  card.append(status);
  if (confirmationAction) {
    const button = createElement(
      "button",
      "v3-order-confirm",
      confirmationAction.label
    );
    button.type = "button";
    button.setAttribute("aria-describedby", status.id);
    button.addEventListener(
      "click",
      () => confirmOrderPreview(confirmationAction.intentId, card, button)
    );
    card.append(button);
  }
}

function renderPositionAnalysisCard(card, data) {
  const copy = state.locale === "az-AZ"
    ? {
        quantity: "Səhm sayı",
        purchasePrice: "Alış qiyməti",
        initialInvestment: "İlkin məbləğ",
        currentPrice: "Cari qiymət",
        currentValue: "Cari dəyər",
        return: "İlkin məbləğdən dəyişmə",
        boundary: "Mən daha çox almaq, saxlamaq və ya satmaq barədə tövsiyə verə bilmərəm.",
        perspectives: "Ümumi investor yanaşmaları",
        labels: {
          ADD_EXPOSURE: "Daha çox almaq",
          KEEP_EXPOSURE: "Saxlamaq",
          REDUCE_EXPOSURE: "Qismən və ya tam satmaq"
        },
        details: {
          ADD_EXPOSURE: "Mövqenin ölçüsünü və tək şirkət riskini artırar; yeni qiymət əvvəlki alış qiymətindən yüksəkdirsə, orta maya dəyəri də arta bilər.",
          KEEP_EXPOSURE: "Cari artım və eniş ekspozisiyasını saxlayar və mövcud nəticəni reallaşdırmaz.",
          REDUCE_EXPOSURE: "Mövqe riskini azaldar və nəticənin bir hissəsini və ya hamısını vergilər və xərclərdən əvvəl reallaşdırar."
        },
        disclaimer: "Bu müqayisə hipotetik rəqəmlər və indikativ bazar məlumatı əsasında hazırlanıb. Vergilər, xərclər, digər aktivlər və likvidlik ehtiyacları daxil deyil. Kapitalınız risk altındadır."
      }
    : {
        quantity: "Shares",
        purchasePrice: "Purchase price",
        initialInvestment: "Initial investment",
        currentPrice: "Current price",
        currentValue: "Current value",
        return: "Change from initial",
        boundary: "I can’t recommend whether you should buy more, hold, or sell.",
        perspectives: "Common investor perspectives",
        labels: {
          ADD_EXPOSURE: "Buying more",
          KEEP_EXPOSURE: "Holding",
          REDUCE_EXPOSURE: "Selling some or all"
        },
        details: {},
        disclaimer: "This comparison uses hypothetical inputs and indicative market data. Taxes, costs, other assets, and liquidity needs are not included. Your capital is at risk."
      };
  const metrics = createElement("dl", "v3-card-metrics position-analysis-metrics");
  appendCardMetric(metrics, copy.quantity, formatDecisionMetric(data.quantity));
  appendCardMetric(metrics, copy.purchasePrice, formatCardMoney(data.unitCost, data.currency));
  appendCardMetric(metrics, copy.initialInvestment, formatCardMoney(data.initialInvestment, data.currency));
  appendCardMetric(metrics, copy.currentPrice, formatCardMoney(data.currentPrice, data.currency));
  appendCardMetric(metrics, copy.currentValue, formatCardMoney(data.currentValue, data.currency), true);
  appendCardMetric(metrics, copy.return, formatCardPercent(data.returnRate, true), true);
  card.append(metrics);
  card.append(createElement("p", "position-analysis-boundary", copy.boundary));

  const section = createElement("section", "position-analysis-perspectives");
  section.append(createElement("h4", "", copy.perspectives));
  const list = createElement("div", "position-analysis-perspective-list");
  for (const candidate of Array.isArray(data.perspectives) ? data.perspectives : []) {
    if (!isRecord(candidate) || typeof candidate.id !== "string") continue;
    const item = createElement("article", "position-analysis-perspective");
    item.append(
      createElement(
        "strong",
        "",
        copy.labels[candidate.id] || candidate.label || candidate.id
      ),
      createElement(
        "p",
        "",
        copy.details[candidate.id] ||
          (typeof candidate.detail === "string" ? candidate.detail : "—")
      )
    );
    list.append(item);
  }
  section.append(list);
  card.append(section);
  card.append(createElement("p", "position-analysis-disclaimer", copy.disclaimer));
}

function renderAllocationAnalysisCard(card, data) {
  const copy = state.locale === "az-AZ"
    ? {
        totalValue: "Ümumi dəyər",
        largestPosition: "Ən böyük mövqe",
        topTwo: "İlk iki mövqe",
        technologyLinked: "Texnologiya ilə əlaqəli",
        cash: "Nağd vəsait",
        riskSignals: "Hesablanmış risk siqnalları",
        signalLabels: {
          SINGLE_COMPANY_CONCENTRATION: "Tək şirkət konsentrasiyası",
          TOP_TWO_CONCENTRATION: "İlk iki mövqenin konsentrasiyası",
          THEME_CORRELATION: "Tema korrelyasiyası",
          CASH_PURCHASING_POWER: "Nağd vəsaitin alıcılıq qabiliyyəti"
        },
        bandLabels: {
          low: "aşağı",
          moderate: "orta",
          elevated: "yüksək"
        }
      }
    : {
        totalValue: "Total value",
        largestPosition: "Largest position",
        topTwo: "Top two positions",
        technologyLinked: "Technology-linked",
        cash: "Cash",
        riskSignals: "Calculated risk signals",
        signalLabels: {
          SINGLE_COMPANY_CONCENTRATION: "Single-company concentration",
          TOP_TWO_CONCENTRATION: "Top-two concentration",
          THEME_CORRELATION: "Theme correlation",
          CASH_PURCHASING_POWER: "Cash purchasing power"
        },
        bandLabels: {
          low: "low",
          moderate: "moderate",
          elevated: "elevated"
        }
      };
  const metricsData = isRecord(data.metrics) ? data.metrics : {};
  const metrics = createElement("dl", "v3-card-metrics");
  if (data.totalValue !== undefined && data.totalValue !== null) {
    appendCardMetric(
      metrics,
      copy.totalValue,
      formatCardMoney(data.totalValue, data.currency),
      true
    );
  }
  if (typeof metricsData.largestPosition === "string") {
    appendCardMetric(
      metrics,
      copy.largestPosition,
      `${metricsData.largestPosition} · ${formatCardPercent(
        metricsData.largestAllocationRate
      )}`,
      true
    );
  }
  appendCardMetric(
    metrics,
    copy.topTwo,
    formatCardPercent(metricsData.topTwoAllocationRate)
  );
  appendCardMetric(
    metrics,
    copy.technologyLinked,
    formatCardPercent(metricsData.technologyAndTechnologyDependentRate)
  );
  appendCardMetric(
    metrics,
    copy.cash,
    formatCardPercent(metricsData.cashAllocationRate)
  );
  card.append(metrics);

  const list = createElement("div", "v3-allocation-list");
  for (const allocation of data.allocations) {
    if (!isRecord(allocation)) continue;
    const row = createElement("div", "v3-allocation-row");
    const label = createElement("div", "v3-allocation-label");
    const identity = typeof allocation.symbol === "string"
      ? allocation.symbol
      : copy.cash;
    label.append(createElement("strong", "", identity));
    if (allocation.amount !== null && allocation.amount !== undefined) {
      label.append(
        createElement(
          "span",
          "",
          formatCardMoney(allocation.amount, data.currency)
        )
      );
    }
    const rate = finiteDecimal(allocation.allocationRate) || 0;
    const bar = createElement("div", "v3-allocation-bar");
    const fill = createElement("i", "");
    fill.style.width = `${Math.min(100, Math.max(0, rate * 100))}%`;
    bar.append(fill);
    row.append(
      label,
      bar,
      createElement("span", "v3-allocation-value", formatCardPercent(rate))
    );
    list.append(row);
  }
  card.append(list);

  const signals = Array.isArray(data.riskSignals)
    ? data.riskSignals.filter(isRecord)
    : [];
  if (signals.length) {
    const section = createElement("section", "decision-options");
    section.append(createElement("h4", "", copy.riskSignals));
    const signalList = createElement("dl", "v3-card-metrics");
    for (const signal of signals) {
      const label = copy.signalLabels[signal.code] || signal.code;
      const band = copy.bandLabels[signal.band] || signal.band;
      appendCardMetric(
        signalList,
        label,
        `${formatCardPercent(signal.observedRate)} · ${band}`
      );
    }
    section.append(signalList);
    card.append(section);
  }
}

function renderTypedCard(cardData, actions) {
  const card = createElement("article", `v3-response-card v3-card-${cardData.kind}`);
  card.dataset.cardId = cardData.cardId;
  card.dataset.factRefs = cardData.factRefs.join(" ");
  card.setAttribute("aria-label", cardData.title);
  const heading = createElement("div", "v3-card-heading");
  heading.append(
    createElement("h3", "", cardData.title),
    createElement("span", "v3-card-kind", cardData.kind.replace("-", " "))
  );
  card.append(heading);
  const data = isRecord(cardData.data) ? cardData.data : {};

  if (cardData.kind === "order-preview") {
    renderOrderPreviewCard(
      card,
      data,
      v3OrderPreviewConfirmationAction(cardData, actions)
    );
    return card;
  }

  if (cardData.kind === "activity") {
    renderActivityCard(card, data);
    return card;
  }

  if (cardData.kind === "decision-support") {
    renderDecisionSupportCard(card, data);
    return card;
  }

  if (cardData.kind === "position-analysis") {
    renderPositionAnalysisCard(card, data);
    return card;
  }

  if (cardData.kind === "portfolio") {
    const metrics = createElement("dl", "v3-card-metrics");
    if (data.totalValue !== undefined && data.totalValue !== null) {
      appendCardMetric(metrics, "Total value", formatCardMoney(data.totalValue, data.currency), true);
    }
    if (data.positionsValue !== undefined && data.positionsValue !== null) {
      appendCardMetric(metrics, "Investments", formatCardMoney(data.positionsValue, data.currency));
    }
    if (data.cashValue !== undefined && data.cashValue !== null) {
      appendCardMetric(metrics, "Cash", formatCardMoney(data.cashValue, data.currency));
    }
    if (metrics.children.length) card.append(metrics);
    appendPositionRows(card, data.positions, data.currency || "USD");
    if (!metrics.children.length && !Array.isArray(data.positions)) appendGenericCardData(card, data);
    return card;
  }

  if (cardData.kind === "allocation" && Array.isArray(data.sectors)) {
    const list = createElement("div", "v3-allocation-list");
    for (const sector of data.sectors) {
      if (!isRecord(sector)) continue;
      const row = createElement("div", "v3-allocation-row");
      const label = createElement("div", "v3-allocation-label");
      const sectorLabel = state.locale === "az-AZ" && sector.sector === "Cash"
        ? "Nağd vəsait"
        : sector.sector || "Other";
      label.append(
        createElement("strong", "", sectorLabel),
        createElement("span", "", formatCardMoney(sector.marketValue, data.currency))
      );
      const rate = finiteDecimal(sector.totalPortfolioAllocationRate ?? sector.investedAllocationRate) || 0;
      const bar = createElement("div", "v3-allocation-bar");
      const fill = createElement("i", "");
      fill.style.width = `${Math.min(100, Math.max(0, rate * 100))}%`;
      bar.append(fill);
      row.append(label, bar, createElement("span", "v3-allocation-value", formatCardPercent(rate)));
      list.append(row);
    }
    card.append(list);
    return card;
  }

  if (cardData.kind === "allocation" && Array.isArray(data.allocations)) {
    renderAllocationAnalysisCard(card, data);
    return card;
  }

  if (cardData.kind === "research") {
    renderResearchCard(card, data);
    if (card.children.length === 1) {
      card.append(createElement("p", "v3-card-copy", "The requested research fields are currently unavailable."));
    }
    return card;
  }

  appendGenericCardData(card, data);
  appendPositionRows(card, data.positions || data.entries, data.currency || "USD");
  if (card.children.length === 1) {
    card.append(createElement("p", "v3-card-copy", "Structured details are unavailable."));
  }
  return card;
}

function attachV3Cards(messageElement, response) {
  if (!response.cards.length) return;
  messageElement.classList.add("with-v3-content");
  const section = createElement("section", "v3-response-cards");
  section.setAttribute("aria-label", "Assistant details");
  for (const card of response.cards) {
    section.append(renderTypedCard(card, response.actions));
  }
  messageElement.append(section);
}

function attachV3Citations(messageElement, response) {
  if (!response.citations.length) return;
  const details = createElement("details", "approved-knowledge-sources v3-citations");
  details.append(createElement(
    "summary",
    "approved-knowledge-sources-summary",
    `Sources (${response.citations.length})`
  ));
  const list = createElement("div", "approved-knowledge-citation-list");
  response.citations.forEach((citation, index) => {
    const item = createElement("article", "approved-knowledge-citation");
    const heading = createElement("div", "approved-knowledge-citation-heading");
    const href = safeV3CitationHref(citation.url);
    if (href) {
      const link = createElement("a", "approved-knowledge-citation-link", `[${index + 1}] ${citation.title}`);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      heading.append(link);
    } else {
      heading.append(createElement("span", "approved-knowledge-citation-title", `[${index + 1}] ${citation.title}`));
    }
    heading.append(createElement("span", "approved-knowledge-citation-type", "Source"));
    const dates = [
      citation.sourceAsOf ? `As of ${knowledgeEffectiveDate(citation.sourceAsOf, state.locale)}` : "",
      citation.effectiveFrom ? `Effective ${knowledgeEffectiveDate(citation.effectiveFrom, state.locale)}` : ""
    ].filter(Boolean).join(" · ");
    item.append(heading, createElement("p", "approved-knowledge-citation-metadata", dates || citation.sourceId));
    list.append(item);
  });
  details.append(list);
  messageElement.append(details);
}

function attachV3Actions(messageElement, response) {
  const actions = response.actions.filter((action) =>
    action?.kind === "open-in-app" ||
    action?.kind === "open-read-only-view"
  );
  if (!actions.length) return;
  const navigation = createElement("nav", "v3-response-actions");
  navigation.setAttribute("aria-label", "Assistant actions");
  for (const action of actions) {
    const readOnlyAction = action.kind === "open-read-only-view"
      ? v3ReadOnlyViewAction(response, action)
      : null;
    const href = readOnlyAction === null
      ? safeV3InAppHref(action.href)
      : safeV3ReadOnlyHref(readOnlyAction.href);
    if (!href) continue;
    const link = createElement("a", "v3-order-link v3-in-app-action", action.label);
    link.href = href;
    if (readOnlyAction !== null) {
      link.addEventListener("click", (event) => {
        const reviewed = v3ReadOnlyViewAction(response, readOnlyAction);
        const safeHref = safeV3ReadOnlyHref(reviewed?.href);
        if (reviewed === null || safeHref === null) {
          event.preventDefault();
          return;
        }
        const cardData = response.cards.find((card) =>
          card.kind === ({
            "investments.portfolio.overview": "portfolio",
            "investments.portfolio.cash": "portfolio",
            "investments.portfolio.activity": "activity",
            "investments.instrument.overview": "market"
          })[reviewed.target] &&
          card.factRefs.length === 1 &&
          card.factRefs[0] === reviewed.factRefs[0]
        );
        const card = [...messageElement.querySelectorAll(".v3-response-card")]
          .find((candidate) => candidate.dataset.cardId === cardData?.cardId);
        if (!card) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        history.pushState(
          {
            assistantReadOnlyView: true,
            factRef: reviewed.factRefs[0],
            cardId: cardData.cardId
          },
          "",
          safeHref
        );
        renderReadOnlyInAppDestination();
        card.tabIndex = -1;
        card.focus({ preventScroll: true });
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    navigation.append(link);
  }
  if (navigation.children.length) messageElement.append(navigation);
}

const READ_ONLY_DESTINATION_COPY = Object.freeze({
  "/investments/portfolio": Object.freeze({
    "en-US": Object.freeze({
      title: "Portfolio overview",
      summary: "Open this view from a verified portfolio answer to focus its signed details."
    }),
    "az-AZ": Object.freeze({
      title: "Portfel icmalı",
      summary: "İmzalanmış məlumatlara keçmək üçün bu görünüşü təsdiqlənmiş portfel cavabından açın."
    })
  }),
  "/investments/portfolio/cash": Object.freeze({
    "en-US": Object.freeze({
      title: "Cash details",
      summary: "Open this view from a verified cash-balance answer to focus its signed details."
    }),
    "az-AZ": Object.freeze({
      title: "Nağd vəsait məlumatı",
      summary: "İmzalanmış məlumatlara keçmək üçün bu görünüşü təsdiqlənmiş nağd balans cavabından açın."
    })
  }),
  "/investments/activity": Object.freeze({
    "en-US": Object.freeze({
      title: "Recent activity",
      summary: "Open this view from a verified activity answer to focus its signed records."
    }),
    "az-AZ": Object.freeze({
      title: "Son əməliyyatlar",
      summary: "İmzalanmış qeydlərə keçmək üçün bu görünüşü təsdiqlənmiş əməliyyat cavabından açın."
    })
  }),
  "/investments/instruments": Object.freeze({
    "en-US": Object.freeze({
      title: "Instrument overview",
      summary: "Open this view from a verified market answer to focus its signed instrument details."
    }),
    "az-AZ": Object.freeze({
      title: "Alət icmalı",
      summary: "İmzalanmış məlumatlara keçmək üçün bu görünüşü təsdiqlənmiş bazar cavabından açın."
    })
  })
});

function renderReadOnlyInAppDestination() {
  const existing = byId("v3-read-only-destination");
  const location = globalThis.location;
  const candidatePath =
    location?.search === "" && location?.hash === "" ? location.pathname : null;
  const safePath = safeV3ReadOnlyHref(candidatePath);
  if (safePath === null) {
    existing?.remove();
    return;
  }
  const stateEntry = history.state;
  if (
    stateEntry?.assistantReadOnlyView === true &&
    typeof stateEntry.cardId === "string" &&
    [...document.querySelectorAll(".v3-response-card")]
      .some((card) => card.dataset.cardId === stateEntry.cardId)
  ) {
    existing?.remove();
    return;
  }
  const main = document.querySelector("main");
  if (!main) return;
  const copy = READ_ONLY_DESTINATION_COPY[safePath]?.[state.locale];
  if (!copy) return;
  const destination = createElement(
    "section",
    "v3-in-app-destination surface-card",
  );
  destination.id = "v3-read-only-destination";
  destination.setAttribute("aria-labelledby", "read-only-destination-title");
  const title = createElement("h1", "", copy.title);
  title.id = "read-only-destination-title";
  destination.append(
    createElement(
      "p",
      "eyebrow",
      state.locale === "az-AZ"
        ? "Yalnız baxış üçün · əməliyyat yoxdur"
        : "Read-only · no action started"
    ),
    title,
    createElement("p", "v3-in-app-destination-summary", copy.summary),
    (() => {
      const link = createElement(
        "a",
        "text-button v3-in-app-return",
        state.locale === "az-AZ"
          ? "Portfel panelinə qayıt"
          : "Return to portfolio dashboard"
      );
      link.href = "/";
      return link;
    })()
  );
  existing?.remove();
  main.prepend(destination);
}

function renderGovernedInAppDestination() {
  const existing = byId("v3-in-app-destination");
  if (state.productProfile !== "demo-invest") {
    existing?.remove();
    return;
  }
  const location = globalThis.location;
  const candidatePath =
    location?.search === "" && location?.hash === "" ? location.pathname : null;
  const guide = v3InAppDestination(candidatePath, state.locale);
  if (!guide) {
    existing?.remove();
    return;
  }
  const main = document.querySelector("main");
  if (!main) return;
  const destination = createElement("section", "v3-in-app-destination surface-card");
  destination.id = "v3-in-app-destination";
  destination.setAttribute("aria-labelledby", "in-app-destination-title");
  destination.setAttribute("aria-describedby", "in-app-destination-summary");
  const header = createElement("div", "v3-in-app-destination-header");
  const copy = createElement("div", "v3-in-app-destination-copy");
  const heading = createElement(
    "h1",
    "",
    guide.title
  );
  heading.id = "in-app-destination-title";
  const summary = createElement("p", "v3-in-app-destination-summary", guide.summary);
  summary.id = "in-app-destination-summary";
  copy.append(
    createElement("p", "eyebrow", guide.eyebrow),
    heading,
    summary
  );
  const back = createElement(
    "a",
    "text-button v3-in-app-return",
    state.locale === "az-AZ" ? "Portfel panelinə qayıt" : "Return to portfolio dashboard"
  );
  back.href = "/";
  header.append(copy, back);

  const body = createElement("div", "v3-in-app-destination-body");
  const stepHeading = createElement(
    "h2",
    "",
    state.locale === "az-AZ" ? "İzlənəcək addımlar" : "Steps to follow"
  );
  const steps = createElement("ol", "v3-in-app-destination-steps");
  for (const step of guide.steps) {
    steps.append(createElement("li", "", step));
  }
  const notice = createElement("p", "v3-in-app-destination-notice", guide.notice);
  const source = createElement("div", "v3-in-app-destination-source");
  const sourceHref = safeV3CitationHref(guide.sourceUrl);
  if (sourceHref) {
    const sourceLink = createElement("a", "text-button", guide.sourceLabel);
    sourceLink.href = sourceHref;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    sourceLink.referrerPolicy = "no-referrer";
    source.append(sourceLink);
  }
  source.append(createElement(
    "span",
    "",
    state.locale === "az-AZ"
      ? `Mənbə ${knowledgeEffectiveDate(guide.sourceAsOf, state.locale)} tarixində nəzərdən keçirilib`
      : `Source reviewed ${knowledgeEffectiveDate(guide.sourceAsOf, state.locale)}`
  ));
  body.append(stepHeading, steps, notice, source);
  destination.append(header, body);
  if (existing) existing.replaceWith(destination);
  else main.prepend(destination);
  document.title = `${guide.title} — ${state.branding.productName}`;
}

function setRangeControls(card, selectedRange, disabled = false) {
  for (const button of card.querySelectorAll(".market-chart-ranges button")) {
    const selected = button.dataset.range === selectedRange;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = disabled || (card.dataset.embedded === "true" && !selected);
  }
}

function setHistoryStatus(card, type, message, retry) {
  const status = card.querySelector(".market-chart-status");
  status.replaceChildren();
  status.className = `market-chart-status ${type}`;
  status.hidden = false;
  status.append(createElement("p", "", message));
  if (retry) {
    const button = createElement("button", "market-chart-retry", "Try again");
    button.type = "button";
    button.addEventListener("click", retry, { once: true });
    status.append(button);
  }
}

function normalizeHistory(payload) {
  const points = (Array.isArray(payload?.points) ? payload.points : [])
    .map((point) => ({
      timestamp: new Date(point.timestamp).getTime(),
      close: Number(point.close)
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.close))
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((point, index, values) => index === 0 || point.timestamp !== values[index - 1].timestamp);

  return {
    ...payload,
    symbol: normalizeChartSymbol(payload?.symbol),
    points
  };
}

function nearestPointIndex(points, targetTime) {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].timestamp < targetTime) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  const previous = points[low - 1];
  const current = points[low];
  return targetTime - previous.timestamp <= current.timestamp - targetTime ? low - 1 : low;
}

function positionChartTooltip(card, index) {
  const canvas = card.querySelector("canvas");
  const tooltip = card.querySelector(".market-chart-tooltip");
  const chart = canvas.chartData;
  const geometry = canvas.chartGeometry;
  if (!chart || !geometry || index === null || !chart.points[index]) {
    tooltip.hidden = true;
    return;
  }

  const point = chart.points[index];
  const x = geometry.xFor(point.timestamp);
  const y = geometry.yFor(point.close);
  tooltip.replaceChildren(
    createElement("strong", "", chart.price.format(point.close)),
    createElement("span", "", historyDateFormatter(chart.range, true).format(point.timestamp))
  );
  tooltip.hidden = false;
  const tooltipWidth = tooltip.offsetWidth || 110;
  const left = Math.min(
    Math.max(x - tooltipWidth / 2, 6),
    Math.max(6, canvas.clientWidth - tooltipWidth - 6)
  );
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(4, y - 58)}px`;
}

function drawHistoricalChart(card) {
  const canvas = card.querySelector("canvas");
  const chart = canvas.chartData;
  if (!chart || canvas.hidden || !chart.points.length) return;

  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(188, Math.floor(canvas.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);

  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const chartStyles = getComputedStyle(card);
  const lineColor = chartStyles.getPropertyValue("--chart-line").trim() || "#79f2a7";
  const positiveColor = chartStyles.getPropertyValue("--chart-positive").trim() || "#79f2a7";
  const negativeColor = chartStyles.getPropertyValue("--chart-negative").trim() || "#ff8c8c";
  const mutedColor = chartStyles.getPropertyValue("--chart-muted").trim() || "#aebbb5";
  const gridColor = chartStyles.getPropertyValue("--chart-grid").trim() || "rgba(255, 255, 255, 0.12)";
  const { points } = chart;
  const prices = points.map((point) => point.close);
  let minimum = Math.min(...prices);
  let maximum = Math.max(...prices);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.02, 1);
    minimum -= padding;
    maximum += padding;
  } else {
    const padding = (maximum - minimum) * 0.08;
    minimum -= padding;
    maximum += padding;
  }

  const startTime = points[0].timestamp;
  const endTime = points.at(-1).timestamp;
  const timeSpan = Math.max(1, endTime - startTime);
  const left = 8;
  const right = width - 51;
  const top = 15;
  const bottom = height - 29;
  const plotWidth = Math.max(1, right - left);
  const plotHeight = Math.max(1, bottom - top);
  const xFor = (timestamp) => left + ((timestamp - startTime) / timeSpan) * plotWidth;
  const yFor = (price) => bottom - ((price - minimum) / (maximum - minimum)) * plotHeight;
  const axisPrice = priceFormatter(chart.currency, true);

  context.font = '500 10px "DM Sans", sans-serif';
  context.fillStyle = mutedColor;
  context.strokeStyle = gridColor;
  context.lineWidth = 1;
  context.setLineDash([2, 5]);
  for (const fraction of [0, 0.5, 1]) {
    const y = top + fraction * plotHeight;
    const value = maximum - fraction * (maximum - minimum);
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.textAlign = "left";
    context.fillText(axisPrice.format(value), right + 7, y + 3);
  }

  const lastPriceY = yFor(points.at(-1).close);
  context.strokeStyle = lineColor;
  context.globalAlpha = 0.32;
  context.beginPath();
  context.moveTo(left, lastPriceY);
  context.lineTo(right, lastPriceY);
  context.stroke();
  context.globalAlpha = 1;
  context.setLineDash([]);

  context.strokeStyle = lineColor;
  context.lineWidth = 2.3;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  points.forEach((point, index) => {
    const x = xFor(point.timestamp);
    const y = yFor(point.close);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  const dateFormatter = historyDateFormatter(chart.range);
  context.fillStyle = mutedColor;
  context.font = '500 10px "DM Sans", sans-serif';
  context.textAlign = "left";
  context.fillText(dateFormatter.format(startTime), left, height - 7);
  context.textAlign = "right";
  context.fillText(dateFormatter.format(endTime), right, height - 7);

  canvas.chartGeometry = { left, right, top, bottom, startTime, timeSpan, xFor, yFor };
  if (Number.isInteger(canvas.activePointIndex)) {
    const point = points[canvas.activePointIndex];
    if (point) {
      const x = xFor(point.timestamp);
      const y = yFor(point.close);
      context.strokeStyle = mutedColor;
      context.globalAlpha = 0.45;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      context.globalAlpha = 1;
      context.fillStyle = points.at(-1).close >= points[0].close ? positiveColor : negativeColor;
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.beginPath();
      context.arc(x, y, 1.7, 0, Math.PI * 2);
      context.fill();
    }
  }
  positionChartTooltip(card, canvas.activePointIndex ?? null);
}

function initializeChartInteractions(card) {
  const canvas = card.querySelector("canvas");
  const selectAtClientX = (clientX) => {
    const chart = canvas.chartData;
    const geometry = canvas.chartGeometry;
    if (!chart || !geometry) return;
    const bounds = canvas.getBoundingClientRect();
    const chartX = Math.min(Math.max(clientX - bounds.left, geometry.left), geometry.right);
    const targetTime = geometry.startTime + ((chartX - geometry.left) / (geometry.right - geometry.left)) * geometry.timeSpan;
    canvas.activePointIndex = nearestPointIndex(chart.points, targetTime);
    drawHistoricalChart(card);
  };

  canvas.addEventListener("pointermove", (event) => selectAtClientX(event.clientX));
  canvas.addEventListener("pointerdown", (event) => {
    canvas.focus({ preventScroll: true });
    selectAtClientX(event.clientX);
  });
  canvas.addEventListener("pointerleave", () => {
    if (document.activeElement === canvas) return;
    canvas.activePointIndex = null;
    drawHistoricalChart(card);
  });
  canvas.addEventListener("focus", () => {
    if (canvas.chartData && !Number.isInteger(canvas.activePointIndex)) {
      canvas.activePointIndex = canvas.chartData.points.length - 1;
      drawHistoricalChart(card);
    }
  });
  canvas.addEventListener("blur", () => {
    canvas.activePointIndex = null;
    drawHistoricalChart(card);
  });
  canvas.addEventListener("keydown", (event) => {
    const chart = canvas.chartData;
    if (!chart) return;
    let index = Number.isInteger(canvas.activePointIndex)
      ? canvas.activePointIndex
      : chart.points.length - 1;
    if (event.key === "ArrowLeft") index = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") index = Math.min(chart.points.length - 1, index + 1);
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = chart.points.length - 1;
    else return;
    event.preventDefault();
    canvas.activePointIndex = index;
    drawHistoricalChart(card);
  });

  if ("ResizeObserver" in window) {
    canvas.chartResizeObserver = new ResizeObserver(() => drawHistoricalChart(card));
    canvas.chartResizeObserver.observe(canvas);
  } else {
    window.addEventListener("resize", () => drawHistoricalChart(card));
  }
}

function renderHistory(card, payload, requestedRange) {
  const history = normalizeHistory(payload);
  const range = HISTORY_RANGES.some((item) => item.value === history.range)
    ? history.range
    : requestedRange;
  const price = priceFormatter(history.currency);
  const canvas = card.querySelector("canvas");
  const status = card.querySelector(".market-chart-status");
  const latestValue = card.querySelector(".market-chart-value");
  const changeValue = card.querySelector(".market-chart-change");
  const source = card.querySelector(".market-chart-source");

  setRangeControls(card, range);
  card.setAttribute("aria-busy", "false");
  if (!history.points.length) {
    canvas.hidden = true;
    latestValue.textContent = "—";
    changeValue.textContent = "No change available";
    changeValue.className = "market-chart-change";
    source.textContent = history.source || "No source returned";
    setHistoryStatus(card, "empty", `No ${range.toUpperCase()} history is available for ${card.dataset.symbol}.`);
    return;
  }

  const first = history.points[0];
  const latest = history.points.at(-1);
  const change = latest.close - first.close;
  const changePercent = first.close === 0 ? null : (change / first.close) * 100;
  const directionClass = change > 0 ? "positive" : change < 0 ? "negative" : "";
  const direction = change >= 0 ? "+" : "−";
  const rangeLabel = HISTORY_RANGES.find((item) => item.value === range)?.label || range.toUpperCase();
  const asOf = history.asOf || new Date(latest.timestamp).toISOString();

  card.querySelector(".market-chart-name").textContent =
    history.displayName || card.dataset.displayName || card.dataset.symbol;
  card.querySelector(".market-chart-symbol").textContent = card.dataset.symbol;
  card.querySelector(".market-chart-badge").textContent = history.exchange || "Historical prices";
  latestValue.textContent = price.format(latest.close);
  changeValue.textContent = `${direction}${price.format(Math.abs(change))}${changePercent === null ? "" : ` (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)`} · ${rangeLabel}`;
  changeValue.className = `market-chart-change ${directionClass}`.trim();
  source.textContent = `${history.source || "Market history provider"} · As of ${new Date(asOf).toLocaleString()}`;
  card.querySelector(".market-chart-summary").textContent = `${card.dataset.symbol} latest price ${price.format(latest.close)}. ${rangeLabel} change ${changeValue.textContent}. Use the arrow keys on the chart to inspect historical prices.`;

  status.hidden = true;
  canvas.hidden = false;
  canvas.activePointIndex = null;
  canvas.chartData = {
    points: history.points,
    currency: history.currency || "USD",
    price,
    range
  };
  canvas.setAttribute(
    "aria-label",
    `${card.dataset.symbol} ${rangeLabel} closing-price chart, from ${price.format(first.close)} to ${price.format(latest.close)}. Focus and use left or right arrow keys to inspect points.`
  );
  drawHistoricalChart(card);
}

async function loadHistory(card, range) {
  const symbol = card.dataset.symbol;
  const cacheKey = `${symbol}:${range}`;
  const requestId = `${Date.now()}:${Math.random()}`;
  card.historyRequestId = requestId;
  card.setAttribute("aria-busy", "true");
  setRangeControls(card, range, true);
  card.querySelector("canvas").activePointIndex = null;
  card.querySelector(".market-chart-tooltip").hidden = true;
  setHistoryStatus(card, "loading", `Loading ${range.toUpperCase()} market history…`);

  try {
    const cached = state.historyCache.get(cacheKey);
    const history = cached && Date.now() - cached.fetchedAt < 60_000
      ? cached.payload
      : await fetchJson(`/api/market/${encodeURIComponent(symbol)}/history?range=${encodeURIComponent(range)}`);
    if (card.historyRequestId !== requestId) return;
    state.historyCache.delete(cacheKey);
    state.historyCache.set(cacheKey, { payload: history, fetchedAt: Date.now() });
    while (state.historyCache.size > 64) {
      const oldestKey = state.historyCache.keys().next().value;
      if (oldestKey === undefined) break;
      state.historyCache.delete(oldestKey);
    }
    renderHistory(card, history, range);
  } catch (error) {
    if (card.historyRequestId !== requestId) return;
    card.setAttribute("aria-busy", "false");
    setRangeControls(card, range);
    card.querySelector("canvas").hidden = true;
    setHistoryStatus(
      card,
      "error",
      error.message || `Unable to load ${symbol} history.`,
      () => loadHistory(card, range)
    );
  }
}

function createHistoryCard(symbol, initialRange, displayName, initialPayload = null) {
  const card = createElement("article", "market-chart-card");
  card.dataset.symbol = symbol;
  card.dataset.embedded = String(Boolean(initialPayload));
  if (displayName) card.dataset.displayName = displayName;
  card.setAttribute("aria-busy", "true");

  const heading = createElement("div", "market-chart-heading");
  const identity = createElement("div", "market-chart-identity");
  identity.append(
    createElement("span", "market-chart-symbol", symbol),
    createElement("h3", "market-chart-name", displayName || symbol)
  );
  const liveBadge = createElement("span", "market-chart-badge", "Historical prices");
  heading.append(identity, liveBadge);

  const metrics = createElement("div", "market-chart-metrics");
  metrics.append(
    createElement("span", "market-chart-value-label", "Latest close"),
    createElement("strong", "market-chart-value", "—"),
    createElement("span", "market-chart-change", "Loading change…")
  );

  const plot = createElement("div", "market-chart-plot");
  const canvas = document.createElement("canvas");
  canvas.hidden = true;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${symbol} historical price chart loading`);
  const tooltip = createElement("div", "market-chart-tooltip");
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  tooltip.setAttribute("aria-live", "polite");
  const status = createElement("div", "market-chart-status loading");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  plot.append(canvas, tooltip, status);

  const ranges = createElement("div", "market-chart-ranges");
  ranges.setAttribute("role", "group");
  ranges.setAttribute("aria-label", `${symbol} chart time range`);
  for (const item of HISTORY_RANGES) {
    const button = createElement("button", "", item.label);
    button.type = "button";
    button.dataset.range = item.value;
    button.setAttribute("aria-pressed", "false");
    if (!initialPayload) button.addEventListener("click", () => loadHistory(card, item.value));
    ranges.append(button);
  }

  const source = createElement("p", "market-chart-source", "Waiting for market history source…");
  const summary = createElement("p", "sr-only market-chart-summary", `${symbol} historical chart loading.`);
  card.append(heading, metrics, plot, ranges, source, summary);
  initializeChartInteractions(card);
  if (initialPayload) renderHistory(card, initialPayload, initialRange);
  else loadHistory(card, initialRange);
  return card;
}

function attachV3PriceHistoryCharts(messageElement, response) {
  const charts = v3PriceHistoryCharts(response);
  if (!charts.length) return;
  messageElement.classList.add("with-market-chart");
  const section = createElement("section", "market-chart-list");
  section.setAttribute("aria-label", "Historical market price charts");
  for (const chart of charts) {
    section.append(createHistoryCard(
      normalizeChartSymbol(chart.symbol),
      chart.range,
      chart.symbol,
      chart
    ));
  }
  messageElement.append(section);
  requestAnimationFrame(() => {
    for (const card of section.querySelectorAll(".market-chart-card")) drawHistoricalChart(card);
  });
}

function v3ResponseMeta(response) {
  const fresh = response.freshness.find((item) => item && typeof item.asOf === "string");
  if (fresh) {
    const date = new Date(fresh.asOf);
    const timestamp = Number.isNaN(date.getTime())
      ? (state.locale === "az-AZ" ? "cari sübut" : "current evidence")
      : date.toLocaleString(state.locale);
    const statusLabels = state.locale === "az-AZ"
      ? {
          live: "Canlı məlumat",
          delayed: "Gecikmiş məlumat",
          indicative: "İndikativ məlumat",
          stale: "Köhnəlmiş məlumat",
          "document-effective": "Yoxlanılmış məlumat"
        }
      : {
          live: "Live data",
          delayed: "Delayed data",
          indicative: "Indicative data",
          stale: "Stale data",
          "document-effective": "Reviewed information"
        };
    return `${statusLabels[fresh.status] || (state.locale === "az-AZ" ? "Cari məlumat" : "Current information")} · ${timestamp}`;
  }
  if (response.status === "partial") {
    return state.locale === "az-AZ"
      ? "Qismən cavab · yalnız mövcud sübut"
      : "Partial answer · available evidence only";
  }
  if (response.status === "unavailable") {
    return state.locale === "az-AZ" ? "Sübut mövcud deyil" : "Evidence unavailable";
  }
  if (response.status === "clarification-required") {
    return state.locale === "az-AZ" ? "Əlavə məlumat lazımdır" : "More detail needed";
  }
  return null;
}

function v3ChatText(response) {
  const sections = [response.message || t("noAnswer")];
  const guidePaths = new Set();
  for (const action of response.actions) {
    if (action?.kind !== "open-in-app" || guidePaths.has(action.href)) continue;
    const guide = v3InAppDestination(action.href, state.locale);
    if (!guide) continue;
    guidePaths.add(action.href);
    sections.push([
      guide.title,
      guide.summary,
      ...guide.steps.map((step, index) => `${index + 1}. ${step}`),
      guide.notice,
      `${guide.sourceLabel}: ${guide.sourceUrl}`
    ].join("\n"));
  }

  const notices = [...new Set(
    response.notices
      .filter((notice) => typeof notice === "string" && notice.trim())
      .map((notice) => notice.trim())
  )];
  if (notices.length) {
    const heading = state.locale === "az-AZ"
      ? "Məlumat və məhdudiyyətlər:"
      : "Data and limitations:";
    sections.push(`${heading}\n${notices.map((notice) => `- ${notice}`).join("\n")}`);
  }

  const citations = response.citations
    .map((citation) => {
      const href = safeV3CitationHref(citation.url);
      return href ? `${citation.title}: ${href}` : citation.title;
    })
    .filter(Boolean);
  if (citations.length) {
    const heading = state.locale === "az-AZ" ? "Mənbələr:" : "Sources:";
    sections.push(`${heading}\n${citations.map((citation) => `- ${citation}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

function revealAssistantResponse(messageElement) {
  requestAnimationFrame(() => {
    const messages = byId("messages");
    const offset =
      messageElement.getBoundingClientRect().top -
      messages.getBoundingClientRect().top;
    messages.scrollTop += offset;
  });
}

function renderV3AssistantResponse(response) {
  if (response.deliveryGate === "blocked") {
    return addMessage(
      t("requestBlocked"),
      "assistant",
      t("responseWithheld")
    );
  }
  const message = v3ChatText(response);
  const element = addMessage(message, "assistant", v3ResponseMeta(response));
  attachV3PriceHistoryCharts(element, response);
  revealAssistantResponse(element);
  return element;
}

async function sendMessage(message) {
  if (state.loading || !message.trim()) return;
  state.loading = true;
  setLocaleControls(false);
  const input = byId("message-input");
  const submit = byId("chat-form").querySelector("button");
  input.value = "";
  resizeMessageInput(input);
  input.disabled = true;
  submit.disabled = true;
  addMessage(message.trim(), "user");
  const typing = addTyping();

  try {
    const payload = await fetchWithV3Session((token) =>
      createV3MessageRequest(token, message)
    );
    const result = normalizeV3AssistantResponse(payload);
    typing.remove();
    renderV3AssistantResponse(result);
  } catch (error) {
    typing.remove();
    addMessage(t("requestFailed"), "assistant", t("serviceError"));
    showToast(error.message);
  } finally {
    state.loading = false;
    setLocaleControls(true);
    setAssistantControls(Boolean(state.sessionToken));
    if (state.sessionToken) input.focus();
  }
}

let toastTimer;
function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

async function loadDashboard(showFeedback = false) {
  const refreshButton = byId("refresh-button");
  refreshButton.classList.add("loading");
  if (!state.sessionToken) {
    initializeAssistantSession().catch((error) => showToast(error.message));
  }
  try {
    const data = await fetchJson("/api/bootstrap");
    state.productProfile =
      data.productProfile === "generic" ? "generic" : "demo-invest";
    state.branding = normalizePublicBranding(data.branding);
    state.client = data.client;
    state.capabilities = data.capabilities;
    applyLocale();
    renderGovernedInAppDestination();
    renderClient(data.client);
    renderPortfolio(data.portfolio);
    startPortfolioStream();
    if (showFeedback) showToast(t("snapshotsLoaded"));
  } catch (error) {
    byId("market-label").textContent = t("marketServiceUnavailable");
    byId("market-time").textContent = t("tryAgain");
    showToast(error.message);
  } finally {
    refreshButton.classList.remove("loading");
  }
}

function startPortfolioStream() {
  if (state.portfolioStream) return;

  const stream = new EventSource("/api/portfolio/stream");
  state.portfolioStream = stream;

  stream.addEventListener("portfolio", (event) => {
    try {
      renderPortfolio(JSON.parse(event.data));
    } catch {
      showToast(t("updateUnreadable"));
    }
  });

  stream.addEventListener("warning", (event) => {
    const warning = JSON.parse(event.data);
    byId("market-label").textContent = t("updateDelayed");
    if (warning.message) showToast(warning.message);
  });

  stream.onerror = () => {
    byId("market-label").textContent = t("reconnecting");
  };
}

byId("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(byId("message-input").value);
});

byId("message-input").addEventListener("input", (event) => {
  resizeMessageInput(event.currentTarget);
});

byId("message-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    byId("chat-form").requestSubmit();
  }
});

byId("suggestions").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (button) sendMessage(button.dataset.prompt);
});

byId("locale-selector").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-locale]");
  if (button) changeLocale(button.dataset.locale);
});

byId("refresh-button").addEventListener("click", () => loadDashboard(true));
byId("market-refresh").addEventListener("click", () => loadDashboard(true));
globalThis.addEventListener("popstate", () => {
  renderGovernedInAppDestination();
  renderReadOnlyInAppDestination();
});

applyLocale();
resizeMessageInput(byId("message-input"));
setAssistantControls(false);
renderGovernedInAppDestination();
renderReadOnlyInAppDestination();
initializeAssistantSession().catch((error) => showToast(error.message));
loadDashboard();
