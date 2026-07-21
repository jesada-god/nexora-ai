import { describe, expect, it, vi } from 'vitest';
import { MarketDataError } from '../../market-data/errors';
import { FundamentalsService, type FundamentalsServiceLog } from './service';
import type { FundamentalsProvider, FundamentalsSnapshot } from './provider';

vi.mock('server-only', () => ({}));

const period = {
  periodEnd: '2024-12-31', currency: 'USD', revenue: 1000, operatingIncome: 200, netIncome: 100,
  depreciationAmortization: 20, capitalExpenditure: -30, changeInWorkingCapital: 5, operatingCashFlow: 180,
  freeCashFlow: 150, dividendsPaid: null, interestExpense: 10, totalDebt: 300, cash: 150, totalAssets: 2000,
  totalLiabilities: 800, dilutedShares: 50,
};

function snap(overrides: Partial<FundamentalsSnapshot> = {}): FundamentalsSnapshot {
  return {
    symbol: 'XYZ', periods: [period], quarterlyPeriods: [], annualRecords: [], quarterlyRecords: [],
    asOf: '2024-12-31', fetchedAt: '2025-01-01T00:00:00.000Z', currency: 'USD', dilutedEpsTtm: null,
    dilutedEpsAsOf: null, missingInputs: [], datasetErrors: {},
    diagnostics: { provider: 'x', capabilities: [], datasets: {}, cache: { 'income-statement': 'miss' }, datasetFetchedAt: {}, latencyMs: 1, normalizedPeriodCount: { annual: 1, quarterly: 0 } },
    ...overrides,
  };
}

function provider(id: string, impl: FundamentalsProvider['getFinancialPeriods']): FundamentalsProvider {
  return { id, getFinancialPeriods: vi.fn(impl) };
}

const rateLimited = snap({ periods: [], datasetErrors: { 'income-statement': 'rate-limited', 'balance-sheet': 'rate-limited', 'cash-flow': 'rate-limited' } });

describe('FundamentalsService fallback', () => {
  it('returns the primary snapshot untouched when it is usable and never calls the secondary', async () => {
    const secondary = provider('financial-modeling-prep', async () => snap());
    const service = new FundamentalsService(provider('alpha-vantage', async () => snap()), secondary, () => 0, () => {});
    const result = await service.getFinancialPeriods('xyz');
    expect(result.providerUsed).toBe('alpha-vantage');
    expect(result.fallbackUsed).toBe(false);
    expect(secondary.getFinancialPeriods).not.toHaveBeenCalled();
  });

  it('falls back to the secondary for a rate-limited primary and records truthful provenance', async () => {
    const logs: FundamentalsServiceLog[] = [];
    const service = new FundamentalsService(
      provider('alpha-vantage', async () => rateLimited),
      provider('financial-modeling-prep', async () => snap({ symbol: 'XYZ' })),
      () => 0,
      (entry) => logs.push(entry),
    );
    const result = await service.getFinancialPeriods('XYZ');
    expect(result.providerUsed).toBe('financial-modeling-prep');
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toBe('PRIMARY_RATE_LIMITED');
    expect(logs.map((entry) => entry.event)).toContain('fundamentals-fallback-succeeded');
  });

  it('does NOT fall back when the primary is genuinely empty (no dataset errors)', async () => {
    const secondary = provider('financial-modeling-prep', async () => snap());
    const service = new FundamentalsService(provider('alpha-vantage', async () => snap({ periods: [], datasetErrors: {} })), secondary, () => 0, () => {});
    const result = await service.getFinancialPeriods('XYZ');
    expect(result.providerUsed).toBe('alpha-vantage');
    expect(result.fallbackUsed).toBe(false);
    expect(secondary.getFinancialPeriods).not.toHaveBeenCalled();
  });

  it('does NOT fall back for an operator-action primary failure (unauthorized)', async () => {
    const secondary = provider('financial-modeling-prep', async () => snap());
    const service = new FundamentalsService(
      provider('alpha-vantage', async () => snap({ periods: [], datasetErrors: { 'income-statement': 'provider-unauthorized' } })),
      secondary, () => 0, () => {},
    );
    const result = await service.getFinancialPeriods('XYZ');
    expect(result.providerUsed).toBe('alpha-vantage');
    expect(secondary.getFinancialPeriods).not.toHaveBeenCalled();
  });

  it('preserves the truthful rate-limited primary snapshot when the secondary also fails', async () => {
    const service = new FundamentalsService(
      provider('alpha-vantage', async () => rateLimited),
      provider('financial-modeling-prep', async () => { throw new MarketDataError('rate-limited', 'FMP throttled', 30); }),
      () => 0, () => {},
    );
    const result = await service.getFinancialPeriods('XYZ');
    expect(result.providerUsed).toBe('alpha-vantage');
    expect(result.periods).toHaveLength(0);
    expect(result.datasetErrors['income-statement']).toBe('rate-limited');
    expect(result.fallbackReason).toContain('SECONDARY_RATE_LIMITED');
  });

  it('rejects a secondary snapshot whose symbol does not match the request', async () => {
    const logs: FundamentalsServiceLog[] = [];
    const service = new FundamentalsService(
      provider('alpha-vantage', async () => rateLimited),
      provider('financial-modeling-prep', async () => snap({ symbol: 'OTHER' })),
      () => 0, (entry) => logs.push(entry),
    );
    const result = await service.getFinancialPeriods('XYZ');
    expect(result.providerUsed).toBe('alpha-vantage');
    expect(logs.map((entry) => entry.event)).toContain('provider-identity-mismatch');
  });

  it('respects a secondary Retry-After cooldown and skips it on the next call', async () => {
    let clock = 1_000_000;
    const secondary = provider('financial-modeling-prep', async () => { throw new MarketDataError('rate-limited', 'FMP throttled', 60); });
    const service = new FundamentalsService(provider('alpha-vantage', async () => rateLimited), secondary, () => clock, () => {});
    await service.getFinancialPeriods('XYZ');
    expect(secondary.getFinancialPeriods).toHaveBeenCalledTimes(1);
    clock += 10_000; // still inside the 60s cooldown
    await service.getFinancialPeriods('XYZ');
    expect(secondary.getFinancialPeriods).toHaveBeenCalledTimes(1);
  });

  it('surfaces SECONDARY_NOT_CONFIGURED when no secondary exists but keeps the primary snapshot', async () => {
    const service = new FundamentalsService(provider('alpha-vantage', async () => rateLimited), null, () => 0, () => {});
    const result = await service.getFinancialPeriods('XYZ');
    expect(result.providerUsed).toBe('alpha-vantage');
    expect(result.fallbackReason).toContain('SECONDARY_NOT_CONFIGURED');
  });

  it('does not mix providers: a fallback result carries only the secondary provider periods', async () => {
    const service = new FundamentalsService(
      provider('alpha-vantage', async () => rateLimited),
      provider('financial-modeling-prep', async () => snap({ symbol: 'XYZ', currency: 'USD', periods: [{ ...period, revenue: 999 }] })),
      () => 0, () => {},
    );
    const result = await service.getFinancialPeriods('XYZ');
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0].revenue).toBe(999);
    expect(result.providerUsed).toBe('financial-modeling-prep');
  });
});
