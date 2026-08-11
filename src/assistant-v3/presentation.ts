import type {
  AssistantCard,
  ClaimDraft,
  DecimalString,
  FactEnvelope,
  SupportedLocale
} from "./contracts.js";
import {
  FIXED_DECIMAL_FACTOR,
  parseFixedDecimal
} from "./fixed-decimal.js";
import type {
  AverageCostFact,
  CurrentPortfolioValueFact,
  OneMonthMoverFact,
  PortfolioAnalyticsResult,
  SectorAllocationFact,
  TimeWeightedReturnFact,
  YtdPnlFact
} from "./portfolio-analytics.js";
import type { V3Function } from "./routing.js";
import type { RenderableFact } from "./rendering.js";
import type { PortfolioRouteCalculation } from "./portfolio-route-calculators.js";

function roundedDigits(value: DecimalString, places: number): { negative: boolean; digits: string } {
  const units = parseFixedDecimal(value);
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const divisor = 10n ** BigInt(8 - places);
  const rounded = (absolute + divisor / 2n) / divisor;
  return { negative, digits: rounded.toString().padStart(places + 1, "0") };
}

export function formatDecimalExact(
  value: DecimalString,
  locale: SupportedLocale,
  places = 2
): string {
  const { negative, digits } = roundedDigits(value, places);
  const integerRaw = places === 0 ? digits : digits.slice(0, -places);
  const fraction = places === 0 ? "" : digits.slice(-places);
  const thousands = locale === "az-AZ" ? " " : ",";
  const decimalSeparator = locale === "az-AZ" ? "," : ".";
  const grouped = integerRaw.replace(/\B(?=(\d{3})+(?!\d))/gu, thousands);
  return `${negative ? "−" : ""}${grouped}${places === 0 ? "" : `${decimalSeparator}${fraction}`}`;
}

