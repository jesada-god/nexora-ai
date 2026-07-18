import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/src/types/database';

export async function getInstrumentStatus(client: SupabaseClient<Database>, symbol: string): Promise<'active' | 'delisted' | null> {
  const { data, error } = await client.from('market_instruments').select('status')
    .eq('provider', 'alpha-vantage').eq('symbol', symbol).limit(1).maybeSingle();
  if (error) {
    // Before the migration is applied, legacy provider fallback must remain usable.
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw error;
  }
  return data?.status ?? null;
}

