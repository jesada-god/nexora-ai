export interface ChartOptionStrike {
  strike: number;
  callOpenInterest: number | null;
  putOpenInterest: number | null;
  callVolume?: number | null;
  putVolume?: number | null;
  callBid?: number | null;
  callAsk?: number | null;
  putBid?: number | null;
  putAsk?: number | null;
}
export interface ChartOptionsChain { expiration: string; dataTimestamp: string; source: string; complete: boolean; strikes: readonly ChartOptionStrike[]; }
export type OptionsLevelsResult = { status: 'available'; expiration: string; dataTimestamp: string; source: string; callWall: number; putWall: number; maxPain: number } | { status: 'unavailable' | 'incomplete'; reason: string };

export function calculateOptionsLevels(chain: ChartOptionsChain | null, enabled: boolean): OptionsLevelsResult {
  if (!enabled || !chain) return { status: 'unavailable', reason: 'Options levels unavailable' };
  if (!chain.complete || !chain.strikes.length || chain.strikes.some((row) => !Number.isFinite(row.strike) || row.callOpenInterest == null || row.putOpenInterest == null || !Number.isFinite(row.callOpenInterest) || !Number.isFinite(row.putOpenInterest) || row.callOpenInterest < 0 || row.putOpenInterest < 0)) return { status: 'incomplete', reason: 'Options chain is incomplete; no levels were calculated' };
  const callWall = chain.strikes.reduce((best, row) => row.callOpenInterest! > best.callOpenInterest! ? row : best).strike;
  const putWall = chain.strikes.reduce((best, row) => row.putOpenInterest! > best.putOpenInterest! ? row : best).strike;
  const maxPain = chain.strikes.reduce((best, settlement) => {
    const pain = chain.strikes.reduce((sum, row) => sum + Math.max(settlement.strike - row.strike, 0) * row.callOpenInterest! + Math.max(row.strike - settlement.strike, 0) * row.putOpenInterest!, 0);
    return pain < best.pain || (pain === best.pain && settlement.strike < best.strike) ? { strike: settlement.strike, pain } : best;
  }, { strike: chain.strikes[0].strike, pain: Number.POSITIVE_INFINITY }).strike;
  return { status: 'available', expiration: chain.expiration, dataTimestamp: chain.dataTimestamp, source: chain.source, callWall, putWall, maxPain };
}

export interface ExpectedMoveInput {
  spot: number;
  impliedVolatility: number;
  dte: number;
  expiration: string;
  source: string;
  asOf: string;
}

export type ExpectedMoveResult = {
  status: 'available';
  expectedMove: number;
  expectedMovePercent: number;
  lower: number;
  upper: number;
  expiration: string;
  dte: number;
  impliedVolatility: number;
  source: string;
  asOf: string;
  methodology: 'Spot × IV × sqrt(DTE/365)';
} | { status: 'unavailable'; reason: string; missingInputs: string[] };

export function calculateExpectedMove(input: Partial<ExpectedMoveInput> | null): ExpectedMoveResult {
  if (!input) return { status: 'unavailable', reason: 'Expected Move requires a real same-expiration IV input', missingInputs: ['spot', 'ATM IV', 'DTE', 'expiration', 'provider asOf'] };
  const missingInputs = [
    !Number.isFinite(input.spot) || (input.spot ?? 0) <= 0 ? 'spot' : null,
    !Number.isFinite(input.impliedVolatility) || (input.impliedVolatility ?? 0) <= 0 ? 'ATM IV' : null,
    !Number.isInteger(input.dte) || (input.dte ?? 0) <= 0 ? 'DTE' : null,
    !input.expiration ? 'expiration' : null,
    !input.source ? 'provider' : null,
    !input.asOf ? 'provider asOf' : null,
  ].filter((value): value is string => value != null);
  if (missingInputs.length) return { status: 'unavailable', reason: 'Expected Move inputs are incomplete', missingInputs };
  const spot = input.spot as number;
  const impliedVolatility = input.impliedVolatility as number;
  const dte = input.dte as number;
  const expectedMove = spot * impliedVolatility * Math.sqrt(dte / 365);
  return {
    status: 'available',
    expectedMove,
    expectedMovePercent: expectedMove / spot * 100,
    lower: spot - expectedMove,
    upper: spot + expectedMove,
    expiration: input.expiration as string,
    dte,
    impliedVolatility,
    source: input.source as string,
    asOf: input.asOf as string,
    methodology: 'Spot × IV × sqrt(DTE/365)',
  };
}

