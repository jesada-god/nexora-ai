import 'server-only';
import { serverEnv } from '@/src/config/env/server';
import { MarketDataError } from './errors';
import type { MarketDataProvider } from './types';
import { AlphaVantageProvider } from './providers/alpha-vantage/provider';

export const MARKET_DATA_PROVIDER_ID = 'alpha-vantage';

export function getMarketDataProvider(): MarketDataProvider {
  if (!serverEnv.ALPHA_VANTAGE_API_KEY) {
    throw new MarketDataError(
      'provider-not-configured',
      'Market data provider is not configured',
    );
  }
  return new AlphaVantageProvider(serverEnv.ALPHA_VANTAGE_API_KEY);
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
