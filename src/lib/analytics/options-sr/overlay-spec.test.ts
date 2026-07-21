import { describe, expect, it } from 'vitest';
import { buildOptionsSrOverlay } from './overlay-spec';
import { optionsUnavailable } from './calculations';
import type { OptionsSrAvailable, OptionsLevel } from './types';

function level(price: number, source: OptionsLevel['source'], method: OptionsLevel['method']): OptionsLevel {
  return {
    price, distancePercent: 1.2, rawOI: 500, clusterOI: 1200, oiSharePercent: 42,
    method, source, expiration: '2026-08-21', asOf: '2026-07-21T00:00:00.000Z', reliability: 'high',
  };
}

const available: OptionsSrAvailable = {
  status: 'available', symbol: 'RKLB', expiration: '2026-08-21', acceptedPrice: 50,
  callWall: level(55, 'call-oi', 'call-oi-concentration'),
  putWall: level(45, 'put-oi', 'put-oi-concentration'),
  maxPain: level(50, 'max-pain', 'min-total-payout'),
  totalCallOI: 3000, totalPutOI: 2000, putCallOIRatio: 0.6667,
  strikeCoverage: 12, contractCoverage: 0.8, provider: 'alpha-vantage',
  asOf: '2026-07-21T00:00:00.000Z', dataMode: 'DELAYED', reliability: 'moderate', limitations: ['x'],
};

describe('buildOptionsSrOverlay', () => {
  it('emits Call Wall, Put Wall and a dashed Max Pain line with expiration + reliability labels', () => {
    const overlay = buildOptionsSrOverlay(available, true);
    expect(overlay.lines).toHaveLength(3);
    const call = overlay.lines.find((line) => line.id === 'options-call-wall')!;
    const put = overlay.lines.find((line) => line.id === 'options-put-wall')!;
    const pain = overlay.lines.find((line) => line.id === 'options-max-pain')!;
    expect(call.color).toBe('#fb7185'); // red
    expect(put.color).toBe('#34d399'); // green
    expect(pain.dashed).toBe(true); // neutral dashed
    expect(call.label).toContain('08-21');
    expect(call.label).toContain('high');
    expect(call.price).toBe(55);
  });

  it('returns an empty overlay when disabled or unavailable (failure isolation)', () => {
    expect(buildOptionsSrOverlay(available, false).lines).toHaveLength(0);
    const unavailable = optionsUnavailable('RKLB', '2026-08-21', 'entitlement-required', 'nope');
    expect(buildOptionsSrOverlay(unavailable, true).lines).toHaveLength(0);
    expect(buildOptionsSrOverlay(null, true).lines).toHaveLength(0);
  });

  it('never emits real-time wording', () => {
    expect(JSON.stringify(buildOptionsSrOverlay(available, true))).not.toMatch(/real[\s_-]?time/i);
  });
});
