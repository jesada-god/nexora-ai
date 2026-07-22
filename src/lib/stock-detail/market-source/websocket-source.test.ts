import { describe, expect, it } from 'vitest';
import { WebSocketMarketSourceImpl } from './websocket-source';
import type { RealtimeSocket } from './realtime-socket';
import type { MarketUpdate } from './types';

class FakeSocket implements RealtimeSocket {
  readonly sent: string[] = [];
  closed = false;
  private openCb?: () => void;
  private msgCb?: (data: string) => void;
  private closeCb?: () => void;
  private errCb?: (error: unknown) => void;

  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; }
  onOpen(cb: () => void): void { this.openCb = cb; }
  onMessage(cb: (data: string) => void): void { this.msgCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }
  onError(cb: (error: unknown) => void): void { this.errCb = cb; }

  emitOpen(): void { this.openCb?.(); }
  emit(payload: unknown): void { this.msgCb?.(typeof payload === 'string' ? payload : JSON.stringify(payload)); }
  emitClose(): void { this.closeCb?.(); }
  emitError(): void { this.errCb?.(new Error('drop')); }
  frames(): Array<Record<string, unknown>> { return this.sent.map((raw) => JSON.parse(raw)); }
}

function setup(overrides: { staleMs?: number; heartbeatMs?: number } = {}) {
  const sockets: FakeSocket[] = [];
  const pending: Array<() => void> = [];
  let clock = 1_000;
  const source = new WebSocketMarketSourceImpl({
    symbol: 'AAPL',
    url: 'wss://gw.example/ws',
    selection: { interval: '1m', session: 'regular', adjusted: false },
    createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    now: () => clock,
    random: () => 0,
    scheduler: (cb) => { pending.push(cb); return () => {}; },
    heartbeatMs: overrides.heartbeatMs ?? 0,
    staleMs: overrides.staleMs ?? 30_000,
  });
  const updates: MarketUpdate[] = [];
  source.subscribe((u) => updates.push(u));
  const flush = (): void => { pending.splice(0).forEach((cb) => cb()); };
  const advance = (ms: number): void => { clock += ms; };
  const connect = (socket: FakeSocket, realtime = true): void => {
    socket.emitOpen();
    socket.emit({ type: 'connected', feed: realtime ? 'iex' : 'test', realtime });
  };
  const tradeAt = (msIso: string, price: number) => ({ type: 'event', event: { kind: 'trade', symbol: 'AAPL', price, size: 10, timestampMs: Date.parse(msIso) } });
  return { source, sockets, updates, flush, advance, connect, tradeAt };
}

describe('WebSocketMarketSource lifecycle', () => {
  it('subscribes on connect and labels a live trade REAL-TIME · iex', () => {
    const { source, sockets, updates, connect, tradeAt } = setup();
    source.start();
    connect(sockets[0]);
    expect(sockets[0].frames().some((f) => f.type === 'subscribe' && Array.isArray(f.symbols))).toBe(true);
    expect(source.connectionState).toBe('open');

    sockets[0].emit(tradeAt('2024-01-02T15:04:05Z', 190.5));
    const last = updates[updates.length - 1];
    expect(last.price).toBe(190.5);
    expect(last.label.mode).toBe('REAL-TIME');
    expect(last.label.realtime).toBe(true);
    expect(last.label.feed).toBe('iex');
    expect(last.candle?.close).toBe(190.5);
  });

  it('never claims real-time for the test/FAKEPACA feed', () => {
    const { source, sockets, updates, connect, tradeAt } = setup();
    source.start();
    connect(sockets[0], false);
    sockets[0].emit(tradeAt('2024-01-02T15:04:05Z', 5));
    const last = updates[updates.length - 1];
    expect(last.label.realtime).toBe(false);
    expect(last.label.mode).not.toBe('REAL-TIME');
  });

  it('maps bid/ask separately and ignores an out-of-order quote', () => {
    const { source, sockets, updates, connect } = setup();
    source.start();
    connect(sockets[0]);
    sockets[0].emit({ type: 'event', event: { kind: 'quote', symbol: 'AAPL', bidPrice: 190.1, bidSize: 2, askPrice: 190.2, askSize: 3, timestampMs: 2_000 } });
    expect(updates[updates.length - 1]).toMatchObject({ bid: 190.1, ask: 190.2, bidSize: 2, askSize: 3 });
    // Older quote must not regress the book.
    sockets[0].emit({ type: 'event', event: { kind: 'quote', symbol: 'AAPL', bidPrice: 1, bidSize: 1, askPrice: 2, askSize: 1, timestampMs: 1_000 } });
    expect(updates[updates.length - 1]).toMatchObject({ bid: 190.1, ask: 190.2 });
  });

  it('reconciles an official bar into the same bucket and flags barFinalized', () => {
    const { source, sockets, updates, connect, tradeAt } = setup();
    source.start();
    connect(sockets[0]);
    sockets[0].emit(tradeAt('2024-01-02T15:04:05Z', 100));
    sockets[0].emit({ type: 'event', event: { kind: 'bar', symbol: 'AAPL', open: 100, high: 104, low: 99, close: 102, volume: 900, timestampMs: Date.parse('2024-01-02T15:04:00Z'), updated: false } });
    const last = updates[updates.length - 1];
    expect(last.candle).toMatchObject({ close: 102, volume: 900 });
    expect(last.barFinalized).toBe(true);
  });

  it('surfaces a per-symbol halt independently', () => {
    const { source, sockets, updates, connect } = setup();
    source.start();
    connect(sockets[0]);
    sockets[0].emit({ type: 'event', event: { kind: 'status', symbol: 'AAPL', statusCode: 'H', statusMessage: 'Halt', reasonMessage: 'News', timestampMs: 5_000, halted: true } });
    expect(updates[updates.length - 1]).toMatchObject({ halted: true, haltReason: 'News' });
  });

  it('reconnects with one attempt on drop and resubscribes on reconnect', () => {
    const { source, sockets, flush, connect } = setup();
    source.start();
    connect(sockets[0]);
    sockets[0].emitClose();
    expect(source.connectionState).toBe('connecting');
    flush();
    expect(sockets).toHaveLength(2);
    connect(sockets[1]);
    expect(sockets[1].frames().some((f) => f.type === 'subscribe')).toBe(true);
  });

  it('downgrades to STALE when the socket goes silent past the stale window', () => {
    const { source, sockets, updates, flush, advance, connect } = setup({ heartbeatMs: 5_000, staleMs: 10_000 });
    source.start();
    connect(sockets[0]);
    advance(11_000);
    flush(); // heartbeat tick detects staleness
    const last = updates[updates.length - 1];
    expect(last.label.realtime).toBe(false);
    expect(source.connectionState).not.toBe('open');
  });

  it('tears down fully on stop (Strict-Mode safe) and stops reconnecting', () => {
    const { source, sockets, flush, connect } = setup();
    source.start();
    connect(sockets[0]);
    source.stop();
    expect(sockets[0].closed).toBe(true);
    sockets[0].emitClose();
    flush();
    expect(sockets).toHaveLength(1); // no reconnect after stop
  });

  it('releases the socket when hidden and reconnects when shown', () => {
    const { source, sockets, connect } = setup();
    source.start();
    connect(sockets[0]);
    source.setVisible(false);
    expect(sockets[0].closed).toBe(true);
    source.setVisible(true);
    expect(sockets).toHaveLength(2);
  });
});
