import { intrinsicValue, priceOption } from './pricing';
import type { Greeks, OptionLeg, PortfolioValuation, ScenarioInput, SimulationWorkspace } from './types';

const emptyGreeks = (): Greeks => ({ delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 });
const yearsBetween = (from: string, to: string) => Math.max(0, (Date.parse(to) - Date.parse(from)) / 31_557_600_000);
const signOf = (leg: OptionLeg) => leg.side === 'buy' ? 1 : -1;

export interface ProfitLossBasis {
  amount: number | null;
  policy: 'absolute-net-debit' | 'gross-premium-at-risk' | 'unavailable';
}

export function portfolioProfitLossBasis(workspace: Pick<SimulationWorkspace, 'legs'>): ProfitLossBasis {
  const netDebitCredit = workspace.legs.reduce((sum, leg) => (
    sum + signOf(leg) * leg.entryPremium * leg.quantity * leg.multiplier + leg.fees
  ), 0);
  if (Number.isFinite(netDebitCredit) && netDebitCredit > 0) {
    return { amount: Math.abs(netDebitCredit), policy: 'absolute-net-debit' };
  }

  const grossPremiumAtRisk = workspace.legs.reduce((sum, leg) => (
    sum + Math.abs(leg.entryPremium * leg.quantity * leg.multiplier) + leg.fees
  ), 0);
  if (Number.isFinite(grossPremiumAtRisk) && grossPremiumAtRisk > 0) {
    return { amount: grossPremiumAtRisk, policy: 'gross-premium-at-risk' };
  }
  return { amount: null, policy: 'unavailable' };
}

export function optionExpirationProfit(leg: OptionLeg, terminalPrice: number): number {
  const gross = signOf(leg) * (intrinsicValue(terminalPrice, leg.strike, leg.kind) - leg.entryPremium) * leg.quantity * leg.multiplier;
  return gross - leg.fees;
}

export function portfolioExpirationProfit(workspace: Pick<SimulationWorkspace, 'legs' | 'stockQuantity' | 'cashPosition' | 'underlyingPrice'>, terminalPrice: number): number {
  const options = workspace.legs.reduce((sum, leg) => sum + optionExpirationProfit(leg, terminalPrice), 0);
  const stock = workspace.stockQuantity * (terminalPrice - (workspace.underlyingPrice ?? terminalPrice));
  return options + stock + workspace.cashPosition;
}

export function detectStrategy(legs: OptionLeg[], stockQuantity = 0): string {
  const calls = legs.filter((leg) => leg.kind === 'call');
  const puts = legs.filter((leg) => leg.kind === 'put');
  if (legs.length === 1 && stockQuantity > 0 && calls[0]?.side === 'sell') return 'Covered Call';
  if (legs.length === 1 && stockQuantity > 0 && puts[0]?.side === 'buy') return 'Protective Put';
  if (legs.length === 1) return `${legs[0].side === 'buy' ? 'Long' : 'Short'} ${legs[0].kind === 'call' ? 'Call' : 'Put'}`;
  if (legs.length === 2 && calls.length === 1 && puts.length === 1 && legs.every((leg) => leg.side === 'buy')) {
    return calls[0].strike === puts[0].strike ? 'Straddle' : 'Strangle';
  }
  if (legs.length === 2 && (calls.length === 2 || puts.length === 2) && new Set(legs.map((leg) => leg.side)).size === 2) return 'Vertical Spread';
  if (legs.length === 4 && calls.length === 2 && puts.length === 2) return 'Iron Condor';
  if (legs.length === 3 && (calls.length === 3 || puts.length === 3)) return 'Butterfly';
  return 'Custom Multi-Leg';
}

