import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateTechnicalAnalysis } from '../analytics/technical/calculations';
import { MarketDataError } from './errors';
import { HISTORICAL_CACHE_POLICY, HistoricalMarketDataService, type HistoricalProvider } from './historical-service';
import { StooqProviderError } from './providers/stooq/provider';
import type { HistoricalPrices, ProviderResult } from './types';

const data: HistoricalPrices = {
  symbol: 'AAPL', range: '3m', interval: '1d',
  prices: [{ date: '2026-07-17', open: 10, high: 12, low: 9, close: 11, volume: 100 }],
};
const result = (provider: string): ProviderResult<HistoricalPrices> => ({
  data, provider, freshness: { status: 'end-of-day', asOf: '2026-07-17T00:00:00.000Z', maxAgeSeconds: 60 },
});
function provider(id: string, implementation: HistoricalProvider['getHistoricalPrices']): HistoricalProvider {
  return { id, getHistoricalPrices: vi.fn(implementation) };
}

describe('historical OHLCV resilience', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns primary success and does not call fallback', async () => {
    const primary = provider('primary', async () => result('primary'));
    const fallback = provider('fallback', async () => result('fallback'));
    const value = await new HistoricalMarketDataService(primary, fallback).getHistoricalPrices('AAPL', '3m');
    expect(value.provider).toBe('primary');
    expect(value.data).toMatchObject({ providerUsed: 'primary', fallbackReason: null, freshness: 'fresh' });
    expect(fallback.getHistoricalPrices).not.toHaveBeenCalled();
  });

  it('serves a fresh cache hit without another provider call', async () => {
    const primary = provider('primary', async () => result('primary'));
    const service = new HistoricalMarketDataService(primary, provider('fallback', async () => result('fallback')));
    await service.getHistoricalPrices('AAPL', '3m');
    const cached = await service.getHistoricalPrices('AAPL', '3m');
    expect(cached.freshness.status).toBe('cached');
    expect(cached.freshness.cachedAt).toBeTypeOf('string');
    expect(primary.getHistoricalPrices).toHaveBeenCalledTimes(1);
  });

  it('returns stale immediately and revalidates in the background', async () => {
    let now = 1_000;
    const primary = provider('primary', async () => result('primary'));
    const service = new HistoricalMarketDataService(primary, provider('fallback', async () => result('fallback')), () => now);
    await service.getHistoricalPrices('AAPL', '3m');
    now += HISTORICAL_CACHE_POLICY.freshMs + 1;
    const stale = await service.getHistoricalPrices('AAPL', '3m');
    expect(stale.freshness.status).toBe('stale');
    await vi.waitFor(() => expect(primary.getHistoricalPrices).toHaveBeenCalledTimes(2));
  });

  it('returns stale data immediately when the background primary receives 429', async () => {
    let now = 1_000;
    const primary = provider('primary', vi.fn()
      .mockResolvedValueOnce(result('primary'))
      .mockRejectedValueOnce(new MarketDataError('rate-limited', 'quota', 30)));
    const fallback = provider('stooq', async () => { throw new StooqProviderError('FALLBACK_NETWORK_ERROR', 'down', 'upstream-unavailable'); });
    const service = new HistoricalMarketDataService(primary, fallback, () => now);
    await service.getHistoricalPrices('AAPL', '3m');
    now += HISTORICAL_CACHE_POLICY.freshMs + 1;
    const stale = await service.getHistoricalPrices('AAPL', '3m');
    expect(stale.data.freshness).toBe('stale');
    await vi.waitFor(() => expect(fallback.getHistoricalPrices).toHaveBeenCalledTimes(1));
  });

  it('does not retry a 429 and uses fallback once', async () => {
    const primary = provider('primary', async () => { throw new MarketDataError('rate-limited', 'quota', 45); });
    const fallback = provider('fallback', async () => result('fallback'));
    const value = await new HistoricalMarketDataService(primary, fallback).getHistoricalPrices('AAPL', '3m');
    expect(value.provider).toBe('fallback');
    expect(value.data.fallbackReason).toBe('PRIMARY_RATE_LIMITED');
    expect(primary.getHistoricalPrices).toHaveBeenCalledTimes(1);
    expect(fallback.getHistoricalPrices).toHaveBeenCalledTimes(1);
  });

  it('respects Retry-After by skipping primary during its cooldown', async () => {
    let now = 10_000;
    const primary = provider('primary', async () => { throw new MarketDataError('rate-limited', 'quota', 45); });
    const fallback = provider('fallback', async (_symbol, range) => ({ ...result('fallback'), data: { ...data, range } }));
    const service = new HistoricalMarketDataService(primary, fallback, () => now);
    await service.getHistoricalPrices('AAPL', '1m');
    now += 44_000;
    await service.getHistoricalPrices('AAPL', '1y');
    expect(primary.getHistoricalPrices).toHaveBeenCalledTimes(1);
    expect(fallback.getHistoricalPrices).toHaveBeenCalledTimes(2);
  });

  it('returns fallback OHLCV when primary fails', async () => {
    const primary = provider('primary', async () => { throw new MarketDataError('timeout', 'timeout'); });
    const fallback = provider('fallback', async () => result('fallback'));
    expect((await new HistoricalMarketDataService(primary, fallback).getHistoricalPrices('AAPL', '3m')).provider).toBe('fallback');
  });

  it('uses tertiary OHLCV after Stooq fails without retrying primary', async () => {
    const primary = provider('primary', async () => { throw new MarketDataError('rate-limited', 'quota', 30); });
    const stooq = provider('stooq', async () => { throw new StooqProviderError('FALLBACK_INVALID_CONTENT_TYPE', 'html', 'invalid-provider-response'); });
    const nasdaq = provider('nasdaq', async () => result('nasdaq'));
    const service = new HistoricalMarketDataService(primary, stooq, Date.now, nasdaq);
    const value = await service.getHistoricalPrices('AAPL', '3m');
    expect(value).toMatchObject({ provider: 'nasdaq', data: { providerUsed: 'nasdaq', fallbackReason: 'PRIMARY_RATE_LIMITED' } });
    expect(value.data.limitations).toContain('Stooq unavailable: FALLBACK_INVALID_CONTENT_TYPE');
    expect(primary.getHistoricalPrices).toHaveBeenCalledTimes(1);
    expect(stooq.getHistoricalPrices).toHaveBeenCalledTimes(1);
    expect(nasdaq.getHistoricalPrices).toHaveBeenCalledTimes(1);
  });

  it('returns typed unavailable details when both providers fail', async () => {
    const primary = provider('primary', async () => { throw new MarketDataError('rate-limited', 'quota', 30); });
    const fallback = provider('fallback', async () => { throw new StooqProviderError('FALLBACK_NETWORK_ERROR', 'down', 'upstream-unavailable'); });
    const promise = new HistoricalMarketDataService(primary, fallback).getHistoricalPrices('AAPL', '3m');
    await expect(promise).rejects.toMatchObject({ code: 'rate-limited', status: 429, retryable: true, retryAfterSeconds: 30 });
    try { await promise; } catch (cause) {
      const api = (cause as MarketDataError).toApiError();
      expect(api).toMatchObject({ reason: 'PRIMARY_RATE_LIMITED; FALLBACK_NETWORK_ERROR', primaryReason: 'PRIMARY_RATE_LIMITED', fallbackReason: 'FALLBACK_NETWORK_ERROR', retryAfter: 30, lastAvailableAt: null });
    }
  });

  it.each([
    ['timeout', new MarketDataError('timeout', 'timeout'), new StooqProviderError('FALLBACK_NETWORK_ERROR', 'down', 'upstream-unavailable'), 504],
    ['insufficient', new MarketDataError('invalid-provider-response', 'bad'), new StooqProviderError('FALLBACK_INSUFFICIENT_ROWS', 'short', 'insufficient-data', 1), 422],
    ['invalid', new MarketDataError('invalid-provider-response', 'bad'), new StooqProviderError('FALLBACK_INVALID_CSV', 'bad csv', 'invalid-provider-response'), 502],
  ])('maps %s terminal failures to HTTP status %i', async (_label, primaryError, fallbackError, status) => {
    const service = new HistoricalMarketDataService(
      provider('primary', async () => { throw primaryError; }),
      provider('stooq', async () => { throw fallbackError; }),
    );
    await expect(service.getHistoricalPrices('AAPL', '3m')).rejects.toMatchObject({ status });
  });

  it('calculates indicators from returned prices without another provider call', async () => {
    const primary = provider('primary', async () => result('primary'));
    const service = new HistoricalMarketDataService(primary, provider('fallback', async () => result('fallback')));
    const history = await service.getHistoricalPrices('AAPL', '3m');
    calculateTechnicalAnalysis(history.data.prices, { symbol: history.data.symbol, source: history.provider ?? null, freshness: history.freshness });
    expect(primary.getHistoricalPrices).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent calls into one provider request', async () => {
    let complete!: (value: ProviderResult<HistoricalPrices>) => void;
    const primary = provider('primary', () => new Promise((resolve) => { complete = resolve; }));
    const service = new HistoricalMarketDataService(primary, provider('fallback', async () => result('fallback')));
    const first = service.getHistoricalPrices('AAPL', '3m');
    const second = service.getHistoricalPrices('AAPL', '3m');
    expect(primary.getHistoricalPrices).toHaveBeenCalledTimes(1);
    complete(result('primary'));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
