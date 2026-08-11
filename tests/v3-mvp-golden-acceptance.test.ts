import { describe, expect, it } from "vitest";

import {
  evaluateV3Policy,
  type V3ApprovedBoundaryToolId,
} from "../src/assistant-v3/policy.js";
import {
  routeV3Request,
  type V3Locale,
  type V3MvpFunction,
} from "../src/assistant-v3/routing.js";
import { V3SessionAuthority } from "../src/assistant-v3/sessions.js";

const NOW = Date.UTC(2026, 6, 22, 10, 0, 0);

type GoldenVariant =
  | "canonical"
  | "typo"
  | "morphology"
  | "code-switch"
  | "follow-up";

interface GoldenPrompt {
  readonly intent: V3MvpFunction;
  readonly locale: V3Locale;
  readonly variant: GoldenVariant;
  readonly message: string;
  readonly symbols?: readonly string[];
}

/**
 * Product-language golden set for the eight explicitly committed MVP answers.
 * Follow-up rows are deliberately phrased as conversational continuations while
 * remaining self-contained. Pronoun/entity carry-over is a separate runtime
 * contract and must not be inferred by this stateless router test.
 */
const GOLDEN_PROMPTS: readonly GoldenPrompt[] = [
  {
    intent: "current_portfolio_value",
    locale: "en-US",
    variant: "canonical",
    message: "What is my current portfolio value?",
  },
  {
    intent: "current_portfolio_value",
    locale: "az-AZ",
    variant: "canonical",
    message: "Portfelimin cari dəyəri nə qədərdir?",
  },
  {
    intent: "current_portfolio_value",
    locale: "en-US",
    variant: "typo",
    message: "What is my current porfolio value?",
  },
  {
    intent: "current_portfolio_value",
    locale: "az-AZ",
    variant: "morphology",
    message: "Cari portfel dəyərimi göstərə bilərsən?",
  },
  {
    intent: "current_portfolio_value",
    locale: "az-AZ",
    variant: "code-switch",
    message: "Portfelimin current value-si nə qədərdir?",
  },
  {
    intent: "current_portfolio_value",
    locale: "en-US",
    variant: "follow-up",
    message: "And what is my portfolio worth now?",
  },

  {
    intent: "ytd_gain_loss_twr",
    locale: "en-US",
    variant: "canonical",
    message: "How much gain or loss have I made on my investments this year?",
  },
  {
    intent: "ytd_gain_loss_twr",
    locale: "az-AZ",
    variant: "canonical",
    message: "Bu il investisiyalarımdan nə qədər gəlir və ya zərər etmişəm?",
  },
  {
    intent: "ytd_gain_loss_twr",
    locale: "en-US",
    variant: "typo",
    message: "How much porfolio gain or loss this year?",
  },
  {
    intent: "ytd_gain_loss_twr",
    locale: "az-AZ",
    variant: "morphology",
    message: "İlin əvvəlindən investisiyalarımın gəlirliliyi necədir?",
  },
  {
    intent: "ytd_gain_loss_twr",
    locale: "az-AZ",
    variant: "code-switch",
    message: "Portfolio-mun bu il P&L-i nədir?",
  },
  {
    intent: "ytd_gain_loss_twr",
    locale: "en-US",
    variant: "follow-up",
    message: "And how much gain or loss have I made this year on my investments?",
  },

  {
    intent: "holding_average_cost",
    locale: "en-US",
    variant: "canonical",
    message: "What is my average purchase price for AAPL?",
    symbols: ["AAPL"],
  },
  {
    intent: "holding_average_cost",
    locale: "az-AZ",
    variant: "canonical",
    message: "AAPL səhmlərini orta hesabla hansı qiymətə almışam?",
    symbols: ["AAPL"],
  },
  {
    intent: "holding_average_cost",
    locale: "en-US",
    variant: "typo",
    message: "What is my avg cost for AAPL?",
    symbols: ["AAPL"],
  },
  {
    intent: "holding_average_cost",
    locale: "az-AZ",
    variant: "morphology",
    message: "AAPL üzrə ortalama alış qiymətim nə qədərdir?",
    symbols: ["AAPL"],
  },
  {
    intent: "holding_average_cost",
    locale: "az-AZ",
    variant: "code-switch",
    message: "AAPL səhmlərimin average cost-u nədir?",
    symbols: ["AAPL"],
  },
  {
    intent: "holding_average_cost",
    locale: "en-US",
    variant: "follow-up",
    message: "And what is my average cost for AAPL?",
    symbols: ["AAPL"],
  },

  {
    intent: "sector_allocation",
    locale: "en-US",
    variant: "canonical",
    message: "What percentage of my portfolio is in the technology sector?",
  },
  {
    intent: "sector_allocation",
    locale: "az-AZ",
    variant: "canonical",
    message: "Portfelimin neçə faizi texnologiya sektorundadır?",
  },
  {
    intent: "sector_allocation",
    locale: "en-US",
    variant: "typo",
    message: "What percent of my porfolio is technology sector?",
  },
  {
    intent: "sector_allocation",
    locale: "az-AZ",
    variant: "morphology",
    message: "Texnologiya sektorunun portfelimdəki çəkisi neçə faizdir?",
  },
  {
    intent: "sector_allocation",
    locale: "az-AZ",
    variant: "code-switch",
    message: "Portfolio-mun neçə faizi technology sektorundadır?",
  },
  {
    intent: "sector_allocation",
    locale: "en-US",
    variant: "follow-up",
    message: "And what percent of my portfolio is in the technology sector?",
  },

  {
    intent: "one_month_mover_contribution",
    locale: "en-US",
    variant: "canonical",
    message: "Which holding was the biggest one-month mover and contribution?",
  },
  {
    intent: "one_month_mover_contribution",
    locale: "az-AZ",
    variant: "canonical",
    message: "Son bir ayda ən çox hansı aktiv dəyişib?",
  },
  {
    intent: "one_month_mover_contribution",
    locale: "en-US",
    variant: "typo",
    message: "Which holding was the bigest one-month mover?",
  },
  {
    intent: "one_month_mover_contribution",
    locale: "az-AZ",
    variant: "morphology",
    message: "Son bir ayda portfelimə ən çox töhfə verən aktiv hansıdır?",
  },
  {
    intent: "one_month_mover_contribution",
    locale: "az-AZ",
    variant: "code-switch",
    message: "Son 1 ayda biggest mover hansı aktivdir?",
  },
  {
    intent: "one_month_mover_contribution",
    locale: "en-US",
    variant: "follow-up",
    message: "And which holding was the biggest one-month mover?",
  },

  {
    intent: "etf_explanation_risk",
    locale: "en-US",
    variant: "canonical",
    message: "What is BND ETF and what risks does it have?",
    symbols: ["BND"],
  },
  {
    intent: "etf_explanation_risk",
    locale: "az-AZ",
    variant: "canonical",
    message: "BND ETF nədir və hansı riskləri var?",
    symbols: ["BND"],
  },
  {
    intent: "etf_explanation_risk",
    locale: "en-US",
    variant: "typo",
    message: "Explain BND ETF riscs",
    symbols: ["BND"],
  },
  {
    intent: "etf_explanation_risk",
    locale: "az-AZ",
    variant: "morphology",
    message: "BND ETF-in risklərini izah et",
    symbols: ["BND"],
  },
  {
    intent: "etf_explanation_risk",
    locale: "az-AZ",
    variant: "code-switch",
    message: "BND ETF-in risk overview-unu göstər",
    symbols: ["BND"],
  },
  {
    intent: "etf_explanation_risk",
    locale: "en-US",
    variant: "follow-up",
    message: "And what risks does BND ETF have?",
    symbols: ["BND"],
  },

  {
    intent: "fees_tariff",
    locale: "en-US",
    variant: "canonical",
    message: "How are commissions calculated?",
  },
  {
    intent: "fees_tariff",
    locale: "az-AZ",
    variant: "canonical",
    message: "Komissiyalar necə hesablanır?",
  },
  {
    intent: "fees_tariff",
    locale: "en-US",
    variant: "typo",
    message: "How are commisions calculated?",
  },
  {
    intent: "fees_tariff",
    locale: "az-AZ",
    variant: "morphology",
    message: "Komissiyanın hesablanmasını izah et",
  },
  {
    intent: "fees_tariff",
    locale: "az-AZ",
    variant: "code-switch",
    message: "Demo Invest komissiya calculation necə işləyir?",
  },
  {
    intent: "fees_tariff",
    locale: "en-US",
    variant: "follow-up",
    message: "And how are those fees calculated?",
  },

  {
    intent: "order_ticket_preview",
    locale: "en-US",
    variant: "canonical",
    message: "Open a $100 AAPL buy ticket",
    symbols: ["AAPL"],
  },
  {
    intent: "order_ticket_preview",
    locale: "az-AZ",
    variant: "canonical",
    message: "100 USD-lik AAPL alış bileti aç",
    symbols: ["AAPL"],
  },
  {
    intent: "order_ticket_preview",
    locale: "en-US",
    variant: "typo",
    message: "Open a $100 AAPL buy tikcet",
    symbols: ["AAPL"],
  },
  {
    intent: "order_ticket_preview",
    locale: "az-AZ",
    variant: "morphology",
    message: "AAPL üçün 100 USD-lik alış biletini aç",
    symbols: ["AAPL"],
  },
  {
    intent: "order_ticket_preview",
    locale: "az-AZ",
    variant: "code-switch",
    message: "AAPL üçün $100 buy ticket önbaxışı aç",
    symbols: ["AAPL"],
  },
  {
    intent: "order_ticket_preview",
    locale: "en-US",
    variant: "follow-up",
    message: "Then open a $100 AAPL buy ticket",
    symbols: ["AAPL"],
  },
];

