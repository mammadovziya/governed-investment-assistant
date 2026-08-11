import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  AssistantCitation,
  AssistantResponse,
  FactEnvelope,
  ToolExecutionEnvelope,
  TrustedRequestContext,
} from "../src/assistant-v3/contracts.js";
import { approvedProductKnowledgeDocuments } from "../src/data/approved-product-knowledge.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import {
  buildHypotheticalPositionPresentation,
  parseHypotheticalPositionScenario
} from "../src/assistant-v3/portfolio-scenarios.js";
import {
  V3_BLOCKING_RESPONSE_SCORER_IDS,
  aggregateV3ResponseScores,
  requiredV3ToolSet,
  scoreV3CitationIntegrity,
  scoreV3ConversationalQuality,
  scoreV3FactDerivation,
  scoreV3MaterialClaimLineage,
  scoreV3NavigationIntegrity,
  scoreV3NumericDateGrounding,
  scoreV3RequiredToolSet,
  scoreV3ResponseForDelivery,
  scoreV3ToolEnvelopeIntegrity,
  type V3ResponseScoringInput,
} from "../src/assistant-v3/response-scorers.js";
import { routeV3Request } from "../src/assistant-v3/routing.js";
import { v3NotApplicableScore } from "../src/assistant-v3/scorers.js";
import { DevHmacSigner } from "../src/assistant-v3/signing.js";
import { GOVERNED_NAVIGATION_CATALOG_VERSION } from "../src/assistant-v3/governed-navigation.js";
import {
  sealRenderableFact,
  type RenderableSemanticRole
} from "../src/assistant-v3/rendering.js";

const NOW = Date.parse("2026-07-22T08:00:00.000Z");
const REQUESTED_AT = "2026-07-22T07:59:59.000Z";

function signer(): DevHmacSigner {
  return new DevHmacSigner({
    keyId: "response-scorer-test-key",
    secret: "response-scorer-secret-is-at-least-thirty-two-bytes",
  });
}

function signedFactDisplay(
  fact: FactEnvelope<unknown>,
  display: string,
  alias = "F1",
  semanticRoles?: readonly RenderableSemanticRole[]
) {
  const sealed = sealRenderableFact({
    alias,
    fact,
    display,
    meaning: "the verified test display",
    required: true,
    ...(semanticRoles === undefined ? {} : { semanticRoles })
  }, new EvidenceFactory({ signer: signer(), now: () => NOW }));
  if (sealed.projectionIntegrity === undefined) {
    throw new Error("projection signature is missing");
  }
  return {
    alias,
    factId: fact.factId,
    display,
    meaning: sealed.meaning,
    required: sealed.required,
    semanticRoles: sealed.semanticRoles ?? [],
    projectionIntegrity: sealed.projectionIntegrity
  };
}

function context(): TrustedRequestContext {
  return {
    schemaVersion: "assistant-v3.request-context.v1",
    requestId: "request-response-score-1",
    sessionId: "session-response-score-1",
    conversationId: "conversation-response-score-1",
    principalRef: "principal:test-1",
    tenantRef: "tenant:demo-invest-test",
    locale: "en-US",
    jurisdiction: "AZ",
    channel: "test",
    environment: "test",
    requestedAt: REQUESTED_AT,
    authentication: {
      strength: "authenticated",
      authContextRef: "auth:test-1",
    },
    consentVersion: "consent-v1",
    consentScopes: ["assistant_use", "public_market_data"],
    entitlementVersion: "entitlement-v1",
    entitlements: ["assistant_access", "market_read"],
    policyVersion: "3.0.0",
    capabilities: ["market-read", "research-read", "approved-knowledge-read"],
    featureSnapshot: {
      version: "feature-v1",
      flags: {},
    },
  };
}

function source(sourceId: string, url: string | null = null) {
  return {
    provider: "test-provider",
    sourceId,
    sourceUrl: url,
    licenseClass: "synthetic" as const,
    observedAt: new Date(NOW).toISOString(),
    sourceAsOf: new Date(NOW).toISOString(),
  };
}

function quoteFixture(): V3ResponseScoringInput {
  const request = context();
  const serviceSigner = signer();
  const evidence = new EvidenceFactory({ signer: serviceSigner, now: () => NOW });
  const resolveArguments = { symbol: "NVDA" };
  const quoteArguments = { symbol: "NVDA" };
  const historyArguments = { symbol: "NVDA", range: "10y" };
  const resolve = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId: "workflow-response-score-1",
    toolId: "resolve-instrument",
    toolVersion: "1.0.0",
    arguments: resolveArguments,
    result: { instrumentId: "US:NVDA", symbol: "NVDA" },
    source: source("instrument-master"),
  });
  const quote = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId: "workflow-response-score-1",
    toolId: "read-market-snapshot",
    toolVersion: "1.0.0",
    arguments: quoteArguments,
    result: {
      instrumentId: "US:NVDA",
      price: decimal("203.28"),
      currency: "USD",
      asOf: new Date(NOW).toISOString(),
    },
    source: source("quote:NVDA", "https://market.test/NVDA"),
  });
  const history = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId: "workflow-response-score-1",
    toolId: "read-price-history",
    toolVersion: "1.0.0",
    arguments: historyArguments,
    result: {
      symbol: "NVDA",
      range: "10y",
      currency: "USD",
      asOf: new Date(NOW).toISOString(),
      points: [{ timestamp: "2016-07-22T00:00:00.000Z", close: decimal("1.20") }],
    },
    source: source("history:NVDA", "https://market.test/NVDA/history"),
  });
  const fact = evidence.fact({
    requestId: request.requestId,
    workflowRunId: "workflow-response-score-1",
    kind: "market.price",
    subject: { type: "instrument", ref: "US:NVDA" },
    asOf: new Date(NOW).toISOString(),
    value: {
      price: decimal("203.28"),
      currency: "USD",
      asOf: new Date(NOW).toISOString(),
    },
    provenance: {
      toolExecutionIds: [quote.executionId],
      inputFactIds: [],
      calculation: null,
    },
  });
  const response: AssistantResponse = {
    schemaVersion: "assistant-v3.response.v1",
    requestId: request.requestId,
    conversationId: request.conversationId,
    status: "complete",
    message: "NVDA is $203.28 as of July 22, 2026. The market snapshot is current.",
    claims: [
      {
        claimId: "claim-price",
        locale: "en-US",
        textTemplate: "NVDA is {{PRICE}}. The market snapshot is current.",
        factRefs: [fact.factId],
        citationRefs: [],
        limitations: [],
      },
    ],
    facts: [fact],
    citations: [],
    cards: [
      {
        cardId: "card-price",
        kind: "market",
        title: "NVDA",
        factRefs: [fact.factId],
        data: { symbol: "NVDA" },
      },
    ],
    charts: [],
    actions: [],
    notices: [],
    freshness: [],
    evaluations: [],
    deliveryGate: "pass",
    generationMode: "gpt-4o",
    provenance: {
      workflowId: "market-quote-workflow",
      workflowVersion: "3.0.0",
      workflowRunId: "workflow-response-score-1",
      model: "gpt-4o",
      toolExecutionIds: [resolve.executionId, quote.executionId, history.executionId],
      factIds: [fact.factId],
      policyVersion: "3.0.0",
    },
  };
  return {
    route: routeV3Request("What is the current NVDA price?"),
    context: request,
    response,
    tools: [
      { envelope: resolve, arguments: resolveArguments },
      { envelope: quote, arguments: quoteArguments },
      { envelope: history, arguments: historyArguments },
    ],
    factDisplays: [
      signedFactDisplay(fact, "$203.28 as of July 22, 2026", "PRICE")
    ],
    signer: serviceSigner,
    evaluatedAt: NOW + 1_000,
  };
}

