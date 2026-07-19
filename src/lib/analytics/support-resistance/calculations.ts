import { atrWilder, ema, sma } from '../technical/calculations';
import { isValidOhlcv } from '../chart-types/calculations';
import { calculateVolumeProfile } from '../volume-profile/calculations';
import { calculateFibonacci } from '../fibonacci/calculations';
import type { TechnicalContext } from '../technical/types';
import type { SupportResistanceCandles, SupportResistanceParameters, SupportResistanceResult, SupportResistanceZone, ZoneReason } from './types';
import { DEFAULT_SUPPORT_RESISTANCE_PARAMETERS, supportResistanceParametersSchema } from './validation';

const METHODOLOGY = 'Confirmed pivots are clustered by ATR, touch-cooled, and scored 0–100 using bounded price structure plus same-dataset OHLCV confluence.';
const LIMITATIONS = [
  'แนวรับ/แนวต้านเป็นโซนที่ราคาเคยตอบสนองในอดีต ไม่ได้ยืนยันว่าราคาจะหยุดหรือกลับตัว',
  'คะแนนความแข็งแรงอธิบายคุณภาพข้อมูล ไม่ใช่ความน่าจะเป็นของกำไร',
  'Daily OHLCV cannot show intraday order flow; VPVR is an estimate and no order-book data is used.',
];

interface Pivot { index: number; confirmedAtIndex: number; price: number; kind: 'high' | 'low'; rejection: number; volume: number; }
interface Cluster { pivots: Pivot[]; midpoint: number; tolerance: number; }

const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const proximity = (price: number, level: number, tolerance: number) => Math.abs(price - level) <= tolerance;

function confirmedPivots(candles: SupportResistanceCandles, window: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let index = window; index < candles.length - window; index += 1) {
    const candle = candles[index]; const neighbors = candles.slice(index - window, index + window + 1); const range = Math.max(candle.high - candle.low, Number.EPSILON);
    if (neighbors.every((item, offset) => offset === window || candle.high > item.high)) pivots.push({ index, confirmedAtIndex: index + window, price: candle.high, kind: 'high', rejection: Math.max(candle.high - Math.max(candle.open, candle.close), 0) / range, volume: candle.volume });
    if (neighbors.every((item, offset) => offset === window || candle.low < item.low)) pivots.push({ index, confirmedAtIndex: index + window, price: candle.low, kind: 'low', rejection: Math.max(Math.min(candle.open, candle.close) - candle.low, 0) / range, volume: candle.volume });
  }
  return pivots;
}

function clusterPivots(pivots: Pivot[], atr: readonly (number | null)[], latestPrice: number, multiplier: number, cooldown: number): Cluster[] {
  const fallback = Math.max(Math.abs(latestPrice) * 0.005, Number.EPSILON); const clusters: Cluster[] = [];
  [...pivots].sort((a, b) => a.price - b.price || a.index - b.index).forEach((pivot) => {
    const tolerance = Math.max((atr[pivot.index] ?? fallback) * multiplier, fallback);
    const target = clusters.find((cluster) => Math.abs(pivot.price - cluster.midpoint) <= Math.max(tolerance, cluster.tolerance));
    if (!target) clusters.push({ pivots: [pivot], midpoint: pivot.price, tolerance });
    else if (target.pivots.every((touch) => Math.abs(touch.index - pivot.index) >= cooldown)) {
      target.pivots.push(pivot); target.midpoint = target.pivots.reduce((sum, item) => sum + item.price, 0) / target.pivots.length; target.tolerance = Math.max(target.tolerance, tolerance);
    }
  });
  return clusters;
}

