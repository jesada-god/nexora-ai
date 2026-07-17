import { describe, expect, it } from 'vitest';
import {
  historicalRangeSchema,
  searchParamsSchema,
  symbolSchema,
} from './validation';

describe('market data request validation', () => {
  it('normalizes valid global symbols', () => {
    expect(symbolSchema.parse('  brk.b ')).toBe('BRK.B');
    expect(symbolSchema.parse('^gspc')).toBe('^GSPC');
  });

  it.each(['', '../AAPL', 'AAPL/USD', 'AAPL?', 'AAPL DROP TABLE'])('rejects unsafe symbol %j', (symbol) => {
    expect(symbolSchema.safeParse(symbol).success).toBe(false);
  });

  it('validates search query length and trims it', () => {
    expect(searchParamsSchema.parse({ q: '  microsoft  ' })).toEqual({ q: 'microsoft' });
    expect(searchParamsSchema.safeParse({ q: '' }).success).toBe(false);
    expect(searchParamsSchema.safeParse({ q: 'x'.repeat(81) }).success).toBe(false);
  });

  it('only accepts supported historical ranges', () => {
    expect(historicalRangeSchema.parse('1y')).toBe('1y');
    expect(historicalRangeSchema.safeParse('7d').success).toBe(false);
  });
});