export function formatMoneyExact(
  value: DecimalString,
  currency: string,
  locale: SupportedLocale
): string {
  const formatted = formatDecimalExact(value, locale, 2);
  const negative = formatted.startsWith("−");
  const unsigned = negative ? formatted.slice(1) : formatted;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${negative ? "−" : ""}${symbol}${unsigned}`;
}

export function formatSignedMoneyExact(
  value: DecimalString,
  currency: string,
  locale: SupportedLocale
): string {
  return parseFixedDecimal(value) > 0n
    ? `+${formatMoneyExact(value, currency, locale)}`
    : formatMoneyExact(value, currency, locale);
}

export function formatPercentRateExact(
  rate: DecimalString,
  locale: SupportedLocale,
  signed = false
): string {
  const units = parseFixedDecimal(rate);
  const percent = `${units * 100n / FIXED_DECIMAL_FACTOR}.${((units < 0n ? -units : units) * 100n % FIXED_DECIMAL_FACTOR).toString().padStart(8, "0")}`;
  // Reparse a normalized positive/negative percentage to reuse exact rounding.
  const normalized = (units < 0n
    ? `-${((-units) * 100n / FIXED_DECIMAL_FACTOR).toString()}.${(((-units) * 100n) % FIXED_DECIMAL_FACTOR).toString().padStart(8, "0")}`
    : percent) as DecimalString;
  const formatted = formatDecimalExact(normalized, locale, 2);
  return `${signed && units > 0n ? "+" : ""}${formatted}%`;
}

function claim(input: {
  locale: SupportedLocale;
  id: string;
  template: string;
  refs: string[];
}): ClaimDraft {
  return {
    claimId: input.id,
    locale: input.locale,
    textTemplate: input.template,
    factRefs: input.refs,
    citationRefs: [],
    limitations: []
  };
}

function card(
  kind: AssistantCard["kind"],
  title: string,
  fact: FactEnvelope<unknown>
): AssistantCard {
  return {
    cardId: `card-${fact.factId}`,
    kind,
    title,
    factRefs: [fact.factId],
    data: fact.value
  };
}

function slot(input: {
  alias: string;
  fact: FactEnvelope<unknown>;
  display: string;
  meaning: string;
  required: boolean;
  semanticRoles?: RenderableFact["semanticRoles"];
}): RenderableFact {
  return {
    alias: input.alias,
    fact: input.fact,
    display: input.display,
    meaning: input.meaning,
    required: input.required,
    ...(input.semanticRoles === undefined
      ? {}
      : { semanticRoles: input.semanticRoles })
  };
}

export interface PortfolioPresentation {
  facts: FactEnvelope<unknown>[];
  renderableFacts: RenderableFact[];
  fallback: ClaimDraft[];
  cards: AssistantCard[];
}

export function buildPortfolioPresentation(input: {
  analytics: { facts: Partial<PortfolioAnalyticsResult["facts"]> };
  route: Extract<V3Function,
    | "current_portfolio_value"
    | "largest_holding"
    | "ytd_gain_loss_twr"
    | "holding_average_cost"
    | "sector_allocation"
    | "one_month_mover_contribution">;
  locale: SupportedLocale;
  symbol?: string;
  /** Projects only the signed cash field for an explicit cash-balance request. */
  cashBalanceOnly?: boolean;
}): PortfolioPresentation {
  const { facts } = input.analytics;
  if (
    input.route === "current_portfolio_value" ||
    input.route === "largest_holding"
  ) {
    const fact = facts.currentValue;
    if (!fact) throw new Error("DATA_NOT_AVAILABLE: current value was not calculated.");
    const value = fact.value;
    if (input.route === "largest_holding") {
      const largest = [...value.positions].sort((left, right) => {
        const leftValue = parseFixedDecimal(left.marketValue);
        const rightValue = parseFixedDecimal(right.marketValue);
        return leftValue === rightValue ? 0 : leftValue > rightValue ? -1 : 1;
      })[0];
      if (!largest) throw new Error("DATA_NOT_AVAILABLE: no priced holding exists.");
      return {
        facts: [fact],
        renderableFacts: [
          slot({
            alias: "F1_SYMBOL",
            fact,
            display: largest.symbol,
            meaning: "ticker of the largest priced holding by market value",
            required: true
          }),
          slot({
            alias: "F1_MARKET_VALUE",
            fact,
            display: formatMoneyExact(
              largest.marketValue,
              value.currency,
              input.locale
            ),
            meaning: "verified market value of the largest holding",
            required: true
          })
        ],
        fallback: [claim({
          locale: input.locale,
          id: "portfolio-largest-holding",
          template: input.locale === "az-AZ"
            ? "Bazar dəyərinə görə ən böyük mövqeniz {{F1_SYMBOL}}-dur: {{F1_MARKET_VALUE}}."
            : "Your largest holding by market value is {{F1_SYMBOL}} at {{F1_MARKET_VALUE}}.",
          refs: [
            "F1_SYMBOL",
            "F1_MARKET_VALUE"
          ]
        })],
        cards: [{
          cardId: `card-${fact.factId}`,
          kind: "portfolio",
          title: input.locale === "az-AZ" ? "Ən böyük mövqe" : "Largest holding",
          factRefs: [fact.factId],
          data: value
        }]
      };
    }
    if (input.cashBalanceOnly === true) {
      return {
        facts: [fact],
        renderableFacts: [
          slot({
            alias: "F1_CASH_VALUE",
            fact,
            display: formatMoneyExact(value.cashValue, value.currency, input.locale),
            meaning: "current cash balance in the portfolio",
            required: true
          })
        ],
        fallback: [claim({
          locale: input.locale,
          id: "portfolio-cash-balance",
          template: input.locale === "az-AZ"
            ? "Hazırda portfelinizdə {{F1_CASH_VALUE}} nağd vəsait var."
            : "You currently have {{F1_CASH_VALUE}} in cash.",
          refs: ["F1_CASH_VALUE"]
        })],
        cards: [
          card(
            "portfolio",
            input.locale === "az-AZ" ? "Nağd vəsait" : "Cash balance",
            fact
          )
        ]
      };
    }
    if (value.conversion !== undefined) {
      const conversion = value.conversion;
      const rateDisplay =
        `${conversion.targetCurrency}/${conversion.sourceCurrency} ${conversion.exchangeRate}`;
      return {
        facts: [fact],
        renderableFacts: [
          slot({
            alias: "F1_CONVERTED_VALUE",
            fact,
            display: formatMoneyExact(
              conversion.convertedAmount,
              conversion.targetCurrency,
              input.locale
            ),
            meaning: "current total portfolio value converted into the requested currency",
            required: true,
            semanticRoles: ["portfolio.balance", "portfolio.fx"]
          }),
          slot({
            alias: "F1_ORIGINAL_VALUE",
            fact,
            display: formatMoneyExact(
              conversion.sourceAmount,
              conversion.sourceCurrency,
              input.locale
            ),
            meaning: "verified current portfolio amount before currency conversion",
            required: true,
            semanticRoles: ["portfolio.balance"]
          }),
          slot({
            alias: "F1_EXCHANGE_RATE",
            fact,
            display: rateDisplay,
            meaning: "official exchange rate used for the conversion",
            required: true,
            semanticRoles: ["portfolio.fx"]
          }),
          slot({
            alias: "F1_RATE_DATE",
            fact,
            display: conversion.rateEffectiveDate,
            meaning: "effective date of the official exchange rate",
            required: true,
            semanticRoles: ["source.time"]
          })
        ],
        fallback: [claim({
          locale: input.locale,
          id: "portfolio-current-value-converted",
          template: input.locale === "az-AZ"
            ? "Portfelinizin cari dəyəri {{F1_CONVERTED_VALUE}}-dir. İlkin dəyər {{F1_ORIGINAL_VALUE}}, istifadə olunan rəsmi məzənnə isə {{F1_EXCHANGE_RATE}}-dir (qüvvədə olma tarixi: {{F1_RATE_DATE}})."
            : "Your current portfolio value is {{F1_CONVERTED_VALUE}}. The original value is {{F1_ORIGINAL_VALUE}}, using the official rate {{F1_EXCHANGE_RATE}} effective {{F1_RATE_DATE}}.",
          refs: [
            "F1_CONVERTED_VALUE",
            "F1_ORIGINAL_VALUE",
            "F1_EXCHANGE_RATE",
            "F1_RATE_DATE"
          ]
        })],
        cards: [
          card(
            "portfolio",
            input.locale === "az-AZ" ? "AZN ilə cari dəyər" : "Current value in AZN",
            fact
          )
        ]
      };
    }
    return {
      facts: [fact],
      renderableFacts: [
        slot({
          alias: "F1_TOTAL_VALUE",
          fact,
          display: formatMoneyExact(value.totalValue, value.currency, input.locale),
          meaning: "current total portfolio value including cash",
          required: true
        }),
        slot({
          alias: "F1_CASH_VALUE",
          fact,
          display: formatMoneyExact(value.cashValue, value.currency, input.locale),
          meaning: "cash included in the current portfolio value",
          required: false
        }),
        slot({
          alias: "F1_HOLDINGS_VALUE",
          fact,
          display: formatMoneyExact(value.positionsValue, value.currency, input.locale),
          meaning: "priced holdings included in the current portfolio value",
          required: false
        })
      ],
      fallback: [claim({
        locale: input.locale,
        id: "portfolio-current-value",
        template: input.locale === "az-AZ"
          ? "Portfelinizin cari dəyəri {{F1_TOTAL_VALUE}}-dir. Buraya {{F1_CASH_VALUE}} nağd vəsait və {{F1_HOLDINGS_VALUE}} qiymətləndirilmiş aktiv daxildir."
          : "Your current portfolio value is {{F1_TOTAL_VALUE}}. That includes {{F1_CASH_VALUE}} in cash and {{F1_HOLDINGS_VALUE}} in priced holdings.",
        refs: ["F1_TOTAL_VALUE", "F1_CASH_VALUE", "F1_HOLDINGS_VALUE"]
      })],
      cards: [card("portfolio", input.locale === "az-AZ" ? "Cari dəyər" : "Current value", fact)]
    };
  }

  if (input.route === "ytd_gain_loss_twr") {
    const pnl = facts.ytdPnl;
    const twr = facts.timeWeightedReturn;
    if (!pnl || !twr) throw new Error("DATA_NOT_AVAILABLE: YTD facts were not calculated.");
    const value = pnl.value;
    return {
      facts: [pnl, twr],
      renderableFacts: [
        slot({
          alias: "F1_NET_RESULT",
          fact: pnl,
          display: formatSignedMoneyExact(value.componentMethodPnl, value.currency, input.locale),
          meaning: "year-to-date reconciled net gain or loss",
          required: true
        }),
        slot({
          alias: "F2_TWR",
          fact: twr,
          display: formatPercentRateExact(twr.value.returnRate, input.locale, true),
          meaning: "year-to-date cash-flow-adjusted time-weighted return",
          required: true
        }),
        slot({
          alias: "F1_REALIZED_PNL",
          fact: pnl,
          display: formatSignedMoneyExact(value.realizedPricePnl, value.currency, input.locale),
          meaning: "realized price gain or loss component of the year-to-date result",
          required: false
        }),
        slot({
          alias: "F1_UNREALIZED_PNL",
          fact: pnl,
          display: formatSignedMoneyExact(value.unrealizedPricePnl, value.currency, input.locale),
          meaning: "unrealized price change component of the year-to-date result",
          required: false
        }),
        slot({
          alias: "F1_INCOME",
          fact: pnl,
          display: formatSignedMoneyExact(value.income, value.currency, input.locale),
          meaning: "dividend and coupon income component of the year-to-date result",
          required: false
        }),
        slot({
          alias: "F1_FEES",
          fact: pnl,
          display: formatMoneyExact(value.fees, value.currency, input.locale),
          meaning: "fees deducted in the year-to-date reconciliation",
          required: false
        }),
        slot({
          alias: "F1_FX_IMPACT",
          fact: pnl,
          display: formatSignedMoneyExact(value.fxImpact, value.currency, input.locale),
          meaning: "foreign-exchange impact component of the year-to-date result",
          required: false
        })
      ],
      fallback: [claim({
        locale: input.locale,
        id: "portfolio-ytd",
        template: input.locale === "az-AZ"
          ? "İlin əvvəlindən xalis nəticəniz {{F1_NET_RESULT}}, pul axınlarına uyğunlaşdırılmış TWR isə {{F2_TWR}}-dir. Nəticəyə {{F1_REALIZED_PNL}} reallaşdırılmış gəlir/zərər, {{F1_UNREALIZED_PNL}} reallaşdırılmamış dəyişiklik, {{F1_INCOME}} gəlir, {{F1_FEES}} komissiya və {{F1_FX_IMPACT}} valyuta təsiri daxildir."
          : "Since the start of the year, your reconciled net result is {{F1_NET_RESULT}}, and cash-flow-adjusted TWR is {{F2_TWR}}. The result includes {{F1_REALIZED_PNL}} realized gain/loss, {{F1_UNREALIZED_PNL}} unrealized change, {{F1_INCOME}} of income, {{F1_FEES}} in fees, and {{F1_FX_IMPACT}} of FX impact.",
        refs: [
          "F1_NET_RESULT",
          "F2_TWR",
          "F1_REALIZED_PNL",
          "F1_UNREALIZED_PNL",
          "F1_INCOME",
          "F1_FEES",
          "F1_FX_IMPACT"
        ]
      })],
      cards: [{
        cardId: `card-${pnl.factId}-${twr.factId}`,
        kind: "performance",
        title: input.locale === "az-AZ" ? "İllik nəticə" : "Year-to-date",
        factRefs: [pnl.factId, twr.factId],
        data: {
          pnl: pnl.value,
          timeWeightedReturn: twr.value
        }
      }]
    };
  }

  if (input.route === "holding_average_cost") {
    const fact = facts.averageCost;
    if (!fact) throw new Error("DATA_NOT_AVAILABLE: average cost was not calculated.");
    const symbol = input.symbol?.toUpperCase();
    const position = fact.value.positions.find((item) => item.symbol === symbol) ?? fact.value.positions[0];
    if (!position) throw new Error("DATA_NOT_AVAILABLE: no remaining open lot.");
    return {
      facts: [fact],
      renderableFacts: [
        slot({
          alias: "F1_SYMBOL",
          fact,
          display: position.symbol,
          meaning: "ticker for the holding whose average cost was requested",
          required: true
        }),
        slot({
          alias: "F1_AVERAGE_COST",
          fact,
          display: formatMoneyExact(position.averageUnitCost, position.currency, input.locale),
          meaning: "average unit cost from the remaining open-lot basis including configured buy fees",
          required: true
        }),
        slot({
          alias: "F1_REMAINING_QUANTITY",
          fact,
          display: formatDecimalExact(position.quantity, input.locale, 4),
          meaning: "remaining open quantity used in the average-cost calculation",
          required: false
        })
      ],
      fallback: [claim({
        locale: input.locale,
        id: "portfolio-average-cost",
        template: input.locale === "az-AZ"
          ? "Qalan açıq lotlar və kapitalizə edilmiş alış komissiyası əsasında {{F1_SYMBOL}} üzrə orta alış qiymətiniz {{F1_AVERAGE_COST}}-dir. Hesablamada qalan miqdar {{F1_REMAINING_QUANTITY}}-dür."
          : "Based on the remaining open lots and capitalized buy fees, your average cost for {{F1_SYMBOL}} is {{F1_AVERAGE_COST}}. The remaining quantity used is {{F1_REMAINING_QUANTITY}}.",
        refs: ["F1_SYMBOL", "F1_AVERAGE_COST", "F1_REMAINING_QUANTITY"]
      })],
      cards: [{
        cardId: `card-${fact.factId}`,
        kind: "portfolio",
        title: input.locale === "az-AZ" ? "Orta alış qiyməti" : "Average cost",
        factRefs: [fact.factId],
        // Keep the signed fact complete for replay, but present only the
        // holding requested in this turn instead of leaking unrelated rows
        // into a narrowly scoped answer card.
        data: { ...fact.value, positions: [position] }
      }]
    };
  }

  if (input.route === "sector_allocation") {
    const fact = facts.sectorAllocation;
    if (!fact) throw new Error("DATA_NOT_AVAILABLE: allocation was not calculated.");
    const technology = fact.value.sectors.find(({ sector }) => /technology/iu.test(sector));
    const primary = technology ?? fact.value.sectors[0];
    if (!primary) throw new Error("DATA_NOT_AVAILABLE: no priced invested assets.");
    return {
      facts: [fact],
      renderableFacts: [
        slot({
          alias: "F1_SECTOR",
          fact,
          display: primary.sector,
          meaning: "sector selected for the requested allocation answer",
          required: true
        }),
        slot({
          alias: "F1_INVESTED_ALLOCATION",
          fact,
          display: formatPercentRateExact(primary.investedAllocationRate, input.locale),
          meaning: "sector share of invested assets excluding cash",
          required: true
        }),
        slot({
          alias: "F1_TOTAL_ALLOCATION",
          fact,
          display: formatPercentRateExact(primary.totalPortfolioAllocationRate, input.locale),
          meaning: "sector share of the total portfolio including cash",
          required: false
        })
      ],
      fallback: [claim({
        locale: input.locale,
        id: "portfolio-sector",
        template: input.locale === "az-AZ"
          ? "{{F1_SECTOR}} sektoru investisiya edilmiş aktivlərinizin {{F1_INVESTED_ALLOCATION}}-ni təşkil edir. Nağd daxil ümumi portfeldə bu pay {{F1_TOTAL_ALLOCATION}}-dir."
          : "{{F1_SECTOR}} represents {{F1_INVESTED_ALLOCATION}} of your invested assets. Including cash, it represents {{F1_TOTAL_ALLOCATION}} of the total portfolio.",
        refs: ["F1_SECTOR", "F1_INVESTED_ALLOCATION", "F1_TOTAL_ALLOCATION"]
      })],
      cards: [card("allocation", input.locale === "az-AZ" ? "Sektor bölgüsü" : "Sector allocation", fact)]
    };
  }

  const fact = facts.oneMonthMover;
  if (!fact) throw new Error("DATA_NOT_AVAILABLE: one-month movers were not calculated.");
  const mover = fact.value.largestAbsolutePriceReturn;
  const contributor = fact.value.largestAbsolutePortfolioContribution;
  return {
    facts: [fact],
    renderableFacts: [
      slot({
        alias: "F1_MOVER_SYMBOL",
        fact,
        display: mover.symbol,
        meaning: "ticker with the largest absolute one-month price return",
        required: true
      }),
      slot({
        alias: "F1_MOVER_RETURN",
        fact,
        display: formatPercentRateExact(mover.returnRate, input.locale, true),
        meaning: "one-month price return for the largest absolute mover",
        required: true
      }),
      slot({
        alias: "F1_CONTRIBUTOR_SYMBOL",
        fact,
        display: contributor.symbol,
        meaning: "ticker with the largest absolute one-month portfolio contribution",
        required: true
      }),
      slot({
        alias: "F1_CONTRIBUTION_VALUE",
        fact,
        display: formatSignedMoneyExact(
          contributor.changeValue,
          fact.value.currency,
          input.locale
        ),
        meaning: "money value of the largest absolute one-month portfolio contribution",
        required: true
      }),
      slot({
        alias: "F1_CONTRIBUTION_RATE",
        fact,
        display: formatPercentRateExact(
          contributor.contributionToPortfolioRate,
          input.locale,
          true
        ),
        meaning: "rate of the largest absolute one-month contribution relative to the portfolio",
        required: false
      })
    ],
    fallback: [claim({
      locale: input.locale,
      id: "portfolio-mover",
      template: input.locale === "az-AZ"
        ? "Son bir ayda ən böyük mütləq qiymət dəyişimi {{F1_MOVER_SYMBOL}} üzrə {{F1_MOVER_RETURN}} olub. Portfelə ən böyük töhfə isə {{F1_CONTRIBUTOR_SYMBOL}} üzrə {{F1_CONTRIBUTION_VALUE}} ({{F1_CONTRIBUTION_RATE}}) olub."
        : "Over the last month, {{F1_MOVER_SYMBOL}} had the largest absolute price move at {{F1_MOVER_RETURN}}. The largest portfolio contribution came from {{F1_CONTRIBUTOR_SYMBOL}} at {{F1_CONTRIBUTION_VALUE}} ({{F1_CONTRIBUTION_RATE}}).",
      refs: [
        "F1_MOVER_SYMBOL",
        "F1_MOVER_RETURN",
        "F1_CONTRIBUTOR_SYMBOL",
        "F1_CONTRIBUTION_VALUE",
        "F1_CONTRIBUTION_RATE"
      ]
    })],
    cards: [card("performance", input.locale === "az-AZ" ? "Bir aylıq dəyişiklik" : "One-month movers", fact)]
  };
}

/** Adapts the route-scoped calculator without manufacturing unused facts. */
export function buildPortfolioRoutePresentation(input: {
  calculation: PortfolioRouteCalculation;
  locale: SupportedLocale;
  symbol?: string;
  cashBalanceOnly?: boolean;
}): PortfolioPresentation {
  const facts: Partial<PortfolioAnalyticsResult["facts"]> = {};
  for (const fact of input.calculation.facts) {
    if (fact.kind === "portfolio.current-value") {
      facts.currentValue = fact as FactEnvelope<CurrentPortfolioValueFact>;
    } else if (fact.kind === "portfolio.average-cost") {
      facts.averageCost = fact as FactEnvelope<AverageCostFact>;
    } else if (fact.kind === "portfolio.ytd-pnl") {
      facts.ytdPnl = fact as FactEnvelope<YtdPnlFact>;
    } else if (fact.kind === "portfolio.time-weighted-return") {
      facts.timeWeightedReturn = fact as FactEnvelope<TimeWeightedReturnFact>;
    } else if (fact.kind === "portfolio.sector-allocation") {
      facts.sectorAllocation = fact as FactEnvelope<SectorAllocationFact>;
    } else if (fact.kind === "portfolio.one-month-mover") {
      facts.oneMonthMover = fact as FactEnvelope<OneMonthMoverFact>;
    }
  }
  return buildPortfolioPresentation({
    analytics: { facts },
    route: input.calculation.route,
    locale: input.locale,
    ...(input.cashBalanceOnly === undefined
      ? {}
      : { cashBalanceOnly: input.cashBalanceOnly }),
    ...(input.symbol === undefined ? {} : { symbol: input.symbol })
  });
}
