import { describe, expect, it } from 'vitest';
import { MarketDataError, mapProviderFailure } from './errors';

describe('market data provider error mapping', () => {
  it('maps HTTP 429 and preserves retry timing', () => {
    const error = mapProviderFailure({ status: 429, retryAfterSeconds: 30 });
    expect(error.code).toBe('rate-limited');
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.retryable).toBe(true);
  });

  it('marks a missing-provider configuration fault as non-retryable', () => {
    const error = new MarketDataError('provider-not-configured', 'Set POLYGON_API_KEY');
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(false);
    expect(error.toApiError().retryable).toBe(false);
  });

  it('maps Alpha Vantage frequency payloads to rate limiting', () => {
    const error = mapProviderFailure({
      payload: { Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is limited.' },
    });
    expect(error.code).toBe('rate-limited');
  });

  it('maps Alpha Vantage Information quota responses to 429 even when they mention an API key', () => {
    const error = mapProviderFailure({ payload: { Information: 'Thank you for using Alpha Vantage! You have reached the 25 requests per day limit for your API key.' } });
    expect(error.code).toBe('rate-limited');
    expect(error.status).toBe(429);
  });

  it('keeps an invalid key distinct from quota exhaustion', () => {
    const error = mapProviderFailure({ payload: { Information: 'The API key is invalid. Please visit Alpha Vantage.' } });
    expect(error.code).toBe('provider-unauthorized');
    expect(error.status).toBe(502);
  });

  it('maps plan entitlements to forbidden before generic 403 handling', () => {
    const error = mapProviderFailure({ status: 403, payload: { message: 'Upgrade your current plan or subscription.' } });
    expect(error.code).toBe('forbidden');
    expect(error.status).toBe(403);
  });

  it('never exposes an unrecognized raw provider message', () => {
    const error = mapProviderFailure({ payload: { message: 'internal vendor detail with request token' } });
    expect(error.code).toBe('invalid-provider-response');
    expect(error.message).not.toContain('request token');
  });

  it('maps invalid symbols separately', () => {
    const error = mapProviderFailure({ payload: { 'Error Message': 'Invalid API call. Please retry or visit the documentation.' } });
    expect(error.code).toBe('invalid-symbol'); expect(error.status).toBe(404);
  });

  it('maps aborted requests to timeouts', () => {
    const cause = new Error('timed out');
    cause.name = 'TimeoutError';
    expect(mapProviderFailure({ cause }).code).toBe('timeout');
  });

  it('maps authentication and upstream failures', () => {
    expect(mapProviderFailure({ status: 401 }).code).toBe('provider-unauthorized');
    expect(mapProviderFailure({ status: 503 }).code).toBe('upstream-unavailable');
  });
});
