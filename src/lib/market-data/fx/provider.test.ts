import { describe, expect, it, vi } from 'vitest';
import {
  AlphaVantageFxProvider,
  FrankfurterFxProvider,
} from './provider';

describe('Alpha Vantage FX provider', () => {
  it('separates a missing key without making an upstream request', async () => {
    const fetchImpl = vi.fn();

    await expect(
      new AlphaVantageFxProvider(
        undefined,
        fetchImpl as never,
      ).getRate('USD', 'THB'),
    ).rejects.toMatchObject({
      code: 'missing-key',
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies an invalid-key payload returned with HTTP 200', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      Information: 'The API key is invalid. Please visit Alpha Vantage.',
    }), { status: 200 }));

    await expect(
      new AlphaVantageFxProvider(
        'invalid-key-value',
        fetchImpl,
      ).getRate('USD', 'THB'),
    ).rejects.toMatchObject({
      code: 'invalid-key',
      status: 502,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('classifies a rate-limit payload without retrying it', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      Note: 'Our standard API call frequency is limited.',
    }), { status: 200 }));

    await expect(
      new AlphaVantageFxProvider(
        'configured-key',
        fetchImpl,
      ).getRate('USD', 'THB'),
    ).rejects.toMatchObject({
      code: 'rate-limit',
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries one upstream 5xx response and keeps it distinct', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      message: 'temporarily unavailable',
    }), { status: 503 }));

    await expect(
      new AlphaVantageFxProvider(
        'configured-key',
        fetchImpl,
      ).getRate('USD', 'THB'),
    ).rejects.toMatchObject({
      code: 'upstream-error',
      status: 502,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('bounds timeout retries and reports timeout separately', async () => {
    const timeout = Object.assign(new Error('request timed out'), {
      name: 'TimeoutError',
    });
    const fetchImpl = vi.fn(async () => {
      throw timeout;
    });

    await expect(
      new AlphaVantageFxProvider(
        'configured-key',
        fetchImpl as never,
      ).getRate('USD', 'THB'),
    ).rejects.toMatchObject({
      code: 'timeout',
      status: 504,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

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
