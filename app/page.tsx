import { createClient } from '@/src/lib/supabase/server';
import { PortfolioRepository } from '@/src/lib/portfolio/repository';
import { WatchlistRepository } from '@/src/lib/watchlist/repository';
import { calculatePortfolio } from '@/src/lib/portfolio/calculations';
import { getMarketDataProvider } from '@/src/lib/market-data';
import { getFxRate } from '@/src/lib/market-data/fx/service';
import type { MarketOverview, Quote, DataFreshness } from '@/src/lib/market-data/types';
import { DashboardClient, type DashboardData } from '@/src/components/dashboard/DashboardClient';

const unavailable: DataFreshness = { status: 'unavailable', asOf: null, maxAgeSeconds: null };
export default async function Home() {
  const client = await createClient();
  let portfolio = null; let watchlist = null;
  if (client) {
    const [p, w] = await Promise.allSettled([new PortfolioRepository(client).getDefault(), new WatchlistRepository(client).getDefault()]);
    portfolio = p.status === 'fulfilled' ? p.value : null; watchlist = w.status === 'fulfilled' ? w.value : null;
  }
  let provider: ReturnType<typeof getMarketDataProvider> | null = null;
  try { provider = getMarketDataProvider(); } catch { /* configuration state is rendered below */ }
  const symbols = [...new Set([...(portfolio?.transactions.map((row) => row.symbol).filter(Boolean) ?? []), ...(watchlist?.items.map((row) => row.symbol) ?? [])])] as string[];
  const [quoteEntries, overviewResult, fxResult] = await Promise.all([
    Promise.all(symbols.slice(0, 12).map(async (symbol) => {
      if (!provider) return [symbol, { quote: null, freshness: unavailable }] as const;
      try { const result = await provider.getQuote(symbol); return [symbol, { quote: result.data, freshness: result.freshness }] as const; }
      catch { return [symbol, { quote: null, freshness: unavailable }] as const; }
    })),
    (async () => { if (!provider) return null; try { return await provider.getMarketOverview(); } catch { return null; } })(),
    (async () => { try { return await getFxRate('USD', 'THB'); } catch { return { quote: null, unavailable: true }; } })(),
  ]);
  const quotes = Object.fromEntries(quoteEntries) as Record<string, { quote: Quote | null; freshness: DataFreshness }>;
  const marketPrices = Object.fromEntries(Object.entries(quotes).filter(([, value]) => value.quote).map(([symbol, value]) => [symbol, { price: value.quote!.price, previousClose: value.quote!.previousClose }]));
  const summary = portfolio ? calculatePortfolio(portfolio.transactions, marketPrices) : null;
  const data: DashboardData = { summary, baseCurrency: portfolio?.baseCurrency ?? 'USD', usdThbRate: fxResult.quote?.rate ?? null, watchlist: watchlist?.items ?? [], quotes, overview: (overviewResult?.data ?? null) as MarketOverview | null, overviewFreshness: overviewResult?.freshness ?? unavailable, providerConfigured: Boolean(provider), timestamp: new Date().toISOString() };
  return <DashboardClient data={data} />;
}
