import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NewsProvider, NewsProviderResult } from '@/src/lib/news/types';
import { NewsProviderError } from '@/src/lib/news/provider';
import { handleNewsRequest } from '@/src/lib/news/route';

vi.mock('server-only', () => ({}));

const now = () => new Date('2026-07-20T04:00:00.000Z');
const providerResult: NewsProviderResult = {
  data: { articles: [], nextCursor: null },
  status: 'live',
  asOf: '2026-07-20T03:59:00.000Z',
};
const provider: NewsProvider = {
  id: 'newsapi',
  getMarketNews: vi.fn(async () => providerResult),
  getSymbolNews: vi.fn(),
};

describe('GET /api/news', () => {
  it('returns the same envelope shape on success', async () => {
    const log = vi.fn();
    const response = await handleNewsRequest(
      new NextRequest('https://nexora.example/api/news'),
      { getProvider: () => provider, now, log },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { articles: [], nextCursor: null },
      error: null,
      meta: {
        provider: 'newsapi',
        timestamp: '2026-07-20T04:00:00.000Z',
        asOf: '2026-07-20T03:59:00.000Z',
        status: 'live',
      },
    });
    expect(log).toHaveBeenCalledWith({
      route: '/api/news',
      provider: 'newsapi',
      code: 'OK',
      status: 200,
      retryable: false,
    });
  });

  it('maps missing configuration to the required 503 code without leaking details', async () => {
    const log = vi.fn();
    const response = await handleNewsRequest(
      new NextRequest('https://nexora.example/api/news'),
      {
        getProvider: () => {
          throw new NewsProviderError(
            'NEWS_PROVIDER_NOT_CONFIGURED',
            'News provider is not configured',
          );
        },
        now,
        log,
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      data: null,
      error: {
        code: 'NEWS_PROVIDER_NOT_CONFIGURED',
        retryable: false,
      },
      meta: {
        provider: null,
        status: 'unavailable',
        asOf: null,
      },
    });
    expect(Object.keys(payload).sort()).toEqual(['data', 'error', 'meta']);
    expect(log).toHaveBeenCalledWith({
      route: '/api/news',
      provider: null,
      code: 'NEWS_PROVIDER_NOT_CONFIGURED',
      status: 503,
      retryable: false,
    });
  });

  it('preserves rate-limit status and Retry-After', async () => {
    const limitedProvider: NewsProvider = {
      ...provider,
      getMarketNews: vi.fn(async () => {
        throw new NewsProviderError(
          'NEWS_PROVIDER_RATE_LIMITED',
          'News provider rate limit exceeded',
          90,
        );
      }),
    };
    const response = await handleNewsRequest(
      new NextRequest('https://nexora.example/api/news'),
      { getProvider: () => limitedProvider, now, log: vi.fn() },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('90');
    expect(await response.json()).toMatchObject({
      error: {
        code: 'NEWS_PROVIDER_RATE_LIMITED',
        retryAfterSeconds: 90,
      },
    });
  });
});
