import {
  normalizedBarSchema,
  normalizedQuoteSchema,
  normalizedTradeSchema,
  normalizedTradingStatusSchema,
  type NormalizedMarketEvent,
} from './events';

/**
 * Pure mappers from Alpaca's IEX/SIP wire messages to normalized events.
 *
 * No network or state here — the Gateway feeds raw parsed JSON in and gets
 * validated normalized events out (or null for lines that are not market data
 * or that fail validation, e.g. a non-positive price or a future-dated tick the
 * schema rejects). This is the only place that understands Alpaca's `T`
 * discriminator and its RFC-3339 nanosecond timestamps.
 */

/**
 * Alpaca timestamps are RFC-3339 with up to nanosecond precision
 * (`2024-01-02T15:04:05.123456789Z`). `Date.parse` is only reliable to
 * milliseconds, so truncate any fractional part beyond 3 digits first.
 */
export function rfc3339ToMillis(value: string): number | null {
  const truncated = value.replace(/(\.\d{3})\d+(?=[Z+\-])/, '$1');
  const ms = Date.parse(truncated);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Nasdaq/UTP trading-action codes Alpaca reports in `sc` that mean the symbol is
 * NOT currently tradeable. Anything else (notably `T` = resumption, `Q` = quote
 * only pre-open) is treated as not halted, so we never falsely claim a halt.
 */
const HALT_CODES = new Set([
  'H', // Trading Halt
  'LUDP', // Volatility Trading Pause
  'LUDS', // Volatility Trading Pause – Straddle
  'MWC1', 'MWC2', 'MWC3', 'MWCA', 'MWCB', 'MWCC', // Market-Wide Circuit Breakers
  'PAUSE',
  'D', // Delisted
]);

export function isHaltCode(code: string): boolean {
  return HALT_CODES.has(code.toUpperCase());
}

interface AlpacaMessage {
  T?: unknown;
  S?: unknown;
  [key: string]: unknown;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Map a single Alpaca wire message to a normalized event, or null when it is not
 * market data (control frames), is missing required fields, or fails the
 * normalized schema (which rejects non-positive prices and bad timestamps).
 */
export function normalizeAlpacaMessage(message: unknown): NormalizedMarketEvent | null {
  if (typeof message !== 'object' || message === null) return null;
  const msg = message as AlpacaMessage;
  const type = str(msg.T);
  const symbol = str(msg.S);
  if (!type) return null;

  switch (type) {
    case 't': {
      if (!symbol) return null;
      const price = num(msg.p);
      const size = num(msg.s);
      const ts = str(msg.t);
      if (price === null || size === null || !ts) return null;
      const timestampMs = rfc3339ToMillis(ts);
      if (timestampMs === null) return null;
      const parsed = normalizedTradeSchema.safeParse({
        kind: 'trade',
        symbol: symbol.toUpperCase(),
        price,
        size,
        timestampMs,
        ...(Array.isArray(msg.c) ? { conditions: msg.c.filter((c): c is string => typeof c === 'string') } : {}),
        ...(str(msg.z) ? { tape: str(msg.z)! } : {}),
      });
      return parsed.success ? parsed.data : null;
    }
    case 'q': {
      if (!symbol) return null;
      const bidPrice = num(msg.bp);
      const bidSize = num(msg.bs);
      const askPrice = num(msg.ap);
      const askSize = num(msg.as);
      const ts = str(msg.t);
      if (bidPrice === null || bidSize === null || askPrice === null || askSize === null || !ts) return null;
      const timestampMs = rfc3339ToMillis(ts);
      if (timestampMs === null) return null;
      const parsed = normalizedQuoteSchema.safeParse({
        kind: 'quote',
        symbol: symbol.toUpperCase(),
        bidPrice,
        bidSize,
        askPrice,
        askSize,
        timestampMs,
      });
      return parsed.success ? parsed.data : null;
    }
    case 'b':
    case 'u': {
      if (!symbol) return null;
      const open = num(msg.o);
      const high = num(msg.h);
      const low = num(msg.l);
      const close = num(msg.c);
      const volume = num(msg.v);
      const ts = str(msg.t);
      if (open === null || high === null || low === null || close === null || volume === null || !ts) return null;
      const timestampMs = rfc3339ToMillis(ts);
      if (timestampMs === null) return null;
      const parsed = normalizedBarSchema.safeParse({
        kind: 'bar',
        symbol: symbol.toUpperCase(),
        open,
        high,
        low,
        close,
        volume,
        timestampMs,
        updated: type === 'u',
      });
      return parsed.success ? parsed.data : null;
    }
    case 's': {
      if (!symbol) return null;
      const statusCode = str(msg.sc) ?? '';
      const ts = str(msg.t);
      const timestampMs = ts ? rfc3339ToMillis(ts) : Date.now();
      if (timestampMs === null) return null;
      const parsed = normalizedTradingStatusSchema.safeParse({
        kind: 'status',
        symbol: symbol.toUpperCase(),
        statusCode,
        statusMessage: str(msg.sm) ?? '',
        ...(str(msg.rc) ? { reasonCode: str(msg.rc)! } : {}),
        ...(str(msg.rm) ? { reasonMessage: str(msg.rm)! } : {}),
        timestampMs,
        halted: isHaltCode(statusCode),
      });
      return parsed.success ? parsed.data : null;
    }
    default:
      return null;
  }
}

/** Alpaca control frames the Gateway uses to drive its handshake state machine. */
export type AlpacaControl =
  | { kind: 'success'; message: string }
  | { kind: 'error'; code: number | null; message: string }
  | { kind: 'subscription' };

/** Classify a non-market Alpaca control frame, or null when it is market data. */
export function classifyAlpacaControl(message: unknown): AlpacaControl | null {
  if (typeof message !== 'object' || message === null) return null;
  const msg = message as AlpacaMessage;
  switch (str(msg.T)) {
    case 'success':
      return { kind: 'success', message: str(msg.msg) ?? '' };
    case 'error':
      return { kind: 'error', code: num(msg.code), message: str(msg.msg) ?? '' };
    case 'subscription':
      return { kind: 'subscription' };
    default:
      return null;
  }
}
