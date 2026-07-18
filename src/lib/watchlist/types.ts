import type { DataFreshness, Quote } from '@/src/lib/market-data/types';

export interface WatchlistItemRecord {
  id: string;
  symbol: string;
  createdAt: string;
}

export interface WatchlistRecord {
  id: string;
  name: string;
  items: WatchlistItemRecord[];
}

export interface WatchlistQuote {
  quote: Quote | null;
  freshness: DataFreshness;
}

export type WatchlistActionResult =
  | { ok: true; item?: WatchlistItemRecord }
  | { ok: false; code: 'invalid' | 'duplicate' | 'unauthorized' | 'not-found' | 'database' | 'delisted'; message: string };
