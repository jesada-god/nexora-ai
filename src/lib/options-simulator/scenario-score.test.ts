import { describe, expect, it } from 'vitest';
import { convertUsdForDisplay } from '../../components/options-simulator/simulator-ux';
import { runMonteCarlo } from './monte-carlo';
import {
  calculateCallPutScenarioScore,
  normalizeScenarioMetricPair,
  scoreScenarioMetrics,
  type CallPutScenarioMetrics,
} from './scenario-score';
import type { OptionLeg, SimulationWorkspace } from './types';

const optionLeg = (overrides: Partial<OptionLeg>): OptionLeg => ({
  id: 'call',
  kind: 'call',
  side: 'buy',
  quantity: 1,
  strike: 100,
  expiration: '2027-01-01',
  entryPremium: 5,
  impliedVolatility: 0.2,
  multiplier: 100,
  fees: 1,
  style: 'european',
  ...overrides,
});

const comparisonWorkspace = (overrides: Partial<SimulationWorkspace> = {}): SimulationWorkspace => ({
  name: 'Scenario score',
  description: '',
  symbol: 'TEST',
  companyName: 'Test Inc',
  exchange: 'NASDAQ',
  currency: 'USD',
  simulationType: 'monte-carlo',
  strategyType: 'Straddle',
  underlyingPrice: 100,
  stockQuantity: 0,
  cashPosition: 0,
  entryDate: '2026-01-01',
  valuationDate: '2026-01-01',
  legs: [
    optionLeg({ id: 'call', kind: 'call' }),
    optionLeg({ id: 'put', kind: 'put' }),
  ],
  scenarios: [{
    id: 'base',
    name: 'Base',
    targetPrice: 100,
    valuationDate: '2026-06-01',
    volatilityShift: 0,
    rate: 0,
    dividendYield: 0,
  }],
  monteCarlo: {
    paths: 1_000,
    seed: 42,
    horizonDays: 151,
    steps: 30,
    drift: 0,
    volatility: 0.2,
    rate: 0,
    dividendYield: 0,
  },
  dataSource: null,
  dataTimestamp: null,
  dataStatus: 'manual',
  resultSnapshot: null,
  methodologyVersion: 'options-simulator-v1',
  ...overrides,
});

const identicalMetrics = (): CallPutScenarioMetrics => ({
  probabilityOfProfit: 0.5,
  expectedProfitLoss: 10,
  riskAdjustedEv: 0.1,
  medianProfitLoss: 5,
  p5ProfitLoss: -20,
  expectedShortfall95ProfitLoss: -30,
  maxLoss: -100,
  downsideValue: -0.2,
  initialRisk: 100,
  targetDirectionConsistency: 0.5,
});

