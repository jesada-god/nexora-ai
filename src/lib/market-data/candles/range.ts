import type { CandleRange } from './contracts';

export function candleRangeBounds(
  range: CandleRange,
  now = new Date(),
): { period1: number; period2: number } {
  const end = new Date(now);
  const start = new Date(now);
  if (range === '1d') start.setUTCDate(start.getUTCDate() - 1);
  else if (range === '5d') start.setUTCDate(start.getUTCDate() - 5);
  else if (range === '1m') start.setUTCMonth(start.getUTCMonth() - 1);
  else if (range === '3m') start.setUTCMonth(start.getUTCMonth() - 3);
  else if (range === '6m') start.setUTCMonth(start.getUTCMonth() - 6);
  else if (range === 'ytd') start.setUTCMonth(0, 1), start.setUTCHours(0, 0, 0, 0);
  else if (range === '1y') start.setUTCFullYear(start.getUTCFullYear() - 1);
  else if (range === '3y') start.setUTCFullYear(start.getUTCFullYear() - 3);
  else start.setUTCFullYear(start.getUTCFullYear() - 5);
  return { period1: Math.floor(start.valueOf() / 1_000), period2: Math.floor(end.valueOf() / 1_000) };
}

export function isoDateFromEpoch(seconds: number): string {
  return new Date(seconds * 1_000).toISOString().slice(0, 10);
}

