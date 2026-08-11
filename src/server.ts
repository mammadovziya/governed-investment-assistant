import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import type { MarketHistoryProvider } from "./services/market-history.js";
import type { SecurityResearchReport } from "./domain/security-research.js";
import type { MarketSnapshot } from "./domain/types.js";
import { createAssistantV3Application } from "./assistant-v3/bootstrap.js";
import { v3Logger as logger } from "./assistant-v3/logging.js";
import {
  createV3HttpRouter,
  V3HttpRuntimeError,
  type V3AssistantHttpRuntime
} from "./assistant-v3/http.js";
import {
  evaluateProductionReadiness,
  type ProductionReadinessInput
} from "./assistant-v3/readiness.js";
import { V3_REGISTRY_MANIFEST } from "./assistant-v3/registry.js";
import { V3_BLOCKING_RESPONSE_SCORER_IDS } from "./assistant-v3/response-scorers.js";
import {
  V3_CONVERSATION_MEMORY_MAX_ASSISTED_HOPS,
  V3_CONVERSATION_MEMORY_MAX_TTL_MS
} from "./assistant-v3/conversation-memory.js";
import { getGovernedNavigationCatalogMetadata } from "./assistant-v3/governed-navigation.js";
import type { V3DashboardPortfolioPort } from "./assistant-v3/dashboard-portfolio.js";
import { MarketDataError } from "./services/market-data.js";
import { MARKET_HISTORY_RANGES, isMarketHistoryRange } from "./domain/market-history.js";
import {
  operationalMetrics,
  type WorkflowResult
} from "./services/operational-metrics.js";
import { SecurityResearchError } from "./services/security-research.js";
import { InMemoryRateLimiter } from "./services/rate-limit.js";
import type {
  ApprovedKnowledgeReadiness
} from "./services/knowledge-retrieval.js";
import {
  READINESS_PROBE_CACHE_DEFAULT_TTL_MS,
  ReadinessProbeCache
} from "./assistant-v3/readiness-probe-cache.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(currentDirectory, "..", "public");

export interface V3ServerApplication {
  runtime: V3AssistantHttpRuntime;
  manifest: typeof V3_REGISTRY_MANIFEST;
  readiness: ProductionReadinessInput;
  conversationMemory: {
    enabled: boolean;
    mode: NonNullable<ProductionReadinessInput["conversationMemoryMode"]>;
    ttlMs: number;
    maxHops: number;
  };
  market: {
    descriptor: {
      id: string;
      displayName: string;
      licenseClass: string;
    };
    getSnapshot(symbol: string): Promise<MarketSnapshot>;
    getResearch(symbol: string): Promise<SecurityResearchReport>;
  };
  history: MarketHistoryProvider;
  portfolio: V3DashboardPortfolioPort;
  approvedKnowledge: {
    readiness(): Promise<ApprovedKnowledgeReadiness>;
  };
  criticalReadiness: {
    signer(): Promise<boolean>;
    audit(): Promise<boolean>;
    storage(): Promise<boolean>;
    observability(): Promise<boolean>;
  };
  shutdown?: () => Promise<void>;
}

export interface CreateAppOptions {
  assistantV3?: V3ServerApplication;
  /** Enables the private diagnostics surface for the internal pilot only. */
  internalDiagnosticsToken?: string;
  /**
   * Test/deployment seam for model availability. Production defaults to the
   * official provider model endpoint and never exposes the returned error.
   */
  readinessModelProbe?: (modelId: string) => Promise<boolean>;
  readinessProbeCacheTtlMs?: number;
  readinessProbeTimeoutMs?: number;
  readinessNow?: () => number;
}

interface ReadinessDependencySnapshot {
  readonly attempted: boolean;
  readonly modelAvailable: boolean;
  readonly marketProviderAvailable: boolean;
  readonly marketProbes: readonly {
    readonly symbol: string;
    readonly available: boolean;
    readonly asOf: string;
    readonly freshness: string;
  }[];
  readonly approvedKnowledge: ApprovedKnowledgeReadiness | null;
  readonly signerAvailable: boolean;
  readonly auditAvailable: boolean;
  readonly storageAvailable: boolean;
  readonly observabilityAvailable: boolean;
  readonly completedAt: string;
}

interface SelectedReadinessState {
  readonly ready: boolean;
  readonly dependencies: ReadinessDependencySnapshot;
  readonly publicErrors: readonly (
    | "SERVICE_DISABLED"
    | "RELEASE_NOT_READY"
    | "DEPENDENCY_UNAVAILABLE"
  )[];
}

let defaultAssistantV3: V3ServerApplication | undefined;

