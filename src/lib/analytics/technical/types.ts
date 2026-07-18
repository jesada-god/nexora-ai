import type { DataFreshness, HistoricalPrice } from '@/src/lib/market-data/types';

export type PriceField = 'open' | 'high' | 'low' | 'close';
export type TechnicalIndicatorId = 'sma' | 'ema' | 'rsi' | 'macd' | 'bollinger' | 'atr' | 'averageVolume';

export interface IndicatorPoint {
  date: string;
  value: number;
}

export interface MacdPoint extends IndicatorPoint {
  signal: number | null;
  histogram: number | null;
}

export interface BollingerPoint extends IndicatorPoint {
  upper: number;
  middle: number;
  lower: number;
}

export interface TechnicalParameters {
  priceField: PriceField;
  smaPeriod: number;
  emaPeriod: number;
  rsiPeriod: number;
  macdFastPeriod: number;
  macdSlowPeriod: number;
  macdSignalPeriod: number;
  bollingerPeriod: number;
  bollingerStdDev: number;
  atrPeriod: number;
  averageVolumePeriod: number;
}

export interface TechnicalContext {
  symbol: string;
  source: string | null;
  freshness: DataFreshness;
  calculatedAt?: string;
}

export interface IndicatorUnavailable {
  status: 'unavailable';
  reason: string;
  minimumDataPoints: number;
  actualDataPoints: number;
}

export interface IndicatorAvailable<T> {
  status: 'available';
  points: T[];
  latest: T;
}

export type IndicatorResult<T> = IndicatorAvailable<T> | IndicatorUnavailable;

export interface TechnicalAnalysisResult {
  status: 'available';
  symbol: string;
  input: { priceField: PriceField; candleCount: number; interval: '1d' };
  dataSource: string | null;
  dataPoints: number;
  latestDataAt: string;
  calculatedAt: string;
  methodology: 'Deterministic technical indicators calculated from daily OHLCV';
  parameters: TechnicalParameters;
  freshness: DataFreshness;
  limitations: string[];
  indicators: {
    sma: IndicatorResult<IndicatorPoint>;
    ema: IndicatorResult<IndicatorPoint>;
    rsi: IndicatorResult<IndicatorPoint>;
    macd: IndicatorResult<MacdPoint>;
    bollinger: IndicatorResult<BollingerPoint>;
    atr: IndicatorResult<IndicatorPoint>;
    averageVolume: IndicatorResult<IndicatorPoint>;
  };
}

export interface TechnicalAnalysisUnavailable {
  status: 'unavailable';
  symbol: string;
  reason: string;
  input: { priceField: PriceField; candleCount: number; interval: '1d' };
  dataSource: string | null;
  dataPoints: number;
  latestDataAt: string | null;
  calculatedAt: string;
  methodology: 'Deterministic technical indicators calculated from daily OHLCV';
  parameters: TechnicalParameters;
  freshness: DataFreshness;
  limitations: string[];
}

export type TechnicalAnalysis = TechnicalAnalysisResult | TechnicalAnalysisUnavailable;
export type TechnicalCandles = readonly HistoricalPrice[];

