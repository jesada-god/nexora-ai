import type { HistoricalPrice } from '@/src/lib/market-data/types';

export type AdvancedChartType = 'candlestick' | 'heikin-ashi' | 'line' | 'area' | 'ohlc' | 'hollow-candles';

export interface ChartCandle extends HistoricalPrice {
  raw: HistoricalPrice;
  transformed: boolean;
}
