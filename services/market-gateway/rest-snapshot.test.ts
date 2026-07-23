import { describe, expect, it, vi } from 'vitest';
import { fetchRestSnapshot } from './rest-snapshot';

/** Build a fake fetch that answers Alpaca REST endpoints by path substring. */
function fakeFetch(routes: Record<string, unknown>, opts: { failPaths?: string[] } = {}): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (opts.failPaths?.some((p) => url.includes(p))) {
      return new Response('nope', { status: 403 });
    }
    const match = Object.keys(routes).find((path) => url.includes(path));
    if (!match) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[match]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const config = (fetchImpl: typeof fetch) => ({ keyId: 'k', secretKey: 's', feed: 'iex' as const, fetchImpl, now: () => 1_000 });

describe('fetchRestSnapshot', () => {
  it('assembles a normalized snapshot from Alpaca latest trade/quote + recent bars', async () => {
    const fetchImpl = fakeFetch({
      '/trades/latest': { symbol: 'RKLB', trade: { t: '2024-01-02T15:04:30Z', p: 69.71, s: 12 } },
      '/quotes/latest': { symbol: 'RKLB', quote: { t: '2024-01-02T15:04:31Z', bp: 69.70, bs: 3, ap: 69.72, as: 4 } },
      '/bars': { symbol: 'RKLB', bars: [
        { t: '2024-01-02T15:04:00Z', o: 69.6, h: 69.8, l: 69.5, c: 69.7, v: 900 },
        { t: '2024-01-02T15:03:00Z', o: 69.4, h: 69.6, l: 69.3, c: 69.5, v: 800 },
      ] },
    });
    const snap = await fetchRestSnapshot('rklb', config(fetchImpl));
    expect(snap?.origin).toBe('rest');
    expect(snap?.trade).toMatchObject({ price: 69.71, symbol: 'RKLB' });
    expect(snap?.quote).toMatchObject({ bidPrice: 69.70, askPrice: 69.72 });
    // Alpaca sort=desc → normalized ascending.
    expect(snap?.bars.map((b) => b.timestampMs)).toEqual([
      Date.parse('2024-01-02T15:03:00Z'),
      Date.parse('2024-01-02T15:04:00Z'),
    ]);
  });

  it('skips the REST bootstrap entirely for the WebSocket-only test feed', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const snap = await fetchRestSnapshot('FAKEPACA', { keyId: 'k', secretKey: 's', feed: 'test', fetchImpl });
    expect(snap).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when every leg fails (e.g. provider 403)', async () => {
    const fetchImpl = fakeFetch({}, { failPaths: ['/trades/latest', '/quotes/latest', '/bars'] });
    expect(await fetchRestSnapshot('RKLB', config(fetchImpl))).toBeNull();
  });

  it('returns a partial snapshot when only some legs succeed', async () => {
    const fetchImpl = fakeFetch(
      { '/bars': { symbol: 'RKLB', bars: [{ t: '2024-01-02T15:03:00Z', o: 1, h: 1, l: 1, c: 1, v: 10 }] } },
      { failPaths: ['/trades/latest', '/quotes/latest'] },
    );
    const snap = await fetchRestSnapshot('RKLB', config(fetchImpl));
    expect(snap?.trade).toBeNull();
    expect(snap?.quote).toBeNull();
    expect(snap?.bars).toHaveLength(1);
  });

  it('sends the Alpaca credentials as server-side headers and the feed query', async () => {
    const spy = fakeFetch({ '/trades/latest': { trade: { t: '2024-01-02T15:04:30Z', p: 1, s: 1 } }, '/quotes/latest': {}, '/bars': {} });
    await fetchRestSnapshot('RKLB', config(spy));
    const call = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const [url, init] = call as [string, RequestInit];
    expect(url).toContain('feed=iex');
    expect((init.headers as Record<string, string>)['APCA-API-KEY-ID']).toBe('k');
    expect((init.headers as Record<string, string>)['APCA-API-SECRET-KEY']).toBe('s');
  });
});
