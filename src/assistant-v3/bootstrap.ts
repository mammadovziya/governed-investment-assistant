import { LibSQLVector } from "@mastra/libsql";

import { config } from "../config.js";
import { approvedProductKnowledgeDocuments } from "../data/approved-product-knowledge.js";
import {
  createApprovedFinancialEducationRegistry
} from "../data/approved-financial-education.js";
import { KnowledgeRegistry } from "../services/knowledge-registry.js";
import { ApprovedKnowledgeService } from "../services/knowledge-retrieval.js";
import {
  ApprovedFinancialEducationService
} from "../services/financial-education-retrieval.js";
import { YahooMarketHistoryProvider } from "../services/market-history.js";
import { operationalMetrics } from "../services/operational-metrics.js";
import {
  ApprovedKnowledgeBoundaryAdapter,
  InternalPilotOrderEligibilityPort,
  LiveInstrumentResolver,
  LivePriceHistoryPort,
  SignedOrderHandoffAdapter,
  SyntheticPortfolioPort
} from "./adapters.js";
import { V3AuditOutbox } from "./audit.js";
import { v3Logger } from "./logging.js";
import type { V3BoundaryToolDependencies } from "./boundary-tools.js";
import {
  OrderConfirmationAuthority,
  TrustedRequestContextAuthority
} from "./context-authority.js";
import { V3ToolGrantAuthority } from "./grants.js";
import { OrderHandoffStore } from "./order-handoff.js";
import { YahooDevelopmentMarketResearchProvider } from "./providers.js";
import { createV3MastraRegistry } from "./registry.js";
import { V3AssistantRuntime } from "./runtime.js";
import { V3SessionAuthority } from "./sessions.js";
import { DevHmacSigner } from "./signing.js";
import { V3TelemetryMetrics } from "./telemetry.js";
import { V3DashboardPortfolioAdapter } from "./dashboard-portfolio.js";
import { BoundedV3ConversationMemory } from "./conversation-memory.js";
import { createV3Observability } from "./observability.js";
import {
  createV3ObservabilityBridgeExporter,
  probeV3ObservabilityBridge,
  type V3ObservabilityBridgeConfig
} from "./observability-bridge.js";
import { createAssistantV3MastraStorage } from "./mastra-storage.js";
import { CbarCurrencyRateProvider } from "./currency-rates.js";
import {
  UnavailableMarketHistoryProvider,
  UnavailablePublicMarketResearchProvider
} from "./unavailable-public-market.js";
import {
  SyntheticOfflineMarketHistoryProvider,
  SyntheticOfflineMarketResearchProvider
} from "./synthetic-public-market.js";

export function runtimeEnvironment(): "development" | "test" | "staging" | "production" {
  if (
    config.environment === "test" ||
    config.environment === "staging" ||
    config.environment === "production"
  ) return config.environment;
  return "development";
}

export type PublicMarketBootstrapMode =
  | "synthetic-offline"
  | "yahoo-development"
  | "unavailable-fail-closed";

export function publicMarketBootstrapMode(input: {
  environment: ReturnType<typeof runtimeEnvironment>;
  releaseTarget: typeof config.assistantReleaseTarget;
  requestedProvider?: typeof config.assistantDemoMarketProvider;
}): PublicMarketBootstrapMode {
  if (
    input.releaseTarget === "internal-pilot" &&
    (input.environment === "development" || input.environment === "test")
  ) {
    return input.requestedProvider === "yahoo-development"
      ? "yahoo-development"
      : "synthetic-offline";
  }
  return "unavailable-fail-closed";
}

