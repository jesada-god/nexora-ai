import type { CanonicalIntradayBar } from './contracts';

export type AggregatedIntradayInterval = '10m' | '1h' | '4h';

export interface AggregatedIntradayBar extends Omit<CanonicalIntradayBar, 'interval'> {
  interval: AggregatedIntradayInterval;
  sourceInterval: CanonicalIntradayBar['interval'];
  sourceBars: number;
}

const INTERVAL_MS: Record<AggregatedIntradayInterval, number> = {
  '10m': 10 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
};

/** Aggregate only real bars and never cross an exchange date or session boundary. */
export function aggregateSessionAwareIntraday(
  bars: readonly CanonicalIntradayBar[],
  interval: AggregatedIntradayInterval,
): AggregatedIntradayBar[] {
  const ordered = [...bars].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const firstBySession = new Map<string, string>();
  for (const bar of ordered) {
    const sessionKey = `${bar.sessionDate}:${bar.sessionType}`;
    if (!firstBySession.has(sessionKey)) firstBySession.set(sessionKey, bar.timestamp);
  }
  const buckets = new Map<string, CanonicalIntradayBar[]>();
  for (const bar of ordered) {
    const sessionKey = `${bar.sessionDate}:${bar.sessionType}`;
    const firstOfSession = firstBySession.get(sessionKey);
    if (!firstOfSession) continue;
    const offset = Date.parse(bar.timestamp) - Date.parse(firstOfSession);
    const bucket = Math.max(0, Math.floor(offset / INTERVAL_MS[interval]));
    const key = `${sessionKey}:${bucket}`;
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
      interval,
      sourceInterval: first.interval,
      sourceBars: group.length,
      exchangeTimezone: first.exchangeTimezone,
      sessionType: first.sessionType,
      provider: first.provider,
      asOf: last.asOf,
    };
  });
}

export type DerivedH4Bar = AggregatedIntradayBar & { interval: '4h' };

export function aggregateSessionAwareH4(
  bars: readonly CanonicalIntradayBar[],
): DerivedH4Bar[] {
  return aggregateSessionAwareIntraday(bars, '4h') as DerivedH4Bar[];
}
