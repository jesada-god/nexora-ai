import { describe, expect, it, vi } from 'vitest';
import { NasdaqHistoricalProvider, normalizeNasdaqHistory } from './provider';

const payload = {
  data: { tradesTable: { rows: [
    { date: '07/18/2026', close: '$12.00', volume: '1,200', open: '$11.00', high: '$13.00', low: '$10.00' },
    { date: '07/17/2026', close: '$11.00', volume: '1,000', open: '$10.00', high: '$12.00', low: '$9.00' },
  ] } },
  status: { rCode: 200 },
};

describe('Nasdaq historical fallback', () => {
  it('normalizes real daily OHLCV fields and sorts ascending', () => {
    const data = normalizeNasdaqHistory(payload, 'NVDA', '1y');
    expect(data.prices).toEqual([
      { date: '2026-07-17', close: 11, volume: 1000, open: 10, high: 12, low: 9 },
      { date: '2026-07-18', close: 12, volume: 1200, open: 11, high: 13, low: 10 },
    ]);
  });

  it('uses ISO dates required by the Nasdaq API and returns normalized data', async () => {
    const fetchImpl = vi.fn(async (url: URL) => {
      expect(url.pathname).toContain('/NVDA/historical');
      expect(url.searchParams.get('fromdate')).toBe('2025-07-19');
      expect(url.searchParams.get('todate')).toBe('2026-07-19');
      return Response.json(payload, { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }) as unknown as typeof fetch;
    const provider = new NasdaqHistoricalProvider(fetchImpl, () => new Date('2026-07-19T00:00:00.000Z'));
    await expect(provider.getHistoricalPrices('NVDA', '1y')).resolves.toMatchObject({ provider: 'nasdaq' });
  });

  it('preserves valid price rows with unavailable volume without fabricating a value', () => {
    const withInvalid = structuredClone(payload);
    withInvalid.data.tradesTable.rows.push({ date: '07/16/2026', close: '$11.00', volume: '', open: '$10.00', high: '$12.00', low: '$9.00' });
    const result = normalizeNasdaqHistory(withInvalid, 'NVDA', '1y');
    expect(result.prices).toHaveLength(3);
    expect(result.prices[0]).toMatchObject({ date: '2026-07-16', close: 11, volume: null });
  });
});
