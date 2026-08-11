import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { KnowledgeQueryContext, KnowledgeToolResult } from "../src/domain/knowledge.js";
import type {
  FinancialEducationQueryContext,
  FinancialEducationRetrievalResult
} from "../src/domain/financial-education.js";
import type { SecurityResearchReport } from "../src/domain/security-research.js";
import type { MarketHistoryRange, MarketHistorySeries } from "../src/domain/market-history.js";
import type { MarketSnapshot } from "../src/domain/types.js";
import {
  V3_BOUNDARY_EXECUTION_CONTEXT_KEY,
  V3BoundaryToolAuthorizationError,
  createV3BoundaryTools,
  type V3BoundaryExecutionContext,
  type V3BoundaryToolDependencies
} from "../src/assistant-v3/boundary-tools.js";
import { SyntheticPortfolioPort } from "../src/assistant-v3/adapters.js";
import type {
  ToolExecutionEnvelope,
  ToolSource,
  TrustedRequestContext
} from "../src/assistant-v3/contracts.js";
import {
  decimal,
  formatFixedDecimal,
  multiplyFixed,
  parseFixedDecimal
} from "../src/assistant-v3/fixed-decimal.js";
import { financialEducationQueryHash } from "../src/assistant-v3/financial-education-query.js";
import { V3ToolGrantAuthority } from "../src/assistant-v3/grants.js";
import { mockPortfolioSnapshot } from "../src/assistant-v3/mock-portfolio.js";
import {
  V3_APPROVED_BOUNDARY_TOOL_IDS,
  evaluateV3Policy,
  type V3ApprovedBoundaryToolId
} from "../src/assistant-v3/policy.js";
import { YAHOO_DEVELOPMENT_PROVIDER } from "../src/assistant-v3/providers.js";
import { routeV3Request } from "../src/assistant-v3/routing.js";
import { V3SessionAuthority, type V3TrustedSession } from "../src/assistant-v3/sessions.js";
import { DevHmacSigner, verifyEnvelope } from "../src/assistant-v3/signing.js";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");
const AS_OF = "2026-07-22T11:59:59.000Z";

const internalSource = (sourceId: string): ToolSource => ({
  provider: "v3-test-port",
  sourceId,
  sourceUrl: null,
  licenseClass: "synthetic",
  observedAt: AS_OF,
  sourceAsOf: AS_OF
});

function marketSnapshot(): MarketSnapshot {
  return {
    symbol: "NVDA",
    displayName: "NVIDIA Corporation",
    currency: "USD",
    exchange: "NasdaqGS",
    instrumentType: "EQUITY",
    price: 203.28,
    previousClose: 202.81,
    change: 0.46999999999999886,
    changePercent: 0.23174399684433653,
    marketState: "CLOSED",
    freshness: "indicative",
    delayMinutes: 0,
    asOf: AS_OF,
    source: "Yahoo Finance chart endpoint",
    notice: "Informational snapshot."
  };
}

function researchReport(): SecurityResearchReport {
  const unavailable = {
    status: "unavailable" as const,
    data: null,
    sources: [],
    unavailableFields: ["not-returned"],
    issues: []
  };
  return {
    symbol: "NVDA",
    generatedAt: AS_OF,
    overallStatus: "partial",
    profile: {
      status: "partial",
      data: {
        symbol: "NVDA",
        name: "NVIDIA Corporation",
        quoteType: "EQUITY",
        exchange: "NasdaqGS",
        exchangeDisplayName: "NASDAQ",
        sector: "Technology",
        industry: "Semiconductors",
        businessSummary: null,
        websiteUrl: null,
        employeeCount: null,
        headquarters: { city: null, state: null, country: null },
        asOf: AS_OF
      },
      sources: [],
      unavailableFields: ["businessSummary"],
      issues: []
    },
    fundamentals: unavailable,
    valuation: unavailable,
    earnings: unavailable,
    dividends: {
      status: "available",
      data: {
        metrics: [{
          key: "dividend-yield",
          label: "Dividend yield",
          value: 0.03,
          unit: "percent",
          currency: null,
          period: "TTM",
          asOf: AS_OF,
          asOfBasis: "provider-market-time",
          source: "yahoo-quote-summary",
          sourceUrl: "https://finance.yahoo.com/quote/NVDA/key-statistics/",
          derivation: "provider-reported",
          calculation: "provider decimal yield × 100"
        }],
        lastDividend: {
          amount: 0.01,
          currency: "USD",
          date: "2026-05-10T00:00:00.000Z",
          dateBasis: "provider-reported-last-dividend-date"
        }
      },
      sources: [{
        provider: "yahoo-quote-summary",
        label: "Yahoo Finance dividend statistics",
        url: "https://finance.yahoo.com/quote/NVDA/key-statistics/",
        retrievedAt: AS_OF
      }],
      unavailableFields: [],
      issues: []
    },
    analystConsensus: {
      status: "available",
      data: {
        recommendation: "Strong Buy",
        analystCount: 58,
        targetPrice: 225.5,
        currency: "USD",
        asOf: AS_OF
      },
      sources: [{
        provider: "yahoo-quote-summary",
        label: "Yahoo Finance analyst estimates",
        url: "https://finance.yahoo.com/quote/NVDA/analysis/",
        retrievedAt: AS_OF
      }],
      unavailableFields: [],
      issues: []
    },
    newsAndCatalysts: {
      status: "available",
      data: { news: [], catalysts: [] },
      sources: [],
      unavailableFields: [],
      issues: []
    },
    priceRisk: unavailable,
    notices: []
  };
}

