import { config as loadEnvironment } from "dotenv";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function projectRootFromEnvironment(): string {
  const packageJsonPath = process.env.npm_package_json;
  if (packageJsonPath) return path.dirname(path.resolve(packageJsonPath));

  const localPrefix = process.env.npm_config_local_prefix;
  if (localPrefix) return path.resolve(localPrefix);

  const initialWorkingDirectory = process.env.INIT_CWD;
  if (initialWorkingDirectory) return path.resolve(initialWorkingDirectory);

  return process.cwd();
}

const projectRoot = projectRootFromEnvironment();
loadEnvironment({
  path: [
    path.join(projectRoot, ".env.local"),
    path.join(projectRoot, ".env")
  ],
  override: false,
  quiet: true
});

function fileBackedUrlFromEnvironment(
  value: string | undefined,
  fallback: string
): string {
  const configured = value?.trim() || fallback;
  if (!configured.startsWith("file:")) return configured;

  const configuredPath = configured.startsWith("file://")
    ? fileURLToPath(configured)
    : configured.slice("file:".length);
  const absolutePath = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(projectRootFromEnvironment(), configuredPath);
  return pathToFileURL(absolutePath).href;
}

function localPathFromEnvironment(
  value: string | undefined,
  fallback: string
): string {
  const configured = value?.trim() || fallback;
  if (configured === ":memory:") return configured;
  return path.resolve(projectRootFromEnvironment(), configured);
}

function numberFromEnvironment(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= maximum ? value : fallback;
}

function knowledgeApprovalModeFromEnvironment(
  value: string | undefined,
  environment: string
): "official-publication" | "controlled" {
  const fallback = environment === "production" ? "controlled" : "official-publication";
  const configured = value?.trim() || fallback;
  if (configured !== "official-publication" && configured !== "controlled") {
    throw new Error("KNOWLEDGE_APPROVAL_MODE must be official-publication or controlled");
  }
  if (environment === "production" && configured !== "controlled") {
    throw new Error("Production requires KNOWLEDGE_APPROVAL_MODE=controlled");
  }
  return configured;
}

function knowledgeIndexNameFromEnvironment(value: string | undefined): string {
  const configured = value?.trim() || "investment_assistant_knowledge_2026_07_29_v1";
  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,62}$/u.test(configured)) {
    throw new Error("KNOWLEDGE_INDEX_NAME must be a safe immutable LibSQL index name");
  }
  return configured;
}

