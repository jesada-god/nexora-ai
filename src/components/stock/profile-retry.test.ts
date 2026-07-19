import { describe, expect, it, vi } from 'vitest';
import { requestCompanyProfile } from './profile-retry';

describe('Company Profile retry', () => {
  it('requests only the Profile endpoint and preserves structured error metadata', async () => {
    const fetcher = vi.fn(async (
      _url: string,
      _init: { headers: { Accept: 'application/json' } },
    ) => new Response(JSON.stringify({
      data: null,
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
  });
});
