const DECIMAL_STRING = /^-?(?:0|[1-9]\d{0,29})(?:\.\d{1,8})?$/u;

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function formatDecimal(value, minimumFractionDigits = 0) {
  if (typeof value !== "string" || !DECIMAL_STRING.test(value)) return "—";
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, originalFraction = ""] = unsigned.split(".");
  let fraction = originalFraction;
  while (fraction.length > minimumFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  fraction = fraction.padEnd(minimumFractionDigits, "0");
  return `${negative ? "−" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function formatMoney(value) {
  if (!isRecord(value) || !/^[A-Z]{3}$/u.test(value.currency || "")) return "—";
  const amount = formatDecimal(value.amount, 2);
  return amount === "—" ? amount : `${value.currency} ${amount}`;
}

function formatTimestamp(value, locale) {
  if (typeof value !== "string") return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    return locale === "az-AZ" ? "Vaxt mövcud deyil" : "Time unavailable";
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Baku"
  }).format(date);
}

export function v3ActivityRecordLabel(item, locale) {
  const az = locale === "az-AZ";
  if (item.kind === "execution") {
    return item.side === "BUY"
      ? (az ? "İcra edilmiş alış" : "Executed purchase")
      : (az ? "İcra edilmiş satış" : "Executed sale");
  }
  const status = {
    OPEN: az ? "Açıq sifariş" : "Open order",
    CANCELLED: az ? "Ləğv edilmiş sifariş" : "Cancelled order",
    FILLED: az ? "Doldurulmuş sifariş" : "Filled order"
  }[item.status] || (az ? "Sifariş" : "Order");
  return `${status} · ${az ? "yalnız status, icra deyil" : "state only, not an execution"}`;
}

/**
 * Produces the exact customer-visible activity strings before DOM rendering.
 * Coverage counts deliberately remain metadata: they are neither returns nor
 * percentages and therefore never pass through generic financial formatting.
 */
export function createV3ActivityCardView(data, locale) {
  const az = locale === "az-AZ";
  const records = Array.isArray(data?.items) ? data.items.slice(0, 10) : [];
  const rows = [];
  for (const item of records) {
    if (!isRecord(item) || (item.kind !== "execution" && item.kind !== "order")) continue;
    const action = item.side === "BUY"
      ? (az ? "Alış" : "Buy")
      : (az ? "Satış" : "Sell");
    const base = {
      title: `${action} ${item.symbol}`,
      label: v3ActivityRecordLabel(item, locale),
      timestamp: formatTimestamp(item.occurredAt, locale)
    };
    if (item.kind === "execution") {
      rows.push({
        ...base,
        primary: formatMoney(item.total),
        secondary: `${formatDecimal(item.quantity)} × ${formatMoney(item.unitPrice)}`
      });
      continue;
    }
    rows.push({
      ...base,
      primary: item.limitPrice
        ? formatMoney(item.limitPrice)
        : (az ? "Bazar sifarişi" : "Market order"),
      secondary: `${az ? "Tələb" : "Requested"}: ${formatDecimal(item.quantity)}`
    });
  }

  const footer = [];
  if (data?.hasMore === true) {
    footer.push(az ? "Ən son 10 qeyd göstərilir" : "Showing the 10 most recent records");
  }
  if (typeof data?.asOf === "string") {
    footer.push(`${az ? "Məlumat vaxtı" : "Data as of"} ${formatTimestamp(data.asOf, locale)}`);
  }
  return {
    emptyMessage: az
      ? "Göstəriləcək son ticarət fəaliyyəti yoxdur."
      : "There is no recent trading activity to show.",
    rows,
    footer: footer.join(" · ")
  };
}
