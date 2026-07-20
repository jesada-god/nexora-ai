import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_LAYERS, parseChartLayers, parseChartType, parseIndicatorIds } from './preferences';

describe('chart preference validation', () => {
  it('validates chart types and invalid storage safely', () => {
    expect(parseChartType('ohlc', 'area')).toBe('ohlc');
    expect(parseChartType('future-chart', 'area')).toBe('area');
    expect(parseChartLayers('{broken')).toEqual(DEFAULT_CHART_LAYERS);
  });

  it('hydrates only booleans and known unique indicators', () => {
    expect(parseChartLayers(JSON.stringify({ volume: false, vpvr: true, fibonacci: 'yes', removedLayer: true }))).toEqual({ ...DEFAULT_CHART_LAYERS, volume: false, vpvr: true });
    expect(parseIndicatorIds(JSON.stringify(['ema', 'ema', 'bad', 20]), ['ema', 'sma'])).toEqual(['ema']);
  });
});
