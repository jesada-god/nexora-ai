import { describe, expect, it } from 'vitest';
import { rankInstrumentCandidates, type RankableInstrument } from './ranking';

const rows: RankableInstrument[] = [
  { symbol: 'AL', name: 'Unrelated', assetType: 'Stock', status: 'active' },
  { symbol: 'ALFA', name: 'Alpha Co', assetType: 'Stock', status: 'active' },
  { symbol: 'ZZZ', name: 'Alpine Holdings', assetType: 'Stock', status: 'active' },
  { symbol: 'ALP', name: 'Old Alpha ETF', assetType: 'ETF', status: 'delisted' },
  { symbol: 'BET', name: 'The Alpa Company', assetType: 'ETF', status: 'active' },
];

describe('instrument search ranking', () => {
  it('ranks exact symbol, symbol prefix, company-name prefix, then fuzzy', () => {
    expect(rankInstrumentCandidates(rows, 'al', { includeDelisted: true }).map((row) => row.symbol))
      .toEqual(['AL', 'ALFA', 'ALP', 'ZZZ', 'BET']);
  });
  it('filters active by default and supports Stock/ETF filters', () => {
    expect(rankInstrumentCandidates(rows, 'al').map((row) => row.symbol)).not.toContain('ALP');
    expect(rankInstrumentCandidates(rows, 'al', { assetType: 'ETF', includeDelisted: true }).map((row) => row.symbol)).toEqual(['ALP', 'BET']);
  });
});

