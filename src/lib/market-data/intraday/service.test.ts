import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntradayProviderResult } from './contracts';
import { IntradayMarketDataService } from './service';

const result = (interval: IntradayProviderResult['interval'], sessionMode: IntradayProviderResult['sessionMode']): IntradayProviderResult => ({
  symbol: 'RKLB', interval, sessionMode, exchangeTimezone: 'America/New_York', provider: 'test-provider',
  asOf: '2026-07-20T20:00:00.000Z', status: 'delayed', delayedMinutes: 15, warnings: [],
  bars: [{ timestamp: '2026-07-20T14:30:00.000Z', sessionDate: '2026-07-20', open: 10, high: 11, low: 9, close: 10.5, volume: null, interval, exchangeTimezone: 'America/New_York', sessionType: 'regular', provider: 'test-provider', asOf: '2026-07-20T20:00:00.000Z' }],
});

afterEach(() => vi.useRealTimers());

describe('intraday cache and fallback policy', () => {
  it('isolates cache by interval and session mode while deduplicating the same request', async () => {
    const getIntraday = vi.fn(async (_symbol: string, interval: IntradayProviderResult['interval'], sessionMode: IntradayProviderResult['sessionMode']) => result(interval, sessionMode));
    const service = new IntradayMarketDataService([{ id: 'test-provider', getIntraday }]);
    await Promise.all([
      service.getIntraday('RKLB', '5m', '5d', 'regular'),
      service.getIntraday('RKLB', '5m', '5d', 'regular'),
    ]);
    await service.getIntraday('RKLB', '15m', '5d', 'regular');
    await service.getIntraday('RKLB', '5m', '5d', 'extended');
    expect(getIntraday).toHaveBeenCalledTimes(3);
  });

  it('serves a labelled stale fallback after a transient provider failure', async () => {
    vi.useFakeTimers();
    const getIntraday = vi.fn()
      .mockResolvedValueOnce(result('60m', 'regular'))
      .mockRejectedValueOnce(new Error('temporary provider failure'));
    const service = new IntradayMarketDataService([{ id: 'test-provider', getIntraday }]);
    await service.getIntraday('RKLB', '60m', '5d', 'regular');
    vi.advanceTimersByTime(61_000);
    const stale = await service.getIntraday('RKLB', '60m', '5d', 'regular');
    expect(stale.data.status).toBe('stale');
    expect(stale.data.warnings.join(' ')).toMatch(/stale/i);
  });
});
