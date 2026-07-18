import { describe, expect, it } from 'vitest';
import type { HistoricalPrice } from '@/src/lib/market-data/types';
import { atrWilder, calculateTechnicalAnalysis, ema, macd, rsiWilder, sma } from './calculations';

const freshness = { status: 'end-of-day' as const, asOf: '2026-07-18T20:00:00.000Z', maxAgeSeconds: 86_400 };
const context = { symbol: 'TEST', source: 'fixture', freshness, calculatedAt: '2026-07-19T00:00:00.000Z' };

function candles(length: number, transform?: (candle: HistoricalPrice, index: number) => HistoricalPrice): HistoricalPrice[] {
  return Array.from({ length }, (_, index) => {
    const close = index + 10;
    const candle = { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1_000 + index };
    return transform?.(candle, index) ?? candle;
  });
}

describe('technical indicator formulas', () => {
  it('calculates SMA and seeded EMA from known values', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, 2, 3, 4, 5]);
  });

  it('calculates Wilder RSI and handles zero losses without Infinity', () => {
    expect(rsiWilder([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, null, 100, 100, 100]);
    expect(rsiWilder([5, 5, 5, 5], 2)).toEqual([null, null, 50, 50]);
  });

  it('calculates MACD, signal, and histogram from a known linear fixture', () => {
    const result = macd([1, 2, 3, 4, 5, 6], 2, 3, 2);
    expect(result.macd).toEqual([null, null, 0.5, 0.5, 0.5, 0.5]);
    expect(result.signal).toEqual([null, null, null, 0.5, 0.5, 0.5]);
    expect(result.histogram).toEqual([null, null, null, 0, 0, 0]);
  });

  it('calculates Wilder ATR from true ranges', () => {
    expect(atrWilder(candles(5), 3)).toEqual([null, null, 2, 2, 2]);
  });
});

describe('technical analysis contract', () => {
  it('returns per-indicator unavailable results when candles are insufficient', () => {
    const result = calculateTechnicalAnalysis(candles(10), context);
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.indicators.sma).toMatchObject({ status: 'unavailable', minimumDataPoints: 20, actualDataPoints: 10 });
      expect(result.indicators.rsi).toMatchObject({ status: 'unavailable', minimumDataPoints: 15 });
      expect(result.indicators.macd).toMatchObject({ status: 'unavailable', minimumDataPoints: 34 });
    }
  });

  it('returns deterministic metadata and finite results for identical input', () => {
    const first = calculateTechnicalAnalysis(candles(60), context);
    const second = calculateTechnicalAnalysis(candles(60), context);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'available', symbol: 'TEST', dataSource: 'fixture', dataPoints: 60, latestDataAt: '2026-03-01', calculatedAt: context.calculatedAt, freshness });
    expect(JSON.stringify(first)).not.toMatch(/NaN|Infinity/);
  });

  it('accepts zero OHLCV values but rejects NaN, Infinity, and invalid ordering', () => {
    const zero = calculateTechnicalAnalysis(candles(40, (candle) => ({ ...candle, open: 0, high: 0, low: 0, close: 0, volume: 0 })), context);
    expect(zero.status).toBe('available');
    const nan = calculateTechnicalAnalysis(candles(40, (candle, index) => index === 5 ? { ...candle, close: Number.NaN } : candle), context);
    expect(nan).toMatchObject({ status: 'unavailable' });
    const infinite = calculateTechnicalAnalysis(candles(40, (candle, index) => index === 5 ? { ...candle, high: Number.POSITIVE_INFINITY } : candle), context);
    expect(infinite).toMatchObject({ status: 'unavailable' });
    const reversed = calculateTechnicalAnalysis(candles(40).reverse(), context);
    expect(reversed).toMatchObject({ status: 'unavailable' });
  });

  it('preserves stale freshness instead of presenting stale data as current', () => {
    const result = calculateTechnicalAnalysis(candles(40), { ...context, freshness: { ...freshness, status: 'cached' } });
    expect(result.freshness.status).toBe('cached');
  });

  it('validates extreme periods and MACD ordering', () => {
    expect(() => calculateTechnicalAnalysis(candles(40), context, { smaPeriod: 251 })).toThrow();
    expect(() => calculateTechnicalAnalysis(candles(40), context, { macdFastPeriod: 30, macdSlowPeriod: 20 })).toThrow();
  });
});

