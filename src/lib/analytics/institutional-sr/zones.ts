import { atrWilder } from '../technical/calculations';
import { isValidOhlcv } from '../chart-types/calculations';
import { confirmedSwingPivots } from '../support-resistance/calculations';
import type {
  InstitutionalZone,
  InstitutionalZonesResult,
  ZoneCandle,
  ZoneCandles,
  ZoneConfig,
  ZoneConfluenceLevels,
  ZoneScoreComponents,
  ZoneSource,
  ZoneStrength,
  ZoneType,
} from './types';

/**
 * Deterministic score weights (sum = 100). A zone's score is
 *   Σ weight_i × unit_i   where unit_i ∈ [0,1] and a genuinely-absent
 * component (volume/confluence) contributes 0 points but is preserved as `null`
 * in `scoreComponents` — never coerced to a fake number.
 */
export const ZONE_WEIGHTS = {
  touches: 30,
  recency: 18,
  rejection: 20,
  volume: 16,
  psychological: 8,
  confluence: 8,
} as const satisfies Record<ZoneSource['id'], number>;

const STRONG_THRESHOLD = 70;
const MODERATE_THRESHOLD = 45;

const METHODOLOGY =
  'Causally confirmed daily swing pivots seed demand (swing-low wick) and supply (swing-high wick) zones; nearby candidates merge with an ATR-scaled tolerance into non-overlapping bands, then score 0–100 from confirmed touches, recency, wick rejection, relative volume, psychological confluence, and optional POC/VAH/VAL/AVWAP confluence.';

const LIMITATIONS = [
  'โซนอุปสงค์/อุปทานคือช่วงที่ราคาเคยตอบสนองในอดีต ไม่ได้รับประกันว่าราคาจะกลับตัว',
  'คะแนนอธิบายคุณภาพหลักฐานเชิงโครงสร้าง ไม่ใช่ความน่าจะเป็นของกำไร',
  'Completed daily OHLCV only — no intraday order flow, order book, mock, or interpolated levels are used.',
];

export const DEFAULT_ZONE_CONFIG: ZoneConfig = {
  pivotWindow: 3,
  atrPeriod: 14,
  atrToleranceMultiplier: 0.6,
  touchSaturation: 4,
  maxPerSide: 3,
  minimumScore: 0,
};

const round = (value: number, digits = 6): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Clamp to [0,1]; any non-finite input collapses to 0 so a score can never be NaN/Infinity. */
const unit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

interface RawZone {
  type: ZoneType;
  low: number;
  high: number;
  pivotIndexes: number[];
  confirmedIndexes: number[];
  rejections: number[];
  volumeUnits: number[];
}

/** Distance (in price units) from a level to the nearest psychological round number. */
function psychologicalUnit(level: number, scale: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(Math.abs(level), 1)));
  const step = magnitude / 2;
  const nearest = Math.round(level / step) * step;
  const tolerance = Math.max(scale, step * 0.05);
  return unit(1 - Math.abs(level - nearest) / tolerance);
}

function confluenceUnit(low: number, high: number, scale: number, levels: ZoneConfluenceLevels | undefined): number | null {
  if (!levels) return null;
  const candidates = [levels.poc, levels.vah, levels.val, levels.avwap].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (!candidates.length) return null;
  const tolerance = Math.max(scale, Number.EPSILON);
  const best = candidates.reduce((closest, level) => {
    const inside = level >= low && level <= high ? 0 : Math.min(Math.abs(level - low), Math.abs(level - high));
    return Math.min(closest, inside);
  }, Infinity);
  return unit(1 - best / tolerance);
}

/** A pivot's wick zone: swing-low → [low, body-bottom]; swing-high → [body-top, high]. */
function pivotZone(candle: ZoneCandle, kind: 'high' | 'low', pad: number): { low: number; high: number } {
  if (kind === 'low') {
    const bodyBottom = Math.min(candle.open, candle.close);
    const high = bodyBottom > candle.low ? bodyBottom : candle.low + pad;
    return { low: candle.low, high };
  }
  const bodyTop = Math.max(candle.open, candle.close);
  const low = bodyTop < candle.high ? bodyTop : candle.high - pad;
  return { low, high: candle.high };
}

function mergeSameSide(seeds: RawZone[]): RawZone[] {
  return [...seeds]
    .sort((left, right) => (left.low + left.high) / 2 - (right.low + right.high) / 2)
    .reduce<RawZone[]>((merged, zone) => {
      const previous = merged.at(-1);
      // Merge when the bands overlap (tolerance is already baked into each seed's width).
      if (previous && previous.type === zone.type && zone.low <= previous.high) {
        previous.low = Math.min(previous.low, zone.low);
        previous.high = Math.max(previous.high, zone.high);
        previous.pivotIndexes.push(...zone.pivotIndexes);
        previous.confirmedIndexes.push(...zone.confirmedIndexes);
        previous.rejections.push(...zone.rejections);
        previous.volumeUnits.push(...zone.volumeUnits);
      } else {
        merged.push({ ...zone, pivotIndexes: [...zone.pivotIndexes], confirmedIndexes: [...zone.confirmedIndexes], rejections: [...zone.rejections], volumeUnits: [...zone.volumeUnits] });
      }
      return merged;
    }, []);
}

