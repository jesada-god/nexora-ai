import type { AdvancedChartType } from '../chart-types/types';
import type { TechnicalIndicatorId } from '../technical/types';

export const CHART_TYPES: readonly AdvancedChartType[] = ['candlestick', 'hollow-candles', 'ohlc', 'heikin-ashi', 'line', 'area'];
export const MOVING_AVERAGE_IDS: readonly TechnicalIndicatorId[] = ['ema', 'ema50', 'ema100', 'ema200', 'sma', 'sma50', 'sma100', 'sma200'];

export interface ChartLayerPreferences {
  volume: boolean;
  vpvr: boolean;
  fibonacci: boolean;
}

export const DEFAULT_CHART_LAYERS: ChartLayerPreferences = {
  volume: true,
  vpvr: false,
  fibonacci: false,
};

export function parseChartType(value: string | null, fallback: AdvancedChartType): AdvancedChartType {
  return CHART_TYPES.includes(value as AdvancedChartType) ? value as AdvancedChartType : fallback;
}

export function parseIndicatorIds(value: string | null, allowed: readonly TechnicalIndicatorId[]): TechnicalIndicatorId[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is TechnicalIndicatorId => typeof id === 'string' && allowed.includes(id as TechnicalIndicatorId)))];
  } catch {
    return [];
  }
}

export function parseChartLayers(value: string | null): ChartLayerPreferences {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_CHART_LAYERS;
    const candidate = parsed as Record<string, unknown>;
    return Object.fromEntries(Object.entries(DEFAULT_CHART_LAYERS).map(([key, fallback]) => [key, typeof candidate[key] === 'boolean' ? candidate[key] : fallback])) as unknown as ChartLayerPreferences;
  } catch {
    return DEFAULT_CHART_LAYERS;
  }
}
