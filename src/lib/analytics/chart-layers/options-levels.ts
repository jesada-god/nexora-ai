export interface ChartOptionStrike { strike: number; callOpenInterest: number | null; putOpenInterest: number | null; }
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
