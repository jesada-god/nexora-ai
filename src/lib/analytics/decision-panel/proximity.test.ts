import { describe, expect, it } from 'vitest';
import { evaluateProximity } from './proximity';
import { makeAnchor, makeItem } from './fixtures';

const near = makeItem({ id: 'near', midpoint: 102, sourceType: 'd1-zone', sourceLabel: 'D1 Supply Zone', side: 'resistance', distancePercent: 2, reliability: 'high', strength: 'strong' });
const nearer = makeItem({ id: 'nearer', midpoint: 101, sourceType: 'poc', sourceLabel: 'POC', side: 'resistance', distancePercent: 1, reliability: 'moderate' });
const far = makeItem({ id: 'far', midpoint: 110, sourceType: 'avwap', sourceLabel: 'AVWAP', side: 'resistance', distancePercent: 10 });

describe('evaluateProximity', () => {
  it('activates within the 3% threshold and prefers the nearest qualified reference', () => {
    const alert = evaluateProximity([near, nearer, far], makeAnchor(), 3, null);
    expect(alert.status).toBe('active');
    expect(alert.item?.id).toBe('nearer');
    expect(alert.isNew).toBe(true);
    expect(alert.signature).toContain('resistance');
  });

  it('clears when the nearest qualified reference moves outside the threshold', () => {
    const alert = evaluateProximity([far], makeAnchor(), 3, null);
    expect(alert.status).toBe('inactive');
    expect(alert.item).toBeNull();
  });

  it('never triggers from a stale reference', () => {
    const staleLevel = makeItem({ id: 'stale', midpoint: 101, sourceType: 'call-wall', sourceLabel: 'Call Wall', side: 'resistance', distancePercent: 1, stale: true });
    expect(evaluateProximity([staleLevel], makeAnchor(), 3, null).status).toBe('inactive');
  });

  it('never triggers when the accepted price itself is stale or unavailable', () => {
    expect(evaluateProximity([nearer], makeAnchor({ stale: true }), 3, null).status).toBe('inactive');
    expect(evaluateProximity([nearer], makeAnchor({ dataMode: 'UNAVAILABLE' }), 3, null).status).toBe('inactive');
    expect(evaluateProximity([nearer], makeAnchor({ dataMode: 'STALE' }), 3, null).status).toBe('inactive');
    expect(evaluateProximity([nearer], makeAnchor({ price: null }), 3, null).status).toBe('inactive');
  });

  it('does not re-fire (isNew=false) while the same level stays active across ticks', () => {
    const first = evaluateProximity([nearer], makeAnchor({ price: 100 }), 3, null);
    expect(first.isNew).toBe(true);
    // Next tick, price nudged but the same level is still the nearest qualified one.
    const second = evaluateProximity([nearer], makeAnchor({ price: 100.2 }), 3, first.signature);
    expect(second.status).toBe('active');
    expect(second.signature).toBe(first.signature);
    expect(second.isNew).toBe(false);
  });

  it('marks isNew when a different level becomes the active one', () => {
    const first = evaluateProximity([nearer], makeAnchor(), 3, null);
    const second = evaluateProximity([near], makeAnchor(), 3, first.signature);
    expect(second.isNew).toBe(true);
    expect(second.signature).not.toBe(first.signature);
  });
});
