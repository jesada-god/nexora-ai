import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { clientEnv } from '@/src/config/env/client';
import { serverEnv } from '@/src/config/env/server';
import type { Database } from '@/src/types/database';
import { fxQuoteSchema, type FxQuote, type SupportedCurrency } from './types';
import type { FxCacheRepository } from './service';

export function createFxCacheRepository(): FxCacheRepository | null {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async get(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote | null> {
      const { data, error } = await client.from('market_fx_rates').select('*').eq('base_currency', base).eq('quote_currency', quote).maybeSingle();
      if (error) throw new Error(`FX cache read failed: ${error.code}`);
      if (!data) return null;
      return fxQuoteSchema.parse({ base: data.base_currency, quote: data.quote_currency, rate: data.rate, source: data.source, asOf: data.provider_updated_at, fetchedAt: data.fetched_at, cached: true, stale: true });
    },
    async upsert(value: FxQuote): Promise<void> {
      const { error } = await client.from('market_fx_rates').upsert({ base_currency: value.base, quote_currency: value.quote, rate: value.rate, source: value.source, provider_updated_at: value.asOf, fetched_at: value.fetchedAt }, { onConflict: 'base_currency,quote_currency' });
      if (error) throw new Error(`FX cache write failed: ${error.code}`);
    },
  };
}
