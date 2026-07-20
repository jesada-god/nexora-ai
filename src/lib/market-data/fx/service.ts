import { fxQuoteSchema, type FxQuote, type SupportedCurrency } from './types';
import {
  normalizeFxProviderError,
  type FxProvider,
} from './provider';

export const FX_CACHE_POLICY = {
  freshMs: 15 * 60 * 1000,
  staleMs: 7 * 24 * 60 * 60 * 1000,
};

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

function isAcceptableRate(quote: FxQuote, now: number): boolean {
  const asOf = Date.parse(quote.asOf);
  const age = now - asOf;

  return Number.isFinite(asOf) &&
    age >= -5 * 60 * 1000 &&
    age <= FX_CACHE_POLICY.staleMs;
}

function providerFailureLog(providerUsed: string, error: unknown) {
  const failure = normalizeFxProviderError(error);

  return JSON.stringify({
    event: 'fx_provider_failed',
    providerUsed,
    message: failure.message,
    code: failure.code,
    status: failure.status,
  });
}

function cacheFailureLog(
  event: string,
  code: string,
  message: string,
) {
  return JSON.stringify({
    event,
    providerUsed: 'supabase-cache',
    message,
    code,
    status: null,
  });
}

export async function getFxRate(base: SupportedCurrency, quote: SupportedCurrency, options: FxServiceOptions = {}): Promise<FxResult> {
  if (base === quote) return { quote: null, unavailable: true };
  const key = `${base}:${quote}`;
  const now = options.now ?? Date.now();
  const saved = cache.get(key);
  if (
    saved &&
    now - Date.parse(saved.fetchedAt) < FX_CACHE_POLICY.freshMs &&
    isAcceptableRate(saved, now)
  ) {
    return { quote: { ...saved, cached: true }, unavailable: saved.stale };
  }

  const existing = pending.get(key);
  if (existing) return existing;

  const request = (async (): Promise<FxResult> => {
    const configured = options.providers === undefined || options.repository === undefined ? await defaults() : null;
    const providers = options.providers ?? configured!.providers;
    const repository = options.repository === undefined ? configured!.repository : options.repository;
    for (const provider of providers) {
      try {
        const live = fxQuoteSchema.parse(await provider.getRate(base, quote));

        if (!isAcceptableRate(live, now)) {
          throw new Error('FX provider returned an expired rate');
        }

        cache.set(key, live);
        if (repository) {
          try {
            await repository.upsert(live);
          } catch {
            console.warn(
              cacheFailureLog(
                'fx_cache_write_failed',
                'cache-write-failed',
                'FX cache write failed',
              ),
            );
          }
        }
        console.info(JSON.stringify({ event: 'fx_rate_resolved', providerUsed: provider.id }));
        return { quote: { ...live, cached: false, stale: false }, unavailable: false };
      } catch (error) {
        console.warn(providerFailureLog(provider.id, error));
      }
    }
    if (repository) {
      try {
        const persistent = await repository.get(base, quote);
        if (persistent && isAcceptableRate(persistent, now)) {
          const stale = fxQuoteSchema.parse({ ...persistent, cached: true, stale: true });
          cache.set(key, stale);
          console.info(JSON.stringify({ event: 'fx_rate_resolved', providerUsed: 'supabase-cache' }));
          return { quote: stale, unavailable: true };
        }

        if (persistent) {
          console.warn(
            cacheFailureLog(
              'fx_cache_rejected',
              'stale-cache-expired',
              'Cached FX rate is older than the accepted stale window',
            ),
          );
        }
      } catch {
        console.warn(
          cacheFailureLog(
            'fx_cache_read_failed',
            'cache-read-failed',
            'FX cache read failed',
          ),
        );
      }
    }
    return { quote: null, unavailable: true };
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

export function resetFxCacheForTests() { cache.clear(); pending.clear(); }
