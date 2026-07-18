import { describe, expect, it, vi } from 'vitest';
import { fetchFxRate, formatFxRate, parseFxApiResponse } from './client';

describe('FX API client contract', () => {
  it('parses a nested data envelope with a string rate', () => {
    const parsed = parseFxApiResponse({
      data: {
        base: 'USD', quote: 'THB', rate: '33.57715315', asOf: '2026-07-18T08:43:07.000Z',
        fetchedAt: '2026-07-18T08:43:08.000Z', source: 'alpha-vantage', cached: false, stale: false, warning: null,
      },
    });
    expect(parsed.quote).toMatchObject({ rate: '33.57715315', asOf: '2026-07-18T08:43:07.000Z' });
    expect(parsed.unavailable).toBe(false);
    expect(formatFxRate(parsed.quote!.rate)).toBe('33.5772');
  });

  it('rejects zero and does not accept a top-level rate as an implicit fallback', () => {
    expect(() => parseFxApiResponse({ data: { base: 'USD', quote: 'THB', rate: '0', asOf: '2026-07-18T08:43:07.000Z', fetchedAt: '2026-07-18T08:43:08.000Z', source: 'alpha-vantage', cached: false, stale: false, warning: null } })).toThrow();
    expect(() => parseFxApiResponse({ rate: '33.57715315' })).toThrow();
  });

  it('retries once and enables THB as soon as a cached rate is returned', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        base: 'USD', quote: 'THB', rate: '36.25', asOf: '2026-07-18T08:43:07.000Z', fetchedAt: '2026-07-18T08:44:00.000Z',
        source: 'alpha-vantage', cached: true, stale: true, warning: 'กำลังใช้อัตราแลกเปลี่ยนล่าสุดที่บันทึกไว้',
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await fetchFxRate(fetchImpl, 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.quote?.rate).toBe('36.25');
    expect(result.unavailable).toBe(true);
  });
});
