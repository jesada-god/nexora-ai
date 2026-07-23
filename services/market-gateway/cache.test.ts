import { describe, expect, it } from 'vitest';
import type { NormalizedBar, NormalizedQuote, NormalizedTrade } from '@/src/lib/market-data/realtime';
import { MarketCache } from './cache';

const trade = (price: number, timestampMs: number): NormalizedTrade => ({ kind: 'trade', symbol: 'RKLB', price, size: 5, timestampMs });
const quote = (bid: number, ask: number, timestampMs: number): NormalizedQuote => ({ kind: 'quote', symbol: 'RKLB', bidPrice: bid, bidSize: 1, askPrice: ask, askSize: 1, timestampMs });
const bar = (close: number, timestampMs: number, updated = false): NormalizedBar => ({ kind: 'bar', symbol: 'RKLB', open: close, high: close, low: close, close, volume: 100, timestampMs, updated });

describe('MarketCache', () => {
  it('returns null for a symbol nothing has been recorded for', () => {
    const cache = new MarketCache();
    expect(cache.snapshotFor('RKLB')).toBeNull();
  });

  it('keeps the newest trade/quote and never regresses on an out-of-order tick', () => {
    const cache = new MarketCache({ now: () => 1_000 });
    cache.record(trade(69.71, 5_000));
    cache.record(trade(69.50, 4_000)); // older — must be ignored
    cache.record(quote(69.70, 69.72, 5_100));
    cache.record(quote(1, 2, 4_500)); // older — ignored
    const snap = cache.snapshotFor('RKLB');
    expect(snap?.trade?.price).toBe(69.71);
    expect(snap?.quote).toMatchObject({ bidPrice: 69.70, askPrice: 69.72 });
    expect(snap?.origin).toBe('cache');
    expect(snap?.asOfMs).toBe(1_000);
  });

  it('keys bars by bucket start so a correction overwrites in place, not duplicates', () => {
    const cache = new MarketCache();
    cache.record(bar(100, 60_000));
    cache.record(bar(120, 60_000, true)); // updatedBar correction for the same minute
    cache.record(bar(130, 120_000));
    const snap = cache.snapshotFor('RKLB');
    expect(snap?.bars).toHaveLength(2);
    expect(snap?.bars[0].close).toBe(120); // corrected value
    expect(snap?.bars.map((b) => b.timestampMs)).toEqual([60_000, 120_000]); // ascending
  });

  it('bounds retained bars to the configured maximum, keeping the newest', () => {
    const cache = new MarketCache({ maxBarsPerSymbol: 2 });
    cache.record(bar(1, 60_000));
    cache.record(bar(2, 120_000));
    cache.record(bar(3, 180_000));
    const snap = cache.snapshotFor('RKLB');
    expect(snap?.bars.map((b) => b.timestampMs)).toEqual([120_000, 180_000]);
  });

  it('seeds from a REST snapshot without overwriting a newer live tick', () => {
    const cache = new MarketCache();
    cache.record(trade(72.0, 9_000)); // live tick arrived first
    cache.seed({ symbol: 'RKLB', trade: trade(69.71, 5_000), quote: quote(69.7, 69.72, 5_000), bars: [bar(69.6, 60_000)], origin: 'rest', asOfMs: 1 });
    const snap = cache.snapshotFor('RKLB');
    expect(snap?.trade?.price).toBe(72.0); // newer live trade preserved
    expect(snap?.bars).toHaveLength(1); // bootstrap bar still seeded
  });
});
