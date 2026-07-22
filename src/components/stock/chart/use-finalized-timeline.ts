'use client';

import { useMemo } from 'react';
import { finalizedTimelineSignature, type TimelineBar } from './finalized-timeline';

/**
 * Return a reference-stable view of `bars` whose identity changes only when the
 * finalized timeline changes (see {@link finalizedTimelineSignature}). Feeding
 * this to a heavy-analytics `useMemo` makes that memo skip recomputation during
 * intra-bar live ticks while still recomputing on:
 *
 *   a) a dataset / timeframe / symbol change (the whole array differs),
 *   b) a newly appended finalized bar,
 *   c) an official-bar reconciliation that changes already-completed data.
 *
 * The drawn series keeps using the live array directly, so the candle still
 * moves via `series.update()` without a viewport reset.
 */
export function useFinalizedTimeline<T extends TimelineBar>(
  bars: readonly T[],
  timeOf: (bar: T) => string | number,
): readonly T[] {
  const signature = finalizedTimelineSignature(bars, timeOf);
  // Return a reference that only changes when the finalized signature changes:
  // while it is stable, useMemo yields the previously-captured `bars`, so an
  // intra-bar live tick does not invalidate downstream analytics memos. `bars` is
  // intentionally excluded from the deps — its identity is keyed by `signature`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => bars, [signature]);
}
