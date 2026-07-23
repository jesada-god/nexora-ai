import { describe, expect, it } from 'vitest';
import { selectSectorModels } from './sector-selection';
import { selectSectorValuationRule } from './sector-rules';
import type { FinancialPeriod, ValuationInput } from './types';

const history = Array.from({ length: 60 }, (_, index) => ({ date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10), open: 10, high: 11, low: 9, close: 10, volume: 1000 }));
function periods(overrides: Partial<FinancialPeriod> = {}): FinancialPeriod[] {
  return [2023, 2024, 2025].map((year, index) => ({
    periodEnd: `${year}-12-31`, currency: 'USD', revenue: 800 + index * 100, grossProfit: 300, operatingIncome: 80, ebitda: 100, netIncome: 50, dilutedEps: 0.5,
    depreciationAmortization: 20, capitalExpenditure: -40, changeInWorkingCapital: 5, operatingCashFlow: 100, freeCashFlow: 60, dividendsPaid: null,
    interestExpense: 10, totalDebt: 200, cash: 100, totalAssets: 1200, totalLiabilities: 700, totalEquity: 500, dilutedShares: 100,
    ...overrides,
  }));
}
function input(overrides: Partial<ValuationInput> = {}): ValuationInput {
  return { symbol: 'TEST', currency: 'USD', marketPrice: 10, marketCapitalization: 1000, priceAsOf: '2026-01-02T00:00:00.000Z', source: 'alpha-vantage', sourceType: 'provider-supplied', sector: 'Industrials', industry: 'Aerospace & Defense', periods: periods(), historicalPrices: history, historySource: 'alpha-vantage', historyFreshness: { status: 'end-of-day', asOf: '2026-01-02T00:00:00.000Z', maxAgeSeconds: 86400 }, ...overrides };
}

describe('sector-aware valuation selection', () => {
  it('applies the high-growth industry override only when fundamentals support a growth stage', () => {
    // Normalizes "Aerospace & Defense" and applies the growth override when the
    // company's fundamentals support a growth/pre-profit stage (e.g. RKLB).
    expect(selectSectorValuationRule('Industrials', 'Aerospace & Defense', true).ruleId).toBe('high-growth-industry-v1');
    // A mature prime in the SAME industry (fundamentals do not support growth) falls
    // through to the sector rule instead of the growth multiple — one keyword no
    // longer forces every Aerospace & Defense name into the high-growth rule.
    expect(selectSectorValuationRule('Industrials', 'Aerospace & Defense', false).ruleId).toBe('industrials-v1');
  });

  it('does not use P/E, PEG, EV/EBITDA, or DCF for a loss-making RKLB-style fixture', () => {
    const result = selectSectorModels(input({ symbol: 'RKLB', periods: periods({ netIncome: -20, dilutedEps: -0.2, ebitda: -10, operatingIncome: -20, operatingCashFlow: -5, freeCashFlow: -45 }) }));
    expect(result.models.map((model) => model.model)).toEqual(['ev-sales']);
    expect(result.excludedModels.map((model) => model.model)).toEqual(expect.arrayContaining(['pe', 'peg', 'ev-ebitda', 'fcff-dcf']));
  });

  it('uses PEG only with positive EPS and a real forward-growth estimate', () => {
    const withoutEstimate = selectSectorModels(input({ sector: 'Technology', industry: 'Software Infrastructure' }));
    expect(withoutEstimate.models.some((model) => model.model === 'peg')).toBe(false);
    const withEstimate = selectSectorModels(input({ sector: 'Technology', industry: 'Software Infrastructure', forwardEpsGrowth: { value: 0.2, unit: 'decimal', provider: 'verified-provider', asOf: '2026-01-02', period: 'FY2027' } }));
    expect(withEstimate.models.some((model) => model.model === 'peg')).toBe(true);
  });

  it('never applies general-company EV models or FCFF to Financials', () => {
    const result = selectSectorModels(input({ sector: 'Financial Services', industry: 'Banks—Regional' }));
    expect(result.rule.ruleId).toBe('financials-v1');
    expect(result.models.some((model) => ['ev-sales', 'ev-ebitda', 'fcff-dcf'].includes(model.model))).toBe(false);
    expect(result.models.some((model) => model.model === 'pb')).toBe(true);
  });

  it('removes every invalid model before normalized weighting', () => {
    const result = selectSectorModels(input({ periods: periods({ ebitda: 0, operatingIncome: -20, freeCashFlow: -10, operatingCashFlow: 30 }) }));
    expect(result.models.some((model) => model.model === 'ev-ebitda')).toBe(false);
    expect(result.excludedModels.find((model) => model.model === 'ev-ebitda')?.reason).toMatch(/greater than zero/i);
  });
});