function scoreCluster(cluster: Cluster, candles: SupportResistanceCandles, parameters: SupportResistanceParameters) {
  const latestIndex = candles.length - 1; const latest = cluster.pivots.reduce((best, pivot) => pivot.index > best.index ? pivot : best);
  const touches = Math.min(cluster.pivots.length / 5, 1); const recency = Math.max(0, 1 - (latestIndex - latest.index) / Math.max(latestIndex, 1));
  const rejection = cluster.pivots.reduce((sum, pivot) => sum + pivot.rejection, 0) / cluster.pivots.length;
  const averageVolume = candles.reduce((sum, candle) => sum + candle.volume, 0) / candles.length;
  const relativeVolume = parameters.useVolumeConfirmation && averageVolume > 0 ? Math.min(cluster.pivots.reduce((sum, pivot) => sum + pivot.volume, 0) / cluster.pivots.length / averageVolume, 2) / 2 : null;
  const overallRange = candles.reduce((sum, candle) => sum + candle.high - candle.low, 0) / candles.length;
  const localRange = cluster.pivots.reduce((sum, pivot) => { const slice = candles.slice(Math.max(0, pivot.index - 2), pivot.index + 3); return sum + slice.reduce((total, candle) => total + candle.high - candle.low, 0) / slice.length; }, 0) / cluster.pivots.length;
  const consolidation = parameters.useConsolidation && overallRange > 0 ? Math.max(0, 1 - localRange / overallRange) : null;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(Math.abs(cluster.midpoint), 1))); const step = magnitude / 2; const distanceToRound = Math.abs(cluster.midpoint - Math.round(cluster.midpoint / step) * step);
  const psychological = parameters.usePsychologicalLevels ? Math.max(0, 1 - distanceToRound / Math.max(cluster.tolerance, step * 0.1)) : null;

  const profile = calculateVolumeProfile(candles); let volumeProfile: number | null = null; const profileLabels: string[] = [];
  if (profile.status === 'available') {
    if (proximity(cluster.midpoint, (profile.poc.priceLow + profile.poc.priceHigh) / 2, cluster.tolerance)) { volumeProfile = 1; profileLabels.push('POC'); }
    if (profile.hvnClusters.some((node) => cluster.midpoint >= node.priceLow - cluster.tolerance && cluster.midpoint <= node.priceHigh + cluster.tolerance)) { volumeProfile = Math.max(volumeProfile ?? 0, 0.8); profileLabels.push('HVN'); }
  }
  const closes = candles.map((candle) => candle.close); const averages = [{ label: 'EMA20', values: ema(closes, 20) }, { label: 'EMA50', values: ema(closes, 50) }, { label: 'SMA200', values: sma(closes, 200) }];
  const maLabels = averages.filter(({ values }) => cluster.pivots.some((pivot) => values[pivot.index] != null && proximity(pivot.price, values[pivot.index] as number, cluster.tolerance))).map(({ label }) => label);
  const movingAverage = maLabels.length ? Math.min(1, maLabels.length / 2) : null;
  const fib = calculateFibonacci(candles); const fibLabels = fib.status === 'available' ? fib.levels.filter((level) => level.ratio !== 0.382 && proximity(cluster.midpoint, level.price, cluster.tolerance)).map((level) => `Fib ${level.ratio}`) : [];
  const fibonacci = fibLabels.length ? Math.min(1, fibLabels.length / 2) : null;

  const weighted: Array<[number | null, number]> = [[touches, 28], [recency, 12], [rejection, 14], [relativeVolume, 8], [consolidation, 8], [psychological, 4], [volumeProfile, 12], [movingAverage, 8], [fibonacci, 6]];
  const strengthScore = weighted.reduce((sum, [value, weight]) => sum + (value ?? 0) * weight, 0);
  const reasons: ZoneReason[] = [
    { id: 'pivot', label: `Pivot + ${cluster.pivots.length} Touches`, score: touches * 28 },
    rejection >= 0.35 ? { id: 'wick', label: 'Wick Rejection', score: rejection * 14 } : null,
    relativeVolume != null && relativeVolume >= 0.5 ? { id: 'relative-volume', label: 'Relative Volume', score: relativeVolume * 8 } : null,
    consolidation != null && consolidation >= 0.25 ? { id: 'consolidation', label: 'Consolidation', score: consolidation * 8 } : null,
    profileLabels.length ? { id: 'volume-profile', label: [...new Set(profileLabels)].join(' + '), score: (volumeProfile ?? 0) * 12 } : null,
    maLabels.length ? { id: 'moving-average', label: maLabels.join(' + '), score: (movingAverage ?? 0) * 8 } : null,
    fibLabels.length ? { id: 'fibonacci', label: fibLabels.join(' + '), score: (fibonacci ?? 0) * 6 } : null,
    psychological != null && psychological >= 0.5 ? { id: 'psychological', label: 'Psychological Level', score: psychological * 4 } : null,
  ].filter((reason): reason is ZoneReason => reason != null).map((reason) => ({ ...reason, score: round(reason.score, 2) }));
  return { strengthScore: round(Math.max(0, Math.min(100, strengthScore)), 2), components: { touches: round(touches, 3), recency: round(recency, 3), rejection: round(rejection, 3), relativeVolume: relativeVolume == null ? null : round(relativeVolume, 3), consolidation: consolidation == null ? null : round(consolidation, 3), psychological: psychological == null ? null : round(psychological, 3), volumeProfile: volumeProfile == null ? null : round(volumeProfile, 3), movingAverage: movingAverage == null ? null : round(movingAverage, 3), fibonacci: fibonacci == null ? null : round(fibonacci, 3) }, latestTouchAt: candles[latest.index].date, reasons };
}

