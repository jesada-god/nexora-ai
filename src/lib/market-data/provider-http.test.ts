import { describe, expect, it, vi } from 'vitest';
import { ProviderCircuitBreaker, ProviderHttpClient } from './provider-http';

const input = {
  provider: 'test-provider', operation: 'test-operation', route: '/api/test', symbol: 'RKLB',
  url: new URL('https://example.com/data?apikey=secret'),
};

describe('provider HTTP reliability', () => {
  it('retries transient responses with a bounded deterministic backoff', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'temporarily unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ ok: true }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = vi.fn();
    const client = new ProviderHttpClient({ fetcher, sleep, random: () => 0, logger });
    await expect(client.json(input)).resolves.toEqual({ data: [{ ok: true }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(150);
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret');
  });

  it('honors a long Retry-After by returning 429 without retrying early', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Note: 'rate limit' }), {
      status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' },
    }));
    const client = new ProviderHttpClient({ fetcher, sleep: vi.fn(), logger: vi.fn() });
    await expect(client.json(input)).rejects.toMatchObject({ code: 'rate-limited', retryAfterSeconds: 60 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('opens a provider-operation circuit after repeated transient failures', async () => {
    let now = 1_000;
    const breaker = new ProviderCircuitBreaker(3, 60_000, () => now);
    const fetcher = vi.fn().mockRejectedValue(new TypeError('network'));
    const client = new ProviderHttpClient({ fetcher, breaker, now: () => now, logger: vi.fn() });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(client.json({ ...input, maxAttempts: 1 })).rejects.toMatchObject({ code: 'upstream-unavailable' });
      now += 1;
    }
    await expect(client.json({ ...input, maxAttempts: 1 })).rejects.toMatchObject({ code: 'provider-unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
