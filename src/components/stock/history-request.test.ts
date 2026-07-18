import { describe, expect, it, vi } from 'vitest';
import type { HistoricalRange } from '@/src/lib/market-data/types';
import { canRetryHistory, HistoryRequestClient, HistoryRequestSession, type HistoryResponse } from './history-request';

function response(code?: string): HistoryResponse {
  return {
    data: code ? null : { symbol: 'RKLB', range: '3m', interval: '1d', prices: [] },
    ...(code ? { error: { code: code as 'rate-limited', message: code, retryable: true, retryAfterSeconds: 30 } } : {}),
    meta: { provider: 'test', timestamp: '2026-07-18T00:00:00.000Z', freshness: { status: code ? 'unavailable' : 'cached', asOf: null, maxAgeSeconds: 60 } },
  };
}
function jsonResult(value: HistoryResponse) { return { json: async () => value }; }

describe('chart history request coordination', () => {
  it('clicking Retry once creates one fetch', async () => {
    const fetcher = vi.fn(async () => jsonResult(response())); const session = new HistoryRequestSession(new HistoryRequestClient(fetcher));
    await session.begin('RKLB', '3m', true).promise; expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('double click while loading creates one fetch', async () => {
    let resolve!: (value: { json(): Promise<HistoryResponse> }) => void;
    const fetcher = vi.fn(() => new Promise<{ json(): Promise<HistoryResponse> }>((done) => { resolve = done; }));
    const session = new HistoryRequestSession(new HistoryRequestClient(fetcher)); const first = session.begin('RKLB', '3m', true); const second = session.begin('RKLB', '3m', true);
    expect(first.promise).toBe(second.promise); expect(fetcher).toHaveBeenCalledTimes(1); resolve(jsonResult(response())); await first.promise;
  });

  it('429 does not auto-retry', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => jsonResult(response('rate-limited'))); const session = new HistoryRequestSession(new HistoryRequestClient(fetcher));
    await session.begin('RKLB', '3m', true).promise; await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(1); vi.useRealTimers();
  });

  it('keeps acceptable client cache as stale when the server is unavailable', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResult(response()))
      .mockResolvedValueOnce(jsonResult(response('rate-limited')));
    const client = new HistoryRequestClient(fetcher);
    const firstController = new AbortController();
    await client.request('RKLB', '3m', { signal: firstController.signal });
    const stale = await client.request('RKLB', '3m', { force: true, signal: new AbortController().signal });
    expect(stale.data).not.toBeNull();
    expect(stale.meta.freshness.status).toBe('stale');
    expect(stale.meta.timestamp).toBe('2026-07-18T00:00:00.000Z');
  });

  it('cooldown expiry only enables Retry and does not fetch by itself', async () => {
    const fetcher = vi.fn(async () => jsonResult(response())); const session = new HistoryRequestSession(new HistoryRequestClient(fetcher)); const deadline = 30_000;
    expect(canRetryHistory(deadline, 29_999, false)).toBe(false); expect(canRetryHistory(deadline, 30_000, false)).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    await session.begin('RKLB', '3m', true).promise; expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('changing range aborts the old browser request', async () => {
    const signals: AbortSignal[] = []; const resolvers: Array<(value: { json(): Promise<HistoryResponse> }) => void> = [];
    const fetcher = vi.fn((_url: string, init: { signal: AbortSignal }) => { signals.push(init.signal); return new Promise<{ json(): Promise<HistoryResponse> }>((done) => resolvers.push(done)); });
    const session = new HistoryRequestSession(new HistoryRequestClient(fetcher)); session.begin('RKLB', '3m'); session.begin('RKLB', '1y' as HistoricalRange); await Promise.resolve();
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false); resolvers.forEach((done) => done(jsonResult(response())));
  });

  it('Strict Mode setup-cleanup-setup reuses the same in-flight request', async () => {
    let resolve!: (value: { json(): Promise<HistoryResponse> }) => void; const fetcher = vi.fn(() => new Promise<{ json(): Promise<HistoryResponse> }>((done) => { resolve = done; }));
    const session = new HistoryRequestSession(new HistoryRequestClient(fetcher)); session.begin('RKLB', '3m', true); session.cancel(); const second = session.begin('RKLB', '3m', true);
    await Promise.resolve(); expect(fetcher).toHaveBeenCalledTimes(1); resolve(jsonResult(response())); await second.promise;
  });
});
