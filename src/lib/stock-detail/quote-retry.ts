import type { MarketDataApiError } from '@/src/lib/market-data/types';

/**
 * Decides whether the Stock Detail quote may be re-fetched automatically
 * (initial load during a live session, visibility refresh and the polling timer).
 *
 * Non-retryable provider outcomes — application/provider auth (401), provider
 * entitlement (403 forbidden), invalid request (400), invalid symbol and
 * provider-not-configured — MUST never trigger an automatic retry, otherwise a
 * single 403 turns into an unbounded background request storm. Only transient
 * failures (timeout, rate-limit with Retry-After, upstream/network) stay
 * eligible, and those are already flagged `retryable: true` by the gateway.
 *
 * A `null` error means the last load succeeded (or has not run yet), so the
 * automatic paths are allowed to (re)load.
 */
export function quoteErrorIsAutoRetryable(error: MarketDataApiError | null | undefined): boolean {
  if (!error) return true;
  return error.retryable === true;
}
