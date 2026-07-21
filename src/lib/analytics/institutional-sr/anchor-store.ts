import type { AvwapAnchorPreset } from './anchored-vwap';

/**
 * Persisted Anchored-VWAP anchor, scoped by symbol + interval.
 *
 * A record is only accepted back if its symbol and interval match the current
 * selection, so an anchor from another symbol/interval is rejected rather than
 * silently reused on incompatible candles.
 */
export interface StoredAnchor {
  symbol: string;
  interval: string;
  /** A preset keyword or a specific candle time (ISO/`YYYY-MM-DD`). */
  anchor: AvwapAnchorPreset | { time: string };
  source: AvwapAnchorPreset | 'custom';
}

const STORAGE_PREFIX = 'nexora:avwap-anchor:v1';
const PRESETS: readonly AvwapAnchorPreset[] = ['latest-swing-low', 'latest-swing-high', 'earliest-visible'];

export function anchorStorageKey(symbol: string, interval: string): string {
  return `${STORAGE_PREFIX}:${symbol}:${interval}`;
}

function isPreset(value: unknown): value is AvwapAnchorPreset {
  return typeof value === 'string' && PRESETS.includes(value as AvwapAnchorPreset);
}

export function serializeAnchor(record: StoredAnchor): string {
  return JSON.stringify(record);
}

/**
 * Parse a stored anchor, returning it only when it is well-formed AND compatible
 * with the requested `symbol`/`interval`. Any mismatch or malformed payload
 * yields null (the incompatible anchor is rejected, never coerced).
 */
export function parseAnchor(value: string | null, symbol: string, interval: string): StoredAnchor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.symbol !== symbol || record.interval !== interval) return null;
    const source = record.source;
    if (!isPreset(source) && source !== 'custom') return null;
    if (isPreset(record.anchor)) return { symbol, interval, anchor: record.anchor, source };
    if (record.anchor && typeof record.anchor === 'object' && typeof (record.anchor as { time?: unknown }).time === 'string') {
      return { symbol, interval, anchor: { time: (record.anchor as { time: string }).time }, source };
    }
    return null;
  } catch {
    return null;
  }
}

export function readAnchor(storage: Storage | undefined, symbol: string, interval: string): StoredAnchor | null {
  if (!storage) return null;
  try {
    return parseAnchor(storage.getItem(anchorStorageKey(symbol, interval)), symbol, interval);
  } catch {
    return null;
  }
}

export function writeAnchor(storage: Storage | undefined, record: StoredAnchor): void {
  if (!storage) return;
  try {
    storage.setItem(anchorStorageKey(record.symbol, record.interval), serializeAnchor(record));
  } catch {
    /* private-mode / quota errors are non-fatal for an in-memory anchor */
  }
}

export function clearAnchor(storage: Storage | undefined, symbol: string, interval: string): void {
  if (!storage) return;
  try {
    storage.removeItem(anchorStorageKey(symbol, interval));
  } catch {
    /* ignore */
  }
}