/**
 * This set is intentionally separate from the product-language golden cases
 * above. It is a small, deterministic held-out probe for regression detection,
 * not a claim about real-world traffic accuracy.
 */
const HELD_OUT_ROUTE_PROMPTS: readonly GoldenPrompt[] = [
  { intent: "current_portfolio_value", locale: "en-US", variant: "canonical", message: "Tell me my portfolio balance now" },
  { intent: "current_portfolio_value", locale: "en-US", variant: "canonical", message: "How much is my portfolio currently worth?" },
  { intent: "current_portfolio_value", locale: "en-US", variant: "canonical", message: "Current value of the portfolio, please" },
  { intent: "current_portfolio_value", locale: "az-AZ", variant: "canonical", message: "Portfelimin ümumi dəyərini göstər" },
  { intent: "current_portfolio_value", locale: "az-AZ", variant: "canonical", message: "Portfel dəyərim neçədir?" },
  { intent: "current_portfolio_value", locale: "az-AZ", variant: "canonical", message: "Cari portfel balansını göstər" },

  { intent: "ytd_gain_loss_twr", locale: "en-US", variant: "canonical", message: "Show my portfolio YTD return" },
  { intent: "ytd_gain_loss_twr", locale: "en-US", variant: "canonical", message: "What is my investment P&L this year?" },
  { intent: "ytd_gain_loss_twr", locale: "en-US", variant: "canonical", message: "Did my portfolio gain or lose year to date?" },
  { intent: "ytd_gain_loss_twr", locale: "az-AZ", variant: "canonical", message: "Portfelimin bu ilki gəlir və zərərini göstər" },
  { intent: "ytd_gain_loss_twr", locale: "az-AZ", variant: "canonical", message: "Portfelim üzrə ilin əvvəlindən gəlirlilik nədir?" },
  { intent: "ytd_gain_loss_twr", locale: "az-AZ", variant: "canonical", message: "Portfolio YTD P&L nəticəm nədir?" },

  { intent: "holding_average_cost", locale: "en-US", variant: "canonical", message: "Show my AAPL cost basis", symbols: ["AAPL"] },
  { intent: "holding_average_cost", locale: "en-US", variant: "canonical", message: "My average purchase cost for AAPL?", symbols: ["AAPL"] },
  { intent: "holding_average_cost", locale: "en-US", variant: "canonical", message: "At what average price did I buy AAPL?", symbols: ["AAPL"] },
  { intent: "holding_average_cost", locale: "az-AZ", variant: "canonical", message: "AAPL orta maya dəyərimi göstər", symbols: ["AAPL"] },
  { intent: "holding_average_cost", locale: "az-AZ", variant: "canonical", message: "AAPL səhmlərim üçün ortalama alış qiyməti nədir?", symbols: ["AAPL"] },
  { intent: "holding_average_cost", locale: "az-AZ", variant: "canonical", message: "AAPL-ni orta hesabla hansı qiymətə almışam?", symbols: ["AAPL"] },

  { intent: "sector_allocation", locale: "en-US", variant: "canonical", message: "Show my portfolio sector breakdown" },
  { intent: "sector_allocation", locale: "en-US", variant: "canonical", message: "How much of my portfolio is technology?" },
  { intent: "sector_allocation", locale: "en-US", variant: "canonical", message: "What percentage of the portfolio is the technology sector?" },
  { intent: "sector_allocation", locale: "az-AZ", variant: "canonical", message: "Portfelimin sektor bölgüsünü göstər" },
  { intent: "sector_allocation", locale: "az-AZ", variant: "canonical", message: "Texnologiya sektorunun portfelimdəki çəkisi neçə faizdir?" },
  { intent: "sector_allocation", locale: "az-AZ", variant: "canonical", message: "Portfelimin neçə faizi enerji sektorundadır?" },

  { intent: "one_month_mover_contribution", locale: "en-US", variant: "canonical", message: "Which asset changed most over the last month?" },
  { intent: "one_month_mover_contribution", locale: "en-US", variant: "canonical", message: "Show the biggest one-month portfolio driver" },
  { intent: "one_month_mover_contribution", locale: "en-US", variant: "canonical", message: "What made the largest monthly contribution to my portfolio?" },
  { intent: "one_month_mover_contribution", locale: "az-AZ", variant: "canonical", message: "Bir ayda ən çox dəyişən aktiv hansıdır?" },
  { intent: "one_month_mover_contribution", locale: "az-AZ", variant: "canonical", message: "Son ayda portfelə ən böyük töhfə hansı aktivdən gəlib?" },
  { intent: "one_month_mover_contribution", locale: "az-AZ", variant: "canonical", message: "1 aylıq ən böyük təsiri göstər" },

  { intent: "etf_explanation_risk", locale: "en-US", variant: "canonical", message: "Explain BND ETF risks", symbols: ["BND"] },
  { intent: "etf_explanation_risk", locale: "en-US", variant: "canonical", message: "What is the SPY ETF?", symbols: ["SPY"] },
  { intent: "etf_explanation_risk", locale: "en-US", variant: "canonical", message: "Give me an ETF risk overview for VOO", symbols: ["VOO"] },
  { intent: "etf_explanation_risk", locale: "az-AZ", variant: "canonical", message: "BND ETF risklərini izah et", symbols: ["BND"] },
  { intent: "etf_explanation_risk", locale: "az-AZ", variant: "canonical", message: "SPY ETF nədir?", symbols: ["SPY"] },
  { intent: "etf_explanation_risk", locale: "az-AZ", variant: "canonical", message: "VOO ETF-in risklərinə bax", symbols: ["VOO"] },

  { intent: "fees_tariff", locale: "en-US", variant: "canonical", message: "Explain the Demo Invest fee tariff" },
  { intent: "fees_tariff", locale: "en-US", variant: "canonical", message: "What charges apply?" },
  { intent: "fees_tariff", locale: "en-US", variant: "canonical", message: "Show me commission pricing" },
  { intent: "fees_tariff", locale: "az-AZ", variant: "canonical", message: "Demo Invest komissiya tarifini izah et" },
  { intent: "fees_tariff", locale: "az-AZ", variant: "canonical", message: "Xidmət haqqı necə işləyir?" },
  { intent: "fees_tariff", locale: "az-AZ", variant: "canonical", message: "Komissiya məbləğini necə hesablayırsınız?" },

  { intent: "order_ticket_preview", locale: "en-US", variant: "canonical", message: "Preview a $125 AAPL buy", symbols: ["AAPL"] },
  { intent: "order_ticket_preview", locale: "en-US", variant: "canonical", message: "Simulate a $90 NVDA purchase", symbols: ["NVDA"] },
  { intent: "order_ticket_preview", locale: "en-US", variant: "canonical", message: "Estimate a $75 INTC stock purchase", symbols: ["INTC"] },
  { intent: "order_ticket_preview", locale: "az-AZ", variant: "canonical", message: "AAPL üçün 125 USD alış önbaxışı", symbols: ["AAPL"] },
  { intent: "order_ticket_preview", locale: "az-AZ", variant: "canonical", message: "90 USD-lik NVDA alışını simulyasiya et", symbols: ["NVDA"] },
  { intent: "order_ticket_preview", locale: "az-AZ", variant: "canonical", message: "INTC üçün 75 USD alışını təxmini hesabla", symbols: ["INTC"] },
];

