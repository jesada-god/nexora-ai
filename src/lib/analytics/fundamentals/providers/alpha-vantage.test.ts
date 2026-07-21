import { describe, expect, it, vi } from 'vitest';
import { AlphaVantageFundamentalsProvider } from './alpha-vantage';

const dates = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31'];
function responseFor(fn: string) {
  const common = (date: string) => ({ fiscalDateEnding: date, reportedCurrency: 'USD' });
  if (fn === 'INCOME_STATEMENT') return { annualReports: [], quarterlyReports: dates.map((date) => ({ ...common(date), totalRevenue: '100', operatingIncome: '20', netIncome: '10', interestExpense: '1', dilutedAverageShares: '5', dilutedEPS: '2' })) };
  if (fn === 'BALANCE_SHEET') return { annualReports: [], quarterlyReports: dates.map((date) => ({ ...common(date), cashAndCashEquivalentsAtCarryingValue: '10', shortLongTermDebtTotal: '20', totalAssets: '200', totalLiabilities: '80' })) };
  return { annualReports: [], quarterlyReports: dates.map((date) => ({ ...common(date), operatingCashflow: '18', capitalExpenditures: '3', depreciationDepletionAndAmortization: '2', changeInOperatingLiabilities: '2', changeInOperatingAssets: '1', dividendPayoutCommonStock: '-1' })) };
}

describe('Alpha Vantage fundamentals provider', () => {
  it('deduplicates in-flight requests and serves subsequent snapshots from the private cache', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => { const fn = new URL(String(input)).searchParams.get('function')!; return new Response(JSON.stringify(responseFor(fn)), { status: 200 }); });
    const provider = new AlphaVantageFundamentalsProvider('secret', fetcher as typeof fetch, () => Date.parse('2025-01-01'));
    const [a, b] = await Promise.all([provider.getFinancialPeriods('XYZ'), provider.getFinancialPeriods('XYZ')]);
    expect(fetcher).toHaveBeenCalledTimes(3); expect(a.dilutedEpsTtm).toBe(8); expect(b.symbol).toBe('XYZ');
    const cached = await provider.getFinancialPeriods('XYZ'); expect(fetcher).toHaveBeenCalledTimes(3); expect(Object.values(cached.diagnostics.cache)).toEqual(['hit', 'hit', 'hit']);
  });
  it('honors Retry-After for 429 and retries only transient failures', async () => {
    const sleeps: number[] = []; let incomeAttempts = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => { const fn = new URL(String(input)).searchParams.get('function')!; if (fn === 'INCOME_STATEMENT' && incomeAttempts++ === 0) return new Response(JSON.stringify({ Note: 'rate limit' }), { status: 429, headers: { 'Retry-After': '2' } }); return new Response(JSON.stringify(responseFor(fn)), { status: 200 }); });
    const provider = new AlphaVantageFundamentalsProvider('secret', fetcher as typeof fetch, () => Date.parse('2025-01-01'), async (ms) => { sleeps.push(ms); });
    const result = await provider.getFinancialPeriods('XYZ'); expect(result.dilutedEpsTtm).toBe(8); expect(sleeps).toContain(2000);
  });
  it('returns a symbol-scoped partial snapshot when one endpoint fails', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => { const fn = new URL(String(input)).searchParams.get('function')!; return fn === 'CASH_FLOW' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(responseFor(fn)), { status: 200 }); });
    const provider = new AlphaVantageFundamentalsProvider('secret', fetcher as typeof fetch, () => Date.parse('2025-01-01'), async () => {});
    const result = await provider.getFinancialPeriods('ONLYME'); expect(result.symbol).toBe('ONLYME'); expect(result.periods).toHaveLength(0); expect(result.dilutedEpsTtm).toBe(8); expect(result.missingInputs).toContain('dataset:cash-flow');
  });
  it('records a per-dataset rate-limit code so the orchestration can report a truthful reason', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ Information: 'call frequency limit reached' }), { status: 200 }));
    const provider = new AlphaVantageFundamentalsProvider('secret', fetcher as typeof fetch, () => Date.parse('2025-01-01'), async () => {});
    const result = await provider.getFinancialPeriods('LIMITED');
    expect(result.periods).toHaveLength(0);
    expect(Object.values(result.datasetErrors)).toEqual(['rate-limited', 'rate-limited', 'rate-limited']);
  });
  it('classifies timeouts as unavailable datasets without leaking another symbol cache', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const provider = new AlphaVantageFundamentalsProvider('secret', vi.fn(async () => { throw timeout; }) as unknown as typeof fetch, () => Date.parse('2025-01-01'), async () => {});
    const result = await provider.getFinancialPeriods('TIMEOUT');
    expect(result.symbol).toBe('TIMEOUT'); expect(result.periods).toEqual([]); expect(Object.values(result.diagnostics.datasets)).toEqual(['unavailable', 'unavailable', 'unavailable']);
  });
});