export interface OiConcentration {
  type: 'call' | 'put';
  strike: number;
  openInterest: number;
  score: number;
  components: {
    openInterest: number;
    volume: number | null;
    distance: number;
    liquidity: number | null;
    freshness: number;
  };
}

export type OiConcentrationResult = {
  status: 'available';
  expiration: string;
  source: string;
  asOf: string;
  delayed: boolean;
  calls: OiConcentration[];
  puts: OiConcentration[];
  methodology: string;
} | { status: 'unavailable'; reason: string };

function finiteNonNegative(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function concentrations(chain: ChartOptionsChain, spot: number, type: 'call' | 'put', maximum: number): OiConcentration[] {
  const openInterestKey = type === 'call' ? 'callOpenInterest' : 'putOpenInterest';
  const volumeKey = type === 'call' ? 'callVolume' : 'putVolume';
  const bidKey = type === 'call' ? 'callBid' : 'putBid';
  const askKey = type === 'call' ? 'callAsk' : 'putAsk';
  const eligible = chain.strikes.filter((row) => finiteNonNegative(row[openInterestKey]) && (row[openInterestKey] ?? 0) > 0);
  const maximumOi = Math.max(...eligible.map((row) => row[openInterestKey] as number), 1);
  const availableVolumes = eligible.flatMap((row) => finiteNonNegative(row[volumeKey]) ? [row[volumeKey] as number] : []);
  const maximumVolume = Math.max(...availableVolumes, 1);
  return eligible.map((row): OiConcentration => {
    const oi = row[openInterestKey] as number;
    const volume = finiteNonNegative(row[volumeKey]) ? (row[volumeKey] as number) / maximumVolume : null;
    const bid = row[bidKey]; const ask = row[askKey];
    const midpoint = finiteNonNegative(bid) && finiteNonNegative(ask) ? (bid + ask) / 2 : null;
    const liquidity = midpoint != null && midpoint > 0 && (ask as number) >= (bid as number)
      ? Math.max(0, 1 - ((ask as number) - (bid as number)) / midpoint)
      : null;
    const components = {
      openInterest: oi / maximumOi,
      volume,
      distance: 1 / (1 + (Math.abs(row.strike - spot) / spot) * 10),
      liquidity,
      freshness: 1,
    };
    const weighted: Array<[number | null, number]> = [
      [components.openInterest, 55], [components.volume, 15], [components.distance, 15], [components.liquidity, 10], [components.freshness, 5],
    ];
    const availableWeight = weighted.reduce((sum, [value, weight]) => sum + (value == null ? 0 : weight), 0);
    const score = weighted.reduce((sum, [value, weight]) => sum + (value ?? 0) * weight, 0) / availableWeight * 100;
    return { type, strike: row.strike, openInterest: oi, score: Number(score.toFixed(2)), components };
  }).sort((left, right) => right.score - left.score || right.openInterest - left.openInterest || Math.abs(left.strike - spot) - Math.abs(right.strike - spot)).slice(0, maximum);
}

export function rankOiConcentrations(chain: ChartOptionsChain | null, spot: number, maximum = 3): OiConcentrationResult {
  if (!chain || !chain.complete || !chain.strikes.length || !Number.isFinite(spot) || spot <= 0) {
    return { status: 'unavailable', reason: 'A complete real options chain and positive spot are required' };
  }
  const calls = concentrations(chain, spot, 'call', maximum);
  const puts = concentrations(chain, spot, 'put', maximum);
  if (!calls.length && !puts.length) return { status: 'unavailable', reason: 'The selected expiration has no valid open interest' };
  return {
    status: 'available',
    expiration: chain.expiration,
    source: chain.source,
    asOf: chain.dataTimestamp,
    delayed: /^\d{4}-\d{2}-\d{2}$/.test(chain.dataTimestamp),
    calls,
    puts,
    methodology: 'Score 0–100: OI 55%, option volume 15%, distance from spot 15%, quoted-spread liquidity 10%, freshness 5%; unavailable optional components are weight-normalized.',
  };
}
