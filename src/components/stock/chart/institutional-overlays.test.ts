import { describe, expect, it } from 'vitest';
import type { NormalizedBar } from '@/src/lib/analytics/chart-data/timeline';
import {
  buildInstitutionalOverlaySpec,
  buildInstitutionalZones,
  calculateAnchoredVwap,
  calculateVisibleRangeVolumeProfile,
} from '@/src/lib/analytics/institutional-sr';
import {
  DAILY_REFERENCE_INTERVAL,
  isDailyReferenceInterval,
  resolveAvwapAnchor,
  sliceVisibleBars,
  toAvwapCandles,
  toVrvpCandles,
  toZoneCandles,
} from './institutional-overlays';

function daily(count: number): NormalizedBar[] {
  return Array.from({ length: count }, (_, index) => {
    const base = 100 + Math.sin((index * Math.PI) / 5) * 12;
    const isHigh = index % 10 === 2;
    const isLow = index % 10 === 7;
    return {
      time: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      open: base - 0.3,
      high: base + (isHigh ? 4 : 1),
      low: base - (isLow ? 4 : 1),
      close: base + 0.3,
      volume: 1_000 + (index % 9) * 40,
    };
  });
}

describe('institutional overlay bridge', () => {
  it('recognises only the 1D interval as the D1 zone reference', () => {
    expect(isDailyReferenceInterval(DAILY_REFERENCE_INTERVAL)).toBe(true);
    expect(isDailyReferenceInterval('5m')).toBe(false);
    expect(isDailyReferenceInterval(undefined)).toBe(false);
  });

  it('maps bars to zone candles and drops the still-forming daily bar', () => {
    const bars = daily(5);
    const kept = toZoneCandles(bars, false);
    const dropped = toZoneCandles(bars, true);
    expect(kept).toHaveLength(5);
    expect(dropped).toHaveLength(4);
    expect(kept[0].date).toBe(bars[0].time);
    expect(kept[0].close).toBe(bars[0].close);
  });

  it('slices the visible logical range and clamps to loaded candles', () => {
    const bars = daily(10);
    expect(sliceVisibleBars(bars, null)).toHaveLength(10);
    expect(sliceVisibleBars(bars, { from: 2.4, to: 5.9 })).toHaveLength(5); // floor(2.4)=2 .. ceil(5.9)=6 inclusive
    expect(sliceVisibleBars(bars, { from: -5, to: 500 })).toHaveLength(10);
    expect(sliceVisibleBars(bars, { from: 8, to: 3 })).toHaveLength(0);
  });

  it('defaults a missing anchor to the earliest visible candle without substituting a price', () => {
    const candles = toAvwapCandles(daily(30));
    expect(resolveAvwapAnchor(candles, null)).toEqual({ index: 0, source: 'earliest-visible' });
    const preset = resolveAvwapAnchor(candles, { symbol: 'X', interval: '1D', anchor: 'latest-swing-high', source: 'latest-swing-high' });
    expect(preset?.source).toBe('latest-swing-high');
    expect(preset?.index).toBeGreaterThan(0);
    // A custom time that is not present resolves to null — never another anchor.
    expect(resolveAvwapAnchor(candles, { symbol: 'X', interval: '1D', anchor: { time: '1999-01-01' }, source: 'custom' })).toBeNull();
    expect(resolveAvwapAnchor([], null)).toBeNull();
  });

  it('never relabels DELAYED/EOD-derived overlays as real-time', () => {
    const bars = daily(60);
    const zones = buildInstitutionalZones(toZoneCandles(bars, false), bars.at(-1)!.close, { calculatedAt: '2026-03-01T00:00:00.000Z' });
    const profile = calculateVisibleRangeVolumeProfile(toVrvpCandles(bars), { bins: 20 });
    const avwap = calculateAnchoredVwap(toAvwapCandles(bars), { index: 0, source: 'earliest-visible' });
    if (zones.status !== 'available' || profile.status !== 'available') throw new Error('expected available fixtures');
    const spec = buildInstitutionalOverlaySpec({ zones: zones.zones, showZones: true, profile, showVolumeProfile: true, avwap, showAnchoredVwap: true });
    const serialized = JSON.stringify({ zones, profile, avwap, spec });
    expect(serialized).not.toMatch(/real[\s_-]?time/i);
    expect(zones.referenceTimeframe).toBe('1D');
    expect(zones.zones.every((zone) => zone.referenceTimeframe === '1D')).toBe(true);
    // The VRVP is explicitly an OHLCV approximation, not tick-accurate real-time data.
    expect(profile.provenance).toBe('ohlcv-approximation');
    expect(spec.bands.length).toBeGreaterThan(0);
  });
});
