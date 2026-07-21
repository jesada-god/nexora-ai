import { confirmedSwingPivots } from '../support-resistance/calculations';
import type { HistoricalPrice } from '@/src/lib/market-data/types';

/**
 * Anchored VWAP.
 *
 * value(i) = Σ_{k≥anchor} typical(k)·volume(k) / Σ_{k≥anchor} volume(k),
 * where typical = (high + low + close) / 3.
 *
 * The anchor is a specific existing chart candle (by time). Volume is required:
 * when it is absent or the cumulative volume from the anchor is not positive, a
 * typed `unavailable` is returned — no other anchor is silently substituted.
 */

export type AvwapAnchorPreset = 'latest-swing-low' | 'latest-swing-high' | 'earliest-visible';

export interface AvwapInputCandle {
  date: string;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface AvwapPoint {
  time: string;
  value: number;
}

export interface AvwapMeta {
  methodology: string;
  anchorTime: string | null;
  anchorIndex: number | null;
  anchorSource: AvwapAnchorPreset | 'custom' | null;
}

export type AnchoredVwapResult =
  | (AvwapMeta & { status: 'available'; points: AvwapPoint[]; value: number })
  | (AvwapMeta & { status: 'unavailable'; reason: string });

const METHODOLOGY = 'Cumulative (typical price × volume) ÷ cumulative volume from the anchor candle forward; typical price = (high + low + close) / 3.';

function hasVolume(candle: AvwapInputCandle): boolean {
  return candle.volume != null && Number.isFinite(candle.volume) && (candle.volume as number) >= 0;
}

/** Resolve a preset to an anchor index within `candles`, or null when it cannot be located. */
export function resolveAnchorIndex(
  candles: readonly AvwapInputCandle[],
  preset: AvwapAnchorPreset,
  pivotWindow = 3,
): number | null {
  if (!candles.length) return null;
  if (preset === 'earliest-visible') return 0;
  const kind = preset === 'latest-swing-low' ? 'low' : 'high';
  // confirmedSwingPivots needs OHLC candles; map to the shape it consumes.
  const asOhlc = candles.map((candle) => ({
    date: candle.date,
    open: candle.close,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume ?? null,
  })) as HistoricalPrice[];
  const pivots = confirmedSwingPivots(asOhlc, pivotWindow).filter((pivot) => pivot.kind === kind);
  if (!pivots.length) return null;
  return pivots.reduce((latest, pivot) => (pivot.index > latest.index ? pivot : latest)).index;
}

/** Locate an anchor candle by its exact time; returns null when the time is not present. */
export function anchorIndexOfTime(candles: readonly AvwapInputCandle[], anchorTime: string): number | null {
  const index = candles.findIndex((candle) => candle.date === anchorTime);
  return index < 0 ? null : index;
}

export function calculateAnchoredVwap(
  candles: readonly AvwapInputCandle[],
  anchor: { index: number; source: AvwapAnchorPreset | 'custom' },
): AnchoredVwapResult {
  const base: AvwapMeta = {
    methodology: METHODOLOGY,
    anchorTime: candles[anchor.index]?.date ?? null,
    anchorIndex: anchor.index >= 0 && anchor.index < candles.length ? anchor.index : null,
    anchorSource: anchor.source,
  };
  if (anchor.index < 0 || anchor.index >= candles.length) {
    return { ...base, status: 'unavailable', reason: 'Anchor candle is outside the visible range' };
  }
  const points: AvwapPoint[] = [];
  let cumulativeTpv = 0;
  let cumulativeVolume = 0;
  let volumeBars = 0;
  for (let index = anchor.index; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!hasVolume(candle)) continue;
    const volume = candle.volume as number;
    const typical = (candle.high + candle.low + candle.close) / 3;
    cumulativeTpv += typical * volume;
    cumulativeVolume += volume;
    volumeBars += 1;
    if (cumulativeVolume > 0) points.push({ time: candle.date, value: cumulativeTpv / cumulativeVolume });
  }
  if (!volumeBars || cumulativeVolume <= 0 || !points.length) {
    return { ...base, status: 'unavailable', reason: 'Volume is unavailable or insufficient from the anchor forward' };
  }
  return { ...base, status: 'available', points, value: points.at(-1)!.value };
}
