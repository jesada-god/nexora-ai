import { beforeEach, describe, expect, it } from 'vitest';
import { checkMarketDataRateLimit, clearMarketDataRateLimits } from './api-rate-limit';

const request = (ip = '203.0.113.7') => ({ headers: new Headers({ 'x-forwarded-for': `${ip}, 10.0.0.1` }) });

describe('public market-data rate limit', () => {
  beforeEach(clearMarketDataRateLimits);

  it('isolates operations and clients and returns a deterministic Retry-After', () => {
    expect(checkMarketDataRateLimit(request(), 'options', { limit: 1, windowMs: 60_000, now: 1_000 }).allowed).toBe(true);
    expect(checkMarketDataRateLimit(request(), 'options', { limit: 1, windowMs: 60_000, now: 2_000 })).toEqual({ allowed: false, retryAfterSeconds: 59 });
    expect(checkMarketDataRateLimit(request(), 'intraday', { limit: 1, windowMs: 60_000, now: 2_000 }).allowed).toBe(true);
    expect(checkMarketDataRateLimit(request('203.0.113.8'), 'options', { limit: 1, windowMs: 60_000, now: 2_000 }).allowed).toBe(true);
  });
});