const EXPECTED_TOOLS: Readonly<
  Record<V3MvpFunction, readonly V3ApprovedBoundaryToolId[]>
> = {
  current_portfolio_value: [
    "read-portfolio-snapshot",
    "read-market-snapshot"
  ],
  ytd_gain_loss_twr: [
    "read-portfolio-snapshot",
    "read-portfolio-activity",
    "read-market-snapshot",
    "read-price-history",
  ],
  holding_average_cost: ["read-portfolio-snapshot", "read-portfolio-activity"],
  sector_allocation: ["read-portfolio-snapshot", "read-market-snapshot"],
  one_month_mover_contribution: [
    "read-portfolio-snapshot",
    "read-portfolio-activity",
    "read-price-history",
  ],
  etf_explanation_risk: [
    "resolve-instrument",
    "read-market-snapshot",
    "read-instrument-research",
    "read-price-history",
  ],
  fees_tariff: ["retrieve-approved-product-knowledge"],
  order_ticket_preview: [
    "resolve-instrument",
    "read-market-snapshot",
    "read-order-eligibility",
  ],
};

function fullyEntitledSession() {
  return new V3SessionAuthority({
    secret: "golden-acceptance-session-secret-longer-than-thirty-two-bytes",
    now: () => NOW,
  }).issue({
    tenantId: "tenant:golden",
    principalId: "principal:golden",
    authContextId: "auth:golden",
    consentVersion: "golden-consent-v1",
    consents: [
      "assistant_use",
      "portfolio_data",
      "public_market_data",
      "approved_knowledge",
    ],
    entitlementVersion: "golden-entitlements-v1",
    entitlements: [
      "assistant_access",
      "portfolio_read",
      "market_read",
      "research_read",
      "knowledge_read",
      "order_preview",
    ],
  }).session;
}

