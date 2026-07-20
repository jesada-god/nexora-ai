import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PolygonMarketDataProvider } from './polygon-provider';
import type { ResolvedInstrument } from './contracts';

const instrument: ResolvedInstrument = {
  canonicalSymbol: 'AAPL', providerSymbol: 'AAPL', name: 'Apple Inc.', assetType: 'stock',
  exchange: 'NASDAQ', mic: 'XNAS', currency: 'USD', timezone: 'America/New_York', active: true, supported: true, unsupportedReason: null,
};

function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('PolygonMarketDataProvider', () => {
  it('normalizes quote provenance, recency, and previous close', async () => {
    const timestamp = Date.parse('2026-07-20T14:00:00.000Z');
    const fetcher = vi.fn(async () => json({ status: 'OK', ticker: {
      ticker: 'AAPL', updated: timestamp * 1e6,
      lastTrade: { p: 212, t: timestamp * 1e6 }, prevDay: { c: 210 }, day: { o: 211, h: 213, l: 209, c: 212, v: 1234 },
      todaysChange: 2, todaysChangePerc: 0.95238,
    } }));
    const provider = new PolygonMarketDataProvider('secret', () => new Date(timestamp + 30_000), fetcher as typeof fetch);
    await expect(provider.getQuote(instrument)).resolves.toMatchObject({
      symbol: 'AAPL', price: 212, previousClose: 210, status: 'real-time', delayedByMinutes: 0, provider: 'polygon', volume: 1234,
    });
  });

  it('normalizes, sorts, deduplicates, filters regular-session bars, and preserves real values', async () => {
    const result = (iso: string, close: number) => ({ t: Date.parse(iso), o: close - 1, h: close + 1, l: close - 2, c: close, v: 100, n: 4, vw: close - 0.2 });
    const fetcher = vi.fn(async () => json({ status: 'OK', ticker: 'AAPL', results: [
      result('2026-07-17T13:30:00.000Z', 200),
      result('2026-07-20T13:35:00.000Z', 212),
      result('2026-07-20T13:30:00.000Z', 211),
      result('2026-07-20T13:35:00.000Z', 212.5),
      result('2026-07-20T12:00:00.000Z', 209),
    ] }));
    const provider = new PolygonMarketDataProvider('secret', () => new Date('2026-07-20T14:00:00.000Z'), fetcher as typeof fetch);
    const output = await provider.getBars({ instrument, interval: '5m', range: '1d', adjusted: false, session: 'regular' });
    expect(output.bars).toHaveLength(2);
    expect(output.bars.map((bar) => bar.close)).toEqual([211, 212.5]);
    expect(output.bars[1]).toMatchObject({ volume: 100, transactions: 4, vwap: 212.3 });
    expect(output.firstTimestamp).toBeLessThan(output.lastTimestamp!);
  });

  it('rejects response ticker mismatch and malformed OHLC instead of substituting data', async () => {
    const mismatch = vi.fn(async () => json({ status: 'OK', ticker: 'MSFT', results: [] }));
    await expect(new PolygonMarketDataProvider('secret', undefined, mismatch as typeof fetch).getBars({ instrument, interval: '5m', range: '1d', adjusted: false, session: 'regular' })).rejects.toMatchObject({ code: 'invalid-provider-response' });

    const malformed = vi.fn(async () => json({ status: 'OK', ticker: 'AAPL', results: [{ t: Date.now(), o: 10, h: 5, l: 9, c: 11, v: 100 }] }));
    const output = await new PolygonMarketDataProvider('secret', undefined, malformed as typeof fetch).getBars({ instrument, interval: '5m', range: '1d', adjusted: false, session: 'extended' });
    expect(output.bars).toEqual([]);
    expect(output.warnings[0]).toContain('Rejected invalid Polygon bar');
  });

  it.each([
    [403, {}, 'provider-unauthorized'],
    [429, { 'retry-after': '17' }, 'rate-limited'],
  ] as const)('maps entitlement/rate failures without retry loops (%s)', async (status, headers, code) => {
    const fetcher = vi.fn(async () => json({ message: 'provider rejected request' }, status, headers));
    const provider = new PolygonMarketDataProvider('secret', undefined, fetcher as typeof fetch);
    await expect(provider.getQuote(instrument)).rejects.toMatchObject({ code, ...(status === 429 ? { retryAfterSeconds: 17 } : {}) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('normalizes provider market status by the resolved exchange', async () => {
    const fetcher = vi.fn(async () => json({ market: 'open', serverTime: '2026-07-20T14:00:00.000Z', exchanges: { nasdaq: 'open', nyse: 'open', otc: 'closed' }, earlyHours: false, afterHours: false }));
    const session = await new PolygonMarketDataProvider('secret', () => new Date('2026-07-20T14:01:00.000Z'), fetcher as typeof fetch).getSession(instrument);
    expect(session).toMatchObject({ status: 'open', exchange: 'NASDAQ', timezone: 'America/New_York', provider: 'polygon', source: 'polygon-market-status', stale: false });
  });
});