export const READINESS_MARKET_PROBE_SYMBOLS = Object.freeze([
  "AAPL",
  "NVDA",
  "BND"
] as const);
const READINESS_DEPENDENCY_TIMEOUT_MS = 2_500;
const READINESS_DEPENDENCY_TIMEOUT_MIN_MS = 50;
const READINESS_DEPENDENCY_TIMEOUT_MAX_MS = 5_000;
const MAX_MARKET_OBSERVATION_AGE_MS = 8 * 24 * 60 * 60_000;

function boundedReadinessProbe<T>(
  operation: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("readiness_probe_timeout")),
      timeoutMs
    );
    timer.unref();
  });
  return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function validMarketProbe(
  snapshot: MarketSnapshot,
  expectedSymbol: string,
  now: number
): boolean {
  const observedAt = Date.parse(snapshot.asOf);
  return snapshot.symbol === expectedSymbol &&
    Number.isFinite(snapshot.price) &&
    snapshot.price > 0 &&
    Number.isFinite(observedAt) &&
    new Date(observedAt).toISOString() === snapshot.asOf &&
    observedAt <= now + 5 * 60_000 &&
    observedAt >= now - MAX_MARKET_OBSERVATION_AGE_MS;
}

function completeKnowledgeCoverage(
  readiness: ApprovedKnowledgeReadiness | null
): boolean {
  if (
    readiness === null ||
    !readiness.ready ||
    readiness.indexDimension !== 384 ||
    readiness.indexedChunksExpected <= 0 ||
    readiness.count < readiness.indexedChunksExpected ||
    readiness.requiredLocales.length !== 2 ||
    readiness.requiredFacets.length === 0
  ) return false;
  const requiredFacets = new Set(readiness.requiredFacets);
  return ["en-US", "az-AZ"].every((locale) => {
    const coverage = readiness.localeCoverage.find(
      (candidate) => candidate.locale === locale
    );
    return coverage !== undefined &&
      coverage.eligibleDocuments > 0 &&
      coverage.missingFacets.length === 0 &&
      coverage.coveredFacets.length >= requiredFacets.size &&
      [...requiredFacets].every((facet) =>
        coverage.coveredFacets.includes(facet)
      );
  });
}

export function isInternalPilotOnlyRoute(pathname: string): boolean {
  return (
    pathname === "/api/chat" ||
    pathname === "/v1/assistant/order-handoffs/open" ||
    pathname === "/orders/preview" ||
    pathname === "/api/bootstrap" ||
    pathname === "/api/internal/diagnostics/readiness" ||
    pathname === "/api/mastra/capabilities" ||
    pathname === "/api/client" ||
    pathname === "/api/metrics" ||
    pathname === "/metrics" ||
    pathname === "/api/portfolio" ||
    pathname.startsWith("/api/portfolio/") ||
    pathname.startsWith("/api/market/") ||
    pathname.startsWith("/api/security/")
  );
}

