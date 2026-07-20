import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValuationInput } from './types';

const mocks = vi.hoisted(() => ({
  getFundamentalsProvider: vi.fn(),
  getMarketDataProvider: vi.fn(),
  getHistoricalMarketDataService: vi.fn(),
  getFxRate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/src/lib/market-data', () => ({
  getFundamentalsProvider: mocks.getFundamentalsProvider,
  getHistoricalMarketDataService: mocks.getHistoricalMarketDataService,
  getMarketDataProvider: mocks.getMarketDataProvider,
}));
vi.mock('@/src/lib/market-data/fx/service', () => ({
  getFxRate: mocks.getFxRate,
}));
vi.mock('../fundamentals/provider', () => ({
  getFundamentalsProvider: mocks.getFundamentalsProvider,
}));

import { calculateFairValueSafely, loadFairValue } from './orchestration';

const periods = [2023, 2024, 2025].map((year, index) => ({
  periodEnd: `${year}-12-31`,
  currency: 'USD',
  revenue: 800 + index * 100,
  operatingIncome: -20,
  netIncome: -30,
  depreciationAmortization: 10,
  capitalExpenditure: -40,
  changeInWorkingCapital: 5,
  operatingCashFlow: -5,
  freeCashFlow: -45,
  dividendsPaid: null,
  interestExpense: 10,
  totalDebt: 200,
  cash: 100,
  totalAssets: 1200,
  totalLiabilities: 700,
  dilutedShares: 100,
  ebitda: -10,
  dilutedEps: -0.3,
  totalEquity: 500,
}));
const history = Array.from({ length: 60 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  open: 10,
  high: 11,
  low: 9,
  close: 10,
  volume: 1_000,
}));

function arrangeRequiredProviderData() {
  mocks.getFundamentalsProvider.mockReturnValue({
    id: 'alpha-vantage',
    getFinancialPeriods: vi.fn().mockResolvedValue({
      symbol: 'RKLB',
      periods,
      quarterlyPeriods: [],
      annualRecords: [],
      quarterlyRecords: [],
      asOf: '2025-12-31',
      fetchedAt: '2026-07-20T00:00:00.000Z',
      currency: 'USD',
      dilutedEpsTtm: null,
      dilutedEpsAsOf: null,
      missingInputs: [],
      diagnostics: {
        provider: 'alpha-vantage',
        capabilities: [],
        datasets: {},
        cache: { income: 'miss', balance: 'miss', cashFlow: 'miss' },
        datasetFetchedAt: {},
        latencyMs: 1,
        normalizedPeriodCount: { annual: 3, quarterly: 0 },
      },
    }),
  });
  mocks.getMarketDataProvider.mockReturnValue({
    id: 'alpha-vantage',
    getQuote: vi.fn().mockResolvedValue({
      data: { symbol: 'RKLB', price: 10, volume: 1_000 },
      freshness: { status: 'end-of-day', asOf: '2026-07-17T00:00:00.000Z', maxAgeSeconds: 86_400 },
      provider: 'alpha-vantage',
    }),
    getCompanyProfile: vi.fn().mockResolvedValue({
      data: {
        symbol: 'RKLB',
        name: 'Rocket Lab USA, Inc.',
        currency: 'USD',
        sector: 'Industrials',
        industry: 'Aerospace & Defense',
        marketCapitalization: 1_000,
      },
      freshness: { status: 'cached', asOf: '2025-12-31T00:00:00.000Z', maxAgeSeconds: 86_400 },
      provider: 'alpha-vantage',
    }),
  });
  mocks.getHistoricalMarketDataService.mockReturnValue({
    getHistoricalPrices: vi.fn().mockResolvedValue({
      data: { symbol: 'RKLB', range: '1y', prices: history },
      freshness: { status: 'end-of-day', asOf: '2026-03-01T00:00:00.000Z', maxAgeSeconds: 86_400 },
      provider: 'nasdaq',
    }),
  });
}

describe('Fair Value orchestration failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('distinguishes a missing financial-statements provider from insufficient inputs', async () => {
    mocks.getFundamentalsProvider.mockReturnValue(null);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await loadFairValue('AAPL');
    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));

    expect(result).toMatchObject({
      status: 'unavailable',
      failureKind: 'provider-unavailable',
      provider: null,
      missingFields: expect.arrayContaining(['incomeStatement', 'balanceSheet', 'cashFlowStatement']),
      missingInputs: expect.arrayContaining(['incomeStatement', 'balanceSheet', 'cashFlowStatement']),
      asOf: expect.any(String),
      methodologyVersion: 'nexora-fv-v1',
    });
    expect(mocks.getMarketDataProvider).not.toHaveBeenCalled();
    expect(entry).toMatchObject({
      event: 'fair_value_evaluation',
      status: 'unavailable',
      failureKind: 'provider-unavailable',
    });
  });

  it('converts a calculation exception to a safe typed failure without logging secrets', () => {
    const logger = vi.fn();
    const input = {
      symbol: 'AAPL',
      currency: 'USD',
      source: 'alpha-vantage',
      calculatedAt: '2026-07-20T00:00:00.000Z',
    } as ValuationInput;
    const calculate = vi.fn(() => {
      throw Object.assign(new Error('apikey=must-not-appear'), {
        code: 'internal-error',
        apiKey: 'must-not-appear',
      });
    });

    const result = calculateFairValueSafely(input, calculate, logger);

    expect(result).toMatchObject({
      status: 'unavailable',
      failureKind: 'calculation-error',
      reason: expect.stringContaining('ล้มเหลว'),
      provider: 'alpha-vantage',
      missingFields: ['valuationCalculation'],
      missingInputs: ['valuationCalculation'],
      asOf: expect.any(String),
      methodologyVersion: 'nexora-fv-v1',
    });
    expect(logger).toHaveBeenCalledWith({
      event: 'fair_value_evaluation',
      status: 'unavailable',
      symbol: 'AAPL',
      provider: 'alpha-vantage',
      failureKind: 'calculation-error',
      missingInputCount: 1,
      errorCode: 'internal-error',
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('must-not-appear');
  });

  it('keeps USD valuation available when display-only FX fails', async () => {
    arrangeRequiredProviderData();
    mocks.getFxRate.mockRejectedValue(new Error('FX offline'));

    const result = await loadFairValue('RKLB');

    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.modelResults.map((model) => model.model)).toEqual(['ev-sales']);
      expect(result.displayFx).toBeNull();
    }
  });
});