function hypotheticalPositionFixture(): V3ResponseScoringInput {
  const request = context();
  const serviceSigner = signer();
  const evidence = new EvidenceFactory({ signer: serviceSigner, now: () => NOW });
  const workflowRunId = "workflow-hypothetical-position-1";
  const requestMessage =
    "Assume I own 15 shares of NVDA bought at $170 each. Should I buy more, hold, or sell?";
  const route = routeV3Request(requestMessage);
  const parsed = parseHypotheticalPositionScenario(requestMessage, "NVDA");
  if (parsed.status !== "supported") throw new Error("Scenario fixture did not parse.");
  const resolveArguments = { symbol: "NVDA" };
  const marketArguments = { symbol: "NVDA" };
  const resolve = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId,
    toolId: "resolve-instrument",
    toolVersion: "3.0.0",
    arguments: resolveArguments,
    result: {
      instrumentId: "US:NVDA",
      symbol: "NVDA",
      displayName: "NVIDIA Corporation",
      instrumentType: "EQUITY" as const,
      exchange: "NasdaqGS",
      currency: "USD",
      resolvedAt: new Date(NOW).toISOString()
    },
    source: source("instrument-master")
  });
  const market = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId,
    toolId: "read-market-snapshot",
    toolVersion: "3.0.0",
    arguments: marketArguments,
    result: {
      symbol: "NVDA",
      displayName: "NVIDIA Corporation",
      currency: "USD",
      exchange: "NasdaqGS",
      instrumentType: "EQUITY",
      price: decimal("203.28"),
      previousClose: decimal("202.00"),
      change: decimal("1.28"),
      changePercent: decimal("0.63366337"),
      marketState: "CLOSED" as const,
      freshness: "indicative" as const,
      delayMinutes: 0,
      asOf: new Date(NOW).toISOString(),
      notice: "Indicative test snapshot."
    },
    source: source("quote:NVDA", "https://market.test/NVDA")
  });
  const presentation = buildHypotheticalPositionPresentation({
    scenario: parsed.scenario,
    context: request,
    workflowRunId,
    tools: [resolve, market],
    signer: serviceSigner
  });
  const fact = presentation.facts[0];
  if (fact === undefined) throw new Error("Scenario fixture fact is missing.");
  const response: AssistantResponse = {
    schemaVersion: "assistant-v3.response.v1",
    requestId: request.requestId,
    conversationId: request.conversationId,
    status: "complete",
    message: "I cannot recommend buying more, holding, or selling.",
    claims: [],
    facts: [fact],
    citations: [],
    cards: [...presentation.cards],
    charts: [],
    actions: [],
    notices: [...presentation.notices],
    freshness: [...presentation.freshness],
    evaluations: [],
    deliveryGate: "pass",
    generationMode: "deterministic-fallback",
    provenance: {
      workflowId: "portfolio-insight-v3",
      workflowVersion: "3.0.0",
      workflowRunId,
      model: null,
      toolExecutionIds: [resolve.executionId, market.executionId],
      factIds: [fact.factId],
      policyVersion: "3.0.0"
    }
  };
  return {
    route,
    context: request,
    requestMessage,
    response,
    tools: [
      { envelope: resolve, arguments: resolveArguments },
      { envelope: market, arguments: marketArguments }
    ],
    signer: serviceSigner,
    evaluatedAt: NOW + 1_000
  };
}

function readOnlyQuoteNavigationFixture(): V3ResponseScoringInput {
  const base = quoteFixture();
  const evidence = new EvidenceFactory({ signer: base.signer, now: () => NOW });
  const fact = evidence.fact({
    requestId: base.context.requestId,
    workflowRunId: base.response.provenance.workflowRunId,
    kind: "market.quote",
    subject: { type: "instrument", ref: "NVDA" },
    asOf: new Date(NOW).toISOString(),
    value: {
      symbol: "NVDA",
      price: decimal("203.28"),
      currency: "USD",
      asOf: new Date(NOW).toISOString()
    },
    provenance: {
      toolExecutionIds: base.tools.map(({ envelope }) => envelope.executionId),
      inputFactIds: [],
      calculation: null
    }
  });
  const action = {
    schemaVersion: "assistant-v3.read-only-navigation-action.v1" as const,
    actionId: "view-instrument-overview" as const,
    kind: "open-read-only-view" as const,
    target: "investments.instrument.overview" as const,
    label: "View instrument overview",
    href: "/investments/instruments" as const,
    factRefs: [fact.factId] as const,
    catalogVersion: "governed-investment-read-only-navigation-2026-07-29.v1" as const
  };
  return {
    ...base,
    context: {
      ...base.context,
      featureSnapshot: {
        ...base.context.featureSnapshot,
        flags: { readOnlyNavigation: true }
      }
    },
    response: {
      ...base.response,
      facts: [fact],
      claims: base.response.claims.map((claim) => ({
        ...claim,
        factRefs: [fact.factId]
      })),
      cards: [{
        cardId: "card-market-NVDA",
        kind: "market",
        title: "NVDA",
        factRefs: [fact.factId],
        data: fact.value
      }],
      actions: [action],
      provenance: {
        ...base.response.provenance,
        factIds: [fact.factId]
      }
    },
    factDisplays: [
      signedFactDisplay(fact, "$203.28 as of July 22, 2026", "PRICE")
    ]
  };
}

function replaceResponse(
  input: V3ResponseScoringInput,
  response: AssistantResponse,
): V3ResponseScoringInput {
  return { ...input, response };
}

function replaceFact(
  input: V3ResponseScoringInput,
  fact: FactEnvelope<unknown>,
): V3ResponseScoringInput {
  const originalFactId = input.response.facts[0]?.factId;
  if (originalFactId === undefined) throw new Error("fixture fact is missing");
  return {
    ...input,
    response: {
      ...input.response,
      facts: [fact],
      claims: input.response.claims.map((claim) => ({
        ...claim,
        factRefs: claim.factRefs.map((factId) =>
          factId === originalFactId ? fact.factId : factId,
        ),
      })),
      cards: input.response.cards.map((card) => ({
        ...card,
        factRefs: card.factRefs.map((factId) =>
          factId === originalFactId ? fact.factId : factId,
        ),
      })),
      provenance: {
        ...input.response.provenance,
        factIds: [fact.factId],
      },
    },
    factDisplays: [
      signedFactDisplay(fact, "$203.28 as of July 22, 2026", "PRICE")
    ],
  };
}

function knowledgeFixture(): V3ResponseScoringInput {
  const request = context();
  const serviceSigner = signer();
  const evidence = new EvidenceFactory({ signer: serviceSigner, now: () => NOW });
  const text = "The Investor tariff has an approved commission schedule.";
  const chunkHash = createHash("sha256").update(text, "utf8").digest("hex");
  const args = {
    queryHash: "fee-query-hash",
    locale: "en-US",
    jurisdiction: "AZ",
    asOf: request.requestedAt,
  };
  const tool = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId: "workflow-knowledge-score-1",
    toolId: "retrieve-approved-product-knowledge",
    toolVersion: "1.0.0",
    arguments: args,
    result: { selectedChunkIds: ["fees:1"] },
    source: source("approved-index:test"),
  });
  const fact = evidence.fact({
    requestId: request.requestId,
    workflowRunId: "workflow-knowledge-score-1",
    kind: "approved-knowledge.evidence",
    subject: { type: "product", ref: "DEMO_INVEST" },
    asOf: "2026-07-01T00:00:00.000Z",
    value: {
      chunkId: "fees:1",
      sourceId: "demo-invest-fees-en",
      version: "2026-07-01",
      title: "Demo Invest sample fees",
      url: "https://knowledge.demo-invest.invalid/en/fees",
      locale: "en-US",
      jurisdiction: "AZ",
      productScope: "DEMO_INVEST",
      text,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      effectiveTo: null,
      contentAsOf: "2026-07-01T00:00:00.000Z",
      chunkChecksumSha256: chunkHash,
    },
    provenance: {
      toolExecutionIds: [tool.executionId],
      inputFactIds: [],
      calculation: null,
    },
    quality: {
      status: "complete",
      coverage: decimal("1"),
      flags: ["APPROVED", "AZ", "CUSTOMER_CHAT", "DEMO_INVEST"],
    },
  });
  const citation: AssistantCitation = {
    citationId: "citation-fees-1",
    sourceId: "demo-invest-fees-en@2026-07-01",
    title: "Demo Invest sample fees",
    url: "https://knowledge.demo-invest.invalid/en/fees",
    sourceAsOf: "2026-07-01T00:00:00.000Z",
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveTo: null,
    contentHash: chunkHash,
  };
  const response: AssistantResponse = {
    schemaVersion: "assistant-v3.response.v1",
    requestId: request.requestId,
    conversationId: request.conversationId,
    status: "complete",
    message: "The approved tariff details are available in the current source [1].",
    claims: [
      {
        claimId: "claim-fees",
        locale: "en-US",
        textTemplate: "The approved tariff details are available in {{FACT}} {{CITATION}}.",
        factRefs: [fact.factId],
        citationRefs: [citation.citationId],
        limitations: [],
      },
    ],
    facts: [fact],
    citations: [citation],
    cards: [],
    charts: [],
    actions: [],
    notices: [],
    freshness: [],
    evaluations: [],
    deliveryGate: "pass",
    generationMode: "gpt-4o",
    provenance: {
      workflowId: "approved-knowledge-workflow",
      workflowVersion: "3.0.0",
      workflowRunId: "workflow-knowledge-score-1",
      model: "gpt-4o",
      toolExecutionIds: [tool.executionId],
      factIds: [fact.factId],
      policyVersion: "3.0.0",
    },
  };
  return {
    route: routeV3Request("What are the Demo Invest fees?"),
    context: request,
    response,
    tools: [{ envelope: tool, arguments: args }],
    factDisplays: [
      signedFactDisplay(
        fact,
        text,
        "FACT",
        ["knowledge.tariff"]
      )
    ],
    signer: serviceSigner,
    evaluatedAt: NOW + 1_000,
  };
}

