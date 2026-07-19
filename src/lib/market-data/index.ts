import 'server-only';
import { serverEnv } from '@/src/config/env/server';
import { MarketDataError } from './errors';
import type { MarketDataProvider } from './types';
import { AlphaVantageProvider } from './providers/alpha-vantage/provider';
import { StooqHistoricalProvider } from './providers/stooq/provider';
import { NasdaqHistoricalProvider } from './providers/nasdaq/provider';
import { HistoricalMarketDataService, type HistoricalProvider } from './historical-service';
import { SharedRequestCache } from '@/src/lib/shared-request-cache';
import type { CompanyProfile, HistoricalPrices, HistoricalRange, MarketOverview, ProviderResult, Quote, SymbolSearchResult } from './types';

export const MARKET_DATA_PROVIDER_ID = 'alpha-vantage';
const cache = new SharedRequestCache();
let providerKey: string | undefined;
let providerInstance: MarketDataProvider | undefined;
let historicalProviderKey: string | undefined;
let historicalService: HistoricalMarketDataService | undefined;

function cachedResult<T>(
  result: ProviderResult<T>,
  state: 'fresh' | 'cache' | 'stale',
  storedAt: number,
): ProviderResult<T> {
  return {
    ...result,
    freshness: {
      ...result.freshness,
      status: state === 'fresh'
        ? result.freshness.status
        : state === 'stale' ? 'stale' : 'cached',
      cachedAt: new Date(storedAt).toISOString(),
    },
  };
}

function profileErrorFields(cause: unknown): {
  errorCode: string | null;
  retryable: boolean;
} {
  if (cause instanceof MarketDataError) {
    return { errorCode: cause.code, retryable: cause.retryable };
  }
  return cause
    ? { errorCode: 'internal-error', retryable: true }
    : { errorCode: null, retryable: false };
}

function logProfileCache(input: {
  symbol: string;
  state: 'fresh' | 'cache' | 'stale' | 'error';
  cause?: unknown;
  storedAt?: number;
}): void {
  const error = profileErrorFields(input.cause);
  const entry = {
    event: 'market_profile_cache',
    symbol: input.symbol,
    provider: MARKET_DATA_PROVIDER_ID,
    cache: input.state === 'cache' || input.state === 'stale' ? 'hit' : 'miss',
    cacheState: input.state,
    errorCode: error.errorCode,
    retryable: error.retryable,
    timestamp: new Date().toISOString(),
    cachedAt: input.storedAt ? new Date(input.storedAt).toISOString() : null,
  };
  if (input.cause) console.warn(JSON.stringify(entry));
  else console.info(JSON.stringify(entry));
}

class CachedMarketDataProvider implements MarketDataProvider {
  readonly id: string;
  constructor(private readonly source: MarketDataProvider) { this.id = source.id; }
  private async get<T>(key: string, operation: () => Promise<ProviderResult<T>>, freshMs: number, staleMs: number) {
    const result = await cache.resolve(key, operation, { freshMs, staleMs, errorMs: 30_000 });
    return cachedResult(result.value, result.state, result.storedAt);
  }
  search(query: string): Promise<ProviderResult<SymbolSearchResult[]>> { return this.get(`search:${query}`, () => this.source.search(query), 3_600_000, 3_600_000); }
  getQuote(symbol: string): Promise<ProviderResult<Quote>> { return this.get(`quote:${symbol}`, () => this.source.getQuote(symbol), 60_000, 15 * 60_000); }
  getHistoricalPrices(symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>> { return this.get(`history:${symbol}:${range}`, () => this.source.getHistoricalPrices(symbol, range), 15 * 60_000, 24 * 60 * 60_000); }
  async getCompanyProfile(symbol: string): Promise<ProviderResult<CompanyProfile>> {
    try {
      const result = await cache.resolve(
        `profile:${symbol}`,
        () => this.source.getCompanyProfile(symbol),
        { freshMs: 24 * 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000, errorMs: 30_000 },
      );
      logProfileCache({
        symbol,
        state: result.state,
        cause: result.error,
        storedAt: result.storedAt,
      });
      return cachedResult(result.value, result.state, result.storedAt);
    } catch (cause) {
      logProfileCache({ symbol, state: 'error', cause });
      throw cause;
    }
  }
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

class UnconfiguredHistoricalProvider implements HistoricalProvider {
  readonly id = MARKET_DATA_PROVIDER_ID;
  async getHistoricalPrices(): Promise<never> {
    throw new MarketDataError('provider-not-configured', 'Primary market data provider is not configured');
  }
}

export function getHistoricalMarketDataService(): HistoricalMarketDataService {
  const key = serverEnv.ALPHA_VANTAGE_API_KEY;
  if (!historicalService || historicalProviderKey !== key) {
    historicalProviderKey = key;
    const primary = key ? new AlphaVantageProvider(key) : new UnconfiguredHistoricalProvider();
    historicalService = new HistoricalMarketDataService(
      primary,
      new StooqHistoricalProvider(),
      Date.now,
      new NasdaqHistoricalProvider(),
    );
  }
  return historicalService;
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
