import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadInstrumentSnapshot } from './providers';
import { executeInstrumentSync } from './sync-runner';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'src/lib/instruments/fixtures', name), 'utf8');

function textResponse(body: string, contentType = 'text/plain'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

function fallbackFetch(alphaBody = '{}'): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes('alphavantage.co')) return textResponse(alphaBody, 'application/json');
    if (url.endsWith('nasdaqlisted.txt')) return textResponse(fixture('nasdaqlisted.txt'));
    if (url.endsWith('otherlisted.txt')) return textResponse(fixture('otherlisted.txt'));
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }) as typeof fetch;
}

describe('instrument provider fallback', () => {
  it('treats Alpha Vantage {} as invalid and falls back to the combined Nasdaq Trader snapshot', async () => {
    const fetchImpl = fallbackFetch();
    const snapshot = await loadInstrumentSnapshot({ apiKey: 'test-key', fetchImpl, maxAttempts: 1 });
    expect(snapshot).toMatchObject({
      primaryProvider: 'alpha-vantage',
      providerUsed: 'nasdaq-trader',
      fallbackReason: 'invalid-provider-response',
      incomplete: false,
    });
    expect(snapshot.instruments.map((row) => row.symbol)).toEqual(expect.arrayContaining(['AAPL', 'QQQ', 'BRK.B', 'SPY', 'ABC-DEF']));
    expect(snapshot.failed).toBe(2);
    expect(fetchImpl).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'www.alphavantage.co' }), expect.any(Object));
  });

  it('performs a fixture-backed dry-run with discovered rows and no database write', async () => {
    const snapshot = await loadInstrumentSnapshot({ apiKey: 'test-key', fetchImpl: fallbackFetch(), maxAttempts: 1 });
    const preview = vi.fn(async (rows) => ({ inserted: rows.length, updated: 0, skipped: 0, failed: snapshot.failed }));
    const persist = vi.fn();
    const execution = await executeInstrumentSync(snapshot, true, { preview, persist });
    expect(snapshot.instruments.length).toBeGreaterThan(0);
    expect(execution.counts.inserted).toBe(snapshot.instruments.length);
    expect(execution.wroteDatabase).toBe(false);
    expect(preview).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
  });

  it('marks the run incomplete and never writes when Alpha Vantage and Nasdaq Trader both fail', async () => {
    const fetchImpl = vi.fn(async () => new Response('provider unavailable', { status: 503, headers: { 'content-type': 'text/plain' } })) as typeof fetch;
    const snapshot = await loadInstrumentSnapshot({ apiKey: 'test-key', fetchImpl, maxAttempts: 1 });
    const preview = vi.fn();
    const persist = vi.fn();
    const execution = await executeInstrumentSync(snapshot, false, { preview, persist });
    expect(snapshot.incomplete).toBe(true);
    expect(snapshot.providerUsed).toBeNull();
    expect(execution.wroteDatabase).toBe(false);
    expect(preview).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
