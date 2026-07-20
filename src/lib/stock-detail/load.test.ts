import { describe, expect, it, vi } from 'vitest';
import { MarketDataError } from '@/src/lib/market-data/errors';
import type {
  CompanyProfile,
  HistoricalPrices,
  MarketDataProvider,
  MarketOverview,
  ProviderResult,
  Quote,
} from '@/src/lib/market-data/types';
import { loadQuoteWithHistoryFallback, loadStockDetailMarketSnapshot } from './load';

const freshness = {
  status: 'end-of-day' as const,
  asOf: '2026-07-17T00:00:00.000Z',
  maxAgeSeconds: 60,
};
const quote: Quote = {
  symbol: 'RKLB',
  price: 42,
  open: 40,
  high: 43,
  low: 39,
  previousClose: 41,
  change: 1,
  changePercent: 2.439,
  volume: 1_000,
  latestTradingDay: '2026-07-17',
};
const profile: CompanyProfile = {
  symbol: 'RKLB',
  name: 'Rocket Lab USA, Inc.',
  description: 'Rocket Lab provides launch services.',
  exchange: 'NASDAQ',
  currency: 'USD',
  country: 'USA',
  sector: 'Industrials',
  industry: 'Aerospace & Defense',
  website: 'https://www.rocketlabusa.com/',
  marketCapitalization: 20_000_000_000,
  employees: null,
  fiscalYearEnd: 'December',
  latestQuarter: '2026-06-30',
};
const overview: MarketOverview = {
  markets: [{
    marketType: 'Equity',
    region: 'United States',
    primaryExchanges: ['NASDAQ'],
    localOpen: '09:30',
    localClose: '16:00',
    currentStatus: 'closed',
    notes: null,
  }],
};
const history: HistoricalPrices = {
  symbol: 'RKLB',
  range: '3m',
  interval: '1d',
  prices: [
    { date: '2026-07-16', open: 38, high: 41, low: 37, close: 40, volume: 800 },
    { date: '2026-07-17', open: 40, high: 43, low: 39, close: 42, volume: 1_000 },
  ],
};

function result<T>(data: T): ProviderResult<T> {
  return { data, freshness, provider: 'test-provider' };
}

function provider(overrides: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    id: 'test-provider',
    search: vi.fn(),
    getQuote: vi.fn(async () => result(quote)),
    getHistoricalPrices: vi.fn(async () => result(history)),
    getCompanyProfile: vi.fn(async () => result(profile)),
    getMarketOverview: vi.fn(async () => result(overview)),
    ...overrides,
  };
}

const historyProvider = {
  getHistoricalPrices: vi.fn(async () => result(history)),
};

describe('Stock Detail market loading', () => {
  it('keeps Profile available when Quote fails', async () => {
    const snapshot = await loadStockDetailMarketSnapshot(
      'RKLB',
      provider({
        getQuote: vi.fn(async () => {
          throw new MarketDataError('rate-limited', 'Quote quota exceeded', 30);
        }),
      }),
      historyProvider,
    );
    expect(snapshot.profile.data?.name).toBe('Rocket Lab USA, Inc.');
    expect(snapshot.quote.data?.price).toBe(42);
    expect(snapshot.quote.fallbackLabel).toBe('Previous trading day');
  });

  it('keeps Quote available when Profile fails', async () => {
    const snapshot = await loadStockDetailMarketSnapshot(
      'RKLB',
      provider({
        getCompanyProfile: vi.fn(async () => {
          throw new MarketDataError('invalid-provider-response', 'Profile was empty');
        }),
      }),
      historyProvider,
    );
    expect(snapshot.quote.data?.price).toBe(42);
    expect(snapshot.quote.fallbackLabel).toBeNull();
    expect(snapshot.profile.data).toBeNull();
    expect(snapshot.profile.reason).toContain('invalid-provider-response');
  });

  it('builds fallback Quote only from the latest verified daily bar', async () => {
    const snapshot = await loadStockDetailMarketSnapshot(
      ' rklb '.trim().toUpperCase(),
      provider({
        getQuote: vi.fn(async () => {
          throw new MarketDataError('upstream-unavailable', 'Quote failed');
        }),
      }),
      historyProvider,
    );
    expect(snapshot.quote.data).toMatchObject({
      symbol: 'RKLB',
      price: 42,
      open: 40,
      high: 43,
      low: 39,
      volume: 1_000,
      previousClose: null,
      change: null,
      changePercent: null,
    });
    expect(snapshot.quote.freshness.status).toBe('end-of-day');
    expect(snapshot.quote.freshness.asOf).toBeNull();
    expect(snapshot.quote.data?.latestTradingDay).toBe('2026-07-17');
    expect(snapshot.quote.fallbackLabel).toBe('Previous trading day');
  });

  it('does not turn missing numeric Profile fields into zero', async () => {
    const snapshot = await loadStockDetailMarketSnapshot(
      'RKLB',
      provider(),
      historyProvider,
    );
    expect(snapshot.profile.data?.employees).toBeNull();
    expect(snapshot.profile.data?.employees).not.toBe(0);
  });

  it('does not request history when the primary Quote succeeds', async () => {
    const primary = provider();
    const fallback = {
      getHistoricalPrices: vi.fn(async () => result(history)),
    };
    const resolved = await loadQuoteWithHistoryFallback('RKLB', primary, fallback);
    expect(resolved.data.price).toBe(42);
    expect(fallback.getHistoricalPrices).not.toHaveBeenCalled();
  });
});
