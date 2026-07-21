import type { DataFreshness, Quote } from '@/src/lib/market-data/types';
import type { StockDetailQuoteResource } from '@/src/lib/stock-detail/types';
import type { AcceptedPriceCandidate } from './accepted-price';
import type { MarketDataLabel, MarketDataMode, MarketUpdate } from './types';

/**
 * Pure helpers that turn the single accepted price (see {@link resolveAcceptedPrice})
 * into the displayed quote resource, its freshness and its provenance label. Kept
 * transport- and React-free so the header, chart price line and S/R currentPrice
 * provably read one accepted value and one timestamp.
 */

export const AGGREGATE_FALLBACK_LABEL = 'Intraday close fallback' as const;
export const HISTORY_FALLBACK_LABEL = 'Previous trading day' as const;

/** DataFreshness for a value whose truthful mode is already known (never REAL-TIME). */
export function freshnessFromMode(mode: MarketDataMode, asOf: string | null): DataFreshness {
  const status = mode === 'END-OF-DAY'
    ? 'end-of-day' as const
    : mode === 'CACHED'
      ? 'cached' as const
      : mode === 'STALE'
        ? 'stale' as const
        : mode === 'UNAVAILABLE'
          ? 'unavailable' as const
          : 'delayed' as const;
  return {
    status,
    asOf,
    maxAgeSeconds: status === 'end-of-day' ? 86_400 : status === 'unavailable' ? null : 60,
  };
}

/** Map a live {@link MarketUpdate} to a priced accepted-price candidate, or null. */
export function candidateFromUpdate(update: MarketUpdate): AcceptedPriceCandidate | null {
  if (update.price === null || !update.label.source || update.label.source === 'history-fallback') return null;
  return {
    price: update.price,
    source: update.label.source,
    exchangeTimestamp: update.label.exchangeTimestamp,
    mode: update.label.mode,
    provider: update.label.provider,
  };
}

/**
 * Build the displayed quote resource from the single accepted price. A snapshot
 * keeps its full verified quote; an aggregate/history fallback refines only the
 * price and recomputes the derived change against the known previous close — no
 * value is fabricated, interpolated or forward-filled. The returned
 * `data.price` is exactly `accepted.price` and `freshness.asOf` is exactly
 * `accepted.exchangeTimestamp`, so every consumer shares one value and timestamp.
 */
export function buildAcceptedResource(input: {
  accepted: AcceptedPriceCandidate;
  snapshotResource: StockDetailQuoteResource | null;
  baseQuote: Quote | null;
  symbol: string;
}): StockDetailQuoteResource {
  const { accepted, snapshotResource, baseQuote, symbol } = input;
  if (accepted.source === 'snapshot' && snapshotResource) return snapshotResource;

  const previousClose = baseQuote?.previousClose ?? null;
  const change = previousClose != null ? accepted.price - previousClose : null;
  const changePercent = previousClose ? (change! / previousClose) * 100 : null;
  const data: Quote = baseQuote
    ? { ...baseQuote, price: accepted.price, change, changePercent }
    : {
      symbol,
      currency: null,
      price: accepted.price,
      open: null,
      high: null,
      low: null,
      previousClose: null,
      change: null,
      changePercent: null,
      volume: null,
      latestTradingDay: accepted.exchangeTimestamp?.slice(0, 10) ?? null,
    };
  return {
    data,
    freshness: freshnessFromMode(accepted.mode, accepted.exchangeTimestamp),
    provider: accepted.provider,
    reason: accepted.source === 'history-fallback'
      ? 'Latest displayed price derived from the newest completed history bar (fallback).'
      : 'Latest displayed price derived from the newest verified aggregate bar (fallback).',
    error: null,
    fallbackLabel: accepted.source === 'history-fallback' ? HISTORY_FALLBACK_LABEL : AGGREGATE_FALLBACK_LABEL,
  };
}

/** Provenance label for the accepted value (or the unavailable state). */
export function labelFromAccepted(accepted: AcceptedPriceCandidate | null, receivedAt: string): MarketDataLabel {
  if (!accepted) {
    return { mode: 'UNAVAILABLE', provider: null, source: null, exchangeTimestamp: null, receivedAt, delayAgeSeconds: null, fallbackNote: null };
  }
  const exchangeMs = accepted.exchangeTimestamp ? Date.parse(accepted.exchangeTimestamp) : Number.NaN;
  const receivedMs = Date.parse(receivedAt);
  const delayAgeSeconds = Number.isFinite(exchangeMs) && Number.isFinite(receivedMs)
    ? Math.max(0, Math.round((receivedMs - exchangeMs) / 1_000))
    : null;
  return {
    mode: accepted.mode,
    provider: accepted.provider,
    source: accepted.source,
    exchangeTimestamp: accepted.exchangeTimestamp,
    receivedAt,
    delayAgeSeconds,
    fallbackNote: accepted.source === 'snapshot' ? null : 'Fallback price — not a live snapshot.',
  };
}
