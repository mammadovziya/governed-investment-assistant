import { InMemoryStore } from "@mastra/core/storage";
import { MastraEditor } from "@mastra/editor";
import { Memory } from "@mastra/memory";

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
import type { ToolSource } from "./contracts.js";
import {
  V3BoundaryPortError,
  type V3BoundaryToolDependencies
} from "./boundary-tools.js";
import {
  ApprovedKnowledgeBoundaryAdapter,
  InternalPilotOrderEligibilityPort,
  LiveInstrumentResolver,
  LivePriceHistoryPort,
  SyntheticPortfolioPort
} from "./adapters.js";
import { EvidenceFactory } from "./evidence.js";
import { V3ToolGrantAuthority } from "./grants.js";
import { YahooDevelopmentMarketResearchProvider } from "./providers.js";
import {
  createV3MastraRegistry,
  V3_PRIVATE_STUDIO_POLICY,
  type V3RegistryWorkflowDependencies
} from "./registry.js";
import { DevHmacSigner } from "./signing.js";
import {
  V3PrivateStudioExecutionBroker,
  V3_PRIVATE_STUDIO_SYNTHETIC_SCOPE
} from "./studio-execution.js";
import { V3PrivateStudioKnowledgeVectorStore } from "./studio-knowledge-vector.js";
import { v3PrivateStudioLogger } from "./logging.js";
import { createAssistantV3MastraStorage } from "./mastra-storage.js";
import { createV3Observability } from "./observability.js";
import { createV3StudioObservabilityBridgeRoutes } from "./studio-observability-bridge.js";
import { CbarCurrencyRateProvider } from "./currency-rates.js";
import {
  SyntheticOfflineMarketHistoryProvider,
  SyntheticOfflineMarketResearchProvider
} from "./synthetic-public-market.js";
import {
  UnavailableMarketHistoryProvider,
  UnavailablePublicMarketResearchProvider
} from "./unavailable-public-market.js";

export class V3PrivateStudioError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "V3PrivateStudioError";
  }
}

function studioExposureRequested(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || ["0", "false", "no", "off"].includes(normalized)) return false;
  // Unknown spellings fail closed instead of silently weakening the guard.
  return true;
}

/** Fail closed when this private local Studio bootstrap is launched as a service. */
export function assertPrivateV3StudioEnvironment(environment: NodeJS.ProcessEnv): void {
  if (
    environment.NODE_ENV?.trim().toLowerCase() === "production" &&
    environment.ASSISTANT_PRIVATE_STUDIO_LAUNCH !== "local-loopback"
  ) {
    throw new V3PrivateStudioError(
      "production_studio_forbidden",
      "The V3 Mastra Studio bootstrap requires the explicit local-loopback launch profile."
    );
  }
  if (studioExposureRequested(environment.ASSISTANT_STUDIO_EXPOSED)) {
    throw new V3PrivateStudioError(
      "studio_exposure_forbidden",
      "The V3 Mastra Studio must not be exposed to customers."
    );
  }
  const host = environment.HOST?.trim().toLowerCase();
  if (host && host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new V3PrivateStudioError(
      "non_loopback_studio_host",
      "The V3 Mastra Studio must bind to a loopback host."
    );
  }
}

function studioSource(sourceId: string): ToolSource {
  return Object.freeze({
    provider: "v3-private-studio-disabled-adapter",
    sourceId,
    sourceUrl: null,
    licenseClass: "synthetic",
    observedAt: "1970-01-01T00:00:00.000Z",
    sourceAsOf: "1970-01-01T00:00:00.000Z"
  });
}

function studioWorkflowUnavailable(): never {
  throw new V3PrivateStudioError(
    "studio_workflow_adapter_unavailable",
    "Private Studio workflows do not mount the customer HTTP trust edge; use the application API for end-to-end requests."
  );
}

assertPrivateV3StudioEnvironment(process.env);