export function createAssistantV3Application() {
  const environment = runtimeEnvironment();
  const marketBootstrapMode = publicMarketBootstrapMode({
    environment,
    releaseTarget: config.assistantReleaseTarget,
    requestedProvider: config.assistantDemoMarketProvider
  });
  const signer = new DevHmacSigner({
    keyId: config.assistantUsesDevelopmentSigningKey
      ? "assistant-v3-development"
      : "assistant-v3-managed",
    secret: config.assistantSigningKey
  });
  const sessionAuthority = new V3SessionAuthority({
    secret: `session:${config.assistantSigningKey}`,
    defaultTtlMs: config.assistantV3SessionTtlMs
  });
  const contextAuthority = new TrustedRequestContextAuthority();
  const confirmationAuthority = new OrderConfirmationAuthority();
  const grantAuthority = new V3ToolGrantAuthority();
  const history =
    marketBootstrapMode === "yahoo-development"
      ? new YahooMarketHistoryProvider({
          cacheMs: 60_000,
          timeoutMs: config.marketTimeoutMs
        })
      : marketBootstrapMode === "synthetic-offline"
        ? new SyntheticOfflineMarketHistoryProvider()
        : new UnavailableMarketHistoryProvider();
  const market =
    marketBootstrapMode === "yahoo-development"
      ? new YahooDevelopmentMarketResearchProvider({
          environment,
          marketDataOptions: {
            cacheMs: config.marketCacheMs,
            timeoutMs: config.marketTimeoutMs
          },
          securityResearchOptions: {
            cacheMs: 5 * 60_000,
            timeoutMs: config.marketTimeoutMs,
            historyProvider: history
          }
        })
      : marketBootstrapMode === "synthetic-offline"
        ? new SyntheticOfflineMarketResearchProvider()
        : new UnavailablePublicMarketResearchProvider();
  const dashboardPortfolio = new V3DashboardPortfolioAdapter(market);
  const knowledgeVector = new LibSQLVector({
    id: "demo-invest-approved-knowledge-v3",
    url: config.knowledgeVectorUrl,
    maxRetries: 5,
    initialBackoffMs: 100,
    vectorTopKOverFetchMultiplier: 20
  });
  const observabilityBridge: V3ObservabilityBridgeConfig | null =
    config.mastraObservabilityShared
      ? {
          endpoint: config.mastraObservabilityBridgeEndpoint,
          accessToken: config.mastraObservabilityBridgeToken
        }
      : null;
  const mastraStorage = createAssistantV3MastraStorage({
    id: "governed-investment-assistant-v3-storage",
    defaultStoreId: "governed-investment-assistant-v3-workflows",
    observabilityStoreId: "governed-investment-assistant-v3-observability",
    defaultUrl: config.mastraStorageUrl,
    // In shared mode Studio is the sole DuckDB owner. The application keeps
    // only an ephemeral observability domain for Mastra's storage contract and
    // publishes its scrubbed signals through the authenticated loopback bridge.
    observabilityPath:
      observabilityBridge === null ? config.mastraObservabilityPath : ":memory:",
    connectionTimeoutMs: 5_000,
    maxRetries: 5,
    initialBackoffMs: 100
  });
  // Readiness must probe the same volatile workflow domain that Mastra uses,
  // never the durable LibSQL fallback where raw workflow snapshots are forbidden.
  const workflowStorage = mastraStorage;
  const observabilityStorage = mastraStorage.observabilityStore;
  const observability = createV3Observability(
    observabilityBridge === null
      ? {
          modelCostMetricRecorder: (metric) =>
            operationalMetrics.recordModelEstimatedCost(metric)
        }
      : {
          exporter: createV3ObservabilityBridgeExporter(observabilityBridge),
          modelCostMetricRecorder: (metric) =>
            operationalMetrics.recordModelEstimatedCost(metric)
        }
  );
  const knowledgeRegistry = new KnowledgeRegistry(
    approvedProductKnowledgeDocuments,
    config.knowledgeApprovalMode
  );
  const approvedKnowledge = new ApprovedKnowledgeService({
    registry: knowledgeRegistry,
    vectorStore: knowledgeVector,
    indexName: config.knowledgeIndexName,
    indexGeneration: config.knowledgeIndexGeneration,
    minimumScore: config.knowledgeMinimumScore
  });
  const financialEducation = new ApprovedFinancialEducationService({
    registry: createApprovedFinancialEducationRegistry(),
    minimumScore: 0.2,
    topK: 3
  });
  const orderHandoffStore = new OrderHandoffStore({
    signer,
    ttlMs: Math.min(config.assistantV3OrderHandoffTtlMs, 5 * 60_000)
  });
  const audit = new V3AuditOutbox({
    filePath: config.assistantAuditOutboxPath
  });
  const boundaryDependencies: V3BoundaryToolDependencies = {
    grantAuthority,
    signer,
    instrumentResolver: new LiveInstrumentResolver(market),
    market,
    priceHistory: new LivePriceHistoryPort(history, market.descriptor),
    currencyRates: new CbarCurrencyRateProvider({
      timeoutMs: config.marketTimeoutMs
    }),
    portfolio: new SyntheticPortfolioPort({
      tenantRef: "tenant:demo-invest",
      principalRef: "principal:mock-client-001"
    }),
    approvedKnowledge: new ApprovedKnowledgeBoundaryAdapter(approvedKnowledge),
    financialEducation: {
      source: {
        provider: "approved-financial-education-registry",
        sourceId: "approved-financial-education-2026-07",
        sourceUrl: null,
        licenseClass: "project-internal",
        observedAt: new Date().toISOString(),
        sourceAsOf: new Date().toISOString()
      },
      retrieve: (input) => financialEducation.retrieve(input)
    },
    orderEligibility: new InternalPilotOrderEligibilityPort(),
    orderHandoff: new SignedOrderHandoffAdapter(orderHandoffStore)
  };
  const runtime = new V3AssistantRuntime({
    signer,
    sessionAuthority,
    contextAuthority,
    confirmationAuthority,
    grantAuthority,
    orderHandoffStore,
    approvedKnowledge,
    telemetry: new V3TelemetryMetrics(operationalMetrics),
    audit,
    environment,
    sessionTtlMs: config.assistantV3SessionTtlMs,
    modelTimeoutMs: config.modelTimeoutMs,
    productKnowledgeEnabled: config.assistantProductProfile === "demo-invest",
    conversationMemory: config.assistantV3ConversationMemoryEnabled
      ? new BoundedV3ConversationMemory({
          signer,
          ttlMs: config.assistantV3ConversationMemoryTtlMs,
          maxEntries: config.assistantV3ConversationMemoryMaxEntries,
          maxAssistedHops: config.assistantV3ConversationMemoryMaxHops
        })
      : false
  });
  const registry = createV3MastraRegistry({
    boundaryDependencies,
    workflowDependencies: runtime.workflowDependencies(),
    configuredModel: config.openaiModel,
    configuredEscalationModel: config.openaiEscalationModel,
    productName: config.publicBranding.productName,
    ...(config.openaiApiKey === undefined ? {} : { openaiApiKey: config.openaiApiKey }),
    storage: mastraStorage,
    logger: v3Logger,
    observability
  });
  runtime.attachFinancialTaskPlanner(registry.financialTaskPlanner);
  runtime.attachTopology({
    tools: registry.tools,
    workflows: {
      assistantRequest: registry.workflows["assistant-request-v3"],
      publicResearch: registry.workflows["public-research-v3"],
      portfolioInsight: registry.workflows["portfolio-insight-v3"],
      approvedKnowledge: registry.workflows["approved-knowledge-v3"],
      orderTicketHandoff: registry.workflows["order-ticket-handoff-v3"]
    }
  });
  const criticalReadiness = Object.freeze({
    signer: async (): Promise<boolean> => {
      const payload = {
        schemaVersion: "assistant-v3.signer-readiness.v1",
        purpose: "readiness-self-test"
      };
      return signer.verify(payload, signer.sign(payload));
    },
    audit: async (): Promise<boolean> => audit.readiness().ready,
    storage: async (): Promise<boolean> => {
      const workflows = await workflowStorage.getStore("workflows");
      if (workflows === undefined) return false;
      const page = await workflows.listWorkflowRuns({ page: 0, perPage: 1 });
      return Array.isArray(page.runs) &&
        Number.isSafeInteger(page.total) &&
        page.total >= 0 &&
        page.runs.length <= 1;
    },
    observability: async (): Promise<boolean> => {
      await observability.flush();
      const persistentStoreAvailable = observabilityBridge === null
        ? Array.isArray(
            (
              await observabilityStorage.observability.listTraces({
                pagination: { page: 0, perPage: 1 }
              })
            ).spans
          )
        : await probeV3ObservabilityBridge(observabilityBridge);
      const metrics = operationalMetrics.snapshot();
      return persistentStoreAvailable &&
        Array.isArray(metrics.counters) &&
        Array.isArray(metrics.gauges) &&
        Array.isArray(metrics.histograms);
    }
  });

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      // Drain and stop the exporter before Mastra releases its stores. In
      // shared mode this completes the last loopback publish before Studio
      // releases the sole DuckDB writer.
      try {
        await observability.flush();
      } catch {
        // A bounded bridge failure must not prevent the remaining local
        // resources from shutting down cleanly.
      }
      await observability.shutdown();
      await registry.mastra.shutdown();
      await knowledgeVector.close();
    })();
    return shutdownPromise;
  };

  return Object.freeze({
    runtime,
    registry,
    boundaryTools: registry.tools,
    approvedKnowledge,
    financialEducation,
    mastraStorage,
    workflowStorage,
    observabilityStorage,
    observability,
    knowledgeVector,
    market,
    history,
    dashboardPortfolio,
    criticalReadiness,
    shutdown
  });
}

export type AssistantV3Application = ReturnType<typeof createAssistantV3Application>;
