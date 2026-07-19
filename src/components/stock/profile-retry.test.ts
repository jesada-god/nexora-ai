import { describe, expect, it, vi } from 'vitest';
import { requestCompanyProfile } from './profile-retry';

describe('Company Profile retry', () => {
  it('requests only the Profile endpoint and preserves structured error metadata', async () => {
    const fetcher = vi.fn(async (
      _url: string,
      _init: { headers: { Accept: 'application/json' } },
    ) => new Response(JSON.stringify({
      data: null,
      status: 'unavailable',
      providerUsed: null,
      fallbackUsed: true,
      cachedAt: null,
      retryAfterSeconds: 30,
      reasonCode: 'PRIMARY_RATE_LIMITED; SECONDARY_RATE_LIMITED',
      error: {
        code: 'rate-limited',
        message: 'Profile quota exceeded',
        retryable: true,
        retryAfterSeconds: 30,
      },
      meta: {
        provider: 'test-provider',
        timestamp: '2026-07-20T00:00:00.000Z',
        freshness: {
          status: 'unavailable',
          asOf: null,
          maxAgeSeconds: null,
        },
      },
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }));

    const resource = await requestCompanyProfile('RKLB', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/market/profile/RKLB', {
      headers: { Accept: 'application/json' },
    });
    expect(fetcher.mock.calls[0]?.[0]).not.toContain('/quote/');
    expect(resource.data).toBeNull();
    expect(resource.error).toEqual(expect.objectContaining({
      code: 'rate-limited',
      retryAfterSeconds: 30,
    }));
    expect(resource.retryAfterSeconds).toBe(30);
  });

  it('deduplicates concurrent Retry requests for the same symbol', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => {
      resolve = done;
    }));
    const first = requestCompanyProfile('RKLB', fetcher);
    const second = requestCompanyProfile('RKLB', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify({
      data: {
        symbol: 'RKLB',
        name: 'Rocket Lab USA, Inc.',
        description: null,
        exchange: 'NASDAQ',
        currency: 'USD',
        country: 'US',
        sector: 'Industrials',
        industry: 'Aerospace & Defense',
        website: null,
        marketCapitalization: null,
        employees: null,
        fiscalYearEnd: null,
        latestQuarter: null,
      },
      status: 'fresh',
      providerUsed: 'financial-modeling-prep',
      fallbackUsed: true,
      cachedAt: '2026-07-20T00:00:00.000Z',
      retryAfterSeconds: 60,
      reasonCode: 'PRIMARY_RATE_LIMITED',
      meta: {
        provider: 'financial-modeling-prep',
        timestamp: '2026-07-20T00:00:00.000Z',
        freshness: {
          status: 'cached',
          asOf: null,
          maxAgeSeconds: 86_400,
          cachedAt: '2026-07-20T00:00:00.000Z',
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const [a, b] = await Promise.all([first, second]);
    expect(a.data?.name).toBe('Rocket Lab USA, Inc.');
    expect(b.fallbackUsed).toBe(true);
  });
});