/** Causal re-test count: candles after the seed pivot that entered the band and held. */
function retestIndexes(candles: ZoneCandles, zone: RawZone): number[] {
  const firstIndex = Math.min(...zone.pivotIndexes);
  const owned = new Set(zone.pivotIndexes);
  const hits: number[] = [];
  for (let index = firstIndex + 1; index < candles.length; index += 1) {
    if (owned.has(index)) continue;
    const candle = candles[index];
    const overlaps = candle.low <= zone.high && candle.high >= zone.low;
    if (!overlaps) continue;
    const held = zone.type === 'demand' ? candle.close >= zone.low : candle.close <= zone.high;
    if (held) hits.push(index);
  }
  return hits;
}

function scoreZone(
  zone: RawZone,
  touches: number,
  lastTouchIndex: number,
  lastIndex: number,
  config: ZoneConfig,
  levels: ZoneConfluenceLevels | undefined,
): { score: number; strength: ZoneStrength; components: ZoneScoreComponents; sources: ZoneSource[] } {
  const midpoint = (zone.low + zone.high) / 2;
  const scale = Math.max(zone.high - zone.low, Math.abs(midpoint) * 0.001, Number.EPSILON);

  const touchesUnit = unit(touches / Math.max(config.touchSaturation, 1));
  const recencyUnit = unit(1 - (lastIndex - lastTouchIndex) / Math.max(lastIndex, 1));
  const rejectionUnit = zone.rejections.length
    ? unit(zone.rejections.reduce((sum, value) => sum + value, 0) / zone.rejections.length)
    : 0;
  const volumeUnit = zone.volumeUnits.length
    ? unit(zone.volumeUnits.reduce((sum, value) => sum + value, 0) / zone.volumeUnits.length)
    : null;
  const psychologicalUnitValue = psychologicalUnit(midpoint, scale);
  const confluence = confluenceUnit(zone.low, zone.high, scale, levels);

  const contributions: Array<{ id: ZoneSource['id']; label: string; value: number | null }> = [
    { id: 'touches', label: 'Confirmed touches', value: touchesUnit },
    { id: 'recency', label: 'Recency', value: recencyUnit },
    { id: 'rejection', label: 'Wick rejection', value: rejectionUnit },
    { id: 'volume', label: 'Relative volume', value: volumeUnit },
    { id: 'psychological', label: 'Psychological confluence', value: psychologicalUnitValue },
    { id: 'confluence', label: 'POC/VAH/VAL/AVWAP confluence', value: confluence },
  ];

  const sources: ZoneSource[] = [];
  let score = 0;
  for (const item of contributions) {
    const points = round((item.value ?? 0) * ZONE_WEIGHTS[item.id], 4);
    score += points;
    if (item.value != null && points > 0) sources.push({ id: item.id, label: item.label, points });
  }
  score = round(Math.min(100, Math.max(0, score)), 2);
  const strength: ZoneStrength = score >= STRONG_THRESHOLD ? 'strong' : score >= MODERATE_THRESHOLD ? 'moderate' : 'weak';
  return {
    score,
    strength,
    components: {
      touches: round(touchesUnit, 4),
      recency: round(recencyUnit, 4),
      rejection: round(rejectionUnit, 4),
      volume: volumeUnit == null ? null : round(volumeUnit, 4),
      psychological: round(psychologicalUnitValue, 4),
      confluence: confluence == null ? null : round(confluence, 4),
    },
    sources: sources.sort((left, right) => right.points - left.points),
  };
}

function buildSide(
  candles: ZoneCandles,
  seeds: RawZone[],
  type: ZoneType,
  acceptedPrice: number,
  lastIndex: number,
  calculatedAt: string,
  config: ZoneConfig,
  levels: ZoneConfluenceLevels | undefined,
): InstitutionalZone[] {
  return mergeSameSide(seeds)
    .flatMap((zone): InstitutionalZone[] => {
      // Demand must sit entirely below the accepted price; supply entirely above.
      const positioned = type === 'demand' ? zone.high < acceptedPrice : zone.low > acceptedPrice;
      if (!positioned) return [];
      const retests = retestIndexes(candles, zone);
      const touchIndexes = [...new Set([...zone.pivotIndexes, ...retests])].sort((a, b) => a - b);
      const touches = touchIndexes.length;
      const lastTouchIndex = touchIndexes.at(-1) ?? Math.max(...zone.pivotIndexes);
      const firstIndex = Math.min(...zone.pivotIndexes);
      const scored = scoreZone(zone, touches, lastTouchIndex, lastIndex, config, levels);
      if (scored.score < config.minimumScore) return [];
      const low = round(zone.low);
      const high = round(zone.high);
      const midpoint = round((zone.low + zone.high) / 2);
      const distancePercent = round(Math.abs(midpoint - acceptedPrice) / acceptedPrice * 100, 4);
      return [{
        id: `${type}-${low}-${high}-${candles[firstIndex].date}`,
        type,
        low,
        high,
        midpoint,
        score: scored.score,
        strength: scored.strength,
        touches,
        distancePercent,
        referenceTimeframe: '1D',
        sources: scored.sources,
        scoreComponents: scored.components,
        firstConfirmedAt: candles[firstIndex].date,
        lastTouchedAt: candles[lastTouchIndex].date,
        calculatedAt,
      }];
    })
    .sort((left, right) => left.distancePercent - right.distancePercent || right.score - left.score)
    .slice(0, Math.max(0, config.maxPerSide));
}