export function calculateSupportResistance(candles: SupportResistanceCandles, context: TechnicalContext, input: Partial<SupportResistanceParameters> = {}): SupportResistanceResult {
  const parameters = supportResistanceParametersSchema.parse({ ...DEFAULT_SUPPORT_RESISTANCE_PARAMETERS, ...input }); const calculatedAt = context.calculatedAt ?? new Date().toISOString();
  const base = { symbol: context.symbol, source: context.source, sourceType: 'provider/cache historical OHLCV' as const, dataPoints: candles.length, latestDataAt: candles.at(-1)?.date ?? null, calculatedAt, freshness: context.freshness, methodology: METHODOLOGY, parameters, assumptions: ['Current price is the latest raw close.', 'Only pivots with a full right-side confirmation window are eligible; consecutive touches are cooldown-deduplicated.'], limitations: LIMITATIONS };
  const minimum = Math.max(parameters.atrPeriod, parameters.pivotWindow * 2 + 1);
  if (!isValidOhlcv(candles) || candles.length < minimum) return { status: 'unavailable', ...base, reason: !candles.length ? 'ไม่มีข้อมูล OHLCV' : `ต้องมีข้อมูล OHLCV ที่ถูกต้องอย่างน้อย ${minimum} แท่ง`, missingInputs: ['sufficient valid chronological OHLCV'] };
  const currentPrice = candles.at(-1)!.close; const atr = atrWilder(candles, parameters.atrPeriod); const clusters = clusterPivots(confirmedPivots(candles, parameters.pivotWindow), atr, currentPrice, parameters.atrTolerance, parameters.pivotWindow + 1);
  const structural = clusters.filter((cluster) => cluster.pivots.length >= parameters.minimumTouches).map((cluster): SupportResistanceZone => {
    const scored = scoreCluster(cluster, candles, parameters); const halfWidth = Math.max(cluster.tolerance / 2, Math.abs(cluster.midpoint) * 0.001); const midpoint = round(cluster.midpoint); const type = midpoint <= currentPrice ? 'support' : 'resistance'; const strong = scored.strengthScore >= 70;
    return { id: `${midpoint}-${scored.latestTouchAt}`, type, classification: type === 'support' ? strong ? 'Strong Support' : 'Support' : strong ? 'Strong Resistance' : 'Resistance', lower: round(midpoint - halfWidth), upper: round(midpoint + halfWidth), midpoint, touches: cluster.pivots.length, latestTouchAt: scored.latestTouchAt, strengthScore: scored.strengthScore, scoreComponents: scored.components, reasons: scored.reasons };
  });
  const selected = (['support', 'resistance'] as const).flatMap((type) => structural.filter((zone) => zone.type === type).sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice) || b.strengthScore - a.strengthScore).slice(0, Math.min(3, parameters.maximumPerSide)));
  const profile = calculateVolumeProfile(candles); const fastZones: SupportResistanceZone[] = profile.status === 'available' ? profile.lvnClusters.slice(0, 2).map((node, index) => ({ id: `lvn-${index}-${round(node.priceLow)}`, type: 'fast-zone', classification: 'LVN / Fast Zone', lower: round(node.priceLow), upper: round(node.priceHigh), midpoint: round((node.priceLow + node.priceHigh) / 2), touches: 0, latestTouchAt: candles.at(-1)!.date, strengthScore: 0, scoreComponents: { touches: 0, recency: 0, rejection: 0, relativeVolume: null, consolidation: null, psychological: null, volumeProfile: 0, movingAverage: null, fibonacci: null }, reasons: [{ id: 'lvn', label: 'Low historical volume', score: 0 }] })) : [];
  if (!selected.length && !fastZones.length) return { status: 'unavailable', ...base, reason: 'ไม่พบโซนที่ผ่านเกณฑ์จำนวนครั้งสัมผัสและการยืนยัน pivot', missingInputs: ['at least two confirmed reactions within an ATR cluster'] };
  return { status: 'available', ...base, currentPrice, zones: selected, fastZones };
}
