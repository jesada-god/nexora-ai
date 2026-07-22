/**
 * Finalization signature for the chart's analytics inputs.
 *
 * Heavy analytics (technical indicators, support/resistance, volume profile,
 * anchored VWAP, institutional zones) must recompute only when the *finalized*
 * timeline changes — never on every intra-bar live tick. This signature captures
 * exactly the finalized portion:
 *
 *   - the bar count (a newly appended finalized bar changes it),
 *   - the newest bar's identity/time (a new bucket opening changes it),
 *   - every COMPLETED bar's full OHLCV (an official-bar reconciliation of an
 *     already-closed bar changes it).
 *
 * The still-forming last bar's intra-bar drift (same time, moving H/L/C/volume)
 * is deliberately excluded, so a live trade that only mutates the current bucket
 * produces an unchanged signature and the last analysis result is retained.
 */

export interface TimelineBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export function finalizedTimelineSignature<T extends TimelineBar>(
  bars: readonly T[],
  timeOf: (bar: T) => string | number,
): string {
  const count = bars.length;
  if (count === 0) return '0';
  // Newest bar contributes only its identity (time), never its drifting OHLCV.
  const parts: string[] = [String(count), `~${timeOf(bars[count - 1])}`];
  for (let index = 0; index < count - 1; index += 1) {
    const bar = bars[index];
    parts.push(`${timeOf(bar)}:${bar.open}:${bar.high}:${bar.low}:${bar.close}:${bar.volume ?? ''}`);
  }
  return parts.join('|');
}
