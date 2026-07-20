import type { NormalizedBar } from '../chart-data/timeline';

export type AdvancedChartType = 'candlestick' | 'heikin-ashi' | 'line' | 'area' | 'ohlc' | 'hollow-candles';

export interface ChartCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  raw: NormalizedBar;
  transformed: boolean;
}