function knowledgeResult(context: KnowledgeQueryContext): KnowledgeToolResult {
  return {
    status: "dependency_unavailable",
    queryHash: "query-hash",
    locale: context.locale,
    jurisdiction: "AZ",
    chunks: [],
    retrieval: {
      traceId: "trace-v3-boundary",
      queryHash: "query-hash",
      indexGeneration: "knowledge-v3-test",
      vectorStore: "LibSQLVector",
      retrievalMethod: "mastra-chunked-hash-vector-plus-lexical-rerank",
      embeddingProfile: "deterministic-hash-384-v1",
      trustedFilter: {
        locale: context.locale,
        jurisdiction: "AZ",
        approvalStatus: "approved",
        productScopes: ["DEMO_INVEST"],
        channel: "customer_chat",
        asOf: context.asOf
      },
      facet: "fees",
      eligibleCandidateCount: 0,
      vectorCandidateCount: 0,
      selectedChunkIds: [],
      rejectedCandidateCount: 0,
      durationMs: 2
    },
    reason: "Dependency unavailable."
  };
}

function financialEducationResult(
  query: string,
  context: FinancialEducationQueryContext
): FinancialEducationRetrievalResult {
  const queryHash = financialEducationQueryHash(query);
  if (queryHash === null) throw new Error("test query is invalid");
  const propositionId = "twr-compounded-growth";
  const citationId = "financial-education-twr-compounded-growth";
  const sourceId = context.locale === "az-AZ"
    ? "federal-register-time-weighted-return-az"
    : "federal-register-time-weighted-return-en";
  const text = context.locale === "az-AZ"
    ? "Vaxt üzrə çəkilən gəlirlilik (TWR) xarici pul axınlarının nə vaxt baş verdiyinin təsirini azaltmaqla ölçmə dövrü üzrə investisiya nəticəsini göstərən üsuldur."
    : "A time-weighted return (TWR) is a method for reporting investment performance over a measurement period while reducing the effect of when external cash flows occur.";
  return {
    schemaVersion: "assistant-v3.financial-education-retrieval.v1",
    status: "grounded",
    requestId: context.requestId,
    queryHash,
    locale: context.locale,
    propositions: [{
      propositionId,
      text,
      locale: context.locale,
      sourceId,
      sourceVersion: "2026-07-28.v1",
      relevanceScore: 1,
      lexicalScore: 1,
      vectorScore: 1,
      citationId
    }],
    citations: [{
      citationId,
      propositionId,
      sourceId,
      version: "2026-07-28.v1",
      translationGroupId: "federal-register-time-weighted-return",
      title: "Time-weighted return",
      sourceUrl:
        "https://www.govinfo.gov/content/pkg/FR-2024-03-12/pdf/2024-03473.pdf",
      locale: context.locale,
      jurisdiction: "AZ",
      section: "Time-weighted return",
      excerpt: text,
      publishedAt: "2024-03-12T00:00:00.000Z",
      effectiveFrom: "2024-03-12T00:00:00.000Z",
      effectiveTo: null,
      reviewedAt: "2026-07-21T00:00:00.000Z",
      reviewDueAt: "2027-07-21T00:00:00.000Z",
      contentSha256: "a".repeat(64)
    }],
    retrieval: {
      retrievalMethod:
        "approved-corpus-deterministic-vector-plus-lexical-rerank",
      queryHash,
      locale: context.locale,
      authorityId: "test-approved-financial-education",
      minimumScore: 0.2,
      topK: 3,
      eligibleDocumentCount: 1,
      eligiblePropositionCount: 1,
      selectedPropositionIds: [propositionId]
    },
    reasonCodes: []
  };
}

function signer(): DevHmacSigner {
  return new DevHmacSigner({
    keyId: "v3-boundary-test-key",
    secret: "v3-boundary-test-secret-0123456789abcdef"
  });
}

function session(): V3TrustedSession {
  return new V3SessionAuthority({
    secret: "v3-boundary-session-secret-that-is-long-enough",
    now: () => NOW
  }).issue({
    tenantId: "tenant-1",
    principalId: "principal-1",
    authContextId: "auth-1",
    consentVersion: "consent-v3",
    consents: [
      "assistant_use",
      "portfolio_data",
      "public_market_data",
      "approved_knowledge"
    ],
    entitlementVersion: "entitlements-v3",
    entitlements: [
      "assistant_access",
      "portfolio_read",
      "market_read",
      "research_read",
      "knowledge_read",
      "order_preview"
    ]
  }).session;
}

interface Fixture {
  dependencies: V3BoundaryToolDependencies;
  signer: DevHmacSigner;
  grants: V3ToolGrantAuthority;
  spies: {
    resolve: ReturnType<typeof vi.fn>;
    snapshot: ReturnType<typeof vi.fn>;
    research: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
    currencyRate: ReturnType<typeof vi.fn>;
    portfolioSnapshot: ReturnType<typeof vi.fn>;
    activity: ReturnType<typeof vi.fn>;
    knowledge: ReturnType<typeof vi.fn>;
    education: ReturnType<typeof vi.fn>;
    eligibility: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
  };
}

