import { atrWilder } from '../technical/calculations';
import { isValidOhlcv } from '../chart-types/calculations';
import type { TechnicalContext } from '../technical/types';
import type {
  SupportResistanceCandles,
  SupportResistanceParameters,
  SupportResistanceResult,
  SupportResistanceZone,
  ZoneReason,
} from './types';
import { DEFAULT_SUPPORT_RESISTANCE_PARAMETERS, supportResistanceParametersSchema } from './validation';

const METHODOLOGY = 'Causally confirmed swing pivots are merged with ATR-sized tolerance and scored from independent touches, recency, wick rejection, trailing volume confirmation, and a small psychological-level bonus.';
const LIMITATIONS = [
  'แนวรับ/แนวต้านเป็นโซนที่ราคาเคยตอบสนองในอดีต ไม่ได้ยืนยันว่าราคาจะหยุดหรือกลับตัว',
  'คะแนนความแข็งแรงอธิบายคุณภาพข้อมูล ไม่ใช่ความน่าจะเป็นของกำไร',
  'Daily OHLCV cannot show intraday order flow; no order-book, mock, or fallback levels are used.',
];

export interface ConfirmedSwing {
  index: number;
  confirmedAtIndex: number;
  price: number;
  kind: 'high' | 'low';
  rejection: number;
  volumeConfirmation: number | null;
}

interface Cluster {
  pivots: ConfirmedSwing[];
  midpoint: number;
  tolerance: number;
}

const round = (value: number, digits = 6) => Number(value.toFixed(digits));

function trailingVolumeConfirmation(candles: SupportResistanceCandles, index: number): number | null {
  const current = candles[index].volume;
  if (current == null) return null;
  const trailing = candles
    .slice(Math.max(0, index - 19), index + 1)
    .flatMap((candle) => candle.volume == null ? [] : [candle.volume]);
  if (!trailing.length) return null;
  const average = trailing.reduce((sum, volume) => sum + volume, 0) / trailing.length;
  return average > 0 ? Math.min(current / average, 2) / 2 : null;
}

export function confirmedSwingPivots(candles: SupportResistanceCandles, window: number): ConfirmedSwing[] {
  const pivots: ConfirmedSwing[] = [];
  // A candidate at `index` becomes eligible only at `confirmedAtIndex`. The
  // comparison never reads a candle after that confirmation point.
  for (let confirmedAtIndex = window * 2; confirmedAtIndex < candles.length; confirmedAtIndex += 1) {
    const index = confirmedAtIndex - window;
    const candle = candles[index];
    const knownWindow = candles.slice(index - window, confirmedAtIndex + 1);
    const range = Math.max(candle.high - candle.low, Number.EPSILON);
    const common = {
      index,
      confirmedAtIndex,
      volumeConfirmation: trailingVolumeConfirmation(candles, index),
    };
    if (knownWindow.every((item, offset) => offset === window || candle.high > item.high)) {
      pivots.push({ ...common, price: candle.high, kind: 'high', rejection: Math.max(candle.high - Math.max(candle.open, candle.close), 0) / range });
    }
    if (knownWindow.every((item, offset) => offset === window || candle.low < item.low)) {
      pivots.push({ ...common, price: candle.low, kind: 'low', rejection: Math.max(Math.min(candle.open, candle.close) - candle.low, 0) / range });
    }
  }
  return pivots;
}

function mergePivots(pivots: ConfirmedSwing[], cooldown: number): ConfirmedSwing[] {
  return [...pivots]
    .sort((left, right) => left.index - right.index || left.price - right.price)
    .reduce<ConfirmedSwing[]>((independent, pivot) => {
      if (independent.every((peer) => Math.abs(peer.index - pivot.index) >= cooldown)) independent.push(pivot);
      return independent;
    }, []);
}

function combineClusters(left: Cluster, right: Cluster, cooldown: number): Cluster {
  const pivots = mergePivots([...left.pivots, ...right.pivots], cooldown);
  return {
    pivots,
    midpoint: pivots.reduce((sum, pivot) => sum + pivot.price, 0) / pivots.length,
    tolerance: Math.max(left.tolerance, right.tolerance),
  };
}

