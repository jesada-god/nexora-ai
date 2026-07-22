import { describe, expect, it } from 'vitest';
import {
  channelOfEvent,
  normalizedBarSchema,
  normalizedMarketEventSchema,
  normalizedQuoteSchema,
  normalizedTradeSchema,
  normalizedTradingStatusSchema,
} from './events';

describe('normalized event contracts', () => {
  it('accepts a well-formed trade and rejects non-positive prices', () => {
    expect(normalizedTradeSchema.safeParse({
      kind: 'trade', symbol: 'AAPL', price: 190.12, size: 100, timestampMs: 1_700_000_000_000,
    }).success).toBe(true);
    expect(normalizedTradeSchema.safeParse({
      kind: 'trade', symbol: 'AAPL', price: 0, size: 100, timestampMs: 1_700_000_000_000,
    }).success).toBe(false);
    expect(normalizedTradeSchema.safeParse({
      kind: 'trade', symbol: 'AAPL', price: -1, size: 100, timestampMs: 1_700_000_000_000,
    }).success).toBe(false);
  });

  it('accepts separate bid/ask on a quote', () => {
    const parsed = normalizedQuoteSchema.safeParse({
      kind: 'quote', symbol: 'AAPL', bidPrice: 190.1, bidSize: 2, askPrice: 190.2, askSize: 3, timestampMs: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a non-integer/negative timestamp', () => {
    expect(normalizedBarSchema.safeParse({
      kind: 'bar', symbol: 'AAPL', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, timestampMs: -1, updated: false,
    }).success).toBe(false);
  });

  it('routes each event kind to its channel; updated bars use updatedBars', () => {
    expect(channelOfEvent(normalizedTradeSchema.parse({ kind: 'trade', symbol: 'A', price: 1, size: 1, timestampMs: 1 }))).toBe('trades');
    expect(channelOfEvent(normalizedQuoteSchema.parse({ kind: 'quote', symbol: 'A', bidPrice: 1, bidSize: 1, askPrice: 1, askSize: 1, timestampMs: 1 }))).toBe('quotes');
    expect(channelOfEvent(normalizedBarSchema.parse({ kind: 'bar', symbol: 'A', open: 1, high: 1, low: 1, close: 1, volume: 1, timestampMs: 60_000, updated: false }))).toBe('bars');
    expect(channelOfEvent(normalizedBarSchema.parse({ kind: 'bar', symbol: 'A', open: 1, high: 1, low: 1, close: 1, volume: 1, timestampMs: 60_000, updated: true }))).toBe('updatedBars');
    expect(channelOfEvent(normalizedTradingStatusSchema.parse({ kind: 'status', symbol: 'A', statusCode: 'H', statusMessage: 'Halt', timestampMs: 1, halted: true }))).toBe('statuses');
  });

  it('discriminates the union by kind', () => {
    expect(normalizedMarketEventSchema.safeParse({ kind: 'trade', symbol: 'A', price: 1, size: 1, timestampMs: 1 }).success).toBe(true);
    expect(normalizedMarketEventSchema.safeParse({ kind: 'nope' }).success).toBe(false);
  });
});
