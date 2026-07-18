import { describe, expect, it } from 'vitest';
import { calculateDte, calculateOpenOptionsMarketValue, calculateOptionStatus, calculateOptionTotalCost } from './calculations';
import type { OptionPosition } from './types';

describe('option position calculations', () => {
  it('calculates premium × contracts × 100 with financial precision', () => {
    expect(calculateOptionTotalCost('1.23456789', '3')).toBe(370.370367);
  });
  it('calculates DTE by calendar day', () => {
    expect(calculateDte('2026-07-31', '2026-07-18')).toBe(13);
    expect(calculateDte('2026-07-18', '2026-07-18')).toBe(0);
  });
  it('derives expired while preserving closed and cancelled', () => {
    expect(calculateOptionStatus({ status: 'open', expirationDate: '2026-07-17' }, '2026-07-18')).toBe('expired');
    expect(calculateOptionStatus({ status: 'closed', expirationDate: '2026-07-17' }, '2026-07-18')).toBe('closed');
    expect(calculateOptionStatus({ status: 'cancelled', expirationDate: '2026-07-20' }, '2026-07-18')).toBe('cancelled');
  });
  it('includes only open, unexpired options in current market value', () => {
    const base = { id: '1', portfolioId: 'p', underlyingSymbol: 'AAPL', optionKind: 'call', contracts: '2', premiumPerShare: '1.25', strikePrice: '100', openedAt: '2026-07-01', expirationDate: '2026-08-01', impliedVolatility: null, delta: null, theta: null, note: null, status: 'open', closedAt: null, idempotencyKey: 'x', createdAt: '', updatedAt: '' } satisfies OptionPosition;
    expect(calculateOpenOptionsMarketValue([base, { ...base, id: '2', status: 'closed', closedAt: '2026-07-10' }], '2026-07-18')).toBe(250);
  });
});
