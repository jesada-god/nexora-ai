import type { OptionContract, OptionsChain } from './contracts';

export interface AtmIvResult {
  status: 'available' | 'unavailable';
  reason?: string;
  iv: number | null;
  method: 'robust-median-near-atm';
  sampledContracts: Array<{
    contractSymbol: string;
    type: 'call' | 'put';
    strike: number;
    impliedVolatility: number;
  }>;
  expiration: string;
  dte: number;
  provider: string;
  asOf: string;
  completeness: number;
  confidence: number;
  warnings: string[];
}

export interface ExpectedMoveResult {
  status: 'available' | 'unavailable';
  reason?: string;
  lower: number | null;
  upper: number | null;
  move: number | null;
  movePercent: number | null;
  spot: number;
  iv: number | null;
  dte: number;
  expiration: string;
  sampledStrikes: number[];
  provider: string;
  asOf: string;
  methodology: 'spot-times-atm-iv-times-square-root-dte-over-365';
  warning: string;
}

export interface OiConcentrationLevel {
  contractSymbol: string;
  type: 'call' | 'put';
  strike: number;
  openInterest: number | null;
  volume: number | null;
  distance: number;
  liquidity: number | null;
  score: number;
  provider: string;
  asOf: string;
  components: Record<'openInterest' | 'volume' | 'distance' | 'liquidity' | 'freshness', number | null>;
}

export interface OiConcentrationResult {
  calls: OiConcentrationLevel[];
  puts: OiConcentrationLevel[];
  provider: string;
  asOf: string;
  methodology: string;
  warnings: string[];
}

function calendarDaysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function calculateAtmIv(chain: OptionsChain, valuationDate = chain.asOf.slice(0, 10)): AtmIvResult {
  const dte = calendarDaysBetween(valuationDate, chain.expiration);
  const warnings = [...chain.warnings];
  const candidates = [...chain.calls, ...chain.puts]
    .filter((contract): contract is OptionContract & { impliedVolatility: number } => (
      contract.expiration === chain.expiration
      && contract.status !== 'stale'
      && contract.impliedVolatility !== null
      && contract.impliedVolatility >= 0.01
      && contract.impliedVolatility <= 5
    ))
    .sort((left, right) => (
      Math.abs(left.strike - chain.spot) - Math.abs(right.strike - chain.spot)
      || left.type.localeCompare(right.type)
      || left.contractSymbol.localeCompare(right.contractSymbol)
    ));
  const sampled: typeof candidates = [];
  for (const type of ['call', 'put'] as const) {
    sampled.push(...candidates.filter((contract) => contract.type === type).slice(0, 3));
  }
  sampled.sort((left, right) => Math.abs(left.strike - chain.spot) - Math.abs(right.strike - chain.spot));
  if (!sampled.length) {
    return {
      status: 'unavailable', reason: 'No valid non-stale near-ATM implied volatility was supplied by the provider',
      iv: null, method: 'robust-median-near-atm', sampledContracts: [], expiration: chain.expiration,
      dte, provider: chain.provider, asOf: chain.asOf, completeness: chain.completeness,
      confidence: 0, warnings,
    };
  }
  if (!sampled.some((contract) => contract.type === 'call') || !sampled.some((contract) => contract.type === 'put')) {
    warnings.push('ATM IV sample contains only one option side');
  }
  const confidence = Math.max(0, Math.min(100,
    chain.completeness * 60
    + Math.min(1, sampled.length / 6) * 25
    + (new Set(sampled.map((contract) => contract.type)).size === 2 ? 15 : 0),
  ));
  return {
    status: 'available', iv: median(sampled.map((contract) => contract.impliedVolatility)),
    method: 'robust-median-near-atm',
    sampledContracts: sampled.map((contract) => ({
      contractSymbol: contract.contractSymbol, type: contract.type,
      strike: contract.strike, impliedVolatility: contract.impliedVolatility,
    })),
    expiration: chain.expiration, dte, provider: chain.provider, asOf: chain.asOf,
    completeness: chain.completeness, confidence, warnings,
  };
}

