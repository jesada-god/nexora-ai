import { normalizedCandleSchema, type NormalizedCandle } from './contracts';

export function providerNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text === '-' || text.toLowerCase() === 'none') return null;
  const negative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[(),]/g, ''));
  return Number.isFinite(number) ? (negative ? -number : number) : null;
}

export function validatedCandle(input: {
  timestamp: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  adjustedClose?: unknown;
  volume: unknown;
  session?: 'pre' | 'regular' | 'post';
  partial?: boolean;
}): NormalizedCandle | null {
  const timestamp = providerNumber(input.timestamp);
  const open = providerNumber(input.open);
  const high = providerNumber(input.high);
  const low = providerNumber(input.low);
  const close = providerNumber(input.close);
  const volume = providerNumber(input.volume);
  const adjustedClose = providerNumber(input.adjustedClose);
  if (timestamp === null || open === null || high === null || low === null || close === null || volume === null) return null;
  const parsed = normalizedCandleSchema.safeParse({
    timestamp: Math.trunc(timestamp), open, high, low, close, volume,
    ...(adjustedClose === null ? {} : { adjustedClose }),
    ...(input.session ? { session: input.session } : {}),
    ...(input.partial ? { partial: true } : {}),
  });
  return parsed.success ? parsed.data : null;
}

export function normalizeCandles(rows: readonly (NormalizedCandle | null)[]): {
  candles: NormalizedCandle[];
  invalidCount: number;
} {
  const byTimestamp = new Map<number, NormalizedCandle>();
  let invalidCount = 0;
  for (const row of rows) {
    if (!row) { invalidCount += 1; continue; }
    byTimestamp.set(row.timestamp, row);
  }
  return {
    candles: [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp),
    invalidCount,
  };
}

export function applyAdjustment(candle: NormalizedCandle): NormalizedCandle {
  if (candle.adjustedClose === undefined || candle.close === 0) return candle;
  const ratio = candle.adjustedClose / candle.close;
  if (!Number.isFinite(ratio) || ratio <= 0) return candle;
  return {
    ...candle,
    open: candle.open * ratio,
    high: candle.high * ratio,
    low: candle.low * ratio,
    close: candle.adjustedClose,
  };
}