describe('Call/Put Scenario Score', () => {
  it('normalizes identical metrics to 50/50 and protects a zero denominator', () => {
    expect(normalizeScenarioMetricPair(0, 0)).toEqual({ call: 0.5, put: 0.5 });
    const score = scoreScenarioMetrics(identicalMetrics(), identicalMetrics());
    expect(score.callPercent).toBe(50);
    expect(score.putPercent).toBe(50);
  });

  it('keeps Call% + Put% equal to 100 and returns only bounded finite values', () => {
    const input = comparisonWorkspace({
      scenarios: [{ ...comparisonWorkspace().scenarios[0], targetPrice: 110 }],
    });
    const score = calculateCallPutScenarioScore(input, input.monteCarlo, Array(1_000).fill(120), 110);
    expect(score.status).toBe('available');
    if (score.status !== 'available') return;
    expect(score.callPercent + score.putPercent).toBe(100);
    for (const value of [score.callPercent, score.putPercent]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(JSON.stringify(score)).not.toMatch(/NaN|Infinity/);
  });

  it('leans Call for bullish paths and Put for bearish paths', () => {
    const bullishInput = comparisonWorkspace({
      scenarios: [{ ...comparisonWorkspace().scenarios[0], targetPrice: 110 }],
    });
    const bearishInput = comparisonWorkspace({
      scenarios: [{ ...comparisonWorkspace().scenarios[0], targetPrice: 90 }],
    });
    const bullish = calculateCallPutScenarioScore(bullishInput, bullishInput.monteCarlo, Array(1_000).fill(125), 110);
    const bearish = calculateCallPutScenarioScore(bearishInput, bearishInput.monteCarlo, Array(1_000).fill(75), 90);
    expect(bullish.status).toBe('available');
    expect(bearish.status).toBe('available');
    if (bullish.status !== 'available' || bearish.status !== 'available') return;
    expect(bullish.callPercent).toBeGreaterThan(bullish.putPercent);
    expect(bearish.putPercent).toBeGreaterThan(bearish.callPercent);
  });

  it('returns 50/50 and an unclear outlook for symmetric contracts and paths', () => {
    const input = comparisonWorkspace();
    const score = calculateCallPutScenarioScore(input, input.monteCarlo, Array(1_000).fill(100), 100);
    expect(score.status).toBe('available');
    if (score.status !== 'available') return;
    expect(score.callPercent).toBeCloseTo(50, 10);
    expect(score.putPercent).toBeCloseTo(50, 10);
    expect(score.outlook).toBe('unclear');
  });

  it('is deterministic for the same seed and paths', () => {
    const input = comparisonWorkspace({
      scenarios: [{ ...comparisonWorkspace().scenarios[0], targetPrice: 110 }],
    });
    const firstPaths = runMonteCarlo(input, input.monteCarlo).terminalPrices;
    const secondPaths = runMonteCarlo(input, input.monteCarlo).terminalPrices;
    const first = calculateCallPutScenarioScore(input, input.monteCarlo, firstPaths, 110);
    const second = calculateCallPutScenarioScore(input, input.monteCarlo, secondPaths, 110);
    expect(firstPaths).toEqual(secondPaths);
    expect(first).toEqual(second);
  });

  it('does not change score when USD values are converted for THB display', () => {
    const input = comparisonWorkspace({
      scenarios: [{ ...comparisonWorkspace().scenarios[0], targetPrice: 110 }],
    });
    const score = calculateCallPutScenarioScore(input, input.monteCarlo, Array(1_000).fill(120), 110);
    expect(score.status).toBe('available');
    if (score.status !== 'available') return;
    const before = structuredClone(score);
    [
      score.callMetrics.expectedProfitLoss,
      score.putMetrics.expectedProfitLoss,
      score.callMetrics.medianProfitLoss,
      score.putMetrics.medianProfitLoss,
    ].map((value) => convertUsdForDisplay(value, 'THB', 35));
    expect(score).toEqual(before);
  });

  it('does not create a score when either actual premium is unavailable', () => {
    const input = comparisonWorkspace({
      legs: [
        optionLeg({ id: 'call', kind: 'call', entryPremium: 0 }),
        optionLeg({ id: 'put', kind: 'put', entryPremium: 5 }),
      ],
    });
    const score = calculateCallPutScenarioScore(input, input.monteCarlo, Array(1_000).fill(100), 100);
    expect(score).toEqual(expect.objectContaining({
      status: 'unavailable',
      auditStatus: 'not-run',
    }));
    expect(score).not.toHaveProperty('callPercent');
    expect(score).not.toHaveProperty('putPercent');
  });

  it('hides percentages when the path-count audit fails', () => {
    const input = comparisonWorkspace();
    const score = calculateCallPutScenarioScore(input, input.monteCarlo, Array(999).fill(100), 100);
    expect(score).toEqual(expect.objectContaining({
      status: 'unavailable',
      auditStatus: 'failed',
    }));
    expect(score).not.toHaveProperty('callPercent');
    expect(score).not.toHaveProperty('putPercent');
  });

  it('uses each real premium in initial risk instead of rewarding unlimited upside for free', () => {
    const base = comparisonWorkspace({
      scenarios: [{ ...comparisonWorkspace().scenarios[0], targetPrice: 110 }],
    });
    const expensiveCall = comparisonWorkspace({
      scenarios: [{ ...comparisonWorkspace().scenarios[0], targetPrice: 110 }],
      legs: [
        optionLeg({ id: 'call', kind: 'call', entryPremium: 20 }),
        optionLeg({ id: 'put', kind: 'put', entryPremium: 5 }),
      ],
    });
    const equalPremiumScore = calculateCallPutScenarioScore(base, base.monteCarlo, Array(1_000).fill(110), 110);
    const expensiveCallScore = calculateCallPutScenarioScore(expensiveCall, expensiveCall.monteCarlo, Array(1_000).fill(110), 110);
    expect(equalPremiumScore.status).toBe('available');
    expect(expensiveCallScore.status).toBe('available');
    if (equalPremiumScore.status !== 'available' || expensiveCallScore.status !== 'available') return;
    expect(expensiveCallScore.callMetrics.initialRisk).toBeGreaterThan(equalPremiumScore.callMetrics.initialRisk);
    expect(expensiveCallScore.callPercent).toBeLessThan(equalPremiumScore.callPercent);
  });

  it('never uses Manual Delta to decide the score', () => {
    const input = comparisonWorkspace();
    const manualDelta = comparisonWorkspace({
      legs: input.legs.map((leg) => ({
        ...leg,
        delta: leg.kind === 'call' ? -1 : 1,
        deltaSource: 'manual',
      })),
    });
    const paths = Array(1_000).fill(105);
    expect(calculateCallPutScenarioScore(manualDelta, manualDelta.monteCarlo, paths, 100))
      .toEqual(calculateCallPutScenarioScore(input, input.monteCarlo, paths, 100));
  });
});
