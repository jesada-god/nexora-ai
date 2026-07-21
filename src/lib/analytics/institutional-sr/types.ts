import type { HistoricalPrice } from '@/src/lib/market-data/types';

/** A completed daily OHLCV candle. Volume may be genuinely absent (never faked). */
export type ZoneCandle = HistoricalPrice;
export type ZoneCandles = readonly ZoneCandle[];

export type ZoneType = 'demand' | 'supply';
export type ZoneStrength = 'weak' | 'moderate' | 'strong';

/**
 * The unit-normalised ([0,1] or null) inputs to the deterministic score. `volume`
 * and `confluence` are null when their evidence is genuinely unavailable — they
 * are never fabricated to a numeric default.
 */
export interface ZoneScoreComponents {
  touches: number;
  recency: number;
  rejection: number;
  volume: number | null;
  psychological: number;
  confluence: number | null;
}

/** A factor that contributed to the score, with its weighted points (0–weight). */
export interface ZoneSource {
  id: 'touches' | 'recency' | 'rejection' | 'volume' | 'psychological' | 'confluence';
  label: string;
  points: number;
}

export interface InstitutionalZone {
  id: string;
  type: ZoneType;
  low: number;
  high: number;
  midpoint: number;
  score: number;
  strength: ZoneStrength;
  touches: number;
  distancePercent: number;
  referenceTimeframe: '1D';
  sources: ZoneSource[];
  scoreComponents: ZoneScoreComponents;
  firstConfirmedAt: string;
  lastTouchedAt: string;
  calculatedAt: string;
}

/** Optional volume-profile / AVWAP levels used only as a score-confluence bonus. */
export interface ZoneConfluenceLevels {
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
  avwap?: number | null;
}

export interface ZoneConfig {
  /** Half-width of the causal swing-confirmation window (bars each side). */
  pivotWindow: number;
  /** Wilder ATR period used to size merge tolerance. */
  atrPeriod: number;
  /** Merge tolerance = ATR × this multiplier. */
  atrToleranceMultiplier: number;
  /** Touches (confirmed pivots) at which the touches component saturates to 1. */
  touchSaturation: number;
  /** Zones returned per side (nearest to accepted price). */
  maxPerSide: number;
  /** Zones below this score are dropped before ranking. */
  minimumScore: number;
  /** ISO timestamp stamped on every zone (injected for deterministic tests). */
  calculatedAt?: string;
}

export interface ZoneMeta {
  referenceTimeframe: '1D';
  calculatedAt: string;
  dataPoints: number;
  latestDataAt: string | null;
  methodology: string;
  weights: Record<ZoneSource['id'], number>;
  limitations: string[];
}

export type InstitutionalZonesResult =
  | (ZoneMeta & {
      status: 'available';
      acceptedPrice: number;
      demand: InstitutionalZone[];
      supply: InstitutionalZone[];
      /** demand + supply, nearest-first, capped per side. */
      zones: InstitutionalZone[];
    })
  | (ZoneMeta & {
      status: 'unavailable';
      acceptedPrice: number | null;
      reason: string;
      missingInputs: string[];
    });
