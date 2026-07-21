import { describe, expect, it } from 'vitest';
import type { MarketDataApiError } from '@/src/lib/market-data/types';
import { quoteErrorIsAutoRetryable } from './quote-retry';

function apiError(code: MarketDataApiError['code'], retryable: boolean): MarketDataApiError {
  return { code, message: `${code} error`, retryable };
}

describe('quoteErrorIsAutoRetryable', () => {
  it('allows automatic (re)loads when there is no error', () => {
    expect(quoteErrorIsAutoRetryable(null)).toBe(true);
    expect(quoteErrorIsAutoRetryable(undefined)).toBe(true);
  });

  it('blocks automatic retries for a provider entitlement 403 (forbidden)', () => {
    expect(quoteErrorIsAutoRetryable(apiError('forbidden', false))).toBe(false);
  });

  it('blocks automatic retries for auth (401), invalid request (400/404) and missing configuration', () => {
    expect(quoteErrorIsAutoRetryable(apiError('provider-unauthorized', false))).toBe(false);
    expect(quoteErrorIsAutoRetryable(apiError('invalid-request', false))).toBe(false);
    expect(quoteErrorIsAutoRetryable(apiError('invalid-symbol', false))).toBe(false);
    expect(quoteErrorIsAutoRetryable(apiError('provider-not-configured', false))).toBe(false);
  });

  it('keeps transient failures eligible for automatic retry', () => {
    expect(quoteErrorIsAutoRetryable(apiError('rate-limited', true))).toBe(true);
    expect(quoteErrorIsAutoRetryable(apiError('timeout', true))).toBe(true);
    expect(quoteErrorIsAutoRetryable(apiError('upstream-unavailable', true))).toBe(true);
  });
});
