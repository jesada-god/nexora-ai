import { describe, expect, it } from 'vitest';
import { mergeCandle, newestBar } from './candle-merge';
import type { LiveCandle } from './types';

function candle(time: number, close: number): LiveCandle {
  return { time, open: close, high: close, low: close, close, volume: 100 };
}

describe('mergeCandle', () => {
  it('appends when there is no active candle', () => {
    const result = mergeCandle(null, candle(100, 10), null);
    expect(result.applied).toBe(true);
    expect(result.candle).toEqual(candle(100, 10));
  });

  it('replaces the same time bucket with the latest values', () => {
    const result = mergeCandle(candle(100, 10), candle(100, 11), 100);
    expect(result.applied).toBe(true);
    expect(result.candle?.close).toBe(11);
  });

  it('appends a strictly newer bucket', () => {
    const result = mergeCandle(candle(100, 10), candle(200, 12), 100);
    expect(result.applied).toBe(true);
    expect(result.candle?.time).toBe(200);
  });

  it('ignores an older bucket than the newest applied bucket', () => {
    const result = mergeCandle(candle(200, 12), candle(100, 99), 200);
    expect(result.applied).toBe(false);
    expect(result.candle?.time).toBe(200);
    expect(result.candle?.close).toBe(12);
  });

  it('a stale response cannot overwrite a newer candle even without an active candle', () => {
    // lastAppliedTime guards against a late response that predates what we showed.
    const result = mergeCandle(null, candle(100, 5), 200);
    expect(result.applied).toBe(false);
  });
});

describe('newestBar', () => {
  it('returns null for an empty series', () => {
    expect(newestBar([])).toBeNull();
  });

  it('selects the bar with the greatest time regardless of order', () => {
    const bars = [candle(300, 3), candle(100, 1), candle(200, 2)];
    expect(newestBar(bars)?.time).toBe(300);
  });
});
