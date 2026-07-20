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
      missingInputs: expect.arrayContaining(['incomeStatement', 'balanceSheet', 'cashFlowStatement']),
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
      failureKind: 'calculation-failure',
      reason: expect.stringContaining('ล้มเหลว'),
      missingInputs: ['valuationCalculation'],
      methodologyVersion: 'nexora-fv-v1',
    });
    expect(logger).toHaveBeenCalledWith({
      event: 'fair_value_evaluation',
      status: 'unavailable',
      symbol: 'AAPL',
      provider: 'alpha-vantage',
      failureKind: 'calculation-failure',
      missingInputCount: 1,
      errorCode: 'internal-error',
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('must-not-appear');
  });
});
