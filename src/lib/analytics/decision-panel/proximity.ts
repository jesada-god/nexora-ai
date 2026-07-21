import type { CurrentPriceAnchor, DecisionPanelItem, ProximityAlert } from './types';

/**
 * Proximity alerting. A banner activates only when the accepted price is within a
 * configurable threshold (default 3%) of a *qualified* reference — one whose
 * source data is neither stale nor unavailable, and whose accepted price is fresh.
 * The nearest qualified reference is preferred. A stable signature (level band +
 * side) keeps the banner identity constant while the same level stays active, so
 * re-projection on every price tick never spams a fresh alert.
 */

export const DEFAULT_PROXIMITY_THRESHOLD_PERCENT = 3;

/** A reference qualifies for an alert only when it and the accepted price are fresh. */
export function isQualified(item: DecisionPanelItem, anchor: CurrentPriceAnchor): boolean {
  if (anchor.stale || anchor.price == null) return false;
  if (anchor.dataMode === 'STALE' || anchor.dataMode === 'UNAVAILABLE') return false;
  return !item.stale;
}

/** Stable identity of the alerted level; constant across ticks while the same level is active. */
export function alertSignature(item: DecisionPanelItem): string {
  const low = item.priceLow.toFixed(2);
  const high = item.priceHigh.toFixed(2);
  return `${item.side}:${item.sourceType}:${low}-${high}`;
}

export function evaluateProximity(
  items: readonly DecisionPanelItem[],
  anchor: CurrentPriceAnchor,
  thresholdPercent: number,
  previousSignature: string | null,
): ProximityAlert {
  const inactive: ProximityAlert = {
    status: 'inactive',
    thresholdPercent,
    item: null,
    signature: null,
    isNew: false,
  };
  if (anchor.stale || anchor.price == null) return inactive;

  const qualified = items
    .filter((item) => isQualified(item, anchor) && item.distancePercent <= thresholdPercent)
    .sort((a, b) => a.distancePercent - b.distancePercent);

  const nearest = qualified[0];
  if (!nearest) return inactive;

  const signature = alertSignature(nearest);
  return {
    status: 'active',
    thresholdPercent,
    item: nearest,
    signature,
    isNew: signature !== previousSignature,
  };
}
