import { describe, expect, it } from 'vitest';
import { calculatePortfolio } from './calculations';
import type { PortfolioTransaction, PortfolioTransactionType } from './types';

let sequence = 0;
function tx(type: PortfolioTransactionType, values: Partial<PortfolioTransaction> = {}): PortfolioTransaction {
  sequence += 1;
  return { id: String(sequence).padStart(3, '0'), portfolioId: 'p1', type, symbol: null, quantity: null, price: null, amount: null,
    occurredAt: `2026-01-${String(sequence).padStart(2, '0')}`, note: null, createdAt: `2026-01-${String(sequence).padStart(2, '0')}T00:00:00Z`, updatedAt: '2026-01-01T00:00:00Z', ...values };
}

describe('weighted average portfolio calculation', () => {
  it('averages acquisitions at multiple prices without floating point drift', () => {
    const result = calculatePortfolio([tx('acquisition', { symbol: 'AAPL', quantity: '10', price: '10' }), tx('acquisition', { symbol: 'AAPL', quantity: '5', price: '20' })], { AAPL: '25' });
    expect(result.holdings[0]).toMatchObject({ quantity: 15, averageCost: 13.33333333, costBasis: 200, marketValue: 375, unrealizedGain: 175 });
  });

  it('handles partial and full disposal and preserves realized gain', () => {
    const ledger = [tx('acquisition', { symbol: 'MSFT', quantity: '10', price: '12.5' }), tx('disposal', { symbol: 'MSFT', quantity: '4', price: '20' })];
    expect(calculatePortfolio(ledger, { MSFT: 15 })).toMatchObject({ realizedGain: 30, costBasis: 75, cashBalance: -45 });
    expect(calculatePortfolio([...ledger, tx('disposal', { symbol: 'MSFT', quantity: '6', price: '10' })]).holdings).toEqual([]);
  });

  it('rejects a disposal above available quantity, even after chronological reordering', () => {
    expect(() => calculatePortfolio([tx('disposal', { symbol: 'NVDA', quantity: '2', price: '5', occurredAt: '2026-01-01' }), tx('acquisition', { symbol: 'NVDA', quantity: '2', price: '4', occurredAt: '2026-01-02' })])).toThrow('Insufficient quantity');
  });

  it('includes dividend and fee in cash', () => {
    expect(calculatePortfolio([tx('deposit', { amount: '100' }), tx('dividend', { amount: '4.25' }), tx('fee', { amount: '1.10' })]).cashBalance).toBe(103.15);
  });

  it('keeps 8-place decimal precision stable', () => {
    const result = calculatePortfolio([tx('acquisition', { symbol: 'BTC', quantity: '0.12345678', price: '123.45678901' })], { BTC: '123.45678901' });
    expect(result.holdings[0].quantity).toBe(0.12345678);
    expect(result.holdings[0].costBasis).toBe(15.24157764);
  });

  it('recalculates from scratch after editing or deleting an old transaction', () => {
    const first = tx('acquisition', { symbol: 'AAPL', quantity: '10', price: '10', occurredAt: '2026-01-01' });
    const second = tx('acquisition', { symbol: 'AAPL', quantity: '10', price: '30', occurredAt: '2026-01-02' });
    expect(calculatePortfolio([first, second]).holdings[0].averageCost).toBe(20);
    expect(calculatePortfolio([{ ...first, price: '20' }, second]).holdings[0].averageCost).toBe(25);
    expect(calculatePortfolio([second]).holdings[0].averageCost).toBe(30);
  });

  it('calculates total value, net deposited capital and total P/L including options', () => {
    const result = calculatePortfolio([
      tx('deposit', { amount: '1375', normalizedAmountUsd: '1375' }),
      tx('acquisition', { symbol: 'AAPL', quantity: '10', price: '145' }),
    ], { AAPL: { price: '150', previousClose: '148' } }, '100');
    expect(result).toMatchObject({ cashBalance: -75, equityMarketValue: 1500, optionsMarketValue: 100, totalValue: 1525, netDepositedCapital: 1375, totalGain: 150 });
    expect(result.totalGainPercent).toBeCloseTo(10.90909091, 7);
    expect(result.todayChange).toBe(20);
  });

  it('subtracts withdrawals from net deposited capital using transaction FX normalization', () => {
    const result = calculatePortfolio([
      tx('deposit', { amount: '3600', originalCurrency: 'THB', fxRateAtTransaction: '36', normalizedAmountUsd: '100' }),
      tx('withdrawal', { amount: '900', originalCurrency: 'THB', fxRateAtTransaction: '36', normalizedAmountUsd: '25' }),
    ]);
    expect(result.netDepositedCapital).toBe(75);
    expect(result.cashBalance).toBe(75);
  });

  it('returns finite zero percentages when invested capital or previous value is zero', () => {
    const result = calculatePortfolio([]);
    expect(result.totalGainPercent).toBe(0);
    expect(result.todayChangePercent).toBe(0);
    expect(Number.isFinite(result.totalGainPercent)).toBe(true);
  });
});
