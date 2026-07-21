import type { AtrEtaInput, EtaEstimate, EtaInputs, IvEtaInput } from './types';

/**
 * Probabilistic "estimated range" model — never an exact arrival promise.
 *
 * Two independent methods, plus a blend when both are valid:
 *
 *  • ATR method: distance ÷ confirmed ATR = estimated market-hour bars to traverse.
 *    Converted to a range with documented uncertainty bands (realised paths run
 *    faster or slower than the average true range), and counted in active market
 *    hours only.
 *
 *  • IV method: real ATM implied volatility gives an expected move over a horizon;
 *    a random-walk diffusion (move ∝ √t) inverts the distance to an estimated
 *    horizon, bounded to the option's days-to-expiration. No IV is ever substituted
 *    when it is genuinely missing.
 *
 * Every branch returns a finite range or a typed `unavailable`. The bounds are raw
 * hours; the presentation layer rounds them coarsely so no false precision (e.g.
 * "13h 52m") is ever shown.
 */

export const DEFAULT_MARKET_HOURS_PER_DAY = 6.5;

// ATR uncertainty band: a level typically arrives between ~0.6× and ~1.8× the
// naive distance/ATR estimate. Documented, deterministic, non-predictive.
const ATR_LOWER_BAND = 0.6;
const ATR_UPPER_BAND = 1.8;
// IV diffusion band: the √t inversion is a central estimate; realised timing
// spans roughly half to double it.
const IV_LOWER_BAND = 0.5;
const IV_UPPER_BAND = 2.0;

const unavailable = (limitation: string): EtaEstimate => ({
  status: 'unavailable',
  method: null,
  minMarketHours: null,
  maxMarketHours: null,
  confidence: null,
  assumptions: [],
  limitations: [limitation],
});

/** Estimate an ETA range from the confirmed ATR. */
export function estimateAtrEta(input: { priceDistance: number; atr: AtrEtaInput }): EtaEstimate {
  const { priceDistance, atr } = input;
  if (!Number.isFinite(priceDistance) || priceDistance < 0) return unavailable('Distance to the level is not finite.');
  if (!Number.isFinite(atr.value) || atr.value <= 0) return unavailable('ATR is unavailable, so an ATR ETA cannot be estimated.');
  if (!Number.isFinite(atr.barMinutes) || atr.barMinutes <= 0) return unavailable('ATR bar duration is invalid.');

  const bars = priceDistance / atr.value;
  const centralHours = bars * (atr.barMinutes / 60);
  const minMarketHours = centralHours * ATR_LOWER_BAND;
  const maxMarketHours = centralHours * ATR_UPPER_BAND;
  // Confidence reflects how many ATRs away the level is: nearby levels are more
  // reliably timed than ones many volatility units out.
  const confidence = bars <= 6 ? 'high' : bars <= 15 ? 'moderate' : 'low';
  return {
    status: 'available',
    method: 'atr',
    minMarketHours,
    maxMarketHours,
    confidence,
    assumptions: [
      `Distance is ${bars.toFixed(2)} × the confirmed ${atr.timeframe} ATR.`,
      'Counted in active market hours only; average true range, not a forecast of direction.',
    ],
    limitations: ['ATR is an average of past ranges; realised timing varies and direction is not implied.'],
  };
}

