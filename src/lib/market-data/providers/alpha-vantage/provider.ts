import 'server-only';
import { ZodError } from 'zod';
import { MarketDataError, mapProviderFailure } from '../../errors';
import type {
  CompanyProfile,
  HistoricalPrices,
  HistoricalRange,
  MarketDataProvider,
  MarketOverview,
  ProviderResult,
  Quote,
  SymbolSearchResult,
} from '../../types';
import {
  normalizeHistoryResponse,
  normalizeMarketOverviewResponse,
  normalizeProfileResponse,
  normalizeQuoteResponse,
  normalizeSearchResponse,
} from './normalize';

const BASE_URL = 'https://www.alphavantage.co/query';
const TIMEOUT_MS = 8_000;

const REVALIDATE_SECONDS = {
  search: 60 * 60,
  quote: 60,
  history: 6 * 60 * 60,
  profile: 24 * 60 * 60,
  overview: 5 * 60,
} as const;

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

function asOfDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export class AlphaVantageProvider implements MarketDataProvider {
  readonly id = 'alpha-vantage';

  constructor(private readonly apiKey: string) {}

  private async request(params: Record<string, string>, revalidate: number): Promise<unknown> {
    const url = new URL(BASE_URL);
    Object.entries({ ...params, apikey: this.apiKey }).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'force-cache',
        next: { revalidate },
      });
    } catch (cause) {
      throw mapProviderFailure({ cause });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw mapProviderFailure({ status: response.status, cause });
    }

    if (!response.ok || (
      payload && typeof payload === 'object' &&
      ['Note', 'Information', 'Error Message'].some((key) => key in payload)
    )) {
      throw mapProviderFailure({
        status: response.status,
        payload,
        retryAfterSeconds: retryAfterSeconds(response),
      });
    }

    return payload;
  }

  private normalize<T>(normalizer: () => T): T {
    try {
      return normalizer();
    } catch (cause) {
      if (cause instanceof MarketDataError) throw cause;
      if (cause instanceof ZodError) {
        throw new MarketDataError('invalid-provider-response', 'Market data provider response did not match its contract');
      }
      throw cause;
    }
  }

  async search(query: string): Promise<ProviderResult<SymbolSearchResult[]>> {
    const payload = await this.request({ function: 'SYMBOL_SEARCH', keywords: query }, REVALIDATE_SECONDS.search);
    return {
      data: this.normalize(() => normalizeSearchResponse(payload)),
      freshness: { status: 'cached', asOf: null, maxAgeSeconds: REVALIDATE_SECONDS.search },
    };
  }

  async getQuote(symbol: string): Promise<ProviderResult<Quote>> {
    const payload = await this.request({ function: 'GLOBAL_QUOTE', symbol }, REVALIDATE_SECONDS.quote);
    if (
      payload && typeof payload === 'object' &&
      'Global Quote' in payload &&
      payload['Global Quote'] && typeof payload['Global Quote'] === 'object' &&
      Object.keys(payload['Global Quote']).length === 0
    ) {
      throw new MarketDataError('invalid-symbol', `No quote found for ${symbol}`);
    }
    const data = this.normalize(() => normalizeQuoteResponse(payload));
    return {
      data,
      freshness: {
        status: 'end-of-day',
        asOf: asOfDate(data.latestTradingDay),
        maxAgeSeconds: REVALIDATE_SECONDS.quote,
      },
    };
  }

  async getHistoricalPrices(symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>> {
    const outputsize = range === '1m' || range === '3m' ? 'compact' : 'full';
    const payload = await this.request(
      { function: 'TIME_SERIES_DAILY', symbol, outputsize },
      REVALIDATE_SECONDS.history,
    );
    const data = this.normalize(() => normalizeHistoryResponse(payload, symbol, range));
    const latestDate = data.prices.at(-1)?.date;
    return {
      data,
      freshness: {
        status: 'end-of-day',
        asOf: asOfDate(latestDate),
        maxAgeSeconds: REVALIDATE_SECONDS.history,
      },
    };
  }

  async getCompanyProfile(symbol: string): Promise<ProviderResult<CompanyProfile>> {
    const payload = await this.request({ function: 'OVERVIEW', symbol }, REVALIDATE_SECONDS.profile);
    if (payload && typeof payload === 'object' && Object.keys(payload).length === 0) {
      throw new MarketDataError('invalid-symbol', `No company profile found for ${symbol}`);
    }
    const data = this.normalize(() => normalizeProfileResponse(payload));
    return {
      data,
      freshness: { status: 'cached', asOf: asOfDate(data.latestQuarter), maxAgeSeconds: REVALIDATE_SECONDS.profile },
    };
  }

  async getMarketOverview(): Promise<ProviderResult<MarketOverview>> {
    const payload = await this.request({ function: 'MARKET_STATUS' }, REVALIDATE_SECONDS.overview);
    return {
      data: this.normalize(() => normalizeMarketOverviewResponse(payload)),
      freshness: { status: 'cached', asOf: null, maxAgeSeconds: REVALIDATE_SECONDS.overview },
    };
  }
}
