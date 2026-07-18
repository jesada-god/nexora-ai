import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeNasdaqTraderDirectories, parseNasdaqTraderDirectory } from './nasdaq-trader';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'src/lib/instruments/fixtures', name), 'utf8');

describe('Nasdaq Trader Symbol Directory parser', () => {
  it('parses nasdaqlisted pipe data, skips the footer and test issues, and maps Stock/ETF', () => {
    const result = parseNasdaqTraderDirectory(fixture('nasdaqlisted.txt'), 'nasdaqlisted');
    expect(result.instruments).toEqual([
      expect.objectContaining({ provider_symbol: 'AAPL', symbol: 'AAPL', exchange: 'NASDAQ', asset_type: 'Stock' }),
      expect.objectContaining({ provider_symbol: 'QQQ', symbol: 'QQQ', exchange: 'NASDAQ', asset_type: 'ETF' }),
    ]);
    expect(result.instruments.some((row) => row.name.startsWith('File Creation Time'))).toBe(false);
    expect(result.instruments.some((row) => row.symbol === 'TESTZ')).toBe(false);
    expect(result.failed).toBe(1);
  });

  it('parses otherlisted, preserves safe punctuation, maps exchanges, and isolates malformed rows', () => {
    const result = parseNasdaqTraderDirectory(fixture('otherlisted.txt'), 'otherlisted');
    expect(result.instruments).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'BRK.B', provider_symbol: 'BRK.B', exchange: 'NYSE', asset_type: 'Stock' }),
      expect.objectContaining({ symbol: 'SPY', exchange: 'NYSE Arca', asset_type: 'ETF' }),
      expect.objectContaining({ symbol: 'ABC-DEF', exchange: 'Cboe' }),
    ]));
    expect(result.instruments.some((row) => row.symbol === 'BAD/ROW')).toBe(false);
    expect(result.failed).toBe(1);
  });

  it('implements every specified exchange mapping and preserves unknown codes', () => {
    const header = 'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol';
    const rows = [
      ['ONE', 'One', 'A', 'ONE', 'N', '100', 'N', 'ONE'],
      ['TWO', 'Two', 'V', 'TWO', 'N', '100', 'N', 'TWO'],
      ['THREE', 'Three', 'UNKNOWN', 'THREE', 'N', '100', 'N', 'THREE'],
    ].map((row) => row.join('|')).join('\n');
    const result = parseNasdaqTraderDirectory(`${header}\n${rows}`, 'otherlisted');
    expect(result.instruments.map((row) => row.exchange)).toEqual(['NYSE American', 'IEX', 'UNKNOWN']);
  });

  it('deduplicates by normalized provider symbol across both directories', () => {
    const merged = mergeNasdaqTraderDirectories(
      parseNasdaqTraderDirectory(fixture('nasdaqlisted.txt'), 'nasdaqlisted'),
      parseNasdaqTraderDirectory(fixture('otherlisted.txt'), 'otherlisted'),
    );
    expect(merged.instruments.filter((row) => row.provider_symbol === 'AAPL')).toHaveLength(1);
    expect(merged.instruments.find((row) => row.provider_symbol === 'AAPL')?.name).toContain('Apple Inc.');
  });
});