/**
 * Build institutional demand/supply zones from completed daily candles.
 *
 * The caller must pass only completed daily candles — the still-forming current
 * day must be excluded before calling. All pivot detection is causal (a swing is
 * usable only after its right-hand window closes), so no zone reads future data.
 */
export function buildInstitutionalZones(
  candles: ZoneCandles,
  acceptedPrice: number,
  options: Partial<ZoneConfig> = {},
  levels?: ZoneConfluenceLevels,
): InstitutionalZonesResult {
  const config: ZoneConfig = { ...DEFAULT_ZONE_CONFIG, ...options };
  const calculatedAt = config.calculatedAt ?? new Date().toISOString();
  const meta = {
    referenceTimeframe: '1D' as const,
    calculatedAt,
    dataPoints: candles.length,
    latestDataAt: candles.at(-1)?.date ?? null,
    methodology: METHODOLOGY,
    weights: { ...ZONE_WEIGHTS },
    limitations: LIMITATIONS,
  };

  const minimum = Math.max(config.atrPeriod + 1, config.pivotWindow * 2 + 1);
  if (!Number.isFinite(acceptedPrice) || acceptedPrice <= 0) {
    return { status: 'unavailable', ...meta, acceptedPrice: null, reason: 'ไม่มีราคาที่ยอมรับได้สำหรับคำนวณระยะห่าง', missingInputs: ['accepted price'] };
  }
  if (!isValidOhlcv(candles) || candles.length < minimum) {
    return {
      status: 'unavailable',
      ...meta,
      acceptedPrice,
      reason: !candles.length ? 'ไม่มีข้อมูล OHLCV รายวัน' : `ต้องมีแท่งรายวันที่ผ่าน validation อย่างน้อย ${minimum} แท่ง`,
      missingInputs: ['sufficient valid completed daily OHLCV'],
    };
  }

  const atr = atrWilder(candles, config.atrPeriod);
  const pivots = confirmedSwingPivots(candles, config.pivotWindow);
  const demandSeeds: RawZone[] = [];
  const supplySeeds: RawZone[] = [];
  for (const pivot of pivots) {
    const candle = candles[pivot.index];
    const fallback = Math.max(Math.abs(candle.close) * 0.005, Number.EPSILON);
    const tolerance = Math.max((atr[pivot.index] ?? fallback) * config.atrToleranceMultiplier, fallback);
    const pad = tolerance * 0.5;
    const band = pivotZone(candle, pivot.kind, pad);
    // Widen each seed by half the tolerance so structurally-near pivots overlap and merge.
    const seed: RawZone = {
      type: pivot.kind === 'low' ? 'demand' : 'supply',
      low: band.low - tolerance / 2,
      high: band.high + tolerance / 2,
      pivotIndexes: [pivot.index],
      confirmedIndexes: [pivot.confirmedAtIndex],
      rejections: [pivot.rejection],
      volumeUnits: pivot.volumeConfirmation == null ? [] : [pivot.volumeConfirmation],
    };
    (pivot.kind === 'low' ? demandSeeds : supplySeeds).push(seed);
  }

  const lastIndex = candles.length - 1;
  const demand = buildSide(candles, demandSeeds, 'demand', acceptedPrice, lastIndex, calculatedAt, config, levels);
  const supply = buildSide(candles, supplySeeds, 'supply', acceptedPrice, lastIndex, calculatedAt, config, levels);

  if (!demand.length && !supply.length) {
    return {
      status: 'unavailable',
      ...meta,
      acceptedPrice,
      reason: 'ไม่พบโซนอุปสงค์/อุปทานที่ผ่านเกณฑ์รอบราคาปัจจุบัน',
      missingInputs: ['confirmed demand or supply reactions around the accepted price'],
    };
  }

  return { status: 'available', ...meta, acceptedPrice, demand, supply, zones: [...demand, ...supply] };
}

/**
 * Update only the distance of already-built zones against a new accepted price.
 * The completed-D1 zone geometry and score are preserved — a live aggregate tick
 * may move the distance but must never rebuild zones.
 */
export function reprojectZoneDistances(zones: readonly InstitutionalZone[], acceptedPrice: number): InstitutionalZone[] {
  if (!Number.isFinite(acceptedPrice) || acceptedPrice <= 0) return [...zones];
  return zones.map((zone) => ({
    ...zone,
    distancePercent: round(Math.abs(zone.midpoint - acceptedPrice) / acceptedPrice * 100, 4),
  }));
}
