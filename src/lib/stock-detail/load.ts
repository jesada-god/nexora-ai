import { MarketDataError } from '@/src/lib/market-data/errors';
import type {
  CompanyProfile,
  DataFreshness,
  HistoricalPrices,
  MarketDataApiError,
  MarketDataProvider,
  MarketOverview,
  ProviderResult,
  Quote,
} from '@/src/lib/market-data/types';
import type {
  InitialHistoryResponse,
  SettledProviderResult,
  StockDetailMarketSnapshot,
  StockDetailQuoteResource,
  StockDetailResource,
} from './types';

interface HistoryLoader {
  getHistoricalPrices(
    symbol: string,
    range: '3m',
  ): Promise<ProviderResult<HistoricalPrices>>;
}

const unavailableFreshness: DataFreshness = {
  status: 'unavailable',
  asOf: null,
  maxAgeSeconds: null,
};

function failure(cause: unknown): { error: MarketDataApiError; reason: string } {
  const error = cause instanceof MarketDataError
    ? cause
    : new MarketDataError('upstream-unavailable', 'The requested data is temporarily unavailable');
  return {
    error: error.toApiError(),
    reason: `${error.code}: ${error.message}`,
  };
}

function unavailable<T>(cause: unknown): StockDetailResource<T> {
  const failed = failure(cause);
  return {
    data: null,
    freshness: unavailableFreshness,
    provider: null,
    reason: failed.reason,
    error: failed.error,
  };
}

function resource<T>(
  result: SettledProviderResult<T>,
  defaultProvider: string,
): StockDetailResource<T> {
  if (result.status === 'rejected') return unavailable<T>(result.reason);
  const profileMetadata = result.value as ProviderResult<T> & {
    fallbackUsed?: boolean;
    retryAfterSeconds?: number;
    reasonCode?: string | null;
  };
  return {
    data: result.value.data,
    freshness: result.value.freshness,
    provider: result.value.provider ?? defaultProvider,
    reason: null,
    error: null,
    fallbackUsed: profileMetadata.fallbackUsed,
    retryAfterSeconds: profileMetadata.retryAfterSeconds,
    reasonCode: profileMetadata.reasonCode,
  };
}

function historyResponse(
  result: SettledProviderResult<HistoricalPrices>,
  defaultProvider: string,
  timestamp: string,
): InitialHistoryResponse {
  if (result.status === 'fulfilled') {
    return {
      data: result.value.data,
      meta: {
        provider: result.value.provider ?? defaultProvider,
        timestamp,
        freshness: result.value.freshness,
      },
    };
  }
  const failed = failure(result.reason);
  return {
    data: null,
    error: failed.error,
    meta: {
      provider: null,
      timestamp,
      freshness: unavailableFreshness,
    },
  };
}

function quoteFreshnessFromHistory(result: ProviderResult<HistoricalPrices>, latestDate: string): DataFreshness {
  const status = result.freshness.status === 'realtime'
    ? 'end-of-day'
    : result.freshness.status;
  return {
    ...result.freshness,
    status,
    asOf: new Date(`${latestDate}T00:00:00.000Z`).toISOString(),
  };
}

export function resolveQuoteResource(
  quoteResult: SettledProviderResult<Quote>,
  historyResult: SettledProviderResult<HistoricalPrices>,
  defaultProvider: string,
): StockDetailQuoteResource {
  if (quoteResult.status === 'fulfilled') {
    return {
      ...resource(quoteResult, defaultProvider),
      fallbackLabel: null,
    };
  }

  if (historyResult.status === 'fulfilled') {
    const latest = historyResult.value.data.prices.at(-1);
    if (latest) {
      const failed = failure(quoteResult.reason);
      return {
        data: {
          symbol: historyResult.value.data.symbol,
          price: latest.close,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          previousClose: null,
          change: null,
          changePercent: null,
          volume: latest.volume,
          latestTradingDay: latest.date,
        },
        freshness: quoteFreshnessFromHistory(historyResult.value, latest.date),
        provider: historyResult.value.provider ?? defaultProvider,
        reason: failed.reason,
        error: failed.error,
        fallbackLabel: 'Previous trading day',
      };
    }
  }

  return {
    ...unavailable<Quote>(quoteResult.reason),
    fallbackLabel: null,
  };
}

export async function loadStockDetailMarketSnapshot(
  symbol: string,
  provider: MarketDataProvider | null,
  historyProvider: HistoryLoader,
  now: () => Date = () => new Date(),
): Promise<StockDetailMarketSnapshot> {
  const notConfigured = new MarketDataError(
    'provider-not-configured',
    'Market data provider is not configured',
  );
  const quotePromise = provider ? provider.getQuote(symbol) : Promise.reject(notConfigured);
  const profilePromise = provider ? provider.getCompanyProfile(symbol) : Promise.reject(notConfigured);
  const overviewPromise = provider ? provider.getMarketOverview() : Promise.reject(notConfigured);
  const historyPromise = historyProvider.getHistoricalPrices(symbol, '3m');

  const settled = await Promise.allSettled([
    quotePromise,
    profilePromise,
    overviewPromise,
    historyPromise,
  ]);
  const quoteResult = settled[0] as SettledProviderResult<Quote>;
  const profileResult = settled[1] as SettledProviderResult<CompanyProfile>;
  const overviewResult = settled[2] as SettledProviderResult<MarketOverview>;
  const historyResult = settled[3] as SettledProviderResult<HistoricalPrices>;
  const timestamp = now().toISOString();
  const providerId = provider?.id ?? 'historical-fallback';

  return {
    quote: resolveQuoteResource(quoteResult, historyResult, providerId),
    profile: resource(profileResult, provider?.id ?? providerId),
    overview: resource(overviewResult, provider?.id ?? providerId),
    history: historyResponse(historyResult, providerId, timestamp),
  };
}

export async function loadQuoteWithHistoryFallback(
  symbol: string,
  provider: MarketDataProvider | null,
  historyProvider: HistoryLoader,
): Promise<ProviderResult<Quote>> {
  const notConfigured = new MarketDataError(
    'provider-not-configured',
    'Market data provider is not configured',
  );
  let quoteResult: SettledProviderResult<Quote>;
  try {
    if (!provider) throw notConfigured;
    quoteResult = {
      status: 'fulfilled',
      value: await provider.getQuote(symbol),
    };
  } catch (reason) {
    quoteResult = { status: 'rejected', reason };
  }
  if (quoteResult.status === 'fulfilled') return quoteResult.value;

  let historyResult: SettledProviderResult<HistoricalPrices>;
  try {
    historyResult = {
      status: 'fulfilled',
      value: await historyProvider.getHistoricalPrices(symbol, '3m'),
    };
  } catch (reason) {
    historyResult = { status: 'rejected', reason };
  }
  const resolved = resolveQuoteResource(
    quoteResult,
    historyResult,
    provider?.id ?? 'historical-fallback',
  );
  if (!resolved.data) {
    throw quoteResult.reason;
  }
  return {
    data: resolved.data,
    freshness: resolved.freshness,
    provider: resolved.fallbackLabel
      ? `${resolved.provider ?? 'historical-fallback'} (daily history)`
      : resolved.provider ?? provider?.id,
  };
}
