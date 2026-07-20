import type { NormalizedBar } from '../chart-data/timeline';
import type { SupportResistanceResult, SupportResistanceZone } from './types';

export type LevelSide = 'resistance' | 'support';

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
  score: number;
  touches: number;
  scoreExplanation?: string;
}

export interface LevelEstimate {
  bars: number;
  label: string;
  basis: string;
}

export type SupportResistanceView = {
  status: 'available';
  currentPrice: number;
  levels: ChartLevel[];
  nearest: ChartLevel;
  nearestEstimate: LevelEstimate | null;
  methodology: string;
  limitations: string[];
} | {
  status: 'unavailable';
  currentPrice: number | null;
  reason: string;
  missingInputs: string[];
};

function relabelByDistance(levels: ChartLevel[], side: LevelSide, currentPrice: number): ChartLevel[] {
  return levels
    .filter((level) => level.side === side && (side === 'resistance' ? level.price > currentPrice : level.price < currentPrice))
    .sort((left, right) => Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice) || right.score - left.score)
    .slice(0, 3)
    .map((level, index) => ({ ...level, label: `${side === 'support' ? 'S' : 'R'}${index + 1}` }));
}

function zoneLevel(zone: SupportResistanceZone, asOf: string): ChartLevel {
  return {
    id: `structure-${zone.id}`,
    label: '',
    side: zone.type,
    price: zone.midpoint,
    lower: zone.lower,
    upper: zone.upper,
    source: 'Confirmed OHLCV structure',
    asOf,
    timeframe: '1D',
    score: zone.strengthScore,
    touches: zone.touches,
    scoreExplanation: zone.reasons.map((reason) => `${reason.label} ${reason.score.toFixed(1)}`).join(' + '),
  };
}

export function structureLevels(result: SupportResistanceResult | undefined): ChartLevel[] {
  if (!result || result.status !== 'available' || !result.latestDataAt) return [];
  const levels = result.zones.map((zone) => zoneLevel(zone, result.latestDataAt as string));
  return [
    ...relabelByDistance(levels, 'resistance', result.currentPrice),
    ...relabelByDistance(levels, 'support', result.currentPrice),
  ];
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

function unavailable(bars: readonly NormalizedBar[], reason: string, missingInputs: string[]): SupportResistanceView {
  return { status: 'unavailable', currentPrice: bars.at(-1)?.close ?? null, reason, missingInputs };
}

export function buildSupportResistanceView(
  bars: readonly NormalizedBar[],
  result: SupportResistanceResult | undefined,
): SupportResistanceView {
  if (!bars.length) return unavailable(bars, 'ไม่มี canonical OHLCV timeline', ['OHLCV']);
  if (!result) return unavailable(bars, 'ไม่ได้เปิดใช้การคำนวณ S/R', ['support/resistance feature']);
  if (result.status === 'unavailable') return unavailable(bars, result.reason, result.missingInputs);

  const currentPrice = bars.at(-1)!.close;
  const latestTime = bars.at(-1)!.time;
  const priceTolerance = Math.max(Math.abs(currentPrice) * 1e-9, Number.EPSILON);
  if (result.latestDataAt !== latestTime || Math.abs(result.currentPrice - currentPrice) > priceTolerance) {
    return unavailable(bars, 'ผล S/R ไม่ตรงกับ OHLCV ชุดปัจจุบัน', ['recalculated S/R for the current symbol/range/data']);
  }
  const levels = structureLevels(result);
  if (!levels.length) {
    return unavailable(bars, 'ไม่มี confirmed structure levels ที่ผ่านเกณฑ์', ['confirmed OHLCV reactions']);
  }
  const nearest = levels.reduce((best, level) => Math.abs(level.price - currentPrice) < Math.abs(best.price - currentPrice) ? level : best);
  return {
    status: 'available',
    currentPrice,
    levels,
    nearest,
    nearestEstimate: estimateTimeToLevel(bars, nearest.price),
    methodology: result.methodology,
    limitations: result.limitations,
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
