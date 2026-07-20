import { canonicalIntradayBarSchema, type CanonicalIntradayBar } from './contracts';

export function normalizeCanonicalIntradayBars(rows: readonly unknown[]): CanonicalIntradayBar[] {
  const byTimestamp = new Map<string, CanonicalIntradayBar>();
  for (const row of rows) {
    const parsed = canonicalIntradayBarSchema.safeParse(row);
    if (!parsed.success) continue;
    byTimestamp.set(parsed.data.timestamp, parsed.data);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}
