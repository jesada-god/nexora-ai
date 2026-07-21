import { describe, expect, it } from 'vitest';
import { buildDecisionPanelModel } from './build';
import { resolveDedupTolerance } from './dedup';
import { makeAnchor, makeReference } from './fixtures';
import type { BuildDecisionPanelInput, NormalizedReference, OptionsSectionStatus } from './types';

const OPTIONS_OFF: OptionsSectionStatus = { status: 'off', reason: null, message: null, dataMode: null, retryable: true };

function references(): NormalizedReference[] {
  return [
    makeReference({ id: 'r-zone', midpoint: 104, priceLow: 103, priceHigh: 105, sourceType: 'd1-zone', sourceLabel: 'D1 Supply Zone', strength: 'strong', score: 80, reliability: 'high' }),
    makeReference({ id: 'r-poc', midpoint: 108, sourceType: 'poc', sourceLabel: 'POC', reliability: 'moderate' }),
    makeReference({ id: 's-zone', midpoint: 96, priceLow: 95, priceHigh: 97, sourceType: 'd1-zone', sourceLabel: 'D1 Demand Zone', strength: 'moderate', score: 60, reliability: 'moderate' }),
    makeReference({ id: 's-avwap', midpoint: 92, sourceType: 'avwap', sourceLabel: 'Anchored VWAP', reliability: 'moderate' }),
    makeReference({ id: 'n-poc', midpoint: 100, priceLow: 99, priceHigh: 101, sourceType: 'poc', sourceLabel: 'POC (straddle)' }),
  ];
}

function baseInput(overrides: Partial<BuildDecisionPanelInput> = {}): BuildDecisionPanelInput {
  return {
    references: references(),
    acceptedPrice: 100,
    anchor: makeAnchor({ price: 100 }),
    atrTolerance: resolveDedupTolerance({ atrValue: 2, acceptedPrice: 100 }),
    proximityThresholdPercent: 3,
    previousAlertSignature: null,
    maxPerSide: 3,
    options: OPTIONS_OFF,
    ...overrides,
  };
}

describe('buildDecisionPanelModel', () => {
  it('splits references into resistance (above), support (below) and neutral (straddling)', () => {
    const model = buildDecisionPanelModel(baseInput());
    expect(model.resistance.map((item) => item.id)).toEqual(['r-zone', 'r-poc']);
    expect(model.support.map((item) => item.id)).toEqual(['s-zone', 's-avwap']);
    expect(model.neutral.map((item) => item.id)).toEqual(['n-poc']);
  });

  it('caps each side at the maximum of 3 primary cards and returns the rest as extra', () => {
    const many: NormalizedReference[] = [101, 102, 103, 104, 105].map((price, index) =>
      makeReference({ id: `r${index}`, midpoint: price, sourceType: 'poc', sourceLabel: `R${index}` }));
    const model = buildDecisionPanelModel(baseInput({ references: many, atrTolerance: null }));
    expect(model.resistance).toHaveLength(3);
    expect(model.extraResistance).toHaveLength(2);
    expect(model.resistance.map((item) => item.id)).toEqual(['r0', 'r1', 'r2']);
  });

  it('shares the accepted price and timestamp on the current-price anchor', () => {
    const anchor = makeAnchor({ price: 100, exchangeTimestamp: '2026-07-21T20:00:00.000Z' });
    const model = buildDecisionPanelModel(baseInput({ anchor }));
    expect(model.anchor.price).toBe(100);
    expect(model.anchor.exchangeTimestamp).toBe('2026-07-21T20:00:00.000Z');
  });

  it('recomputes distance deterministically from the accepted price without refetching geometry', () => {
    const refs = references();
    const first = buildDecisionPanelModel(baseInput({ references: refs, acceptedPrice: 100, anchor: makeAnchor({ price: 100 }) }));
    const second = buildDecisionPanelModel(baseInput({ references: refs, acceptedPrice: 102, anchor: makeAnchor({ price: 102 }) }));
    // Same reference objects reused (no rebuild); only the projected distance changes.
    const zoneAt100 = first.resistance.find((item) => item.id === 'r-zone')!;
    const zoneAt102 = second.resistance.find((item) => item.id === 'r-zone')!;
    expect(zoneAt100.distancePercent).toBeCloseTo(4, 10);
    expect(zoneAt102.distancePercent).toBeCloseTo((104 - 102) / 102 * 100, 10);
    // Deterministic: rebuilding with identical inputs yields identical distance.
    const repeat = buildDecisionPanelModel(baseInput({ references: refs, acceptedPrice: 102, anchor: makeAnchor({ price: 102 }) }));
    expect(repeat.resistance.find((item) => item.id === 'r-zone')!.distancePercent).toBe(zoneAt102.distancePercent);
  });

  it('activates the proximity banner within 3% of a qualified level', () => {
    // r-zone midpoint 104 is 4% away at price 100; move price to 101.5 → 2.46%.
    const model = buildDecisionPanelModel(baseInput({ acceptedPrice: 101.5, anchor: makeAnchor({ price: 101.5 }) }));
    expect(model.alert.status).toBe('active');
    expect(model.alert.item?.distancePercent).toBeLessThanOrEqual(3);
  });

  it('isolates an options rate-limit: technical cards survive, options section reports typed status', () => {
    // Only technical references present (options rate-limited → no options refs).
    const model = buildDecisionPanelModel(baseInput({
      options: { status: 'unavailable', reason: 'rate-limited', message: 'Polygon is cooling down.', dataMode: null, retryable: true },
    }));
    expect(model.technicalAvailable).toBe(true);
    expect(model.resistance.length).toBeGreaterThan(0);
    expect(model.support.length).toBeGreaterThan(0);
    expect(model.options.status).toBe('unavailable');
    expect(model.options.reason).toBe('rate-limited');
  });

  it('marks entitlement failures non-retryable so 401/403 are never auto-retried', () => {
    const model = buildDecisionPanelModel(baseInput({
      options: { status: 'unavailable', reason: 'entitlement-required', message: 'Not entitled.', dataMode: null, retryable: false },
    }));
    expect(model.options.retryable).toBe(false);
  });

  it('never surfaces a REAL-TIME data mode on the anchor (DELAYED/EOD only)', () => {
    const model = buildDecisionPanelModel(baseInput({ anchor: makeAnchor({ dataMode: 'DELAYED' }) }));
    expect(['DELAYED', 'END-OF-DAY', 'CACHED', 'STALE', 'UNAVAILABLE']).toContain(model.anchor.dataMode);
    expect(model.anchor.dataMode).not.toBe('REAL-TIME');
  });

  it('produces nothing to project (and no alert) when the accepted price is unusable', () => {
    const model = buildDecisionPanelModel(baseInput({ acceptedPrice: null, anchor: makeAnchor({ price: null, dataMode: 'UNAVAILABLE', stale: true }) }));
    expect(model.resistance).toHaveLength(0);
    expect(model.support).toHaveLength(0);
    expect(model.alert.status).toBe('inactive');
  });
});
