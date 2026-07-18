import 'server-only';
import { serverEnv } from '@/src/config/env/server';
import { MarketDataError } from './errors';
import type { MarketDataProvider } from './types';
import { AlphaVantageProvider } from './providers/alpha-vantage/provider';
import { SharedRequestCache } from '@/src/lib/shared-request-cache';
import type { CompanyProfile, HistoricalPrices, HistoricalRange, MarketOverview, ProviderResult, Quote, SymbolSearchResult } from './types';

export const MARKET_DATA_PROVIDER_ID = 'alpha-vantage';
const cache = new SharedRequestCache();
let providerKey: string | undefined;
let providerInstance: MarketDataProvider | undefined;

function cachedResult<T>(result: ProviderResult<T>, stale: boolean): ProviderResult<T> {
  return stale ? { ...result, freshness: { ...result.freshness, status: 'cached' } } : result;
}

class CachedMarketDataProvider implements MarketDataProvider {
  readonly id: string;
  constructor(private readonly source: MarketDataProvider) { this.id = source.id; }
  private async get<T>(key: string, operation: () => Promise<ProviderResult<T>>, freshMs: number, staleMs: number) {
    const result = await cache.resolve(key, operation, { freshMs, staleMs, errorMs: 30_000 });
    return cachedResult(result.value, result.state === 'stale' || result.state === 'cache');
  }
  search(query: string): Promise<ProviderResult<SymbolSearchResult[]>> { return this.get(`search:${query}`, () => this.source.search(query), 3_600_000, 3_600_000); }
  getQuote(symbol: string): Promise<ProviderResult<Quote>> { return this.get(`quote:${symbol}`, () => this.source.getQuote(symbol), 60_000, 15 * 60_000); }
  getHistoricalPrices(symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>> { return this.get(`history:${symbol}:${range}`, () => this.source.getHistoricalPrices(symbol, range), 15 * 60_000, 24 * 60 * 60_000); }
  getCompanyProfile(symbol: string): Promise<ProviderResult<CompanyProfile>> { return this.get(`profile:${symbol}`, () => this.source.getCompanyProfile(symbol), 24 * 60 * 60_000, 7 * 24 * 60 * 60_000); }
  getMarketOverview(): Promise<ProviderResult<MarketOverview>> { return this.get('overview', () => this.source.getMarketOverview(), 5 * 60_000, 30 * 60_000); }
}

export function getMarketDataProvider(): MarketDataProvider {
  if (!serverEnv.ALPHA_VANTAGE_API_KEY) {
    throw new MarketDataError(
      'provider-not-configured',
      'Market data provider is not configured',
    );
  }
  if (!providerInstance || providerKey !== serverEnv.ALPHA_VANTAGE_API_KEY) {
    providerKey = serverEnv.ALPHA_VANTAGE_API_KEY;
    providerInstance = new CachedMarketDataProvider(new AlphaVantageProvider(providerKey));
  }
  return providerInstance;
}

export type {
  CompanyProfile,
  DataFreshness,
  HistoricalPrice,
  HistoricalPrices,
  HistoricalRange,
  MarketDataEnvelope,
  MarketDataProvider,
  MarketOverview,
  Quote,
  SymbolSearchResult,
} from './types';
