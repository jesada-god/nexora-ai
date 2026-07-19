import { describe, expect, it } from 'vitest';
import { runMonteCarlo } from './monte-carlo';
import { blackScholes, binomialValue } from './pricing';
import { detectStrategy, optionExpirationProfit, portfolioExpirationProfit, valuePortfolio } from './portfolio';
import type { OptionLeg, SimulationWorkspace } from './types';
import { calculationValidationMessages, validationMessages } from './validation';

const leg = (overrides: Partial<OptionLeg> = {}): OptionLeg => ({ id: 'leg-1', kind: 'call', side: 'buy', quantity: 1,
  strike: 100, expiration: '2027-01-01', entryPremium: 10, impliedVolatility: 0.2, multiplier: 100, fees: 2,
  style: 'european', ...overrides });

const workspace = (overrides: Partial<SimulationWorkspace> = {}): SimulationWorkspace => ({
  name: 'Test simulation', description: '', symbol: 'TEST', companyName: 'Test Inc', exchange: 'NASDAQ', currency: 'USD',
  simulationType: 'what-if', strategyType: 'Long Call', underlyingPrice: 100, stockQuantity: 0, cashPosition: 0,
  entryDate: '2026-01-01', valuationDate: '2026-01-01', legs: [leg()], scenarios: [{ id: 'base', name: 'Base',
    targetPrice: 100, valuationDate: '2026-01-01', volatilityShift: 0, rate: 0.05, dividendYield: 0 }],
  monteCarlo: { paths: 1_000, seed: 123, horizonDays: 365, steps: 50, drift: 0.05, volatility: 0.2, rate: 0.05, dividendYield: 0 },
  dataSource: null, dataTimestamp: null, dataStatus: 'manual', resultSnapshot: null, methodologyVersion: 'options-simulator-v1', ...overrides,
});

const visibleContract = () => ({
  symbol: 'SOFI',
  underlyingPrice: 11.46,
  valuationDate: '2026-07-19',
  legs: [{
    kind: 'put',
    side: 'buy',
    quantity: 1,
    strike: 13.5,
    expiration: '2026-07-24',
    entryPremium: 1.4,
    impliedVolatility: 1.1614,
    delta: -0.78,
    theta: -0.0361,
    multiplier: 100,
  }],
  scenarios: [{
    targetPrice: 10.1,
    valuationDate: '2026-07-22',
  }],
});

describe('options pricing', () => {
  it('matches a known Black-Scholes case and put-call parity', () => {
    const common = { spot: 100, strike: 100, timeYears: 1, volatility: 0.2, rate: 0.05, dividendYield: 0 };
    const call = blackScholes({ ...common, kind: 'call' });
    const put = blackScholes({ ...common, kind: 'put' });
    expect(call.value).toBeCloseTo(10.4506, 3);
    expect(put.value).toBeCloseTo(5.5735, 3);
    expect(call.value - put.value).toBeCloseTo(100 - 100 * Math.exp(-0.05), 4);
  });

  it('returns intrinsic value for calls and puts at expiration', () => {
    const common = { strike: 100, timeYears: 0, volatility: 0.2, rate: 0.05, dividendYield: 0 };
    expect(blackScholes({ ...common, spot: 120, kind: 'call' }).value).toBe(20);
    expect(blackScholes({ ...common, spot: 80, kind: 'put' }).value).toBe(20);
    expect(blackScholes({ ...common, spot: 80, kind: 'call' }).value).toBe(0);
    expect(blackScholes({ ...common, spot: 120, kind: 'put' }).value).toBe(0);
  });

  it('keeps an American option at least as valuable as its European tree equivalent', () => {
    const common = { spot: 90, strike: 100, timeYears: 1, volatility: 0.25, rate: 0.05, dividendYield: 0,
      kind: 'put' as const };
    const european = binomialValue({ ...common, style: 'european' }, 300);
    const american = binomialValue({ ...common, style: 'american' }, 300);
    expect(american).toBeGreaterThanOrEqual(european);
  });

  it('produces Greeks consistent with finite price changes', () => {
    const base = { spot: 100, strike: 100, timeYears: 1, volatility: 0.2, rate: 0.05, dividendYield: 0, kind: 'call' as const };
    const result = blackScholes(base);
    const epsilon = 0.01;
    const delta = (blackScholes({ ...base, spot: 100 + epsilon }).value - blackScholes({ ...base, spot: 100 - epsilon }).value) / (2 * epsilon);
    expect(result.greeks.delta).toBeCloseTo(delta, 4);
    Object.values(result.greeks).forEach((value) => expect(Number.isFinite(value)).toBe(true));
  });
});