function authorizedInternalDiagnostics(
  request: Request,
  expectedToken: string | undefined
): boolean {
  if (expectedToken === undefined) return false;
  const authorization = request.get("authorization");
  const match = authorization === undefined
    ? null
    : /^Bearer ([A-Za-z0-9._~-]{32,512})$/u.exec(authorization);
  if (!match?.[1]) return false;
  const supplied = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function classifyHttpWorkflowResult(
  statusCode: number,
  aborted: boolean
): WorkflowResult {
  if (aborted || statusCode >= 500) return "error";
  if (statusCode >= 400) return "rejected";
  return "success";
}

function disabledV3Runtime(): V3AssistantHttpRuntime {
  const unavailable = (): never => {
    throw new V3HttpRuntimeError(
      "unavailable",
      "The V3 assistant is disabled by the server kill switch."
    );
  };
  return {
    createSession: async () => unavailable(),
    message: async () => unavailable(),
    confirmOrderHandoff: async () => unavailable(),
    openOrderHandoff: async () => unavailable()
  };
}

function defaultV3Application(): V3ServerApplication {
  if (defaultAssistantV3) return defaultAssistantV3;
  const application = createAssistantV3Application();
  const created: V3ServerApplication = {
    runtime: application.runtime,
    manifest: application.registry.manifest,
    readiness: {
      identityMode: "mock-internal-pilot",
      authenticatedSessionEdge: false,
      portfolioMode: "synthetic-ledger",
      marketLicenceClass:
        application.market.descriptor.licenseClass === "production-approved"
          ? "customer-production-licensed"
          : "development-public-feed",
      developmentSigningKey: config.assistantUsesDevelopmentSigningKey,
      signerMode: "dev-hmac",
      storageUrl: config.mastraStorageUrl,
      authorityStateMode: "process-local",
      auditMode: "local-hash-chain",
      legacyUnauthenticatedRoutes: true,
      externalModelApproved: false,
      knowledgeApprovalMode: config.knowledgeApprovalMode,
      orderHandoffMode: "synthetic-review",
      studioExposed: config.studioExposed,
      environment: config.environment,
      conversationMemoryMode: config.assistantV3ConversationMemoryMode
    },
    conversationMemory: {
      enabled: config.assistantV3ConversationMemoryEnabled,
      mode: config.assistantV3ConversationMemoryMode,
      ttlMs: config.assistantV3ConversationMemoryTtlMs,
      maxHops: config.assistantV3ConversationMemoryMaxHops
    },
    market: application.market,
    history: application.history,
    portfolio: application.dashboardPortfolio,
    approvedKnowledge: application.approvedKnowledge,
    criticalReadiness: application.criticalReadiness,
    shutdown: application.shutdown
  };
  defaultAssistantV3 = Object.freeze(created);
  return created;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const assistantV3 = options.assistantV3 ?? defaultV3Application();
  const conversationMemory = assistantV3.conversationMemory;
  const productKnowledgeEnabled =
    config.assistantProductProfile === "demo-invest";
  const governedNavigationCatalog = productKnowledgeEnabled
    ? getGovernedNavigationCatalogMetadata()
    : null;
  if (
    conversationMemory.enabled !== (conversationMemory.mode !== "disabled") ||
    assistantV3.readiness.conversationMemoryMode !== conversationMemory.mode ||
    !Number.isSafeInteger(conversationMemory.ttlMs) ||
    conversationMemory.ttlMs <= 0 ||
    conversationMemory.ttlMs > V3_CONVERSATION_MEMORY_MAX_TTL_MS ||
    !Number.isSafeInteger(conversationMemory.maxHops) ||
    conversationMemory.maxHops <= 0 ||
    conversationMemory.maxHops > V3_CONVERSATION_MEMORY_MAX_ASSISTED_HOPS
  ) {
    throw new Error("The mounted V3 conversation-memory status is inconsistent or unsafe.");
  }
  const releaseTargetReadiness = evaluateProductionReadiness(
    assistantV3.readiness,
    config.assistantReleaseTarget
  );
  const internalPilotReadiness = evaluateProductionReadiness(
    assistantV3.readiness,
    "internal-pilot"
  );
  const customerProductionReadiness = evaluateProductionReadiness(
    assistantV3.readiness,
    "customer-production"
  );
  const assistantRuntimeEnabled =
    config.assistantV3Enabled && releaseTargetReadiness.ready;
  const assistantRuntime = assistantRuntimeEnabled
    ? assistantV3.runtime
    : disabledV3Runtime();
  const researchRateLimiter = new InMemoryRateLimiter({
    windowMs: config.apiRateLimitWindowMs,
    maximum: config.apiRateLimitMax
  });
  const internalDiagnosticsToken =
    options.internalDiagnosticsToken ?? config.assistantInternalDiagnosticsToken;
  if (
    internalDiagnosticsToken !== undefined &&
    (
      internalDiagnosticsToken.length < 32 ||
      internalDiagnosticsToken.length > 512 ||
      !/^[A-Za-z0-9._~-]+$/u.test(internalDiagnosticsToken)
    )
  ) {
    throw new Error("The internal diagnostics token is invalid.");
  }
  const skippedDependencySnapshot = (): ReadinessDependencySnapshot => ({
    attempted: false,
    modelAvailable: false,
    marketProviderAvailable: false,
    marketProbes: [],
    approvedKnowledge: null,
    signerAvailable: false,
    auditAvailable: false,
    storageAvailable: false,
    observabilityAvailable: false,
    completedAt: new Date().toISOString()
  });
  const readinessProbeTimeoutMs =
    options.readinessProbeTimeoutMs ?? READINESS_DEPENDENCY_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(readinessProbeTimeoutMs) ||
    readinessProbeTimeoutMs < READINESS_DEPENDENCY_TIMEOUT_MIN_MS ||
    readinessProbeTimeoutMs > READINESS_DEPENDENCY_TIMEOUT_MAX_MS
  ) {
    throw new RangeError(
      `Readiness probe timeout must be between ${String(
        READINESS_DEPENDENCY_TIMEOUT_MIN_MS
      )} and ${String(READINESS_DEPENDENCY_TIMEOUT_MAX_MS)} milliseconds.`
    );
  }
  const readinessNow = options.readinessNow ?? Date.now;
  const readinessModelProbe =
    options.readinessModelProbe ??
    (async (modelId: string): Promise<boolean> => {
      if (!config.openaiApiKey) return false;
      const modelResponse = await fetch(
        `https://api.openai.com/v1/models/${encodeURIComponent(modelId)}`,
        {
          headers: {
            authorization: `Bearer ${config.openaiApiKey}`
          },
          signal: AbortSignal.timeout(2_500)
        }
      );
      if (!modelResponse.ok) return false;
      const body = await modelResponse.json() as { id?: string };
      return body.id === modelId;
    });
  const readinessProbeCache = new ReadinessProbeCache<ReadinessDependencySnapshot>({
    ttlMs:
      options.readinessProbeCacheTtlMs ?? READINESS_PROBE_CACHE_DEFAULT_TTL_MS,
    load: async () => {
      const marketCoverageProbe = async () => Promise.all(
        READINESS_MARKET_PROBE_SYMBOLS.map(async (symbol) => {
          const snapshot = await boundedReadinessProbe(
            () => assistantV3.market.getSnapshot(symbol),
            readinessProbeTimeoutMs
          );
          if (!validMarketProbe(snapshot, symbol, readinessNow())) {
            throw new Error("invalid_market_probe");
          }
          return {
            symbol,
            available: true,
            asOf: snapshot.asOf,
            freshness: snapshot.freshness
          };
        })
      );
      const [
        modelProbe,
        marketProbe,
        knowledgeProbe,
        signerProbe,
        auditProbe,
        storageProbe,
        observabilityProbe
      ] = await Promise.allSettled([
        boundedReadinessProbe(
          async () => {
            const modelAvailability = await Promise.all([
              readinessModelProbe(
                assistantV3.manifest.model.primaryModelId
              ),
              readinessModelProbe(
                assistantV3.manifest.model.escalationModelId
              )
            ]);
            return modelAvailability.every(Boolean);
          },
          readinessProbeTimeoutMs
        ),
        marketCoverageProbe(),
        boundedReadinessProbe(
          () => assistantV3.approvedKnowledge.readiness(),
          readinessProbeTimeoutMs
        ),
        boundedReadinessProbe(
          () => assistantV3.criticalReadiness.signer(),
          readinessProbeTimeoutMs
        ),
        boundedReadinessProbe(
          () => assistantV3.criticalReadiness.audit(),
          readinessProbeTimeoutMs
        ),
        boundedReadinessProbe(
          () => assistantV3.criticalReadiness.storage(),
          readinessProbeTimeoutMs
        ),
        boundedReadinessProbe(
          () => assistantV3.criticalReadiness.observability(),
          readinessProbeTimeoutMs
        )
      ]);
      return {
        attempted: true,
        modelAvailable: modelProbe.status === "fulfilled" && modelProbe.value,
        marketProviderAvailable: marketProbe.status === "fulfilled",
        marketProbes: marketProbe.status === "fulfilled"
          ? marketProbe.value
          : [],
        approvedKnowledge: knowledgeProbe.status === "fulfilled"
          ? knowledgeProbe.value
          : null,
        signerAvailable:
          signerProbe.status === "fulfilled" && signerProbe.value,
        auditAvailable:
          auditProbe.status === "fulfilled" && auditProbe.value,
        storageAvailable:
          storageProbe.status === "fulfilled" && storageProbe.value,
        observabilityAvailable:
          observabilityProbe.status === "fulfilled" && observabilityProbe.value,
        completedAt: new Date().toISOString()
      };
    }
  });
  const selectedReadinessState = async (): Promise<SelectedReadinessState> => {
    const releaseReady = releaseTargetReadiness.ready;
    const shouldProbe = config.assistantV3Enabled && releaseReady;
    let dependencies = skippedDependencySnapshot();
    if (shouldProbe) {
      try {
        dependencies = await readinessProbeCache.get();
      } catch {
        dependencies = {
          ...skippedDependencySnapshot(),
          attempted: true
        };
      }
    }
    const dependenciesReady =
      dependencies.attempted &&
      dependencies.modelAvailable &&
      dependencies.marketProviderAvailable &&
      completeKnowledgeCoverage(dependencies.approvedKnowledge) &&
      dependencies.signerAvailable &&
      dependencies.auditAvailable &&
      dependencies.storageAvailable &&
      dependencies.observabilityAvailable;
    const ready = config.assistantV3Enabled && releaseReady && dependenciesReady;
    const publicErrors: SelectedReadinessState["publicErrors"][number][] = [];
    if (!config.assistantV3Enabled) publicErrors.push("SERVICE_DISABLED");
    if (!releaseReady) publicErrors.push("RELEASE_NOT_READY");
    if (shouldProbe && !dependenciesReady) publicErrors.push("DEPENDENCY_UNAVAILABLE");
    return {
      ready,
      dependencies,
      publicErrors: Object.freeze(publicErrors)
    };
  };

  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((request, response, next) => {
    const incomingRequestId = request.get("x-request-id");
    const requestId = incomingRequestId && /^[a-zA-Z0-9_-]{8,128}$/.test(incomingRequestId)
      ? incomingRequestId
      : crypto.randomUUID();
    const startedAt = performance.now();
    const routeLabel = request.path === "/api/chat"
      ? "assistant_v3_compatibility"
      : request.path.startsWith("/v1/assistant/")
        ? "assistant_v3"
      : request.path.startsWith("/api/market/")
        ? "api_market"
        : request.path.startsWith("/api/security/")
          ? "api_security"
          : request.path === "/api/portfolio/stream"
            ? "portfolio_stream"
          : request.path === "/metrics" || request.path === "/api/metrics"
            ? "metrics"
            : request.path.startsWith("/api/")
              ? "api_other"
              : "static";
    response.locals.requestId = requestId;
    response.set("x-request-id", requestId);
    response.set("x-content-type-options", "nosniff");
    response.set("referrer-policy", "strict-origin-when-cross-origin");
    response.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    response.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    response.set("cross-origin-opener-policy", "same-origin");
    response.set("cross-origin-resource-policy", "same-origin");
    response.set(
      "content-security-policy",
      "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
    const completeActiveRequest = operationalMetrics.startActiveRequest(routeLabel);
    let completionRecorded = false;
    const recordCompletion = (event: "finish" | "close") => {
      completeActiveRequest();
      if (completionRecorded) return;
      completionRecorded = true;
      const durationMs = Math.max(0, performance.now() - startedAt);
      const aborted = event === "close" && !response.writableFinished;
      operationalMetrics.recordWorkflowResult({
        workflow: `http_${routeLabel}`,
        result: classifyHttpWorkflowResult(response.statusCode, aborted),
        durationMs
      });
      logger.info("HTTP request completed", {
        requestId,
        method: request.method,
        route: routeLabel,
        statusCode: response.statusCode,
        completionEvent: event,
        aborted,
        durationMs: Math.round(durationMs * 100) / 100
      });
    };
    response.once("finish", () => recordCompletion("finish"));
    response.once("close", () => recordCompletion("close"));
    next();
  });
  app.use((request, response, next) => {
    if (
      config.assistantReleaseTarget === "customer-production" &&
      isInternalPilotOnlyRoute(request.path)
    ) {
      response.set("cache-control", "no-store");
      return response.status(404).json({
        error: {
          code: "not_found",
          message: "The requested route is not available."
        }
      });
    }
    next();
  });
  app.use((request, response, next) => {
    const assistantRoute =
      request.path === "/api/chat" || request.path.startsWith("/v1/assistant/");
    const protectedRoute = assistantRoute || request.path.startsWith("/api/security/");
    if (!protectedRoute) return next();
    const decision = researchRateLimiter.consume(
      `${request.ip}:${assistantRoute ? "assistant-v3" : "security"}`
    );
    response.set("x-ratelimit-limit", String(config.apiRateLimitMax));
    response.set("x-ratelimit-remaining", String(decision.remaining));
    response.set("x-ratelimit-reset", decision.resetAt);
    if (!decision.allowed) {
      response.set("retry-after", String(decision.retryAfterSeconds));
      operationalMetrics.recordFallback({ component: "http-rate-limit", reason: "request_limit_exceeded" });
      if (assistantRoute) {
        response.set("cache-control", "no-store");
        return response.status(429).json({
          error: {
            code: "rate_limited",
            message: "Too many requests. Please retry later."
          }
        });
      }
      return response.status(429).json({ error: "Too many research requests. Please retry shortly." });
    }
    next();
  });
  app.use(createV3HttpRouter(assistantRuntime));
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_request, response) => {
    response.set("cache-control", "no-store");
    response.json({
      schemaVersion: "assistant-v3.liveness.v1",
      status: "ok"
    });
  });

  app.get("/api/ready", async (_request, response) => {
    response.set("cache-control", "no-store");
    const state = await selectedReadinessState();
    response.status(state.ready ? 200 : 503).json({
      schemaVersion: "assistant-v3.readiness.v1",
      status: state.ready ? "ready" : "not-ready",
      ...(state.publicErrors.length > 0 ? { errors: state.publicErrors } : {})
    });
  });

  app.get("/api/internal/diagnostics/readiness", async (request, response) => {
    response.set("cache-control", "no-store");
    if (
      config.assistantReleaseTarget !== "internal-pilot" ||
      !authorizedInternalDiagnostics(request, internalDiagnosticsToken)
    ) {
      return response.status(404).json({
        error: {
          code: "not_found",
          message: "The requested route is not available."
        }
      });
    }
    const state = await selectedReadinessState();
    const dependencies = state.dependencies;
    const knowledgeReady = completeKnowledgeCoverage(
      dependencies.approvedKnowledge
    );
    const errors = [
      ...(!config.assistantV3Enabled ? ["V3_DISABLED"] : []),
      ...(!releaseTargetReadiness.ready ? ["RELEASE_TARGET_BLOCKED"] : []),
      ...(!dependencies.attempted ? ["DEPENDENCY_PROBES_SKIPPED"] : []),
      ...(dependencies.attempted && !dependencies.modelAvailable
        ? ["OPENAI_MODEL_UNAVAILABLE"]
        : []),
      ...(dependencies.attempted && !dependencies.marketProviderAvailable
        ? ["MARKET_COVERAGE_UNAVAILABLE"]
        : []),
      ...(dependencies.attempted && !knowledgeReady
        ? ["APPROVED_KNOWLEDGE_COVERAGE_UNAVAILABLE"]
        : []),
      ...(dependencies.attempted && !dependencies.signerAvailable
        ? ["SIGNER_SELF_TEST_FAILED"]
        : []),
      ...(dependencies.attempted && !dependencies.auditAvailable
        ? ["AUDIT_UNAVAILABLE"]
        : []),
      ...(dependencies.attempted && !dependencies.storageAvailable
        ? ["STORAGE_UNAVAILABLE"]
        : []),
      ...(dependencies.attempted && !dependencies.observabilityAvailable
        ? ["OBSERVABILITY_UNAVAILABLE"]
        : [])
    ];
    return response.status(state.ready ? 200 : 503).json({
      schemaVersion: "assistant-v3.internal-readiness-diagnostics.v1",
      status: state.ready ? "ready" : "not-ready",
      assistantApiVersion: "v3",
      releaseTarget: config.assistantReleaseTarget,
      model: assistantV3.manifest.model.modelId,
      escalationModel: assistantV3.manifest.model.escalationModelId,
      modelAvailable: dependencies.modelAvailable,
      liveMarketProvider: assistantV3.market.descriptor.displayName,
      marketProviderId: assistantV3.market.descriptor.id,
      marketLicenceClass: assistantV3.market.descriptor.licenseClass,
      marketProviderAvailable: dependencies.marketProviderAvailable,
      marketProbes: dependencies.marketProbes,
      criticalDependencies: {
        signer: dependencies.signerAvailable,
        audit: dependencies.auditAvailable,
        storage: dependencies.storageAvailable,
        observability: dependencies.observabilityAvailable
      },
      approvedKnowledge: dependencies.approvedKnowledge !== null
        ? {
            ready: dependencies.approvedKnowledge.ready,
            indexName: dependencies.approvedKnowledge.indexName,
            indexDimension: dependencies.approvedKnowledge.indexDimension,
            count: dependencies.approvedKnowledge.count,
            indexedChunksExpected:
              dependencies.approvedKnowledge.indexedChunksExpected,
            eligibleDocuments: dependencies.approvedKnowledge.eligibleDocuments,
            approvalMode: dependencies.approvedKnowledge.approvalMode,
            requiredLocales: dependencies.approvedKnowledge.requiredLocales,
            requiredFacets: dependencies.approvedKnowledge.requiredFacets,
            localeCoverage: dependencies.approvedKnowledge.localeCoverage
          }
        : { ready: false },
      governedNavigation: governedNavigationCatalog,
      conversationContextMemory: conversationMemory.enabled,
      conversationContextMemoryMode: conversationMemory.mode,
      conversationContextMemoryTtlMs: conversationMemory.ttlMs,
      conversationContextMemoryMaxHops: conversationMemory.maxHops,
      internalPilotReadiness,
      customerProductionReadiness,
      mockScope: "synthetic client portfolio only",
      probeCache: {
        ttlMs: readinessProbeCache.ttlMs,
        attempted: dependencies.attempted,
        completedAt: dependencies.completedAt
      },
      ...(errors.length > 0 ? { errors } : {}),
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/metrics", (_request, response) => {
    response.set("cache-control", "no-store");
    response.json(operationalMetrics.snapshot());
  });

  app.get("/metrics", (_request, response) => {
    response.type("text/plain; version=0.0.4; charset=utf-8");
    response.set("cache-control", "no-store");
    response.send(operationalMetrics.toPrometheus());
  });

  app.get("/api/mastra/capabilities", (request, response) => {
    if (
      config.assistantReleaseTarget !== "internal-pilot" ||
      !authorizedInternalDiagnostics(request, internalDiagnosticsToken)
    ) {
      response.set("cache-control", "no-store");
      return response.status(404).json({
        error: {
          code: "not_found",
          message: "The requested route is not available."
        }
      });
    }
    const manifest = assistantV3.manifest;
    response.set("cache-control", "no-store");
    return response.json({
      schemaVersion: manifest.schemaVersion,
      assistantApiVersion: "v3",
      ids: manifest.ids,
      counts: manifest.counts,
      model: manifest.model,
      scorers: manifest.ids.scorers,
      scorerCount: manifest.counts.scorers,
      blockingResponseScorers: V3_BLOCKING_RESPONSE_SCORER_IDS,
      governedNavigation: governedNavigationCatalog,
      conversationContextMemory: conversationMemory.enabled,
      conversationContextMemoryMode: conversationMemory.mode,
      conversationContextMemoryTtlMs: conversationMemory.ttlMs,
      conversationContextMemoryMaxHops: conversationMemory.maxHops,
      memoryPolicy: manifest.memory,
      customerStudioExposed: false,
      compatibilityAdapter: "/api/chat"
    });
  });

  app.get("/api/bootstrap", async (_request, response, next) => {
    try {
      response.set("cache-control", "no-store");
      const portfolio = await assistantV3.portfolio.getSummary();
      const manifest = assistantV3.manifest;
      response.json({
        productProfile: config.assistantProductProfile,
        branding: config.publicBranding,
        client: assistantV3.portfolio.getClient(),
        portfolio,
        capabilities: {
          assistantApiVersion: "v3",
          releaseTarget: config.assistantReleaseTarget,
          v3Enabled: assistantRuntimeEnabled,
          liveMarketSnapshots: true,
          generatedExplanations: true,
          modelProvider: "OpenAI",
          model: manifest.model.modelId,
          escalationModel: manifest.model.escalationModelId,
          modelSelectionPolicy: manifest.model.selectionPolicy,
          marketAgentTimeoutMs: config.marketAgentTimeoutMs,
          marketStreamIntervalMs: config.marketStreamIntervalMs,
          orchestration: "Mastra V3 workflows",
          registrySchemaVersion: manifest.schemaVersion,
          agents: manifest.ids.agents,
          workflows: manifest.ids.workflows,
          tools: manifest.ids.tools,
          registryCounts: manifest.counts,
          scorers: manifest.ids.scorers,
          scorerCount: manifest.counts.scorers,
          blockingResponseScorers: V3_BLOCKING_RESPONSE_SCORER_IDS,
          governedNavigation: governedNavigationCatalog,
          conversationContextMemory: conversationMemory.enabled,
          conversationContextMemoryMode: conversationMemory.mode,
          conversationContextMemoryTtlMs: conversationMemory.ttlMs,
          conversationContextMemoryMaxHops: conversationMemory.maxHops,
          memoryPolicy: manifest.memory,
          persistentWorkflowSnapshots: false,
          volatileOrderSuspensionSnapshots: true,
          durableAuditOutbox: true,
          approvedKnowledgeRag: productKnowledgeEnabled,
          ...(productKnowledgeEnabled
            ? {
                knowledgeApprovalMode: config.knowledgeApprovalMode,
                knowledgeIndexGeneration: config.knowledgeIndexGeneration
              }
            : {}),
          redactedObservability: true,
          clientOwnedIdentityAccepted: false,
          directOrderExecution: false,
          signedOrderTicketHandoff: true,
          compatibilityAdapter: "/api/chat",
          endpoints: {
            sessions: "/v1/assistant/sessions",
            messages: "/v1/assistant/messages",
            orderHandoffConfirmation:
              "/v1/assistant/order-handoffs/:intentId/confirm"
          }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/client", (_request, response) => {
    response.set("cache-control", "no-store");
    response.json(assistantV3.portfolio.getClient());
  });

  app.get("/api/portfolio", async (_request, response, next) => {
    try {
      response.set("cache-control", "no-store");
      response.json(await assistantV3.portfolio.getSummary());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/portfolio/stream", (request, response) => {
    response.status(200);
    response.set({
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    response.flushHeaders();

    let active = true;
    let sending = false;

    const sendPortfolio = async () => {
      if (!active || sending) return;
      sending = true;
      try {
        const portfolio = await assistantV3.portfolio.getSummary();
        if (active) {
          response.write(`event: portfolio\ndata: ${JSON.stringify(portfolio)}\n\n`);
        }
      } catch {
        if (active) {
          response.write(
            `event: warning\ndata: ${JSON.stringify({ message: "Market update unavailable" })}\n\n`
          );
        }
      } finally {
        sending = false;
      }
    };

    void sendPortfolio();
    const interval = setInterval(() => void sendPortfolio(), config.marketStreamIntervalMs);

    request.on("close", () => {
      active = false;
      clearInterval(interval);
      response.end();
    });
  });

  app.get("/api/market/:symbol", async (request, response, next) => {
    try {
      response.set("cache-control", "no-store");
      response.json(await assistantV3.market.getSnapshot(request.params.symbol));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/market/:symbol/history", async (request, response, next) => {
    try {
      const rangeValue = request.query.range ?? "10y";
      if (!isMarketHistoryRange(rangeValue)) {
        throw new MarketDataError(
          `Unsupported market history range. Use one of: ${MARKET_HISTORY_RANGES.join(", ")}`,
          400
        );
      }
      response.set("cache-control", "no-store");
      response.json(await assistantV3.history.getHistory(request.params.symbol, rangeValue));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/security/:symbol/research", async (request, response, next) => {
    try {
      response.set("cache-control", "no-store");
      response.json(await assistantV3.market.getResearch(request.params.symbol));
    } catch (error) {
      next(error);
    }
  });

  const governedNavigationDestinationPaths = Object.freeze([
    "/investments/guides/account-opening",
    "/investments/guides/funding",
    "/investments/guides/share-purchase",
    "/investments/guides/withdrawal"
  ] as const);
  app.get([...governedNavigationDestinationPaths], (request, response, next) => {
    if (
      !governedNavigationDestinationPaths.includes(
        request.originalUrl as (typeof governedNavigationDestinationPaths)[number]
      )
    ) {
      return next();
    }
    response.set("cache-control", "no-store");
    return response.sendFile(join(publicDirectory, "index.html"));
  });

  const governedReadOnlyDestinationPaths = Object.freeze([
    "/investments/portfolio",
    "/investments/portfolio/cash",
    "/investments/activity",
    "/investments/instruments"
  ] as const);
  app.all([...governedReadOnlyDestinationPaths], (request, response, next) => {
    if (
      !governedReadOnlyDestinationPaths.includes(
        request.path as (typeof governedReadOnlyDestinationPaths)[number]
      )
    ) {
      return next();
    }
    if (request.method !== "GET") {
      response.set("allow", "GET");
      return response.status(405).end();
    }
    if (
      request.originalUrl !== request.path ||
      !governedReadOnlyDestinationPaths.includes(
        request.originalUrl as (typeof governedReadOnlyDestinationPaths)[number]
      )
    ) {
      return response.status(404).end();
    }
    response.set("cache-control", "no-store");
    return response.sendFile(join(publicDirectory, "index.html"));
  });

  app.get("/orders/preview", (request, response) => {
    if (request.originalUrl !== "/orders/preview") {
      return response.status(404).end();
    }
    response.set("cache-control", "no-store");
    return response.sendFile(join(publicDirectory, "order-preview.html"));
  });

  app.use(express.static(publicDirectory, { extensions: ["html"] }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const statusCode =
      error instanceof MarketDataError || error instanceof SecurityResearchError
        ? error.statusCode
        : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error";
    logger.error("HTTP request failed", {
      requestId: response.locals.requestId,
      statusCode,
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: statusCode >= 500 ? "Service failure" : message
    });
    response.status(statusCode).json({
      error: statusCode >= 500 ? "The requested service is temporarily unavailable." : message
    });
  });

  return app;
}

const entryPath = process.argv[1] ? fileURLToPath(new URL(import.meta.url)) === process.argv[1] : false;

if (entryPath) {
  // Restrict every locally created database, WAL, audit, and trace file even
  // when the parent shell has a permissive default umask.
  process.umask(0o077);
  const httpServer = createApp().listen(config.port, () => {
    console.log(
      `${config.publicBranding.name} (${config.publicBranding.productName}) running at ` +
      `http://localhost:${config.port}`
    );
    console.log(
      `Mastra agents use ${config.openaiModel} by default and ` +
      `${config.openaiEscalationModel} for deterministic complex-case escalation`
    );
    console.log(
      `Mastra V3 registry: ${V3_REGISTRY_MANIFEST.counts.agents} agents, ${V3_REGISTRY_MANIFEST.counts.workflows} workflows, ${V3_REGISTRY_MANIFEST.counts.tools} tools, ${V3_REGISTRY_MANIFEST.counts.scorers} registered scorers (${V3_BLOCKING_RESPONSE_SCORER_IDS.length} blocking response scorers)`
    );
    console.log(`Portfolio stream interval: ${config.marketStreamIntervalMs}ms`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Graceful shutdown started", { signal });
    const shutdownDeadline = setTimeout(() => {
      logger.warn("Graceful shutdown deadline reached", { signal });
      process.exitCode = 1;
      httpServer.closeAllConnections();
    }, 10_000).unref();
    httpServer.close((error) => {
      void (async () => {
        try {
          if (error) throw error;
          await defaultAssistantV3?.shutdown?.();
        } catch (shutdownError) {
          logger.error("Graceful shutdown failed", {
            signal,
            errorName:
              shutdownError instanceof Error
                ? shutdownError.name
                : "UnknownError"
          });
          process.exitCode = 1;
        } finally {
          clearTimeout(shutdownDeadline);
        }
      })();
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