function fundingActionFixture(): V3ResponseScoringInput {
  const baseContext = context();
  const request: TrustedRequestContext = {
    ...baseContext,
    consentScopes: ["assistant_use", "approved_knowledge"],
    entitlements: ["assistant_access", "knowledge_read"],
    featureSnapshot: {
      version: "governed-navigation-test-v1",
      flags: { approvedKnowledge: true }
    }
  };
  const document = approvedProductKnowledgeDocuments.find(({ manifest }) =>
    manifest.sourceId === "demo-invest-funding-en"
  );
  if (!document) throw new Error("Funding fixture document is missing.");
  const serviceSigner = signer();
  const evidence = new EvidenceFactory({ signer: serviceSigner, now: () => NOW });
  const workflowRunId = "workflow-funding-action-score-1";
  const args = {
    queryHash: "funding-query-hash",
    locale: request.locale,
    jurisdiction: request.jurisdiction,
    asOf: request.requestedAt
  };
  const tool = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId,
    toolId: "retrieve-approved-product-knowledge",
    toolVersion: "1.0.0",
    arguments: args,
    result: { selectedChunkIds: ["funding:1"] },
    source: source("approved-index:funding-test")
  });
  const sourceAsOf = document.manifest.contentAsOf ?? document.manifest.publishedAt;
  // Mastra's single-chunk document representation includes the title before
  // the approved body; the governed action is pinned to that exact chunk hash.
  const chunkText = `${document.manifest.title}\n\n${document.content}`;
  const chunkHash = createHash("sha256").update(chunkText, "utf8").digest("hex");
  const fact = evidence.fact({
    requestId: request.requestId,
    workflowRunId,
    kind: "approved-knowledge.evidence",
    subject: { type: "product", ref: "DEMO_INVEST" },
    asOf: sourceAsOf,
    value: {
      chunkId: "funding:1",
      sourceId: document.manifest.sourceId,
      version: document.manifest.version,
      title: document.manifest.title,
      url: document.manifest.url,
      locale: document.manifest.locale,
      jurisdiction: document.manifest.jurisdiction,
      productScope: "DEMO_INVEST",
      text: chunkText,
      effectiveFrom: document.manifest.effectiveFrom,
      effectiveTo: document.manifest.effectiveTo,
      contentAsOf: sourceAsOf,
      chunkChecksumSha256: chunkHash
    },
    provenance: {
      toolExecutionIds: [tool.executionId],
      inputFactIds: [],
      calculation: null
    },
    quality: {
      status: "complete",
      coverage: decimal("1"),
      flags: ["APPROVED", "AZ", "CUSTOMER_CHAT", "DEMO_INVEST"]
    }
  });
  const citation: AssistantCitation = {
    citationId: "product-knowledge-1",
    sourceId: `${document.manifest.sourceId}@${document.manifest.version}`,
    title: document.manifest.title,
    url: document.manifest.url,
    sourceAsOf,
    effectiveFrom: document.manifest.effectiveFrom,
    effectiveTo: document.manifest.effectiveTo,
    contentHash: chunkHash
  };
  const response: AssistantResponse = {
    schemaVersion: "assistant-v3.response.v1",
    requestId: request.requestId,
    conversationId: request.conversationId,
    status: "complete",
    message: `${chunkText} [1]`,
    claims: [{
      claimId: "claim-funding-action",
      locale: request.locale,
      textTemplate: "{{F1}} {{C1}}",
      factRefs: [fact.factId],
      citationRefs: [citation.citationId],
      limitations: []
    }],
    facts: [fact],
    citations: [citation],
    cards: [],
    charts: [],
    actions: [{
      schemaVersion: "assistant-v3.in-app-navigation-action.v1",
      actionId: "view-investment-account-funding-guide",
      kind: "open-in-app",
      target: "investments.funding.guide",
      label: "View funding steps",
      href: "/investments/guides/funding",
      citationRefs: [citation.citationId],
      catalogVersion: GOVERNED_NAVIGATION_CATALOG_VERSION
    }],
    notices: [],
    freshness: [],
    evaluations: [],
    deliveryGate: "pass",
    generationMode: "deterministic-fallback",
    provenance: {
      workflowId: "approved-knowledge-v3",
      workflowVersion: "3.0.0",
      workflowRunId,
      model: null,
      toolExecutionIds: [tool.executionId],
      factIds: [fact.factId],
      policyVersion: request.policyVersion
    }
  };
  return {
    route: routeV3Request("How do I fund my investment account?"),
    context: request,
    response,
    tools: [{ envelope: tool, arguments: args }],
    factDisplays: [signedFactDisplay(fact, chunkText, "F1")],
    signer: serviceSigner,
    evaluatedAt: NOW + 1_000
  };
}

function orderActionFixture(): V3ResponseScoringInput {
  const request = context();
  const serviceSigner = signer();
  const evidence = new EvidenceFactory({ signer: serviceSigner, now: () => NOW });
  const workflowRunId = "workflow-order-action-score-1";
  const intentId = "00000000-0000-4000-8000-000000000321";
  const requestedNotional = decimal("100");
  const resolveArguments = { symbol: "AAPL" };
  const quoteArguments = { symbol: "AAPL" };
  const eligibilityArguments = {
    symbol: "AAPL",
    side: "BUY" as const,
    requestedNotional,
  };
  const resolve = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId,
    toolId: "resolve-instrument",
    toolVersion: "1.0.0",
    arguments: resolveArguments,
    result: { instrumentId: "US:AAPL", symbol: "AAPL" },
    source: source("instrument-master"),
  });
  const quote = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId,
    toolId: "read-market-snapshot",
    toolVersion: "1.0.0",
    arguments: quoteArguments,
    result: { symbol: "AAPL", price: decimal("200"), currency: "USD" },
    source: source("quote:AAPL"),
  });
  const eligibility = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId,
    toolId: "read-order-eligibility",
    toolVersion: "1.0.0",
    arguments: eligibilityArguments,
    result: { eligible: true, tariffId: "investor" },
    source: source("order-eligibility:AAPL"),
  });
  const preview = {
    intentId,
    status: "awaiting-explicit-confirmation",
    side: "BUY",
    symbol: "AAPL",
    requestedNotional,
    currency: "USD",
    previewPrice: decimal("200"),
    estimatedCommission: decimal("1"),
    estimatedDebit: decimal("101"),
    tariffVersion: "tariff-v1",
    createdAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
    confirmationLabel: "Open buy ticket",
    notices: ["This is a preview, not an order."],
  };
  const fee = {
    tariffVersion: "tariff-v1",
    commission: decimal("1"),
    estimatedDebit: decimal("101"),
  };
  const estimatedQuantity = decimal("0.5");
  const tools = [resolve, quote, eligibility];
  const fact = evidence.fact({
    requestId: request.requestId,
    workflowRunId,
    kind: "order-ticket.preview",
    subject: { type: "order-handoff", ref: intentId },
    asOf: preview.createdAt,
    value: { preview, eligibility: eligibility.result, fee, estimatedQuantity },
    provenance: {
      toolExecutionIds: tools.map(({ executionId }) => executionId),
      inputFactIds: [],
      calculation: {
        id: "order-preview-calculator",
        version: "3.0.0",
        formulaId: "requested-notional-divided-by-price-plus-published-commission",
      },
    },
    quality: {
      status: "complete",
      coverage: decimal("1"),
      flags: ["PREVIEW_ONLY", "NO_ORDER_EXECUTION"],
    },
  });
  const response: AssistantResponse = {
    schemaVersion: "assistant-v3.response.v1",
    requestId: request.requestId,
    conversationId: request.conversationId,
    status: "complete",
    message: "I prepared a review-only ticket from the signed preview.",
    claims: [{
      claimId: "claim-order-preview",
      locale: request.locale,
      textTemplate: "I prepared a review-only ticket: {{F1}}",
      factRefs: [fact.factId],
      citationRefs: [],
      limitations: [],
    }],
    facts: [fact],
    citations: [],
    cards: [{
      cardId: `card-order-preview-${intentId}`,
      kind: "order-preview",
      title: "Buy ticket preview",
      factRefs: [fact.factId],
      data: { ...preview, estimatedQuantity, fee },
    }],
    charts: [],
    actions: [{
      actionId: `confirm-${intentId}`,
      kind: "open-signed-order-ticket",
      label: preview.confirmationLabel,
      href: null,
      expiresAt: preview.expiresAt,
      intentId,
    }],
    notices: [],
    freshness: [],
    evaluations: [],
    deliveryGate: "pass",
    generationMode: "deterministic-fallback",
    provenance: {
      workflowId: "order-ticket-handoff-v3",
      workflowVersion: "3.0.0",
      workflowRunId,
      model: null,
      toolExecutionIds: tools.map(({ executionId }) => executionId),
      factIds: [fact.factId],
      policyVersion: request.policyVersion,
    },
  };
  return {
    route: routeV3Request("Open a $100 AAPL buy ticket"),
    context: request,
    requestMessage: "Open a $100 AAPL buy ticket",
    response,
    tools: [
      { envelope: resolve, arguments: resolveArguments },
      { envelope: quote, arguments: quoteArguments },
      { envelope: eligibility, arguments: eligibilityArguments },
    ],
    factDisplays: [signedFactDisplay(fact, response.message, "F1")],
    signer: serviceSigner,
    evaluatedAt: NOW + 1_000,
  };
}

