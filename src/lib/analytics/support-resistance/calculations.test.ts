import { describe, expect, it } from 'vitest';
import { calculateSupportResistance, confirmedSwingPivots } from './calculations';

const freshness = { status: 'end-of-day' as const, asOf: '2026-01-30T00:00:00.000Z', maxAgeSeconds: 86_400 };
const context = { symbol: 'TEST', source: 'fixture', freshness, calculatedAt: '2026-02-01T00:00:00.000Z' };

function fixture(length = 80): Array<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}> {
  return Array.from({ length }, (_, index) => {
    const close = 100 + Math.sin(index * Math.PI / 4) * 10;
    return {
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000 + (index % 8) * 20,
    };
  });
}

describe('deterministic support/resistance engine', () => {
  it('uses only candles known at confirmation time', () => {
    const complete = fixture(50);
    const prefix = complete.slice(0, 30);
    const prefixPivots = confirmedSwingPivots(prefix, 3);
    const completePivotsKnownAtPrefix = confirmedSwingPivots(complete, 3).filter((pivot) => pivot.confirmedAtIndex < prefix.length);
    expect(completePivotsKnownAtPrefix).toEqual(prefixPivots);
    expect(prefixPivots.every((pivot) => pivot.confirmedAtIndex === pivot.index + 3)).toBe(true);
  });

  it('merges repeated nearby swings, caps each side at three, and keeps levels strictly around latest close', () => {
    const result = calculateSupportResistance(fixture(), context, { pivotWindow: 2, atrTolerance: 1 });
    expect(result.status).toBe('available');
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    if (result.status === 'available') {
      const supports = result.zones.filter((zone) => zone.type === 'support');
      const resistances = result.zones.filter((zone) => zone.type === 'resistance');
      expect(supports.length).toBeLessThanOrEqual(3);
      expect(resistances.length).toBeLessThanOrEqual(3);
      expect(supports.every((zone) => zone.midpoint < result.currentPrice && zone.upper < result.currentPrice)).toBe(true);
      expect(resistances.every((zone) => zone.midpoint > result.currentPrice && zone.lower > result.currentPrice)).toBe(true);
      expect(result.zones.some((zone) => zone.touches > 2)).toBe(true);
      for (const side of [supports, resistances]) {
        const distances = side.map((zone) => Math.abs(zone.midpoint - result.currentPrice));
        expect(distances).toEqual([...distances].sort((left, right) => left - right));
      }
    }
  });

  it('returns unavailable for insufficient, invalid, or below-threshold data without fallback levels', () => {
    const base = fixture();
    expect(calculateSupportResistance(base.slice(0, 5), context).status).toBe('unavailable');
    expect(calculateSupportResistance([...base].reverse(), context).status).toBe('unavailable');
    expect(calculateSupportResistance(base, context, { minimumStrengthScore: 100 }).status).toBe('unavailable');
  });

  it('does not fabricate volume confirmation when canonical slots have no volume', () => {
    const input = fixture().map((candle) => ({ ...candle, volume: null }));
    const result = calculateSupportResistance(input, context, { pivotWindow: 2, atrTolerance: 1 });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.zones.every((zone) => zone.scoreComponents.relativeVolume === null)).toBe(true);
    }
  });
});
