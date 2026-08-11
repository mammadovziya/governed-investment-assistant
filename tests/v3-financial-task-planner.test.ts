import { describe, expect, it, vi } from "vitest";

import {
  V3_FINANCIAL_TASK_PLAN_SCHEMA_VERSION,
  V3FinancialTaskPlanner,
  compileV3FinancialTaskPlan,
  type V3FinancialTaskPlan
} from "../src/assistant-v3/financial-task-planner.js";
import { financialEducationRouteReason } from
  "../src/assistant-v3/financial-education-query.js";
import { routeV3Request } from "../src/assistant-v3/routing.js";

function plan(
  route: V3FinancialTaskPlan["route"],
  subjectMode: V3FinancialTaskPlan["subjectMode"],
  overrides: Partial<V3FinancialTaskPlan> = {}
): V3FinancialTaskPlan {
  return {
    schemaVersion: V3_FINANCIAL_TASK_PLAN_SCHEMA_VERSION,
    route,
    subjectMode,
    certainty: "clear",
    adviceClass:
      route === "security_decision_support"
        ? "decision_support"
        : "information",
    ...overrides
  };
}

describe("V3 governed financial task planner", () => {
  it("recovers a transliterated Azerbaijani quote request without model-supplied arguments", () => {
    const message = "AAPL hazirda nece manatdir";
    expect(routeV3Request(message, { locale: "az-AZ" })).toMatchObject({
      kind: "clarify",
      route: null,
      reasonCodes: ["no_deterministic_route"]
    });

    const route = compileV3FinancialTaskPlan({
      plan: plan("market_quote", "single"),
      message,
      locale: "az-AZ"
    });

    expect(route).toMatchObject({
      kind: "capability",
      route: "market_quote",
      locale: "az-AZ",
      symbols: ["AAPL"],
      requiresMarketData: true
    });
    expect(route?.reasonCodes).toEqual([
      "semantic_financial_planner:market_quote",
      "market_quote_currency:AZN"
    ]);
  });

  it("binds history ranges and comparison subjects only from the current turn", () => {
    const history = compileV3FinancialTaskPlan({
      plan: plan("market_history", "single"),
      message: "AAPL səhminin son 10 illik qiymət tarixçəsini göstər",
      locale: "az-AZ"
    });
    expect(history?.reasonCodes).toEqual([
      "semantic_financial_planner:market_history",
      "market_history_range:10y"
    ]);
    expect(history?.symbols).toEqual(["AAPL"]);

    const comparison = compileV3FinancialTaskPlan({
      plan: plan("company_research", "comparison"),
      message: "VOO ilə QQQ arasında əsas fərq nədir?",
      locale: "az-AZ"
    });
    expect(comparison).toMatchObject({
      route: "company_research",
      symbols: ["VOO", "QQQ"],
      researchFacet: "general"
    });
  });

  it("binds the normalized education query on the server without a topic bank", () => {
    const message = "What does bond duration mean?";
    const route = compileV3FinancialTaskPlan({
      plan: plan("education", "none"),
      message,
      locale: "en-US"
    });
    expect(route).toMatchObject({
      route: "education",
      symbols: []
    });
    expect(route?.reasonCodes).toEqual([
      "semantic_financial_planner:education",
      financialEducationRouteReason(message)
    ]);
  });

  it.each([
    plan("unsupported", "none"),
    plan("market_quote", "single", { certainty: "ambiguous" }),
    plan("market_quote", "single", { adviceClass: "order" }),
    plan("market_quote", "single", {
      adviceClass: "personalized_recommendation"
    }),
    plan("market_quote", "comparison"),
    plan("current_portfolio_value", "single")
  ])("fails closed for an unsafe or inconsistent proposal", (proposal) => {
    expect(compileV3FinancialTaskPlan({
      plan: proposal,
      message: "AAPL stock price",
      locale: "en-US"
    })).toBeNull();
  });

  it("uses structured, tool-less model classification and compiles its result", async () => {
    const generate = vi.fn(async (
      _prompt: string,
      _options: Readonly<Record<string, unknown>>
    ) => ({
      object: plan("market_quote", "single")
    }));
    const planner = new V3FinancialTaskPlanner({
      agent: { generate },
      timeoutMs: 1_000
    });

    const route = await planner.resolve({
      message: "AAPL sehminin kıymetini goster",
      locale: "az-AZ"
    });

    expect(route).toMatchObject({
      route: "market_quote",
      symbols: ["AAPL"],
      locale: "az-AZ"
    });
    const prompt = generate.mock.calls[0]?.[0];
    const options = generate.mock.calls[0]?.[1];
    expect(prompt).toContain("AAPL sehminin kıymetini goster");
    expect(options).toMatchObject({
      maxSteps: 1,
      toolChoice: "none",
      scorers: {},
      outputProcessors: [],
      providerOptions: {
        "assistant-v3": {
          modelTier: "primary",
          selectionReasonCode: "primary_default"
        }
      }
    });
    expect(options?.structuredOutput).toBeDefined();
  });

  it("returns no route for malformed output or provider failure", async () => {
    const malformed = new V3FinancialTaskPlanner({
      agent: { generate: async () => ({ object: { route: "market_quote" } }) },
      timeoutMs: 1_000
    });
    const unavailable = new V3FinancialTaskPlanner({
      agent: {
        generate: async () => {
          throw new Error("provider unavailable");
        }
      },
      timeoutMs: 1_000
    });

    await expect(malformed.resolve({
      message: "AAPL price",
      locale: "en-US"
    })).resolves.toBeNull();
    await expect(unavailable.resolve({
      message: "AAPL price",
      locale: "en-US"
    })).resolves.toBeNull();
  });
});
