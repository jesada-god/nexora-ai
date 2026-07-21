import { describe, expect, it } from 'vitest';
import { anchorIndexOfTime, calculateAnchoredVwap, resolveAnchorIndex, type AvwapInputCandle } from './anchored-vwap';

function bar(date: string, high: number, low: number, close: number, volume: number | null): AvwapInputCandle {
  return { date, high, low, close, volume };
}

const SERIES: AvwapInputCandle[] = [
  bar('2026-01-01', 11, 9, 10, 100),
  bar('2026-01-02', 13, 11, 12, 200),
  bar('2026-01-03', 15, 13, 14, 300),
  bar('2026-01-04', 12, 10, 11, 400),
];

describe('anchored VWAP', () => {
  it('computes cumulative typical×volume ÷ volume from the anchor (deterministic fixture)', () => {
    const result = calculateAnchoredVwap(SERIES, { index: 1, source: 'custom' });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    // From index 1: typicals 12,14,11 with volumes 200,300,400.
    // final = (12*200 + 14*300 + 11*400) / (200+300+400) = (2400+4200+4400)/900 = 11000/900
    expect(result.value).toBeCloseTo(11000 / 900, 6);
    expect(result.points).toHaveLength(3);
    expect(result.anchorTime).toBe('2026-01-02');
  });

  it('resolves presets to existing candles', () => {
    expect(resolveAnchorIndex(SERIES, 'earliest-visible')).toBe(0);
    const swingHigh = resolveAnchorIndex(SERIES, 'latest-swing-high', 1);
    expect(swingHigh).not.toBeNull();
    expect(SERIES[swingHigh!].date).toBe('2026-01-03');
  });

  it('returns typed unavailable when volume is missing from the anchor forward — no silent substitution', () => {
    const noVolume = SERIES.map((item) => ({ ...item, volume: null }));
    const result = calculateAnchoredVwap(noVolume, { index: 0, source: 'earliest-visible' });
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') expect(result.reason).toMatch(/Volume/i);
  });

  it('returns typed unavailable for an anchor outside the range', () => {
    expect(calculateAnchoredVwap(SERIES, { index: 99, source: 'custom' }).status).toBe('unavailable');
    expect(anchorIndexOfTime(SERIES, '2020-01-01')).toBeNull();
    expect(anchorIndexOfTime(SERIES, '2026-01-03')).toBe(2);
  });
});
