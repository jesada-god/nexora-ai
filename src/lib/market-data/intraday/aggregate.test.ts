import { describe, expect, it } from 'vitest';
import type { CanonicalIntradayBar } from './contracts';
import { aggregateSessionAwareIntraday } from './aggregate';

function bar(timestamp: string, close: number, sessionDate = '2026-07-17'): CanonicalIntradayBar {
  return {
    timestamp,
    sessionDate,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
    interval: '5m',
    exchangeTimezone: 'America/New_York',
    sessionType: 'regular',
    provider: 'fixture',
    asOf: timestamp,
  };
}

describe('session-aware canonical intraday aggregation', () => {
  it.each([['10m', 2], ['1h', 12], ['4h', 48]] as const)('aggregates %s with canonical OHLCV semantics', (interval, count) => {
    const rows = Array.from({ length: count }, (_, index) => bar(
      new Date(Date.parse('2026-07-17T13:30:00.000Z') + index * 5 * 60_000).toISOString(),
      100 + index,
    ));
    const [result] = aggregateSessionAwareIntraday(rows, interval);
    expect(result).toMatchObject({
      interval,
      open: 99.5,
      high: 100 + count,
      low: 99,
      close: 99 + count,
      volume: count * 10,
      sourceBars: count,
    });
  });

  it('never merges across trading dates or pre/regular/after-hours boundaries', () => {
    const pre = { ...bar('2026-07-17T13:25:00.000Z', 99), sessionType: 'premarket' as const };
    const regular = bar('2026-07-17T13:30:00.000Z', 100);
    const nextDay = bar('2026-07-20T13:30:00.000Z', 101, '2026-07-20');
    expect(aggregateSessionAwareIntraday([pre, regular, nextDay], '1h')).toHaveLength(3);
  });
});
