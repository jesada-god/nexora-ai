import { describe, expect, it } from 'vitest';
import { mapProviderFailure } from './errors';

describe('market data provider error mapping', () => {
  it('maps HTTP 429 and preserves retry timing', () => {
    const error = mapProviderFailure({ status: 429, retryAfterSeconds: 30 });
    expect(error.code).toBe('rate-limited');
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.retryable).toBe(true);
  });

  it('maps Alpha Vantage frequency payloads to rate limiting', () => {
    const error = mapProviderFailure({
      payload: { Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is limited.' },
    });
    expect(error.code).toBe('rate-limited');
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