function fixture(): Fixture {
  const serviceSigner = signer();
  const grants = new V3ToolGrantAuthority({ now: () => NOW });
  const { activity, ...positionSnapshot } = structuredClone(mockPortfolioSnapshot);
  positionSnapshot.principalRef = "principal-1";
  const spies = {
    resolve: vi.fn(async (symbol: string) => ({
      instrumentId: `US:${symbol}`,
      symbol,
      displayName: "NVIDIA Corporation",
      instrumentType: "EQUITY" as const,
      exchange: "NasdaqGS",
      currency: "USD",
      resolvedAt: AS_OF
    })),
    snapshot: vi.fn(async (symbol: string) => {
      const metadata = positionSnapshot.instrumentMetadata.find(
        (item) => item.symbol === symbol
      );
      return {
        ...marketSnapshot(),
        symbol,
        displayName: metadata?.displayName ?? symbol
      };
    }),
    research: vi.fn(async () => researchReport()),
    history: vi.fn(async (
      symbol: string,
      range: MarketHistoryRange
    ): Promise<MarketHistorySeries> => ({
      symbol,
      range,
      interval: "1d" as const,
      currency: "USD",
      exchange: "NasdaqGS",
      asOf: AS_OF,
      source: "Yahoo Finance chart endpoint",
      points: [{ timestamp: AS_OF, close: 203.28 }]
    })),
    currencyRate: vi.fn(async (
      sourceCurrency: "USD" | "AZN",
      targetCurrency: "USD" | "AZN"
    ) => ({
      sourceCurrency,
      targetCurrency,
      exchangeRate: decimal(
        sourceCurrency === targetCurrency
          ? "1"
          : sourceCurrency === "USD"
            ? "1.7"
            : "0.58823529"
      ),
      effectiveDate: "2026-07-22",
      asOf: "2026-07-22T00:00:00+04:00",
      sourceUrl: "https://www.cbar.az/currencies/22.07.2026.xml"
    })),
    portfolioSnapshot: vi.fn(async () => positionSnapshot),
    activity: vi.fn(async () => activity),
    knowledge: vi.fn(async (_query: string, context: KnowledgeQueryContext) =>
      knowledgeResult(context)
    ),
    education: vi.fn(async (input: {
      query: string;
      context: FinancialEducationQueryContext;
    }) => financialEducationResult(input.query, input.context)),
    eligibility: vi.fn(async () => ({
      eligible: true,
      currency: "USD" as const,
      maximumNotional: decimal("10000"),
      tariffId: "investor" as const,
      requiredDisclosureCodes: [],
      checkedAt: AS_OF,
      reasonCodes: []
    })),
    confirm: vi.fn(() => ({
      handoffRef: "signed-handoff",
      payload: {
        schemaVersion: "assistant-v3.order-handoff.v1" as const,
        handoffId: "handoff-1",
        intentId: "00000000-0000-4000-8000-000000000001",
        principalRef: "principal-1",
        tenantRef: "tenant-1",
        previewRequestId: "request-1",
        side: "BUY" as const,
        symbol: "NVDA",
        requestedNotional: decimal("100"),
        currency: "USD" as const,
        issuedAt: AS_OF,
        expiresAt: "2026-07-22T12:04:59.000Z",
        nonce: "nonce",
        executionAllowed: false as const
      },
      expiresAt: "2026-07-22T12:04:59.000Z",
      oneUse: true as const,
      destination: "/orders/preview" as const
    }))
  };

  return {
    signer: serviceSigner,
    grants,
    spies,
    dependencies: {
      grantAuthority: grants,
      signer: serviceSigner,
      instrumentResolver: { source: internalSource("instrument-master"), resolve: spies.resolve },
      market: {
        descriptor: YAHOO_DEVELOPMENT_PROVIDER,
        getSnapshot: spies.snapshot,
        getResearch: spies.research
      },
      priceHistory: { source: internalSource("price-history"), getHistory: spies.history },
      currencyRates: {
        source: {
          ...internalSource("official-currency-rates"),
          provider: "central-bank-of-azerbaijan",
          sourceUrl: "https://www.cbar.az/currency/rates?language=en",
          licenseClass: "public-indicative"
        },
        getRate: spies.currencyRate
      },
      portfolio: {
        source: internalSource("portfolio"),
        readSnapshot: spies.portfolioSnapshot,
        readActivity: spies.activity
      },
      approvedKnowledge: {
        source: { ...internalSource("approved-knowledge"), licenseClass: "project-internal" },
        retrieve: spies.knowledge
      },
      financialEducation: {
        source: {
          ...internalSource("approved-financial-education"),
          licenseClass: "project-internal"
        },
        retrieve: spies.education
      },
      orderEligibility: {
        source: { ...internalSource("order-eligibility"), licenseClass: "project-internal" },
        readEligibility: spies.eligibility
      },
      orderHandoff: {
        source: { ...internalSource("order-handoff"), licenseClass: "project-internal" },
        confirm: spies.confirm
      },
      now: () => NOW
    }
  };
}

function trustedContext(
  policyVersion: string,
  overrides: Partial<TrustedRequestContext> = {}
): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-1",
    sessionId: overrides.sessionId ?? "",
    conversationId: "conversation-1",
    principalRef: "principal-1",
    tenantRef: "tenant-1",
    locale: "en-US",
    jurisdiction: "AZ",
    channel: "test",
    environment: "test",
    requestedAt: AS_OF,
    authentication: overrides.authentication ?? {
      strength: "authenticated",
      authContextRef: "auth-1"
    },
    consentVersion: "consent-v3",
    consentScopes: [
      "assistant_use",
      "portfolio_data",
      "public_market_data",
      "approved_knowledge"
    ],
    entitlementVersion: "entitlements-v3",
    entitlements: [
      "assistant_access",
      "portfolio_read",
      "market_read",
      "research_read",
      "knowledge_read",
      "order_preview"
    ],
    policyVersion,
    capabilities: ["portfolio-read", "market-read", "approved-knowledge-read"],
    featureSnapshot: { version: "features-v3", flags: {} },
    ...overrides
  };
}

function grantedContext(input: {
  fixture: Fixture;
  message: string;
  toolId: V3ApprovedBoundaryToolId;
  args: unknown;
  trustedContextOverrides?: Partial<TrustedRequestContext>;
}): RequestContext<unknown> {
  const userSession = session();
  const route = routeV3Request(input.message);
  const policy = evaluateV3Policy({ route, session: userSession, now: NOW });
  const grant = input.fixture.grants.issue({
    requestId: "request-1",
    workflowRunId: "workflow-1",
    route,
    policy,
    session: userSession,
    toolId: input.toolId,
    args: input.args
  });
  const execution: V3BoundaryExecutionContext = {
    grantToken: grant.token,
    requestId: "request-1",
    workflowRunId: "workflow-1",
    policy,
    session: userSession,
    trustedContext: trustedContext(policy.policyVersion, {
      sessionId: userSession.claims.sessionId,
      ...input.trustedContextOverrides
    })
  };
  return new RequestContext<unknown>([
    [V3_BOUNDARY_EXECUTION_CONTEXT_KEY, execution]
  ]);
}