const studioSigner = new DevHmacSigner({
  keyId: "assistant-v3-private-studio-only",
  secret: "assistant-v3-private-studio-signing-secret-not-for-customer-use"
});
const studioGrantAuthority = new V3ToolGrantAuthority();
const studioExecutionBroker = new V3PrivateStudioExecutionBroker({
  grantAuthority: studioGrantAuthority
});
const studioDevelopmentProviderAllowed =
  config.environment === "development" || config.environment === "test";
const studioHistory =
  studioDevelopmentProviderAllowed &&
  config.assistantDemoMarketProvider === "yahoo-development"
    ? new YahooMarketHistoryProvider({
        cacheMs: 60_000,
        timeoutMs: 5_000
      })
    : studioDevelopmentProviderAllowed
      ? new SyntheticOfflineMarketHistoryProvider()
      : new UnavailableMarketHistoryProvider();
const studioMarket =
  studioDevelopmentProviderAllowed &&
  config.assistantDemoMarketProvider === "yahoo-development"
    ? new YahooDevelopmentMarketResearchProvider({
        environment: config.environment === "test" ? "test" : "development",
        marketDataOptions: { cacheMs: 900, timeoutMs: 5_000 },
        securityResearchOptions: {
          cacheMs: 5 * 60_000,
          timeoutMs: 5_000,
          historyProvider: studioHistory
        }
      })
    : studioDevelopmentProviderAllowed
      ? new SyntheticOfflineMarketResearchProvider()
      : new UnavailablePublicMarketResearchProvider();
const studioKnowledgeVector = new V3PrivateStudioKnowledgeVectorStore();
const studioApprovedKnowledge = new ApprovedKnowledgeService({
  registry: new KnowledgeRegistry(
    approvedProductKnowledgeDocuments,
    "official-publication"
  ),
  vectorStore: studioKnowledgeVector,
  indexName: "investment_assistant_knowledge_studio_2026_07_v1",
  indexGeneration: "project-authored-knowledge-2026-07-29-v1",
  minimumScore: 0.08
});
const studioFinancialEducation = new ApprovedFinancialEducationService({
  registry: createApprovedFinancialEducationRegistry(),
  minimumScore: 0.2,
  topK: 3
});

const studioBoundaryDependencies: V3BoundaryToolDependencies = {
  grantAuthority: studioGrantAuthority,
  signer: studioSigner,
  instrumentResolver: new LiveInstrumentResolver(studioMarket),
  market: studioMarket,
  priceHistory: new LivePriceHistoryPort(studioHistory, studioMarket.descriptor),
  currencyRates: new CbarCurrencyRateProvider({ timeoutMs: 5_000 }),
  portfolio: new SyntheticPortfolioPort(V3_PRIVATE_STUDIO_SYNTHETIC_SCOPE),
  approvedKnowledge: new ApprovedKnowledgeBoundaryAdapter(studioApprovedKnowledge),
  financialEducation: {
    source: {
      provider: "approved-financial-education-registry",
      sourceId: "approved-financial-education-2026-07",
      sourceUrl: null,
      licenseClass: "project-internal",
      observedAt: new Date().toISOString(),
      sourceAsOf: new Date().toISOString()
    },
    retrieve: (input) => studioFinancialEducation.retrieve(input)
  },
  orderEligibility: new InternalPilotOrderEligibilityPort(),
  orderHandoff: {
    source: studioSource("order-handoff-disabled"),
    confirm: () => {
      throw new V3BoundaryPortError(
        "STUDIO_ORDER_HANDOFF_DISABLED",
        "Signed order handoff is disabled in the Studio tool playground; use the application preview and explicit confirmation flow.",
        false
      );
    }
  },
  privateStudioExecutionBroker: studioExecutionBroker
};

const studioWorkflowDependencies: V3RegistryWorkflowDependencies = {
  evidence: new EvidenceFactory({ signer: studioSigner }),
  modelTimeoutMs: 5_000,
  authorize: async () => studioWorkflowUnavailable(),
  acquirePublic: async () => studioWorkflowUnavailable(),
  acquirePortfolio: async () => studioWorkflowUnavailable(),
  acquireKnowledge: async () => studioWorkflowUnavailable(),
  prepareOrder: async () => studioWorkflowUnavailable(),
  confirmOrder: async () => studioWorkflowUnavailable(),
  deterministicBoundary: async () => studioWorkflowUnavailable(),
  finalize: async () => studioWorkflowUnavailable(),
  // Studio never stores principal-bound suspended-run state.
  rememberOrderRun: () => undefined
};

