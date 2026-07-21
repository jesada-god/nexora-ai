import type { InstitutionalZone } from '@/src/lib/analytics/institutional-sr/types';
import type { VisibleRangeVolumeProfile } from '@/src/lib/analytics/institutional-sr/visible-range-profile';
import type { AnchoredVwapResult } from '@/src/lib/analytics/institutional-sr/anchored-vwap';
import type { OptionsLevel, OptionsSrResult } from '@/src/lib/analytics/options-sr/types';
import type { DecisionReliability, DecisionStrength, NormalizedReference } from './types';

/**
 * Pure converters from the already-computed analytics results into
 * price-independent {@link NormalizedReference}s. No converter reads the accepted
 * price: every value is geometry/provenance only, so the whole set can be memoised
 * on the analytics inputs and reprojected on a price tick without rebuilding it.
 */

const OPTIONS_REFERENCE_NOTE =
  'Options-derived reference level from real open interest — not a claim that price is controlled, pinned, supported or resisted.';

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function reliabilityFromZoneStrength(strength: DecisionStrength): DecisionReliability {
  return strength === 'strong' ? 'high' : strength === 'moderate' ? 'moderate' : 'low';
}

function reliabilityFromCoverage(coverage: number): DecisionReliability {
  if (coverage >= 0.8) return 'high';
  if (coverage >= 0.5) return 'moderate';
  return 'low';
}

/** Map D1 institutional demand/supply zones to references (band = [low, high]). */
export function zoneReferences(zones: readonly InstitutionalZone[]): NormalizedReference[] {
  return zones.flatMap((zone) => {
    if (!finite(zone.low) || !finite(zone.high) || !finite(zone.midpoint)) return [];
    return [{
      id: `zone-${zone.id}`,
      priceLow: Math.min(zone.low, zone.high),
      priceHigh: Math.max(zone.low, zone.high),
      midpoint: zone.midpoint,
      strength: zone.strength,
      score: zone.score,
      sourceType: 'd1-zone' as const,
      sourceLabel: zone.type === 'demand' ? 'D1 Demand Zone' : 'D1 Supply Zone',
      referenceTimeframe: '1D',
      asOf: zone.lastTouchedAt ?? zone.calculatedAt ?? null,
      reliability: reliabilityFromZoneStrength(zone.strength),
      limitations: [`Daily reference zone (${zone.touches} confirmed touches); end-of-day geometry, not intraday.`],
      stale: false,
    }];
  });
}

/**
 * Map the visible-range volume profile to POC / VAH / VAL single-price
 * references. Reliability follows the volume coverage of the visible range.
 */
export function volumeProfileReferences(profile: VisibleRangeVolumeProfile | null | undefined): NormalizedReference[] {
  if (!profile || profile.status !== 'available') return [];
  const reliability = reliabilityFromCoverage(profile.coverage);
  const asOf = profile.visibleTo;
  const limitations = ['Volume profile estimated from OHLCV (not tick data), over the visible range.'];
  const levels: Array<{ type: 'poc' | 'vah' | 'val'; label: string; price: number }> = [
    { type: 'poc', label: 'Point of Control (POC)', price: profile.poc },
    { type: 'vah', label: 'Value Area High (VAH)', price: profile.vah },
    { type: 'val', label: 'Value Area Low (VAL)', price: profile.val },
  ];
  return levels.flatMap((level) => finite(level.price) ? [{
    id: `vrvp-${level.type}`,
    priceLow: level.price,
    priceHigh: level.price,
    midpoint: level.price,
    strength: null,
    score: null,
    sourceType: level.type,
    sourceLabel: level.label,
    referenceTimeframe: 'Visible range',
    asOf,
    reliability,
    limitations,
    stale: false,
  }] : []);
}

/** Map the anchored VWAP to a single-price reference. */
export function anchoredVwapReferences(avwap: AnchoredVwapResult | null | undefined): NormalizedReference[] {
  if (!avwap || avwap.status !== 'available' || !finite(avwap.value)) return [];
  return [{
    id: 'avwap',
    priceLow: avwap.value,
    priceHigh: avwap.value,
    midpoint: avwap.value,
    strength: null,
    score: null,
    sourceType: 'avwap',
    sourceLabel: 'Anchored VWAP',
    referenceTimeframe: 'Anchored (visible)',
    asOf: avwap.points.at(-1)?.time ?? avwap.anchorTime ?? null,
    reliability: 'moderate',
    limitations: [`Anchored VWAP from the visible range (anchor: ${avwap.anchorSource ?? 'unknown'}).`],
    stale: false,
  }];
}

function optionsLevelReference(
  level: OptionsLevel | null,
  sourceType: 'call-wall' | 'put-wall' | 'max-pain',
  label: string,
  dataStale: boolean,
): NormalizedReference[] {
  if (!level || !finite(level.price)) return [];
  return [{
    id: `options-${sourceType}`,
    priceLow: level.price,
    priceHigh: level.price,
    midpoint: level.price,
    strength: null,
    score: null,
    sourceType,
    sourceLabel: label,
    referenceTimeframe: `Options ${level.expiration}`,
    asOf: level.asOf,
    reliability: level.reliability,
    expiration: level.expiration,
    limitations: [OPTIONS_REFERENCE_NOTE],
    stale: dataStale,
  }];
}

/**
 * Map an Options S/R result to references. An unavailable result yields no
 * references (options failure is isolated); a STALE data mode marks the
 * references stale so proximity alerts never fire from them.
 */
export function optionsReferences(result: OptionsSrResult | null | undefined): NormalizedReference[] {
  if (!result || result.status !== 'available') return [];
  const stale = result.dataMode === 'STALE';
  return [
    ...optionsLevelReference(result.callWall, 'call-wall', 'Call Wall', stale),
    ...optionsLevelReference(result.putWall, 'put-wall', 'Put Wall', stale),
    ...optionsLevelReference(result.maxPain, 'max-pain', 'Max Pain', stale),
  ];
}

export interface NormalizeSources {
  zones?: readonly InstitutionalZone[];
  volumeProfile?: VisibleRangeVolumeProfile | null;
  anchoredVwap?: AnchoredVwapResult | null;
  options?: OptionsSrResult | null;
}

/** Collect every available reference from the loaded analytics results. */
export function collectReferences(sources: NormalizeSources): NormalizedReference[] {
  return [
    ...zoneReferences(sources.zones ?? []),
    ...volumeProfileReferences(sources.volumeProfile),
    ...anchoredVwapReferences(sources.anchoredVwap),
    ...optionsReferences(sources.options),
  ];
}
