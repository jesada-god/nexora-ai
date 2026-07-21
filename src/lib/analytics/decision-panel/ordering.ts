import type { DecisionPanelItem } from './types';

/**
 * Ordering and capping. Both sides are ranked nearest-to-price first (ascending
 * distance), so resistance shows the nearest level above and support the nearest
 * below. Ties break to the stronger reference, then the tighter band. The primary
 * view is capped; anything beyond the cap is returned separately for "show more".
 */

function byProximity(a: DecisionPanelItem, b: DecisionPanelItem): number {
  if (a.distancePercent !== b.distancePercent) return a.distancePercent - b.distancePercent;
  const scoreA = a.score ?? -1;
  const scoreB = b.score ?? -1;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return a.priceHigh - a.priceLow - (b.priceHigh - b.priceLow);
}

export interface OrderedSide {
  primary: DecisionPanelItem[];
  extra: DecisionPanelItem[];
}

/** Sort nearest-first and split into a capped primary set and the remainder. */
export function orderAndCap(items: readonly DecisionPanelItem[], maxPrimary: number): OrderedSide {
  const sorted = [...items].sort(byProximity);
  return { primary: sorted.slice(0, maxPrimary), extra: sorted.slice(maxPrimary) };
}