function payoffAnalysis(workspace: SimulationWorkspace): Pick<PortfolioValuation, 'payoff' | 'breakEvens' | 'maxProfit' | 'maxLoss' | 'unlimitedProfit' | 'unlimitedLoss'> {
  const spot = workspace.underlyingPrice ?? Math.max(...workspace.legs.map((leg) => leg.strike));
  const high = Math.max(spot * 3, ...workspace.legs.map((leg) => leg.strike * 2.5));
  const points = Array.from({ length: 241 }, (_, index) => ({
    price: high * index / 240,
    profitLoss: portfolioExpirationProfit(workspace, high * index / 240),
  }));
  const breakEvens: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.profitLoss === 0) breakEvens.push(previous.price);
    else if (Math.sign(previous.profitLoss) !== Math.sign(current.profitLoss)) {
      breakEvens.push(previous.price + (current.price - previous.price) * Math.abs(previous.profitLoss) / (Math.abs(previous.profitLoss) + Math.abs(current.profitLoss)));
    }
  }
  const far = portfolioExpirationProfit(workspace, high * 10);
  const edge = portfolioExpirationProfit(workspace, high * 9);
  const slopeUp = far - edge;
  const unlimitedProfit = slopeUp > 0.0001;
  const unlimitedLoss = slopeUp < -0.0001;
  const values = points.map((point) => point.profitLoss);
  return {
    payoff: points,
    breakEvens: breakEvens.filter((value, index) => index === 0 || Math.abs(value - breakEvens[index - 1]) > 0.01),
    maxProfit: unlimitedProfit ? null : Math.max(...values),
    maxLoss: unlimitedLoss ? null : Math.min(...values),
    unlimitedProfit,
    unlimitedLoss,
  };
}

export function valuePortfolio(workspace: SimulationWorkspace, scenario: ScenarioInput): PortfolioValuation {
  const aggregateGreeks = emptyGreeks();
  let theoreticalValue = workspace.cashPosition + workspace.stockQuantity * scenario.targetPrice;
  let profitLoss = workspace.cashPosition + workspace.stockQuantity * (scenario.targetPrice - (workspace.underlyingPrice ?? scenario.targetPrice));
  const legs = workspace.legs.map((leg) => {
    const volatility = Math.max(0.0001, leg.impliedVolatility * (1 + scenario.volatilityShift));
    const priced = priceOption({ spot: scenario.targetPrice, strike: leg.strike, timeYears: yearsBetween(scenario.valuationDate, leg.expiration),
      volatility, rate: scenario.rate, dividendYield: scenario.dividendYield, kind: leg.kind, style: leg.style });
    const sign = signOf(leg);
    const scale = sign * leg.quantity * leg.multiplier;
    const legValue = priced.value * scale;
    const legEntry = leg.entryPremium * scale;
    const legProfitLoss = legValue - legEntry - leg.fees;
    theoreticalValue += legValue;
    profitLoss += legProfitLoss;
    (Object.keys(aggregateGreeks) as Array<keyof Greeks>).forEach((key) => { aggregateGreeks[key] += priced.greeks[key] * scale; });
    const intrinsic = intrinsicValue(scenario.targetPrice, leg.strike, leg.kind);
    return { legId: leg.id, value: legValue, profitLoss: legProfitLoss, intrinsicValue: intrinsic,
      timeValue: Math.max(0, priced.value - intrinsic), breakEven: leg.kind === 'call' ? leg.strike + leg.entryPremium : leg.strike - leg.entryPremium,
      greeks: Object.fromEntries((Object.keys(priced.greeks) as Array<keyof Greeks>).map((key) => [key, priced.greeks[key] * scale])) as unknown as Greeks };
  });
  const netDebitCredit = workspace.legs.reduce((sum, leg) => sum + signOf(leg) * leg.entryPremium * leg.quantity * leg.multiplier + leg.fees, 0);
  const profitLossBasis = portfolioProfitLossBasis(workspace);
  return { legs, theoreticalValue, profitLoss, profitLossPercent: profitLossBasis.amount === null ? null : profitLoss / profitLossBasis.amount * 100,
    netDebitCredit, greeks: aggregateGreeks, ...payoffAnalysis(workspace) };
}
