import { describe, expect, it } from 'vitest';
import { calculateExpectedMove, calculateOptionsLevels, rankOiConcentrations } from './options-levels';

describe('options chart levels', () => {
  it('stays unavailable without a real complete chain or when disabled', () => {
    expect(calculateOptionsLevels(null, true).status).toBe('unavailable');
    expect(calculateOptionsLevels({ expiration: '2026-08-21', dataTimestamp: '2026-07-19', source: 'fixture', complete: false, strikes: [] }, true).status).toBe('incomplete');
    expect(calculateOptionsLevels(null, false)).toEqual({ status: 'unavailable', reason: 'Options levels unavailable' });
  });

  it('derives walls and max pain only from supplied open interest', () => {
    const result = calculateOptionsLevels({ expiration: '2026-08-21', dataTimestamp: '2026-07-19', source: 'fixture', complete: true, strikes: [{ strike: 90, callOpenInterest: 10, putOpenInterest: 50 }, { strike: 100, callOpenInterest: 30, putOpenInterest: 30 }, { strike: 110, callOpenInterest: 50, putOpenInterest: 10 }] }, true);
    expect(result).toMatchObject({ status: 'available', callWall: 110, putWall: 90, maxPain: 100 });
  });

  it('calculates the same-expiration expected move fixture and rejects missing IV', () => {
    const result = calculateExpectedMove({ spot: 100, impliedVolatility: 0.6, dte: 30, expiration: '2026-08-21', source: 'fixture-provider', asOf: '2026-07-20T20:00:00.000Z' });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.expectedMove).toBeCloseTo(17.2015, 3);
      expect(result.lower).toBeCloseTo(82.7985, 3);
      expect(result.upper).toBeCloseTo(117.2015, 3);
    }
    expect(calculateExpectedMove({ spot: 100, dte: 30 }).status).toBe('unavailable');
  });

  it('ranks OI only inside the selected expiration with transparent components', () => {
    const august = rankOiConcentrations({ expiration: '2026-08-21', dataTimestamp: '2026-07-20', source: 'fixture-provider', complete: true, strikes: [
      { strike: 90, callOpenInterest: 10, putOpenInterest: 80, callVolume: 5, putVolume: 30, callBid: 11, callAsk: 12, putBid: 1, putAsk: 1.1 },
      { strike: 100, callOpenInterest: 100, putOpenInterest: 100, callVolume: 50, putVolume: 50, callBid: 6, callAsk: 6.2, putBid: 5.8, putAsk: 6 },
      { strike: 110, callOpenInterest: 80, putOpenInterest: 10, callVolume: 40, putVolume: 5, callBid: 1, callAsk: 1.1, putBid: 11, putAsk: 12 },
    ] }, 100);
    expect(august.status).toBe('available');
    if (august.status === 'available') {
      expect(august.expiration).toBe('2026-08-21');
      expect(august.calls[0].strike).toBe(100);
      expect(august.puts[0].strike).toBe(100);
      expect(august.calls[0].components).toMatchObject({ openInterest: 1, volume: 1, distance: 1, freshness: 1 });
      expect(august.delayed).toBe(true);
    }
    expect(rankOiConcentrations(null, 100).status).toBe('unavailable');
  });
});
