import type { DataFreshness, HistoricalPrice } from '@/src/lib/market-data/types';

export interface SupportResistanceParameters {
  pivotWindow: number;
  atrPeriod: number;
  atrTolerance: number;
  minimumTouches: number;
  maximumPerSide: number;
  minimumStrengthScore: number;
  useVolumeConfirmation: boolean;
  usePsychologicalLevels: boolean;
}

export interface ZoneScoreComponents {
  touches: number;
  recency: number;
  rejection: number;
  relativeVolume: number | null;
  psychological: number | null;
}

export interface ZoneReason { id: string; label: string; score: number; }

export interface SupportResistanceZone {
  id: string;
  type: 'support' | 'resistance';
  classification: 'Strong Support' | 'Support' | 'Strong Resistance' | 'Resistance';
  lower: number;
  upper: number;
  midpoint: number;
  touches: number;
  latestTouchAt: string;
  strengthScore: number;
  scoreComponents: ZoneScoreComponents;
  reasons: ZoneReason[];
}

interface SupportResistanceMetadata {
  symbol: string;
  source: string | null;
  sourceType: 'provider/cache historical OHLCV';
  dataPoints: number;
  latestDataAt: string | null;
  calculatedAt: string;
  freshness: DataFreshness;
  methodology: string;
  parameters: SupportResistanceParameters;
  assumptions: string[];
  limitations: string[];
}

export type SupportResistanceResult = (SupportResistanceMetadata & {
  status: 'available';
  currentPrice: number;
  zones: SupportResistanceZone[];
}) | (SupportResistanceMetadata & {
  status: 'unavailable';
  reason: string;
  missingInputs: string[];
});

export type SupportResistanceCandles = readonly HistoricalPrice[];
