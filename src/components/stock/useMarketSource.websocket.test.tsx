// @vitest-environment jsdom

/**
 * Regression guard for the production bug where the live WebSocket was never
 * opened: `resolvePublicMarketWsUrl` was called through a dynamic `process.env`
 * read, which Next.js does NOT inline into the client bundle, so the Gateway URL
 * came back `undefined` → `null` → REST-only and no socket was ever constructed.
 *
 * These tests exercise the real {@link useMarketSource} hook and assert it hands
 * the configured Gateway URL to `createMarketSource` (mocked to record the wiring),
 * that the live source is created on plain mount (Overview — never gated on the
 * Chart tab, the market session, or a cached snapshot), that a Strict-Mode remount
 * leaves exactly one active source, and that a symbol change swaps connections.
 *
 * The Gateway URL must be present in `process.env` BEFORE the hook module is
 * imported, because the client config constants are inlined at module load. So we
 * set the env and dynamic-import the hook in `beforeAll` (no `resetModules`, to
 * keep a single shared React instance for hooks).
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockDetailQuoteResource } from '@/src/lib/stock-detail/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WS_URL = 'wss://loving-growth-production-0965.up.railway.app/ws';

interface CreatedRecord {
  symbol: string;
  wsUrl: string | null;
  transport: 'polling' | 'websocket';
  started: number;
  stopped: number;
  selections: number;
}

const created: CreatedRecord[] = [];

// Keep every real export; only replace `createMarketSource` with a recorder that
// returns a controllable fake source so we can observe the wsUrl the hook passes.
vi.mock('@/src/lib/stock-detail/market-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/stock-detail/market-source')>();
  return {
    ...actual,
    createMarketSource: vi.fn((opts: { symbol: string; wsUrl: string | null }) => {
      const record: CreatedRecord = {
        symbol: opts.symbol,
        wsUrl: opts.wsUrl ?? null,
        transport: opts.wsUrl ? 'websocket' : 'polling',
        started: 0,
        stopped: 0,
        selections: 0,
      };
      created.push(record);
      return {
        transport: record.transport,
        subscribe: () => () => {},
        start: () => { record.started += 1; },
        stop: () => { record.stopped += 1; },
        setVisible: () => {},
        setSession: () => {},
        setSelection: () => { record.selections += 1; },
        refresh: () => Promise.resolve(),
        cooldownRemainingMs: () => 0,
        isSnapshotEntitled: () => true,
      };
    }),
  };
});

type UseMarketSource = typeof import('./useMarketSource')['useMarketSource'];
type Options = Parameters<UseMarketSource>[0];
let useMarketSource: UseMarketSource;

const INITIAL_QUOTE = {
  data: null,
  freshness: 'live',
  provider: null,
  reason: null,
  error: null,
  fallbackLabel: null,
} as unknown as StockDetailQuoteResource;

function baseOptions(overrides: Partial<Options> = {}): Options {
  return {
    symbol: 'RKLB',
    initialQuote: INITIAL_QUOTE,
    session: 'regular',
    active: true,
    online: true,
    enabled: true,
    ...overrides,
  };
}

function mount(options: Options, strict = false) {
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  function Harness(props: Options) {
    useMarketSource(props);
    return null;
  }
  const tree = (props: Options) => (
    strict
      ? React.createElement(React.StrictMode, null, React.createElement(Harness, props))
      : React.createElement(Harness, props)
  );
  act(() => { root.render(tree(options)); });
  return {
    rerender: (next: Options) => act(() => { root.render(tree(next)); }),
    unmount: () => act(() => { root.unmount(); }),
  };
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_MARKET_WS_URL = WS_URL;
  process.env.NEXT_PUBLIC_APP_ENV = 'production';
  ({ useMarketSource } = await import('./useMarketSource'));
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_MARKET_WS_URL;
  delete process.env.NEXT_PUBLIC_APP_ENV;
});

beforeEach(() => { created.length = 0; });
afterEach(() => { vi.clearAllMocks(); });

describe('useMarketSource live WebSocket wiring', () => {
  it('creates a live WebSocket source on mount using the inlined Gateway URL (Overview, no Chart tab)', () => {
    const handle = mount(baseOptions());
    expect(created).toHaveLength(1);
    expect(created[0].wsUrl).toBe(WS_URL);
    expect(created[0].transport).toBe('websocket');
    expect(created[0].symbol).toBe('RKLB');
    expect(created[0].started).toBe(1);
    handle.unmount();
  });

  it('keeps the WebSocket even when the market is closed and the snapshot is cached', () => {
    const handle = mount(baseOptions({ session: 'closed' }));
    expect(created).toHaveLength(1);
    // A closed session / cached snapshot must NOT downgrade the transport to REST.
    expect(created[0].transport).toBe('websocket');
    expect(created[0].wsUrl).toBe(WS_URL);
    handle.unmount();
  });

  it('leaves exactly one active source across a Strict-Mode remount', () => {
    const handle = mount(baseOptions(), /* strict */ true);
    const active = created.filter((s) => s.started > s.stopped);
    expect(active).toHaveLength(1);
    expect(active[0].wsUrl).toBe(WS_URL);
    handle.unmount();
    // After unmount nothing is left running.
    expect(created.every((s) => s.stopped >= s.started)).toBe(true);
  });

  it('does not open a second connection when only the chart selection changes (shared Overview/Chart socket)', () => {
    const handle = mount(baseOptions({ selection: { interval: '5m', session: 'regular', adjusted: false } }));
    expect(created).toHaveLength(1);
    handle.rerender(baseOptions({ selection: { interval: '1m', session: 'regular', adjusted: false } }));
    // The single source is reconfigured in place — no second socket.
    expect(created).toHaveLength(1);
    expect(created[0].selections).toBeGreaterThanOrEqual(1);
    handle.unmount();
  });

  it('tears down the old source and opens a new one when the symbol changes', () => {
    const handle = mount(baseOptions({ symbol: 'RKLB' }));
    handle.rerender(baseOptions({ symbol: 'AAPL' }));
    const rklb = created.find((s) => s.symbol === 'RKLB');
    const aapl = created.find((s) => s.symbol === 'AAPL');
    expect(rklb?.stopped).toBe(1);
    expect(aapl).toBeDefined();
    expect(aapl?.wsUrl).toBe(WS_URL);
    expect(aapl?.started).toBe(1);
    expect(aapl?.stopped).toBe(0);
    handle.unmount();
  });
});
