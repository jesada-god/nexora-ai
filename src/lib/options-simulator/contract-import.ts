import type { OptionContract, OptionsChain } from '@/src/lib/market-data/options/contracts';
import { detectStrategy } from './portfolio';
import type { OptionLeg, PremiumSource, SimulationWorkspace } from './types';

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.max(1, Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000));
}

export function selectProviderPremium(contract: OptionContract): { value: number; source: PremiumSource } | null {
  for (const source of ['mark', 'ask', 'last', 'bid'] as const) {
    const value = contract[source];
    if (value !== null && Number.isFinite(value) && value >= 0) return { value, source };
  }
  return null;
}

export function importOptionContract(
  current: SimulationWorkspace,
  chain: OptionsChain,
  contractSymbol: string,
): SimulationWorkspace | null {
  const contract = [...chain.calls, ...chain.puts].find((item) => item.contractSymbol === contractSymbol);
  if (!contract) return null;
  const premium = selectProviderPremium(contract);
  const valuationDate = current.valuationDate < contract.expiration ? current.valuationDate : chain.asOf.slice(0, 10);
  if (valuationDate >= contract.expiration) return null;
  const existing = current.legs[0];
  const leg: OptionLeg = {
    id: existing?.id ?? globalThis.crypto.randomUUID(),
    kind: contract.type,
    side: existing?.side ?? 'buy',
    quantity: existing?.quantity && existing.quantity > 0 ? existing.quantity : 1,
    strike: contract.strike,
    expiration: contract.expiration,
    entryPremium: premium?.value ?? 0,
    impliedVolatility: contract.impliedVolatility ?? 0,
    multiplier: contract.multiplier,
    fees: existing?.fees ?? 0,
    style: existing?.style ?? 'european',
    delta: contract.delta,
    gamma: contract.gamma,
    theta: contract.theta,
    vega: contract.vega,
    rho: contract.rho,
    ...(contract.delta === null ? {} : { deltaSource: 'provider' as const, deltaTimestamp: contract.asOf }),
    ...(contract.theta === null ? {} : { thetaSource: 'provider' as const, thetaTimestamp: contract.asOf }),
    contractSymbol: contract.contractSymbol,
    bid: contract.bid,
    ask: contract.ask,
    mark: contract.mark,
    last: contract.last,
    volume: contract.volume,
    openInterest: contract.openInterest,
    premiumSource: premium?.source ?? 'manual',
    inputMode: 'provider',
    contractProvider: contract.provider,
    contractAsOf: contract.asOf,
    contractStatus: contract.status,
  };
  const targetDate = addDays(valuationDate, Math.min(30, daysBetween(valuationDate, contract.expiration)));
  const scenarioDate = targetDate > contract.expiration ? contract.expiration : targetDate;
  const legs = [leg];
  return {
    ...current,
    id: undefined,
    updatedAt: undefined,
    name: `${contract.underlyingSymbol} ${contract.type.toUpperCase()} ${contract.strike} ${contract.expiration}`,
    description: `Imported from ${contract.provider} at ${contract.asOf}. Exercise style remains the disclosed simulator assumption (${leg.style}).`,
    symbol: contract.underlyingSymbol,
    companyName: current.symbol === contract.underlyingSymbol && current.companyName ? current.companyName : contract.underlyingSymbol,
    exchange: current.symbol === contract.underlyingSymbol ? current.exchange : null,
    currency: contract.currency,
    underlyingPrice: chain.spot,
    valuationDate,
    entryDate: valuationDate,
    legs,
    strategyType: detectStrategy(legs),
    scenarios: current.scenarios.map((scenario, index) => index === 0 ? {
      ...scenario,
      targetPrice: chain.spot,
      valuationDate: scenarioDate,
    } : scenario),
    monteCarlo: {
      ...current.monteCarlo,
      volatility: contract.impliedVolatility ?? 0,
      horizonDays: daysBetween(valuationDate, scenarioDate),
      steps: Math.min(366, daysBetween(valuationDate, scenarioDate)),
    },
    dataSource: contract.provider,
    dataTimestamp: contract.asOf,
    dataStatus: contract.status === 'live' ? 'live' : contract.status === 'stale' ? 'stale' : 'delayed',
    resultSnapshot: null,
  };
}
