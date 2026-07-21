import { describe, expect, it } from 'vitest';
import { classifySide, distancePercent, priceDistance } from './distance';

describe('distancePercent', () => {
  it('computes abs(mid - price) / price * 100 deterministically', () => {
    expect(distancePercent(110, 100)).toBeCloseTo(10, 10);
    expect(distancePercent(90, 100)).toBeCloseTo(10, 10);
    expect(distancePercent(100, 100)).toBe(0);
    // Deterministic: same inputs → identical output.
    expect(distancePercent(103.5, 100)).toBe(distancePercent(103.5, 100));
  });

  it('is always finite — never NaN or Infinity', () => {
    for (const [mid, price] of [
      [Number.NaN, 100],
      [110, Number.NaN],
      [110, 0],
      [Number.POSITIVE_INFINITY, 100],
      [110, Number.NEGATIVE_INFINITY],
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    ] as Array<[number, number]>) {
      const result = distancePercent(mid, price);
      expect(Number.isFinite(result)).toBe(true);
    }
  });

  it('uses the magnitude of the price for a negative accepted price', () => {
    expect(distancePercent(-90, -100)).toBeCloseTo(10, 10);
  });
});

describe('priceDistance', () => {
  it('returns the finite absolute gap', () => {
    expect(priceDistance(105, 100)).toBe(5);
    expect(priceDistance(95, 100)).toBe(5);
    expect(priceDistance(Number.NaN, 100)).toBe(0);
  });
});

describe('classifySide', () => {
  it('marks a level above the price as resistance and below as support', () => {
    expect(classifySide(110, 110, 110, 100)).toBe('resistance');
    expect(classifySide(90, 90, 90, 100)).toBe('support');
  });

  it('marks a band that contains the accepted price as neutral', () => {
    expect(classifySide(98, 102, 100, 100)).toBe('neutral');
    expect(classifySide(100, 100, 100, 100)).toBe('neutral');
  });
});