function clusterPivots(
  pivots: ConfirmedSwing[],
  atr: readonly (number | null)[],
  multiplier: number,
  cooldown: number,
): Cluster[] {
  const seeded: Cluster[] = [];
  [...pivots].sort((left, right) => left.price - right.price || left.index - right.index).forEach((pivot) => {
    const fallback = Math.max(Math.abs(pivot.price) * 0.005, Number.EPSILON);
    const tolerance = Math.max((atr[pivot.index] ?? fallback) * multiplier, fallback);
    const target = seeded.find((cluster) => Math.abs(pivot.price - cluster.midpoint) <= Math.max(tolerance, cluster.tolerance));
    if (!target) {
      seeded.push({ pivots: [pivot], midpoint: pivot.price, tolerance });
      return;
    }
    if (target.pivots.every((touch) => Math.abs(touch.index - pivot.index) >= cooldown)) {
      target.pivots.push(pivot);
      target.midpoint = target.pivots.reduce((sum, item) => sum + item.price, 0) / target.pivots.length;
      target.tolerance = Math.max(target.tolerance, tolerance);
    }
  });

  return seeded
    .sort((left, right) => left.midpoint - right.midpoint)
    .reduce<Cluster[]>((merged, cluster) => {
      const previous = merged.at(-1);
      if (!previous || Math.abs(cluster.midpoint - previous.midpoint) > Math.max(cluster.tolerance, previous.tolerance)) {
        merged.push(cluster);
      } else {
        merged[merged.length - 1] = combineClusters(previous, cluster, cooldown);
      }
      return merged;
    }, []);
}

function psychologicalScore(level: number, tolerance: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(Math.abs(level), 1)));
  const step = magnitude / 2;
  const distance = Math.abs(level - Math.round(level / step) * step);
  return Math.max(0, 1 - distance / Math.max(tolerance, step * 0.1));
}

function scoreCluster(cluster: Cluster, candles: SupportResistanceCandles, parameters: SupportResistanceParameters) {
  const latestIndex = candles.length - 1;
  const latest = cluster.pivots.reduce((best, pivot) => pivot.confirmedAtIndex > best.confirmedAtIndex ? pivot : best);
  const touches = Math.min(cluster.pivots.length / 4, 1);
  const recency = Math.max(0, 1 - (latestIndex - latest.confirmedAtIndex) / Math.max(latestIndex, 1));
  const rejection = cluster.pivots.reduce((sum, pivot) => sum + pivot.rejection, 0) / cluster.pivots.length;
  const volumeValues = parameters.useVolumeConfirmation
    ? cluster.pivots.flatMap((pivot) => pivot.volumeConfirmation == null ? [] : [pivot.volumeConfirmation])
    : [];
  const relativeVolume = volumeValues.length ? volumeValues.reduce((sum, value) => sum + value, 0) / volumeValues.length : null;
  const psychological = parameters.usePsychologicalLevels ? psychologicalScore(cluster.midpoint, cluster.tolerance) : null;
  const strengthScore = Math.max(0, Math.min(100,
    touches * 42
    + recency * 20
    + rejection * 24
    + (relativeVolume ?? 0) * 10
    + (psychological ?? 0) * 4,
  ));
  const reasons: ZoneReason[] = [
    { id: 'touches', label: `${cluster.pivots.length} confirmed touches`, score: touches * 42 },
    { id: 'recency', label: 'Recency', score: recency * 20 },
    rejection >= 0.2 ? { id: 'wick', label: 'Wick rejection', score: rejection * 24 } : null,
    relativeVolume != null ? { id: 'relative-volume', label: 'Trailing volume confirmation', score: relativeVolume * 10 } : null,
    psychological != null && psychological >= 0.5 ? { id: 'psychological', label: 'Psychological-level bonus', score: psychological * 4 } : null,
  ].filter((reason): reason is ZoneReason => reason != null).map((reason) => ({ ...reason, score: round(reason.score, 2) }));
  return {
    strengthScore: round(strengthScore, 2),
    components: {
      touches: round(touches, 3),
      recency: round(recency, 3),
      rejection: round(rejection, 3),
      relativeVolume: relativeVolume == null ? null : round(relativeVolume, 3),
      psychological: psychological == null ? null : round(psychological, 3),
    },
    latestTouchAt: candles[latest.index].date,
    reasons,
  };
}

