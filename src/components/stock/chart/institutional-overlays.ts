import type { NormalizedBar } from '@/src/lib/analytics/chart-data/timeline';
import type { ZoneCandle } from '@/src/lib/analytics/institutional-sr';
import {
  anchorIndexOfTime,
  resolveAnchorIndex,
  type AvwapAnchorPreset,
  type AvwapInputCandle,
} from '@/src/lib/analytics/institutional-sr';
import type { VrvpInputCandle } from '@/src/lib/analytics/institutional-sr';
import type { StoredAnchor } from '@/src/lib/analytics/institutional-sr';
import type { VisibleLogicalRange } from './LightweightChartHost';

/**
 * Pure bridge between the chart's normalized OHLCV timeline and the institutional
 * analytics inputs. Kept side-effect free so every mapping and the visible-range
 * slice are unit-testable without a chart, and so a viewport change only re-slices
 * already-loaded candles — never a refetch.
 */

/** Institutional D1 zones are a 1-Day-reference construct; only the daily interval feeds them. */
export const DAILY_REFERENCE_INTERVAL = '1D';
export function isDailyReferenceInterval(interval: string | undefined | null): boolean {
  return interval === DAILY_REFERENCE_INTERVAL;
}

/**
 * Map normalized bars to daily zone candles. When the newest bar is still forming
 * (`lastIsPartial`), it is dropped so pivots stay causal and the incomplete current
 * D1 candle never seeds a zone.
 */
export function toZoneCandles(bars: readonly NormalizedBar[], lastIsPartial: boolean): ZoneCandle[] {
  const completed = lastIsPartial ? bars.slice(0, -1) : bars;
  return completed.map((bar) => ({
    date: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

export function toVrvpCandles(bars: readonly NormalizedBar[]): VrvpInputCandle[] {
  return bars.map((bar) => ({
    date: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

export function toAvwapCandles(bars: readonly NormalizedBar[]): AvwapInputCandle[] {
  return bars.map((bar) => ({ date: bar.time, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
}

/**
 * Slice a series to the chart's visible logical bar-index range. A null range (no
 * viewport reported yet) keeps the full series; fractional/at-edge indices are
 * clamped inward so the slice always stays inside the loaded candles.
 */
export function sliceVisibleBars<T>(bars: readonly T[], range: VisibleLogicalRange | null): T[] {
  if (!range || !bars.length) return [...bars];
  const from = Math.max(0, Math.floor(range.from));
  const to = Math.min(bars.length - 1, Math.ceil(range.to));
  if (to < from) return [];
  return bars.slice(from, to + 1);
}

export interface ResolvedAvwapAnchor {
  index: number;
  source: AvwapAnchorPreset | 'custom';
}

/**
 * Resolve a stored anchor to an index inside the *visible* candles. A missing
 * anchor defaults to the earliest visible candle (never a silent price fallback).
 * A preset or a specific candle time that cannot be located returns null so the
 * caller surfaces a typed unavailable rather than substituting another anchor.
 */
export function resolveAvwapAnchor(
  candles: readonly AvwapInputCandle[],
  anchor: StoredAnchor | null,
  pivotWindow = 3,
): ResolvedAvwapAnchor | null {
  if (!candles.length) return null;
  if (!anchor) {
    return { index: 0, source: 'earliest-visible' };
  }
  if (typeof anchor.anchor === 'string') {
    const index = resolveAnchorIndex(candles, anchor.anchor, pivotWindow);
    return index == null ? null : { index, source: anchor.anchor };
  }
  const index = anchorIndexOfTime(candles, anchor.anchor.time);
  return index == null ? null : { index, source: 'custom' };
}
