import { describe, expect, it } from 'vitest';
import type { CanonicalIntradayBar } from './contracts';
import { aggregateSessionAwareH4 } from './aggregate';
import { normalizeCanonicalIntradayBars } from './normalize';

const bar = (timestamp: string, overrides: Partial<CanonicalIntradayBar> = {}): CanonicalIntradayBar => ({
  timestamp, sessionDate: timestamp.slice(0, 10), open: 10, high: 12, low: 9, close: 11,
  volume: 100, interval: '60m', exchangeTimezone: 'America/New_York', sessionType: 'regular',
  provider: 'test-provider', asOf: '2026-07-20T21:00:00.000Z', ...overrides,
});

describe('canonical intraday data', () => {
  it('sorts and deduplicates once while preserving missing volume', () => {
    const result = normalizeCanonicalIntradayBars([
      bar('2026-07-20T15:30:00.000Z'),
      bar('2026-07-20T13:30:00.000Z', { volume: 50 }),
      bar('2026-07-20T15:30:00.000Z', { close: 11.5, volume: null }),
    ]);
    expect(result.map((item) => item.timestamp)).toEqual(['2026-07-20T13:30:00.000Z', '2026-07-20T15:30:00.000Z']);
    expect(result[1]).toMatchObject({ close: 11.5, volume: null });
  });

  it('aggregates H4 only from same-session intraday bars', () => {
    const input = [
      bar('2026-07-20T13:30:00.000Z', { open: 10, high: 11, low: 9.5, close: 10.5 }),
      bar('2026-07-20T14:30:00.000Z', { open: 10.5, high: 12, low: 10, close: 11.5, volume: null }),
      bar('2026-07-20T15:30:00.000Z', { open: 11.5, high: 13, low: 11, close: 12.5 }),
      bar('2026-07-20T16:30:00.000Z', { open: 12.5, high: 14, low: 12, close: 13.5 }),
      bar('2026-07-20T17:30:00.000Z', { open: 13.5, high: 15, low: 13, close: 14.5 }),
      bar('2026-07-21T13:30:00.000Z', { sessionDate: '2026-07-21', open: 20, high: 21, low: 19, close: 20.5 }),
    ];
    const result = aggregateSessionAwareH4(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ open: 10, high: 14, low: 9.5, close: 13.5, sourceBars: 4, volume: 300 });
    expect(result[1]).toMatchObject({ open: 13.5, close: 14.5, sourceBars: 1 });
    expect(result[2].sessionDate).toBe('2026-07-21');
  });

  it('never fabricates H4 from daily-shaped rows', () => {
    expect(normalizeCanonicalIntradayBars([{ date: '2026-07-20', open: 1, high: 2, low: 1, close: 2 }])).toEqual([]);
  });
});
