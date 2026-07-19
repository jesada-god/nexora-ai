import { describe, expect, it } from 'vitest';
import { resolveCompanyIdentity } from './identity';

describe('Stock Detail company identity', () => {
  it('uses the instrument master company name and exchange when Profile fails', () => {
    expect(resolveCompanyIdentity({
      symbol: 'RKLB',
      profile: null,
      instrument: {
        name: 'Rocket Lab USA, Inc.',
        exchange: 'NASDAQ',
      },
      quoteMetadata: { symbol: 'RKLB' },
    })).toEqual({
      name: 'Rocket Lab USA, Inc.',
      exchange: 'NASDAQ',
    });
  });

  it('keeps the documented Profile to instrument to Quote to symbol order', () => {
    expect(resolveCompanyIdentity({
      symbol: 'RKLB',
      profile: {
        symbol: 'RKLB',
        name: 'Profile name',
        description: null,
        exchange: 'PROFILE',
        currency: null,
        country: null,
        sector: null,
        industry: null,
        website: null,
        marketCapitalization: null,
        employees: null,
        fiscalYearEnd: null,
        latestQuarter: null,
      },
      instrument: { name: 'Instrument name', exchange: 'INSTRUMENT' },
      quoteMetadata: { name: 'Quote name', exchange: 'QUOTE', symbol: 'RKLB' },
    })).toEqual({ name: 'Profile name', exchange: 'PROFILE' });

    expect(resolveCompanyIdentity({
      symbol: 'RKLB',
      profile: null,
      instrument: null,
      quoteMetadata: { symbol: 'RKLB' },
    }).name).toBe('RKLB');
  });
});
