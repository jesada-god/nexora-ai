import { describe, expect, it } from 'vitest';
import { portfolioTransactionSchema } from './validation';

const base = { occurredAt: '2026-01-01', note: '', idempotencyKey: '550e8400-e29b-41d4-a716-446655440000' };
describe('portfolio transaction validation', () => {
  it.each(['-1', '0', 'NaN', '1.123456789'])('rejects invalid numeric input %s', (quantity) => {
    expect(portfolioTransactionSchema.safeParse({ ...base, type: 'acquisition', symbol: 'AAPL', quantity, price: '10' }).success).toBe(false);
  });
  it('accepts 8 decimal places and rejects future dates', () => {
    expect(portfolioTransactionSchema.safeParse({ ...base, type: 'acquisition', symbol: 'BTC', quantity: '0.00000001', price: '1.00000001' }).success).toBe(true);
    expect(portfolioTransactionSchema.safeParse({ ...base, type: 'deposit', amount: '1', occurredAt: '2999-01-01' }).success).toBe(false);
  });
});