async function invoke(
  tool: unknown,
  args: unknown,
  requestContext?: RequestContext<unknown>
): Promise<ToolExecutionEnvelope<unknown>> {
  const execute = (tool as {
    execute?: ((input: unknown, context: unknown) => Promise<unknown>) | undefined;
  }).execute;
  if (!execute) throw new Error("Tool has no execute function");
  return execute(args, { requestContext }) as Promise<ToolExecutionEnvelope<unknown>>;
}

function inputSchema(tool: unknown): z.ZodTypeAny {
  return (tool as { inputSchema?: unknown }).inputSchema as z.ZodTypeAny;
}

describe("V3 Mastra boundary tools", () => {
  it("registers exactly the thirteen approved IDs and exposes no generic transport arguments", () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);

    expect(Object.keys(tools)).toEqual(V3_APPROVED_BOUNDARY_TOOL_IDS);
    expect(Object.values(tools).map(({ id }) => id)).toEqual(V3_APPROVED_BOUNDARY_TOOL_IDS);
    const currencySchema = inputSchema(tools["convert-currency"]);
    expect(currencySchema.safeParse({
      scope: "provided-amount",
      amount: "100.00000000",
      sourceCurrency: "USD",
      targetCurrency: "AZN"
    }).success).toBe(true);
    expect(currencySchema.safeParse({
      scope: "current-portfolio-value",
      targetCurrency: "AZN"
    }).success).toBe(true);
    expect(currencySchema.safeParse({
      scope: "current-market-price",
      symbol: "NVDA",
      targetCurrency: "AZN"
    }).success).toBe(true);
    expect(currencySchema.safeParse({
      scope: "provided-amount",
      amount: "100",
      sourceCurrency: "USD",
      targetCurrency: "EUR"
    }).success).toBe(false);
    const allocationSchema = inputSchema(tools["analyze-portfolio-allocation"]);
    expect(allocationSchema.safeParse({ scope: "current" }).success).toBe(true);
    expect(allocationSchema.safeParse({
      scope: "current",
      accountId: "must-not-cross-the-boundary"
    }).success).toBe(false);
    expect(allocationSchema.safeParse({
      scope: "hypothetical",
      currency: "USD",
      totalValue: "20000.00000000",
      allocations: [
        {
          label: "Tesla",
          symbol: "TSLA",
          category: "Consumer discretionary",
          theme: "technology-dependent",
          allocationRate: "0.40000000",
          amount: "8000.00000000"
        },
        {
          label: "NVIDIA",
          symbol: "NVDA",
          category: "Technology",
          theme: "technology",
          allocationRate: "0.30000000",
          amount: "6000.00000000"
        },
        {
          label: "Microsoft",
          symbol: "MSFT",
          category: "Technology",
          theme: "technology",
          allocationRate: "0.20000000",
          amount: "4000.00000000"
        },
        {
          label: "Cash",
          symbol: null,
          category: "Cash",
          theme: "cash",
          allocationRate: "0.10000000",
          amount: "2000.00000000"
        }
      ]
    }).success).toBe(true);
    expect(currencySchema.safeParse({
      scope: "current-portfolio-value",
      targetCurrency: "AZN",
      principalId: "x"
    }).success).toBe(false);
    expect(currencySchema.safeParse({
      scope: "current-market-price",
      symbol: "nvda",
      targetCurrency: "AZN"
    }).success).toBe(false);
    expect(inputSchema(tools["read-portfolio-snapshot"]).safeParse({ clientId: "x" }).success).toBe(false);
    expect(
      inputSchema(tools["read-portfolio-activity"]).safeParse({
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: AS_OF,
        accountId: "x"
      }).success
    ).toBe(false);
    expect(
      inputSchema(tools["retrieve-reviewed-investment-education"]).safeParse({
        query: "What is TWR?"
      }).success
    ).toBe(true);
    expect(
      inputSchema(tools["retrieve-reviewed-investment-education"]).safeParse({
        query: "What is TWR?",
        topicId: "time-weighted-return",
        answer: "ready text"
      }).success
    ).toBe(false);
    expect(
      inputSchema(tools["retrieve-approved-product-knowledge"]).safeParse({
        query: "fees",
        url: "https://example.com",
        filter: { approvalStatus: "anything" },
        sql: "select *"
      }).success
    ).toBe(false);
    expect(
      inputSchema(tools["read-order-eligibility"]).safeParse({
        symbol: "NVDA",
        side: "BUY",
        requestedNotional: "100.00000000",
        accountId: "x"
      }).success
    ).toBe(false);
    expect(
      inputSchema(tools["read-order-eligibility"]).safeParse({
        symbol: "NVDA",
        side: "BUY",
        requestedNotional: "0.00000000"
      }).success
    ).toBe(false);
  });

  it("strictly validates discriminated recent-trading arguments and bounded limits", () => {
    const tools = createV3BoundaryTools(fixture().dependencies);
    const schema = inputSchema(tools["read-portfolio-activity"]);
    const recent = {
      queryType: "recent-trading",
      limit: 10,
      include: "all",
      symbol: "NVDA",
      side: "BUY"
    };

    expect(schema.safeParse(recent).success).toBe(true);
    expect(schema.safeParse({
      queryType: "period-ledger",
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: AS_OF
    }).success).toBe(true);
    expect(schema.safeParse({ ...recent, limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...recent, limit: 11 }).success).toBe(false);
    expect(schema.safeParse({ ...recent, limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ ...recent, symbol: "nvda" }).success).toBe(false);
    expect(schema.safeParse({ ...recent, include: ["orders"] }).success).toBe(false);
    expect(schema.safeParse({ ...recent, clientId: "client-secret" }).success).toBe(false);
    expect(schema.safeParse({ ...recent, accountId: "account-secret" }).success).toBe(false);
    expect(schema.safeParse({
      ...recent,
      periodStart: "2026-01-01T00:00:00.000Z"
    }).success).toBe(false);
  });

  it("signs structured hypothetical allocation analysis without a ready answer", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {
      scope: "hypothetical" as const,
      currency: "USD" as const,
      totalValue: decimal("20000"),
      allocations: [
        {
          label: "Tesla",
          symbol: "TSLA",
          category: "Consumer discretionary",
          theme: "technology-dependent" as const,
          allocationRate: decimal("0.40"),
          amount: decimal("8000")
        },
        {
          label: "NVIDIA",
          symbol: "NVDA",
          category: "Technology",
          theme: "technology" as const,
          allocationRate: decimal("0.30"),
          amount: decimal("6000")
        },
        {
          label: "Microsoft",
          symbol: "MSFT",
          category: "Technology",
          theme: "technology" as const,
          allocationRate: decimal("0.20"),
          amount: decimal("4000")
        },
        {
          label: "Cash",
          symbol: null,
          category: "Cash",
          theme: "cash" as const,
          allocationRate: decimal("0.10"),
          amount: decimal("2000")
        }
      ]
    };
    const requestContext = grantedContext({
      fixture: current,
      message:
        "I have a portfolio worth $20,000: 40% Tesla, 30% NVIDIA, 20% Microsoft, 10% cash. Analyze my allocation.",
      toolId: "analyze-portfolio-allocation",
      args
    });

    const result = await invoke(
      tools["analyze-portfolio-allocation"],
      args,
      requestContext
    );

    expect(result).toMatchObject({
      toolId: "analyze-portfolio-allocation",
      status: "success",
      result: {
        schemaVersion: "assistant-v3.portfolio-allocation-analysis.v1",
        scope: "hypothetical",
        totalValue: "20000.00000000",
        metrics: {
          largestPosition: "TSLA",
          largestAllocationRate: "0.40000000",
          topTwoAllocationRate: "0.70000000",
          technologyAndTechnologyDependentRate: "0.90000000",
          cashAllocationRate: "0.10000000"
        },
        riskProfile: null,
        recommendationAllowed: false
      }
    });
    expect(verifyEnvelope(result, current.signer)).toBe(true);
    expect(JSON.stringify(result.result)).not.toMatch(
      /you should|i recommend|consider selling|substantial single-company/iu
    );
  });

  it("uses scoped portfolio and market evidence inside current allocation analysis", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = { scope: "current" as const };
    const requestContext = grantedContext({
      fixture: current,
      message: "What are the biggest risks in this portfolio?",
      toolId: "analyze-portfolio-allocation",
      args
    });

    const result = await invoke(
      tools["analyze-portfolio-allocation"],
      args,
      requestContext
    );

    expect(result).toMatchObject({
      toolId: "analyze-portfolio-allocation",
      status: "success",
      result: {
        scope: "current",
        dataClass: "synthetic",
        currency: "USD",
        riskProfile: {
          riskBand: "MODERATE",
          singleStockTargetMaxAllocationRate: "0.20000000"
        },
        recommendationAllowed: false
      }
    });
    expect(current.spies.portfolioSnapshot).toHaveBeenCalledTimes(1);
    expect(current.spies.snapshot).toHaveBeenCalledTimes(3);
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("rejects an allocation scope that disagrees with the authorized route", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = { scope: "current" as const };
    const requestContext = grantedContext({
      fixture: current,
      message: "Imagine my portfolio is 60% NVDA, 20% AAPL, 20% cash.",
      toolId: "analyze-portfolio-allocation",
      args
    });

    await expect(invoke(
      tools["analyze-portfolio-allocation"],
      args,
      requestContext
    )).resolves.toMatchObject({
      status: "unavailable",
      error: { code: "ALLOCATION_ANALYSIS_SCOPE_MISMATCH" }
    });
    expect(current.spies.portfolioSnapshot).not.toHaveBeenCalled();
  });

  it("rejects direct and Studio execution before any dependency call", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);

    const validArgs: Record<V3ApprovedBoundaryToolId, unknown> = {
      "resolve-instrument": { symbol: "NVDA" },
      "read-market-snapshot": { symbol: "NVDA" },
      "read-price-history": { symbol: "NVDA", range: "1y" },
      "read-instrument-research": { symbol: "NVDA" },
      "read-market-content": { symbol: "NVDA" },
      "convert-currency": {
        scope: "provided-amount",
        amount: "100.00000000",
        sourceCurrency: "USD",
        targetCurrency: "AZN"
      },
      "analyze-portfolio-allocation": { scope: "current" },
      "read-portfolio-snapshot": {},
      "read-portfolio-activity": {
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: AS_OF
      },
      "retrieve-reviewed-investment-education": {
        query: "What is TWR?"
      },
      "retrieve-approved-product-knowledge": { query: "fees" },
      "read-order-eligibility": {
        symbol: "NVDA",
        side: "BUY",
        requestedNotional: "100.00000000"
      },
      "create-signed-order-handoff": {
        intentId: "00000000-0000-4000-8000-000000000001",
        explicitConfirmation: true
      }
    };
    for (const toolId of V3_APPROVED_BOUNDARY_TOOL_IDS) {
      await expect(invoke(tools[toolId], validArgs[toolId])).rejects.toBeInstanceOf(
        V3BoundaryToolAuthorizationError
      );
    }

    const studioRequestContext = grantedContext({
      fixture: current,
      message: "What is the current NVDA price?",
      toolId: "read-market-snapshot",
      args: { symbol: "NVDA" },
      trustedContextOverrides: { channel: "mastra-studio" }
    });
    await expect(
      invoke(
        tools["read-market-snapshot"],
        { symbol: "NVDA" },
        studioRequestContext
      )
    ).rejects.toMatchObject({ code: "studio_direct_execution_forbidden" });
    expect(current.spies.snapshot).not.toHaveBeenCalled();
  });

  it("burns a grant when canonical tool arguments do not match", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const grantedArgs = { symbol: "NVDA" };
    const requestContext = grantedContext({
      fixture: current,
      message: "What is the current NVDA price?",
      toolId: "read-market-snapshot",
      args: grantedArgs
    });

    await expect(
      invoke(tools["read-market-snapshot"], { symbol: "AAPL" }, requestContext)
    ).rejects.toMatchObject({ code: "grant_binding_mismatch" });
    await expect(
      invoke(tools["read-market-snapshot"], grantedArgs, requestContext)
    ).rejects.toMatchObject({ code: "grant_missing_or_consumed" });
    expect(current.spies.snapshot).not.toHaveBeenCalled();
  });

  it("consumes a canonically bound grant once and signs decimal market evidence", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = { symbol: "NVDA" };
    const requestContext = grantedContext({
      fixture: current,
      message: "What is the current NVDA price?",
      toolId: "read-market-snapshot",
      args
    });

    const result = await invoke(tools["read-market-snapshot"], args, requestContext);
    expect(result).toMatchObject({
      toolId: "read-market-snapshot",
      status: "success",
      result: {
        symbol: "NVDA",
        price: "203.28000000",
        previousClose: "202.81000000",
        change: "0.47000000",
        changePercent: "0.23174400"
      },
      source: { licenseClass: "public-indicative" }
    });
    expect(verifyEnvelope(result, current.signer)).toBe(true);
    await expect(
      invoke(tools["read-market-snapshot"], args, requestContext)
    ).rejects.toThrow(/already consumed/u);
    expect(current.spies.snapshot).toHaveBeenCalledTimes(1);
  });

  it("signs normalized dividend and analyst facts with exact provider lineage", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = { symbol: "NVDA" };
    const requestContext = grantedContext({
      fixture: current,
      message: "What is NVDA's dividend yield and analyst consensus?",
      toolId: "read-instrument-research",
      args
    });

    const result = await invoke(
      tools["read-instrument-research"],
      args,
      requestContext
    );

    expect(result).toMatchObject({
      toolId: "read-instrument-research",
      status: "success",
      result: {
        dividendYield: {
          status: "AVAILABLE",
          value: { value: "0.03000000" },
          sources: [{
            providerId: "yahoo-finance",
            sourceId: "yahoo-quote-summary",
            licenseClass: "development-only"
          }]
        },
        lastDividend: {
          status: "AVAILABLE",
          value: {
            amount: "0.01000000",
            dateBasis: "provider-reported-last-dividend-date"
          }
        },
        analystConsensus: {
          status: "AVAILABLE",
          value: {
            recommendation: "Strong Buy",
            analystCount: 58,
            targetPrice: "225.50000000"
          },
          sources: [{
            providerId: "yahoo-finance",
            sourceId: "yahoo-quote-summary",
            licenseClass: "development-only"
          }]
        }
      }
    });
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("derives private portfolio scope from the grant session, never tool input", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {};
    const requestContext = grantedContext({
      fixture: current,
      message: "What is my current portfolio value?",
      toolId: "read-portfolio-snapshot",
      args
    });

    const result = await invoke(tools["read-portfolio-snapshot"], args, requestContext);
    expect(result).toMatchObject({ toolId: "read-portfolio-snapshot", status: "success" });
    expect(current.spies.portfolioSnapshot).toHaveBeenCalledWith({
      requestId: "request-1",
      workflowRunId: "workflow-1",
      sessionId: expect.any(String),
      tenantId: "tenant-1",
      principalId: "principal-1"
    });
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("converts an explicit amount with a signed official USD/AZN rate", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {
      scope: "provided-amount" as const,
      amount: "100.00000000",
      sourceCurrency: "USD" as const,
      targetCurrency: "AZN" as const
    };
    const requestContext = grantedContext({
      fixture: current,
      message: "What is the value of my portfolio in AZN?",
      toolId: "convert-currency",
      args
    });

    const result = await invoke(tools["convert-currency"], args, requestContext);

    expect(result).toMatchObject({
      toolId: "convert-currency",
      status: "success",
      result: {
        schemaVersion: "assistant-v3.currency-conversion.v1",
        scope: "provided-amount",
        sourceCurrency: "USD",
        targetCurrency: "AZN",
        sourceAmount: "100.00000000",
        exchangeRate: "1.70000000",
        convertedAmount: "170.00000000",
        rateEffectiveDate: "2026-07-22",
        portfolioDataClass: null,
        portfolioAsOf: null,
        marketAsOf: []
      },
      source: {
        provider: "central-bank-of-azerbaijan",
        sourceId: "official-currency-rates",
        sourceAsOf: "2026-07-22T00:00:00+04:00"
      }
    });
    expect(current.spies.currencyRate).toHaveBeenCalledWith("USD", "AZN");
    expect(current.spies.portfolioSnapshot).not.toHaveBeenCalled();
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("converts one freshly retrieved market price without model-side arithmetic", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {
      scope: "current-market-price" as const,
      symbol: "NVDA",
      targetCurrency: "AZN" as const
    };
    const requestContext = grantedContext({
      fixture: current,
      message: "What is the current NVDA price in AZN?",
      toolId: "convert-currency",
      args
    });

    const result = await invoke(tools["convert-currency"], args, requestContext);

    expect(result).toMatchObject({
      toolId: "convert-currency",
      status: "success",
      result: {
        schemaVersion: "assistant-v3.currency-conversion.v1",
        scope: "current-market-price",
        symbol: "NVDA",
        displayName: "NVIDIA Corporation",
        sourceCurrency: "USD",
        targetCurrency: "AZN",
        sourceAmount: "203.28000000",
        exchangeRate: "1.70000000",
        convertedAmount: "345.57600000",
        rateEffectiveDate: "2026-07-22",
        portfolioDataClass: null,
        portfolioAsOf: null,
        marketAsOf: [{ symbol: "NVDA", asOf: AS_OF }],
        marketSnapshot: {
          symbol: "NVDA",
          currency: "USD",
          price: "203.28000000",
          asOf: AS_OF
        },
        marketSource: {
          provider: "yahoo-finance",
          sourceId: "market-snapshot",
          sourceAsOf: AS_OF
        }
      }
    });
    expect(current.spies.snapshot).toHaveBeenCalledWith("NVDA");
    expect(current.spies.currencyRate).toHaveBeenCalledWith("USD", "AZN");
    expect(current.spies.portfolioSnapshot).not.toHaveBeenCalled();
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("rejects a rate response whose signed currency direction does not match the request", async () => {
    const current = fixture();
    current.spies.currencyRate.mockResolvedValueOnce({
      sourceCurrency: "AZN",
      targetCurrency: "USD",
      exchangeRate: decimal("0.58823529"),
      effectiveDate: "2026-07-22",
      asOf: "2026-07-22T00:00:00+04:00",
      sourceUrl: "https://www.cbar.az/currencies/22.07.2026.xml"
    });
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {
      scope: "current-market-price" as const,
      symbol: "NVDA",
      targetCurrency: "AZN" as const
    };
    const requestContext = grantedContext({
      fixture: current,
      message: "What is the current NVDA price in AZN?",
      toolId: "convert-currency",
      args
    });

    const result = await invoke(tools["convert-currency"], args, requestContext);

    expect(result).toMatchObject({
      toolId: "convert-currency",
      status: "unavailable",
      result: null,
      error: {
        code: "CURRENCY_RATE_EVIDENCE_INVALID",
        retryable: false
      }
    });
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("revalues the server-scoped portfolio before a direct Studio-style AZN conversion", async () => {
    const current = fixture();
    current.spies.snapshot.mockImplementation(async (symbol: string) => ({
      ...marketSnapshot(),
      symbol,
      displayName: symbol,
      price: 100
    }));
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {
      scope: "current-portfolio-value" as const,
      targetCurrency: "AZN" as const
    };
    const requestContext = grantedContext({
      fixture: current,
      message: "Convert it into AZN",
      toolId: "convert-currency",
      args
    });

    const result = await invoke(tools["convert-currency"], args, requestContext);
    expect(result.status).toBe("success");
    const value = result.result as {
      sourceAmount: string;
      exchangeRate: string;
      convertedAmount: string;
      portfolioDataClass: string | null;
      portfolioAsOf: string | null;
      marketAsOf: readonly { symbol: string; asOf: string }[];
    };
    expect(value.convertedAmount).toBe(
      formatFixedDecimal(
        multiplyFixed(
          parseFixedDecimal(value.sourceAmount),
          parseFixedDecimal(value.exchangeRate)
        )
      )
    );
    expect(value).toMatchObject({
      portfolioDataClass: "synthetic",
      portfolioAsOf: expect.any(String)
    });
    expect(value.marketAsOf.map(({ symbol }) => symbol).sort()).toEqual([
      "AAPL",
      "BND",
      "NVDA"
    ]);
    expect(current.spies.portfolioSnapshot).toHaveBeenCalledWith({
      requestId: "request-1",
      workflowRunId: "workflow-1",
      sessionId: expect.any(String),
      tenantId: "tenant-1",
      principalId: "principal-1"
    });
    expect(current.spies.snapshot).toHaveBeenCalledTimes(3);
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("returns signed, bounded recent executions and order states from private scope", async () => {
    const current = fixture();
    current.dependencies.portfolio = new SyntheticPortfolioPort({
      tenantRef: "tenant-1",
      principalRef: "principal-1",
      now: () => NOW
    });
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {
      queryType: "recent-trading" as const,
      limit: 3,
      include: "all" as const,
      side: "BUY" as const
    };
    const requestContext = grantedContext({
      fixture: current,
      message: "How much gain or loss have I made on my investments this year?",
      toolId: "read-portfolio-activity",
      args
    });

    const result = await invoke(tools["read-portfolio-activity"], args, requestContext);
    expect(result).toMatchObject({
      toolId: "read-portfolio-activity",
      status: "success",
      result: {
        schemaVersion: "assistant-v3.recent-trading-activity.v1",
        queryType: "recent-trading",
        coverage: { status: "complete", matchedCount: 4, returnedCount: 3 },
        hasMore: true,
        items: [
          {
            kind: "ORDER",
            activityRef: "order:order-buy-aapl-open-20260721",
            positionEffect: "NONE_ORDER_STATE_ONLY"
          },
          {
            kind: "ORDER",
            activityRef: "order:order-buy-nvda-cancelled-20260720",
            positionEffect: "NONE_ORDER_STATE_ONLY"
          },
          {
            kind: "EXECUTION",
            activityRef: "execution:txn-buy-aapl-20260215",
            positionEffect: "AUTHORITATIVE_EXECUTED_TRADE"
          }
        ]
      }
    });
    expect(JSON.stringify(result)).not.toContain("account:mock-brokerage-001");
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("rejects injected client/account identifiers at runtime before the private adapter", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {
      queryType: "recent-trading",
      limit: 10,
      include: "all",
      accountId: "account-secret"
    };
    const requestContext = grantedContext({
      fixture: current,
      message: "How much gain or loss have I made on my investments this year?",
      toolId: "read-portfolio-activity",
      args
    });

    await expect(
      invoke(tools["read-portfolio-activity"], args, requestContext)
    ).resolves.toMatchObject({ error: true });
    expect(current.spies.activity).not.toHaveBeenCalled();
  });

  it("derives approved-knowledge filters and signs a fail-closed dependency result", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = { query: "What fees does Demo Invest charge?" };
    const requestContext = grantedContext({
      fixture: current,
      message: "What fees and tariffs does Demo Invest charge?",
      toolId: "retrieve-approved-product-knowledge",
      args
    });

    const result = await invoke(
      tools["retrieve-approved-product-knowledge"],
      args,
      requestContext
    );
    expect(current.spies.knowledge).toHaveBeenCalledWith(args.query, {
      locale: "en-US",
      jurisdiction: "AZ",
      productScopes: ["DEMO_INVEST"],
      channel: "customer_chat",
      asOf: AS_OF,
      requestId: "request-1"
    });
    expect(result).toMatchObject({
      toolId: "retrieve-approved-product-knowledge",
      status: "unavailable",
      error: { code: "KNOWLEDGE_DEPENDENCY_UNAVAILABLE", retryable: true }
    });
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("returns signed reviewed TWR propositions without a ready-written answer", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const args = { query: "What is TWR?" };
    const requestContext = grantedContext({
      fixture: current,
      message: "What is TWR?",
      toolId: "retrieve-reviewed-investment-education",
      args
    });

    const result = await invoke(
      tools["retrieve-reviewed-investment-education"],
      args,
      requestContext
    );

    expect(result).toMatchObject({
      toolId: "retrieve-reviewed-investment-education",
      status: "success",
      result: {
        schemaVersion: "assistant-v3.financial-education-retrieval.v1",
        status: "grounded",
        locale: "en-US",
        queryHash: financialEducationQueryHash(args.query),
        propositions: [{
          propositionId: "twr-compounded-growth",
          citationId: "financial-education-twr-compounded-growth"
        }],
        citations: [{
          propositionId: "twr-compounded-growth",
          sourceId: "federal-register-time-weighted-return-en"
        }]
      }
    });
    expect(current.spies.education).toHaveBeenCalledWith({
      query: args.query,
      context: {
        requestId: "request-1",
        locale: "en-US",
        jurisdiction: "AZ",
        channel: "customer_chat",
        asOf: AS_OF
      }
    });
    expect(verifyEnvelope(result, current.signer)).toBe(true);
    expect(result.result).not.toHaveProperty("answer");
    expect(result.result).not.toHaveProperty("statements");
    expect(result.result).not.toHaveProperty("fallbackTemplate");
  });

  it("converts port exceptions into signed unavailable envelopes after consuming the grant", async () => {
    const current = fixture();
    current.spies.history.mockRejectedValueOnce(new Error("secret upstream detail"));
    const tools = createV3BoundaryTools(current.dependencies);
    const args = { symbol: "NVDA", range: "1y" as const };
    const requestContext = grantedContext({
      fixture: current,
      message: "NVDA RSI and technical indicators",
      toolId: "read-price-history",
      args
    });

    const result = await invoke(tools["read-price-history"], args, requestContext);
    expect(result).toMatchObject({
      toolId: "read-price-history",
      status: "unavailable",
      result: null,
      error: {
        code: "BOUNDARY_DEPENDENCY_UNAVAILABLE",
        message: "The boundary dependency is temporarily unavailable."
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret upstream detail");
    expect(verifyEnvelope(result, current.signer)).toBe(true);
    await expect(
      invoke(tools["read-price-history"], args, requestContext)
    ).rejects.toThrow(/already consumed/u);
  });

  it("fails closed when the private portfolio adapter is unavailable", async () => {
    const current = fixture();
    current.spies.portfolioSnapshot.mockRejectedValueOnce(
      new Error("injected private ledger detail")
    );
    const tools = createV3BoundaryTools(current.dependencies);
    const args = {};
    const requestContext = grantedContext({
      fixture: current,
      message: "What is my current portfolio value?",
      toolId: "read-portfolio-snapshot",
      args
    });

    const result = await invoke(tools["read-portfolio-snapshot"], args, requestContext);
    expect(result).toMatchObject({
      toolId: "read-portfolio-snapshot",
      status: "unavailable",
      result: null,
      error: { code: "BOUNDARY_DEPENDENCY_UNAVAILABLE", retryable: true }
    });
    expect(JSON.stringify(result)).not.toContain("injected private ledger detail");
    expect(verifyEnvelope(result, current.signer)).toBe(true);
  });

  it("does not manufacture evidence when the signer dependency fails", async () => {
    const current = fixture();
    vi.spyOn(current.signer, "seal").mockImplementation(() => {
      throw new Error("injected signer dependency failure");
    });
    const tools = createV3BoundaryTools(current.dependencies);
    const args = { symbol: "NVDA" };
    const requestContext = grantedContext({
      fixture: current,
      message: "What is the current NVDA price?",
      toolId: "read-market-snapshot",
      args
    });

    await expect(
      invoke(tools["read-market-snapshot"], args, requestContext)
    ).rejects.toThrow("injected signer dependency failure");
    await expect(
      invoke(tools["read-market-snapshot"], args, requestContext)
    ).rejects.toThrow(/already consumed/u);
    expect(current.spies.snapshot).toHaveBeenCalledTimes(1);
  });

  it("keeps the signed-handoff tool unreachable without a policy-authorized grant", async () => {
    const current = fixture();
    const tools = createV3BoundaryTools(current.dependencies);
    const userSession = session();
    const route = routeV3Request("Preview buying 10 NVDA shares");
    const policy = evaluateV3Policy({ route, session: userSession, now: NOW });

    expect(() =>
      current.grants.issue({
        requestId: "request-1",
        workflowRunId: "workflow-1",
        route,
        policy,
        session: userSession,
        toolId: "create-signed-order-handoff",
        args: {
          intentId: "00000000-0000-4000-8000-000000000001",
          explicitConfirmation: true
        }
      })
    ).toThrow(/authorize/u);
    await expect(
      invoke(tools["create-signed-order-handoff"], {
        intentId: "00000000-0000-4000-8000-000000000001",
        explicitConfirmation: true
      })
    ).rejects.toBeInstanceOf(V3BoundaryToolAuthorizationError);
    expect(current.spies.confirm).not.toHaveBeenCalled();
  });
});
