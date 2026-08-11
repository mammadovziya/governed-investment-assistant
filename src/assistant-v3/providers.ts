import type { MarketSnapshot } from "../domain/types.js";
import {
  YahooMarketDataProvider,
  type MarketDataProvider,
  type YahooProviderOptions
} from "../services/market-data.js";
import {
  YahooSecurityResearchProvider,
  type SecurityResearchProvider,
  type YahooSecurityResearchProviderOptions
} from "../services/security-research.js";
import type { SecurityResearchReport } from "../domain/security-research.js";

export type ProviderRuntimeEnvironment = "development" | "test" | "staging" | "production";
export type ProviderLicenseClass =
  | "synthetic"
  | "development-only"
  | "production-approved";

export interface PublicProviderDescriptor {
  id: string;
  displayName: string;
  licenseClass: ProviderLicenseClass;
  allowedEnvironments: readonly ProviderRuntimeEnvironment[];
  attributionRequired: boolean;
}

export interface MarketSnapshotPort {
  readonly descriptor: PublicProviderDescriptor;
  getSnapshot(symbol: string): Promise<MarketSnapshot>;
}

export interface InstrumentResearchPort {
  readonly descriptor: PublicProviderDescriptor;
  getResearch(symbol: string): Promise<SecurityResearchReport>;
}

export type PublicMarketResearchPort = MarketSnapshotPort & InstrumentResearchPort;

/**
 * The current Yahoo endpoints are useful for development and evaluation, but
 * this repository has no contract that permits customer-production use.
 */
export const YAHOO_DEVELOPMENT_PROVIDER: PublicProviderDescriptor = Object.freeze({
  id: "yahoo-finance",
  displayName: "Yahoo Finance",
  licenseClass: "development-only",
  allowedEnvironments: Object.freeze(["development", "test"] as const),
  attributionRequired: true
});

export class ProviderLicenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderLicenseError";
  }
}

export interface YahooDevelopmentProviderOptions {
  environment?: ProviderRuntimeEnvironment;
  marketData?: MarketDataProvider;
  securityResearch?: SecurityResearchProvider;
  marketDataOptions?: YahooProviderOptions;
  securityResearchOptions?: YahooSecurityResearchProviderOptions;
}

/**
 * V3 adapter around the existing live Yahoo services. The adapter deliberately
 * refuses to initialize in production so a runtime flag cannot turn an
 * unlicensed development source into a production dependency.
 */
export class YahooDevelopmentMarketResearchProvider implements PublicMarketResearchPort {
  readonly descriptor = YAHOO_DEVELOPMENT_PROVIDER;
  private readonly marketData: MarketDataProvider;
  private readonly securityResearch: SecurityResearchProvider;

  constructor(options: YahooDevelopmentProviderOptions = {}) {
    const environment = options.environment ?? "development";
    if (!this.descriptor.allowedEnvironments.includes(environment)) {
      throw new ProviderLicenseError(
        `Yahoo Finance is classified as development-only and cannot be enabled in ${environment}.`
      );
    }

    this.marketData =
      options.marketData ?? new YahooMarketDataProvider(options.marketDataOptions);
    this.securityResearch =
      options.securityResearch ??
      new YahooSecurityResearchProvider(options.securityResearchOptions);
  }

  getSnapshot(symbol: string): Promise<MarketSnapshot> {
    return this.marketData.getSnapshot(symbol);
  }

  getResearch(symbol: string): Promise<SecurityResearchReport> {
    return this.securityResearch.getResearch(symbol);
  }
}

export interface YandexApiContract {
  baseUrl: string;
  version: string;
  quoteEndpoint: string;
  researchEndpoint: string;
}

export interface YandexCredentials {
  apiKey: string;
}

export interface YandexLicensingConfiguration {
  agreementId: string;
  attributionLabel: string;
  customerDisplayPermitted: boolean;
  automatedRetrievalPermitted: boolean;
}

export interface YandexProviderConfiguration {
  enabled: boolean;
  apiContract?: YandexApiContract;
  credentials?: YandexCredentials;
  licensing?: YandexLicensingConfiguration;
}

export type YandexConfigurationRequirement =
  | "explicit-enable"
  | "api-contract"
  | "credentials"
  | "licensing";

export interface YandexProviderActivation {
  providerId: "yandex-market-data";
  enabled: boolean;
  missingRequirements: YandexConfigurationRequirement[];
  reason: string;
}

function hasExplicitYandexApiContract(
  contract: YandexApiContract | undefined
): contract is YandexApiContract {
  if (!contract) return false;
  let baseUrl: URL;
  try {
    baseUrl = new URL(contract.baseUrl);
  } catch {
    return false;
  }
  return (
    baseUrl.protocol === "https:" &&
    contract.version.trim().length > 0 &&
    contract.quoteEndpoint.startsWith("/") &&
    contract.researchEndpoint.startsWith("/")
  );
}

function hasYandexCredentials(
  credentials: YandexCredentials | undefined
): credentials is YandexCredentials {
  return Boolean(credentials?.apiKey.trim());
}

function hasYandexLicensingConfiguration(
  licensing: YandexLicensingConfiguration | undefined
): licensing is YandexLicensingConfiguration {
  return Boolean(
    licensing?.agreementId.trim() &&
      licensing.attributionLabel.trim() &&
      licensing.customerDisplayPermitted &&
      licensing.automatedRetrievalPermitted
  );
}

/**
 * This is a fail-closed activation guard, not a Yandex implementation. Nothing
 * reads ambient environment variables or credentials implicitly.
 */
export function evaluateYandexProviderConfiguration(
  configuration: YandexProviderConfiguration | undefined
): YandexProviderActivation {
  const missingRequirements: YandexConfigurationRequirement[] = [];
  if (configuration?.enabled !== true) missingRequirements.push("explicit-enable");
  if (!hasExplicitYandexApiContract(configuration?.apiContract)) {
    missingRequirements.push("api-contract");
  }
  if (!hasYandexCredentials(configuration?.credentials)) {
    missingRequirements.push("credentials");
  }
  if (!hasYandexLicensingConfiguration(configuration?.licensing)) {
    missingRequirements.push("licensing");
  }

  return {
    providerId: "yandex-market-data",
    enabled: missingRequirements.length === 0,
    missingRequirements,
    reason:
      missingRequirements.length === 0
        ? "Yandex provider prerequisites are explicitly configured."
        : `Yandex provider is disabled; missing: ${missingRequirements.join(", ")}.`
  };
}

export const YANDEX_PROVIDER_DISABLED = Object.freeze(
  evaluateYandexProviderConfiguration(undefined)
);
