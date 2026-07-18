import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { serverEnv } from '@/src/config/env/server';
import { SharedRequestCache } from '@/src/lib/shared-request-cache';
import { safeExternalUrl } from './url';
import type { NewsArticle, NewsPage, NewsProvider } from './types';

export type NewsErrorCode = 'configuration-required' | 'rate-limited' | 'timeout' | 'invalid-key' | 'provider-unavailable';
export class NewsProviderError extends Error {
  constructor(readonly code: NewsErrorCode, message: string, readonly retryAfterSeconds?: number) { super(message); this.name = 'NewsProviderError'; }
  get status() { return this.code === 'rate-limited' ? 429 : this.code === 'timeout' ? 504 : this.code === 'invalid-key' ? 502 : 503; }
}

const articleSchema = z.object({
  source: z.object({ name: z.string().nullish() }), title: z.string().nullish(), url: z.string().nullish(),
  urlToImage: z.string().nullish(), publishedAt: z.string().nullish(),
});
const responseSchema = z.object({ status: z.literal('ok'), articles: z.array(articleSchema) });
const errorSchema = z.object({ status: z.literal('error'), code: z.string().optional(), message: z.string().optional() });
const PAGE_SIZE = 10;

function retryAfter(response: Response): number | undefined {
  const value = Number(response.headers.get('retry-after')); return Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
}

export class NewsApiProvider implements NewsProvider {
  readonly id = 'newsapi';
  constructor(private readonly apiKey: string) {}

  private async get(query: string, cursor = '1'): Promise<NewsPage> {
    const page = Math.max(1, Number.parseInt(cursor, 10) || 1);
    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', query); url.searchParams.set('searchIn', 'title,description');
    url.searchParams.set('language', 'en'); url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('pageSize', String(PAGE_SIZE)); url.searchParams.set('page', String(page));
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json', 'X-Api-Key': this.apiKey }, signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) throw new NewsProviderError('timeout', 'News provider timed out');
      throw new NewsProviderError('provider-unavailable', 'Could not reach news provider');
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new NewsProviderError('provider-unavailable', 'News provider returned invalid data'); }
    const providerError = errorSchema.safeParse(payload);
    const code = providerError.success ? providerError.data.code ?? '' : '';
    if (response.status === 429 || /rateLimited|maximumResultsReached/i.test(code)) throw new NewsProviderError('rate-limited', 'News provider rate limit exceeded', retryAfter(response) ?? 60);
    if (response.status === 401 || response.status === 403 || /apiKey/i.test(code)) throw new NewsProviderError('invalid-key', 'News provider rejected its API key');
    if (!response.ok) throw new NewsProviderError('provider-unavailable', 'News provider is temporarily unavailable');
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new NewsProviderError('provider-unavailable', 'News provider returned invalid data');
    const seen = new Set<string>(); const articles: NewsArticle[] = [];
    for (const item of parsed.data.articles) {
      const title = item.title?.trim(); const externalUrl = safeExternalUrl(item.url); const date = item.publishedAt ? new Date(item.publishedAt) : null;
      const key = `${title?.toLowerCase() ?? ''}|${externalUrl ?? ''}`;
      if (!title || !externalUrl || !date || Number.isNaN(date.valueOf()) || seen.has(key)) continue;
      seen.add(key); articles.push({ id: createHash('sha256').update(key).digest('hex').slice(0, 20), title, source: item.source.name?.trim() || new URL(externalUrl).hostname, publishedAt: date.toISOString(), url: externalUrl, imageUrl: safeExternalUrl(item.urlToImage), symbols: [] });
    }
    return { articles, nextCursor: parsed.data.articles.length === PAGE_SIZE ? String(page + 1) : null };
  }
  getMarketNews(cursor?: string) { return this.get('(stock market OR financial markets)', cursor); }
  getSymbolNews(symbol: string, cursor?: string) { return this.get(`(${symbol} AND (stock OR company))`, cursor); }
}

const newsCache = new SharedRequestCache();
let configuredKey: string | undefined; let instance: NewsProvider | undefined;
class CachedNewsProvider implements NewsProvider {
  readonly id: string; constructor(private readonly source: NewsProvider) { this.id = source.id; }
  private async load(key: string, operation: () => Promise<NewsPage>) { return (await newsCache.resolve(key, operation, { freshMs: 5 * 60_000, staleMs: 60 * 60_000, errorMs: 30_000 })).value; }
  getMarketNews(cursor = '1') { return this.load(`market:${cursor}`, () => this.source.getMarketNews(cursor)); }
  getSymbolNews(symbol: string, cursor = '1') { return this.load(`symbol:${symbol}:${cursor}`, () => this.source.getSymbolNews(symbol, cursor)); }
}
export function getNewsProvider(): NewsProvider {
  // Deliberately never borrow ALPHA_VANTAGE_API_KEY: market quota is reserved for market data.
  const key = serverEnv.NEWS_API_KEY;
  if (!key) throw new NewsProviderError('configuration-required', 'News provider configuration is required');
  if (!instance || configuredKey !== key) { configuredKey = key; instance = new CachedNewsProvider(new NewsApiProvider(key)); }
  return instance;
}