const privateStudioTestMode =
  process.env.NODE_ENV?.trim().toLowerCase() === "test";

/**
 * Test imports remain process-local. The real private Studio uses LibSQL for
 * regular Mastra domains and owns the single shared DuckDB observability file.
 */
export const v3StudioStorage = privateStudioTestMode
  ? new InMemoryStore({ id: "assistant-v3-private-studio-test-storage" })
  : createAssistantV3MastraStorage({
      id: "assistant-v3-private-studio-storage",
      defaultStoreId: "assistant-v3-private-studio-default",
      observabilityStoreId: "assistant-v3-private-studio-observability",
      defaultUrl: config.mastraStudioStorageUrl,
      observabilityPath: config.mastraObservabilityShared
        ? config.mastraObservabilityPath
        : config.mastraStudioObservabilityPath,
      connectionTimeoutMs: 5_000,
      maxRetries: 5,
      initialBackoffMs: 100
    });

/**
 * Direct Agent chats in the loopback-only Studio persist by thread. Keep this
 * deliberately short-term: no semantic cross-thread recall, generated titles,
 * or free-form working-memory profile. Customer runtime registries omit it.
 */
export const v3StudioMemory = new Memory({
  storage: v3StudioStorage,
  options: {
    lastMessages: V3_PRIVATE_STUDIO_POLICY.memory.lastMessages,
    semanticRecall: V3_PRIVATE_STUDIO_POLICY.memory.semanticRecall,
    workingMemory: {
      enabled: V3_PRIVATE_STUDIO_POLICY.memory.workingMemory
    },
    generateTitle: V3_PRIVATE_STUDIO_POLICY.memory.generateTitle
  }
});

export const v3StudioObservability = createV3Observability({
  serviceName: "governed-investment-assistant-v3-studio"
});
const v3StudioObservabilityBridgeRoutes = config.mastraObservabilityShared
  ? createV3StudioObservabilityBridgeRoutes(
      config.mastraObservabilityBridgeToken
    )
  : undefined;

export const v3StudioEditor = new MastraEditor({
  source: "code",
  codePath: config.mastraStudioEditorCodePath,
  ...(privateStudioTestMode ? {} : { logger: v3PrivateStudioLogger })
});

export const v3Registry = createV3MastraRegistry({
  boundaryDependencies: studioBoundaryDependencies,
  workflowDependencies: studioWorkflowDependencies,
  storage: v3StudioStorage,
  logger: privateStudioTestMode ? false : v3PrivateStudioLogger,
  observability: v3StudioObservability,
  ...(v3StudioObservabilityBridgeRoutes === undefined
    ? {}
    : { serverApiRoutes: v3StudioObservabilityBridgeRoutes }),
  editor: v3StudioEditor,
  memory: v3StudioMemory,
  productName: config.publicBranding.productName,
  ...(process.env.OPENAI_MODEL === undefined
    ? {}
    : { configuredModel: process.env.OPENAI_MODEL }),
  ...(process.env.OPENAI_ESCALATION_MODEL === undefined
    ? {}
    : { configuredEscalationModel: process.env.OPENAI_ESCALATION_MODEL }),
  ...(process.env.OPENAI_API_KEY === undefined
    ? {}
    : { openaiApiKey: process.env.OPENAI_API_KEY })
});

/** Mastra CLI auto-detects this export from `src/assistant-v3`. */
export const mastra = v3Registry.mastra;
export const v3Agents = v3Registry.agents;
export const v3Workflows = v3Registry.workflows;
export const v3BoundaryTools = v3Registry.tools;
export const v3Scorers = v3Registry.scorers;
export const v3Manifest = v3Registry.manifest;
export { V3_PRIVATE_STUDIO_POLICY };