function activityCardFixture(): V3ResponseScoringInput {
  const request = context();
  const serviceSigner = signer();
  const evidence = new EvidenceFactory({ signer: serviceSigner, now: () => NOW });
  const workflowRunId = "workflow-activity-card-score-1";
  const argumentsValue = {
    queryType: "recent-trading" as const,
    limit: 10 as const,
    include: "all" as const,
  };
  const activity = evidence.toolSuccess({
    requestId: request.requestId,
    workflowRunId,
    toolId: "read-portfolio-activity",
    toolVersion: "1.0.0",
    arguments: argumentsValue,
    result: { schemaVersion: "assistant-v3.recent-trading-activity.v1" },
    source: source("portfolio-activity"),
  });
  const value = {
    route: "recent_trading_activity" as const,
    asOf: new Date(NOW).toISOString(),
    limit: 10 as const,
    matchedCount: 1,
    returnedCount: 1,
    hasMore: false,
    records: [{
      recordType: "execution" as const,
      positionEffect: "EXECUTED_TRADE" as const,
      occurredAt: new Date(NOW - 60_000).toISOString(),
      symbol: "NVDA",
      side: "BUY" as const,
      quantity: decimal("2"),
      unitPrice: { amount: decimal("200"), currency: "USD" },
      grossAmount: { amount: decimal("400"), currency: "USD" },
    }],
    dataClass: "synthetic" as const,
  };
  const fact = evidence.fact({
    requestId: request.requestId,
    workflowRunId,
    kind: "portfolio.recent-trading-activity",
    subject: { type: "portfolio", ref: "portfolio:primary" },
    asOf: value.asOf,
    value,
    provenance: {
      toolExecutionIds: [activity.executionId],
      inputFactIds: [],
      calculation: {
        id: "portfolio-activity-projection",
        version: "portfolio-activity-projection-v3.1.0",
        formulaId: "newest-ten-executions-and-order-states-with-identifiers-redacted",
      },
    },
    quality: {
      status: "complete",
      coverage: decimal("1"),
      flags: ["SYNTHETIC_CLIENT_DATA", "INTERNAL_IDENTIFIERS_REDACTED"],
    },
  });
  const response: AssistantResponse = {
    schemaVersion: "assistant-v3.response.v1",
    requestId: request.requestId,
    conversationId: request.conversationId,
    status: "complete",
    message: "Here is your latest trading activity.",
    claims: [{
      claimId: "claim-activity",
      locale: request.locale,
      textTemplate: "Here is your latest trading activity: {{F1}}",
      factRefs: [fact.factId],
      citationRefs: [],
      limitations: [],
    }],
    facts: [fact],
    citations: [],
    cards: [{
      cardId: `card-${fact.factId}`,
      kind: "activity",
      title: "Recent trading activity",
      factRefs: [fact.factId],
      data: value,
    }],
    charts: [],
    actions: [],
    notices: [],
    freshness: [],
    evaluations: [],
    deliveryGate: "pass",
    generationMode: "deterministic-fallback",
    provenance: {
      workflowId: "portfolio-insight-v3",
      workflowVersion: "3.0.0",
      workflowRunId,
      model: null,
      toolExecutionIds: [activity.executionId],
      factIds: [fact.factId],
      policyVersion: request.policyVersion,
    },
  };
  return {
    route: routeV3Request("Show my recent trading activity"),
    context: request,
    response,
    tools: [{ envelope: activity, arguments: argumentsValue }],
    factDisplays: [
      signedFactDisplay(
        fact,
        response.message,
        "F1",
        ["activity.summary"]
      )
    ],
    signer: serviceSigner,
    evaluatedAt: NOW + 1_000,
  };
}

describe("V3 required tool-set scorer", () => {
  it("defines every required tool, rather than a representative tool", () => {
    expect(requiredV3ToolSet(routeV3Request("Show my YTD P&L and TWR"))).toEqual([
      "read-portfolio-snapshot",
      "read-portfolio-activity",
      "read-market-snapshot",
      "read-price-history",
    ]);
    expect(requiredV3ToolSet(routeV3Request("What is my current portfolio value?"))).toEqual([
      "read-portfolio-snapshot",
      "read-market-snapshot",
    ]);
    expect(requiredV3ToolSet(
      routeV3Request("What is the value of my portfolio in AZN?")
    )).toEqual([
      "read-portfolio-snapshot",
      "read-market-snapshot",
      "convert-currency"
    ]);
    expect(requiredV3ToolSet(routeV3Request("What is the current NVDA price?"))).toEqual([
      "resolve-instrument",
      "read-market-snapshot",
      "read-price-history",
    ]);
    expect(requiredV3ToolSet(
      routeV3Request("What is the current NVDA price in AZN?")
    )).toEqual([
      "resolve-instrument",
      "convert-currency",
      "read-price-history",
    ]);
    expect(requiredV3ToolSet(routeV3Request("Where is ticker A listed?"))).toEqual([
      "resolve-instrument",
    ]);
    expect(requiredV3ToolSet(routeV3Request("What is NVDA's market cap?"))).toEqual([
      "resolve-instrument",
      "read-instrument-research",
    ]);
    expect(requiredV3ToolSet(
      routeV3Request("How risky is NVDA compared with an S&P 500 ETF?")
    )).toEqual([
      "resolve-instrument",
      "read-instrument-research",
    ]);
  });

  it("passes only when all required route tools succeeded", () => {
    const input = quoteFixture();
    expect(scoreV3RequiredToolSet(input).status).toBe("pass");

    const missingResolve = { ...input, tools: input.tools.slice(1) };
    expect(scoreV3RequiredToolSet(missingResolve)).toMatchObject({
      status: "fail",
      reasonCodes: ["required_tool_missing:resolve-instrument"],
    });
  });

  it("requires ten-year quote history for the exact routed symbol", () => {
    const input = quoteFixture();
    const oneYearOnly = {
      ...input,
      tools: input.tools.map((item) =>
        item.envelope.toolId === "read-price-history"
          ? { ...item, arguments: { symbol: "NVDA", range: "1y" } }
          : item,
      ),
    };

    expect(scoreV3RequiredToolSet(oneYearOnly)).toMatchObject({
      status: "fail",
      reasonCodes: ["required_tool_scope_missing:read-price-history:NVDA:10y"],
    });
  });

  it("binds a converted quote requirement to current-market-price and AZN", () => {
    const base = quoteFixture();
    const converted = {
      ...base,
      route: routeV3Request("What is the current NVDA price in AZN?"),
      tools: base.tools.map((item) =>
        item.envelope.toolId === "read-market-snapshot"
          ? {
              envelope: {
                ...item.envelope,
                toolId: "convert-currency"
              } as ToolExecutionEnvelope<unknown>,
              arguments: {
                scope: "current-market-price",
                symbol: "NVDA",
                targetCurrency: "AZN"
              }
            }
          : item
      )
    };

    expect(scoreV3RequiredToolSet(converted).status).toBe("pass");
    for (const argumentsValue of [
      {
        scope: "current-portfolio-value",
        symbol: "NVDA",
        targetCurrency: "AZN"
      },
      {
        scope: "current-market-price",
        symbol: "NVDA",
        targetCurrency: "USD"
      }
    ]) {
      const candidate = {
        ...converted,
        tools: converted.tools.map((item) =>
          item.envelope.toolId === "convert-currency"
            ? { ...item, arguments: argumentsValue }
            : item
        )
      };
      expect(scoreV3RequiredToolSet(candidate)).toMatchObject({
        status: "fail",
        reasonCodes: [
          "required_tool_scope_missing:convert-currency:NVDA"
        ]
      });
    }
  });

  it("requires the complete research tool set independently for every comparison symbol", () => {
    const base = quoteFixture();
    const prototype = base.tools[0]!.envelope;
    const scopedEvidence = (
      toolId: string,
      symbol: "NVDA" | "AAPL",
      range?: "10y",
    ) => ({
      envelope: { ...prototype, toolId } as ToolExecutionEnvelope<unknown>,
      arguments: range === undefined ? { symbol } : { symbol, range },
    });
    const tools = (["NVDA", "AAPL"] as const).flatMap((symbol) => [
      scopedEvidence("resolve-instrument", symbol),
      scopedEvidence("read-market-snapshot", symbol),
      scopedEvidence("read-instrument-research", symbol),
      scopedEvidence("read-price-history", symbol, "10y"),
    ]);
    const input = {
      ...base,
      route: routeV3Request("Compare NVDA and AAPL"),
      tools,
    };

    expect(scoreV3RequiredToolSet(input).status).toBe("pass");
    expect(scoreV3RequiredToolSet({
      ...input,
      tools: tools.filter(({ envelope, arguments: args }) =>
        envelope.toolId !== "read-market-snapshot" ||
        (args as { symbol: string }).symbol !== "AAPL"),
    })).toMatchObject({
      status: "fail",
      reasonCodes: ["required_tool_scope_missing:read-market-snapshot:AAPL"],
    });
  });

  it("binds portfolio activity evidence to the routed type and symbol arguments", () => {
    const base = quoteFixture();
    const prototype = base.tools[0]!.envelope;
    const activityEnvelope = {
      ...prototype,
      toolId: "read-portfolio-activity",
      status: "success" as const
    } as ToolExecutionEnvelope<unknown>;
    const scoped = {
      ...base,
      route: routeV3Request("Show my recent activity for NVDA"),
      tools: [{
        envelope: activityEnvelope,
        arguments: {
          queryType: "recent-trading",
          limit: 10,
          include: "all",
          symbol: "NVDA"
        }
      }]
    };

    expect(scoreV3RequiredToolSet(scoped).status).toBe("pass");
    expect(scoreV3RequiredToolSet({
      ...scoped,
      tools: [{
        envelope: activityEnvelope,
        arguments: { queryType: "recent-trading", limit: 10, include: "all" }
      }]
    })).toMatchObject({
      status: "fail",
      reasonCodes: ["activity_tool_arguments_mismatch"]
    });

    const purchases = {
      ...scoped,
      route: routeV3Request("Show my purchase history for NVDA"),
      tools: [{
        envelope: activityEnvelope,
        arguments: {
          queryType: "recent-trading",
          limit: 10,
          include: "executions",
          side: "BUY",
          symbol: "NVDA"
        }
      }]
    };
    expect(scoreV3RequiredToolSet(purchases).status).toBe("pass");
  });

  it("uses not_applicable only as a non-passing, non-error result", () => {
    expect(scoreV3RequiredToolSet({
      ...quoteFixture(),
      route: routeV3Request(""),
      tools: [],
    })).toMatchObject({
      status: "not_applicable",
      applicable: false,
      passed: false,
      score: null,
    });
  });
});

