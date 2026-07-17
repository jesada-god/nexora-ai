import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/src/types/database';
import type { WatchlistItemRecord, WatchlistRecord } from './types';

export class WatchlistRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async ensureDefault(): Promise<string> {
    const { data, error } = await this.client.rpc('get_or_create_default_watchlist');
    if (error || !data) throw error ?? new Error('Default watchlist was not created');
    return data;
  }

  async getDefault(): Promise<WatchlistRecord> {
    const id = await this.ensureDefault();
    const [{ data: watchlist, error: watchlistError }, { data: items, error: itemsError }] = await Promise.all([
      this.client.from('watchlists').select('id, name').eq('id', id).single(),
      this.client.from('watchlist_items').select('id, symbol, created_at').eq('watchlist_id', id).order('created_at', { ascending: false }),
    ]);
    if (watchlistError || !watchlist) throw watchlistError ?? new Error('Watchlist not found');
    if (itemsError) throw itemsError;
    return {
      id: watchlist.id,
      name: watchlist.name,
      items: (items ?? []).map((item) => ({ id: item.id, symbol: item.symbol, createdAt: item.created_at })),
    };
  }

  async add(symbol: string): Promise<WatchlistItemRecord> {
    const watchlistId = await this.ensureDefault();
    const { data, error } = await this.client.from('watchlist_items')
      .insert({ watchlist_id: watchlistId, symbol })
      .select('id, symbol, created_at').single();
    if (error || !data) throw error ?? new Error('Watchlist item was not created');
    return { id: data.id, symbol: data.symbol, createdAt: data.created_at };
  }

  async remove(symbol: string): Promise<boolean> {
    const watchlistId = await this.ensureDefault();
    const { data, error } = await this.client.from('watchlist_items')
      .delete().eq('watchlist_id', watchlistId).eq('symbol', symbol).select('id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async rename(name: string): Promise<void> {
    const watchlistId = await this.ensureDefault();
    const { error } = await this.client.from('watchlists')
      .update({ name, updated_at: new Date().toISOString() }).eq('id', watchlistId);
    if (error) throw error;
  }

  async delete(): Promise<void> {
    const watchlistId = await this.ensureDefault();
    const { error } = await this.client.from('watchlists').delete().eq('id', watchlistId);
    if (error) throw error;
  }
}
