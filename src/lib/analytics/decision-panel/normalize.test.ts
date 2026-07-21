import { describe, expect, it } from 'vitest';
import type { InstitutionalZone } from '@/src/lib/analytics/institutional-sr/types';
import type { VisibleRangeVolumeProfile } from '@/src/lib/analytics/institutional-sr/visible-range-profile';
import type { AnchoredVwapResult } from '@/src/lib/analytics/institutional-sr/anchored-vwap';
import type { OptionsSrResult } from '@/src/lib/analytics/options-sr/types';
import { anchoredVwapReferences, collectReferences, optionsReferences, volumeProfileReferences, zoneReferences } from './normalize';

function zone(overrides: Partial<InstitutionalZone> & Pick<InstitutionalZone, 'id' | 'type' | 'low' | 'high'>): InstitutionalZone {
  const midpoint = (overrides.low + overrides.high) / 2;
  return {
    midpoint,
    score: 70,
    strength: 'strong',
    touches: 3,
    distancePercent: 0,
    referenceTimeframe: '1D',
    sources: [],
    scoreComponents: { touches: 1, recency: 1, rejection: 1, volume: null, psychological: 0, confluence: null },
    firstConfirmedAt: '2026-06-01T00:00:00.000Z',
    lastTouchedAt: '2026-07-20T00:00:00.000Z',
    calculatedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
    id: overrides.id,
    type: overrides.type,
    low: overrides.low,
    high: overrides.high,
  } as InstitutionalZone;
}

describe('zoneReferences', () => {
  it('maps D1 zones to references with a band, strength, score and reliability', () => {
    const refs = zoneReferences([zone({ id: '1', type: 'supply', low: 104, high: 106, strength: 'strong', score: 82 })]);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: 'zone-1',
      priceLow: 104,
      priceHigh: 106,
      midpoint: 105,
      sourceType: 'd1-zone',
      referenceTimeframe: '1D',
      reliability: 'high',
      stale: false,
    });
  });
});

describe('volumeProfileReferences', () => {
  const profile: VisibleRangeVolumeProfile = {
    provenance: 'ohlcv-approximation',
    methodology: 'test',
    bins: 24,
    valueAreaPercent: 0.7,
    visibleFrom: '2026-07-01T00:00:00.000Z',
    visibleTo: '2026-07-21T00:00:00.000Z',
    candleCount: 20,
    coverage: 0.9,
    status: 'available',
    profile: [],
    poc: 100,
    vah: 104,
    val: 96,
    hvn: [],
    lvn: [],
    totalVolume: 1000,
  };

  it('emits POC, VAH and VAL single-price references', () => {
    const refs = volumeProfileReferences(profile);
    expect(refs.map((ref) => ref.sourceType)).toEqual(['poc', 'vah', 'val']);
    expect(refs.every((ref) => ref.priceLow === ref.priceHigh)).toBe(true);
    expect(refs[0].reliability).toBe('high'); // coverage 0.9
  });

  it('returns nothing for an unavailable profile', () => {
    expect(volumeProfileReferences({ ...profile, status: 'unavailable', reason: 'x' } as VisibleRangeVolumeProfile)).toEqual([]);
  });
});

describe('anchoredVwapReferences', () => {
  it('maps an available AVWAP to one reference', () => {
    const avwap: AnchoredVwapResult = {
      methodology: 'test', anchorTime: '2026-07-01T00:00:00.000Z', anchorIndex: 0, anchorSource: 'earliest-visible',
      status: 'available', points: [{ time: '2026-07-21T00:00:00.000Z', value: 99 }], value: 99,
    };
    const refs = anchoredVwapReferences(avwap);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ sourceType: 'avwap', midpoint: 99, reliability: 'moderate' });
  });

  it('returns nothing when unavailable', () => {
    expect(anchoredVwapReferences({ methodology: 't', anchorTime: null, anchorIndex: null, anchorSource: null, status: 'unavailable', reason: 'x' })).toEqual([]);
  });
});

describe('optionsReferences', () => {
  const available: OptionsSrResult = {
    status: 'available', symbol: 'RKLB', expiration: '2026-08-21', acceptedPrice: 100,
    callWall: { price: 110, distancePercent: 10, rawOI: 500, clusterOI: 900, oiSharePercent: 30, method: 'call-oi-concentration', source: 'call-oi', expiration: '2026-08-21', asOf: '2026-07-21T20:00:00.000Z', reliability: 'high' },
    putWall: { price: 90, distancePercent: 10, rawOI: 400, clusterOI: 800, oiSharePercent: 28, method: 'put-oi-concentration', source: 'put-oi', expiration: '2026-08-21', asOf: '2026-07-21T20:00:00.000Z', reliability: 'moderate' },
    maxPain: { price: 100, distancePercent: 0, rawOI: 0, clusterOI: 0, oiSharePercent: 0, method: 'min-total-payout', source: 'max-pain', expiration: '2026-08-21', asOf: '2026-07-21T20:00:00.000Z', reliability: 'low' },
    totalCallOI: 3000, totalPutOI: 2800, putCallOIRatio: 0.93, strikeCoverage: 20, contractCoverage: 0.95,
    provider: 'alphavantage', asOf: '2026-07-21T20:00:00.000Z', dataMode: 'DELAYED', reliability: 'high',
    limitations: ['Options-derived reference level'],
  };

  it('maps Call Wall, Put Wall and Max Pain with expirations and the reference disclaimer', () => {
    const refs = optionsReferences(available);
    expect(refs.map((ref) => ref.sourceType)).toEqual(['call-wall', 'put-wall', 'max-pain']);
    expect(refs.every((ref) => ref.expiration === '2026-08-21')).toBe(true);
    expect(refs[0].limitations[0]).toMatch(/Options-derived reference level/);
    expect(refs.every((ref) => ref.stale === false)).toBe(true);
  });

  it('marks references stale when the options data mode is STALE', () => {
    const refs = optionsReferences({ ...available, dataMode: 'STALE' });
    expect(refs.every((ref) => ref.stale === true)).toBe(true);
  });

  it('returns nothing for an unavailable (e.g. rate-limited) options result', () => {
    const unavailable: OptionsSrResult = { status: 'unavailable', symbol: 'RKLB', expiration: null, reason: 'rate-limited', message: 'cooling down', provider: 'alphavantage', asOf: null, dataMode: null, limitations: [] };
    expect(optionsReferences(unavailable)).toEqual([]);
  });
});

describe('collectReferences', () => {
  it('gathers references from every available source', () => {
    const refs = collectReferences({
      zones: [zone({ id: '1', type: 'supply', low: 104, high: 106 })],
      anchoredVwap: { methodology: 't', anchorTime: null, anchorIndex: 0, anchorSource: 'earliest-visible', status: 'available', points: [{ time: 't', value: 99 }], value: 99 },
    });
    expect(refs.map((ref) => ref.sourceType).sort()).toEqual(['avwap', 'd1-zone']);
  });
});
