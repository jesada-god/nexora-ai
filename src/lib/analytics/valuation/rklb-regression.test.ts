import { describe, expect, it } from 'vitest';
import { calculateFairValue } from './engine';
import { relativeValuation } from './formulas';
import type { FinancialPeriod, ValuationInput } from './types';

// Deterministic RKLB-like pre-profit growth fixture. Values are illustrative and
// internally consistent (USD millions for money, absolute count for shares); no
// assertion here claims a specific market value is "correct". The point is that
// model *eligibility* and the enterprise→equity bridge behave correctly for a
// revenue-generating, loss-making company — not to force a higher valuation.
const history = Array.from({ length: 260 }, (_, index) => ({
  date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  open: 20, high: 22, low: 19, close: 21, volume: 5_000_000,
}));

function preProfitPeriods(overrides: Partial<FinancialPeriod> = {}): FinancialPeriod[] {
  // Revenue grows; every profitability/cash-flow line is negative (pre-profit).
  return [2022, 2023, 2024].map((year, index) => ({
    periodEnd: `${year}-12-31`, currency: 'USD',
    revenue: 210 + index * 110, // 210 → 320 → 430
    grossProfit: 40 + index * 20,
    operatingIncome: -120 + index * 10,
    ebitda: -95 + index * 10,
    netIncome: -130 + index * 10,
    dilutedEps: -0.28 + index * 0.02, // stays negative
    depreciationAmortization: 15,
    capitalExpenditure: -30,
    changeInWorkingCapital: 5,
    operatingCashFlow: -70 + index * 5,
    freeCashFlow: -100 + index * 5, // stays negative
    dividendsPaid: null,
    interestExpense: 12,
    totalDebt: 465, cash: 420,
    totalAssets: 1_100, totalLiabilities: 720, totalEquity: 380,
    dilutedShares: 490,
    ...overrides,
  }));
}

function rklbInput(overrides: Partial<ValuationInput> = {}): ValuationInput {
  return {
    symbol: 'RKLB', currency: 'USD', marketPrice: 21, marketCapitalization: 490 * 21,
    priceAsOf: '2025-01-02T00:00:00.000Z', source: 'alpha-vantage', sourceType: 'provider-supplied',
    sector: 'Industrials', industry: 'Aerospace & Defense',
    periods: preProfitPeriods(), historicalPrices: history, historySource: 'alpha-vantage',
    historyFreshness: { status: 'end-of-day', asOf: '2025-01-02T00:00:00.000Z', maxAgeSeconds: 86_400 },
    calculatedAt: '2025-01-03T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = Date.parse('2025-01-03T00:00:00.000Z');

describe('RKLB-style pre-profit Fair Value regression (methodology unchanged)', () => {
  it('excludes P/E, PEG and DCF and selects EV/Sales when only revenue is defensible', () => {
    const result = calculateFairValue(rklbInput(), NOW);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const selected = result.modelResults.map((model) => model.model);
    // Negative EPS blocks P/E and PEG (and there is no Graham model for such names);
    // negative FCF/EBITDA blocks a forced DCF and EV/EBITDA. Only EV/Sales survives.
    expect(selected).toEqual(['ev-sales']);
    expect(result.selectedModel).toBe('ev-sales');
    const excluded = result.excludedModels.map((model) => model.model);
    expect(excluded).toEqual(expect.arrayContaining(['pe', 'peg', 'ev-ebitda', 'fcff-dcf']));
  });

  it('bridges enterprise value to equity with EV + cash - debt over validated shares', () => {
    const result = calculateFairValue(rklbInput(), NOW);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const model = result.modelResults.find((item) => item.model === 'ev-sales')!;
    const revenue = Number(model.inputs.metric);
    const cash = Number(model.inputs.cash);
    const debt = Number(model.inputs.totalDebt);
    const shares = Number(model.inputs.dilutedShares);
    const baseMultiple = Number(model.assumptions.baseMultiple);
    // equity per share = (revenue × multiple + cash − debt) / shares
    const expectedBase = (revenue * baseMultiple + cash - debt) / shares;
    expect(model.scenarios!.base).toBeCloseTo(expectedBase, 6);
    expect(model.methodology).toContain('enterprise value + cash - debt');
  });

  it('keeps Conservative <= Base <= Optimistic and never emits NaN/Infinity or a silent zero', () => {
    const result = calculateFairValue(rklbInput(), NOW);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const { conservative, base, optimistic, centralEstimate } = result.fundamentalFairValue;
    for (const value of [conservative.low, conservative.high, base.low, base.high, optimistic.low, optimistic.high, centralEstimate, result.upsideAmount, result.upsidePercent]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(conservative.high).toBeLessThanOrEqual(base.high + 1e-9);
    expect(base.high).toBeLessThanOrEqual(optimistic.high + 1e-9);
    expect(centralEstimate).toBeGreaterThan(0);
  });

  it('exposes assumptions and provider provenance, in USD, with no THB conversion', () => {
    const result = calculateFairValue(rklbInput(), NOW);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.currency).toBe('USD');
    expect(result.displayFx).toBeNull();
    expect(result.assumptionDetails.length).toBeGreaterThan(0);
    expect(result.sources.some((source) => source.name === 'alpha-vantage')).toBe(true);
    expect(result.methodologyVersion).toBe('nexora-fv-v1');
    // Every disclosed input is quoted in USD (or a null-currency share count), never THB.
    expect(result.inputDetails.every((item) => item.currency === null || item.currency === 'USD')).toBe(true);
  });

  it('validates share scale: non-positive diluted shares yield unavailable, not a divide-by-zero', () => {
    const result = calculateFairValue(rklbInput({ periods: preProfitPeriods({ dilutedShares: 0 }) }), NOW);
    expect(result.status).toBe('unavailable');
  });

  it('validates revenue units: non-positive revenue removes EV/Sales instead of fabricating a value', () => {
    const result = calculateFairValue(rklbInput({ periods: preProfitPeriods({ revenue: 0 }) }), NOW);
    // With revenue gone and every other model already ineligible, no model is defensible.
    if (result.status === 'available') {
      expect(result.modelResults.every((model) => model.model !== 'ev-sales')).toBe(true);
    } else {
      expect(result.status).toBe('unavailable');
    }
  });

  it('rejects a provider/currency mismatch rather than valuing across currencies', () => {
    const result = calculateFairValue(rklbInput({ currency: 'THB' }), NOW);
    expect(result.status).toBe('unavailable');
  });
});

describe('peer multiple robustness (never fabricated)', () => {
  const peer = (symbol: string, multiple: number) => ({ symbol, multiple });

  it('selects a robust median and drops extreme outliers deterministically', () => {
    const result = relativeValuation({
      metricPerShare: 10,
      peerMultiples: [peer('A', 2), peer('B', 2.4), peer('C', 2.6), peer('D', 3), peer('E', 40)],
    });
    // The 40× outlier is filtered by the extreme-ratio guard; the median of the
    // retained peers drives the result, not the mean and not the outlier.
    expect(Number(result.assumptions.medianMultiple)).toBeLessThan(5);
    expect(Number.isFinite(result.fairValue)).toBe(true);
  });

  it('returns insufficient (throws) instead of inventing a multiple when peers are too few', () => {
    expect(() => relativeValuation({ metricPerShare: 10, peerMultiples: [peer('A', 2), peer('B', 3)] }))
      .toThrow(/at least three valid peers/i);
    expect(() => relativeValuation({ metricPerShare: 10, peerMultiples: [] }))
      .toThrow(/at least three valid peers/i);
  });
});
