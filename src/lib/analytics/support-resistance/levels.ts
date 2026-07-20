import type { NormalizedBar } from '../chart-data/timeline';
import type { SupportResistanceResult, SupportResistanceZone } from './types';

export type SupportResistanceMode = 'pivot' | 'structure' | 'oi' | 'expected-move' | 'confluence';
export type LevelSide = 'resistance' | 'support' | 'pivot';

export interface ChartLevel {
  id: string;
  label: string;
  side: LevelSide;
  price: number;
  lower: number;
  upper: number;
  source: string;
  asOf: string;
  timeframe: '1D';
  score: number | null;
  touches: number | null;
  scoreExplanation?: string;
}

export interface LevelEstimate {
  bars: number;
  label: string;
  basis: string;
}

export type SupportResistanceView = {
  status: 'available';
  mode: SupportResistanceMode;
  currentPrice: number;
  levels: ChartLevel[];
  nearest: ChartLevel;
  nearestEstimate: LevelEstimate | null;
  methodology: string;
  limitations: string[];
} | {
  status: 'unavailable';
  mode: SupportResistanceMode;
  currentPrice: number | null;
  reason: string;
  missingInputs: string[];
};

const round = (value: number, digits = 6) => Number(value.toFixed(digits));

function baseLevel(input: Omit<ChartLevel, 'lower' | 'upper' | 'timeframe'> & { lower?: number; upper?: number }): ChartLevel {
  return {
    ...input,
    lower: input.lower ?? input.price,
    upper: input.upper ?? input.price,
    timeframe: '1D',
  };
}

export function calculateClassicPivotLevels(bars: readonly NormalizedBar[], latestSessionComplete = true): ChartLevel[] {
  if (!bars.length || (!latestSessionComplete && bars.length < 2)) return [];
  // End-of-day/cached daily history ends at the previous completed session.
  // Realtime/delayed history can include a live daily bar, so that case uses
  // the penultimate session and never calculates pivots from an open session.
  const previous = bars[bars.length - (latestSessionComplete ? 1 : 2)];
  const pivot = (previous.high + previous.low + previous.close) / 3;
  const spread = previous.high - previous.low;
  const values = {
    P: pivot,
    R1: (2 * pivot) - previous.low,
    R2: pivot + spread,
    R3: previous.high + (2 * (pivot - previous.low)),
    S1: (2 * pivot) - previous.high,
    S2: pivot - spread,
    S3: previous.low - (2 * (previous.high - pivot)),
  };
  return (Object.entries(values) as Array<[keyof typeof values, number]>).map(([label, rawPrice]) => {
    const price = round(rawPrice);
    const side: LevelSide = label === 'P' ? 'pivot' : label.startsWith('R') ? 'resistance' : 'support';
    return baseLevel({
      id: `pivot-${label}-${previous.time}`,
      label,
      side,
      price,
      source: 'Classic Pivot',
      asOf: previous.time,
      score: null,
      touches: null,
    });
  });
}

function relabelByDistance(levels: ChartLevel[], side: 'support' | 'resistance', currentPrice: number): ChartLevel[] {
  return levels
    .filter((level) => level.side === side)
    .sort((left, right) => Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice) || left.price - right.price)
    .slice(0, 3)
    .map((level, index) => ({ ...level, label: `${side === 'support' ? 'S' : 'R'}${index + 1}` }));
}

function smartZoneLevel(zone: SupportResistanceZone, asOf: string): ChartLevel | null {
  if (zone.type === 'fast-zone') return null;
  return baseLevel({
    id: `structure-${zone.id}`,
    label: '',
    side: zone.type,
    price: zone.midpoint,
    lower: zone.lower,
    upper: zone.upper,
    source: 'Smart Structure',
    asOf,
    score: zone.strengthScore,
    touches: zone.touches,
    scoreExplanation: zone.reasons.map((reason) => `${reason.label} ${reason.score.toFixed(1)}`).join(' + '),
  });
}

export function structureLevels(result: SupportResistanceResult | undefined): ChartLevel[] {
  if (!result || result.status !== 'available' || !result.latestDataAt) return [];
  const levels = result.zones.flatMap((zone) => {
    const level = smartZoneLevel(zone, result.latestDataAt as string);
    return level ? [level] : [];
  });
  return [...relabelByDistance(levels, 'resistance', result.currentPrice), ...relabelByDistance(levels, 'support', result.currentPrice)];
}

function confluenceLevels(pivot: ChartLevel[], structure: ChartLevel[], currentPrice: number): ChartLevel[] {
  const tolerance = Math.max(Math.abs(currentPrice) * 0.005, Number.EPSILON);
  const candidates = [...pivot.filter((level) => level.side !== 'pivot'), ...structure].map((level) => {
    const peers = (level.source === 'Classic Pivot' ? structure : pivot).filter((peer) => peer.side === level.side);
    const match = peers.find((peer) => Math.abs(peer.price - level.price) <= tolerance);
    const baseScore = level.score ?? 55;
    const score = Math.min(100, baseScore + (match ? 20 : 0));
    const price = match ? round((level.price + match.price) / 2) : level.price;
    return baseLevel({
      ...level,
      id: `confluence-${level.id}`,
      price,
      lower: match ? Math.min(level.lower, match.lower) : level.lower,
      upper: match ? Math.max(level.upper, match.upper) : level.upper,
      source: match ? 'Confluence: Pivot + Smart Structure' : `Confluence: ${level.source}`,
      score,
      scoreExplanation: `${level.source} base ${baseScore.toFixed(1)}${match ? ' + cross-source proximity 20.0' : ''}`,
    });
  });
  const unique = new Map<string, ChartLevel>();
  candidates.sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice)).forEach((level) => {
    const key = `${level.side}:${round(level.price / tolerance, 0)}`;
    if (!unique.has(key)) unique.set(key, level);
  });
  const selected = [...unique.values()];
  return [...relabelByDistance(selected, 'resistance', currentPrice), ...relabelByDistance(selected, 'support', currentPrice)];
}

