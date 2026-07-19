import { describe, expect, it } from 'vitest';
import { calculateVolumeProfile, normalizeVolumeCandles } from './calculations';

const candle = (date: string, low: number, high: number, volume?: number) => ({ date, open: low, high, low, close: high, volume });

describe('VPVR', () => {
  it('normalizes unsorted duplicate timestamps without shifting missing volume', () => {
    const result = normalizeVolumeCandles([candle('2026-01-02', 2, 3, 20), candle('2026-01-01', 1, 2), candle('2026-01-02', 2, 4, 30)]);
    expect(result.map((item) => [item.date, item.volume])).toEqual([['2026-01-01', null], ['2026-01-02', 30]]);
  });

  it('uses adaptive bins, conserves volume, and handles flat candles deterministically', () => {
    const input = [candle('2026-01-01', 10, 10, 100), candle('2026-01-02', 9, 12, 300), candle('2026-01-03', 10, 13, 200)];
    const first = calculateVolumeProfile(input);
    expect(first).toEqual(calculateVolumeProfile(input));
    expect(first.status).toBe('available');
    if (first.status === 'available') {
      expect(first.bins.length).toBeGreaterThanOrEqual(12);
      expect(first.totalAllocatedVolume).toBeCloseTo(first.totalInputVolume, 8);
      expect(first.poc.volume).toBe(Math.max(...first.bins.map((bin) => bin.volume)));
      expect(first.val).toBeLessThanOrEqual(first.vah);
      expect(JSON.stringify(first)).not.toMatch(/NaN|Infinity/);
    }
  });

  it('reports partial and missing volume coverage without fabricating zero', () => {
    const partial = calculateVolumeProfile([candle('2026-01-01', 1, 2), candle('2026-01-02', 1, 2, 0)]);
    expect(partial).toMatchObject({ status: 'available', coverage: 0.5, totalInputVolume: 0 });
    expect(calculateVolumeProfile([candle('2026-01-01', 1, 2)])).toMatchObject({ status: 'unavailable', coverage: 0 });
  });
});
