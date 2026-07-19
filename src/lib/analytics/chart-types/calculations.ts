import type { HistoricalPrice } from '@/src/lib/market-data/types';
import type { ChartCandle } from './types';

export function isValidOhlcv(candles: readonly HistoricalPrice[]): boolean {
  return candles.every((candle, index) =>
    [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    && candle.high >= Math.max(candle.open, candle.close, candle.low)
    && candle.low <= Math.min(candle.open, candle.close, candle.high)
    && candle.volume >= 0
    && (index === 0 || candle.date > candles[index - 1].date));
}

/** A presentation-only transform. Analytics must continue to consume the raw candles. */
export function heikinAshi(candles: readonly HistoricalPrice[]): ChartCandle[] {
  if (!isValidOhlcv(candles)) return [];
  const result: ChartCandle[] = [];
  candles.forEach((raw, index) => {
    const close = (raw.open + raw.high + raw.low + raw.close) / 4;
    const open = index === 0
      ? (raw.open + raw.close) / 2
      : (result[index - 1].open + result[index - 1].close) / 2;
    result.push({
      date: raw.date,
      open,
      high: Math.max(raw.high, open, close),
      low: Math.min(raw.low, open, close),
      close,
      volume: raw.volume,
      raw: { ...raw },
      transformed: true,
    });
  });
  return result;
}

export function rawChartCandles(candles: readonly HistoricalPrice[]): ChartCandle[] {
  return isValidOhlcv(candles)
    ? candles.map((raw) => ({ ...raw, raw: { ...raw }, transformed: false }))
    : [];
}
