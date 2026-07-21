import { describe, expect, it, vi } from 'vitest';
import { OptionsExpirationsCoordinator, DEFAULT_EXPIRATIONS_COOLDOWN_MS } from './expirations-coordinator';
import type { ExpirationsOutcome } from './client';

function ok(expirations: string[] = ['2026-08-21']): ExpirationsOutcome {
  return { ok: true, expirations, provider: 'alpha-vantage', classification: null, message: null, retryAfterSeconds: null };
}
function rateLimited(retryAfterSeconds: number | null = 30): ExpirationsOutcome {
  return { ok: false, expirations: [], provider: null, classification: { reason: 'rate-limited', retryable: true, stopsPolling: false }, message: 'slow down', retryAfterSeconds };
}
function entitlement(): ExpirationsOutcome {
  return { ok: false, expirations: [], provider: null, classification: { reason: 'entitlement-required', retryable: false, stopsPolling: true }, message: 'not entitled', retryAfterSeconds: null };
}

describe('OptionsExpirationsCoordinator', () => {
  it('runs exactly one request per symbol once it succeeds, regardless of repeat calls', async () => {
    const fetcher = vi.fn(async () => ok());
    const coordinator = new OptionsExpirationsCoordinator(fetcher);
    await coordinator.load('RKLB');
    await coordinator.load('RKLB');
    await coordinator.load('rklb');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent callers onto a single in-flight request', async () => {
    let resolve!: (value: ExpirationsOutcome) => void;
    const fetcher = vi.fn(() => new Promise<ExpirationsOutcome>((r) => { resolve = r; }));
    const coordinator = new OptionsExpirationsCoordinator(fetcher);
    const a = coordinator.load('RKLB');
    const b = coordinator.load('RKLB');
    resolve(ok());
    await Promise.all([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honours a 429 cooldown from Retry-After and does not auto-retry until it lapses', async () => {
    let now = 1_000_000;
    const fetcher = vi.fn(async () => rateLimited(30));
    const coordinator = new OptionsExpirationsCoordinator(fetcher, () => now);
    const first = await coordinator.load('RKLB');
    expect(first.classification?.reason).toBe('rate-limited');
    expect(coordinator.isCoolingDown('RKLB')).toBe(true);

    // Within the 30s cooldown → served from cache, no new request.
    now += 20_000;
    await coordinator.load('RKLB');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // After the cooldown lapses → one fresh attempt is allowed.
    now += 11_000;
    expect(coordinator.isCoolingDown('RKLB')).toBe(false);
    await coordinator.load('RKLB');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('falls back to the default cooldown when a 429 supplies no Retry-After', async () => {
    let now = 0;
    const fetcher = vi.fn(async () => rateLimited(null));
    const coordinator = new OptionsExpirationsCoordinator(fetcher, () => now);
    await coordinator.load('RKLB');
    now += DEFAULT_EXPIRATIONS_COOLDOWN_MS - 1;
    await coordinator.load('RKLB');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never auto-retries a permanent entitlement block', async () => {
    let now = 0;
    const fetcher = vi.fn(async () => entitlement());
    const coordinator = new OptionsExpirationsCoordinator(fetcher, () => now);
    await coordinator.load('RKLB');
    now += 10 * 60_000;
    await coordinator.load('RKLB');
    coordinator.reset('RKLB'); // reset must not defeat an entitlement block
    await coordinator.load('RKLB');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reset() clears a rate-limit cooldown so a user-initiated retry can re-fetch', async () => {
    let now = 0;
    const fetcher = vi.fn(async () => rateLimited(300));
    const coordinator = new OptionsExpirationsCoordinator(fetcher, () => now);
    await coordinator.load('RKLB');
    coordinator.reset('RKLB');
    await coordinator.load('RKLB');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
