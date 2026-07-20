import 'server-only';
import { getCompanyProfileService } from '@/src/lib/market-data';
import { MarketDataError } from '@/src/lib/market-data/errors';
import { getMarketDataGateway } from '@/src/lib/market-data/gateway/service';
import type { NormalizedBarsResult, NormalizedMarketSession, NormalizedQuote, ResolvedInstrument } from '@/src/lib/market-data/gateway/contracts';
import type { CompanyProfile, DataFreshness, MarketDataApiError, MarketOverview, Quote } from '@/src/lib/market-data/types';
import type { InitialHistoryResponse, StockDetailQuoteResource, StockDetailResource } from './types';

const unavailableFreshness: DataFreshness = { status: 'unavailable', asOf: null, maxAgeSeconds: null };

function failure(cause: unknown): { error: MarketDataApiError; reason: string } {
  const error = cause instanceof MarketDataError
    ? cause : new MarketDataError('upstream-unavailable', 'The requested data is temporarily unavailable');
  return { error: error.toApiError(), reason: `${error.code}: ${error.message}` };
}

function unavailable<T>(cause: unknown): StockDetailResource<T> {
  const failed = failure(cause);
  return { data: null, freshness: unavailableFreshness, provider: null, reason: failed.reason, error: failed.error };
}

function freshness(status: NormalizedQuote['status'], timestamp: number): DataFreshness {
  return {
    status: status === 'real-time' ? 'realtime' : status,
    asOf: new Date(timestamp * 1_000).toISOString(),
    maxAgeSeconds: status === 'real-time' ? 15 : 60,
  };
}

function legacyQuote(quote: NormalizedQuote): Quote {
  return {
    symbol: quote.symbol,
    currency: quote.currency,
    price: quote.price,
    open: quote.open ?? null,
    high: quote.high ?? null,
    low: quote.low ?? null,
    previousClose: quote.previousClose,
    change: quote.change,
    changePercent: quote.changePercent,
    volume: quote.volume == null ? null : Math.round(quote.volume),
    latestTradingDay: new Date(quote.timestamp * 1_000).toISOString().slice(0, 10),
  };
}

function quoteFromBars(instrument: ResolvedInstrument, bars: NormalizedBarsResult): NormalizedQuote | null {
  const latest = bars.bars.at(-1);
  if (!latest) return null;
  const previous = bars.bars.at(-2)?.close ?? null;
  const change = previous == null ? null : latest.close - previous;
  return {
    symbol: instrument.canonicalSymbol,
    price: latest.close,
    previousClose: previous,
    change,
    changePercent: previous ? (change! / previous) * 100 : null,
    timestamp: latest.time,
    provider: bars.provider,
    exchange: instrument.exchange,
    currency: instrument.currency,
    status: bars.dataStatus === 'cached' || bars.dataStatus === 'stale'
      ? bars.dataStatus : bars.dataStatus === 'end-of-day' ? 'end-of-day' : 'delayed',
    delayedByMinutes: bars.delayedByMinutes,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    volume: latest.volume,
  };
}

function quoteResource(quote: NormalizedQuote, fallback: boolean): StockDetailQuoteResource {
  return {
    data: legacyQuote(quote),
    freshness: freshness(quote.status, quote.timestamp),
    provider: quote.provider,
    reason: fallback ? 'Primary quote unavailable; using the latest Polygon chart bar' : null,
    error: null,
    fallbackLabel: fallback ? 'Intraday close fallback' : null,
  };
}

function overviewResource(session: NormalizedMarketSession): StockDetailResource<MarketOverview> {
  return {
    data: { markets: [{
      marketType: 'Equity',
      region: 'United States',
      primaryExchanges: session.exchange ? [session.exchange] : [],
      localOpen: session.nextOpen ? new Date(session.nextOpen * 1_000).toISOString() : null,
      localClose: session.nextClose ? new Date(session.nextClose * 1_000).toISOString() : null,
      currentStatus: session.status,
      notes: session.reason,
    }] },
    freshness: {
      status: session.stale ? 'stale' : 'cached',
      asOf: new Date(session.asOf * 1_000).toISOString(),
      maxAgeSeconds: 30,
    },
    provider: session.provider,
    reason: session.reason,
    error: null,
  };
}

export interface StockDetailGatewaySnapshot {
  instrument: ResolvedInstrument;
  quote: StockDetailQuoteResource;
  profile: StockDetailResource<CompanyProfile>;
  overview: StockDetailResource<MarketOverview>;
  history: InitialHistoryResponse;
}

export async function loadStockDetailGatewaySnapshot(symbol: string): Promise<StockDetailGatewaySnapshot> {
  const gateway = getMarketDataGateway();
  const instrument = await gateway.resolveInstrument(symbol);
  const quotePromise = (async () => {
    try { return quoteResource(await gateway.getQuote({ instrument }), false); }
    catch (quoteCause) {
      try {
        const bars = await gateway.getBars({ instrument, interval: '5m', range: '1d', adjusted: false, session: 'regular' });
        const fallback = quoteFromBars(instrument, bars);
        return fallback ? quoteResource(fallback, true) : { ...unavailable<Quote>(quoteCause), fallbackLabel: null };
      } catch { return { ...unavailable<Quote>(quoteCause), fallbackLabel: null }; }
    }
  })();
  const sessionPromise = gateway.getSession({ instrument }).then(overviewResource).catch(unavailable<MarketOverview>);
  const profilePromise = getCompanyProfileService().getCompanyProfile(symbol).then((result): StockDetailResource<CompanyProfile> => ({
    data: result.data,
    freshness: result.freshness,
    provider: result.provider ?? null,
    reason: null,
    error: null,
    fallbackUsed: result.fallbackUsed,
    retryAfterSeconds: result.retryAfterSeconds,
    reasonCode: result.reasonCode,
  })).catch(unavailable<CompanyProfile>);
  const [quote, overview, profile] = await Promise.all([quotePromise, sessionPromise, profilePromise]);
  return {
    instrument,
    quote,
    overview,
    profile,
    history: {
      data: null,
      meta: { provider: null, timestamp: new Date().toISOString(), freshness: unavailableFreshness },
    },
  };
}