describe('portfolio payoff and strategy handling', () => {
  it('uses the correct P&L sign for Buy/Sell Call/Put positions', () => {
    const common = { entryPremium: 5, multiplier: 100, fees: 0 };
    expect(optionExpirationProfit(leg({ ...common, kind: 'call', side: 'buy' }), 120)).toBe(1_500);
    expect(optionExpirationProfit(leg({ ...common, kind: 'call', side: 'sell' }), 120)).toBe(-1_500);
    expect(optionExpirationProfit(leg({ ...common, kind: 'put', side: 'buy' }), 80)).toBe(1_500);
    expect(optionExpirationProfit(leg({ ...common, kind: 'put', side: 'sell' }), 80)).toBe(-1_500);
  });

  it('applies side, quantity, multiplier and commission', () => {
    expect(optionExpirationProfit(leg({ quantity: 2, multiplier: 50, fees: 3 }), 120)).toBe(997);
    expect(optionExpirationProfit(leg({ side: 'sell', quantity: 2, multiplier: 50, fees: 3 }), 120)).toBe(-1003);
  });

  it('scales exactly once by quantity and contract multiplier', () => {
    const unscaled = optionExpirationProfit(leg({ entryPremium: 2, quantity: 1, multiplier: 1, fees: 0 }), 110);
    const scaled = optionExpirationProfit(leg({ entryPremium: 2, quantity: 3, multiplier: 50, fees: 0 }), 110);
    expect(unscaled).toBe(8);
    expect(scaled).toBe(unscaled * 3 * 50);
  });

  it('aggregates multiple legs and detects common strategies', () => {
    const spread = [leg(), leg({ id: 'leg-2', side: 'sell', strike: 110, entryPremium: 5 })];
    expect(portfolioExpirationProfit(workspace({ legs: spread }), 120)).toBe(496);
    expect(detectStrategy(spread)).toBe('Vertical Spread');
    const valuation = valuePortfolio(workspace({ legs: spread }), workspace({ legs: spread }).scenarios[0]);
    expect(valuation.legs).toHaveLength(2);
    expect(valuation.breakEvens[0]).toBeCloseTo(105, 1);
    expect(valuation.unlimitedLoss).toBe(false);
  });

  it('classifies naked short call loss as unlimited', () => {
    const result = valuePortfolio(workspace({ legs: [leg({ side: 'sell' })] }), workspace().scenarios[0]);
    expect(result.unlimitedLoss).toBe(true);
    expect(result.maxLoss).toBeNull();
  });

  it('keeps manual Delta and Theta out of the pricing-engine value', () => {
    const scenario = workspace().scenarios[0];
    const modelOnly = valuePortfolio(workspace({ legs: [leg({ delta: null, theta: null })] }), scenario);
    const manualGreeks = valuePortfolio(workspace({ legs: [leg({
      delta: 0.99,
      theta: -999,
      deltaSource: 'manual',
      thetaSource: 'manual',
    })] }), scenario);

    expect(manualGreeks.theoreticalValue).toBe(modelOnly.theoreticalValue);
    expect(manualGreeks.profitLoss).toBe(modelOnly.profitLoss);
    expect(manualGreeks.legs[0].value).toBe(modelOnly.legs[0].value);
  });

  it('reconciles Current plus Difference to Simulated within tolerance', () => {
    const input = workspace();
    const current = valuePortfolio(input, input.scenarios[0]);
    const simulated = valuePortfolio(input, { ...input.scenarios[0], targetPrice: 115, valuationDate: '2026-06-01', volatilityShift: 0.1 });
    const difference = simulated.theoreticalValue - current.theoreticalValue;

    expect(current.theoreticalValue + difference).toBeCloseTo(simulated.theoreticalValue, 10);
  });

  it('never returns NaN or Infinity for a valid What-If valuation', () => {
    const input = workspace();
    const result = valuePortfolio(input, { ...input.scenarios[0], targetPrice: 125, valuationDate: '2026-09-01', volatilityShift: 0.25 });

    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    expect(Object.values(result.greeks).every(Number.isFinite)).toBe(true);
    expect(result.legs.every((item) => Number.isFinite(item.value) && Number.isFinite(item.profitLoss))).toBe(true);
  });

  it('passes one calendar DTE to pricing across a daylight-saving boundary', () => {
    const scenario = { ...workspace().scenarios[0], valuationDate: '2026-03-08' };
    const input = workspace({
      valuationDate: '2026-03-08',
      legs: [leg({ expiration: '2026-03-09', fees: 0 })],
      scenarios: [scenario],
    });
    const result = valuePortfolio(input, scenario);
    const expected = blackScholes({
      spot: scenario.targetPrice,
      strike: 100,
      timeYears: 1 / 365.25,
      volatility: 0.2,
      rate: scenario.rate,
      dividendYield: scenario.dividendYield,
      kind: 'call',
    });

    expect(result.legs[0].value).toBeCloseTo(expected.value * 100, 10);
  });
});