describe("V3 eight-MVP golden acceptance", () => {
  it("contains balanced canonical and noisy-language coverage for every MVP intent", () => {
    for (const intent of Object.keys(EXPECTED_TOOLS) as V3MvpFunction[]) {
      const rows = GOLDEN_PROMPTS.filter((item) => item.intent === intent);
      expect(rows.filter(({ variant }) => variant === "canonical").map(({ locale }) => locale).sort())
        .toEqual(["az-AZ", "en-US"]);
      expect(new Set(rows.map(({ variant }) => variant))).toEqual(
        new Set(["canonical", "typo", "morphology", "code-switch", "follow-up"]),
      );
    }
  });

  it.each(GOLDEN_PROMPTS)(
    "$intent / $locale / $variant: $message",
    ({ intent, locale, message, symbols = [] }) => {
      const route = routeV3Request(message);

      expect(route).toMatchObject({
        kind: "mvp",
        route: intent,
        mvpFunction: intent,
        locale,
        symbols,
        readOnly: true,
      });

      const policy = evaluateV3Policy({
        route,
        session: fullyEntitledSession(),
        now: NOW,
      });
      expect(policy).toMatchObject({
        action: "allow",
        authorized: true,
        route: intent,
        allowedToolIds: EXPECTED_TOOLS[intent],
      });
    },
  );

  it("reports a deterministic held-out confusion matrix per locale", () => {
    const labels = [...Object.keys(EXPECTED_TOOLS)] as V3MvpFunction[];
    const report = (["en-US", "az-AZ"] as const).map((locale) => {
      const rows = HELD_OUT_ROUTE_PROMPTS.filter((item) => item.locale === locale);
      const matrix = Object.fromEntries(
        labels.map((expected) => [
          expected,
          Object.fromEntries(labels.map((actual) => [actual, 0])),
        ]),
      ) as Record<V3MvpFunction, Record<V3MvpFunction, number>>;
      let correct = 0;

      for (const row of rows) {
        const decision = routeV3Request(row.message);
        if (decision.route === row.intent) correct += 1;
        if (decision.route !== null && labels.includes(decision.route as V3MvpFunction)) {
          matrix[row.intent][decision.route as V3MvpFunction] += 1;
        }
        expect(
          decision,
          `${locale}: ${row.message}`,
        ).toMatchObject({
          kind: "mvp",
          route: row.intent,
          locale,
          symbols: row.symbols ?? [],
        });
      }

      return {
        locale,
        fixtureSize: rows.length,
        correct,
        accuracy: correct / rows.length,
        matrix,
      };
    });

    expect(report).toHaveLength(2);
    for (const localeReport of report) {
      expect(localeReport.fixtureSize).toBe(24);
      expect(localeReport.accuracy).toBeGreaterThanOrEqual(0.98);
      expect(
        Object.entries(localeReport.matrix).every(
          ([expected, row]) =>
            row[expected as V3MvpFunction] === 3 &&
            Object.entries(row).every(
              ([actual, count]) => actual === expected || count === 0,
            ),
        ),
      ).toBe(true);
    }
  });
});
