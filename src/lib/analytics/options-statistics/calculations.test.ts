import { describe, expect, it } from 'vitest';
import { putCallRatio } from './calculations';
describe('put/call statistics', () => {
  const rows = [{ type: 'put' as const, volume: 40, openInterest: 80, expiration: '2026-08-21' }, { type: 'call' as const, volume: 20, openInterest: 40, expiration: '2026-08-21' }];
  it('calculates volume and OI ratios with totals and scope', () => { expect(putCallRatio(rows, 'volume')).toMatchObject({ status: 'available', value: 2, putTotal: 40, callTotal: 20 }); expect(putCallRatio(rows, 'open-interest')).toMatchObject({ status: 'available', value: 2 }); });
  it('rejects zero denominator and incomplete/no chains', () => { expect(putCallRatio([{ ...rows[0] }, { ...rows[1], volume: 0 }], 'volume').status).toBe('unavailable'); expect(putCallRatio([], 'volume').status).toBe('unavailable'); expect(putCallRatio([{ ...rows[0], volume: null }, rows[1]], 'volume').status).toBe('unavailable'); });
});
