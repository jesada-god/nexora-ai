import { describe, expect, it } from 'vitest';
import type { HistoricalPrice } from '@/src/lib/market-data/types';
import { buildInstitutionalZones, reprojectZoneDistances, ZONE_WEIGHTS } from './zones';
import { confirmedSwingPivots } from '../support-resistance/calculations';

const CALC_AT = '2026-02-01T00:00:00.000Z';

/** A deterministic oscillating daily series with pronounced swing wicks. */
function fixture(length = 90): HistoricalPrice[] {
  return Array.from({ length }, (_, index) => {
    const base = 100 + Math.sin((index * Math.PI) / 5) * 12;
    const isSwingHigh = index % 10 === 2;
    const isSwingLow = index % 10 === 7;
    const high = base + (isSwingHigh ? 4 : 1);
    const low = base - (isSwingLow ? 4 : 1);
    const open = base - 0.3;
    const close = base + 0.3;
    return {
      date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      open: Math.min(open, high),
      high,
      low,
      close: Math.max(low, close),
      volume: 1_000 + (index % 9) * 40,
    };
  });
}

describe('institutional demand/supply zones', () => {
  it('confirms pivots causally with no look-ahead', () => {
    const complete = fixture(60);
    const prefix = complete.slice(0, 34);
    const prefixPivots = confirmedSwingPivots(prefix, 3);
    const knownAtPrefix = confirmedSwingPivots(complete, 3).filter((pivot) => pivot.confirmedAtIndex < prefix.length);
    expect(knownAtPrefix).toEqual(prefixPivots);
    expect(prefixPivots.every((pivot) => pivot.confirmedAtIndex === pivot.index + 3)).toBe(true);
  });

  it('excludes the incomplete current daily candle when the caller drops it', () => {
    const candles = fixture();
    const withIncomplete = buildInstitutionalZones(candles, candles.at(-1)!.close, { calculatedAt: CALC_AT });
    const completedOnly = buildInstitutionalZones(candles.slice(0, -1), candles.at(-1)!.close, { calculatedAt: CALC_AT });
    // Dropping the last (still-forming) bar changes the candle count that feeds the engine.
    expect(withIncomplete.dataPoints).toBe(candles.length);
    expect(completedOnly.dataPoints).toBe(candles.length - 1);
  });

  it('produces non-overlapping zones, capped at 3 per side, ordered by distance', () => {
    const candles = fixture();
    const accepted = candles.at(-1)!.close;
    const result = buildInstitutionalZones(candles, accepted, { calculatedAt: CALC_AT });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    expect(result.demand.length).toBeLessThanOrEqual(3);
    expect(result.supply.length).toBeLessThanOrEqual(3);
    expect(result.demand.every((zone) => zone.high < accepted)).toBe(true);
    expect(result.supply.every((zone) => zone.low > accepted)).toBe(true);

    for (const side of [result.demand, result.supply]) {
      const distances = side.map((zone) => zone.distancePercent);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      // Non-overlapping within a side.
      const sorted = [...side].sort((a, b) => a.low - b.low);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i].low).toBeGreaterThanOrEqual(sorted[i - 1].high);
    }
  });

  it('scores components deterministically, weighted sum matches, never NaN/Infinity', () => {
    const candles = fixture();
    const accepted = candles.at(-1)!.close;
    const first = buildInstitutionalZones(candles, accepted, { calculatedAt: CALC_AT });
    const second = buildInstitutionalZones(candles, accepted, { calculatedAt: CALC_AT });
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    if (first.status !== 'available') throw new Error('expected available');
    for (const zone of first.zones) {
      expect(Number.isFinite(zone.score)).toBe(true);
      expect(zone.score).toBeGreaterThanOrEqual(0);
      expect(zone.score).toBeLessThanOrEqual(100);
      const c = zone.scoreComponents;
      const expected =
        c.touches * ZONE_WEIGHTS.touches +
        c.recency * ZONE_WEIGHTS.recency +
        c.rejection * ZONE_WEIGHTS.rejection +
        (c.volume ?? 0) * ZONE_WEIGHTS.volume +
        c.psychological * ZONE_WEIGHTS.psychological +
        (c.confluence ?? 0) * ZONE_WEIGHTS.confluence;
      expect(Math.abs(expected - zone.score)).toBeLessThan(0.5);
      expect(['weak', 'moderate', 'strong']).toContain(zone.strength);
    }
  });

  it('does not fabricate volume when volume is absent', () => {
    const candles = fixture().map((candle) => ({ ...candle, volume: null }));
    const result = buildInstitutionalZones(candles, candles.at(-1)!.close, { calculatedAt: CALC_AT });
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.zones.every((zone) => zone.scoreComponents.volume === null)).toBe(true);
  });

  it('adds POC/AVWAP confluence only through the optional levels input', () => {
    const candles = fixture();
    const accepted = candles.at(-1)!.close;
    const plain = buildInstitutionalZones(candles, accepted, { calculatedAt: CALC_AT });
    if (plain.status !== 'available') throw new Error('expected available');
    const target = plain.zones[0];
    const withConfluence = buildInstitutionalZones(candles, accepted, { calculatedAt: CALC_AT }, { poc: target.midpoint });
    if (withConfluence.status !== 'available') throw new Error('expected available');
    const same = withConfluence.zones.find((zone) => zone.id === target.id)!;
    expect(target.scoreComponents.confluence).toBeNull();
    expect(same.scoreComponents.confluence).not.toBeNull();
    expect(same.score).toBeGreaterThanOrEqual(target.score);
  });

  it('updates distance on a live price without rebuilding zone geometry', () => {
    const candles = fixture();
    const accepted = candles.at(-1)!.close;
    const result = buildInstitutionalZones(candles, accepted, { calculatedAt: CALC_AT });
    if (result.status !== 'available') throw new Error('expected available');
    const moved = reprojectZoneDistances(result.zones, accepted * 1.01);
    expect(moved.map((zone) => ({ low: zone.low, high: zone.high, score: zone.score, id: zone.id })))
      .toEqual(result.zones.map((zone) => ({ low: zone.low, high: zone.high, score: zone.score, id: zone.id })));
    // Distances changed, geometry did not.
    expect(moved.some((zone, index) => zone.distancePercent !== result.zones[index].distancePercent)).toBe(true);
  });

  it('returns typed unavailable for insufficient data or a bad accepted price', () => {
    const candles = fixture();
    expect(buildInstitutionalZones(candles.slice(0, 6), 100, { calculatedAt: CALC_AT }).status).toBe('unavailable');
    expect(buildInstitutionalZones(candles, 0, { calculatedAt: CALC_AT }).status).toBe('unavailable');
    expect(buildInstitutionalZones(candles, Number.NaN, { calculatedAt: CALC_AT }).status).toBe('unavailable');
  });
});
