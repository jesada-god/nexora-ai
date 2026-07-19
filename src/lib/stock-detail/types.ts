import type {
  CompanyProfile,
  DataFreshness,
  HistoricalPrices,
  MarketDataApiError,
  MarketOverview,
  ProviderResult,
  Quote,
} from '@/src/lib/market-data/types';

export interface StockDetailResource<T> {
  data: T | null;
  freshness: DataFreshness;
  provider: string | null;
  reason: string | null;
  error: MarketDataApiError | null;
  fallbackUsed?: boolean;
  retryAfterSeconds?: number;
  reasonCode?: string | null;
}

export interface StockDetailQuoteResource extends StockDetailResource<Quote> {
  fallbackLabel: 'Previous trading day' | null;
}

export interface InitialHistoryResponse {
  data: HistoricalPrices | null;
  error?: MarketDataApiError;
  meta: {
    provider: string | null;
    timestamp: string;
    freshness: DataFreshness;
  };
}

export interface StockDetailMarketSnapshot {
  quote: StockDetailQuoteResource;
  profile: StockDetailResource<CompanyProfile>;
  overview: StockDetailResource<MarketOverview>;
  history: InitialHistoryResponse;
}

export type SettledProviderResult<T> = PromiseSettledResult<ProviderResult<T>>;
