import { describe, expect, it } from 'vitest';
import { calculateClassicPivotLevels, distancePercent } from './pivot-levels';

describe('option-tool classic pivot levels', () => {
  it('matches the legacy floor-trader formulas', () => {
    expect(calculateClassicPivotLevels({ high: 110, low: 90, close: 100 })).toEqual({
      pivot: 100,
      resistance: [110, 120, 130],
      support: [90, 80, 70],
    });
  });

  it('reports live distance without fabricating a price', () => {
    expect(distancePercent(105, 100)).toBeCloseTo(5);
    expect(distancePercent(105, null)).toBeNull();
    expect(distancePercent(105, 0)).toBeNull();
  });
});
