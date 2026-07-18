import { describe, expect, it } from 'vitest';
import { normalizeInstrumentSymbol, parseListingStatusCsv } from './csv';

const header = 'symbol,name,exchange,assetType,ipoDate,delistingDate,status';

describe('LISTING_STATUS CSV', () => {
  it('parses stocks, ETFs, quoted names, dates, and provider symbol punctuation', () => {
    const result = parseListingStatusCsv(`${header}\nBRK.B,"Berkshire Hathaway, Inc.",NYSE,Stock,1980-03-17,null,Active\nSPY,SPDR S&P 500,NYSE ARCA,ETF,1993-01-22,null,Active`, 'active');
    expect(result.failed).toBe(0);
    expect(result.instruments).toEqual([
      expect.objectContaining({ symbol: 'BRK.B', name: 'Berkshire Hathaway, Inc.', asset_type: 'Stock', status: 'active' }),
      expect.objectContaining({ symbol: 'SPY', asset_type: 'ETF', ipo_date: '1993-01-22' }),
    ]);
  });

  it('skips a malformed row without failing the batch', () => {
    const result = parseListingStatusCsv(`${header}\n,Missing symbol,NASDAQ,Stock,null,null,Active\nQQQ,Invesco QQQ,NASDAQ,ETF,null,null,Active`, 'active');
    expect(result.instruments.map((item) => item.symbol)).toEqual(['QQQ']);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 2, code: 'malformed-row' });
  });

  it('normalizes symbols without replacing provider punctuation', () => {
    expect(normalizeInstrumentSymbol(' brk.b ')).toBe('BRK.B');
    expect(normalizeInstrumentSymbol('abc-def')).toBe('ABC-DEF');
  });
});
