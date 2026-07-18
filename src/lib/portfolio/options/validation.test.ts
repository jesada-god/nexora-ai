import { describe, expect, it } from 'vitest';
import { optionPositionSchema } from './validation';

const valid = { underlyingSymbol: 'NVDA', optionKind: 'call', contracts: '2', premiumPerShare: '1.25', strikePrice: '150', openedAt: '2026-07-01', expirationDate: '2026-08-01', impliedVolatility: '35.5', delta: '0.45', theta: '-0.03', note: '', status: 'open', idempotencyKey: '550e8400-e29b-41d4-a716-446655440000' };
describe('option position validation', () => {
  it('accepts a valid position', () => expect(optionPositionSchema.safeParse(valid).success).toBe(true));
  it('rejects invalid dates, decimals and greeks', () => {
    expect(optionPositionSchema.safeParse({ ...valid, expirationDate: '2026-06-01' }).success).toBe(false);
    expect(optionPositionSchema.safeParse({ ...valid, premiumPerShare: '-1' }).success).toBe(false);
    expect(optionPositionSchema.safeParse({ ...valid, delta: '1.1' }).success).toBe(false);
  });
});