export function calculateSupportResistance(
  candles: SupportResistanceCandles,
  context: TechnicalContext,
  input: Partial<SupportResistanceParameters> = {},
): SupportResistanceResult {
  const parameters = supportResistanceParametersSchema.parse({ ...DEFAULT_SUPPORT_RESISTANCE_PARAMETERS, ...input });
  const calculatedAt = context.calculatedAt ?? new Date().toISOString();
  const base = {
    symbol: context.symbol,
    source: context.source,
    sourceType: 'provider/cache historical OHLCV' as const,
    dataPoints: candles.length,
    latestDataAt: candles.at(-1)?.date ?? null,
    calculatedAt,
    freshness: context.freshness,
    methodology: METHODOLOGY,
    parameters,
    assumptions: [
      'Current price is the latest raw close.',
      'A swing is usable only after its right-hand confirmation window has closed; no candle after confirmation participates.',
    ],
    limitations: LIMITATIONS,
  };
  const minimum = Math.max(parameters.atrPeriod + 1, parameters.pivotWindow * 2 + 1);
  if (!isValidOhlcv(candles) || candles.length < minimum) {
    return {
      status: 'unavailable',
      ...base,
      reason: !candles.length ? 'ไม่มีข้อมูล OHLCV' : `ต้องมีข้อมูล OHLCV ที่ถูกต้องอย่างน้อย ${minimum} แท่ง`,
      missingInputs: ['sufficient valid chronological OHLCV'],
    };
  }

  const currentPrice = candles.at(-1)!.close;
  const atr = atrWilder(candles, parameters.atrPeriod);
  const clusters = clusterPivots(
    confirmedSwingPivots(candles, parameters.pivotWindow),
    atr,
    parameters.atrTolerance,
    parameters.pivotWindow + 1,
  );
  const structural = clusters
    .filter((cluster) => cluster.pivots.length >= parameters.minimumTouches)
    .flatMap((cluster): SupportResistanceZone[] => {
      const midpoint = round(cluster.midpoint);
      const type = midpoint < currentPrice ? 'support' : midpoint > currentPrice ? 'resistance' : null;
      if (!type) return [];
      const scored = scoreCluster(cluster, candles, parameters);
      if (scored.strengthScore < parameters.minimumStrengthScore) return [];
      const halfWidth = Math.min(
        Math.max(cluster.tolerance / 2, Math.abs(midpoint) * 0.001),
        Math.abs(midpoint - currentPrice) * 0.8,
      );
      const strong = scored.strengthScore >= 70;
      return [{
        id: `${type}-${midpoint}-${scored.latestTouchAt}`,
        type,
        classification: type === 'support' ? (strong ? 'Strong Support' : 'Support') : (strong ? 'Strong Resistance' : 'Resistance'),
        lower: round(midpoint - halfWidth),
        upper: round(midpoint + halfWidth),
        midpoint,
        touches: cluster.pivots.length,
        latestTouchAt: scored.latestTouchAt,
        strengthScore: scored.strengthScore,
        scoreComponents: scored.components,
        reasons: scored.reasons,
      }];
    });
  const selected = (['resistance', 'support'] as const).flatMap((type) => structural
    .filter((zone) => zone.type === type)
    .sort((left, right) => Math.abs(left.midpoint - currentPrice) - Math.abs(right.midpoint - currentPrice) || right.strengthScore - left.strengthScore)
    .slice(0, Math.min(3, parameters.maximumPerSide)));
  if (!selected.length) {
    return {
      status: 'unavailable',
      ...base,
      reason: 'ไม่พบระดับที่ผ่านเกณฑ์ confirmed swing, จำนวนครั้งสัมผัส และคะแนนขั้นต่ำ',
      missingInputs: ['at least two confirmed reactions within an ATR cluster'],
    };
  }
  return { status: 'available', ...base, currentPrice, zones: selected };
}
