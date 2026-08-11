export type MarketFreshness = "live" | "delayed" | "indicative" | "stale";

export type SupportedLocale = "az-AZ" | "en-US";

export interface MarketSnapshot {
  symbol: string;
  displayName: string;
  currency: string;
  exchange: string;
  instrumentType: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  marketState: "OPEN" | "CLOSED" | "UNKNOWN";
  freshness: MarketFreshness;
  delayMinutes: number;
  asOf: string;
  source: string;
  notice: string;
}

export interface HoldingDefinition {
  symbol: string;
  name: string;
  assetClass: "Equity" | "ETF" | "Bond";
  quantity: number;
  averageCost: number;
  currency: "USD";
}

export interface CashBalance {
  currency: "USD";
  amount: number;
}

export interface MockClient {
  id: string;
  displayName: string;
  initials: string;
  locale: SupportedLocale;
  accountLabel: string;
  baseCurrency: "USD";
  holdings: HoldingDefinition[];
  cash: CashBalance[];
}

export interface PortfolioHolding extends HoldingDefinition {
  quote: MarketSnapshot | null;
  costBasis: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  dayChangeValue: number | null;
  allocationPercent: number | null;
}

export interface PortfolioSummary {
  clientId: string;
  baseCurrency: "USD";
  asOf: string;
  holdings: PortfolioHolding[];
  cash: CashBalance[];
  positionsValue: number;
  cashValue: number;
  coveredValue: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number | null;
  dayChangeValue: number;
  pricedHoldings: number;
  totalHoldings: number;
  coverageComplete: boolean;
  notices: string[];
}