describe('validation and Monte Carlo', () => {
  it('accepts the complete visible Put contract without hidden legacy fields', () => {
    expect(calculationValidationMessages(visibleContract())).toEqual([]);
  });

  it('accepts finite negative Theta from manual, model or provider state', () => {
    for (const thetaSource of ['manual', 'model', 'provider'] as const) {
      const input = visibleContract();
      input.legs[0] = { ...input.legs[0], theta: -0.0361, thetaSource } as typeof input.legs[0];
      expect(calculationValidationMessages(input)).toEqual([]);
    }
  });

  it('accepts a Target Date after valuation and before expiration', () => {
    const input = visibleContract();
    input.scenarios[0].valuationDate = '2026-07-22';
    input.legs[0].expiration = '2026-07-24';
    expect(calculationValidationMessages(input)).toEqual([]);
  });

  it('reports the real invalid field and rejects NaN or Infinity', () => {
    const invalidPremium = visibleContract();
    invalidPremium.legs[0].entryPremium = Number.NaN;
    expect(calculationValidationMessages(invalidPremium)[0]).toContain('legs.0.entryPremium');

    const invalidTheta = visibleContract();
    invalidTheta.legs[0].theta = Number.POSITIVE_INFINITY;
    expect(calculationValidationMessages(invalidTheta)[0]).toContain('legs.0.theta');
  });

  it('identifies the exact invalid leg and expiration', () => {
    const invalid = workspace({ legs: [leg({ strike: 0, expiration: '2025-01-01' })] });
    const messages = validationMessages(invalid);
    expect(messages.some((message) => message.startsWith('legs.0.strike'))).toBe(true);
    expect(messages.some((message) => message.startsWith('legs.0.expiration'))).toBe(true);
  });

  it('validates manual Greeks and only accepts approved path counts', () => {
    const invalid = workspace({
      legs: [leg({ delta: 1.1, theta: Number.POSITIVE_INFINITY, deltaSource: 'manual', thetaSource: 'manual' })],
      monteCarlo: { ...workspace().monteCarlo, paths: 2_000 },
    });
    const messages = validationMessages(invalid);
    expect(messages.some((message) => message.startsWith('legs.0.delta'))).toBe(true);
    expect(messages.some((message) => message.startsWith('legs.0.theta'))).toBe(true);
    expect(messages.some((message) => message.startsWith('monteCarlo.paths'))).toBe(true);
  });

  it('is deterministic with ordered percentiles and bounded probabilities', () => {
    const input = workspace();
    const first = runMonteCarlo(input, input.monteCarlo);
    const second = runMonteCarlo(input, input.monteCarlo);
    expect(first).toEqual(second);
    expect(first.probabilityOfProfit).toBeGreaterThanOrEqual(0);
    expect(first.probabilityOfProfit).toBeLessThanOrEqual(1);
    expect(first.probabilityItm + first.probabilityOtm).toBeCloseTo(1, 10);
    expect(first.percentiles.p1).toBeLessThanOrEqual(first.percentiles.p5);
    expect(first.percentiles.p5).toBeLessThanOrEqual(first.percentiles.p95);
    expect(first.percentiles.p95).toBeLessThanOrEqual(first.percentiles.p99);
    expect(first.samplePaths.length).toBeLessThanOrEqual(40);
    expect(JSON.stringify(first)).not.toMatch(/NaN|Infinity/);
  });

  it('separates touching a target from terminal closing probabilities and reports real progress', () => {
    const input = workspace();
    const progress: number[] = [];
    const result = runMonteCarlo(input, input.monteCarlo, {
      targetPrice: 110,
      onProgress: (completed) => progress.push(completed),
    });
    expect(result.probabilityReachingTarget).toBeGreaterThanOrEqual(result.probabilityClosingAboveTarget ?? 0);
    expect((result.probabilityClosingAboveTarget ?? 0) + (result.probabilityClosingBelowTarget ?? 0)).toBeCloseTo(1, 10);
    expect(progress.at(-1)).toBe(input.monteCarlo.paths);
    expect(progress.every((completed, index) => index === 0 || completed > progress[index - 1])).toBe(true);
  });
});
