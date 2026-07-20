import { describe, expect, it } from 'vitest';
import { aggregateCandles } from './aggregate';
import type { NormalizedCandle } from './contracts';

function candle(timestamp: string, open: number, high: number, low: number, close: number, volume: number, session: 'regular' | 'pre' = 'regular'): NormalizedCandle {
  return { timestamp: Date.parse(timestamp) / 1_000, open, high, low, close, volume, session };
}

describe('normalized candle aggregation', () => {
  it('uses first open, max high, min low, last close and summed real volume', () => {
    const result = aggregateCandles([
      candle('2026-07-20T13:30:00.000Z', 10, 12, 9, 11, 100),
      candle('2026-07-20T13:35:00.000Z', 11, 14, 10, 13, 150),
    ], '10m', '5m', 'America/New_York');
    expect(result).toEqual([{ timestamp: Date.parse('2026-07-20T13:30:00.000Z') / 1_000, open: 10, high: 14, low: 9, close: 13, volume: 250, session: 'regular' }]);
  });

  it('never crosses exchange session/date boundaries and never fills a missing source candle', () => {
    const result = aggregateCandles([
      candle('2026-07-20T12:00:00.000Z', 9, 10, 8, 9, 10, 'pre'),
      candle('2026-07-20T13:30:00.000Z', 10, 11, 9, 10, 20),
      candle('2026-07-20T13:40:00.000Z', 12, 13, 11, 12, 30),
      candle('2026-07-21T13:30:00.000Z', 14, 15, 13, 14, 40),
    ], '10m', '5m', 'America/New_York');
    expect(result).toHaveLength(4);
    expect(result.map((bar) => bar.open)).toEqual([9, 10, 12, 14]);
  });

  it('aggregates real daily bars by week and month without creating holidays', () => {
    const daily = [
      candle('2026-06-30T12:00:00.000Z', 10, 12, 9, 11, 100),
      candle('2026-07-01T12:00:00.000Z', 11, 13, 10, 12, 200),
      candle('2026-07-06T12:00:00.000Z', 12, 14, 11, 13, 300),
    ];
    expect(aggregateCandles(daily, 'Week', '1D', 'America/New_York', Date.parse('2026-07-07T12:00:00.000Z') / 1_000)).toEqual(expect.arrayContaining([expect.objectContaining({ partial: true })]));
    expect(aggregateCandles(daily, 'Month', '1D', 'America/New_York', Date.parse('2026-07-07T12:00:00.000Z') / 1_000)).toHaveLength(2);
  });
});