function integerFromEnvironment(
  name: string,
  fallback: number,
  environment: NodeJS.ProcessEnv = process.env
): number {
  const raw = environment[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedIntegerFromEnvironment(
  name: string,
  fallback: number,
  maximum: number,
  environment: NodeJS.ProcessEnv
): number {
  const raw = environment[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function logLevelFromEnvironment(): "debug" | "info" | "warn" | "error" {
  const value = process.env.LOG_LEVEL?.toLowerCase();
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

function booleanFromEnvironment(
  name: string,
  fallback: boolean,
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = environment[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be a boolean value`);
}

export interface PublicBrandingConfig {
  readonly name: string;
  readonly mark: string;
  readonly productName: string;
}

export type AssistantProductProfile = "generic" | "demo-invest";

export const PUBLIC_BRANDING_DEFAULTS = Object.freeze({
  name: "Invest Assistant",
  mark: "IA",
  productName: "Example Invest"
} satisfies PublicBrandingConfig);

export const DEMO_INVEST_BRANDING_DEFAULTS = Object.freeze({
  name: "Invest Assistant",
  mark: "IA",
  productName: "Demo Invest"
} satisfies PublicBrandingConfig);

export function productProfileFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): AssistantProductProfile {
  const configured =
    environment.ASSISTANT_PRODUCT_PROFILE?.trim().toLowerCase() || "demo-invest";
  if (configured !== "generic" && configured !== "demo-invest") {
    throw new Error(
      "ASSISTANT_PRODUCT_PROFILE must be generic or demo-invest"
    );
  }
  return configured;
}

function boundedPublicBrandingText(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
  maximumLength: number
): string {
  const configured = environment[name];
  if (configured === undefined || configured.trim() === "") return fallback;
  const normalized = configured.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    /[\u0000-\u001F\u007F<>]/u.test(normalized)
  ) {
    throw new Error(
      `${name} must contain 1-${maximumLength} display-safe characters`
    );
  }
  return normalized;
}

export function publicBrandingFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): PublicBrandingConfig {
  const profileDefaults =
    productProfileFromEnvironment(environment) === "demo-invest"
      ? DEMO_INVEST_BRANDING_DEFAULTS
      : PUBLIC_BRANDING_DEFAULTS;
  return Object.freeze({
    name: boundedPublicBrandingText(
      environment,
      "ASSISTANT_PUBLIC_BRAND_NAME",
      profileDefaults.name,
      60
    ),
    mark: boundedPublicBrandingText(
      environment,
      "ASSISTANT_PUBLIC_BRAND_MARK",
      profileDefaults.mark,
      8
    ),
    productName: boundedPublicBrandingText(
      environment,
      "ASSISTANT_PUBLIC_PRODUCT_NAME",
      profileDefaults.productName,
      80
    )
  });
}

export type AssistantReleaseTarget = "internal-pilot" | "customer-production";

export function releaseTargetFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): AssistantReleaseTarget {
  const fallback =
    environment.NODE_ENV?.trim().toLowerCase() === "production"
      ? "customer-production"
      : "internal-pilot";
  const configured =
    environment.ASSISTANT_RELEASE_TARGET?.trim().toLowerCase() || fallback;
  if (configured !== "internal-pilot" && configured !== "customer-production") {
    throw new Error(
      "ASSISTANT_RELEASE_TARGET must be internal-pilot or customer-production"
    );
  }
  return configured;
}

export type AssistantDemoMarketProvider =
  | "synthetic-offline"
  | "yahoo-development";

/**
 * Public clones must not contact a third-party market endpoint merely because
 * the development server started. Live development data therefore requires an
 * explicit provider selection; the zero-configuration path is fully offline.
 */
export function demoMarketProviderFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): AssistantDemoMarketProvider {
  const configured =
    environment.ASSISTANT_DEMO_MARKET_PROVIDER?.trim().toLowerCase() ||
    "synthetic-offline";
  if (
    configured !== "synthetic-offline" &&
    configured !== "yahoo-development"
  ) {
    throw new Error(
      "ASSISTANT_DEMO_MARKET_PROVIDER must be synthetic-offline or yahoo-development"
    );
  }
  return configured;
}

export function assertDistinctMastraStorageUrls(
  applicationUrl: string,
  studioUrl: string
): void {
  const canonicalStorageIdentity = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed.startsWith("file:")) return new URL(trimmed).href;
    return pathToFileURL(path.resolve(fileURLToPath(trimmed))).href;
  };
  if (
    canonicalStorageIdentity(applicationUrl) ===
      canonicalStorageIdentity(studioUrl)
  ) {
    throw new Error(
      "MASTRA_STUDIO_STORAGE_URL must be physically separate from MASTRA_STORAGE_URL"
    );
  }
}

export function assertMastraObservabilityTopology(
  applicationPath: string,
  studioPath: string,
  shared: boolean
): void {
  const canonicalLocalPath = (value: string): string =>
    value === ":memory:" ? value : path.resolve(value);
  const pathsMatch =
    canonicalLocalPath(applicationPath) === canonicalLocalPath(studioPath);
  if (shared && !pathsMatch) {
    throw new Error(
      "Shared observability requires MASTRA_STUDIO_OBSERVABILITY_PATH to match MASTRA_OBSERVABILITY_PATH"
    );
  }
  if (!shared && pathsMatch) {
    throw new Error(
      "Non-shared observability requires physically separate application and Studio paths"
    );
  }
}

export const V3_CONVERSATION_MEMORY_DEFAULTS = Object.freeze({
  enabled: true,
  ttlMs: 5 * 60_000,
  maxEntries: 10_000,
  maxHops: 3
});

export type V3ConversationMemoryMode =
  | "disabled"
  | "process-local-bounded"
  | "encrypted-ha-ttl-store";

export function conversationMemoryConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  maxHops: number;
  mode: V3ConversationMemoryMode;
} {
  const enabled = booleanFromEnvironment(
    "ASSISTANT_V3_CONVERSATION_MEMORY_ENABLED",
    V3_CONVERSATION_MEMORY_DEFAULTS.enabled,
    environment
  );
  return Object.freeze({
    enabled,
    ttlMs: boundedIntegerFromEnvironment(
      "ASSISTANT_V3_CONVERSATION_MEMORY_TTL_MS",
      V3_CONVERSATION_MEMORY_DEFAULTS.ttlMs,
      5 * 60_000,
      environment
    ),
    maxEntries: boundedIntegerFromEnvironment(
      "ASSISTANT_V3_CONVERSATION_MEMORY_MAX_ENTRIES",
      V3_CONVERSATION_MEMORY_DEFAULTS.maxEntries,
      10_000,
      environment
    ),
    maxHops: boundedIntegerFromEnvironment(
      "ASSISTANT_V3_CONVERSATION_MEMORY_MAX_HOPS",
      V3_CONVERSATION_MEMORY_DEFAULTS.maxHops,
      3,
      environment
    ),
    mode: enabled ? "process-local-bounded" : "disabled"
  });
}

function signingKeyFromEnvironment(environment: string): {
  key: string;
  developmentKey: boolean;
} {
  const configured = process.env.ASSISTANT_SIGNING_KEY?.trim();
  if (configured) {
    if (configured.length < 32) {
      throw new Error("ASSISTANT_SIGNING_KEY must contain at least 32 characters");
    }
    return { key: configured, developmentKey: false };
  }
  if (environment === "production") {
    throw new Error("Production requires ASSISTANT_SIGNING_KEY");
  }
  return {
    key: "governed-investment-v3-local-development-signing-key-only",
    developmentKey: true
  };
}

export const OPENAI_MODEL = "gpt-4o" as const;
export const OPENAI_ESCALATION_MODEL = "gpt-4.1" as const;

export function lockedOpenAIModel(configuredModel: string | undefined): typeof OPENAI_MODEL {
  const configured = configuredModel?.trim();
  if (configured && configured !== OPENAI_MODEL) {
    throw new Error(`OPENAI_MODEL is locked to ${OPENAI_MODEL}`);
  }

  return OPENAI_MODEL;
}

export function lockedOpenAIEscalationModel(
  configuredModel: string | undefined
): typeof OPENAI_ESCALATION_MODEL {
  const configured = configuredModel?.trim();
  if (configured && configured !== OPENAI_ESCALATION_MODEL) {
    throw new Error(
      `OPENAI_ESCALATION_MODEL is locked to ${OPENAI_ESCALATION_MODEL}`
    );
  }

  return OPENAI_ESCALATION_MODEL;
}

export function internalDiagnosticsTokenFromEnvironment(
  value: string | undefined
): string | undefined {
  const token = value?.trim();
  if (!token) return undefined;
  if (
    token.length < 32 ||
    token.length > 512 ||
    !/^[A-Za-z0-9._~-]+$/u.test(token)
  ) {
    throw new Error(
      "ASSISTANT_INTERNAL_DIAGNOSTICS_TOKEN must be a 32-512 character URL-safe secret"
    );
  }
  return token;
}

const environment = process.env.NODE_ENV || "development";
const signing = signingKeyFromEnvironment(environment);
const conversationMemory = conversationMemoryConfigFromEnvironment();
const assistantProductProfile = productProfileFromEnvironment();
const publicBranding = publicBrandingFromEnvironment();
const releaseTarget = releaseTargetFromEnvironment();
const demoMarketProvider = demoMarketProviderFromEnvironment();
const mastraObservabilityShared = booleanFromEnvironment(
  "MASTRA_OBSERVABILITY_SHARED",
  environment === "development"
);
const mastraStorageUrl = fileBackedUrlFromEnvironment(
  process.env.MASTRA_STORAGE_URL,
  "file:./.mastra-storage-private-v2.db"
);
const mastraStudioStorageUrl = fileBackedUrlFromEnvironment(
  process.env.MASTRA_STUDIO_STORAGE_URL,
  "file:./.mastra-storage-studio-private-v3.db"
);
assertDistinctMastraStorageUrls(mastraStorageUrl, mastraStudioStorageUrl);
const mastraObservabilityPath = localPathFromEnvironment(
  process.env.MASTRA_OBSERVABILITY_PATH,
  mastraObservabilityShared
    ? ".mastra-observability-shared.duckdb"
    : ".mastra-observability-app.duckdb"
);
const mastraStudioObservabilityPath = localPathFromEnvironment(
  process.env.MASTRA_STUDIO_OBSERVABILITY_PATH ??
    (mastraObservabilityShared
      ? process.env.MASTRA_OBSERVABILITY_PATH
      : undefined),
  mastraObservabilityShared
    ? ".mastra-observability-shared.duckdb"
    : ".mastra-observability-studio.duckdb"
);
assertMastraObservabilityTopology(
  mastraObservabilityPath,
  mastraStudioObservabilityPath,
  mastraObservabilityShared
);
const mastraObservabilityBridgeToken = createHmac(
  "sha256",
  signing.key
).update("governed-investment-v3-observability-bridge-v1").digest("base64url");

export const config = {
  assistantProductProfile,
  publicBranding,
  port: integerFromEnvironment("PORT", 3000),
  marketCacheMs: integerFromEnvironment("MARKET_CACHE_MS", 900),
  marketStreamIntervalMs: integerFromEnvironment("MARKET_STREAM_INTERVAL_MS", 1_000),
  marketTimeoutMs: integerFromEnvironment("MARKET_TIMEOUT_MS", 5000),
  marketAgentTimeoutMs: integerFromEnvironment("MARKET_AGENT_TIMEOUT_MS", 15_000),
  modelTimeoutMs: boundedIntegerFromEnvironment(
    "MODEL_TIMEOUT_MS",
    15_000,
    30_000,
    process.env
  ),
  apiRateLimitMax: integerFromEnvironment("API_RATE_LIMIT_MAX", 60),
  apiRateLimitWindowMs: integerFromEnvironment("API_RATE_LIMIT_WINDOW_MS", 60_000),
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  openaiModel: lockedOpenAIModel(process.env.OPENAI_MODEL),
  openaiEscalationModel: lockedOpenAIEscalationModel(
    process.env.OPENAI_ESCALATION_MODEL
  ),
  mastraStorageUrl,
  mastraStudioStorageUrl,
  mastraObservabilityPath,
  mastraStudioObservabilityPath,
  mastraObservabilityShared,
  mastraObservabilityBridgeToken,
  mastraObservabilityBridgeEndpoint: "http://127.0.0.1:4111",
  mastraStudioEditorCodePath: localPathFromEnvironment(
    process.env.MASTRA_STUDIO_EDITOR_CODE_PATH,
    "src/assistant-v3/editor-overrides"
  ),
  assistantAuditOutboxPath: path.resolve(
    projectRootFromEnvironment(),
    process.env.ASSISTANT_AUDIT_OUTBOX_PATH?.trim() || ".assistant-v3-audit.jsonl"
  ),
  knowledgeVectorUrl: fileBackedUrlFromEnvironment(
    process.env.KNOWLEDGE_VECTOR_URL,
    "file:./.knowledge-vector.db"
  ),
  knowledgeIndexName: knowledgeIndexNameFromEnvironment(process.env.KNOWLEDGE_INDEX_NAME),
  knowledgeIndexGeneration:
    process.env.KNOWLEDGE_INDEX_GENERATION?.trim() ||
    "project-authored-knowledge-2026-07-29-v1",
  knowledgeMinimumScore: numberFromEnvironment("KNOWLEDGE_MINIMUM_SCORE", 0.08, 1),
  knowledgeApprovalMode: knowledgeApprovalModeFromEnvironment(
    process.env.KNOWLEDGE_APPROVAL_MODE,
    environment
  ),
  assistantV3Enabled: booleanFromEnvironment("ASSISTANT_V3_ENABLED", true),
  assistantInternalDiagnosticsToken: internalDiagnosticsTokenFromEnvironment(
    process.env.ASSISTANT_INTERNAL_DIAGNOSTICS_TOKEN
  ),
  assistantReleaseTarget: releaseTarget,
  assistantDemoMarketProvider: demoMarketProvider,
  assistantV3SessionTtlMs: integerFromEnvironment(
    "ASSISTANT_V3_SESSION_TTL_MS",
    30 * 60_000
  ),
  assistantV3ConversationMemoryEnabled: conversationMemory.enabled,
  assistantV3ConversationMemoryTtlMs: conversationMemory.ttlMs,
  assistantV3ConversationMemoryMaxEntries: conversationMemory.maxEntries,
  assistantV3ConversationMemoryMaxHops: conversationMemory.maxHops,
  assistantV3ConversationMemoryMode: conversationMemory.mode,
  assistantV3OrderHandoffTtlMs: integerFromEnvironment(
    "ASSISTANT_V3_ORDER_HANDOFF_TTL_MS",
    5 * 60_000
  ),
  assistantSigningKey: signing.key,
  assistantUsesDevelopmentSigningKey: signing.developmentKey,
  identityMode: process.env.ASSISTANT_IDENTITY_MODE?.trim() || "mock-internal-pilot",
  portfolioMode: process.env.ASSISTANT_PORTFOLIO_MODE?.trim() || "synthetic-ledger",
  marketLicenceClass:
    process.env.MARKET_LICENCE_CLASS?.trim() ||
    (demoMarketProvider === "synthetic-offline"
      ? "synthetic"
      : "development-public-feed"),
  studioExposed: booleanFromEnvironment("ASSISTANT_STUDIO_EXPOSED", false),
  environment,
  logLevel: logLevelFromEnvironment()
};
