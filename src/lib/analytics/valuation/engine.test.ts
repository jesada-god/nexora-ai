import { describe, expect, it } from 'vitest';
import { calculateFairValue, dataSufficiency } from './engine';
import { classifyCompany } from './classification';
import { modelReliability } from './quality';
import type { FinancialPeriod, ValuationInput } from './types';
const periods: FinancialPeriod[] = [2023, 2024, 2025].map((year, index) => ({ periodEnd: `${year}-12-31`, currency: 'USD', revenue: 800 + index * 100, operatingIncome: 160 + index * 20, netIncome: 100 + index * 10, depreciationAmortization: 30, capitalExpenditure: 40, changeInWorkingCapital: 10, operatingCashFlow: 160, freeCashFlow: 120, dividendsPaid: -20, interestExpense: 10, totalDebt: 200, cash: 100, totalAssets: 1500, totalLiabilities: 700, dilutedShares: 100 }));
const historicalPrices = Array.from({ length: 60 }, (_, index) => ({ date: new Date(Date.UTC(2025, 9, index + 1)).toISOString().slice(0, 10), open: 10 + index * .1, high: 11 + index * .1, low: 9 + index * .1, close: 10.5 + index * .1, volume: 1000 + index * 10 }));
const input: ValuationInput = { symbol: 'TEST', currency: 'USD', marketPrice: 20, priceAsOf: '2026-01-02T00:00:00.000Z', source: 'verified-fixture', sourceType: 'provider-supplied', sector: 'Technology', industry: 'Software', periods, historicalPrices, historySource: 'verified-history', historyFreshness: { status: 'end-of-day', asOf: '2025-11-29T00:00:00.000Z', maxAgeSeconds: 86400 }, assumptions: { forecastHorizon: 5, revenueGrowth: .05, operatingMargin: .2, taxRate: .2, depreciationPercentRevenue: .03, capexPercentRevenue: .04, workingCapitalPercentRevenue: .01, wacc: .1, terminalGrowth: .03, dilutionRate: 0 }, calculatedAt: '2026-01-03T00:00:00.000Z' };
describe('Nexora Composite Fair Value engine', () => {
  it('enforces sufficiency, duplicate periods, currency normalization and stale inputs', () => { expect(dataSufficiency(input, Date.parse('2026-01-03')).ok).toBe(true); expect(dataSufficiency({ ...input, periods: periods.slice(0, 2) }, Date.parse('2026-01-03')).missingInputs).toContain('historicalFinancials>=3Periods'); expect(dataSufficiency({ ...input, periods: [periods[0], periods[0], periods[2]] }, Date.parse('2026-01-03')).missingInputs).toContain('duplicateFiscalPeriodsMustBeResolved'); expect(dataSufficiency({ ...input, priceAsOf: '2020-01-01T00:00:00.000Z' }, Date.parse('2026-01-03')).staleInputs).toContain('marketPrice'); });
  it('classifies from evidence and exposes model eligibility/exclusions', () => { const result = classifyCompany('Technology', 'Software', periods); expect(result.classification).toContain('profitable-growth'); expect(result.eligibleModels).toContain('fcff-dcf'); expect(result.excludedModels.some((item) => item.model === 'relative')).toBe(true); });
  it('is versioned/reproducible and technical context cannot alter intrinsic value', () => { const a = calculateFairValue(input, Date.parse('2026-01-03')); const b = calculateFairValue({ ...input, historicalPrices: historicalPrices.map((row) => ({ ...row, close: row.close * 2, open: row.open * 2, high: row.high * 2, low: row.low * 2 })) }, Date.parse('2026-01-03')); expect(a.status).toBe('available'); expect(b.status).toBe('available'); if (a.status === 'available' && b.status === 'available') { expect(a.methodologyVersion).toBe('nexora-fv-v1'); expect(a.technicalContext.status).toBe('available'); expect(a.fundamentalFairValue).toEqual(b.fundamentalFairValue); expect(Number.isFinite(a.fundamentalFairValue.centralEstimate)).toBe(true); } });
  it('returns typed unavailable rather than defaults when inputs are insufficient', () => { const result = calculateFairValue({ ...input, periods: [] }, Date.parse('2026-01-03')); expect(result).toMatchObject({ status: 'unavailable', failureKind: 'insufficient-data', methodologyVersion: 'nexora-fv-v1' }); if (result.status === 'unavailable') expect(result.missingInputs.length).toBeGreaterThan(0); });
  it('calculates Nexora Model Reliability as model/data quality, not return probability', () => { const result = modelReliability({ completeness: 90, freshness: 90, periodConsistency: 90, modelCount: 3, dispersion: .1, cashFlowStability: 80, peerSampleSize: 8, currencyConsistency: 100, sensitivity: .2 }); expect(result.level).not.toBe('Unavailable'); expect(result.explanation).toContain('not the probability'); });
  it('calculates ordered scenarios, normalized weights, and upside from the USD base value', () => {
    const enriched = periods.map((period) => ({ ...period, ebitda: period.operatingIncome + period.depreciationAmortization, dilutedEps: period.netIncome / period.dilutedShares, totalEquity: period.totalAssets - period.totalLiabilities }));
    const result = calculateFairValue({ ...input, marketCapitalization: 2000, periods: enriched }, Date.parse('2026-01-03'));
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.modelResults.reduce((sum, model) => sum + model.weight, 0)).toBeCloseTo(1);
      expect(result.fundamentalFairValue.conservative.high).toBeLessThanOrEqual(result.fundamentalFairValue.base.high);
      expect(result.fundamentalFairValue.base.low).toBeLessThanOrEqual(result.fundamentalFairValue.optimistic.low);
      expect(result.upsideAmount).toBeCloseTo(result.fundamentalFairValue.centralEstimate - input.marketPrice);
      expect(result.upsidePercent).toBeCloseTo((result.upsideAmount / input.marketPrice) * 100);
      expect(result.currency).toBe('USD');
    }
  });
  it('publishes real stale data as stale and rejects non-positive shares', () => {
    const stale = calculateFairValue({ ...input, priceAsOf: '2020-01-01T00:00:00.000Z' }, Date.parse('2026-01-03'));
    expect(stale.status).toBe('available');
    if (stale.status === 'available') expect(stale.dataStatus).toBe('stale');
    const invalidShares = calculateFairValue({ ...input, periods: periods.map((period) => ({ ...period, dilutedShares: 0 })) }, Date.parse('2026-01-03'));
    expect(invalidShares.status).toBe('unavailable');
  });
});
