import { describe, expect, it } from 'vitest';
import { mergeConfluence, resolveDedupTolerance } from './dedup';
import { makeItem } from './fixtures';

describe('resolveDedupTolerance', () => {
  it('prefers half the ATR, else 0.2% of price, else null', () => {
    expect(resolveDedupTolerance({ atrValue: 4, acceptedPrice: 100 })).toBe(2);
    expect(resolveDedupTolerance({ atrValue: null, acceptedPrice: 100 })).toBeCloseTo(0.2, 10);
    expect(resolveDedupTolerance({ atrValue: 0, acceptedPrice: 0 })).toBeNull();
    expect(resolveDedupTolerance({ atrValue: null, acceptedPrice: null })).toBeNull();
  });
});

describe('mergeConfluence', () => {
  it('merges references within the ATR tolerance and preserves every source badge', () => {
    const zone = makeItem({ id: 'zone-1', midpoint: 105, priceLow: 104, priceHigh: 106, sourceType: 'd1-zone', sourceLabel: 'D1 Supply Zone', side: 'resistance', distancePercent: 5, strength: 'strong', score: 80, reliability: 'high' });
    const poc = makeItem({ id: 'vrvp-poc', midpoint: 105.4, sourceType: 'poc', sourceLabel: 'Point of Control (POC)', side: 'resistance', distancePercent: 5.4, reliability: 'moderate' });
    const avwap = makeItem({ id: 'avwap', midpoint: 118, sourceType: 'avwap', sourceLabel: 'Anchored VWAP', side: 'resistance', distancePercent: 18 });

    // Tolerance 1.0 merges the zone + POC (0.4 apart) but not the far AVWAP.
    const merged = mergeConfluence([zone, poc, avwap], 1.0);
    expect(merged).toHaveLength(2);

    const confluenceCard = merged.find((item) => item.confluence.length > 1)!;
    expect(confluenceCard).toBeDefined();
    // The stronger (scored) zone is the representative and keeps its price.
    expect(confluenceCard.id).toBe('zone-1');
    expect(confluenceCard.midpoint).toBe(105);
    // Both source badges are preserved.
    const badgeTypes = confluenceCard.confluence.map((badge) => badge.sourceType).sort();
    expect(badgeTypes).toEqual(['d1-zone', 'poc']);
    // The merged band spans the union of both references.
    expect(confluenceCard.priceLow).toBe(104);
    expect(confluenceCard.priceHigh).toBe(106);
  });

  it('does not merge across the tolerance and keeps single-source badges', () => {
    const a = makeItem({ id: 'a', midpoint: 100, sourceType: 'poc', sourceLabel: 'POC', side: 'support', distancePercent: 1 });
    const b = makeItem({ id: 'b', midpoint: 103, sourceType: 'avwap', sourceLabel: 'AVWAP', side: 'support', distancePercent: 4 });
    const merged = mergeConfluence([a, b], 1.0);
    expect(merged).toHaveLength(2);
    expect(merged.every((item) => item.confluence.length === 1)).toBe(true);
  });

  it('disables merging when the tolerance is null', () => {
    const a = makeItem({ id: 'a', midpoint: 100, sourceType: 'poc', sourceLabel: 'POC', side: 'support', distancePercent: 1 });
    const b = makeItem({ id: 'b', midpoint: 100.05, sourceType: 'avwap', sourceLabel: 'AVWAP', side: 'support', distancePercent: 1.05 });
    expect(mergeConfluence([a, b], null)).toHaveLength(2);
  });

  it('marks a merged card stale only when every contributor is stale', () => {
    const fresh = makeItem({ id: 'fresh', midpoint: 100, sourceType: 'poc', sourceLabel: 'POC', side: 'support', distancePercent: 1, stale: false, score: 10 });
    const stale = makeItem({ id: 'stale', midpoint: 100.2, sourceType: 'call-wall', sourceLabel: 'Call Wall', side: 'support', distancePercent: 1.2, stale: true });
    const merged = mergeConfluence([fresh, stale], 1.0);
    expect(merged).toHaveLength(1);
    expect(merged[0].stale).toBe(false);
  });
});
