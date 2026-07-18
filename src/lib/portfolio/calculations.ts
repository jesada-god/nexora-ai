import { fixed as decimal, fixedDivide as divide, fixedMultiply as multiply, fixedPercent, fixedToNumber as number } from '../money/fixed';
import type { HoldingSummary, MarketPriceInput, PortfolioSummary, PortfolioTransaction } from './types';

function ordered(transactions: PortfolioTransaction[]) {
  return [...transactions].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id));
}

interface HoldingState { quantity: bigint; costBasis: bigint; realizedGain: bigint }

/** Replays the complete ledger in deterministic chronological order. */
export function calculatePortfolio(
  transactions: PortfolioTransaction[],
  marketPrices: Record<string, number | string | MarketPriceInput> = {},
  optionsMarketValue: number | string = 0,
): PortfolioSummary {
  const states = new Map<string, HoldingState>();
  let cash = 0n;
  let netDeposited = 0n;

  for (const transaction of ordered(transactions)) {
    const amount = decimal(transaction.normalizedAmountUsd ?? transaction.amount);
    if (transaction.type === 'deposit') cash += amount;
    if (transaction.type === 'withdrawal' || transaction.type === 'fee') cash -= amount;
    if (transaction.type === 'dividend') cash += amount;
    if (transaction.type === 'adjustment') cash += amount;
    if (transaction.type === 'deposit') netDeposited += amount;
    if (transaction.type === 'withdrawal') netDeposited -= amount;

    if (transaction.type !== 'acquisition' && transaction.type !== 'disposal') continue;
    if (!transaction.symbol) throw new Error('Asset transaction requires a symbol');
    const quantity = decimal(transaction.quantity);
    const price = decimal(transaction.price);
    const state = states.get(transaction.symbol) ?? { quantity: 0n, costBasis: 0n, realizedGain: 0n };
    const value = multiply(quantity, price);

    if (transaction.type === 'acquisition') {
      state.quantity += quantity;
      state.costBasis += value;
      cash -= value;
    } else {
      if (quantity > state.quantity) throw new Error(`Insufficient quantity for ${transaction.symbol}`);
      const averageCost = divide(state.costBasis, state.quantity);
      const removedCost = quantity === state.quantity ? state.costBasis : multiply(quantity, averageCost);
      state.quantity -= quantity;
      state.costBasis -= removedCost;
      state.realizedGain += value - removedCost;
      cash += value;
    }
    states.set(transaction.symbol, state);
  }

  let totalMarketValue = 0n;
  let totalTodayChange = 0n;
  const holdings: HoldingSummary[] = [];
  for (const [symbol, state] of states) {
    if (state.quantity === 0n) continue;
    const rawMarketPrice = marketPrices[symbol];
    const quote = typeof rawMarketPrice === 'object' ? rawMarketPrice : rawMarketPrice == null ? null : { price: rawMarketPrice };
    const priceEstimated = quote == null;
    const marketPrice = priceEstimated ? divide(state.costBasis, state.quantity) : decimal(String(quote.price));
    const marketValue = multiply(state.quantity, marketPrice);
    const todayChange = quote?.previousClose == null ? 0n : multiply(state.quantity, marketPrice - decimal(String(quote.previousClose)));
    totalMarketValue += marketValue;
    totalTodayChange += todayChange;
    holdings.push({
      symbol,
      quantity: number(state.quantity),
      averageCost: number(divide(state.costBasis, state.quantity)),
      costBasis: number(state.costBasis),
      marketPrice: number(marketPrice),
      marketValue: number(marketValue),
      realizedGain: number(state.realizedGain),
      unrealizedGain: number(marketValue - state.costBasis),
      allocation: 0,
      priceEstimated,
      priceCached: quote?.cached === true,
      todayChange: number(todayChange),
    });
  }

  for (const holding of holdings) holding.allocation = totalMarketValue === 0n ? 0 : holding.marketValue / number(totalMarketValue) * 100;
  holdings.sort((a, b) => b.marketValue - a.marketValue || a.symbol.localeCompare(b.symbol));
  const costBasis = holdings.reduce((sum, holding) => sum + holding.costBasis, 0);
  const realizedGain = [...states.values()].reduce((sum, holding) => sum + number(holding.realizedGain), 0);
  const unrealizedGain = holdings.reduce((sum, holding) => sum + holding.unrealizedGain, 0);
  const equityMarketValue = number(totalMarketValue);
  const cashBalance = number(cash);
  const optionValue = decimal(optionsMarketValue);
  const totalValueFixed = cash + totalMarketValue + optionValue;
  const totalGainFixed = totalValueFixed - netDeposited;
  const previousValue = totalValueFixed - totalTodayChange;
  const marketValue = equityMarketValue;
  return {
    holdings, cashBalance, marketValue, equityMarketValue, optionsMarketValue: number(optionValue), costBasis,
    realizedGain, unrealizedGain, totalValue: number(totalValueFixed), netDepositedCapital: number(netDeposited),
    totalGain: number(totalGainFixed), totalGainPercent: number(fixedPercent(totalGainFixed, netDeposited)),
    todayChange: number(totalTodayChange), todayChangePercent: number(fixedPercent(totalTodayChange, previousValue)),
  };
}
