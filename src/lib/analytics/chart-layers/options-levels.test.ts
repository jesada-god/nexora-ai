import { describe, expect, it } from 'vitest';
import { calculateOptionsLevels } from './options-levels';

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
});
