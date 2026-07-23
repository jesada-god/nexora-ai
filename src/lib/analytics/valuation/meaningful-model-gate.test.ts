import { describe, expect, it } from 'vitest';
import { calculateFairValue, meaningfulModelGate, verifiablePeerCount } from './engine';
import type { FinancialPeriod, ModelResult, ValuationInput } from './types';

const NOW = Date.parse('2025-01-03T00:00:00.000Z');
const history = Array.from({ length: 60 }, (_, index) => ({
  date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  open: 20, high: 22, low: 19, close: 21, volume: 5_000_000,
}));

function period(overrides: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    periodEnd: '2024-12-31', currency: 'USD',
    revenue: 430, grossProfit: 80, operatingIncome: -110, ebitda: -85, netIncome: -120,
    dilutedEps: -0.24, depreciationAmortization: 15, capitalExpenditure: -30,
    changeInWorkingCapital: 5, operatingCashFlow: -60, freeCashFlow: -90, dividendsPaid: null,
    interestExpense: 12, totalDebt: 465, cash: 420, totalAssets: 1_100, totalLiabilities: 720,
    totalEquity: 380, dilutedShares: 490, ...overrides,
  };
}

function preProfitPeriods(overrides: Partial<FinancialPeriod> = {}): FinancialPeriod[] {
  return [2022, 2023, 2024].map((year, index) => period({
    periodEnd: `${year}-12-31`, revenue: 210 + index * 110, ...overrides,
  }));
}

function input(overrides: Partial<ValuationInput> = {}): ValuationInput {
  return {
    symbol: 'RKLB', currency: 'USD', marketPrice: 21, marketCapitalization: 490 * 21,
    priceAsOf: '2025-01-02T00:00:00.000Z', source: 'alpha-vantage', sourceType: 'provider-supplied',
    sector: 'Industrials', industry: 'Aerospace & Defense',
    periods: preProfitPeriods(), historicalPrices: history, historySource: 'alpha-vantage',
    historyFreshness: { status: 'end-of-day', asOf: '2025-01-02T00:00:00.000Z', maxAgeSeconds: 86_400 },
    calculatedAt: '2025-01-03T00:00:00.000Z', ...overrides,
  };
}

const evSales: ModelResult = {
  model: 'ev-sales', fairValue: 3.92, methodology: 'x', inputs: {}, assumptions: {}, limitations: [],
};

describe('verifiablePeerCount', () => {
  it('counts only finite, positive peer multiples and never fabricates', () => {
    expect(verifiablePeerCount({})).toBe(0);
    expect(verifiablePeerCount({ peerMultiples: [] })).toBe(0);
    expect(verifiablePeerCount({ peerMultiples: [{ symbol: 'A', multiple: 5 }, { symbol: 'B', multiple: 0 }, { symbol: 'C', multiple: -1 }, { symbol: 'D', multiple: Number.NaN }] })).toBe(1);
  });
});

describe('meaningfulModelGate', () => {
  it('blocks a sole assumption-multiple EV/Sales for a pre-profit company with no peers/forward revenue', () => {
    const gate = meaningfulModelGate({ periods: preProfitPeriods(), peerMultiples: null, forwardRevenue: null }, [evSales]);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.missingFields).toEqual(['verifiablePeerSet>=5', 'forwardRevenueWithPeriod']);
  });

  it('allows it once a verifiable peer set (>=5) exists', () => {
    const peers = Array.from({ length: 5 }, (_, i) => ({ symbol: `P${i}`, multiple: 8 }));
    expect(meaningfulModelGate({ periods: preProfitPeriods(), peerMultiples: peers, forwardRevenue: null }, [evSales]).ok).toBe(true);
  });

  it('allows it once a provider forward revenue exists', () => {
    expect(meaningfulModelGate({ periods: preProfitPeriods(), peerMultiples: null, forwardRevenue: { value: 700, period: 'NTM', provider: 'fmp', asOf: '2025-01-02' } }, [evSales]).ok).toBe(true);
  });

  it('does not gate a profitable sole-EV/Sales company (the pre-profit trigger is absent)', () => {
    const profitable = [period({ netIncome: 40, freeCashFlow: 30, dilutedEps: 0.2 })];
    expect(meaningfulModelGate({ periods: profitable, peerMultiples: null, forwardRevenue: null }, [evSales]).ok).toBe(true);
  });

  it('does not gate a blended (multi-model) valuation even when pre-profit', () => {
    const twoModels: ModelResult[] = [evSales, { ...evSales, model: 'ev-ebitda' }];
    expect(meaningfulModelGate({ periods: preProfitPeriods(), peerMultiples: null, forwardRevenue: null }, twoModels).ok).toBe(true);
  });
});

describe('confidence is computed, never hardcoded "Moderate"', () => {
  it('caps a sole assumption-multiple (zero-peer) valuation to Low confidence', () => {
    // A company that is NOT pre-profit (so the gate does not fire) but whose ONLY
    // eligible model is an assumption-multiple EV/Sales with no peers: below-the-
    // line gains make net income & FCF positive while EBITDA/operating income are
    // negative (EV/EBITDA, DCF out) and EPS is absent (P/E, PEG out).
    const soleEvSales = [2022, 2023, 2024].map((year, index) => period({
      periodEnd: `${year}-12-31`, revenue: 210 + index * 110,
      netIncome: 25, freeCashFlow: 20, operatingCashFlow: 30,
      operatingIncome: -40, ebitda: -20, dilutedEps: null,
    }));
    const result = calculateFairValue(input({ sector: 'Technology', industry: 'Software—Infrastructure', periods: soleEvSales }), NOW);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.modelResults.map((m) => m.model)).toEqual(['ev-sales']);
    expect(result.modelReliability.level).toBe('Low');
    expect(result.modelReliability.explanation).toMatch(/peer set|Low/i);
  });

  it('a peer-backed valuation is not force-capped (confidence reflects real inputs)', () => {
    const soleEvSales = [2022, 2023, 2024].map((year, index) => period({
      periodEnd: `${year}-12-31`, revenue: 210 + index * 110,
      netIncome: 25, freeCashFlow: 20, operatingCashFlow: 30,
      operatingIncome: -40, ebitda: -20, dilutedEps: null,
    }));
    const peers = Array.from({ length: 6 }, (_, i) => ({ symbol: `P${i}`, multiple: 8 }));
    const result = calculateFairValue(input({ sector: 'Technology', industry: 'Software—Infrastructure', periods: soleEvSales, peerMultiples: peers }), NOW);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    // The forced-Low cap note is absent; the level is whatever the model computes.
    expect(result.modelReliability.explanation).not.toMatch(/ระดับถูกจำกัดที่ Low/);
  });
});

describe('gate integration with calculateFairValue (RKLB shape)', () => {
  it('negative FCF never forces DCF, and a sole EV/Sales pre-profit name is unavailable with reasons', () => {
    const result = calculateFairValue(input(), NOW);
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.missingFields).toContain('verifiablePeerSet>=5');
    expect(Number.isNaN(Date.parse(result.asOf))).toBe(false);
  });

  it('missing/zero shares yields unavailable, never a divide-by-zero, even with peers', () => {
    const peers = Array.from({ length: 5 }, (_, i) => ({ symbol: `P${i}`, multiple: 8 }));
    const result = calculateFairValue(input({ periods: preProfitPeriods({ dilutedShares: 0 }), peerMultiples: peers }), NOW);
    expect(result.status).toBe('unavailable');
  });
});