/** Estimate an ETA range from real ATM implied volatility / expected move. */
export function estimateIvEta(input: { priceDistance: number; acceptedPrice: number; iv: IvEtaInput; marketHoursPerDay: number }): EtaEstimate {
  const { priceDistance, acceptedPrice, iv, marketHoursPerDay } = input;
  if (!Number.isFinite(priceDistance) || priceDistance < 0) return unavailable('Distance to the level is not finite.');
  if (!Number.isFinite(acceptedPrice) || acceptedPrice <= 0) return unavailable('Accepted price is unavailable for an IV ETA.');
  if (!Number.isFinite(iv.atmIv) || iv.atmIv <= 0) return unavailable('Real ATM implied volatility is unavailable; no IV ETA is estimated.');
  if (!Number.isFinite(iv.daysToExpiration) || iv.daysToExpiration <= 0) return unavailable('Days-to-expiration is invalid for an IV ETA.');
  if (!Number.isFinite(marketHoursPerDay) || marketHoursPerDay <= 0) return unavailable('Market hours per day is invalid.');

  // Expected move to expiration: S · σ · √(T/365). Fraction of that move the level sits at.
  const expectedMove = acceptedPrice * iv.atmIv * Math.sqrt(iv.daysToExpiration / 365);
  const fractionOfMove = expectedMove > 0 ? priceDistance / expectedMove : Infinity;
  // Invert move(t) = S·σ·√(t/365) = distance  ⇒  t = 365·(distance /(S·σ))².
  const centralCalendarDays = 365 * (priceDistance / (acceptedPrice * iv.atmIv)) ** 2;
  const centralTradingDays = centralCalendarDays * (252 / 365);
  const centralHours = centralTradingDays * marketHoursPerDay;
  const minMarketHours = centralHours * IV_LOWER_BAND;
  const maxMarketHours = centralHours * IV_UPPER_BAND;
  const withinHorizon = fractionOfMove <= 1;
  const confidence = withinHorizon ? 'moderate' : fractionOfMove <= 1.5 ? 'low' : 'low';
  const limitations = withinHorizon
    ? ['Implied volatility prices magnitude, not direction or timing certainty.']
    : ['The level lies beyond the expected move to this expiration; the estimate is an extrapolation.'];
  return {
    status: 'available',
    method: 'iv',
    minMarketHours,
    maxMarketHours,
    confidence,
    assumptions: [
      `Expected move to expiration ≈ ${expectedMove.toFixed(2)} (${iv.daysToExpiration}d, ATM IV ${(iv.atmIv * 100).toFixed(0)}%).`,
      `Level is ${Number.isFinite(fractionOfMove) ? fractionOfMove.toFixed(2) : '∞'} × the expected move; random-walk (√t) horizon.`,
    ],
    limitations,
  };
}

/** Blend two available estimates by averaging their bounds; confidence follows agreement. */
export function blendEta(atr: EtaEstimate, iv: EtaEstimate): EtaEstimate {
  if (atr.status !== 'available' || iv.status !== 'available') {
    return unavailable('Blending requires both a valid ATR and a valid IV estimate.');
  }
  const minMarketHours = (atr.minMarketHours! + iv.minMarketHours!) / 2;
  const maxMarketHours = (atr.maxMarketHours! + iv.maxMarketHours!) / 2;
  // Ranges "agree" when they overlap; agreement lifts confidence, disagreement lowers it.
  const overlap = atr.minMarketHours! <= iv.maxMarketHours! && iv.minMarketHours! <= atr.maxMarketHours!;
  const rank = { low: 1, moderate: 2, high: 3 } as const;
  const higher = rank[atr.confidence!] >= rank[iv.confidence!] ? atr.confidence! : iv.confidence!;
  const lower = rank[atr.confidence!] <= rank[iv.confidence!] ? atr.confidence! : iv.confidence!;
  return {
    status: 'available',
    method: 'blended',
    minMarketHours,
    maxMarketHours,
    confidence: overlap ? higher : lower,
    assumptions: [...atr.assumptions, ...iv.assumptions, `ATR and IV estimates ${overlap ? 'overlap' : 'diverge'}.`],
    limitations: [...new Set([...atr.limitations, ...iv.limitations])],
  };
}

/**
 * Estimate an ETA range, preferring a blend only when both ATR and IV are valid,
 * otherwise the single available method, otherwise a typed unavailable.
 */
export function estimateEta(input: { priceDistance: number; acceptedPrice: number | null; eta?: EtaInputs }): EtaEstimate {
  const marketHoursPerDay = input.eta?.marketHoursPerDay ?? DEFAULT_MARKET_HOURS_PER_DAY;
  const atrInput = input.eta?.atr ?? null;
  const ivInput = input.eta?.iv ?? null;

  const atr = atrInput ? estimateAtrEta({ priceDistance: input.priceDistance, atr: atrInput }) : null;
  const iv = ivInput && input.acceptedPrice != null
    ? estimateIvEta({ priceDistance: input.priceDistance, acceptedPrice: input.acceptedPrice, iv: ivInput, marketHoursPerDay })
    : null;

  const atrOk = atr?.status === 'available';
  const ivOk = iv?.status === 'available';
  if (atrOk && ivOk) return blendEta(atr, iv);
  if (atrOk) return atr;
  if (ivOk) return iv;
  return unavailable('Insufficient data for an ETA (no confirmed ATR or real ATM IV).');
}
