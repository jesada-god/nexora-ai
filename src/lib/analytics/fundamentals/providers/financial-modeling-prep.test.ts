import { describe, expect, it, vi } from 'vitest';
import { FinancialModelingPrepFundamentalsProvider } from './financial-modeling-prep';

const dates = ['2022-12-31', '2023-12-31', '2024-12-31'];

function rowsFor(endpoint: string, currency = 'USD') {
  const common = (date: string) => ({ date, reportedCurrency: currency, fiscalYear: date.slice(0, 4), period: 'FY', filingDate: date });
  if (endpoint === 'income-statement') {
    return dates.map((date) => ({ ...common(date), revenue: 1000, grossProfit: 400, operatingIncome: 200, ebitda: 250, netIncome: 100, epsDiluted: 2, weightedAverageShsOutDil: 50, interestExpense: 10 }));
  }
  if (endpoint === 'balance-sheet-statement') {
    return dates.map((date) => ({ ...common(date), totalAssets: 2000, totalLiabilities: 800, totalStockholdersEquity: 1200, totalDebt: 300, cashAndCashEquivalents: 150 }));
  }
  return dates.map((date) => ({ ...common(date), operatingCashFlow: 180, capitalExpenditure: -30, depreciationAndAmortization: 20, changeInWorkingCapital: -5, commonDividendsPaid: -10 }));
}

function endpointOf(input: string | URL | Request): string {
  return new URL(String(input)).pathname.split('/').pop()!;
}

describe('FMP fundamentals provider', () => {
  it('maps FMP statements into the shared normalized contract and caches datasets', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(rowsFor(endpointOf(input))), { status: 200 }));
    const provider = new FinancialModelingPrepFundamentalsProvider('secret', fetcher as typeof fetch, () => Date.parse('2025-01-01'));

    const snapshot = await provider.getFinancialPeriods('xyz');
    expect(snapshot.symbol).toBe('XYZ');
    expect(snapshot.currency).toBe('USD');
    expect(snapshot.periods).toHaveLength(3);
    expect(snapshot.providerUsed).toBe('financial-modeling-prep');
    // Period-average diluted shares come straight from FMP (no balance-sheet fallback).
    expect(snapshot.periods.at(-1)?.dilutedShares).toBe(50);
    expect(snapshot.periods.at(-1)?.freeCashFlow).toBe(150); // 180 - abs(-30)

    // 3 datasets x 2 frequencies = 6 network calls, then served from cache.
    expect(fetcher).toHaveBeenCalledTimes(6);
    const cached = await provider.getFinancialPeriods('xyz');
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(Object.values(cached.diagnostics.cache)).toEqual(['hit', 'hit', 'hit']);
    // Key must never appear in the request URL (header-only auth).
    expect(String(fetcher.mock.calls[0][0])).not.toContain('secret');
  });

  it('never leaks the api key into the request URL', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(rowsFor(endpointOf(input))), { status: 200 }));
    const provider = new FinancialModelingPrepFundamentalsProvider('top-secret-key', fetcher as typeof fetch, () => Date.parse('2025-01-01'));
    await provider.getFinancialPeriods('AAPL');
    for (const call of fetcher.mock.calls) {
      expect(String(call[0])).not.toContain('top-secret-key');
      const init = call[1];
      expect((init?.headers as Record<string, string>).apikey).toBe('top-secret-key');
    }
  });

  it('honors Retry-After on 429 and records rate-limited dataset errors when exhausted', async () => {
    const sleeps: number[] = [];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ 'Error Message': 'Limit Reach' }), { status: 429, headers: { 'Retry-After': '2' } }));
    const provider = new FinancialModelingPrepFundamentalsProvider('secret', fetcher as typeof fetch, () => Date.parse('2025-01-01'), async (ms) => { sleeps.push(ms); });
    const snapshot = await provider.getFinancialPeriods('LIMIT');
    expect(snapshot.periods).toHaveLength(0);
    expect(Object.values(snapshot.datasetErrors)).toEqual(['rate-limited', 'rate-limited', 'rate-limited']);
    expect(sleeps).toContain(2000);
  });

  it('treats an FMP error object payload as an eligible dataset failure', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ 'Error Message': 'Free plan does not include this endpoint' }), { status: 200 }));
    const provider = new FinancialModelingPrepFundamentalsProvider('secret', fetcher as typeof fetch, () => Date.parse('2025-01-01'), async () => {});
    const snapshot = await provider.getFinancialPeriods('BLOCKED');
    expect(snapshot.periods).toHaveLength(0);
    expect(Object.keys(snapshot.datasetErrors)).toHaveLength(3);
  });

  it('excludes periods whose magnitudes indicate a provider unit anomaly', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const endpoint = endpointOf(input);
      const rows = rowsFor(endpoint).map((row, index) => index === 2 && endpoint === 'income-statement' ? { ...row, revenue: 5e16 } : row);
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    const provider = new FinancialModelingPrepFundamentalsProvider('secret', fetcher as typeof fetch, () => Date.parse('2025-01-01'), async () => {});
    const snapshot = await provider.getFinancialPeriods('SCALE');
    // The impossible-magnitude 2024 period is dropped; the two sane periods remain.
    expect(snapshot.periods.map((period) => period.periodEnd)).toEqual(['2022-12-31', '2023-12-31']);
  });
});
