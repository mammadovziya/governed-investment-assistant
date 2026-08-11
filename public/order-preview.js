const STORAGE_KEY = "invest-assistant-v3.order-screen-state";
const LOCALE_STORAGE_KEY = "invest-assistant-v3.locale";
const SUPPORTED_LOCALES = new Set(["en-US", "az-AZ"]);
const DEFAULT_BRANDING = Object.freeze({
  name: "Invest Assistant",
  productName: "Demo Invest"
});
const REQUIRED_CHECKS = new Set([
  "live-price",
  "fees",
  "available-balance",
  "disclosures",
  "eligibility",
  "final-confirmation"
]);

const COPY = {
  "en-US": {
    pageTitle: "Order ticket review · {brandName}",
    language: "Language",
    useEnglish: "Use English",
    useAzerbaijani: "Use Azerbaijani",
    back: "← Back to assistant",
    eyebrow: "READ-ONLY INTERNAL PILOT",
    title: "Order ticket review",
    loading: "Loading the verified handoff…",
    instrument: "Instrument",
    side: "Side",
    amount: "Requested amount",
    expires: "Handoff expires",
    required: "Required before a real order",
    warning: "The external {productName} order screen is not integrated. This pilot has verified and consumed the one-use handoff, but it cannot submit an order.",
    submissionUnavailable: "Order submission unavailable",
    invalid: "No valid one-use order handoff is available. Return to the assistant and create a new preview.",
    verified: "The signed one-use handoff was verified and consumed.",
    pending: "pending external integration",
    buy: "Buy",
    checks: {
      "live-price": "Refresh the executable market price",
      fees: "Recalculate all applicable fees",
      "available-balance": "Recheck available cash and FX",
      disclosures: "Confirm current disclosures",
      eligibility: "Recheck account and instrument eligibility",
      "final-confirmation": "Collect final authenticated confirmation"
    }
  },
  "az-AZ": {
    pageTitle: "Alış biletinə baxış · {brandName}",
    language: "Dil",
    useEnglish: "İngilis dilini seç",
    useAzerbaijani: "Azərbaycan dilini seç",
    back: "← Köməkçiyə qayıt",
    eyebrow: "YALNIZ BAXIŞ ÜÇÜN DAXİLİ PİLOT",
    title: "Alış biletinə baxış",
    loading: "Təsdiqlənmiş keçid yüklənir…",
    instrument: "Alət",
    side: "İstiqamət",
    amount: "Sorğu məbləği",
    expires: "Keçidin bitmə vaxtı",
    required: "Real sifarişdən əvvəl tələb olunur",
    warning: "Xarici {productName} sifariş ekranı inteqrasiya edilməyib. Bu pilot birdəfəlik keçidi yoxlayıb istifadə edib, lakin sifariş göndərə bilməz.",
    submissionUnavailable: "Sifariş göndərmək mümkün deyil",
    invalid: "Etibarlı birdəfəlik sifariş keçidi yoxdur. Köməkçiyə qayıdın və yeni ilkin baxış yaradın.",
    verified: "İmzalanmış birdəfəlik keçid yoxlanıldı və istifadə edildi.",
    pending: "xarici inteqrasiya gözlənilir",
    buy: "Alış",
    checks: {
      "live-price": "İcra edilə bilən bazar qiymətini yenilə",
      fees: "Bütün tətbiq olunan komissiyaları yenidən hesabla",
      "available-balance": "Mövcud vəsaiti və valyuta çevrilməsini yenidən yoxla",
      disclosures: "Cari açıqlamaları təsdiqlə",
      eligibility: "Hesab və alət uyğunluğunu yenidən yoxla",
      "final-confirmation": "Son autentifikasiyalı təsdiqi al"
    }
  }
};

function byId(id) {
  return document.getElementById(id);
}

function readLocale() {
  try {
    const value = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (SUPPORTED_LOCALES.has(value)) return value;
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
  return document.documentElement.lang.toLowerCase().startsWith("az") ? "az-AZ" : "en-US";
}

function persistLocale(value) {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    // Keep the selected locale for this page even if persistence is blocked.
  }
}

