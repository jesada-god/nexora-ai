// @vitest-environment jsdom

/**
 * Behavioural guard for the WebSocket connection indicator in
 * {@link StockPriceHeader}. The indicator is status-only: it must never alter,
 * clear or replace the accepted price/timestamp/session/freshness. It reflects
 * the typed {@link ConnectionStatus} handed down from the market coordinator.
 *
 * Covered here:
 *  - `reconnecting` shows the "กำลังเชื่อมต่อใหม่…" pill AND keeps the last price.
 *  - a `connected`/`null` transition hides the pill (recovery clears it).
 *  - `degraded`/`disconnected` show "การเชื่อมต่อขัดข้อง" alongside the existing
 *    freshness badge.
 * The pure status→view mapping is unit-tested in `price-header.test.ts`.
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataFreshness, Quote } from '@/src/lib/market-data/types';
import type { ConnectionStatus } from '@/src/lib/stock-detail/market-source';
import { StockPriceHeader } from './StockPriceHeader';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// App client components are transformed with the classic JSX runtime here, so
// they reference a global `React` (matches StockDetailHydration.test.tsx).
vi.stubGlobal('React', React);

const QUOTE: Quote = {
  symbol: 'AAPL',
  currency: 'USD',
  price: 187.42,
  open: 185,
  high: 188,
  low: 184,
  previousClose: 186,
  change: 1.42,
  changePercent: 0.76,
  volume: 1_000_000,
  latestTradingDay: null,
};

const FRESHNESS: DataFreshness = {
  status: 'delayed',
  asOf: '2026-07-23T14:30:00.000Z',
  maxAgeSeconds: 900,
};

function baseProps(connectionState: ConnectionStatus | null) {
  return {
    symbol: 'AAPL',
    exchange: 'NASDAQ',
    sourceCurrency: 'USD',
    quote: QUOTE,
    freshness: FRESHNESS,
    market: { currentStatus: 'open' as const, notes: null },
    provider: 'alpaca',
    providerConfigured: true,
    quoteError: null,
    fallbackLabel: null,
    quoteLoading: false,
    quoteRetryAt: 0,
    onRetryQuote: () => {},
    fxQuote: null,
    evaluatedAt: '2026-07-23T14:31:00.000Z',
    connectionState,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(connectionState: ConnectionStatus | null) {
  act(() => { root.render(React.createElement(StockPriceHeader, baseProps(connectionState))); });
}

describe('StockPriceHeader connection indicator', () => {
  it('shows the reconnecting pill while keeping the last accepted price visible', () => {
    render('reconnecting');
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('กำลังเชื่อมต่อใหม่…');
    // The reconnecting state must NOT wipe the price — the last value still shows.
    expect(container.textContent).toContain('187.42');
    // A spinner is present and marked decorative (screen readers read the label).
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('hides the pill once the connection recovers (connected / null)', () => {
    render('reconnecting');
    expect(container.textContent).toContain('กำลังเชื่อมต่อใหม่…');
    // Recovery — the same price stays, the pill disappears on its own.
    render('connected');
    expect(container.textContent).not.toContain('กำลังเชื่อมต่อใหม่…');
    expect(container.textContent).toContain('187.42');
    render(null);
    expect(container.textContent).not.toContain('กำลังเชื่อมต่อใหม่…');
  });

  it('shows a connection-problem badge for degraded/disconnected without dropping the price', () => {
    render('degraded');
    expect(container.textContent).toContain('การเชื่อมต่อขัดข้อง');
    expect(container.textContent).toContain('187.42');
    render('disconnected');
    expect(container.textContent).toContain('การเชื่อมต่อขัดข้อง');
  });

  it('renders no connection indicator for a REST-only header (null)', () => {
    render(null);
    expect(container.textContent).not.toContain('กำลังเชื่อมต่อใหม่…');
    expect(container.textContent).not.toContain('การเชื่อมต่อขัดข้อง');
  });
});
