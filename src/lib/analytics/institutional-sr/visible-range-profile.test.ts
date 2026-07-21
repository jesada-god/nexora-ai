import { describe, expect, it } from 'vitest';
import { calculateVisibleRangeVolumeProfile, type VrvpInputCandle } from './visible-range-profile';

function candle(date: string, low: number, high: number, volume: number | null): VrvpInputCandle {
  const mid = (low + high) / 2;
  return { date, open: mid, high, low, close: mid, volume };
}

/** A range where the 100–102 band carries most of the volume. */
const RANGE: VrvpInputCandle[] = [
  candle('2026-01-01', 95, 97, 100),
  candle('2026-01-02', 100, 102, 900),
  candle('2026-01-03', 100, 102, 800),
  candle('2026-01-04', 100, 102, 850),
  candle('2026-01-05', 108, 110, 120),
  candle('2026-01-06', 100, 102, 700),
];

describe('visible range volume profile', () => {
  it('is deterministic and marks the OHLCV provenance', () => {
    const first = calculateVisibleRangeVolumeProfile(RANGE, { bins: 20, valueAreaPercent: 0.7 });
    const second = calculateVisibleRangeVolumeProfile(RANGE, { bins: 20, valueAreaPercent: 0.7 });
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    expect(first.provenance).toBe('ohlcv-approximation');
  });

  it('places POC in the high-volume band and keeps VAL ≤ POC ≤ VAH', () => {
    const result = calculateVisibleRangeVolumeProfile(RANGE, { bins: 20, valueAreaPercent: 0.7 });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    expect(result.poc).toBeGreaterThanOrEqual(100);
    expect(result.poc).toBeLessThanOrEqual(102);
    expect(result.val).toBeLessThanOrEqual(result.poc);
    expect(result.vah).toBeGreaterThanOrEqual(result.poc);
    expect(result.hvn.length).toBeGreaterThan(0);
    expect(result.bins).toBe(20);
    expect(result.valueAreaPercent).toBe(0.7);
  });

  it('honours the value-area percentage (wider area includes more price)', () => {
    const narrow = calculateVisibleRangeVolumeProfile(RANGE, { bins: 20, valueAreaPercent: 0.6 });
    const wide = calculateVisibleRangeVolumeProfile(RANGE, { bins: 20, valueAreaPercent: 0.9 });
    if (narrow.status !== 'available' || wide.status !== 'available') throw new Error('expected available');
    expect(wide.vah - wide.val).toBeGreaterThanOrEqual(narrow.vah - narrow.val);
  });

  it('returns typed unavailable when volume is entirely missing', () => {
    const noVolume = RANGE.map((item) => ({ ...item, volume: null }));
    const result = calculateVisibleRangeVolumeProfile(noVolume, { bins: 20 });
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') expect(result.reason).toMatch(/Volume/i);
  });

  it('recomputes from a narrower visible slice without any refetch', () => {
    const full = calculateVisibleRangeVolumeProfile(RANGE, { bins: 20 });
    const zoomed = calculateVisibleRangeVolumeProfile(RANGE.slice(1, 4), { bins: 20 });
    if (full.status !== 'available' || zoomed.status !== 'available') throw new Error('expected available');
    expect(zoomed.candleCount).toBe(3);
    expect(zoomed.visibleFrom).toBe('2026-01-02');
    expect(zoomed.visibleTo).toBe('2026-01-04');
  });
});
