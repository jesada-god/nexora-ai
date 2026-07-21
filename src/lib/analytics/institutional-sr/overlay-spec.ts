import type { InstitutionalZone } from './types';
import type { VisibleRangeVolumeProfile } from './visible-range-profile';
import type { AnchoredVwapResult } from './anchored-vwap';

/**
 * Neutral, renderer-agnostic overlay specifications. The chart primitive consumes
 * these; keeping the transform pure makes label text, colours and geometry unit
 * testable without a canvas.
 */
export interface BandSpec {
  id: string;
  low: number;
  high: number;
  fill: string;
  border: string;
  label: string;
  labelColor: string;
}

export interface LineSpec {
  id: string;
  price: number;
  color: string;
  label: string;
  dashed: boolean;
}

export interface InstitutionalOverlaySpec {
  bands: BandSpec[];
  lines: LineSpec[];
}

const DEMAND_FILL = 'rgba(52, 211, 153, 0.14)';
const DEMAND_BORDER = 'rgba(52, 211, 153, 0.55)';
const SUPPLY_FILL = 'rgba(251, 113, 133, 0.14)';
const SUPPLY_BORDER = 'rgba(251, 113, 133, 0.55)';

const STRENGTH_TAG: Record<InstitutionalZone['strength'], string> = { strong: '●●●', moderate: '●●', weak: '●' };

export function zoneBands(zones: readonly InstitutionalZone[]): BandSpec[] {
  return zones.map((zone, index) => {
    const demand = zone.type === 'demand';
    const prefix = demand ? 'D' : 'S';
    return {
      id: zone.id,
      low: zone.low,
      high: zone.high,
      fill: demand ? DEMAND_FILL : SUPPLY_FILL,
      border: demand ? DEMAND_BORDER : SUPPLY_BORDER,
      label: `${prefix}${index + 1} ${STRENGTH_TAG[zone.strength]} ${zone.score.toFixed(0)}`,
      labelColor: demand ? '#34d399' : '#fb7185',
    };
  });
}

export function volumeProfileLines(profile: VisibleRangeVolumeProfile | undefined): LineSpec[] {
  if (!profile || profile.status !== 'available') return [];
  return [
    { id: 'vrvp-poc', price: profile.poc, color: '#D4FF00', label: 'POC', dashed: false },
    { id: 'vrvp-vah', price: profile.vah, color: '#94a3b8', label: 'VAH', dashed: true },
    { id: 'vrvp-val', price: profile.val, color: '#94a3b8', label: 'VAL', dashed: true },
  ];
}

export function anchoredVwapLine(result: AnchoredVwapResult | undefined): LineSpec[] {
  if (!result || result.status !== 'available') return [];
  return [{ id: 'avwap', price: result.value, color: '#38bdf8', label: 'AVWAP', dashed: false }];
}

export function buildInstitutionalOverlaySpec(input: {
  zones?: readonly InstitutionalZone[];
  showZones: boolean;
  profile?: VisibleRangeVolumeProfile;
  showVolumeProfile: boolean;
  avwap?: AnchoredVwapResult;
  showAnchoredVwap: boolean;
}): InstitutionalOverlaySpec {
  return {
    bands: input.showZones && input.zones ? zoneBands(input.zones) : [],
    lines: [
      ...(input.showVolumeProfile ? volumeProfileLines(input.profile) : []),
      ...(input.showAnchoredVwap ? anchoredVwapLine(input.avwap) : []),
    ],
  };
}
