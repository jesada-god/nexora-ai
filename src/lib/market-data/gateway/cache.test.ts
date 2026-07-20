import { describe, expect, it } from 'vitest';
import { gatewayBarsCacheKey } from './cache';
import type { ResolvedInstrument } from './contracts';

const instrument: ResolvedInstrument = {
  canonicalSymbol: 'BRK.B', providerSymbol: 'BRK.B', name: 'Berkshire Hathaway', assetType: 'stock',
  exchange: 'NYSE', mic: 'XNYS', currency: 'USD', timezone: 'America/New_York', active: true, supported: true, unsupportedReason: null,
};

describe('gateway cache key', () => {
  it('separates symbol, provider symbol, interval, range, adjustment, and session', () => {
    const base = { provider: 'polygon', instrument, interval: '5m' as const, range: '1d' as const, adjusted: false, session: 'regular' as const };
    expect(gatewayBarsCacheKey(base)).not.toBe(gatewayBarsCacheKey({ ...base, interval: '15m' }));
    expect(gatewayBarsCacheKey(base)).not.toBe(gatewayBarsCacheKey({ ...base, range: '5d' }));
    expect(gatewayBarsCacheKey(base)).not.toBe(gatewayBarsCacheKey({ ...base, session: 'extended' }));
  });
});