describe("V3 tool-envelope scorer", () => {
  it("verifies signatures, result hashes, canonical arguments, identity, and freshness", () => {
    expect(scoreV3ToolEnvelopeIntegrity(quoteFixture())).toMatchObject({
      status: "pass",
      passed: true,
    });
  });

  it("rejects wrong canonical arguments and stale evidence independently", () => {
    const input = quoteFixture();
    const wrongArgs = {
      ...input,
      tools: input.tools.map((item, index) =>
        index === 1 ? { ...item, arguments: { instrumentId: "US:AAPL" } } : item,
      ),
    };
    expect(scoreV3ToolEnvelopeIntegrity(wrongArgs).reasonCodes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^tool_arguments_hash_invalid:/u)]),
    );

    const stale = { ...input, evaluatedAt: NOW + 3 * 60_000 };
    expect(scoreV3ToolEnvelopeIntegrity(stale).reasonCodes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^tool_freshness_invalid:/u)]),
    );
  });

  it("rejects a signed-envelope payload that was changed after signing", () => {
    const input = quoteFixture();
    const quote = input.tools[1];
    if (quote === undefined) throw new Error("quote fixture is missing");
    const tamperedEnvelope = {
      ...quote.envelope,
      result: { price: decimal("999") },
    } as ToolExecutionEnvelope<unknown>;
    const tampered = {
      ...input,
      tools: [input.tools[0]!, { ...quote, envelope: tamperedEnvelope }],
    };
    expect(scoreV3ToolEnvelopeIntegrity(tampered).reasonCodes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^tool_signature_or_result_hash_invalid:/u),
      ]),
    );
  });
});

describe("V3 fact-derivation scorer", () => {
  it("verifies the signed fact and successful tool ancestry", () => {
    expect(scoreV3FactDerivation(quoteFixture()).status).toBe("pass");
  });

  it("rejects tampered values and signed facts with missing ancestors", () => {
    const input = quoteFixture();
    const original = input.response.facts[0];
    if (original === undefined) throw new Error("fixture fact is missing");
    const tampered = { ...original, value: { price: decimal("999") } };
    expect(scoreV3FactDerivation(replaceFact(input, tampered)).reasonCodes).toContain(
      `fact_signature_invalid:${original.factId}`,
    );

    const evidence = new EvidenceFactory({ signer: input.signer, now: () => NOW });
    const missingAncestor = evidence.fact({
      requestId: input.context.requestId,
      workflowRunId: input.response.provenance.workflowRunId,
      kind: "market.price",
      subject: { type: "instrument", ref: "US:NVDA" },
      asOf: new Date(NOW).toISOString(),
      value: { price: decimal("203.28") },
      provenance: {
        toolExecutionIds: ["missing-tool-execution"],
        inputFactIds: [],
        calculation: null,
      },
    });
    expect(scoreV3FactDerivation(replaceFact(input, missingAncestor)).reasonCodes).toEqual(
      expect.arrayContaining([
        `fact_tool_ancestor_missing:${missingAncestor.factId}:missing-tool-execution`,
      ]),
    );
  });
});

