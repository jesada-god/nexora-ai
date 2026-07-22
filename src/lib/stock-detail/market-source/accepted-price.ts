import type { MarketDataMode, MarketPriceSource } from './types';

/**
 * Shared accepted-price priority (Phase B.2.1).
 *
 * The header price, the chart price line and the (future) S/R `currentPrice`
 * must all derive from ONE accepted value with one provenance and one exchange
 * timestamp. This module is the pure, deterministic policy that picks that value
 * from the candidates currently available, in strict priority:
 *
 *   entitled snapshot
 *     → accepted live aggregate close
 *       → newest displayed history bar close
 *         → unavailable (null)
 *
 * Source rank dominates: a lower-ranked candidate (a history bar) can NEVER
 * overwrite a present higher-ranked candidate (a live aggregate or an entitled
 * snapshot), regardless of its exchange timestamp — so an older history bar can
 * never replace a newer aggregate/snapshot result. Ties within the SAME source
 * prefer the newer exchange timestamp, so a late/out-of-order response cannot
 * replace a newer accepted value of equal rank. Nothing here is fabricated,
 * interpolated or forward-filled, and no candidate may carry a REAL-TIME mode.
 */

/** Descending trust rank; a strictly higher rank always wins. */
const SOURCE_RANK: Record<MarketPriceSource, number> = {
  snapshot: 3,
  'aggregate-fallback': 2,
  'history-fallback': 1,
};

export interface AcceptedPriceCandidate {
  price: number;
  source: MarketPriceSource;
  /** Provider/exchange timestamp for the value (ISO-8601), if known. */
  exchangeTimestamp: string | null;
  /**
   * Truthful display mode. `REAL-TIME` is permitted ONLY on a candidate sourced
   * from a genuine live entitled stream (Phase 12 WebSocket source); REST/history
   * candidates never carry it.
   */
  mode: MarketDataMode;
  provider: string | null;
  /** Carried through from a live stream so the header can gate its badge. */
  realtime?: boolean;
  feed?: string | null;
}

/**
 * Truthful display mode for a newest-displayed history bar, from the chart's raw
 * `dataStatus`. A completed history bar is at best delayed, so `real-time`,
 * `partial`, `delayed` and any unknown status all collapse to `DELAYED` — this
 * value is NEVER labelled REAL-TIME. `end-of-day`/`cached`/`stale` are reported
 * truthfully (Daily/Week/Month completed bars are `end-of-day`).
 */
export function historyFallbackModeFromStatus(status: string): MarketDataMode {
  switch (status) {
    case 'end-of-day':
      return 'END-OF-DAY';
    case 'cached':
      return 'CACHED';
    case 'stale':
      return 'STALE';
    default:
      return 'DELAYED';
  }
}

function timestampMs(candidate: AcceptedPriceCandidate): number {
  const ms = candidate.exchangeTimestamp ? Date.parse(candidate.exchangeTimestamp) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * Resolve the single accepted price from the available candidates. Returns null
 * (unavailable) when no candidate carries a finite price. Ignores any candidate
 * without a usable numeric price so a partial/empty response never wins.
 */
export function resolveAcceptedPrice(
  candidates: ReadonlyArray<AcceptedPriceCandidate | null | undefined>,
): AcceptedPriceCandidate | null {
  let best: AcceptedPriceCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate || !Number.isFinite(candidate.price)) continue;
    if (!best) { best = candidate; continue; }
    const rankDelta = SOURCE_RANK[candidate.source] - SOURCE_RANK[best.source];
    if (rankDelta > 0) { best = candidate; continue; }
    if (rankDelta === 0 && timestampMs(candidate) > timestampMs(best)) best = candidate;
  }
  return best;
}
