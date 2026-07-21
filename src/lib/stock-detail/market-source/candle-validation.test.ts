import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FUTURE_TOLERANCE_SECONDS,
  isTradeablePrice,
  validateLiveCandle,
} from './candle-validation';
import type { LiveCandle } from './types';

// A fixed "now" well after the unix epoch so past-dated fixtures are never future.
const NOW_MS = Date.parse('2026-07-22T14:00:00.000Z');
const NOW_S = Math.floor(NOW_MS / 1_000);
const POLICY = { nowMs: NOW_MS, futureToleranceSeconds: DEFAULT_FUTURE_TOLERANCE_SECONDS };

function candle(overrides: Partial<LiveCandle> = {}): LiveCandle {
  return { time: NOW_S - 300, open: 10, high: 11, low: 9, close: 10.5, volume: 1_000, ...overrides };
}

describe('validateLiveCandle', () => {
  it('accepts a well-formed current bucket', () => {
    expect(validateLiveCandle(candle(), POLICY)).toEqual({ ok: true, reason: null });
  });

  it('rejects a non-finite time', () => {
    expect(validateLiveCandle(candle({ time: Number.NaN }), POLICY).reason).toBe('non-finite-time');
  });

  it('rejects a bucket dated beyond the future tolerance', () => {
    const future = candle({ time: NOW_S + DEFAULT_FUTURE_TOLERANCE_SECONDS + 60 });
    expect(validateLiveCandle(future, POLICY).reason).toBe('future-timestamp');
  });

  it('accepts a bucket within the clock-skew tolerance', () => {
    const skewed = candle({ time: NOW_S + DEFAULT_FUTURE_TOLERANCE_SECONDS - 1 });
    expect(validateLiveCandle(skewed, POLICY).ok).toBe(true);
  });

  it('rejects a zero or negative price', () => {
    expect(validateLiveCandle(candle({ close: 0 }), POLICY).reason).toBe('non-positive-price');
    expect(validateLiveCandle(candle({ low: -1, open: -1 }), POLICY).reason).toBe('non-positive-price');
    expect(validateLiveCandle(candle({ high: Number.POSITIVE_INFINITY }), POLICY).reason).toBe('non-positive-price');
  });

  it('rejects negative volume', () => {
    expect(validateLiveCandle(candle({ volume: -5 }), POLICY).reason).toBe('negative-volume');
  });

  it('rejects OHLC where high or low do not bound the body', () => {
    expect(validateLiveCandle(candle({ high: 8 }), POLICY).reason).toBe('invalid-ohlc'); // high < close/open
    expect(validateLiveCandle(candle({ low: 12 }), POLICY).reason).toBe('invalid-ohlc'); // low > close/open
  });
});

describe('isTradeablePrice', () => {
  it('accepts a finite positive number only', () => {
    expect(isTradeablePrice(10.5)).toBe(true);
    expect(isTradeablePrice(0)).toBe(false);
    expect(isTradeablePrice(-1)).toBe(false);
    expect(isTradeablePrice(Number.NaN)).toBe(false);
    expect(isTradeablePrice(null)).toBe(false);
    expect(isTradeablePrice(undefined)).toBe(false);
  });
});
