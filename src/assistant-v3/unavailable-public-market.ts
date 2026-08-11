import type { MarketHistoryRange, MarketHistorySeries } from "../domain/market-history.js";
import type { SecurityResearchReport } from "../domain/security-research.js";
import type { MarketSnapshot } from "../domain/types.js";
import { MarketDataError } from "../services/market-data.js";
import type { MarketHistoryProvider } from "../services/market-history.js";
import type {
  PublicMarketResearchPort,
  PublicProviderDescriptor
} from "./providers.js";

/**
 * Safe bootstrap descriptor used until an approved licensed production adapter
 * is supplied. Keeping the license class development-only is intentional: the
 * production-readiness evaluator must continue to report the public-market
 * capability as blocked rather than treating this sentinel as a licensed feed.
 */
export const UNAVAILABLE_PUBLIC_MARKET_PROVIDER: PublicProviderDescriptor =
  Object.freeze({
    id: "public-market-provider-unavailable",
    displayName: "Public market provider unavailable",
    licenseClass: "development-only",
    allowedEnvironments: Object.freeze(["staging", "production"] as const),
    attributionRequired: false
  });

function unavailable(): MarketDataError {
  return new MarketDataError(
    "An approved public market provider is not configured for this environment.",
    503
  );
}

/**
 * A non-networking fail-closed adapter. It permits the process to expose
 * liveness/readiness while ensuring no quote or research request can fall
 * through to a development feed.
 */
export class UnavailablePublicMarketResearchProvider
  implements PublicMarketResearchPort
{
  readonly descriptor = UNAVAILABLE_PUBLIC_MARKET_PROVIDER;

  async getSnapshot(_symbol: string): Promise<MarketSnapshot> {
    throw unavailable();
  }

  async getResearch(_symbol: string): Promise<SecurityResearchReport> {
    throw unavailable();
  }
}

/** Non-networking history counterpart to the unavailable market adapter. */
export class UnavailableMarketHistoryProvider implements MarketHistoryProvider {
  async getHistory(
    _symbol: string,
    _range: MarketHistoryRange
  ): Promise<MarketHistorySeries> {
    throw unavailable();
  }
}
