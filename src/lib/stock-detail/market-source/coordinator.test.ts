import { describe, expect, it } from 'vitest';
import { CoordinatedMarketSource, createMarketSource } from './coordinator';
import type { MarketSource, MarketUpdate, MarketUpdateListener } from './types';

function fakeSource() {
  const listeners = new Set<MarketUpdateListener>();
  const calls: string[] = [];
  let started = false;
  const source: MarketSource = {
    transport: 'polling',
    start() { started = true; calls.push('start'); },
    stop() { started = false; calls.push('stop'); },
    setVisible(v) { calls.push(`visible:${v}`); },
    setSession() { calls.push('session'); },
    refresh() { calls.push('refresh'); return Promise.resolve(); },
    cooldownRemainingMs() { return 0; },
    isSnapshotEntitled() { return true; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { source, calls, emit: (u: MarketUpdate) => listeners.forEach((l) => l(u)), isStarted: () => started };
}

function liveUpdate(price: number): MarketUpdate {
  return {
    symbol: 'AAPL', price, quote: null, candle: null, error: null,
    label: { mode: 'REAL-TIME', provider: 'alpaca:iex', source: 'aggregate-fallback', exchangeTimestamp: null, receivedAt: '', delayAgeSeconds: null, fallbackNote: null, realtime: true, feed: 'iex' },
  };
}

function restUpdate(price: number): MarketUpdate {
  return {
    symbol: 'AAPL', price, quote: null, candle: null, error: null,
    label: { mode: 'DELAYED', provider: 'polygon', source: 'aggregate-fallback', exchangeTimestamp: null, receivedAt: '', delayAgeSeconds: null, fallbackNote: null, realtime: false },
  };
}

/** WS socket OPEN and subscribed, but no priced tick yet (a quiet market). */
function openAwaitingUpdate(): MarketUpdate {
  return {
    symbol: 'AAPL', price: null, quote: null, candle: null, error: null,
    label: { mode: 'UNAVAILABLE', provider: 'alpaca:iex', source: null, exchangeTimestamp: null, receivedAt: '', delayAgeSeconds: null, fallbackNote: null, realtime: false, feed: 'iex' },
    streamStatus: 'open',
  };
}

/** A REST poll failure (e.g. an unentitled provider 403) carries no price. */
function restErrorUpdate(): MarketUpdate {
  return {
    symbol: 'AAPL', price: null, quote: null, candle: null,
    error: { code: 'forbidden', message: 'not entitled', retryable: false },
    label: { mode: 'UNAVAILABLE', provider: 'polygon', source: null, exchangeTimestamp: null, receivedAt: '', delayAgeSeconds: null, fallbackNote: null, realtime: false },
  };
}

function setup(graceMs = 4_000) {
  const ws = fakeSource();
  const poll = fakeSource();
  const pending: Array<() => void> = [];
  const coord = new CoordinatedMarketSource({
    symbol: 'AAPL',
    transport: {} as never,
    wsUrl: 'wss://gw/ws',
    session: 'regular',
    selection: { interval: '1m', session: 'regular', adjusted: false },
    graceMs,
    scheduler: (cb) => { pending.push(cb); return () => {}; },
    createWsSource: () => ws.source,
    createPollSource: () => poll.source,
  });
  const forwarded: MarketUpdate[] = [];
  coord.subscribe((u) => forwarded.push(u));
  const flush = (): void => { pending.splice(0).forEach((cb) => cb()); };
  return { coord, ws, poll, forwarded, flush };
}

describe('CoordinatedMarketSource', () => {
  it('forwards the live stream and keeps REST polling stopped while WS is live', () => {
    const { coord, ws, poll, forwarded } = setup();
    coord.start();
    ws.emit(liveUpdate(100));
    expect(poll.isStarted()).toBe(false);
    expect(forwarded[forwarded.length - 1].label.realtime).toBe(true);
  });

  it('drops REST updates while WS is live (no overlap)', () => {
    const { coord, ws, poll, forwarded } = setup();
    coord.start();
    ws.emit(liveUpdate(100));
    const before = forwarded.length;
    poll.emit(restUpdate(99));
    expect(forwarded.length).toBe(before);
  });

  it('falls back to REST polling after the grace period when WS drops', () => {
    const { coord, ws, poll, forwarded, flush } = setup();
    coord.start();
    ws.emit(liveUpdate(100));
    // WS degrades (a non-live update).
    ws.emit(restUpdate(100));
    expect(poll.isStarted()).toBe(false); // still in grace
    flush();
    expect(poll.isStarted()).toBe(true);
    poll.emit(restUpdate(98));
    const last = forwarded[forwarded.length - 1];
    expect(last.price).toBe(98);
    expect(last.label.realtime).not.toBe(true); // cached/REST never labelled realtime
  });

  it('reconciles a snapshot then stops polling when WS returns live', async () => {
    const { coord, ws, poll, flush } = setup();
    coord.start();
    ws.emit(liveUpdate(100));
    ws.emit(restUpdate(100));
    flush(); // engage REST fallback
    expect(poll.isStarted()).toBe(true);
    ws.emit(liveUpdate(101)); // WS recovers
    expect(poll.calls).toContain('refresh'); // reconcile snapshot fires immediately
    // stop() runs on the microtask after refresh() resolves (reconcile → then stop).
    await Promise.resolve();
    await Promise.resolve();
    expect(poll.calls).toContain('stop');
    expect(poll.isStarted()).toBe(false);
  });

  it('falls back to REST if WS never reaches live (safety net)', () => {
    const { coord, poll, flush } = setup();
    coord.start();
    expect(poll.isStarted()).toBe(false);
    flush();
    expect(poll.isStarted()).toBe(true);
  });

  it('tears down both sources on stop', () => {
    const { coord, ws, poll } = setup();
    coord.start();
    coord.stop();
    expect(ws.calls).toContain('stop');
    expect(poll.calls).toContain('stop');
  });

  it('attaches the typed connection lifecycle to every forwarded update', () => {
    const { coord, ws, poll, forwarded, flush } = setup();
    coord.start();
    const last = () => forwarded[forwarded.length - 1].connectionState;

    // starting: a pre-live WS emission surfaces `connecting`.
    ws.emit(restUpdate(100));
    expect(last()).toBe('connecting');

    // live: the WS stream is flowing → `connected`.
    ws.emit(liveUpdate(100));
    expect(last()).toBe('connected');

    // drop before the grace timer fires → `reconnecting` (price stays forwarded).
    ws.emit(restUpdate(100));
    expect(last()).toBe('reconnecting');

    // grace expires → REST fallback engages → `degraded`.
    flush();
    poll.emit(restUpdate(98));
    expect(last()).toBe('degraded');

    // recovery: WS returns live → `connected`, so the header clears the indicator.
    ws.emit(liveUpdate(99));
    expect(last()).toBe('connected');
  });

  it('reports `awaiting-data` (not degraded) when the socket is open but no tick has arrived', () => {
    const { coord, ws, poll, forwarded, flush } = setup();
    coord.start();
    // Socket completed its handshake (open + subscribed) but the market is quiet.
    ws.emit(openAwaitingUpdate());
    const last = () => forwarded[forwarded.length - 1].connectionState;
    expect(last()).toBe('awaiting-data');
    // The grace safety-net must be cancelled: an open socket never falls to REST.
    flush();
    expect(poll.isStarted()).toBe(false);
  });

  it('keeps `awaiting-data` when a REST 403 arrives while the socket is open (403 never degrades WS state)', () => {
    const { coord, ws, poll, forwarded } = setup();
    coord.start();
    ws.emit(openAwaitingUpdate());
    expect(forwarded[forwarded.length - 1].connectionState).toBe('awaiting-data');
    // A REST poll failure is dropped while the WS owns the stream (state 'live'):
    // it must NOT flip the connection to degraded/disconnected, and must not even
    // be forwarded (no overlap while the socket owns the stream).
    const before = forwarded.length;
    poll.emit(restErrorUpdate());
    expect(forwarded.length).toBe(before);
    expect(forwarded[forwarded.length - 1].connectionState).toBe('awaiting-data');
  });

  it('flips `awaiting-data` → `connected` on the first live tick', () => {
    const { coord, ws, forwarded } = setup();
    coord.start();
    ws.emit(openAwaitingUpdate());
    expect(forwarded[forwarded.length - 1].connectionState).toBe('awaiting-data');
    ws.emit(liveUpdate(100));
    expect(forwarded[forwarded.length - 1].connectionState).toBe('connected');
    expect(forwarded[forwarded.length - 1].label.realtime).toBe(true);
  });

  it('reports `disconnected` while paused (hidden/offline)', () => {
    const { coord, ws, forwarded } = setup();
    coord.start();
    ws.emit(liveUpdate(100));
    expect(forwarded[forwarded.length - 1].connectionState).toBe('connected');
    // Offline/hidden pauses the source; the next emission is `disconnected`
    // regardless of the underlying transport state.
    coord.setVisible(false);
    ws.emit(liveUpdate(101));
    expect(forwarded[forwarded.length - 1].connectionState).toBe('disconnected');
  });

  it('does not attach a connection lifecycle on the REST-only source', () => {
    const source = createMarketSource({
      symbol: 'AAPL', transport: {} as never, session: 'regular',
      selection: { interval: '5m', session: 'regular', adjusted: false },
      cadence: { regularMs: 12_000, closedMs: 60_000 }, wsUrl: null,
    });
    // The REST-only PollingMarketSource has no `connectionState` concept, so a
    // REST-only deployment can never surface a "reconnecting" pill.
    expect(source.transport).toBe('polling');
    expect('connectionState' in source).toBe(false);
  });
});

describe('createMarketSource', () => {
  it('returns a REST-only source when no Gateway URL is configured', () => {
    const source = createMarketSource({
      symbol: 'AAPL', transport: {} as never, session: 'regular',
      selection: { interval: '5m', session: 'regular', adjusted: false },
      cadence: { regularMs: 12_000, closedMs: 60_000 }, wsUrl: null,
    });
    expect(source.transport).toBe('polling');
  });

  it('returns the coordinated WS+REST source when a Gateway URL is configured', () => {
    const source = createMarketSource({
      symbol: 'AAPL', transport: {} as never, session: 'regular',
      selection: { interval: '5m', session: 'regular', adjusted: false },
      cadence: { regularMs: 12_000, closedMs: 60_000 }, wsUrl: 'wss://gw/ws',
    });
    expect(source.transport).toBe('websocket');
  });
});
