import type { DecisionSide } from './types';

/**
 * Deterministic distance from a reference midpoint to the accepted price:
 *
 *   distancePercent = abs(referenceMidpoint - acceptedPrice) / acceptedPrice * 100
 *
 * Recalculated from the accepted price only — never from a rebuilt zone geometry.
 * Guards every degenerate input (non-finite, zero price) so the result is always
 * a finite number, never NaN or Infinity.
 */
export function distancePercent(referenceMidpoint: number, acceptedPrice: number): number {
  if (!Number.isFinite(referenceMidpoint) || !Number.isFinite(acceptedPrice) || acceptedPrice === 0) {
    return 0;
  }
  const raw = (Math.abs(referenceMidpoint - acceptedPrice) / Math.abs(acceptedPrice)) * 100;
  return Number.isFinite(raw) ? raw : 0;
}

/** Absolute price distance (finite, non-negative) between a midpoint and the accepted price. */
export function priceDistance(referenceMidpoint: number, acceptedPrice: number): number {
  if (!Number.isFinite(referenceMidpoint) || !Number.isFinite(acceptedPrice)) return 0;
  const raw = Math.abs(referenceMidpoint - acceptedPrice);
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Classify a reference relative to the accepted price. A reference whose band
 * contains the price is neutral; otherwise it is resistance when its midpoint is
 * above the price and support when below.
 */
export function classifySide(priceLow: number, priceHigh: number, midpoint: number, acceptedPrice: number): DecisionSide {
  const low = Math.min(priceLow, priceHigh);
  const high = Math.max(priceLow, priceHigh);
  if (acceptedPrice >= low && acceptedPrice <= high) return 'neutral';
  return midpoint > acceptedPrice ? 'resistance' : 'support';
}
