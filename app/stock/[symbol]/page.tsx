import { notFound } from 'next/navigation';
import {
  getHistoricalMarketDataService,
  getMarketDataProvider,
} from '@/src/lib/market-data';
import { symbolSchema } from '@/src/lib/market-data/validation';
import { getFxRate } from '@/src/lib/market-data/fx/service';
import { createClient } from '@/src/lib/supabase/server';
import { WatchlistRepository } from '@/src/lib/watchlist/repository';
import { StockDetailClient } from '@/src/components/stock/StockDetailClient';
import { searchInstrumentMaster } from '@/src/lib/instruments/search';
import { loadStockDetailMarketSnapshot } from '@/src/lib/stock-detail/load';
import type { SymbolSearchResult } from '@/src/lib/market-data/types';
import {
  advancedChartTypesEnabled,
  extendedIndicatorsEnabled,
  fairValueEnabled,
  keyStatisticsEnabled,
  supportResistanceEnabled,
  technicalIndicatorsEnabled,
} from '@/src/config/features';

async function isWatched(symbol: string): Promise<boolean> {
  const client = await createClient();
  if (!client) return false;
  try {
    return (await new WatchlistRepository(client).getDefault())
      .items.some((item) => item.symbol === symbol);
  } catch {
    return false;
  }
}

async function findInstrumentMetadata(symbol: string): Promise<SymbolSearchResult | null> {
  try {
    const outcome = await searchInstrumentMaster(symbol, {
      includeDelisted: true,
      limit: 5,
    });
    return outcome.result?.data.find((item) => item.symbol === symbol) ?? null;
  } catch {
    return null;
  }
}

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const rawSymbol = decodeURIComponent((await params).symbol);
  const parsed = symbolSchema.safeParse(rawSymbol);
  if (!parsed.success) notFound();
  const symbol = parsed.data;

  let provider: ReturnType<typeof getMarketDataProvider> | null = null;
  try {
    provider = getMarketDataProvider();
  } catch {
    // History fallbacks can still provide a verified previous-trading-day quote.
  }

  const [marketResult, fxResult, watchResult, instrumentResult] = await Promise.allSettled([
    loadStockDetailMarketSnapshot(
      symbol,
      provider,
      getHistoricalMarketDataService(),
    ),
    getFxRate('USD', 'THB'),
    isWatched(symbol),
    findInstrumentMetadata(symbol),
  ]);

  if (marketResult.status === 'rejected') {
    throw marketResult.reason;
  }
  const snapshot = marketResult.value;

  return (
    <StockDetailClient
      symbol={symbol}
      quoteResource={snapshot.quote}
      profileResource={snapshot.profile}
      overviewResource={snapshot.overview}
      instrumentCurrency={instrumentResult.status === 'fulfilled'
        ? instrumentResult.value?.currency ?? null
        : null}
      instrumentExchange={instrumentResult.status === 'fulfilled'
        ? instrumentResult.value?.exchange ?? null
        : null}
      initialHistory={snapshot.history}
      fxQuote={fxResult.status === 'fulfilled' ? fxResult.value.quote : null}
      evaluatedAt={new Date().toISOString()}
      providerConfigured={Boolean(provider)}
      initialWatched={watchResult.status === 'fulfilled' ? watchResult.value : false}
      technicalIndicatorsEnabled={technicalIndicatorsEnabled()}
      advancedChartTypesEnabled={advancedChartTypesEnabled()}
      extendedIndicatorsEnabled={extendedIndicatorsEnabled()}
      supportResistanceEnabled={supportResistanceEnabled()}
      keyStatisticsEnabled={keyStatisticsEnabled()}
      fairValueEnabled={fairValueEnabled()}
    />
  );
}
