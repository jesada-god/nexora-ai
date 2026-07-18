import { describe, expect, it, vi } from 'vitest';
import { resolveInstrumentSearch } from './search-resolution';

const freshness = { status: 'cached' as const, asOf: null, maxAgeSeconds: 30 };
const result = { symbol: 'SPY', name: 'SPDR', exchange: 'NYSE ARCA', assetType: 'ETF', currency: 'USD', status: 'active' as const, marketOpen: null, marketClose: null, timezone: null, matchScore: 1 };

describe('instrument search fallback', () => {
  it('uses the provider only when the instrument database is empty', async () => {
    const search = vi.fn().mockResolvedValue({ data: [result], freshness });
    expect((await resolveInstrumentSearch({ configured: true, databaseEmpty: true, result: null }, () => ({ search }), 'SPY', {})).data).toEqual([result]);
    expect(search).toHaveBeenCalledOnce();
  });
  it('does not call the provider when the master has data, even for an empty result set', async () => {
    const search = vi.fn();
    const masterResult = { data: [], freshness, provider: 'supabase-instrument-master' };
    const getProvider = vi.fn(() => ({ search }));
    expect((await resolveInstrumentSearch({ configured: true, databaseEmpty: false, result: masterResult }, getProvider, 'NONE', {})).data).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
  });
});
