import { describe, expect, it, vi } from 'vitest';
import { FrankfurterFxProvider } from './provider';

describe('Frankfurter FX provider', () => {
  it('validates and normalizes the keyless USD/THB response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ date: '2026-07-17', base: 'USD', quote: 'THB', rate: 32.123456789 }), { status: 200 }));
    const result = await new FrankfurterFxProvider(fetchImpl).getRate('USD', 'THB');
    expect(result).toMatchObject({ rate: '32.12345679', source: 'frankfurter', cached: false, stale: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses one bounded retry and rejects an invalid response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ date: 'invalid', base: 'USD', quote: 'THB', rate: 0 }), { status: 200 }));
    await expect(new FrankfurterFxProvider(fetchImpl).getRate('USD', 'THB')).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
