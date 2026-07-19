import type { HistoricalPrice } from '@/src/lib/market-data/types';
import { atrWilder } from '../technical/calculations';
import { isValidOhlcv } from '../chart-types/calculations';
import type { FibonacciResult } from './types';

const METHODOLOGY = 'Most recent alternating confirmed pivot leg with complete right-side confirmation and ATR significance; raw OHLC only.';
interface Pivot { index: number; kind: 'high' | 'low'; price: number; confirmedAt: string; }

function pivots(candles: readonly HistoricalPrice[], window: number): Pivot[] {
  const result: Pivot[] = [];
  for (let index = window; index < candles.length - window; index += 1) {
    const neighbors = candles.slice(index - window, index + window + 1);
    const candle = candles[index];
    if (neighbors.every((item, offset) => offset === window || candle.high > item.high)) result.push({ index, kind: 'high', price: candle.high, confirmedAt: candles[index + window].date });
    if (neighbors.every((item, offset) => offset === window || candle.low < item.low)) result.push({ index, kind: 'low', price: candle.low, confirmedAt: candles[index + window].date });
  }
  return result.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
}

export function calculateFibonacci(candles: readonly HistoricalPrice[], window = 2, atrPeriod = 14, significance = 1.5): FibonacciResult {
  if (!isValidOhlcv(candles) || candles.length < Math.max(atrPeriod, window * 2 + 2)) return { status: 'unavailable', reason: 'Insufficient valid OHLCV for a confirmed swing', methodology: METHODOLOGY };
  const confirmed = pivots(candles, window); const atr = atrWilder(candles, atrPeriod);
  let leg: [Pivot, Pivot] | null = null;
  for (let endIndex = confirmed.length - 1; endIndex > 0 && !leg; endIndex -= 1) {
    const end = confirmed[endIndex];
    for (let startIndex = endIndex - 1; startIndex >= 0; startIndex -= 1) {
      const start = confirmed[startIndex];
      if (start.kind === end.kind) continue;
      const threshold = Math.max(atr[end.index] ?? Math.abs(end.price) * 0.005, Number.EPSILON) * significance;
      if (Math.abs(end.price - start.price) >= threshold) { leg = [start, end]; break; }
    }
  }
  if (!leg) return { status: 'unavailable', reason: 'No confirmed ATR-significant swing leg', methodology: METHODOLOGY };
  const [start, end] = leg; const direction = start.kind === 'low' && end.kind === 'high' ? 'uptrend' : 'downtrend'; const distance = Math.abs(end.price - start.price);
  const levels = ([0.382, 0.5, 0.618] as const).map((ratio) => ({ ratio, price: direction === 'uptrend' ? end.price - distance * ratio : end.price + distance * ratio }));
  return { status: 'available', direction, start: { date: candles[start.index].date, price: start.price }, end: { date: candles[end.index].date, price: end.price, confirmedAt: end.confirmedAt }, levels, methodology: METHODOLOGY };
}