describe("V3 claim and citation lineage scorers", () => {
  it("rejects a material claim without fact or citation lineage", () => {
    const input = quoteFixture();
    const claim = input.response.claims[0];
    if (claim === undefined) throw new Error("fixture claim is missing");
    const response = {
      ...input.response,
      claims: [{ ...claim, factRefs: [], citationRefs: [] }],
      cards: [],
    };
    expect(scoreV3MaterialClaimLineage(replaceResponse(input, response))).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        `material_claim_ungrounded:${claim.claimId}`,
        expect.stringMatching(/^orphan_fact:/u),
      ]),
    });
  });

  it("independently rejects price and change labels bound to the wrong signed roles", () => {
    const input = quoteFixture();
    const fact = input.response.facts[0];
    const claim = input.response.claims[0];
    if (fact === undefined || claim === undefined) {
      throw new Error("Quote semantic-role fixture is incomplete.");
    }
    const response = {
      ...input.response,
      message: "The change is $203.28 and the price is the signed change.",
      claims: [{
        ...claim,
        textTemplate:
          "The change is {{PRICE}} and the price is {{CHANGE}}.",
        factRefs: [fact.factId]
      }]
    };
    const scored = scoreV3MaterialClaimLineage({
      ...input,
      response,
      factDisplays: [
        signedFactDisplay(fact, "$203.28", "PRICE", ["market.price"]),
        signedFactDisplay(fact, "the signed change", "CHANGE", ["market.change"])
      ]
    });

    expect(scored).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "claim_semantic_role_binding_invalid:claim-price:PRICE:market_change",
        "claim_semantic_role_binding_invalid:claim-price:CHANGE:market_price"
      ])
    });
  });

  it("accepts price and change labels when each is locally bound to its signed role", () => {
    const input = quoteFixture();
    const fact = input.response.facts[0];
    const claim = input.response.claims[0];
    if (fact === undefined || claim === undefined) {
      throw new Error("Quote semantic-role fixture is incomplete.");
    }
    const response = {
      ...input.response,
      message: "The price is $203.28 and the change is the signed change.",
      claims: [{
        ...claim,
        textTemplate:
          "The price is {{PRICE}} and the change is {{CHANGE}}.",
        factRefs: [fact.factId]
      }]
    };

    expect(scoreV3MaterialClaimLineage({
      ...input,
      response,
      factDisplays: [
        signedFactDisplay(fact, "$203.28", "PRICE", ["market.price"]),
        signedFactDisplay(fact, "the signed change", "CHANGE", ["market.change"])
      ]
    })).toMatchObject({
      status: "pass",
      passed: true
    });
  });

  it("binds the Azerbaijani distribution-yield compound to its signed projection", () => {
    const input = quoteFixture();
    const fact = input.response.facts[0];
    const claim = input.response.claims[0];
    if (fact === undefined || claim === undefined) {
      throw new Error("Distribution-yield semantic-role fixture is incomplete.");
    }
    const response = {
      ...input.response,
      message: "paylanma gəlirliliyi: 1,25%",
      claims: [{
        ...claim,
        locale: "az-AZ" as const,
        textTemplate: "paylanma gəlirliliyi: {{DISTRIBUTION}}",
        factRefs: [fact.factId]
      }]
    };
    const common = {
      ...input,
      route: routeV3Request("Paylanma gəlirliliyi nədir?", {
        locale: "az-AZ"
      }),
      context: { ...input.context, locale: "az-AZ" as const },
      response
    };

    expect(scoreV3MaterialClaimLineage({
      ...common,
      factDisplays: [
        signedFactDisplay(
          fact,
          "1,25%",
          "DISTRIBUTION",
          ["fundamental.dividend_yield"]
        )
      ]
    })).toMatchObject({
      status: "pass",
      passed: true
    });

    expect(scoreV3MaterialClaimLineage({
      ...common,
      factDisplays: [
        signedFactDisplay(
          fact,
          "1,25%",
          "DISTRIBUTION",
          ["portfolio.allocation"]
        )
      ]
    })).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "claim_semantic_role_binding_invalid:claim-price:DISTRIBUTION:fundamental_yield"
      ])
    });
  });

  it("accepts the exact constrained English and Azerbaijani colon-bound market shapes", () => {
    const input = quoteFixture();
    const fact = input.response.facts[0];
    const claim = input.response.claims[0];
    if (fact === undefined || claim === undefined) {
      throw new Error("Quote semantic-role fixture is incomplete.");
    }
    const displays = [
      signedFactDisplay(fact, "NVIDIA Corporation (NVDA)", "F1_IDENTITY", [
        "instrument.identity"
      ]),
      signedFactDisplay(fact, "$203.28 (+0.23%)", "F1_QUOTE", [
        "market.price",
        "market.change"
      ]),
      signedFactDisplay(fact, "$5.00T", "F1_MARKET_CAP", [
        "valuation.market_cap"
      ]),
      signedFactDisplay(fact, "42.50", "F1_TRAILING_PE", ["valuation.pe"]),
      signedFactDisplay(fact, "Yahoo Finance as of July 22", "F1_SOURCE", [
        "source.identity",
        "source.time"
      ])
    ];

    const english = scoreV3MaterialClaimLineage({
      ...input,
      response: {
        ...input.response,
        claims: [{
          ...claim,
          textTemplate:
            "{{F1_IDENTITY}} — quote: {{F1_QUOTE}}; market cap: {{F1_MARKET_CAP}}; trailing P/E: {{F1_TRAILING_PE}}; {{F1_SOURCE}}",
          factRefs: [fact.factId]
        }]
      },
      factDisplays: displays
    });
    expect(english).toMatchObject({ status: "pass", passed: true });

    const azerbaijani = scoreV3MaterialClaimLineage({
      ...input,
      route: routeV3Request("NVDA göstəricilərini izah et", {
        locale: "az-AZ"
      }),
      context: { ...input.context, locale: "az-AZ" },
      response: {
        ...input.response,
        claims: [{
          ...claim,
          locale: "az-AZ" as const,
          textTemplate:
            "{{F1_IDENTITY}} — kotirovka: {{F1_QUOTE}}; bazar kapitallaşması: {{F1_MARKET_CAP}}; P/E: {{F1_TRAILING_PE}}; {{F1_SOURCE}}",
          factRefs: [fact.factId]
        }]
      },
      factDisplays: displays
    });
    expect(azerbaijani).toMatchObject({ status: "pass", passed: true });
  });

  it("rejects colon-bound market labels attached to signed values with other roles", () => {
    const input = quoteFixture();
    const fact = input.response.facts[0];
    const claim = input.response.claims[0];
    if (fact === undefined || claim === undefined) {
      throw new Error("Quote semantic-role fixture is incomplete.");
    }
    const scored = scoreV3MaterialClaimLineage({
      ...input,
      route: routeV3Request("NVDA göstəricilərini izah et", {
        locale: "az-AZ"
      }),
      context: { ...input.context, locale: "az-AZ" },
      response: {
        ...input.response,
        claims: [{
          ...claim,
          locale: "az-AZ" as const,
          textTemplate:
            "{{F1_IDENTITY}} — kotirovka: {{F1_MARKET_CAP}}; bazar kapitallaşması: {{F1_QUOTE}}; P/E: {{F1_TRAILING_PE}}; {{F1_SOURCE}}",
          factRefs: [fact.factId]
        }]
      },
      factDisplays: [
        signedFactDisplay(fact, "NVIDIA Corporation (NVDA)", "F1_IDENTITY", [
          "instrument.identity"
        ]),
        signedFactDisplay(fact, "$203.28 (+0.23%)", "F1_QUOTE", [
          "market.price",
          "market.change"
        ]),
        signedFactDisplay(fact, "$5.00T", "F1_MARKET_CAP", [
          "valuation.market_cap"
        ]),
        signedFactDisplay(fact, "42.50", "F1_TRAILING_PE", ["valuation.pe"]),
        signedFactDisplay(fact, "Yahoo Finance as of July 22", "F1_SOURCE", [
          "source.identity",
          "source.time"
        ])
      ]
    });

    expect(scored).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "claim_semantic_role_binding_invalid:claim-price:F1_MARKET_CAP:market_price",
        "claim_semantic_role_binding_invalid:claim-price:F1_QUOTE:valuation_market_cap"
      ])
    });
  });

  it("fails closed for an Azerbaijani price/change inversion", () => {
    const input = quoteFixture();
    const fact = input.response.facts[0];
    const claim = input.response.claims[0];
    if (fact === undefined || claim === undefined) {
      throw new Error("Quote semantic-role fixture is incomplete.");
    }
    const azContext: TrustedRequestContext = {
      ...input.context,
      locale: "az-AZ"
    };
    const response = {
      ...input.response,
      message: "Dəyişiklik $203.28-dir, qiymət isə imzalanmış dəyişiklikdir.",
      claims: [{
        ...claim,
        locale: "az-AZ" as const,
        textTemplate:
          "Dəyişiklik {{PRICE}}-dir, qiymət isə {{CHANGE}}-dir.",
        factRefs: [fact.factId]
      }]
    };
    const scored = scoreV3MaterialClaimLineage({
      ...input,
      route: routeV3Request("NVDA səhminin cari qiyməti nədir?", {
        locale: "az-AZ"
      }),
      context: azContext,
      response,
      factDisplays: [
        signedFactDisplay(fact, "$203.28", "PRICE", ["market.price"]),
        signedFactDisplay(
          fact,
          "imzalanmış dəyişiklik",
          "CHANGE",
          ["market.change"]
        )
      ]
    });

    expect(scored).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "claim_semantic_role_binding_invalid:claim-price:PRICE:market_change",
        "claim_semantic_role_binding_invalid:claim-price:CHANGE:market_price"
      ])
    });
  });

  it("rejects semantic roles changed after the projection was signed", () => {
    const input = quoteFixture();
    const display = input.factDisplays?.[0];
    if (display === undefined) {
      throw new Error("Signed semantic projection is missing.");
    }
    const scored = scoreV3MaterialClaimLineage({
      ...input,
      factDisplays: [{
        ...display,
        semanticRoles: ["market.change"]
      }]
    });

    expect(scored).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "claim_semantic_projection_invalid:claim-price:PRICE"
      ])
    });

    expect(scoreV3MaterialClaimLineage({
      ...input,
      factDisplays: []
    })).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        `claim_semantic_projection_missing:claim-price:${display.factId}`
      ])
    });
  });

  it("accepts eligible current citations with signed approved-document ancestry", () => {
    const input = knowledgeFixture();
    expect(scoreV3MaterialClaimLineage(input).status).toBe("pass");
    expect(scoreV3CitationIntegrity(input)).toMatchObject({ status: "pass", passed: true });
  });

  it("independently re-authorizes and hashes every governed navigation action field", () => {
    const input = fundingActionFixture();
    expect(scoreV3CitationIntegrity(input)).toMatchObject({ status: "pass", passed: true });
    expect(scoreV3ResponseForDelivery(input)).toMatchObject({
      passed: true,
      delivery: "allow"
    });

    const action = input.response.actions[0];
    if (action?.kind !== "open-in-app") throw new Error("fixture action is missing");
    const tamperedCatalog = replaceResponse(input, {
      ...input.response,
      actions: [{ ...action, catalogVersion: "tampered-catalog-v9" }]
    });
    expect(scoreV3CitationIntegrity(tamperedCatalog)).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining(["governed_navigation_action_mismatch"])
    });

    const disabledTarget = replaceResponse(input, {
      ...input.response,
      actions: [{
        ...action,
        target: "investments.price-alerts.create",
        href: "/investments/price-alerts/create"
      }]
    });
    expect(scoreV3CitationIntegrity(disabledTarget)).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "governed_navigation_denied:TARGET_DISABLED"
      ])
    });
  });

  it("independently re-authorizes every field of a signed read-only view action", () => {
    const input = readOnlyQuoteNavigationFixture();
    expect(scoreV3NavigationIntegrity(input)).toMatchObject({
      status: "pass",
      passed: true
    });
    expect(scoreV3ResponseForDelivery(input)).toMatchObject({
      passed: true,
      delivery: "allow"
    });

    const action = input.response.actions[0];
    if (action?.kind !== "open-read-only-view") {
      throw new Error("Read-only navigation fixture is missing.");
    }
    for (const tampered of [
      { ...action, actionId: "view-portfolio-overview" as const },
      { ...action, label: "Trade NVDA now" },
      { ...action, href: "/investments/instruments?symbol=NVDA" as typeof action.href },
      { ...action, target: "investments.portfolio.overview" as const },
      { ...action, catalogVersion: "tampered-v9" as typeof action.catalogVersion },
      { ...action, factRefs: ["another-fact"] as [string] }
    ]) {
      expect(scoreV3NavigationIntegrity(replaceResponse(input, {
        ...input.response,
        actions: [tampered]
      }))).toMatchObject({
        status: "fail",
        reasonCodes: expect.arrayContaining([
          "read_only_navigation_action_mismatch"
        ])
      });
    }

    const missing = replaceResponse(input, {
      ...input.response,
      actions: []
    });
    expect(scoreV3NavigationIntegrity(missing)).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "read_only_navigation_action_count_invalid"
      ])
    });
    expect(scoreV3ResponseForDelivery(missing)).toMatchObject({
      delivery: "block",
      blockedBy: expect.arrayContaining([
        "fail:v3.response.navigation-integrity"
      ])
    });
  });

  it("binds every order-preview action field and card to one signed preview fact", () => {
    const input = orderActionFixture();
    expect(scoreV3MaterialClaimLineage(input)).toMatchObject({
      status: "pass",
      passed: true,
    });

    const action = input.response.actions[0];
    if (action?.kind !== "open-signed-order-ticket") {
      throw new Error("Order action fixture is missing.");
    }
    for (const tampered of [
      { ...action, actionId: "confirm-a-different-intent" },
      { ...action, label: "Buy now" },
      { ...action, href: "/orders/execute" },
      { ...action, expiresAt: new Date(NOW + 60_000).toISOString() },
      { ...action, intentId: "00000000-0000-4000-8000-000000000999" },
    ]) {
      const result = scoreV3MaterialClaimLineage(replaceResponse(input, {
        ...input.response,
        actions: [tampered],
      }));
      expect(result.status).toBe("fail");
      expect(result.reasonCodes).toEqual(expect.arrayContaining([
        expect.stringMatching(/^order_action_/u),
      ]));
    }

    const wrongRoute = {
      ...input,
      route: routeV3Request("What is the AAPL price?"),
    };
    expect(scoreV3MaterialClaimLineage(wrongRoute).reasonCodes).toContain(
      "order_action_route_invalid",
    );
    expect(scoreV3ResponseForDelivery(wrongRoute)).toMatchObject({
      delivery: "block",
      blockedBy: expect.arrayContaining([
        "fail:v3.response.material-claim-lineage",
      ]),
    });

    const card = input.response.cards[0];
    if (!card) throw new Error("Order preview card fixture is missing.");
    const changedCard = replaceResponse(input, {
      ...input.response,
      cards: [{ ...card, data: { intentId: action.intentId } }],
    });
    expect(scoreV3MaterialClaimLineage(changedCard).reasonCodes).toContain(
      "order_action_preview_card_mismatch",
    );

    const mismatchedRequest = {
      ...input,
      requestMessage: "Open a $200 AAPL buy ticket"
    };
    expect(scoreV3MaterialClaimLineage(mismatchedRequest)).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "order_action_request_semantics_mismatch"
      ])
    });
    const {
      requestMessage: presentRequestMessage,
      ...missingRequestMessage
    } = input;
    if (!presentRequestMessage) throw new Error("Order request fixture is missing.");
    expect(scoreV3MaterialClaimLineage(missingRequestMessage)).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "order_action_request_message_missing"
      ])
    });

    const missingAction = replaceResponse(input, {
      ...input.response,
      actions: [],
    });
    expect(scoreV3MaterialClaimLineage(missingAction)).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining(["order_action_count_invalid"]),
    });
    expect(scoreV3ResponseForDelivery(missingAction)).toMatchObject({
      delivery: "block",
      blockedBy: expect.arrayContaining([
        "fail:v3.response.material-claim-lineage",
      ]),
    });
  });

  it("canonically binds every activity card record to one signed activity fact", () => {
    const input = activityCardFixture();
    expect(scoreV3MaterialClaimLineage(input)).toMatchObject({
      status: "pass",
      passed: true,
    });
    const card = input.response.cards[0];
    if (card?.kind !== "activity") throw new Error("Activity card fixture is missing.");

    for (const mutation of [
      { field: "side", value: "SELL" },
      { field: "symbol", value: "AAPL" },
      { field: "recordType", value: "order" },
      { field: "positionEffect", value: "ORDER_STATE_ONLY" },
    ] as const) {
      const data = structuredClone(card.data) as {
        records: Array<Record<string, unknown>>;
      };
      data.records[0]![mutation.field] = mutation.value;
      const tampered = replaceResponse(input, {
        ...input.response,
        cards: [{ ...card, data }],
      });
      expect(scoreV3MaterialClaimLineage(tampered)).toMatchObject({
        status: "fail",
        reasonCodes: expect.arrayContaining([
          "activity_card_signed_fact_mismatch",
        ]),
      });
      expect(scoreV3ResponseForDelivery(tampered)).toMatchObject({
        delivery: "block",
        blockedBy: expect.arrayContaining([
          "fail:v3.response.material-claim-lineage",
        ]),
      });
    }

    const missingCard = replaceResponse(input, {
      ...input.response,
      cards: [],
    });
    expect(scoreV3MaterialClaimLineage(missingCard).reasonCodes).toContain(
      "activity_card_count_invalid",
    );
  });

  it("fails closed for command action kinds without a reviewed authorizer", () => {
    const input = quoteFixture();
    const unsupported = replaceResponse(input, {
      ...input.response,
      actions: [{
        actionId: "open-unreviewed-source",
        kind: "open-official-source",
        label: "Open source",
        href: "https://example.test/source",
        expiresAt: null,
        intentId: null,
      }],
    });
    expect(scoreV3MaterialClaimLineage(unsupported)).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "command_action_not_authorized:open-official-source",
      ]),
    });
  });

  it("rejects citation checksum tampering, expiry, and missing required citations", () => {
    const input = knowledgeFixture();
    const citation = input.response.citations[0];
    if (citation === undefined) throw new Error("fixture citation is missing");
    const tamperedResponse = {
      ...input.response,
      citations: [{ ...citation, contentHash: "b".repeat(64) }],
    };
    expect(scoreV3CitationIntegrity(replaceResponse(input, tamperedResponse)).reasonCodes).toContain(
      `citation_signed_lineage_missing:${citation.citationId}`,
    );

    const expiredResponse = {
      ...input.response,
      citations: [{ ...citation, effectiveTo: "2026-07-10T00:00:00.000Z" }],
    };
    expect(scoreV3CitationIntegrity(replaceResponse(input, expiredResponse)).reasonCodes).toContain(
      `citation_eligibility_invalid:${citation.citationId}`,
    );

    const noCitationResponse = {
      ...input.response,
      citations: [],
      claims: input.response.claims.map((claim) => ({ ...claim, citationRefs: [] })),
    };
    expect(scoreV3CitationIntegrity(replaceResponse(input, noCitationResponse))).toMatchObject({
      status: "fail",
      reasonCodes: ["required_citations_missing"],
    });
  });
});

