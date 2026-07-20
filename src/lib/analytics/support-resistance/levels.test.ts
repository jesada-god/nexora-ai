import { describe, expect, it } from 'vitest';
import type { NormalizedBar } from '../chart-data/timeline';
import { buildSupportResistanceView, calculateClassicPivotLevels, estimateTimeToLevel, summaryRows } from './levels';

const bars: NormalizedBar[] = [
  { time: '2026-07-15', open: 90, high: 105, low: 85, close: 100, volume: 1_000 },
  { time: '2026-07-16', open: 100, high: 110, low: 90, close: 105, volume: 1_100 },
  { time: '2026-07-17', open: 105, high: 108, low: 100, close: 106, volume: 1_200 },
];

describe('professional support/resistance levels', () => {
  it('calculates Classic Pivot from the previous completed session', () => {
    const levels = calculateClassicPivotLevels(bars);
    const values = Object.fromEntries(levels.map((level) => [level.label, level.price]));
    expect(values).toEqual({ P: 104.666667, R1: 109.333333, R2: 112.666667, R3: 117.333333, S1: 101.333333, S2: 96.666667, S3: 93.333333 });
    expect(levels.every((level) => level.asOf === '2026-07-17')).toBe(true);
    expect(calculateClassicPivotLevels(bars, false).every((level) => level.asOf === '2026-07-16')).toBe(true);
  });

  it('uses the same objects for chart levels and ordered summary rows', () => {
    const view = buildSupportResistanceView('pivot', bars, undefined);
    expect(view.status).toBe('available');
    if (view.status === 'available') {
      const rows = summaryRows(view);
      expect(rows.map((row) => 'current' in row ? 'Current' : row.label)).toEqual(['R3', 'R2', 'R1', 'Current', 'S1', 'S2', 'S3']);
      expect(view.nearest.label).toBe('R1');
      expect(rows.find((row) => !('current' in row) && row.label === 'R1')).toBe(view.levels.find((level) => level.label === 'R1'));
    }
  });

  it('keeps provider-backed modes unavailable instead of inventing OI or IV', () => {
    expect(buildSupportResistanceView('oi', bars, undefined)).toMatchObject({ status: 'unavailable', missingInputs: expect.arrayContaining(['OI']) });
    expect(buildSupportResistanceView('expected-move', bars, undefined)).toMatchObject({ status: 'unavailable', missingInputs: expect.arrayContaining(['ATM IV']) });
  });

  it('hides estimated time when history is insufficient', () => {
    expect(estimateTimeToLevel(bars, 120)).toBeNull();
  });
});
