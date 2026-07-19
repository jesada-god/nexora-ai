import { describe, expect, it } from 'vitest';
import { calculateFibonacci } from './calculations';

function waves(values: number[]) { return values.map((close, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 100 })); }

describe('confirmed Fibonacci', () => {
  it('selects a deterministic confirmed uptrend leg and expected retracements', () => {
    const input = waves([10, 9, 8, 9, 10, 12, 15, 13, 11, 12, 13, 14, 13, 12, 11, 15, 18, 16, 15]);
    const result = calculateFibonacci(input, 2, 3, 1);
    expect(result).toEqual(calculateFibonacci(input, 2, 3, 1));
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.direction).toBe('uptrend');
      const distance = result.end.price - result.start.price;
      expect(result.levels.map((level) => level.price)).toEqual([expect.closeTo(result.end.price - distance * 0.382, 8), expect.closeTo(result.end.price - distance * 0.5, 8), expect.closeTo(result.end.price - distance * 0.618, 8)]);
    }
  });

  it('does not use an unconfirmed final extreme and supports downtrend/unavailable', () => {
    const base = waves([15, 16, 17, 16, 15, 12, 9, 11, 13, 12, 11, 10, 12, 14, 15, 13, 11, 9, 11, 12]);
    const result = calculateFibonacci(base, 2, 3, 1);
    expect(result.status === 'available' && result.direction).toBe('downtrend');
    const extreme = [...base, { ...base.at(-1)!, date: '2026-01-21', high: 1_000, close: 999, open: 998 }];
    const changed = calculateFibonacci(extreme, 2, 3, 1);
    if (changed.status === 'available') expect(changed.end.price).toBeLessThan(900);
    expect(calculateFibonacci(base.slice(0, 4), 2, 14).status).toBe('unavailable');
  });
});
