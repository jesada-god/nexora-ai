import { describe, expect, it } from 'vitest';
import type { NormalizedBar } from '../chart-data/timeline';
import type { SupportResistanceResult, SupportResistanceZone } from './types';
import { DEFAULT_SUPPORT_RESISTANCE_PARAMETERS } from './validation';
import { buildSupportResistanceView, estimateTimeToLevel, summaryRows } from './levels';

const bars: NormalizedBar[] = [
  { time: '2026-07-15', open: 90, high: 105, low: 85, close: 100, volume: 1_000 },
  { time: '2026-07-16', open: 100, high: 110, low: 90, close: 105, volume: 1_100 },
  { time: '2026-07-17', open: 105, high: 108, low: 100, close: 106, volume: 1_200 },
];

function zone(type: 'support' | 'resistance', midpoint: number, score: number): SupportResistanceZone {
  return {
    id: `${type}-${midpoint}`,
    type,
    classification: type === 'support' ? 'Support' : 'Resistance',
    lower: midpoint - 0.5,
    upper: midpoint + 0.5,
    midpoint,
    touches: 3,
    latestTouchAt: '2026-07-16',
    strengthScore: score,
    scoreComponents: { touches: 0.75, recency: 0.8, rejection: 0.4, relativeVolume: 0.6, psychological: 0.2 },
    reasons: [{ id: 'touches', label: '3 confirmed touches', score: 31.5 }],
  };
}

const result: SupportResistanceResult = {
  status: 'available',
  symbol: 'TEST',
  source: 'fixture',
  sourceType: 'provider/cache historical OHLCV',
  dataPoints: bars.length,
  latestDataAt: '2026-07-17',
  calculatedAt: '2026-07-18T00:00:00.000Z',
  freshness: { status: 'end-of-day', asOf: '2026-07-17T00:00:00.000Z', maxAgeSeconds: 86_400 },
  methodology: 'fixture methodology',
  parameters: DEFAULT_SUPPORT_RESISTANCE_PARAMETERS,
  assumptions: [],
  limitations: ['fixture limitation'],
  currentPrice: 106,
  zones: [
    zone('resistance', 109, 70), zone('resistance', 115, 60), zone('resistance', 120, 50),
    zone('support', 101, 72), zone('support', 96, 62), zone('support', 90, 52),
  ],
};

describe('single-source support/resistance levels', () => {
  it('uses the exact calculated levels for chart lines and ordered summary rows', () => {
    const view = buildSupportResistanceView(bars, result);
    expect(view.status).toBe('available');
    if (view.status === 'available') {
      const rows = summaryRows(view);
      expect(rows.map((row) => 'current' in row ? 'Current' : row.label)).toEqual(['R3', 'R2', 'R1', 'Current', 'S1', 'S2', 'S3']);
      expect(view.nearest.label).toBe('R1');
      expect(rows.find((row) => !('current' in row) && row.label === 'R1')).toBe(view.levels.find((level) => level.label === 'R1'));
      expect(view.levels.every((level) => level.side === 'resistance' ? level.price > view.currentPrice : level.price < view.currentPrice)).toBe(true);
    }
  });

  it('clears stale results instead of showing levels from another data set', () => {
    const stale = { ...result, latestDataAt: '2026-07-16' };
    expect(buildSupportResistanceView(bars, stale)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('ไม่ตรงกับ OHLCV') });
  });

  it('returns unavailable when there is no calculated result and hides estimates for short history', () => {
    expect(buildSupportResistanceView(bars, undefined)).toMatchObject({ status: 'unavailable' });
    expect(estimateTimeToLevel(bars, 120)).toBeNull();
  });
});
