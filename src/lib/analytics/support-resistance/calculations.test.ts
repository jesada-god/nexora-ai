import { describe, expect, it } from 'vitest';
import { calculateSupportResistance } from './calculations';

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
    return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1_000 + (index % 8) * 20 };
  });
}

describe('support/resistance engine', () => {
  it('clusters confirmed pivots, returns finite metadata, and orders each side by distance', () => {
    const result = calculateSupportResistance(fixture(), context, { pivotWindow: 2, atrTolerance: 1 });
    expect(result.status).toBe('available');
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    if (result.status === 'available') {
      expect(result.zones.length).toBeGreaterThan(0);
      for (const type of ['support', 'resistance'] as const) {
        const distances = result.zones.filter((zone) => zone.type === type).map((zone) => Math.abs(zone.midpoint - result.currentPrice));
        expect(distances).toEqual([...distances].sort((a, b) => a - b));
      }
      expect(result.zones.every((zone) => zone.touches >= 2 && zone.strengthScore >= 0 && zone.strengthScore <= 100)).toBe(true);
    }
  });

  it('does not confirm a final unconfirmed swing and returns unavailable for insufficient/invalid data', () => {
    const base = fixture();
    const normal = calculateSupportResistance(base, context, { pivotWindow: 3 });
    const withFutureCandidate = [...base, { ...base.at(-1)!, date: '2026-03-22', high: 999, close: 998, open: 997 }];
    const changed = calculateSupportResistance(withFutureCandidate, context, { pivotWindow: 3 });
    if (changed.status === 'available') expect(changed.zones.every((zone) => zone.midpoint < 900)).toBe(true);
    expect(normal.status).not.toBe(undefined);
    expect(calculateSupportResistance(base.slice(0, 5), context).status).toBe('unavailable');
    expect(calculateSupportResistance([...base].reverse(), context).status).toBe('unavailable');
  });

  it('does not fabricate volume confirmation when a canonical slot has no volume', () => {
    const input = fixture();
    input[10] = { ...input[10], volume: null };
    const result = calculateSupportResistance(input, context, { pivotWindow: 2, atrTolerance: 1 });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.zones.every((zone) => zone.scoreComponents.relativeVolume == null || Number.isFinite(zone.scoreComponents.relativeVolume))).toBe(true);
    }
  });
});