describe("V3 exact-value and response-quality scorers", () => {
  it("allows exact values only when present in a display attached to a signed fact", () => {
    const input = quoteFixture();
    expect(scoreV3NumericDateGrounding(input).status).toBe("pass");

    const isoResponse = {
      ...input.response,
      message: "NVDA is $203.28 as of 2026-07-22T08:00:00.000Z.",
    };
    expect(scoreV3NumericDateGrounding({
      ...input,
      response: isoResponse,
      // The scorer normalizes signed displays before extracting tokens.
      factDisplays: [signedFactDisplay(
        input.response.facts[0]!,
        "$203.28 as of 2026-07-22T08:00:00.000Z"
      )],
    }).status).toBe("pass");

    const inventedResponse = {
      ...input.response,
      message: "NVDA is $999.00 as of July 22, 2026.",
    };
    expect(scoreV3NumericDateGrounding(replaceResponse(input, inventedResponse))).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        expect.stringMatching(/^ungrounded_exact_value:\$999\.00/u),
      ]),
    });

    const numericPrefixResponse = { ...input.response, message: "NVDA is $20." };
    expect(
      scoreV3NumericDateGrounding(replaceResponse(input, numericPrefixResponse)).status,
    ).toBe("fail");

    const signedDisplay = input.factDisplays?.[0];
    if (signedDisplay === undefined) throw new Error("signed display is missing");
    expect(scoreV3NumericDateGrounding({
      ...input,
      factDisplays: [{ ...signedDisplay, display: "$999.00 as of July 22, 2026" }]
    })).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        `signed_fact_display_invalid:${input.response.facts[0]!.factId}`
      ])
    });

    expect(scoreV3NumericDateGrounding({
      ...replaceResponse(input, inventedResponse),
      factDisplays: [signedFactDisplay(
        input.response.facts[0]!,
        "$999.00 as of July 22, 2026"
      )]
    })).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        `fact_display_value_mismatch:${input.response.facts[0]!.factId}:F1`
      ])
    });

    const unicodeNumberResponse = {
      ...input.response,
      message: "NVDA is ١١ and $203.28 as of July 22, 2026."
    };
    expect(scoreV3NumericDateGrounding(
      replaceResponse(input, unicodeNumberResponse)
    )).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining(["ungrounded_non_ascii_numeric"])
    });
  });

  it("accepts compact amounts and timestamps copied from signed textual evidence", () => {
    const input = quoteFixture();
    const evidence = new EvidenceFactory({ signer: signer(), now: () => NOW });
    const quoteExecutionId = input.tools[1]!.envelope.executionId;
    const fact = evidence.fact({
      requestId: input.context.requestId,
      workflowRunId: "workflow-response-score-1",
      kind: "market.move-explanation",
      subject: { type: "instrument", ref: "NVDA" },
      asOf: new Date(NOW).toISOString(),
      value: {
        possibleContext: {
          items: [{
            title: "Nvidia behind $50 billion lease on Texas data center",
            publishedAt: "2026-07-22T04:13:40.000Z"
          }]
        },
        causalityEstablished: false
      },
      provenance: {
        toolExecutionIds: [quoteExecutionId],
        inputFactIds: [],
        calculation: null
      }
    });
    const display =
      "“Nvidia behind $50 billion lease on Texas data center” (2026-07-22T04:13:40.000Z)";
    const response = {
      ...input.response,
      message: display,
      facts: [fact],
      claims: [{
        claimId: "claim-market-context",
        locale: "en-US" as const,
        textTemplate: "{{CONTEXT}}",
        factRefs: [fact.factId],
        citationRefs: [],
        limitations: []
      }],
      cards: [],
      charts: [],
      provenance: {
        ...input.response.provenance,
        factIds: [fact.factId]
      }
    };

    expect(scoreV3NumericDateGrounding({
      ...input,
      response,
      factDisplays: [signedFactDisplay(fact, display, "CONTEXT")]
    })).toMatchObject({
      status: "pass",
      reasonCodes: ["all_exact_numbers_dates_cards_and_charts_are_grounded"]
    });
  });

  it("aggregates exact-value displays from granular aliases sharing one signed fact", () => {
    const input = quoteFixture();
    const factId = input.response.facts[0]!.factId;
    const response = {
      ...input.response,
      message: "NVDA is $203.28, observed on July 22, 2026."
    };

    expect(scoreV3NumericDateGrounding({
      ...input,
      response,
      factDisplays: [
        signedFactDisplay(input.response.facts[0]!, "$203.28", "PRICE"),
        signedFactDisplay(input.response.facts[0]!, "July 22, 2026", "DATE")
      ]
    })).toMatchObject({
      status: "pass",
      reasonCodes: ["all_exact_numbers_dates_cards_and_charts_are_grounded"]
    });
  });

  it("blocks ungrounded card numbers and charts that diverge from signed history", () => {
    const input = quoteFixture();
    const factId = input.response.facts[0]!.factId;
    const cardTamper = {
      ...input.response,
      cards: [{
        cardId: "card-price",
        kind: "market" as const,
        title: "NVDA",
        factRefs: [factId],
        data: { symbol: "NVDA", price: "999.00000000" }
      }]
    };
    expect(scoreV3NumericDateGrounding(replaceResponse(input, cardTamper))).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        expect.stringMatching(/^ungrounded_card_exact_value:card-price:999/u)
      ])
    });

    const history = input.tools.find(({ envelope }) =>
      envelope.toolId === "read-price-history"
    )?.envelope.result as {
      symbol: string;
      range: "10y";
      currency: string;
      asOf: string;
      points: Array<{ timestamp: string; close: ReturnType<typeof decimal> }>;
    };
    const chartResponse = {
      ...input.response,
      charts: [{
        chartId: "chart-NVDA-10y",
        symbol: history.symbol,
        range: history.range,
        currency: history.currency,
        asOf: history.asOf,
        source: "Signed test history",
        points: history.points
      }]
    };
    expect(scoreV3NumericDateGrounding(replaceResponse(input, chartResponse)).status).toBe("pass");
    const changedChart = {
      ...chartResponse,
      charts: chartResponse.charts.map((chart) => ({
        ...chart,
        points: chart.points.map((point) => ({ ...point, close: decimal("999") }))
      }))
    };
    expect(scoreV3NumericDateGrounding(replaceResponse(input, changedChart))).toMatchObject({
      status: "fail",
      reasonCodes: ["chart_history_evidence_mismatch:chart-NVDA-10y"]
    });
  });

  it("does not treat a citation marker as an authored number", () => {
    const input = knowledgeFixture();
    expect(scoreV3NumericDateGrounding(input)).toMatchObject({
      status: "not_applicable",
      applicable: false,
      passed: false,
      score: null,
    });
  });

  it("passes natural concise prose and rejects machine-style or verbose output", () => {
    const input = quoteFixture();
    expect(scoreV3ConversationalQuality(input).status).toBe("pass");

    const conciseFinancialResponse = {
      ...input.response,
      message:
        "A $100.00 preview is about 0.4348 shares at $230.00. Commission is $0.00; total $100.00. This is not an order.",
    };
    expect(
      scoreV3ConversationalQuality(replaceResponse(input, conciseFinancialResponse)).status,
    ).toBe("pass");

    const machineResponse = {
      ...input.response,
      message: "DETERMINISTIC RESPONSE · GROUNDING PASSED · read-market-snapshot",
    };
    expect(scoreV3ConversationalQuality(replaceResponse(input, machineResponse))).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining(["response_exposes_internal_or_machine_labels"]),
    });

    const verboseResponse = {
      ...input.response,
      message: `${"word ".repeat(141)}.`,
    };
    expect(scoreV3ConversationalQuality(replaceResponse(input, verboseResponse)).reasonCodes).toContain(
      "response_too_long",
    );
  });

  it("enforces the non-advisory boundary and recomputes a hypothetical position from request-bound evidence", () => {
    const input = hypotheticalPositionFixture();
    expect(scoreV3ConversationalQuality(input)).toMatchObject({
      status: "pass"
    });

    const recommendation = replaceResponse(input, {
      ...input.response,
      message: "I recommend selling these shares."
    });
    expect(scoreV3ConversationalQuality(recommendation)).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "decision_support_non_advisory_boundary_missing",
        "decision_support_recommendation_language_forbidden"
      ])
    });

    const original = input.response.facts[0];
    if (original === undefined || typeof original.value !== "object" || original.value === null) {
      throw new Error("Hypothetical position fact is missing.");
    }
    const evidence = new EvidenceFactory({ signer: input.signer, now: () => NOW });
    const altered = evidence.fact({
      requestId: original.requestId,
      workflowRunId: original.workflowRunId,
      kind: original.kind,
      subject: original.subject,
      asOf: original.asOf,
      value: {
        ...original.value,
        initialInvestment: decimal("999")
      },
      provenance: original.provenance,
      quality: original.quality
    });
    const alteredInput = replaceFact(input, altered);
    const alteredResponse: AssistantResponse = {
      ...alteredInput.response,
      cards: [{
        cardId: `card-${altered.factId}`,
        kind: "position-analysis",
        title: "NVDA hypothetical position",
        factRefs: [altered.factId],
        data: altered.value
      }]
    };
    expect(scoreV3ConversationalQuality(
      replaceResponse(alteredInput, alteredResponse)
    )).toMatchObject({
      status: "fail",
      reasonCodes: expect.arrayContaining([
        "hypothetical_position_calculation_mismatch"
      ])
    });
  });
});

