import { describe, expect, it } from 'vitest';
import { averageVolume, calculateKeyStatistics, relativeDailyVolume, trailingPe } from './calculations';
import type { HistoricalPrice } from '@/src/lib/market-data/types';

const history: HistoricalPrice[] = Array.from({ length: 60 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), open: 10, high: 12, low: 9, close: 11, volume: 100 + index }));
describe('key statistics formulas', () => {
  it('calculates trailing P/E and rejects zero/negative EPS', () => {
    expect(trailingPe(100, 5, 'USD', 'USD')).toEqual({ status: 'available', value: 20 });
    expect(trailingPe(100, 0, 'USD', 'USD').status).toBe('not-meaningful');
    expect(trailingPe(100, -2, 'USD', 'USD').status).toBe('not-meaningful');
  });
  it('rejects a currency mismatch', () => expect(trailingPe(100, 5, 'USD', 'THB').status).toBe('unavailable'));
  it('calculates average and daily relative volume without assuming a complete session', () => {
    expect(averageVolume([10, 20, 30], 3)).toBe(20); expect(relativeDailyVolume(30, 20)).toBe(1.5); expect(relativeDailyVolume(10, 0)).toBeNull();
  });
  it('does not publish P/E from a stale quote and leaves missing capabilities unavailable', () => {
    const result = calculateKeyStatistics({ symbol: 'TEST', currency: 'USD', provider: 'fixture', price: 100, priceAsOf: '2026-01-01T00:00:00.000Z', freshness: { status: 'stale', asOf: '2026-01-01T00:00:00.000Z', maxAgeSeconds: 60 }, currentVolume: 250, marketCap: 1_000_000, dilutedEpsTtm: 5, history, calculatedAt: '2026-01-02T00:00:00.000Z' });
    expect(result.metrics.trailingPe).toMatchObject({ status: 'unavailable', missingInputs: ['nonStaleMarketPrice'] });
    expect(result.metrics.marketCap).toMatchObject({ value: 1_000_000 });
    expect(result.metrics.relativeVolume.limitations.length).toBeGreaterThan(0);
    expect(result.metrics.putCallVolume.status).toBe('unavailable');
  });
});
