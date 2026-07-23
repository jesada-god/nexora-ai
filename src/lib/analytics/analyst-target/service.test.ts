import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loadAnalystTarget } from './service';

function fakeFetch(routes: Record<string, unknown>, opts: { failPaths?: string[] } = {}): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (opts.failPaths?.some((p) => url.includes(p))) return new Response('no', { status: 403 });
    const key = Object.keys(routes).find((path) => url.includes(path));
    if (!key) return new Response('[]', { status: 200 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const base = (fetchImpl: typeof fetch) => ({ apiKey: 'k', fetchImpl, now: () => Date.parse('2026-07-24T00:00:00Z') });

describe('loadAnalystTarget', () => {
  it('returns a fully-populated consensus from real provider rows', async () => {
    const fetchImpl = fakeFetch({
      'price-target-consensus': [{ symbol: 'RKLB', targetHigh: 40, targetLow: 20, targetConsensus: 30, targetMedian: 29 }],
      'price-target-summary': [{ lastQuarterCount: 12, lastYearCount: 15, allTimeCount: 20 }],
    });
    const result = await loadAnalystTarget('rklb', { ...base(fetchImpl), currency: 'USD' });
    expect(result).toMatchObject({
      status: 'available', symbol: 'RKLB',
      low: 20, median: 29, average: 30, high: 40,
      analystCount: 12, coverageWindow: 'last-quarter',
      currency: 'USD', source: 'financial-modeling-prep',
    });
  });

  it('is unavailable (never fabricated) when the provider key is absent', async () => {
    const result = await loadAnalystTarget('RKLB', { apiKey: null });
    expect(result).toMatchObject({ status: 'unavailable', symbol: 'RKLB' });
  });

  it('is unavailable when the consensus endpoint is unentitled (403 → empty)', async () => {
    const fetchImpl = fakeFetch({ 'price-target-summary': [{ lastYearCount: 3 }] }, { failPaths: ['price-target-consensus'] });
    const result = await loadAnalystTarget('RKLB', base(fetchImpl));
    expect(result.status).toBe('unavailable');
  });

  it('is unavailable when consensus values are non-finite or an inverted range', async () => {
    const fetchImpl = fakeFetch({
      'price-target-consensus': [{ targetHigh: 10, targetLow: 20, targetConsensus: 15 }], // high < low
    });
    const result = await loadAnalystTarget('RKLB', base(fetchImpl));
    expect(result.status).toBe('unavailable');
  });

  it('reports available with a null count/median when the summary/median are missing', async () => {
    const fetchImpl = fakeFetch({
      'price-target-consensus': [{ targetHigh: 40, targetLow: 20, targetConsensus: 30 }],
      'price-target-summary': [{}],
    });
    const result = await loadAnalystTarget('RKLB', base(fetchImpl));
    expect(result).toMatchObject({ status: 'available', analystCount: null, median: null, coverageWindow: null });
  });
});
