import { describe, expect, it } from 'vitest';
import {
  buildHealthReport,
  ConnectionRateGuard,
  DEFAULT_PORT,
  isOriginAllowed,
  redactSecrets,
  resolveAllowedOrigins,
  resolveGatewayPort,
  sanitizeError,
  SlidingWindowRateLimiter,
} from './runtime';

describe('resolveGatewayPort precedence', () => {
  it('prefers PORT over MARKET_WS_PORT over the default', () => {
    expect(resolveGatewayPort({ PORT: '9000', MARKET_WS_PORT: '8081' } as Record<string, string | undefined>)).toBe(9000);
    expect(resolveGatewayPort({ MARKET_WS_PORT: '8082' } as Record<string, string | undefined>)).toBe(8082);
    expect(resolveGatewayPort({} as Record<string, string | undefined>)).toBe(DEFAULT_PORT);
  });

  it('ignores blank or non-numeric values instead of coercing them', () => {
    expect(resolveGatewayPort({ PORT: '', MARKET_WS_PORT: '8083' } as Record<string, string | undefined>)).toBe(8083);
    expect(resolveGatewayPort({ PORT: 'not-a-port', MARKET_WS_PORT: '8084' } as Record<string, string | undefined>)).toBe(8084);
    expect(resolveGatewayPort({ PORT: '70000' } as Record<string, string | undefined>)).toBe(DEFAULT_PORT);
  });
});

describe('resolveAllowedOrigins', () => {
  it('parses a comma list into normalized origins and drops junk', () => {
    const origins = resolveAllowedOrigins({
      NEXORA_ALLOWED_ORIGINS: 'https://app.example.com/, https://staging.example.com , not a url',
    } as Record<string, string | undefined>);
    expect(origins).toEqual(['https://app.example.com', 'https://staging.example.com']);
  });

  it('returns an empty list when unset', () => {
    expect(resolveAllowedOrigins({} as Record<string, string | undefined>)).toEqual([]);
  });
});

describe('isOriginAllowed', () => {
  const allowedOrigins = ['https://app.example.com'];

  it('accepts an allow-listed origin in production', () => {
    expect(isOriginAllowed('https://app.example.com', { allowedOrigins, development: false })).toBe(true);
  });

  it('rejects an unknown origin in production', () => {
    expect(isOriginAllowed('https://evil.example.com', { allowedOrigins, development: false })).toBe(false);
  });

  it('rejects a missing Origin header in production but allows it in development', () => {
    expect(isOriginAllowed(undefined, { allowedOrigins, development: false })).toBe(false);
    expect(isOriginAllowed(undefined, { allowedOrigins, development: true })).toBe(true);
  });

  it('allows localhost only in development', () => {
    expect(isOriginAllowed('http://localhost:3000', { allowedOrigins: [], development: true })).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3000', { allowedOrigins: [], development: true })).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', { allowedOrigins: [], development: false })).toBe(false);
  });
});

describe('buildHealthReport', () => {
  it('reports ready only when the upstream is ready and never leaks a secret', () => {
    const report = buildHealthReport({
      upstreamState: 'ready',
      feed: 'iex',
      startedAt: 1_000,
      now: 61_000,
    });
    expect(report).toEqual({
      status: 'ready',
      upstreamState: 'ready',
      feed: 'iex',
      uptime: 60,
      timestamp: new Date(61_000).toISOString(),
    });
    // Only the documented, non-sensitive keys are present.
    expect(Object.keys(report).sort()).toEqual(['feed', 'status', 'timestamp', 'upstreamState', 'uptime']);
  });

  it('reports degraded for any non-ready upstream state', () => {
    for (const state of ['idle', 'connecting', 'authenticating', 'reconnecting', 'stopped'] as const) {
      expect(buildHealthReport({ upstreamState: state, feed: 'test', startedAt: 0, now: 0 }).status).toBe('degraded');
    }
  });
});

describe('rate limiting', () => {
  it('allows up to the limit inside the window then denies', () => {
    let clock = 0;
    const limiter = new SlidingWindowRateLimiter(2, 1_000, () => clock);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false); // over the limit
    clock += 1_000; // window elapsed
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('isolates the budget per key', () => {
    let clock = 0;
    const guard = new ConnectionRateGuard(1, 1_000, () => clock);
    expect(guard.allow('1.1.1.1')).toBe(true);
    expect(guard.allow('1.1.1.1')).toBe(false); // same IP exhausted
    expect(guard.allow('2.2.2.2')).toBe(true); // different IP unaffected
  });
});

describe('secret scrubbing', () => {
  const secret = 'super-secret-key-value';

  it('redacts a known secret embedded in text', () => {
    expect(redactSecrets(`auth failed for ${secret}`, [secret])).toBe('auth failed for ***');
    expect(redactSecrets('nothing sensitive', [secret])).toBe('nothing sensitive');
  });

  it('never echoes a secret through sanitizeError', () => {
    const line = sanitizeError(new Error(`connect failed key=${secret}`), [secret]);
    expect(line).not.toContain(secret);
    expect(line).toContain('Error:');
  });
});