let locale = readLocale();
let orderState = null;
let branding = DEFAULT_BRANDING;

function formatCopy(value) {
  if (typeof value !== "string") return "";
  return value
    .replaceAll("{brandName}", branding.name)
    .replaceAll("{productName}", branding.productName);
}

function validBranding(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.name === "string" &&
    value.name.length >= 1 &&
    value.name.length <= 60 &&
    typeof value.productName === "string" &&
    value.productName.length >= 1 &&
    value.productName.length <= 80 &&
    !/[\u0000-\u001F\u007F<>]/u.test(`${value.name}${value.productName}`)
  );
}

function applyLocale() {
  const copy = COPY[locale];
  document.documentElement.lang = locale === "az-AZ" ? "az" : "en";
  document.title = formatCopy(copy.pageTitle);
  for (const element of document.querySelectorAll("[data-order-i18n]")) {
    const value = copy[element.dataset.orderI18n];
    if (typeof value === "string") element.textContent = formatCopy(value);
  }

  const selector = byId("order-locale-selector");
  selector.setAttribute("aria-label", copy.language);
  for (const button of selector.querySelectorAll("button[data-locale]")) {
    const selected = button.dataset.locale === locale;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute(
      "aria-label",
      button.dataset.locale === "az-AZ" ? copy.useAzerbaijani : copy.useEnglish
    );
  }
}

function validState(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.schemaVersion === "assistant-v3.order-screen-state.v1" &&
    value.status === "external-order-screen-not-integrated" &&
    value.destination === "/orders/preview" &&
    value.oneUseHandoffConsumed === true &&
    value.submissionAllowed === false &&
    value.side === "BUY" &&
    typeof value.symbol === "string" &&
    /^[A-Z][A-Z0-9.-]{0,14}$/u.test(value.symbol) &&
    typeof value.requestedNotional === "string" &&
    /^(?:0|[1-9]\d*)\.\d{8}$/u.test(value.requestedNotional) &&
    value.currency === "USD" &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.expiresAt)) &&
    Date.parse(value.expiresAt) > Date.now() &&
    Array.isArray(value.requiredRechecks) &&
    value.requiredRechecks.length === REQUIRED_CHECKS.size &&
    value.requiredRechecks.every((check) => REQUIRED_CHECKS.has(check))
  );
}

function renderState() {
  const copy = COPY[locale];
  if (!validState(orderState)) {
    byId("order-review-status").textContent = copy.invalid;
    byId("order-review-content").hidden = true;
    return;
  }

  byId("order-review-symbol").textContent = orderState.symbol;
  byId("order-review-side").textContent = copy.buy;
  byId("order-review-notional").textContent = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: orderState.currency,
    maximumFractionDigits: 2
  }).format(Number(orderState.requestedNotional));
  byId("order-review-expiry").textContent = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(orderState.expiresAt));
  const checks = byId("order-review-checks");
  checks.replaceChildren();
  for (const check of orderState.requiredRechecks) {
    const item = document.createElement("li");
    item.textContent = `${copy.checks[check]} — ${copy.pending}`;
    checks.append(item);
  }
  byId("order-review-status").textContent = copy.verified;
  byId("order-review-content").hidden = false;
}

applyLocale();
if (typeof globalThis.fetch === "function") {
  globalThis.fetch("/api/bootstrap")
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (!validBranding(payload?.branding)) return;
      branding = Object.freeze({
        name: payload.branding.name,
        productName: payload.branding.productName
      });
      applyLocale();
    })
    .catch(() => undefined);
}
try {
  const serialized = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  orderState = serialized ? JSON.parse(serialized) : null;
} catch {
  orderState = null;
}
renderState();

byId("order-locale-selector").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-locale]");
  if (!button || !SUPPORTED_LOCALES.has(button.dataset.locale)) return;
  locale = button.dataset.locale;
  persistLocale(locale);
  applyLocale();
  renderState();
});
