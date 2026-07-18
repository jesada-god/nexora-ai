import { createClient } from '@supabase/supabase-js';
import { AlphaVantageFxProvider, FrankfurterFxProvider } from '../src/lib/market-data/fx/provider.ts';
import { getFxRate, type FxCacheRepository } from '../src/lib/market-data/fx/service.ts';
import type { FxQuote, SupportedCurrency } from '../src/lib/market-data/fx/types.ts';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const repository: FxCacheRepository = {
    async get(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote | null> {
      const { data, error } = await client.from('market_fx_rates').select('*').eq('base_currency', base).eq('quote_currency', quote).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { base, quote, rate: String(data.rate), source: data.source, asOf: data.provider_updated_at, fetchedAt: data.fetched_at, cached: true, stale: true };
    },
    async upsert(value: FxQuote): Promise<void> {
      const { error } = await client.from('market_fx_rates').upsert({ base_currency: value.base, quote_currency: value.quote, rate: value.rate, source: value.source, provider_updated_at: value.asOf, fetched_at: value.fetchedAt }, { onConflict: 'base_currency,quote_currency' });
      if (error) throw error;
    },
  };
  const providers = [
    ...(process.env.ALPHA_VANTAGE_API_KEY ? [new AlphaVantageFxProvider(process.env.ALPHA_VANTAGE_API_KEY)] : []),
    new FrankfurterFxProvider(),
  ];
  const result = await getFxRate('USD', 'THB', { providers, repository });
  if (!result.quote || result.quote.stale) throw new Error('No live USD/THB rate was available to seed');
  process.stdout.write(`${JSON.stringify({ event: 'fx_seed_complete', pair: 'USD/THB', providerUsed: result.quote.source, asOf: result.quote.asOf })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: 'fx_seed_error', message: error instanceof Error ? error.message : 'Unknown error' })}\n`);
  process.exitCode = 1;
});
