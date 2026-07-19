import { portfolioExpirationProfit } from './portfolio';
import type { MonteCarloResult, MonteCarloSettings, OptionLeg, SimulationWorkspace } from './types';

const ALLOWED_PATHS = new Set([1_000, 5_000, 10_000, 25_000, 50_000]);

export interface MonteCarloRunOptions {
  targetPrice?: number;
  onProgress?: (completed: number, total: number) => void;
}

type HistogramBucket = { lower: number; upper: number; count: number };

export interface MonteCarloAuditResult extends MonteCarloResult {
  validPaths: number;
  discardedPaths: number;
  terminalPriceHistogram: HistogramBucket[];
  terminalPrices: number[];
}

function finiteNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Monte Carlo produced a non-finite result');
  return Object.is(value, -0) ? 0 : value;
}

function probability(count: number, total: number): number {
  return finiteNumber(Math.min(1, Math.max(0, count / total)));
}

export function isOptionInTheMoney(terminalPrice: number, leg: Pick<OptionLeg, 'kind' | 'strike'>): boolean {
  return leg.kind === 'call' ? terminalPrice > leg.strike : terminalPrice < leg.strike;
}

export function buildHistogram(values: number[], bucketCount = 24): HistogramBucket[] {
  if (!values.length) throw new Error('Cannot build a histogram from an empty sample');
  if (!values.every(Number.isFinite)) throw new Error('Histogram values must be finite');
  if (!Number.isInteger(bucketCount) || bucketCount < 1) throw new Error('Histogram bucket count must be a positive integer');
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return [{ lower: finiteNumber(min), upper: finiteNumber(max), count: values.length }];
  const width = (max - min) / bucketCount;
  const histogram = Array.from({ length: bucketCount }, (_, index) => ({
    lower: finiteNumber(min + index * width),
    upper: finiteNumber(index === bucketCount - 1 ? max : min + (index + 1) * width),
    count: 0,
  }));
  values.forEach((value) => {
    histogram[Math.min(bucketCount - 1, Math.floor((value - min) / width))].count += 1;
  });
  return histogram;
}

export function boundedExpirationProfitFloor(workspace: SimulationWorkspace): number | null {
  const upperTailSlope = workspace.stockQuantity + workspace.legs.reduce((slope, leg) => (
    slope + (leg.kind === 'call' ? (leg.side === 'buy' ? 1 : -1) * leg.quantity * leg.multiplier : 0)
  ), 0);
  if (upperTailSlope < 0) return null;
  const candidatePrices = [...new Set([0, ...workspace.legs.map((leg) => leg.strike)])];
  return Math.min(...candidatePrices.map((price) => portfolioExpirationProfit(workspace, price)));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function normalPair(random: () => number): [number, number] {
  const u1 = Math.max(Number.EPSILON, random());
  const u2 = random();
  const radius = Math.sqrt(-2 * Math.log(u1));
  return [radius * Math.cos(2 * Math.PI * u2), radius * Math.sin(2 * Math.PI * u2)];
}

export function percentile(sorted: number[], probability: number): number {
  if (!sorted.length) throw new Error('Cannot calculate percentile of an empty sample');
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] * (1 - weight) + sorted[lower + 1] * weight;
}

