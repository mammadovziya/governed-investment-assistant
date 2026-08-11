import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  V3_BOUNDARY_EXECUTION_CONTEXT_KEY
} from "../src/assistant-v3/boundary-tools.js";
import type { ToolExecutionEnvelope } from "../src/assistant-v3/contracts.js";
import { V3ToolGrantAuthority } from "../src/assistant-v3/grants.js";
import { v3BoundaryTools } from "../src/assistant-v3/index.js";
import { V3PrivateStudioExecutionBroker } from "../src/assistant-v3/studio-execution.js";
import { V3PrivateStudioKnowledgeVectorStore } from "../src/assistant-v3/studio-knowledge-vector.js";

function studioContext(extra: Array<[string, unknown]> = []): RequestContext<unknown> {
  return new RequestContext<unknown>([
    ["mastra__isStudio", true],
    ...extra
  ]);
}

async function invoke(
  tool: unknown,
  args: unknown,
  requestContext: RequestContext<unknown>
): Promise<ToolExecutionEnvelope<unknown>> {
  const execute = (tool as {
    execute?: (input: unknown, runtime: unknown) => Promise<unknown>;
  }).execute;
  if (!execute) throw new Error("Tool has no execute function.");
  return execute(args, { requestContext }) as Promise<ToolExecutionEnvelope<unknown>>;
}

