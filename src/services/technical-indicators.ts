import type { MarketHistorySeries } from "../domain/market-history.js";

export interface TechnicalIndicatorValue {
  id: "sma20" | "sma50" | "sma200" | "rsi14" | "oneYearReturn" | "annualizedVolatility" | "maximumDrawdown";
  label: string;
  value: number | null;
  unit: "currency" | "percent" | "index";
  period: string;
  asOf: string;
  source: "computed-from-yahoo-history";
}

export interface TechnicalIndicatorReport {
  symbol: string;
  currency: string;
  asOf: string;
  historyRange: "1y";
  observations: number;
  latestClose: number;
  periodHigh: number;
  periodLow: number;
  indicators: TechnicalIndicatorValue[];
  methodologyVersion: "technical-indicators-v1";
  notices: string[];
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function simpleMovingAverage(values: readonly number[], period: number): number | null {
  if (values.length < period) return null;
  const sample = values.slice(-period);
  return sample.reduce((sum, value) => sum + value, 0) / period;
}

function relativeStrengthIndex(values: readonly number[], period: number): number | null {
  if (values.length <= period) return null;
  const sample = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const change = (sample[index] as number) - (sample[index - 1] as number);
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const strength = averageGain / averageLoss;
  return 100 - 100 / (1 + strength);
}

function dailyReturns(values: readonly number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1] as number;
    const current = values[index] as number;
    if (previous > 0) returns.push(current / previous - 1);
  }
  return returns;
}

function sampleVolatility(returns: readonly number[]): number | null {
  if (returns.length < 20) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function maximumDrawdown(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  let peak = values[0] as number;
  let maximumLoss = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) maximumLoss = Math.max(maximumLoss, 1 - value / peak);
  }
  return maximumLoss * 100;
}

export function calculateTechnicalIndicators(history: MarketHistorySeries): TechnicalIndicatorReport {
  if (history.range !== "1y") {
    throw new TypeError("Technical indicators require a one-year history series.");
  }
  const closes = history.points
    .map((point) => point.close)
    .filter((value): value is number => Number.isFinite(value) && value > 0);
  const latestClose = closes.at(-1);
  const firstClose = closes[0];
  if (latestClose === undefined || firstClose === undefined) {
    throw new TypeError("Technical indicators require at least one valid close.");
  }
  const returns = dailyReturns(closes);
  const indicator = (
    id: TechnicalIndicatorValue["id"],
    label: string,
    value: number | null,
    unit: TechnicalIndicatorValue["unit"],
    period: string
  ): TechnicalIndicatorValue => ({
    id,
    label,
    value: value === null ? null : round(value),
    unit,
    period,
    asOf: history.asOf,
    source: "computed-from-yahoo-history"
  });

  return {
    symbol: history.symbol,
    currency: history.currency,
    asOf: history.asOf,
    historyRange: "1y",
    observations: closes.length,
    latestClose,
    periodHigh: Math.max(...closes),
    periodLow: Math.min(...closes),
    indicators: [
      indicator("sma20", "20-day moving average", simpleMovingAverage(closes, 20), "currency", "20 trading sessions"),
      indicator("sma50", "50-day moving average", simpleMovingAverage(closes, 50), "currency", "50 trading sessions"),
      indicator("sma200", "200-day moving average", simpleMovingAverage(closes, 200), "currency", "200 trading sessions"),
      indicator("rsi14", "RSI (14)", relativeStrengthIndex(closes, 14), "index", "14 trading sessions"),
      indicator(
        "oneYearReturn",
        "Period price return",
        firstClose > 0 ? (latestClose / firstClose - 1) * 100 : null,
        "percent",
        "available one-year history"
      ),
      indicator("annualizedVolatility", "Annualized volatility", sampleVolatility(returns), "percent", "daily returns; 252-session annualization"),
      indicator("maximumDrawdown", "Maximum drawdown", maximumDrawdown(closes), "percent", "available one-year history")
    ],
    methodologyVersion: "technical-indicators-v1",
    notices: [
      "Indicators are descriptive calculations from historical closing prices, not predictions.",
      "The first and last available observations define the price return; distributions are excluded, so this is not total return.",
      "Yahoo's chart close series reflects the provider's corporate-action handling; no separate local split adjustment is applied.",
      "Annualized volatility requires at least 20 return observations."
    ]
  };
}
