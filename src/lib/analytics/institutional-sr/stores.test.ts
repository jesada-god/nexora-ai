import { describe, expect, it } from 'vitest';
import { anchorStorageKey, parseAnchor, serializeAnchor, type StoredAnchor } from './anchor-store';
import { DEFAULT_OVERLAY_TOGGLES, parseOverlayToggles, serializeOverlayToggles } from './overlay-preferences';
import { buildInstitutionalOverlaySpec } from './overlay-spec';
import type { InstitutionalZone } from './types';

describe('avwap anchor store', () => {
  const anchor: StoredAnchor = { symbol: 'AAPL', interval: '1D', anchor: { time: '2026-01-03' }, source: 'custom' };

  it('scopes the storage key by symbol + interval', () => {
    expect(anchorStorageKey('AAPL', '1D')).not.toBe(anchorStorageKey('AAPL', '5m'));
    expect(anchorStorageKey('AAPL', '1D')).not.toBe(anchorStorageKey('MSFT', '1D'));
  });

  it('round-trips a compatible anchor', () => {
    expect(parseAnchor(serializeAnchor(anchor), 'AAPL', '1D')).toEqual(anchor);
    const preset: StoredAnchor = { symbol: 'AAPL', interval: '1D', anchor: 'latest-swing-low', source: 'latest-swing-low' };
    expect(parseAnchor(serializeAnchor(preset), 'AAPL', '1D')).toEqual(preset);
  });

  it('rejects an anchor from a different symbol or interval', () => {
    expect(parseAnchor(serializeAnchor(anchor), 'MSFT', '1D')).toBeNull();
    expect(parseAnchor(serializeAnchor(anchor), 'AAPL', '5m')).toBeNull();
    expect(parseAnchor('not json', 'AAPL', '1D')).toBeNull();
    expect(parseAnchor(null, 'AAPL', '1D')).toBeNull();
  });
});

describe('overlay toggles store', () => {
  it('round-trips and falls back to defaults on malformed input', () => {
    const toggles = { zones: false, volumeProfile: true, anchoredVwap: true };
    expect(parseOverlayToggles(serializeOverlayToggles(toggles))).toEqual(toggles);
    expect(parseOverlayToggles('garbage')).toEqual(DEFAULT_OVERLAY_TOGGLES);
    expect(parseOverlayToggles(null)).toEqual(DEFAULT_OVERLAY_TOGGLES);
    expect(parseOverlayToggles('{"zones":true}')).toEqual({ ...DEFAULT_OVERLAY_TOGGLES, zones: true });
  });
});

describe('overlay spec builder', () => {
  const zone: InstitutionalZone = {
    id: 'demand-1', type: 'demand', low: 90, high: 92, midpoint: 91, score: 72, strength: 'strong',
    touches: 3, distancePercent: 9, referenceTimeframe: '1D', sources: [], scoreComponents: { touches: 1, recency: 1, rejection: 1, volume: 1, psychological: 0, confluence: null },
    firstConfirmedAt: '2026-01-01', lastTouchedAt: '2026-01-10', calculatedAt: '2026-02-01',
  };

  it('emits bands only when zones are toggled on', () => {
    const off = buildInstitutionalOverlaySpec({ zones: [zone], showZones: false, showVolumeProfile: false, showAnchoredVwap: false });
    expect(off.bands).toHaveLength(0);
    const on = buildInstitutionalOverlaySpec({ zones: [zone], showZones: true, showVolumeProfile: false, showAnchoredVwap: false });
    expect(on.bands).toHaveLength(1);
    expect(on.bands[0].low).toBe(90);
    expect(on.bands[0].high).toBe(92);
    expect(on.bands[0].label).toContain('D1');
  });
});