describe("private Studio tool playground", () => {
  it("uses a Studio-selected, grant-gated synthetic scope without customer identifiers", async () => {
    const tool = v3BoundaryTools["read-portfolio-snapshot"];
    const requestContextSchema = (tool as { requestContextSchema: z.ZodTypeAny })
      .requestContextSchema;
    expect(requestContextSchema.safeParse({}).success).toBe(true);

    const result = await invoke(tool, {}, studioContext());
    expect(result).toMatchObject({
      schemaVersion: "assistant-v3.tool-execution.v1",
      toolId: "read-portfolio-snapshot",
      status: "success",
      result: {
        principalRef: "principal:synthetic-studio-client"
      },
      source: {
        provider: "synthetic-client-ledger",
        licenseClass: "synthetic"
      }
    });
    expect(JSON.stringify(result)).not.toContain("principal:mock-client-001");
  });

  it("ignores caller-supplied grant material when Mastra selects the Studio profile", async () => {
    const result = await invoke(
      v3BoundaryTools["read-portfolio-snapshot"],
      {},
      studioContext([[V3_BOUNDARY_EXECUTION_CONTEXT_KEY, {
        grantToken: "attacker-controlled-value"
      }]])
    );
    expect(result.status).toBe("success");
    expect(result.result).toMatchObject({
      principalRef: "principal:synthetic-studio-client"
    });
  });

  it("returns signed structured allocation evidence for the Studio synthetic portfolio", async () => {
    const result = await invoke(
      v3BoundaryTools["analyze-portfolio-allocation"],
      { scope: "current" },
      studioContext()
    );
    expect(result).toMatchObject({
      schemaVersion: "assistant-v3.tool-execution.v1",
      toolId: "analyze-portfolio-allocation",
      status: "success",
      result: {
        schemaVersion: "assistant-v3.portfolio-allocation-analysis.v1",
        scope: "current",
        dataClass: "synthetic",
        recommendationAllowed: false,
        metrics: {
          largestPosition: expect.any(String),
          largestAllocationRate: expect.any(String),
          topTwoAllocationRate: expect.any(String),
          technologyAndTechnologyDependentRate: expect.any(String),
          cashAllocationRate: expect.any(String)
        }
      },
      source: {
        provider: "assistant-v3-allocation-engine",
        licenseClass: "synthetic"
      }
    });
    expect(JSON.stringify(result)).not.toContain("principal:mock-client-001");
  });

  it("keeps the signed handoff write disabled while returning a structured result", async () => {
    const result = await invoke(
      v3BoundaryTools["create-signed-order-handoff"],
      {
        intentId: "00000000-0000-4000-8000-000000000001",
        explicitConfirmation: true
      },
      studioContext()
    );
    expect(result).toMatchObject({
      toolId: "create-signed-order-handoff",
      status: "unavailable",
      result: null,
      error: {
        code: "STUDIO_ORDER_HANDOFF_DISABLED",
        retryable: false
      }
    });
    expect(JSON.stringify(result)).not.toContain("handoffRef");
  });

  it("retrieves only eligible approved demo evidence from process-memory Studio storage", async () => {
    const result = await invoke(
      v3BoundaryTools["retrieve-approved-product-knowledge"],
      { query: "What fees does Demo Invest charge?" },
      studioContext()
    );
    expect(result).toMatchObject({
      toolId: "retrieve-approved-product-knowledge",
      status: "success",
      result: {
        status: "grounded",
        locale: "en-US",
        jurisdiction: "AZ",
        retrieval: {
          trustedFilter: {
            approvalStatus: "approved",
            channel: "customer_chat",
            productScopes: ["DEMO_INVEST"]
          }
        }
      },
      source: {
        provider: "demo-invest-approved-knowledge",
        licenseClass: "synthetic"
      }
    });
    const chunks = (result.result as { chunks?: unknown[] } | null)?.chunks ?? [];
    expect(chunks.length).toBeGreaterThan(0);
  });

  it.each([
    [
      "How is a purchase operation carried out?",
      "demo-invest-purchase-process-en"
    ],
    [
      "Information on trading days and hours",
      "demo-invest-market-hours-en"
    ]
  ])("returns the matching approved Studio source for %s", async (query, sourceId) => {
    const result = await invoke(
      v3BoundaryTools["retrieve-approved-product-knowledge"],
      { query },
      studioContext()
    );

    expect(result).toMatchObject({
      toolId: "retrieve-approved-product-knowledge",
      status: "success",
      result: {
        status: "grounded",
        chunks: [{
          metadata: { sourceId }
        }]
      }
    });
  });

  it.each([
    "is there insurence against the risk of loss of securities and cash",
    "IN whose name are the purchased securities reegistered?",
    "How is a sale operaton carried out?",
    "Are there any trande restrictions?",
    "Are investment profits subject to taxation"
  ])("fails closed in Studio when no approved FAQ authority exists: %s", async (query) => {
    const result = await invoke(
      v3BoundaryTools["retrieve-approved-product-knowledge"],
      { query },
      studioContext()
    );

    expect(result).toMatchObject({
      toolId: "retrieve-approved-product-knowledge",
      status: "unavailable",
      result: null,
      error: {
        code: "KNOWLEDGE_INSUFFICIENT_EVIDENCE",
        retryable: false
      }
    });
    expect(JSON.stringify(result)).not.toMatch(
      /commission|funding method|withdrawal rules|product overview/iu
    );
  });

  it.each(["A", "ON", "IT", "ARE", "I", "BRK.B"])(
    "authorizes canonical public ticker %s without natural-language reinterpretation",
    (symbol) => {
      const grants = new V3ToolGrantAuthority();
      const broker = new V3PrivateStudioExecutionBroker({ grantAuthority: grants });
      const execution = broker.issue({
        toolId: "read-market-snapshot",
        args: { symbol },
      });
      expect(broker.isDenied(execution)).toBe(false);
      if (broker.isDenied(execution)) throw new Error("Unexpected Studio denial.");
      expect(execution.policy).toMatchObject({
        authorized: true,
        route: "market_quote",
      });
      expect(execution.policy.allowedToolIds).toContain("read-market-snapshot");
      expect(execution.trustedContext.principalRef).toBe(
        "principal:synthetic-studio-client",
      );
      expect(grants.revoke(execution.grantToken)).toBe(true);
    },
  );

  it("authorizes current market-price conversion under the public quote route", () => {
    const grants = new V3ToolGrantAuthority();
    const broker = new V3PrivateStudioExecutionBroker({ grantAuthority: grants });
    const execution = broker.issue({
      toolId: "convert-currency",
      args: {
        scope: "current-market-price",
        symbol: "NVDA",
        targetCurrency: "AZN"
      }
    });

    expect(broker.isDenied(execution)).toBe(false);
    if (broker.isDenied(execution)) throw new Error("Unexpected Studio denial.");
    expect(execution.policy).toMatchObject({
      authorized: true,
      route: "market_quote"
    });
    expect(execution.policy.allowedToolIds).toContain("convert-currency");
    expect(grants.revoke(execution.grantToken)).toBe(true);
  });

  it("authorizes allocation analysis under the route bound to its exact scope", () => {
    const grants = new V3ToolGrantAuthority();
    const broker = new V3PrivateStudioExecutionBroker({ grantAuthority: grants });
    const hypotheticalArgs = {
      scope: "hypothetical" as const,
      currency: "USD" as const,
      totalValue: "20000.00000000",
      allocations: [
        {
          label: "Tesla",
          symbol: "TSLA",
          category: "Consumer discretionary",
          theme: "technology-dependent" as const,
          allocationRate: "0.40000000",
          amount: "8000.00000000"
        },
        {
          label: "NVIDIA",
          symbol: "NVDA",
          category: "Technology",
          theme: "technology" as const,
          allocationRate: "0.30000000",
          amount: "6000.00000000"
        },
        {
          label: "Microsoft",
          symbol: "MSFT",
          category: "Technology",
          theme: "technology" as const,
          allocationRate: "0.20000000",
          amount: "4000.00000000"
        },
        {
          label: "Cash",
          symbol: null,
          category: "Cash",
          theme: "cash" as const,
          allocationRate: "0.10000000",
          amount: "2000.00000000"
        }
      ]
    };
    const cases = [
      {
        args: { scope: "current" as const },
        route: "portfolio_allocation_analysis"
      },
      {
        args: hypotheticalArgs,
        route: "hypothetical_portfolio_analysis"
      }
    ] as const;

    for (const item of cases) {
      const execution = broker.issue({
        toolId: "analyze-portfolio-allocation",
        args: item.args
      });
      expect(broker.isDenied(execution)).toBe(false);
      if (broker.isDenied(execution)) throw new Error("Unexpected Studio denial.");
      expect(execution.policy).toMatchObject({
        authorized: true,
        route: item.route,
        allowedToolIds: ["analyze-portfolio-allocation"]
      });
      expect(execution.trustedContext.principalRef).toBe(
        "principal:synthetic-studio-client"
      );
      expect(grants.revoke(execution.grantToken)).toBe(true);
    }
  });

  it("binds reviewed education Studio authority to the exact normalized query", () => {
    const query = "İstiqraz müddəti nədir?";
    const grants = new V3ToolGrantAuthority();
    const broker = new V3PrivateStudioExecutionBroker({ grantAuthority: grants });
    const execution = broker.issue({
      toolId: "retrieve-reviewed-investment-education",
      args: { query }
    });

    expect(broker.isDenied(execution)).toBe(false);
    if (broker.isDenied(execution)) throw new Error("Unexpected Studio denial.");
    expect(execution.policy).toMatchObject({
      authorized: true,
      route: "education",
      allowedToolIds: ["retrieve-reviewed-investment-education"]
    });
    expect(execution.policy.reasonCodes).toEqual(["policy_allow"]);
    expect(execution.trustedContext.locale).toBe("az-AZ");
    expect(grants.revoke(execution.grantToken)).toBe(true);

    expect(() => broker.issue({
      toolId: "retrieve-reviewed-investment-education",
      args: { query: `  ${query}` }
    })).toThrowError(/normalized query/i);
    expect(() => broker.issue({
      toolId: "retrieve-reviewed-investment-education",
      args: { query, topicId: "duration" }
    })).toThrowError(/normalized query/i);
  });

  it("filters the process-memory knowledge index with only reviewed operators", async () => {
    const vectors = new V3PrivateStudioKnowledgeVectorStore();
    await vectors.createIndex({
      indexName: "studio_filter_test",
      dimension: 2,
      metric: "cosine",
    });
    await vectors.upsert({
      indexName: "studio_filter_test",
      ids: ["en", "az"],
      vectors: [[1, 0], [1, 0]],
      metadata: [{ locale: "en-US" }, { locale: "az-AZ" }],
    });

    const eligible = await vectors.query({
      indexName: "studio_filter_test",
      queryVector: [1, 0],
      topK: 5,
      filter: { $and: [{ locale: { $in: ["en-US"] } }] },
      includeVector: false,
    });
    expect(eligible.map(({ id }) => id)).toEqual(["en"]);

    const unknownOperator = await vectors.query({
      indexName: "studio_filter_test",
      queryVector: [1, 0],
      topK: 5,
      filter: { $or: [{ locale: "az-AZ" }] },
      includeVector: false,
    });
    expect(unknownOperator).toEqual([]);
  });
});
