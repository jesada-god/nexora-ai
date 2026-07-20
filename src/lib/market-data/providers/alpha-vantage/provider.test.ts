import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlphaVantageProvider } from './provider';

vi.mock('server-only', () => ({}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlphaVantageProvider response validation', () => {
  it('keeps a GLOBAL_QUOTE date separate from timestamp freshness', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      'Global Quote': {
        '01. symbol': 'RKLB',
        '05. price': '51.23',
        '07. latest trading day': '2026-07-17',
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    })));

    const result = await new AlphaVantageProvider('secret').getQuote('RKLB');

    expect(result.data.latestTradingDay).toBe('2026-07-17');
    expect(result.freshness).toMatchObject({
      status: 'end-of-day',
      asOf: null,
    });
  });

  it('does not retry a 429 response and preserves Retry-After', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ Note: 'API rate limit reached' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
      },
    ));
    vi.stubGlobal('fetch', fetcher);
    await expect(new AlphaVantageProvider('secret').getQuote('RKLB')).rejects.toMatchObject({
      code: 'rate-limited',
      retryAfterSeconds: 30,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects non-JSON content before parsing it', async () => {
    const fetcher = vi.fn(async () => new Response('<html>challenge</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));
    vi.stubGlobal('fetch', fetcher);
    await expect(new AlphaVantageProvider('secret').getQuote('RKLB')).rejects.toMatchObject({
      code: 'invalid-provider-response',
    });
  });

  it('rejects an empty daily history payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      'Meta Data': { '2. Symbol': 'RKLB' },
      'Time Series (Daily)': {},
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    await expect(new AlphaVantageProvider('secret').getHistoricalPrices('RKLB', '3m'))
      .rejects.toMatchObject({ code: 'insufficient-data' });
  });
});
