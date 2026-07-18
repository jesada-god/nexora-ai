import { describe, expect, it, vi } from 'vitest';
import { SharedRequestCache } from './shared-request-cache';

describe('SharedRequestCache', () => {
  it('deduplicates concurrent requests for the same key', async () => {
    const cache = new SharedRequestCache(); const operation = vi.fn(async () => 'value');
    const [a, b] = await Promise.all([cache.resolve('history:AAPL:1m', operation, { freshMs: 1, staleMs: 1000, errorMs: 10 }), cache.resolve('history:AAPL:1m', operation, { freshMs: 1, staleMs: 1000, errorMs: 10 })]);
    expect(a.value).toBe('value'); expect(b.value).toBe('value'); expect(operation).toHaveBeenCalledTimes(1);
  });

  it('uses stale data after a provider failure', async () => {
    vi.useFakeTimers(); const cache = new SharedRequestCache(); const policy = { freshMs: 10, staleMs: 1000, errorMs: 100 };
    await cache.resolve('history:AAPL:1m', async () => 'old', policy); vi.advanceTimersByTime(11);
    const result = await cache.resolve('history:AAPL:1m', async () => { throw new Error('quota'); }, policy);
    expect(result).toEqual({ value: 'old', state: 'stale' }); vi.useRealTimers();
  });

  it('keeps history ranges in separate cache keys', async () => {
    const cache = new SharedRequestCache(); const operation = vi.fn(async (value: string) => value); const policy = { freshMs: 1000, staleMs: 1000, errorMs: 10 };
    await cache.resolve('history:AAPL:1m', () => operation('1m'), policy); await cache.resolve('history:AAPL:1y', () => operation('1y'), policy);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