export function calculateExpectedMove(chain: OptionsChain, valuationDate = chain.asOf.slice(0, 10)): ExpectedMoveResult {
  const atm = calculateAtmIv(chain, valuationDate);
  const base = {
    spot: chain.spot,
    iv: atm.iv,
    dte: atm.dte,
    expiration: chain.expiration,
    sampledStrikes: [...new Set(atm.sampledContracts.map((contract) => contract.strike))].sort((a, b) => a - b),
    provider: chain.provider,
    asOf: chain.asOf,
    methodology: 'spot-times-atm-iv-times-square-root-dte-over-365' as const,
    warning: 'Expected Move is a statistical volatility range, not a guarantee or a statement that prices cannot move beyond it.',
  };
  if (atm.status === 'unavailable' || atm.iv === null) {
    return { status: 'unavailable', reason: atm.reason, lower: null, upper: null, move: null, movePercent: null, ...base };
  }
  const move = chain.spot * atm.iv * Math.sqrt(atm.dte / 365);
  return {
    status: 'available', lower: chain.spot - move, upper: chain.spot + move,
    move, movePercent: chain.spot > 0 ? move / chain.spot : null, ...base,
  };
}

function liquidity(contract: OptionContract): number | null {
  if (contract.bid === null || contract.ask === null) return null;
  const midpoint = (contract.bid + contract.ask) / 2;
  if (!(midpoint > 0)) return null;
  return Math.max(0, Math.min(1, 1 - (contract.ask - contract.bid) / midpoint));
}

function freshness(contract: OptionContract): number {
  return contract.status === 'live' ? 1 : contract.status === 'delayed' ? 0.8 : contract.status === 'cached' ? 0.65 : 0.25;
}

function rankSide(contracts: readonly OptionContract[], spot: number): OiConcentrationLevel[] {
  const maximumOi = Math.max(0, ...contracts.flatMap((contract) => contract.openInterest === null ? [] : [contract.openInterest]));
  const maximumVolume = Math.max(0, ...contracts.flatMap((contract) => contract.volume === null ? [] : [contract.volume]));
  return contracts.map((contract) => {
    const components = {
      openInterest: contract.openInterest === null || maximumOi === 0 ? null : contract.openInterest / maximumOi,
      volume: contract.volume === null || maximumVolume === 0 ? null : contract.volume / maximumVolume,
      distance: Math.max(0, 1 - Math.abs(contract.strike - spot) / Math.max(spot * 0.2, 1)),
      liquidity: liquidity(contract),
      freshness: freshness(contract),
    };
    const weights = { openInterest: 0.55, volume: 0.15, distance: 0.15, liquidity: 0.10, freshness: 0.05 } as const;
    const availableWeight = (Object.keys(weights) as Array<keyof typeof weights>)
      .reduce((sum, key) => sum + (components[key] === null ? 0 : weights[key]), 0);
    const score = availableWeight > 0
      ? (Object.keys(weights) as Array<keyof typeof weights>)
        .reduce((sum, key) => sum + (components[key] ?? 0) * weights[key], 0) / availableWeight * 100
      : 0;
    return {
      contractSymbol: contract.contractSymbol,
      type: contract.type,
      strike: contract.strike,
      openInterest: contract.openInterest,
      volume: contract.volume,
      distance: Math.abs(contract.strike - spot),
      liquidity: components.liquidity,
      score,
      provider: contract.provider,
      asOf: contract.asOf,
      components,
    };
  }).sort((left, right) => right.score - left.score || left.strike - right.strike).slice(0, 3);
}

export function calculateOiConcentration(chain: OptionsChain): OiConcentrationResult {
  const calls = rankSide(chain.calls, chain.spot);
  const puts = rankSide(chain.puts, chain.spot);
  const warnings = [...chain.warnings];
  if (![...chain.calls, ...chain.puts].some((contract) => contract.openInterest !== null)) {
    warnings.push('Open interest is unavailable; remaining component weights were renormalized');
  }
  return {
    calls, puts, provider: chain.provider, asOf: chain.asOf,
    methodology: 'OI 55%, volume 15%, distance 15%, liquidity 10%, freshness 5%; missing components renormalize remaining weights',
    warnings,
  };
}
