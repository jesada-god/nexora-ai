import { describe, expect, it } from 'vitest';
import {
  aggregateMinuteBuckets,
  alignBucketStart,
  LiveBucketStore,
  type RealtimeCandle,
  type RealtimeInterval,
} from './aggregate';
import type { NormalizedBar, NormalizedTrade } from './events';

const MINUTE_MS = 60_000;
/**
 * A UTC boundary aligned to every supported window (1m…4h). 12:00 UTC is a
 * multiple of 14400s, so a single 4h parent cleanly contains 240 minutes.
 */
const BASE_MS = Date.UTC(2024, 0, 2, 12, 0, 0);

function trade(offsetMs: number, price: number, size = 10): NormalizedTrade {
  return { kind: 'trade', symbol: 'AAPL', price, size, timestampMs: BASE_MS + offsetMs };
}

function bar(offsetMs: number, ohlcv: Partial<NormalizedBar> = {}): NormalizedBar {
  return {
    kind: 'bar', symbol: 'AAPL', open: 100, high: 101, low: 99, close: 100.5, volume: 500,
    timestampMs: BASE_MS + offsetMs, updated: false, ...ohlcv,
  };
}

function minute(startSec: number, close: number, volume = 10): RealtimeCandle {
  return { time: startSec, open: close, high: close, low: close, close, volume };
}

describe('alignBucketStart', () => {
  it('floors to the window', () => {
    expect(alignBucketStart(305, 300)).toBe(300);
    expect(alignBucketStart(600, 300)).toBe(600);
  });
});

describe('LiveBucketStore trade folding', () => {
  it('builds a 1m OHLCV bucket: open=first, close=last, high/low extremes, volume=sum', () => {
    const store = new LiveBucketStore();
    store.applyTrade(trade(1_000, 100, 5));
    store.applyTrade(trade(2_000, 102, 3));
    store.applyTrade(trade(3_000, 98, 4));
    store.applyTrade(trade(4_000, 101, 2));
    const [candle] = store.minuteBuckets();
    expect(candle).toEqual({ time: BASE_MS / 1_000, open: 100, high: 102, low: 98, close: 101, volume: 14 });
  });

  it('opens a new bucket on the next minute and reports finalizedPrevious', () => {
    const store = new LiveBucketStore();
    store.applyTrade(trade(1_000, 100));
    const result = store.applyTrade(trade(MINUTE_MS + 1_000, 105));
    expect(result.finalizedPrevious).toBe(true);
    expect(store.minuteBuckets()).toHaveLength(2);
  });

  it('ignores a late/out-of-order trade older than the newest bucket', () => {
    const store = new LiveBucketStore();
    store.applyTrade(trade(MINUTE_MS + 1_000, 105));
    const late = store.applyTrade(trade(1_000, 100));
    expect(late.applied).toBe(false);
    expect(store.minuteBuckets()).toHaveLength(1);
  });
});

describe('LiveBucketStore official-bar reconciliation', () => {
  it('reconciles the same minute in place — no duplicate candle — and takes official OHLCV', () => {
    const store = new LiveBucketStore();
    store.applyTrade(trade(1_000, 100, 5));
    store.applyTrade(trade(2_000, 103, 5));
    store.applyBar(bar(0, { open: 100, high: 104, low: 99.5, close: 102, volume: 900 }));
    const buckets = store.minuteBuckets();
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toEqual({ time: BASE_MS / 1_000, open: 100, high: 104, low: 99.5, close: 102, volume: 900 });
  });

  it('is idempotent for a re-delivered (duplicate) bar', () => {
    const store = new LiveBucketStore();
    store.applyBar(bar(0, { close: 100.5, volume: 900 }));
    store.applyBar(bar(0, { close: 100.5, volume: 900 }));
    expect(store.minuteBuckets()).toHaveLength(1);
    expect(store.minuteBuckets()[0].volume).toBe(900);
  });

  it('ignores a trade that arrives after the official bar closed the minute', () => {
    const store = new LiveBucketStore();
    store.applyBar(bar(0, { close: 102, volume: 900 }));
    const late = store.applyTrade(trade(5_000, 200, 50));
    expect(late.applied).toBe(false);
    expect(store.minuteBuckets()[0]).toMatchObject({ close: 102, volume: 900 });
  });

  it('an updated bar corrects a previously finalized minute', () => {
    const store = new LiveBucketStore();
    store.applyBar(bar(0, { close: 100, volume: 500 }));
    store.applyBar(bar(0, { updated: true, close: 101, volume: 650 }));
    expect(store.minuteBuckets()[0]).toMatchObject({ close: 101, volume: 650 });
  });
});

describe('aggregateMinuteBuckets', () => {
  const startSec = BASE_MS / 1_000;

  it.each<[RealtimeInterval, number]>([
    ['5m', 5], ['10m', 10], ['15m', 15], ['1h', 60], ['4h', 240],
  ])('aggregates %s canonically from 1m buckets', (interval, count) => {
    const minutes = Array.from({ length: count }, (_, index) => minute(startSec + index * 60, 100 + index, 10));
    const [candle, ...rest] = aggregateMinuteBuckets(minutes, interval);
    expect(rest).toHaveLength(0);
    expect(candle).toEqual({
      time: startSec,
      open: 100,
      high: 100 + count - 1,
      low: 100,
      close: 100 + count - 1,
      volume: count * 10,
    });
  });

  it('splits minutes across two epoch-aligned 5m parents', () => {
    const minutes = Array.from({ length: 7 }, (_, index) => minute(startSec + index * 60, 100 + index));
    const candles = aggregateMinuteBuckets(minutes, '5m');
    expect(candles).toHaveLength(2);
    expect(candles[0].time).toBe(startSec);
    expect(candles[1].time).toBe(startSec + 300);
  });

  it('tolerates duplicate and out-of-order input minutes', () => {
    const ordered = [minute(startSec, 100), minute(startSec + 60, 101), minute(startSec + 120, 102)];
    const shuffled = [ordered[2], ordered[0], ordered[1], ordered[0]];
    expect(aggregateMinuteBuckets(shuffled, '5m')).toEqual(aggregateMinuteBuckets(ordered, '5m'));
  });

  it('exposes the derived active candle from the store', () => {
    const store = new LiveBucketStore();
    store.applyTrade(trade(1_000, 100));
    store.applyTrade(trade(MINUTE_MS + 1_000, 106));
    expect(store.activeCandle('5m')).toMatchObject({ time: startSec, high: 106, close: 106 });
  });
});
