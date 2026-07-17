import Header from '@/src/components/layout/Header';
import { WatchlistClient } from '@/src/components/watchlist/WatchlistClient';
import { createClient } from '@/src/lib/supabase/server';
import { WatchlistRepository } from '@/src/lib/watchlist/repository';
import { getMarketDataProvider } from '@/src/lib/market-data';
import type { WatchlistQuote } from '@/src/lib/watchlist/types';

const unavailable: WatchlistQuote = {
  quote: null,
  freshness: { status: 'unavailable', asOf: null, maxAgeSeconds: null },
};

export default async function WatchlistPage() {
  const client = await createClient();
  if (!client) return null;
  const watchlist = await new WatchlistRepository(client).getDefault();
  let provider: ReturnType<typeof getMarketDataProvider> | null = null;
  try { provider = getMarketDataProvider(); } catch { provider = null; }
  const entries = await Promise.all(watchlist.items.map(async (item) => {
    if (!provider) return [item.symbol, unavailable] as const;
    try {
      const result = await provider.getQuote(item.symbol);
      return [item.symbol, { quote: result.data, freshness: result.freshness }] as const;
    } catch {
      return [item.symbol, unavailable] as const;
    }
  }));

  return <div className="min-w-0">
    <Header title="Watchlist" subtitle="ติดตาม Symbol ที่คุณสนใจ พร้อมราคาและความสดของข้อมูลล่าสุด" />
    <div className="mx-auto w-full max-w-5xl p-4 md:p-8">
      <WatchlistClient watchlist={watchlist} initialQuotes={Object.fromEntries(entries)} />
    </div>
  </div>;
}
