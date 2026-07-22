import type { OptionsSrUnavailableReason } from '@/src/lib/analytics/options-sr/types';

/**
 * Phase D — Support/Resistance Decision Panel.
 *
 * These types describe a compact, truthful organisation of the S/R references the
 * chart already computed (D1 zones, VRVP POC/VAH/VAL, Anchored VWAP, and the
 * Options-derived Call Wall / Put Wall / Max Pain) around the single accepted
 * current price. Nothing here fetches, mocks, interpolates or forward-fills market
 * data — every field is projected from an already-loaded analytics result. The
 * data mode vocabulary deliberately omits REAL-TIME: the account is delayed/EOD.
 */

export type DecisionSide = 'support' | 'resistance' | 'neutral';

export type DecisionSourceType =
  | 'd1-zone'
  | 'poc'
  | 'vah'
  | 'val'
  | 'avwap'
  | 'call-wall'
  | 'put-wall'
  | 'max-pain';

export type DecisionStrength = 'weak' | 'moderate' | 'strong';
export type DecisionReliability = 'high' | 'moderate' | 'low';

/** Truthful data-mode vocabulary shared with the market-source layer. */
export type DecisionDataMode = 'REAL-TIME' | 'DELAYED' | 'END-OF-DAY' | 'CACHED' | 'STALE' | 'UNAVAILABLE';

/**
 * A price-independent normalised reference — the geometry and provenance of one
 * S/R level, before it is projected against the accepted price. Memoising these
 * on the analytics inputs lets a price tick reproject distance/side/alert/ETA
 * without rebuilding any zone geometry.
 */
export interface NormalizedReference {
  id: string;
  priceLow: number;
  priceHigh: number;
  midpoint: number;
  strength: DecisionStrength | null;
  score: number | null;
  sourceType: DecisionSourceType;
  sourceLabel: string;
  referenceTimeframe: string;
  asOf: string | null;
  reliability: DecisionReliability | null;
  expiration?: string;
  limitations: string[];
  /** True when the source data is STALE/UNAVAILABLE and must not trigger an alert. */
  stale: boolean;
}

/** A source badge preserved when duplicate references are visually merged. */
export interface DecisionSourceBadge {
  sourceType: DecisionSourceType;
  sourceLabel: string;
  reliability: DecisionReliability | null;
  strength: DecisionStrength | null;
  score: number | null;
}

/**
 * A projected card. Extends the normalised reference with the price-dependent
 * side and distance, the merged-source confluence badges, and an optional ETA.
 */
export interface DecisionPanelItem extends NormalizedReference {
  side: DecisionSide;
  distancePercent: number;
  confluence: DecisionSourceBadge[];
  eta?: EtaEstimate;
}

export interface CurrentPriceAnchor {
  price: number | null;
  lastDirection: 'up' | 'down' | 'flat' | 'unknown';
  dataMode: DecisionDataMode;
  provider: string | null;
  exchangeTimestamp: string | null;
  delayAgeSeconds: number | null;
  /** True when the accepted price is itself stale/unavailable — suppresses alerts. */
  stale: boolean;
}

export interface ProximityAlert {
  status: 'active' | 'inactive';
  thresholdPercent: number;
  /** The nearest qualified reference within the threshold, or null. */
  item: DecisionPanelItem | null;
  /** Stable identity of the active level; unchanged while the same level stays active. */
  signature: string | null;
  /** True only when the signature differs from the previous alert (drives one-shot UI). */
  isNew: boolean;
}

export interface EtaEstimate {
  status: 'available' | 'unavailable';
  method: 'atr' | 'iv' | 'blended' | null;
  minMarketHours: number | null;
  maxMarketHours: number | null;
  confidence: 'low' | 'moderate' | 'high' | null;
  assumptions: string[];
  limitations: string[];
}

/** Isolated status for the options-derived section (may fail without breaking the panel). */
export interface OptionsSectionStatus {
  status: 'available' | 'unavailable' | 'off';
  reason: OptionsSrUnavailableReason | null;
  message: string | null;
  dataMode: DecisionDataMode | null;
  /** False for entitlement failures (401/403) which must not be auto-retried. */
  retryable: boolean;
}

export interface DecisionPanelModel {
  anchor: CurrentPriceAnchor;
  /** Nearest-first, capped resistance cards (above price). */
  resistance: DecisionPanelItem[];
  /** Nearest-first, capped support cards (below price). */
  support: DecisionPanelItem[];
  /** References straddling the accepted price. */
  neutral: DecisionPanelItem[];
  extraResistance: DecisionPanelItem[];
  extraSupport: DecisionPanelItem[];
  extraNeutral: DecisionPanelItem[];
  alert: ProximityAlert;
  options: OptionsSectionStatus;
  /** True when at least one non-options (technical) reference is present. */
  technicalAvailable: boolean;
}

export interface AtrEtaInput {
  /** ATR value in price units (confirmed, e.g. 1-hour Wilder ATR). */
  value: number;
  /** Minutes each ATR bar spans (60 for a 1-hour ATR). */
  barMinutes: number;
  /** Human label of the ATR timeframe, for the assumptions list. */
  timeframe: string;
}

export interface IvEtaInput {
  /** Real ATM implied volatility (annualised, decimal — e.g. 0.35). */
  atmIv: number;
  /** Calendar days until the option expiration used. */
  daysToExpiration: number;
}

export interface EtaInputs {
  atr?: AtrEtaInput | null;
  iv?: IvEtaInput | null;
  /** Active trading hours per market day (default 6.5). */
  marketHoursPerDay?: number;
}

export interface BuildDecisionPanelInput {
  references: readonly NormalizedReference[];
  acceptedPrice: number | null;
  anchor: CurrentPriceAnchor;
  /** Price band within which same-side references are merged. Null → percent fallback. */
  atrTolerance: number | null;
  eta?: EtaInputs;
  /** Proximity banner threshold; default 3%. */
  proximityThresholdPercent?: number;
  previousAlertSignature?: string | null;
  /** Maximum primary cards per side; default 3. */
  maxPerSide?: number;
  options: OptionsSectionStatus;
}
