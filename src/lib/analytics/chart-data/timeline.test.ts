import { describe, expect, it } from 'vitest';
import { assertAlignedTimeline, deriveAlignedSeries, normalizeOhlcvTimeline, sliceAlignedSeries } from './timeline';

const rklbRegressionFixture = [
  { date: '2026-07-17', open: 40, high: 42, low: 39, close: 41, volume: 4_100 },
  { date: '2026-07-15', open: 38, high: 40, low: 37, close: 39, volume: 3_900 },
  { date: '2026-07-16', open: 39, high: 41, low: 38, close: 40 },
  { date: '2026-07-17', open: 40.5, high: 43, low: 40, close: 42, volume: 4_200 },
] as const;

describe('canonical RKLB OHLCV timeline regression', () => {
  it('sorts, dedupes once, and keeps a missing-volume time slot aligned', () => {
    const bars = normalizeOhlcvTimeline(rklbRegressionFixture);
    const { price, volume } = deriveAlignedSeries(bars);

    expect(bars.map((bar) => bar.time)).toEqual(['2026-07-15', '2026-07-16', '2026-07-17']);
    expect(bars.at(-1)?.close).toBe(42);
    expect(volume[1]).toMatchObject({ time: '2026-07-16', value: null, available: false });
    expect(price).toHaveLength(volume.length);
    expect(price[0].time).toBe(volume[0].time);
    expect(price.at(-1)?.time).toBe(volume.at(-1)?.time);
  });

  it('enforces candle[i].time === volume[i].time', () => {
    expect(() => assertAlignedTimeline([{ time: '2026-07-15' }], [{ time: '2026-07-16' }])).toThrow(/index 0/);
  });

  it('keeps visible range and crosshair slots identical between panes', () => {
    const visible = sliceAlignedSeries(normalizeOhlcvTimeline(rklbRegressionFixture), 1, 2);
    expect(visible.price.map((point) => point.time)).toEqual(['2026-07-16', '2026-07-17']);
    expect(visible.volume.map((point) => point.time)).toEqual(visible.price.map((point) => point.time));
    expect(visible.price[1].time).toBe(visible.volume[1].time);
  });

  it('normalizes equivalent instants before deduplication', () => {
    const bars = normalizeOhlcvTimeline([
      { time: '2026-07-17T07:00:00+07:00', open: 1, high: 2, low: 1, close: 2, volume: 10 },
      { time: '2026-07-17T00:00:00.000Z', open: 2, high: 3, low: 2, close: 3, volume: 20 },
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ time: '2026-07-17T00:00:00.000Z', close: 3, volume: 20 });
  });
});
