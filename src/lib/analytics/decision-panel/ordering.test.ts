import { describe, expect, it } from 'vitest';
import { orderAndCap } from './ordering';
import { makeItem } from './fixtures';

function resistance(id: string, distancePercent: number, score: number | null = null) {
  return makeItem({ id, midpoint: 100 + distancePercent, sourceType: 'd1-zone', sourceLabel: 'zone', side: 'resistance', distancePercent, score });
}
function support(id: string, distancePercent: number) {
  return makeItem({ id, midpoint: 100 - distancePercent, sourceType: 'd1-zone', sourceLabel: 'zone', side: 'support', distancePercent });
}

describe('orderAndCap', () => {
  it('orders resistance nearest-above first', () => {
    const ordered = orderAndCap([resistance('c', 6), resistance('a', 2), resistance('b', 4)], 3);
    expect(ordered.primary.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(ordered.extra).toHaveLength(0);
  });

  it('orders support nearest-below first', () => {
    const ordered = orderAndCap([support('c', 6), support('a', 2), support('b', 4)], 3);
    expect(ordered.primary.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('caps the primary view at the maximum per side and returns the rest as extra', () => {
    const items = [1, 2, 3, 4, 5].map((n) => resistance(`r${n}`, n));
    const ordered = orderAndCap(items, 3);
    expect(ordered.primary).toHaveLength(3);
    expect(ordered.primary.map((item) => item.id)).toEqual(['r1', 'r2', 'r3']);
    expect(ordered.extra.map((item) => item.id)).toEqual(['r4', 'r5']);
  });

  it('breaks distance ties toward the higher score', () => {
    const ordered = orderAndCap([resistance('weak', 3, 10), resistance('strong', 3, 90)], 3);
    expect(ordered.primary.map((item) => item.id)).toEqual(['strong', 'weak']);
  });
});
