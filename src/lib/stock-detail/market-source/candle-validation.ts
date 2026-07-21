import type { LiveCandle } from './types';

/**
 * Normalized-event validation (production hardening).
 *
 * The gateway zod contract already rejects malformed OHLC and negative volume
 * on the wire, but the live engine must not trust that alone: a defence-in-depth
 * validator here rejects any incoming bucket that could corrupt the active
 * candle before it is merged or surfaced as a price. Two failures the wire
 * schema does NOT catch are handled here explicitly:
 *
 *  - a non-positive price (a 0 or negative close is not a tradeable value), and
 *  - a bucket dated in the future, which — if accepted — would advance
 *    `lastAppliedTime` past every legitimate subsequent bar and silently freeze
 *    the live candle.
 *
 * Nothing here fabricates, repairs or interpolates a value: an invalid bucket is
 * rejected outright and the previous accepted candle/price is preserved.
 */

/** Why a bucket was rejected, for diagnostics and tests. */
export type CandleRejectionReason =
  | 'non-finite-time'
  | 'future-timestamp'
  | 'non-positive-price'
  | 'negative-volume'
  | 'invalid-ohlc';

export interface CandleValidation {
  ok: boolean;
  reason: CandleRejectionReason | null;
}

export interface CandleValidationPolicy {
  /** Current wall-clock in ms; a bucket start beyond this (+ tolerance) is future-dated. */
  nowMs: number;
  /**
   * Clock-skew tolerance in seconds. A legitimate bucket start is always ≤ now;
   * this only absorbs minor client/exchange clock drift, so far-future buckets
   * (poisoned or badly clock-skewed data) are still rejected.
   */
  futureToleranceSeconds: number;
}

/** Default clock-skew tolerance: 2 minutes is generous for drift, tight for poison. */
export const DEFAULT_FUTURE_TOLERANCE_SECONDS = 120;

function reject(reason: CandleRejectionReason): CandleValidation {
  return { ok: false, reason };
}

/**
 * Validate an incoming OHLCV bucket against the accept policy. Returns a typed
 * result rather than throwing so the engine can route on the reason. `time` is a
 * unix-seconds bucket start; every OHLC field must be a finite positive number,
 * volume must be finite and non-negative, and the high/low must bound the other
 * OHLC fields.
 */
export function validateLiveCandle(candle: LiveCandle, policy: CandleValidationPolicy): CandleValidation {
  const { time, open, high, low, close, volume } = candle;

  if (!Number.isFinite(time)) return reject('non-finite-time');
  if (time * 1_000 > policy.nowMs + policy.futureToleranceSeconds * 1_000) return reject('future-timestamp');

  for (const value of [open, high, low, close]) {
    if (!Number.isFinite(value) || value <= 0) return reject('non-positive-price');
  }

  if (!Number.isFinite(volume) || volume < 0) return reject('negative-volume');

  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
    return reject('invalid-ohlc');
  }

  return { ok: true, reason: null };
}

/** Convenience guard for a scalar price used outside the candle path (snapshot price). */
export function isTradeablePrice(price: number | null | undefined): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}
