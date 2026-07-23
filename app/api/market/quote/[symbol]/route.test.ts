import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketDataError } from '@/src/lib/market-data/errors';

/**
 * Guards the market quote route's PUBLIC contract and documents the real source
 * of the production `403` on `/api/market/quote/RKLB`.
 *
 * Root cause (verified in code, not guessed): this route has NO auth guard — it
 * is public market data. The `403` is a `MarketDataError('forbidden')` raised by
 * the Polygon provider when the configured plan is not entitled to the snapshot
 * AND the free previous-close fallback also fails (see `polygon-provider.ts`).
 * `marketDataResponse` then serialises that typed error at its own HTTP status.
 * There is therefore no auth guard to remove, and same-origin requests are never
 * blocked by authentication — they receive the provider's own answer.
 */

const mocks = vi.hoisted(() => ({
  resolveInstrument: vi.fn(),
  getQuote: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/src/lib/market-data/gateway/service', () => ({
  getMarketDataGateway: () => ({
    resolveInstrument: mocks.resolveInstrument,
    getQuote: mocks.getQuote,
  }),
}));

import { GET } from './route';

const INSTRUMENT = { canonicalSymbol: 'RKLB', providerSymbol: 'RKLB', active: true, supported: true };

function request(symbol = 'RKLB', headers?: Record<string, string>) {
  // The route only reads `request.headers`; a plain Request is sufficient at
  // runtime, cast to the NextRequest the handler is typed against.
  return GET(
    new Request(`https://example.test/api/market/quote/${symbol}`, { headers }) as unknown as NextRequest,
    { params: Promise.resolve({ symbol }) },
  );
}

describe('GET /api/market/quote/[symbol]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveInstrument.mockResolvedValue(INSTRUMENT);
  });

  afterEach(() => vi.restoreAllMocks());

  it('serves a same-origin request with NO auth (public market data) and never 401/403 on success', async () => {
    mocks.getQuote.mockResolvedValue({
      symbol: 'RKLB', currency: 'USD', price: 24.5, open: 24, high: 25, low: 23.8,
      previousClose: 24, change: 0.5, changePercent: 2.08, volume: 1_000_000,
      timestamp: 1_753_000_000, provider: 'polygon', status: 'delayed',
    });

    // A request carrying NO Supabase session cookie must still succeed: the route
    // is not auth-gated, so authentication can never turn it into a 401/403.
    const response = await request('RKLB');

    expect(response.status).toBe(200);
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    const body = await response.json();
    expect(body.data.symbol).toBe('RKLB');
    expect(body.data.price).toBe(24.5);
  });

  it('surfaces the provider entitlement 403 verbatim — the documented production root cause (not an auth guard)', async () => {
    mocks.getQuote.mockRejectedValue(
      new MarketDataError('forbidden', 'The configured provider plan is not entitled to this market data operation'),
    );

    const response = await request('RKLB');
    const body = await response.json();

    // 403 == provider `forbidden`, carried through by marketDataResponse.
    expect(response.status).toBe(403);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('forbidden');
    // The provenance header proves the 403 came from the data gateway, not middleware.
    expect(response.headers.get('X-Market-Data-Provenance')).toBe('market-data-gateway');
  });

  it('rejects an invalid symbol at the schema (400), independent of any auth', async () => {
    const response = await request('not a symbol!!');
    expect(response.status).toBe(400);
  });
});
