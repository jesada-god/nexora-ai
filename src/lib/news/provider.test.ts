import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedRequestCache } from '@/src/lib/shared-request-cache';
import type { NewsProvider, NewsProviderResult } from './types';
import {
  CachedNewsProvider,
  NewsApiProvider,
} from './provider';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-07-20T04:00:00.000Z');
const providerResult: NewsProviderResult = {
  data: {
    articles: [{
      id: 'article-1',
      title: 'Markets advance',
      source: 'Example',
      publishedAt: '2026-07-20T03:30:00.000Z',
      url: 'https://example.com/markets',
      imageUrl: null,
      symbols: [],
    }],
    nextCursor: null,
  },
  status: 'live',
  asOf: NOW.toISOString(),
};

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NewsApiProvider', () => {
  it('normalizes a successful provider response without putting the key in the URL', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({
      status: 'ok',
      articles: [{
        source: { name: 'Example' },
        title: 'Markets advance',
        url: 'https://example.com/markets',
        urlToImage: null,
        publishedAt: '2026-07-20T03:30:00Z',
      }],
    }));

    const result = await new NewsApiProvider(
      'private-key',
      fetcher,
      () => NOW,
    ).getMarketNews();

    expect(result).toMatchObject({
      status: 'live',
      asOf: NOW.toISOString(),
      data: { articles: [{ title: 'Markets advance' }] },
    });
    expect(String(fetcher.mock.lastCall?.[0])).not.toContain('private-key');
  });

  it.each([
    {
      name: 'invalid key',
      response: jsonResponse({ status: 'error', code: 'apiKeyInvalid' }, 401),
      expected: { code: 'NEWS_PROVIDER_INVALID_KEY', status: 502 },
    },
    {
      name: 'rate limit',
      response: jsonResponse(
        { status: 'error', code: 'rateLimited' },
        429,
        { 'Retry-After': '45' },
      ),
      expected: {
        code: 'NEWS_PROVIDER_RATE_LIMITED',
        status: 429,
        retryAfterSeconds: 45,
      },
    },
  ])('maps $name separately', async ({ response, expected }) => {
    const provider = new NewsApiProvider(
      'private-key',
      vi.fn(async () => response) as typeof fetch,
      () => NOW,
    );
    await expect(provider.getMarketNews()).rejects.toMatchObject(expected);
  });

  it.each([
    {
      name: 'timeout',
      cause: Object.assign(new Error('slow'), { name: 'TimeoutError' }),
      expected: { code: 'NEWS_PROVIDER_TIMEOUT', status: 502 },
    },
    {
      name: 'upstream failure',
      cause: new TypeError('network failed'),
      expected: { code: 'NEWS_PROVIDER_UPSTREAM_FAILURE', status: 502 },
    },
  ])('maps $name to a retryable 502', async ({ cause, expected }) => {
    const provider = new NewsApiProvider(
      'private-key',
      vi.fn(async () => { throw cause; }) as typeof fetch,
      () => NOW,
    );
    await expect(provider.getMarketNews()).rejects.toMatchObject({
      ...expected,
      retryable: true,
    });
  });
});

describe('CachedNewsProvider', () => {
  it('returns last-known data as stale when refresh fails inside the stale window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const source: NewsProvider = {
      id: 'newsapi',
      getMarketNews: vi.fn()
        .mockResolvedValueOnce(providerResult)
        .mockRejectedValueOnce(new Error('upstream failed')),
      getSymbolNews: vi.fn(),
    };
    const provider = new CachedNewsProvider(source, new SharedRequestCache());

    await expect(provider.getMarketNews()).resolves.toMatchObject({ status: 'live' });
    await expect(provider.getMarketNews()).resolves.toMatchObject({ status: 'cached' });

    vi.setSystemTime(new Date(NOW.valueOf() + 6 * 60_000));
    await expect(provider.getMarketNews()).resolves.toMatchObject({
      status: 'stale',
      asOf: NOW.toISOString(),
      data: providerResult.data,
    });
  });
});
