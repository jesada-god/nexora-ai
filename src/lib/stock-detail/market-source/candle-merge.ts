import type { LiveCandle } from './types';

export interface CandleMergeResult {
  /** True when the incoming bucket was accepted (replaced or appended). */
  applied: boolean;
  /** The resulting active candle (unchanged when the incoming bucket is stale). */
  candle: LiveCandle | null;
}

/**
 * Deterministically fold an incoming OHLCV bucket into the current active
 * candle:
 *
 *  - replace/update when the incoming bucket shares the active bucket's time,
 *  - append when the incoming bucket is strictly newer,
 *  - ignore when the incoming bucket is older than the newest applied bucket.
 *
 * `lastAppliedTime` guards against a late/out-of-order response whose newest
 * bar predates a bucket we have already shown: such a response can never
 * overwrite a newer candle.
 */
export function mergeCandle(
  active: LiveCandle | null,
  incoming: LiveCandle | null,
  lastAppliedTime: number | null,
): CandleMergeResult {
  if (!incoming) return { applied: false, candle: active };

  if (lastAppliedTime !== null && incoming.time < lastAppliedTime) {
    return { applied: false, candle: active };
  }

  if (!active) {
    return { applied: true, candle: incoming };
  }

  if (incoming.time < active.time) {
    return { applied: false, candle: active };
  }

  // Same bucket → replace with the latest values; newer bucket → append.
  return { applied: true, candle: incoming };
}

/** Select the newest bar from an aggregate response, or null when empty. */
export function newestBar(bars: LiveCandle[]): LiveCandle | null {
  if (bars.length === 0) return null;
  let newest = bars[0];
  for (const bar of bars) {
    if (bar.time > newest.time) newest = bar;
  }
  return newest;
}
