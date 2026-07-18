import { notFound } from 'next/navigation';
import { symbolSchema } from '@/src/lib/market-data/validation';
import { getMarketDataProvider } from '@/src/lib/market-data';
import { createClient } from '@/src/lib/supabase/server';
import { WatchlistRepository } from '@/src/lib/watchlist/repository';
import { StockDetailClient } from '@/src/components/stock/StockDetailClient';
import type { CompanyProfile, DataFreshness, MarketOverview, Quote } from '@/src/lib/market-data/types';
import { technicalIndicatorsEnabled } from '@/src/config/features';

const unavailable: DataFreshness = { status: 'unavailable', asOf: null, maxAgeSeconds: null };
export default async function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const raw = decodeURIComponent((await params).symbol); const parsed = symbolSchema.safeParse(raw); if (!parsed.success) notFound(); const symbol = parsed.data;
  let provider: ReturnType<typeof getMarketDataProvider> | null = null; try { provider = getMarketDataProvider(); } catch { /* rendered as configuration state */ }
  let quote: Quote | null = null; let profile: CompanyProfile | null = null; let overview: MarketOverview | null = null; let freshness = unavailable;
  if (provider) {
    const [q, p, o] = await Promise.allSettled([provider.getQuote(symbol), provider.getCompanyProfile(symbol), provider.getMarketOverview()]);
    if (q.status === 'fulfilled') { quote = q.value.data; freshness = q.value.freshness; }
    if (p.status === 'fulfilled') profile = p.value.data;
    if (o.status === 'fulfilled') overview = o.value.data;
  }
  let watched = false; const client = await createClient();
  if (client) { try { watched = (await new WatchlistRepository(client).getDefault()).items.some((item) => item.symbol === symbol); } catch { /* optional CTA state */ } }
  return <StockDetailClient symbol={symbol} quote={quote} profile={profile} overview={overview} freshness={freshness} providerConfigured={Boolean(provider)} initialWatched={watched} technicalIndicatorsEnabled={technicalIndicatorsEnabled()} />;
}