export function runMonteCarlo(workspace: SimulationWorkspace, settings: MonteCarloSettings, options: MonteCarloRunOptions = {}): MonteCarloAuditResult {
  if (!workspace.underlyingPrice) throw new Error('A real or manually entered underlying price is required');
  if (!ALLOWED_PATHS.has(settings.paths)) throw new Error('Paths must be one of 1,000, 5,000, 10,000, 25,000 or 50,000');
  const targetPrice = options.targetPrice;
  if (targetPrice !== undefined && (!Number.isFinite(targetPrice) || targetPrice <= 0)) throw new Error('Target price must be a positive finite number');
  const random = mulberry32(settings.seed);
  const horizon = settings.horizonDays / 365;
  const steps = Math.max(1, Math.min(settings.steps, settings.horizonDays));
  const dt = horizon / steps;
  const drift = (settings.drift - settings.dividendYield - 0.5 * settings.volatility ** 2) * dt;
  const diffusion = settings.volatility * Math.sqrt(dt);
  const profits: number[] = [];
  const terminalPrices: number[] = [];
  const drawdowns: number[] = [];
  const samplePaths: number[][] = [];
  let itm = 0;
  let reachedTarget = 0;
  let closedAboveTarget = 0;
  let spare: number | null = null;
  let discardedPaths = 0;
  const nextNormal = () => {
    if (spare !== null) { const value = spare; spare = null; return value; }
    const pair = normalPair(random); spare = pair[1]; return pair[0];
  };
  for (let pathIndex = 0; pathIndex < settings.paths; pathIndex += 1) {
    let price = workspace.underlyingPrice;
    let touchedTarget = targetPrice === undefined || targetPrice === price;
    let peak = price;
    let maxDrawdown = 0;
    const sample = samplePaths.length < 40 ? [price] : null;
    for (let step = 0; step < steps; step += 1) {
      price *= Math.exp(drift + diffusion * nextNormal());
      if (targetPrice !== undefined && (targetPrice >= workspace.underlyingPrice ? price >= targetPrice : price <= targetPrice)) touchedTarget = true;
      peak = Math.max(peak, price);
      maxDrawdown = Math.max(maxDrawdown, (peak - price) / peak);
      sample?.push(price);
    }
    const profit = portfolioExpirationProfit(workspace, price);
    if (![price, profit, maxDrawdown].every(Number.isFinite) || sample?.some((value) => !Number.isFinite(value))) {
      discardedPaths += 1;
    } else {
      if (workspace.legs.some((leg) => isOptionInTheMoney(price, leg))) itm += 1;
      if (targetPrice !== undefined) {
        if (touchedTarget) reachedTarget += 1;
        if (price >= targetPrice) closedAboveTarget += 1;
      }
      profits.push(finiteNumber(profit));
      terminalPrices.push(finiteNumber(price));
      drawdowns.push(finiteNumber(maxDrawdown));
      if (sample) samplePaths.push(sample.map(finiteNumber));
    }
    const completed = pathIndex + 1;
    if (completed === settings.paths || completed % 250 === 0) options.onProgress?.(completed, settings.paths);
  }
  const validPaths = profits.length;
  if (validPaths === 0) throw new Error('Monte Carlo produced no valid finite paths');
  profits.sort((a, b) => a - b);
  const boundedFloor = boundedExpirationProfitFloor(workspace);
  if (boundedFloor !== null) {
    const tolerance = Math.max(1, Math.abs(boundedFloor)) * 1e-10;
    if (profits[0] < boundedFloor - tolerance) throw new Error('Bounded-loss invariant failed');
  }
  const p1 = percentile(profits, 0.01), p5 = percentile(profits, 0.05), p95 = percentile(profits, 0.95), p99 = percentile(profits, 0.99);
  const tail95 = profits.filter((value) => value <= p5);
  const tail99 = profits.filter((value) => value <= p1);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const medianProfitLoss = percentile(profits, 0.5);
  const valueAtRisk95 = Math.max(0, -p5);
  const valueAtRisk99 = Math.max(0, -p1);
  const expectedShortfall95 = Math.max(0, -mean(tail95));
  const expectedShortfall99 = Math.max(0, -mean(tail99));
  if (!(p5 <= medianProfitLoss && medianProfitLoss <= p95)) throw new Error('Percentile ordering invariant failed');
  if (expectedShortfall95 < valueAtRisk95 || expectedShortfall99 < valueAtRisk99) throw new Error('Lower-tail risk invariant failed');
  if (targetPrice !== undefined && targetPrice >= workspace.underlyingPrice && reachedTarget < closedAboveTarget) {
    throw new Error('Upward target-touch invariant failed');
  }
  return {
    paths: settings.paths, validPaths, discardedPaths, seed: settings.seed,
    probabilityOfProfit: probability(profits.filter((value) => value > 0).length, validPaths),
    probabilityItm: probability(itm, validPaths), probabilityOtm: probability(validPaths - itm, validPaths),
    expectedProfitLoss: finiteNumber(mean(profits)), medianProfitLoss: finiteNumber(medianProfitLoss),
    percentiles: { p1: finiteNumber(p1), p5: finiteNumber(p5), p95: finiteNumber(p95), p99: finiteNumber(p99) },
    confidenceIntervals: { p95: [finiteNumber(p5), finiteNumber(p95)], p99: [finiteNumber(p1), finiteNumber(p99)] },
    expectedDrawdown: finiteNumber(mean(drawdowns)),
    valueAtRisk: { p95: finiteNumber(valueAtRisk95), p99: finiteNumber(valueAtRisk99) },
    expectedShortfall: { p95: finiteNumber(expectedShortfall95), p99: finiteNumber(expectedShortfall99) },
    ...(targetPrice === undefined ? {} : {
      targetPrice,
      probabilityReachingTarget: probability(reachedTarget, validPaths),
      probabilityClosingAboveTarget: probability(closedAboveTarget, validPaths),
      probabilityClosingBelowTarget: probability(validPaths - closedAboveTarget, validPaths),
    }),
    histogram: buildHistogram(profits),
    terminalPriceHistogram: buildHistogram(terminalPrices),
    terminalPrices,
    samplePaths,
  };
}
