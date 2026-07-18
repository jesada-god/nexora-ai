import { describe, expect, it, vi } from 'vitest';
import { normalizeStooqHistory, StooqHistoricalProvider, StooqProviderError, toStooqUsSymbol } from './provider';

const header = 'Date,Open,High,Low,Close,Volume';
const row = (date: string, values = '10,12,9,11,100') => `${date},${values}`;

describe('Stooq US symbol mapping', () => {
  it.each([
    ['NVDA', 'nvda.us'], ['AAPL', 'aapl.us'], ['MSFT', 'msft.us'], ['RKLB', 'rklb.us'], ['NVDA.US', 'nvda.us'],
  ])('maps %s to %s without appending .us twice', (input, expected) => {
    expect(toStooqUsSymbol(input)).toBe(expected);
  });

  it('rejects unsafe or unsupported symbols', () => {
    expect(() => toStooqUsSymbol('../NVDA')).toThrowError(StooqProviderError);
    expect(() => toStooqUsSymbol('^GSPC')).toThrowError(StooqProviderError);
  });
});

describe('Stooq historical normalization', () => {
  it.each(['\n', '\r\n'])('parses valid CSV with %j line endings and whitespace headers', (lineEnding) => {
    const csv = [` Date , Open , High , Low , Close , Volume `, row('2026-07-17'), row('2026-07-18', '11,13,10,12,200')].join(lineEnding);
    const value = normalizeStooqHistory(csv, 'NVDA', 'max', new Date('2026-07-19T00:00:00.000Z'));
    expect(value.prices).toHaveLength(2);
    expect(value.prices[0]).toEqual({ date: '2026-07-17', open: 10, high: 12, low: 9, close: 11, volume: 100 });
  });

  it('skips isolated invalid rows but retains a sufficient valid dataset', () => {
    const csv = [header, row('2026-07-17'), row('bad-date'), row('2026-07-18', '10,9,8,11,100'), row('2026-07-19', '11,13,10,12,200')].join('\n');
    const value = normalizeStooqHistory(csv, 'NVDA', 'max', new Date('2026-07-20T00:00:00.000Z'));
    expect(value.prices.map((price) => price.date)).toEqual(['2026-07-17', '2026-07-19']);
    expect(value.prices.every((price) => Object.values(price).every((field) => typeof field === 'string' || Number.isFinite(field)))).toBe(true);
  });

  it('deduplicates dates and sorts reverse input ascending', () => {
    const csv = [header, row('2026-07-19', '11,13,10,12,200'), row('2026-07-18'), row('2026-07-18')].join('\n');
    const value = normalizeStooqHistory(csv, 'NVDA', 'max', new Date('2026-07-20T00:00:00.000Z'));
    expect(value.prices.map((price) => price.date)).toEqual(['2026-07-18', '2026-07-19']);
  });

  it.each([
    ['', 'FALLBACK_EMPTY_DATASET'], ['No data', 'FALLBACK_EMPTY_DATASET'],
    ['<!DOCTYPE html><html></html>', 'FALLBACK_INVALID_CSV'], ['wrong,headers\n1,2', 'FALLBACK_INVALID_CSV'],
  ])('classifies unusable body %#', (body, failureCode) => {
    try { normalizeStooqHistory(body, 'NVDA', 'max'); } catch (cause) {
      expect(cause).toMatchObject({ failureCode });
      return;
    }
    throw new Error('Expected parser failure');
  });

  it('rejects insufficient rows and never invents missing candles or volume', () => {
    const csv = [header, row('2026-07-17'), row('2026-07-18', '10,12,9,11,')].join('\n');
    expect(() => normalizeStooqHistory(csv, 'NVDA', 'max')).toThrowError(expect.objectContaining({ failureCode: 'FALLBACK_INSUFFICIENT_ROWS', validRows: 1 }));
  });

  it('slices the full dataset to 3m and 1y after parsing', () => {
    const csv = [header, row('2025-06-01'), row('2025-12-01'), row('2026-05-01'), row('2026-07-01')].join('\n');
    const now = new Date('2026-07-19T00:00:00.000Z');
    expect(normalizeStooqHistory(csv, 'NVDA', '3m', now).prices.map((price) => price.date)).toEqual(['2026-05-01', '2026-07-01']);
    expect(normalizeStooqHistory(csv, 'NVDA', '1y', now).prices.map((price) => price.date)).toEqual(['2025-12-01', '2026-05-01', '2026-07-01']);
  });
});

describe('Stooq HTTP contract', () => {
  it('requests the full daily dataset without a range parameter', async () => {
    const fetchImpl = vi.fn(async (url: URL) => {
      expect(url.searchParams.get('s')).toBe('nvda.us');
      expect(url.searchParams.get('i')).toBe('d');
      expect(url.searchParams.has('range')).toBe(false);
      return new Response([header, row('2026-07-17'), row('2026-07-18')].join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8' } });
    }) as unknown as typeof fetch;
    const value = await new StooqHistoricalProvider(fetchImpl).getHistoricalPrices('NVDA', 'max');
    expect(value.provider).toBe('stooq');
  });

  it('rejects an HTML verification page by content-type before CSV parsing', async () => {
    const fetchImpl = vi.fn(async () => new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch;
    await expect(new StooqHistoricalProvider(fetchImpl).getHistoricalPrices('NVDA', '1y'))
      .rejects.toMatchObject({ failureCode: 'FALLBACK_INVALID_CONTENT_TYPE', code: 'invalid-provider-response' });
  });
});
