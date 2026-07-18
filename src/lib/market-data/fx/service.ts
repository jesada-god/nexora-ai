import { fxQuoteSchema, type FxQuote, type SupportedCurrency } from './types';
import type { FxProvider } from './provider';

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, FxQuote>();
const pending = new Map<string, Promise<FxResult>>();

export interface FxResult { quote: FxQuote | null; unavailable: boolean }
export interface FxCacheRepository {
  get(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote | null>;
  upsert(value: FxQuote): Promise<void>;
}
export interface FxServiceOptions {
  providers?: FxProvider[];
  repository?: FxCacheRepository | null;
  now?: number;
}

async function defaults(): Promise<Required<Pick<FxServiceOptions, 'providers'>> & Pick<FxServiceOptions, 'repository'>> {
  const [{ getFxProviders }, { createFxCacheRepository }] = await Promise.all([import('./configured'), import('./repository')]);
  return { providers: getFxProviders(), repository: createFxCacheRepository() };
}

export async function getFxRate(base: SupportedCurrency, quote: SupportedCurrency, options: FxServiceOptions = {}): Promise<FxResult> {
  if (base === quote) return { quote: null, unavailable: true };
  const key = `${base}:${quote}`;
  const now = options.now ?? Date.now();
  const saved = cache.get(key);
  if (saved && now - Date.parse(saved.fetchedAt) < CACHE_TTL_MS) return { quote: { ...saved, cached: true }, unavailable: saved.stale };
  const existing = pending.get(key);
  if (existing) return existing;

  const request = (async (): Promise<FxResult> => {
    const configured = options.providers === undefined || options.repository === undefined ? await defaults() : null;
    const providers = options.providers ?? configured!.providers;
    const repository = options.repository === undefined ? configured!.repository : options.repository;
    for (const provider of providers) {
      try {
        const live = fxQuoteSchema.parse(await provider.getRate(base, quote));
        cache.set(key, live);
        if (repository) {
          try { await repository.upsert(live); } catch { console.warn(JSON.stringify({ event: 'fx_cache_write_failed', providerUsed: provider.id })); }
        }
        console.info(JSON.stringify({ event: 'fx_rate_resolved', providerUsed: provider.id }));
        return { quote: { ...live, cached: false, stale: false }, unavailable: false };
      } catch {
        console.warn(JSON.stringify({ event: 'fx_provider_failed', providerUsed: provider.id }));
      }
    }
    if (repository) {
      try {
        const persistent = await repository.get(base, quote);
        if (persistent) {
          const stale = fxQuoteSchema.parse({ ...persistent, cached: true, stale: true });
          cache.set(key, stale);
          console.info(JSON.stringify({ event: 'fx_rate_resolved', providerUsed: 'supabase-cache' }));
          return { quote: stale, unavailable: true };
        }
      } catch { console.warn(JSON.stringify({ event: 'fx_cache_read_failed', providerUsed: 'supabase-cache' })); }
    }
    return { quote: null, unavailable: true };
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

export function resetFxCacheForTests() { cache.clear(); pending.clear(); }