describe("V3 P0 blocking response aggregate", () => {
  it("allows a fully grounded response while preserving N/A as non-pass", () => {
    const result = scoreV3ResponseForDelivery(quoteFixture());

    expect(result).toMatchObject({
      capability: "response-delivery",
      priority: "P0",
      delivery: "allow",
      passed: true,
      failedCount: 0,
      errorCount: 0,
    });
    expect(result.results).toHaveLength(V3_BLOCKING_RESPONSE_SCORER_IDS.length);
    expect(
      result.results.find((score) => score.scorerId === "v3.response.citation-integrity"),
    ).toMatchObject({ status: "not_applicable", passed: false, score: null });
  });

  it("blocks delivery on any applicable failure", () => {
    const input = quoteFixture();
    const response = { ...input.response, message: "NVDA is $999.00." };
    const result = scoreV3ResponseForDelivery(replaceResponse(input, response));

    expect(result).toMatchObject({
      priority: "P0",
      delivery: "block",
      passed: false,
    });
    expect(result.blockedBy).toContain("fail:v3.response.numeric-date-grounding");
  });

  it("isolates scorer exceptions and blocks on the resulting error", () => {
    const explosive = { ...quoteFixture() } as V3ResponseScoringInput;
    Object.defineProperty(explosive, "evaluatedAt", {
      enumerable: true,
      get: () => {
        throw new Error("clock unavailable");
      },
    });
    const result = scoreV3ResponseForDelivery(explosive);

    expect(result.delivery).toBe("block");
    expect(result.results.some((score) => score.status === "error")).toBe(true);
    expect(result.results.some((score) => score.status === "pass")).toBe(true);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it("blocks when a required scorer is missing", () => {
    const onlyQuality = scoreV3ConversationalQuality(quoteFixture());
    const aggregate = aggregateV3ResponseScores([onlyQuality]);

    expect(aggregate.delivery).toBe("block");
    expect(aggregate.blockedBy).toEqual(
      expect.arrayContaining([
        "missing_scorer:v3.response.required-tool-set",
        "missing_scorer:v3.response.numeric-date-grounding",
      ]),
    );
  });

  it("does not allow delivery when every scorer is not applicable", () => {
    const aggregate = aggregateV3ResponseScores(
      V3_BLOCKING_RESPONSE_SCORER_IDS.map((scorerId) =>
        v3NotApplicableScore(scorerId, "fixture_not_applicable"),
      ),
    );

    expect(aggregate).toMatchObject({
      delivery: "block",
      passed: false,
      score: null,
      passedCount: 0,
      failedCount: 0,
      notApplicableCount: V3_BLOCKING_RESPONSE_SCORER_IDS.length,
      errorCount: 0,
      blockedBy: ["no_applicable_scorer_passed"],
    });
  });
});
