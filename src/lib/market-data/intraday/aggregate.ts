import type { CanonicalIntradayBar } from './contracts';

export interface DerivedH4Bar extends Omit<CanonicalIntradayBar, 'interval'> {
  interval: '4h';
  sourceInterval: CanonicalIntradayBar['interval'];
  sourceBars: number;
}

/** Aggregate only real intraday bars and never cross an exchange session date. */
export function aggregateSessionAwareH4(
  bars: readonly CanonicalIntradayBar[],
): DerivedH4Bar[] {
  const regular = [...bars]
    .filter((bar) => bar.sessionType === 'regular')
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const buckets = new Map<string, CanonicalIntradayBar[]>();
  for (const bar of regular) {
    const firstOfSession = regular.find((candidate) => candidate.sessionDate === bar.sessionDate)?.timestamp;
    if (!firstOfSession) continue;
    const offset = Date.parse(bar.timestamp) - Date.parse(firstOfSession);
    const bucket = Math.max(0, Math.floor(offset / (4 * 60 * 60_000)));
    const key = `${bar.sessionDate}:${bucket}`;
    buckets.set(key, [...(buckets.get(key) ?? []), bar]);
  }
  return [...buckets.values()].map((group) => {
    const first = group[0];
    const last = group.at(-1)!;
    const volumes = group.flatMap((bar) => bar.volume === null ? [] : [bar.volume]);
    return {
      timestamp: first.timestamp,
      sessionDate: first.sessionDate,
      open: first.open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: last.close,
      volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null,
      interval: '4h' as const,
      sourceInterval: first.interval,
      sourceBars: group.length,
      exchangeTimezone: first.exchangeTimezone,
      sessionType: 'regular' as const,
      provider: first.provider,
      asOf: last.asOf,
    };
  });
}
