import type { CurrentPriceAnchor, DecisionPanelItem, NormalizedReference } from './types';

/** Deterministic factories for decision-panel unit tests (no market data). */

export function makeReference(overrides: Partial<NormalizedReference> & Pick<NormalizedReference, 'id' | 'midpoint' | 'sourceType' | 'sourceLabel'>): NormalizedReference {
  return {
    priceLow: overrides.midpoint,
    priceHigh: overrides.midpoint,
    strength: null,
    score: null,
    referenceTimeframe: 'test',
    asOf: '2026-07-21T20:00:00.000Z',
    reliability: 'moderate',
    limitations: [],
    stale: false,
    ...overrides,
  };
}

export function makeItem(overrides: Partial<DecisionPanelItem> & Pick<DecisionPanelItem, 'id' | 'midpoint' | 'sourceType' | 'sourceLabel' | 'side' | 'distancePercent'>): DecisionPanelItem {
  const reference = makeReference(overrides);
  return {
    ...reference,
    side: overrides.side,
    distancePercent: overrides.distancePercent,
    confluence: overrides.confluence ?? [{
      sourceType: reference.sourceType,
      sourceLabel: reference.sourceLabel,
      reliability: reference.reliability,
      strength: reference.strength,
      score: reference.score,
    }],
    eta: overrides.eta,
  };
}

export function makeAnchor(overrides: Partial<CurrentPriceAnchor> = {}): CurrentPriceAnchor {
  return {
    price: 100,
    lastDirection: 'flat',
    dataMode: 'DELAYED',
    provider: 'polygon',
    exchangeTimestamp: '2026-07-21T20:00:00.000Z',
    delayAgeSeconds: 900,
    stale: false,
    ...overrides,
  };
}
