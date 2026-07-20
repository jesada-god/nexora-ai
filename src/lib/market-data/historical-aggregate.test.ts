import { describe, expect, it } from 'vitest';
import { aggregateWeeklyHistoricalPrices } from './historical-aggregate';

describe('weekly canonical OHLCV aggregation', () => {
  it('sorts, deduplicates and aggregates real daily rows without filling missing days', () => {
    const result = aggregateWeeklyHistoricalPrices([
      { date: '2026-07-08', open: 12, high: 14, low: 11, close: 13, volume: 20 },
      { date: '2026-07-06', open: 10, high: 12, low: 9, close: 11, volume: 10 },
      { date: '2026-07-06', open: 99, high: 99, low: 99, close: 99, volume: 99 },
      { date: '2026-07-13', open: 20, high: 22, low: 19, close: 21, volume: null },
    ]);
    expect(result).toEqual([
      { date: '2026-07-06', open: 10, high: 14, low: 9, close: 13, volume: 30, sourceBars: 2 },
      { date: '2026-07-13', open: 20, high: 22, low: 19, close: 21, volume: null, sourceBars: 1 },
    ]);
  });
});
