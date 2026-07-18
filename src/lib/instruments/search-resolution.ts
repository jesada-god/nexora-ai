import type { MarketDataProvider, ProviderResult, SymbolSearchResult } from '@/src/lib/market-data/types';
import type { InstrumentSearchOutcome, InstrumentSearchOptions } from './search';

export async function resolveInstrumentSearch(
  master: InstrumentSearchOutcome,
  getProvider: () => Pick<MarketDataProvider, 'search'>,
  query: string,
  options: InstrumentSearchOptions,
): Promise<ProviderResult<SymbolSearchResult[]>> {
  if (!master.databaseEmpty && master.result) return master.result;
  const fallback = await getProvider().search(query);
  return {
    ...fallback,
    data: fallback.data.filter((item) => !options.assetType || item.assetType === options.assetType).slice(0, options.limit ?? 15),
  };
}