export function estimateTimeToLevel(bars: readonly NormalizedBar[], target: number): LevelEstimate | null {
  if (bars.length < 15) return null;
  const recent = bars.slice(-15);
  const trueRanges = recent.slice(1).map((bar, index) => Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - recent[index].close),
    Math.abs(bar.low - recent[index].close),
  ));
  const realizedMoves = recent.slice(1).map((bar, index) => Math.abs(bar.close - recent[index].close));
  const atr = trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
  const realized = realizedMoves.reduce((sum, value) => sum + value, 0) / realizedMoves.length;
  const conservativeMove = Math.min(atr, realized);
  if (!Number.isFinite(conservativeMove) || conservativeMove <= 0) return null;
  const barsRequired = Math.max(1, Math.ceil(Math.abs(target - bars.at(-1)!.close) / conservativeMove));
  return {
    bars: barsRequired,
    label: `ประมาณ ${barsRequired} วันทำการ`,
    basis: 'ค่าประมาณเชิงสถิติจากค่าต่ำกว่าระหว่าง ATR 14 และ realized absolute move 14 วัน',
  };
}

function unavailable(mode: SupportResistanceMode, bars: readonly NormalizedBar[], reason: string, missingInputs: string[]): SupportResistanceView {
  return { status: 'unavailable', mode, currentPrice: bars.at(-1)?.close ?? null, reason, missingInputs };
}

export function buildSupportResistanceView(
  mode: SupportResistanceMode,
  bars: readonly NormalizedBar[],
  smart: SupportResistanceResult | undefined,
): SupportResistanceView {
  if (!bars.length) return unavailable(mode, bars, 'ไม่มี canonical OHLCV timeline', ['OHLCV']);
  if (mode === 'oi') return unavailable(mode, bars, 'ไม่มี normalized options chain จริงสำหรับ chart นี้', ['options chain', 'expiration', 'OI', 'provider asOf']);
  if (mode === 'expected-move') return unavailable(mode, bars, 'ไม่มี ATM/near-ATM implied volatility จริงจาก expiration เดียวกัน', ['options chain', 'expiration', 'ATM IV', 'DTE']);

  const currentPrice = bars.at(-1)!.close;
  const latestSessionComplete = smart?.freshness.status === 'end-of-day' || smart?.freshness.status === 'cached' || smart?.freshness.status === 'stale';
  const pivot = calculateClassicPivotLevels(bars, latestSessionComplete);
  const structure = structureLevels(smart);
  let levels: ChartLevel[];
  let methodology: string;
  if (mode === 'pivot') {
    levels = pivot;
    methodology = 'P=(H+L+C)/3; Classic R1-R3/S1-S3 use the previous completed daily session.';
  } else if (mode === 'structure') {
    levels = structure;
    methodology = smart?.methodology ?? 'Confirmed swing pivots clustered by ATR without look-ahead.';
  } else {
    levels = confluenceLevels(pivot, structure, currentPrice);
    methodology = 'Transparent score: Pivot base 55 or Smart Structure score, plus 20 when cross-source levels are within 0.5% of spot.';
  }
  const actionable = levels.filter((level) => level.side !== 'pivot');
  if (!actionable.length) {
    const missing = mode === 'pivot' ? ['two daily sessions'] : ['confirmed Smart Structure levels'];
    return unavailable(mode, bars, mode === 'pivot' ? 'ต้องมีอย่างน้อยสอง market sessions' : 'ไม่มี confirmed structure levels ที่ผ่านเกณฑ์', missing);
  }
  const nearest = actionable.reduce((best, level) => Math.abs(level.price - currentPrice) < Math.abs(best.price - currentPrice) ? level : best);
  return {
    status: 'available',
    mode,
    currentPrice,
    levels,
    nearest,
    nearestEstimate: estimateTimeToLevel(bars, nearest.price),
    methodology,
    limitations: [
      'ระดับเป็นข้อมูลอ้างอิงเชิงวิเคราะห์ ไม่ใช่คำแนะนำซื้อขายหรือการรับประกันว่าราคาจะหยุดหรือกลับตัว',
      'Estimated time เป็นเพียงค่าประมาณเชิงสถิติ ไม่ใช่การรับประกันเวลาไปถึงระดับ',
    ],
  };
}

export function summaryRows(view: Extract<SupportResistanceView, { status: 'available' }>): Array<ChartLevel | { current: true; price: number }> {
  const byLabel = new Map(view.levels.map((level) => [level.label, level]));
  const rows: Array<ChartLevel | { current: true; price: number }> = [];
  ['R3', 'R2', 'R1'].forEach((label) => { const level = byLabel.get(label); if (level) rows.push(level); });
  rows.push({ current: true, price: view.currentPrice });
  ['S1', 'S2', 'S3'].forEach((label) => { const level = byLabel.get(label); if (level) rows.push(level); });
  return rows;
}
