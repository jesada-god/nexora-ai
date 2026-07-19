import { describe, expect, it } from 'vitest';
import { heikinAshi, isValidOhlcv } from './calculations';

const raw = [
  { date: '2026-01-01', open: 10, high: 13, low: 9, close: 12, volume: 100 },
  { date: '2026-01-02', open: 12, high: 15, low: 11, close: 14, volume: 120 },
];

describe('advanced chart transforms', () => {
  it('calculates deterministic Heikin Ashi while retaining raw OHLC', () => {
    const result = heikinAshi(raw);
    expect(result[0]).toMatchObject({ open: 11, close: 11, high: 13, low: 9, raw: raw[0], transformed: true });
    expect(result[1]).toMatchObject({ open: 11, close: 13, high: 15, low: 11, raw: raw[1] });
    expect(raw[0].open).toBe(10);
  });

  it('rejects invalid OHLC and ordering without emitting synthetic values', () => {
    expect(isValidOhlcv([{ ...raw[0], high: 8 }])).toBe(false);
    expect(heikinAshi([...raw].reverse())).toEqual([]);
  });
});
