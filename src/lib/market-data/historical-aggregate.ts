import type { HistoricalPrice } from './types';

export interface AggregatedHistoricalPrice extends HistoricalPrice {
  sourceBars: number;
}

function isoWeekKey(date: string): string | null {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return null;
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((parsed.valueOf() - yearStart.valueOf()) / 86_400_000) + 1) / 7);
  return `${parsed.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Aggregate verified daily OHLCV into ISO trading weeks without filling missing days. */
export function aggregateWeeklyHistoricalPrices(
  prices: readonly HistoricalPrice[],
): AggregatedHistoricalPrice[] {
  const ordered = [...prices]
    .sort((left, right) => left.date.localeCompare(right.date))
    .filter((bar, index, rows) => index === 0 || rows[index - 1].date !== bar.date);
  const buckets = new Map<string, HistoricalPrice[]>();
  for (const bar of ordered) {
    const key = isoWeekKey(bar.date);
    if (key) buckets.set(key, [...(buckets.get(key) ?? []), bar]);
  }
  return [...buckets.values()].map((group) => {
    const first = group[0];
    const last = group.at(-1)!;
    const volumes = group.flatMap((bar) => bar.volume === null ? [] : [bar.volume]);
    return {
      date: first.date,
      open: first.open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: last.close,
      volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null,
      sourceBars: group.length,
    };
  });
}
