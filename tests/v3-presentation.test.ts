import { describe, expect, it } from "vitest";
import { calculatePortfolioAnalytics } from "../src/assistant-v3/portfolio-analytics.js";
import {
  createMockMarketToolExecution,
  createMockPortfolioActivityToolExecution,
  createMockPortfolioToolExecution,
  mockTrustedRequestContext
} from "../src/assistant-v3/mock-portfolio.js";
import {
  buildPortfolioPresentation,
  formatMoneyExact,
  formatPercentRateExact
} from "../src/assistant-v3/presentation.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import {
  renderClaimDrafts,
  sealRenderableFact
} from "../src/assistant-v3/rendering.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";

const signer = new DevHmacSigner({ keyId: "presentation", secret: "p".repeat(32) });
const portfolioExecution = createMockPortfolioToolExecution(mockTrustedRequestContext, signer);
const activityExecution = createMockPortfolioActivityToolExecution(
  mockTrustedRequestContext,
  signer
);
const marketExecution = createMockMarketToolExecution(mockTrustedRequestContext, signer);
const analytics = calculatePortfolioAnalytics({
  context: mockTrustedRequestContext,
  portfolioExecution,
  activityExecution,
  marketExecution,
  signer
});

describe("V3 grounded portfolio presentation", () => {
  it("formats money and rates without JavaScript number coercion", () => {
    expect(formatMoneyExact(decimal("10036"), "USD", "en-US")).toBe("$10,036.00");
    expect(formatMoneyExact(decimal("-12.345"), "USD", "az-AZ")).toBe("−$12,35");
    expect(formatPercentRateExact(decimal("0.09765443"), "en-US", true)).toBe("+9.77%");
  });

  it("splits current value into one required total and optional signed detail slots", () => {
    const current = buildPortfolioPresentation({
      analytics,
      route: "current_portfolio_value",
      locale: "en-US"
    });
    expect(current.renderableFacts.map(({ alias, display, meaning, required }) => ({
      alias,
      display,
      meaning,
      required
    }))).toEqual([
      {
        alias: "F1_TOTAL_VALUE",
        display: "$10,036.00",
        meaning: "current total portfolio value including cash",
        required: true
      },
      {
        alias: "F1_CASH_VALUE",
        display: "$2,506.00",
        meaning: "cash included in the current portfolio value",
        required: false
      },
      {
        alias: "F1_HOLDINGS_VALUE",
        display: "$7,530.00",
        meaning: "priced holdings included in the current portfolio value",
        required: false
      }
    ]);
    expect(new Set(current.renderableFacts.map(({ fact }) => fact.factId)).size).toBe(1);
    expect(current.fallback[0]?.factRefs).toEqual([
      "F1_TOTAL_VALUE",
      "F1_CASH_VALUE",
      "F1_HOLDINGS_VALUE"
    ]);
    expect(current.fallback[0]?.textTemplate).toContain(
      "Your current portfolio value is {{F1_TOTAL_VALUE}}"
    );
  });

  it("renders the requested AZN total while preserving the verified USD source value and rate", () => {
    const currentValue = analytics.facts.currentValue!;
    const converted = buildPortfolioPresentation({
      analytics: {
        facts: {
          ...analytics.facts,
          currentValue: {
            ...currentValue,
            value: {
              ...currentValue.value,
              conversion: {
                sourceCurrency: "USD",
                targetCurrency: "AZN",
                sourceAmount: decimal("10036"),
                exchangeRate: decimal("1.7"),
                convertedAmount: decimal("17061.2"),
                rateEffectiveDate: "2026-07-21",
                rateAsOf: "2026-07-21T00:00:00+04:00",
                rateSourceUrl: "https://www.cbar.az/currencies/21.07.2026.xml"
              }
            }
          }
        }
      },
      route: "current_portfolio_value",
      locale: "az-AZ"
    });

    expect(converted.renderableFacts.map(({ alias, display }) => ({
      alias,
      display
    }))).toEqual([
      { alias: "F1_CONVERTED_VALUE", display: "AZN 17 061,20" },
      { alias: "F1_ORIGINAL_VALUE", display: "$10 036,00" },
      { alias: "F1_EXCHANGE_RATE", display: "AZN/USD 1.70000000" },
      { alias: "F1_RATE_DATE", display: "2026-07-21" }
    ]);
    expect(converted.fallback[0]?.textTemplate).toContain(
      "Portfelinizin cari dəyəri {{F1_CONVERTED_VALUE}}-dir"
    );
  });

  it("lets a writer use only the required slot while verifying one shared signed parent", () => {
    const current = buildPortfolioPresentation({
      analytics,
      route: "current_portfolio_value",
      locale: "en-US"
    });
    const rendered = renderClaimDrafts({
      drafts: [{
        claimId: "natural-current-value",
        locale: "en-US",
        textTemplate: "Right now, your portfolio is worth {{F1_TOTAL_VALUE}}.",
        factRefs: ["F1_TOTAL_VALUE"],
        citationRefs: [],
        limitations: []
      }],
      facts: current.renderableFacts.map((item) =>
        sealRenderableFact(item, new EvidenceFactory({ signer }))
      ),
      citations: [],
      tools: [portfolioExecution, activityExecution, marketExecution],
      evidence: new EvidenceFactory({ signer }),
      fallback: current.fallback,
      locale: "en-US"
    });

    expect(rendered).toMatchObject({
      generationMode: "writer",
      message: "Right now, your portfolio is worth $10,036.00.",
      usedFactAliases: ["F1_TOTAL_VALUE"]
    });
    expect(rendered.usedFactIds).toEqual([current.facts[0]?.factId]);
    expect(rendered.message).not.toContain("$2,506.00");
    expect(rendered.message).not.toContain("$7,530.00");
  });

  it.each([
    ["en-US", "$2,506.00", "You currently have {{F1_CASH_VALUE}} in cash."],
    ["az-AZ", "$2 506,00", "Hazırda portfelinizdə {{F1_CASH_VALUE}} nağd vəsait var."]
  ] as const)("projects only the signed cash balance for %s", (
    locale,
    display,
    fallback
  ) => {
    const current = buildPortfolioPresentation({
      analytics,
      route: "current_portfolio_value",
      locale,
      cashBalanceOnly: true
    });

    expect(current.renderableFacts.map(({
      alias,
      display: renderedDisplay,
      meaning,
      required
    }) => ({
      alias,
      display: renderedDisplay,
      meaning,
      required
    }))).toEqual([{
      alias: "F1_CASH_VALUE",
      display,
      meaning: "current cash balance in the portfolio",
      required: true
    }]);
    expect(current.fallback).toEqual([
      expect.objectContaining({
        textTemplate: fallback,
        factRefs: ["F1_CASH_VALUE"]
      })
    ]);
    expect(current.cards[0]?.title).toBe(
      locale === "az-AZ" ? "Nağd vəsait" : "Cash balance"
    );
  });

  it("keeps the YTD result and TWR essential while exposing a complete optional reconciliation", () => {
    const ytd = buildPortfolioPresentation({
      analytics,
      route: "ytd_gain_loss_twr",
      locale: "en-US"
    });
    expect(ytd.renderableFacts.map(({ alias, required }) => ({ alias, required }))).toEqual([
      { alias: "F1_NET_RESULT", required: true },
      { alias: "F2_TWR", required: true },
      { alias: "F1_REALIZED_PNL", required: false },
      { alias: "F1_UNREALIZED_PNL", required: false },
      { alias: "F1_INCOME", required: false },
      { alias: "F1_FEES", required: false },
      { alias: "F1_FX_IMPACT", required: false }
    ]);
    expect(ytd.renderableFacts.find(({ alias }) => alias === "F1_NET_RESULT")?.display)
      .toBe("+$876.00");
    expect(ytd.renderableFacts.find(({ alias }) => alias === "F2_TWR")?.display)
      .toBe("+9.77%");
    expect(ytd.fallback[0]?.factRefs).toEqual(
      ytd.renderableFacts.map(({ alias }) => alias)
    );
    expect(ytd.fallback[0]?.textTemplate).toContain("{{F1_FX_IMPACT}} of FX impact");
    expect(ytd.cards[0]?.factRefs).toHaveLength(2);
  });

  it("selects a requested holding and gives the writer semantic average-cost slots", () => {
    const result = buildPortfolioPresentation({
      analytics,
      route: "holding_average_cost",
      locale: "en-US",
      symbol: "AAPL"
    });
    expect(result.renderableFacts.map(({ alias, display, required }) => ({
      alias,
      display,
      required
    }))).toEqual([
      { alias: "F1_SYMBOL", display: "AAPL", required: true },
      { alias: "F1_AVERAGE_COST", display: "$185.08", required: true },
      { alias: "F1_REMAINING_QUANTITY", display: "12.0000", required: false }
    ]);
    expect(result.fallback[0]?.factRefs).toEqual(
      result.renderableFacts.map(({ alias }) => alias)
    );
    expect(result.cards[0]?.data).toMatchObject({
      positions: [{ symbol: "AAPL", averageUnitCost: "185.08333333" }]
    });
  });

  it.each([
    {
      route: "sector_allocation" as const,
      required: ["F1_SECTOR", "F1_INVESTED_ALLOCATION"],
      optional: ["F1_TOTAL_ALLOCATION"]
    },
    {
      route: "one_month_mover_contribution" as const,
      required: [
        "F1_MOVER_SYMBOL",
        "F1_MOVER_RETURN",
        "F1_CONTRIBUTOR_SYMBOL",
        "F1_CONTRIBUTION_VALUE"
      ],
      optional: ["F1_CONTRIBUTION_RATE"]
    }
  ])(
    "marks essential and secondary $route slots while keeping fallback coverage complete",
    ({ route, required, optional }) => {
      const result = buildPortfolioPresentation({
        analytics,
        route,
        locale: "en-US"
      });
      expect(
        result.renderableFacts.filter((item) => item.required).map(({ alias }) => alias)
      ).toEqual(required);
      expect(
        result.renderableFacts.filter((item) => !item.required).map(({ alias }) => alias)
      ).toEqual(optional);
      expect(result.fallback[0]?.factRefs).toEqual(
        result.renderableFacts.map(({ alias }) => alias)
      );
      expect(result.renderableFacts.every(({ meaning }) => meaning.trim().length > 0))
        .toBe(true);
    }
  );

  it("keeps the complete reviewed fallback localized in Azerbaijani", () => {
    const current = buildPortfolioPresentation({
      analytics,
      route: "current_portfolio_value",
      locale: "az-AZ"
    });
    expect(current.fallback[0]?.textTemplate).toBe(
      "Portfelinizin cari dəyəri {{F1_TOTAL_VALUE}}-dir. Buraya {{F1_CASH_VALUE}} nağd vəsait və {{F1_HOLDINGS_VALUE}} qiymətləndirilmiş aktiv daxildir."
    );
    expect(current.fallback[0]?.factRefs).toEqual(
      current.renderableFacts.map(({ alias }) => alias)
    );
  });
});
