import { describe, expect, it } from 'vitest';
import { FAKEPACA_SYMBOL, MarketTracer, type ChannelRef } from '@/src/lib/market-data/realtime';
import { GatewayHub } from './hub';
import { UpstreamConnection } from './upstream';
import type { Scheduler, SendResult, SocketLike } from './socket';

/**
 * End-to-end Gateway behaviour driven by fully deterministic fake sockets. This
 * mirrors the Alpaca `/v2/test` (FAKEPACA) sandbox handshake and message flow
 * WITHOUT opening a real connection, so the suite never touches a production
 * stream. It exercises: handshake, fan-out, reference counting, the 30-symbol
 * cap, and reconnect → resubscribe.
 */

/** ws-style readyState the fake models so send()/isOpen() are realistic. */
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

class FakeSocket implements SocketLike {
  readonly sent: string[] = [];
  /** How many protocol pings the watchdog has sent through this socket. */
  pinged = 0;
  closed = false;
  readyState = CONNECTING;
  detached = false;
  private openCb?: () => void;
  private msgCb?: (data: string) => void;
  private closeCb?: () => void;
  private errCb?: (error: unknown) => void;
  private pingCb?: () => void;
  private pongCb?: () => void;

  send(data: string): SendResult {
    // Mirror the real adapter: a non-OPEN socket drops instead of throwing.
    if (this.readyState !== OPEN) return 'dropped';
    this.sent.push(data);
    return 'sent';
  }
  isOpen(): boolean { return this.readyState === OPEN; }
  ping(): void { if (this.readyState === OPEN) this.pinged += 1; }
  close(): void { this.closed = true; this.readyState = CLOSED; }
  detach(): void { this.detached = true; this.openCb = this.msgCb = this.closeCb = this.errCb = this.pingCb = this.pongCb = undefined; }
  onOpen(cb: () => void): void { this.openCb = cb; }
  onMessage(cb: (data: string) => void): void { this.msgCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }
  onError(cb: (error: unknown) => void): void { this.errCb = cb; }
  onPing(cb: () => void): void { this.pingCb = cb; }
  onPong(cb: () => void): void { this.pongCb = cb; }

  emitOpen(): void { this.readyState = OPEN; this.openCb?.(); }
  emitMessage(payload: unknown): void {
    this.msgCb?.(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }
  emitClose(): void { this.readyState = CLOSED; this.closeCb?.(); }
  emitError(error: unknown): void { this.errCb?.(error); }
  emitPing(): void { this.pingCb?.(); }
  emitPong(): void { this.pongCb?.(); }

  frames(): Array<Record<string, unknown>> { return this.sent.map((raw) => JSON.parse(raw)); }
  framesOfType(type: string): Array<Record<string, unknown>> {
    return this.frames().filter((frame) => frame.type === type);
  }
  upstreamActions(action: string): Array<Record<string, unknown>> {
    return this.frames().filter((frame) => frame.action === action);
  }
}

function setup() {
  const upstreamSockets: FakeSocket[] = [];
  const pending: Array<() => void> = [];
  const scheduler: Scheduler = (cb) => { pending.push(cb); return () => {}; };
  const flush = (): void => { const drained = pending.splice(0); drained.forEach((cb) => cb()); };

  let upstream!: UpstreamConnection;
  const hub = new GatewayHub({
    feed: 'test',
    realtime: false,
    applySubscribe: (refs) => upstream.subscribe(refs),
    applyUnsubscribe: (refs) => upstream.unsubscribe(refs),
  });
  upstream = new UpstreamConnection({
    config: { url: 'wss://stream.data.alpaca.markets/v2/test', keyId: 'k', secretKey: 's' },
    createSocket: () => { const socket = new FakeSocket(); upstreamSockets.push(socket); return socket; },
    onEvent: (event) => hub.handleUpstreamEvent(event),
    getSubscriptions: () => hub.subscriptionSnapshot(),
    scheduler,
    random: () => 0,
  });

  /** Drive the Alpaca handshake to the authenticated/ready state. */
  const authenticate = (socket: FakeSocket): void => {
    socket.emitOpen();
    socket.emitMessage({ T: 'success', msg: 'connected' });
    socket.emitMessage({ T: 'success', msg: 'authenticated' });
  };

  return { hub, upstream, upstreamSockets, flush, authenticate };
}

function connectClient(hub: GatewayHub): FakeSocket {
  const socket = new FakeSocket();
  socket.emitOpen(); // an accepted server-side peer is already OPEN
  hub.addClient(socket);
  return socket;
}

function fakepacaTrade(price: number) {
  return { T: 't', S: FAKEPACA_SYMBOL, p: price, s: 5, t: '2024-01-02T15:04:05Z' };
}

describe('Gateway handshake and fan-out', () => {
  it('authenticates upstream then greets clients honestly (realtime=false for test feed)', () => {
    const { hub, upstream, upstreamSockets, authenticate } = setup();
    upstream.start();
    const socket = upstreamSockets[0];
    socket.emitOpen();
    socket.emitMessage({ T: 'success', msg: 'connected' });
    expect(socket.frames().some((frame) => frame.action === 'auth' && frame.key === 'k')).toBe(true);
    socket.emitMessage({ T: 'success', msg: 'authenticated' });
    expect(upstream.getState()).toBe('ready');

    const client = connectClient(hub);
    expect(client.framesOfType('connected')[0]).toMatchObject({ feed: 'test', realtime: false });
    void authenticate;
  });

  it('subscribes upstream on first interest and fans the FAKEPACA trade out', () => {
    const { hub, upstream, upstreamSockets, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);
    const upstreamSocket = upstreamSockets[0];

    const client = connectClient(hub);
    client.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades'] });
    expect(upstreamSocket.upstreamActions('subscribe')[0]).toMatchObject({ trades: [FAKEPACA_SYMBOL] });
    expect(client.framesOfType('subscribed')[0]).toMatchObject({ symbols: [FAKEPACA_SYMBOL] });

    upstreamSocket.emitMessage(fakepacaTrade(100));
    const event = client.framesOfType('event')[0];
    expect(event).toMatchObject({ type: 'event', event: { kind: 'trade', symbol: FAKEPACA_SYMBOL, price: 100 } });
  });
});

describe('Gateway reference counting and fan-out', () => {
  it('subscribes upstream once for two clients and fans out to both', () => {
    const { hub, upstream, upstreamSockets, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);
    const upstreamSocket = upstreamSockets[0];

    const c1 = connectClient(hub);
    const c2 = connectClient(hub);
    c1.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades'] });
    c2.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades'] });
    expect(upstreamSocket.upstreamActions('subscribe')).toHaveLength(1); // only the 0→1 transition

    upstreamSocket.emitMessage(fakepacaTrade(101));
    expect(c1.framesOfType('event')).toHaveLength(1);
    expect(c2.framesOfType('event')).toHaveLength(1);
  });

  it('unsubscribes upstream only when the last client leaves', () => {
    const { hub, upstream, upstreamSockets, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);
    const upstreamSocket = upstreamSockets[0];

    const c1 = connectClient(hub);
    const c2 = connectClient(hub);
    c1.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades'] });
    c2.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades'] });

    c1.emitClose();
    expect(upstreamSocket.upstreamActions('unsubscribe')).toHaveLength(0);
    c2.emitClose();
    expect(upstreamSocket.upstreamActions('unsubscribe')[0]).toMatchObject({ trades: [FAKEPACA_SYMBOL] });
  });

  it('enforces the 30-symbol cap and tells the client what was rejected', () => {
    const { hub, upstream, upstreamSockets, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);

    const client = connectClient(hub);
    const symbols = Array.from({ length: 31 }, (_, index) => `SYM${index}`);
    client.emitMessage({ type: 'subscribe', symbols, channels: ['trades'] });
    const limit = client.framesOfType('limit-exceeded')[0];
    expect(limit).toMatchObject({ limit: 30 });
    expect((limit.rejected as string[])).toHaveLength(1);
    expect((limit.accepted as string[])).toHaveLength(30);
  });

  it('answers a client ping with a pong echoing the timestamp', () => {
    const { hub, upstream, upstreamSockets, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);
    const client = connectClient(hub);
    client.emitMessage({ type: 'ping', t: 12345 });
    expect(client.framesOfType('pong')[0]).toMatchObject({ t: 12345 });
  });

  it('rate-limits per-client subscription churn but never the liveness ping', () => {
    const upstreamSockets: FakeSocket[] = [];
    const pending: Array<() => void> = [];
    const scheduler: Scheduler = (cb) => { pending.push(cb); return () => {}; };
    let upstream!: UpstreamConnection;
    // Allow exactly two subscribe/unsubscribe frames per client.
    const hub = new GatewayHub({
      feed: 'test',
      realtime: false,
      applySubscribe: (refs) => upstream.subscribe(refs),
      applyUnsubscribe: (refs) => upstream.unsubscribe(refs),
      createRateLimiter: () => { let n = 0; return { tryAcquire: () => (n++ < 2) }; },
    });
    upstream = new UpstreamConnection({
      config: { url: 'wss://stream.data.alpaca.markets/v2/test', keyId: 'k', secretKey: 's' },
      createSocket: () => { const socket = new FakeSocket(); upstreamSockets.push(socket); return socket; },
      onEvent: (event) => hub.handleUpstreamEvent(event),
      getSubscriptions: () => hub.subscriptionSnapshot(),
      scheduler,
      random: () => 0,
    });
    upstream.start();
    upstreamSockets[0].emitOpen();
    upstreamSockets[0].emitMessage({ T: 'success', msg: 'connected' });
    upstreamSockets[0].emitMessage({ T: 'success', msg: 'authenticated' });

    const client = connectClient(hub);
    client.emitMessage({ type: 'subscribe', symbols: ['AAPL'], channels: ['trades'] });
    client.emitMessage({ type: 'subscribe', symbols: ['MSFT'], channels: ['trades'] });
    client.emitMessage({ type: 'subscribe', symbols: ['NVDA'], channels: ['trades'] }); // over the limit

    expect(client.framesOfType('subscribed')).toHaveLength(2);
    const error = client.framesOfType('error')[0];
    expect(error).toMatchObject({ code: 'rate-limited', retryable: true });

    // A ping is still answered while the client is throttled.
    client.emitMessage({ type: 'ping', t: 7 });
    expect(client.framesOfType('pong')[0]).toMatchObject({ t: 7 });
  });
});

describe('Gateway reconnect and resubscribe', () => {
  it('reconnects with backoff and resubscribes live interest from the registry snapshot', () => {
    const { hub, upstream, upstreamSockets, flush, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);

    const client = connectClient(hub);
    client.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades', 'quotes'] });

    // Upstream drops.
    upstreamSockets[0].emitClose();
    expect(upstream.getState()).toBe('reconnecting');

    // Backoff fires → a fresh socket is opened and re-authenticated.
    flush();
    expect(upstreamSockets).toHaveLength(2);
    authenticate(upstreamSockets[1]);

    const resubscribe = upstreamSockets[1].upstreamActions('subscribe')[0];
    expect(resubscribe).toMatchObject({ trades: [FAKEPACA_SYMBOL], quotes: [FAKEPACA_SYMBOL] });
  });

  it('does not schedule overlapping reconnects', () => {
    const { upstream, upstreamSockets, flush, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);

    upstreamSockets[0].emitClose();
    upstreamSockets[0].emitError(new Error('boom')); // second failure must not double-schedule
    flush();
    expect(upstreamSockets).toHaveLength(2); // exactly one reconnect, not two
  });
});

describe('Gateway reconnect race safety', () => {
  it('does not send an old socket message through the new (CONNECTING) socket', () => {
    const { upstream, upstreamSockets, flush, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);
    const stale = upstreamSockets[0];

    // Drop → reconnect. The superseded socket must be detached, and the fresh
    // socket is still CONNECTING (never emitOpen'd here).
    stale.emitClose();
    flush();
    const fresh = upstreamSockets[1];
    expect(upstreamSockets).toHaveLength(2);
    expect(stale.detached).toBe(true);
    expect(fresh.isOpen()).toBe(false);

    // A late frame from the OLD socket must not authenticate through the NEW one.
    expect(() => {
      stale.emitMessage({ T: 'success', msg: 'connected' });
      stale.emitMessage(fakepacaTrade(123));
    }).not.toThrow();
    expect(fresh.sent).toHaveLength(0);
    expect(fresh.upstreamActions('auth')).toHaveLength(0);
  });

  it('never throws when a control frame is produced while CONNECTING', () => {
    const { upstream, upstreamSockets } = setup();
    upstream.start();
    const socket = upstreamSockets[0]; // CONNECTING — not opened yet

    // 'connected' arriving before OPEN queues auth instead of throwing.
    expect(() => socket.emitMessage({ T: 'success', msg: 'connected' })).not.toThrow();
    expect(socket.sent).toHaveLength(0);
  });

  it('authenticates only after the socket is OPEN', () => {
    const { upstream, upstreamSockets } = setup();
    upstream.start();
    const socket = upstreamSockets[0];

    socket.emitMessage({ T: 'success', msg: 'connected' }); // still CONNECTING
    expect(socket.upstreamActions('auth')).toHaveLength(0);

    socket.emitOpen(); // now OPEN → queued auth flushes
    expect(socket.upstreamActions('auth')).toHaveLength(1);
  });

  it('resubscribes only after authentication success', () => {
    const { hub, upstream, upstreamSockets, flush, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);
    const client = connectClient(hub);
    client.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades'] });

    upstreamSockets[0].emitClose();
    flush();
    const fresh = upstreamSockets[1];

    fresh.emitOpen();
    fresh.emitMessage({ T: 'success', msg: 'connected' }); // authenticating
    expect(fresh.upstreamActions('subscribe')).toHaveLength(0); // not before auth ok

    fresh.emitMessage({ T: 'success', msg: 'authenticated' });
    expect(fresh.upstreamActions('subscribe')).toHaveLength(1);
  });

  it('ignores handlers from a superseded generation after reconnect', () => {
    const { upstream, upstreamSockets, flush, authenticate } = setup();
    upstream.start();
    const gen1 = upstream.getGeneration();
    authenticate(upstreamSockets[0]);

    upstreamSockets[0].emitClose();
    flush();
    expect(upstream.getGeneration()).toBe(gen1 + 1);

    // Old socket close/error after the new generation exists is inert.
    expect(() => {
      upstreamSockets[0].emitClose();
      upstreamSockets[0].emitError(new Error('late'));
    }).not.toThrow();
    expect(upstreamSockets).toHaveLength(2); // no extra reconnect from stale events
  });

  it('survives 20 reconnect rounds without crashing and stays ready', () => {
    const { upstream, upstreamSockets, flush, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);

    expect(() => {
      for (let round = 0; round < 20; round += 1) {
        const current = upstreamSockets[upstreamSockets.length - 1];
        current.emitClose();
        flush();
        authenticate(upstreamSockets[upstreamSockets.length - 1]);
      }
    }).not.toThrow();

    expect(upstreamSockets).toHaveLength(21);
    expect(upstream.getState()).toBe('ready');
  });

  it('stop() cancels reconnect and opens no further sockets', () => {
    const { upstream, upstreamSockets, flush, authenticate } = setup();
    upstream.start();
    authenticate(upstreamSockets[0]);

    upstream.stop();
    expect(upstream.getState()).toBe('stopped');

    upstreamSockets[0].emitClose(); // must not schedule a reconnect
    flush();
    expect(upstreamSockets).toHaveLength(1);
  });

  it('bounds the control queue and flushes it once OPEN', () => {
    const { upstream, upstreamSockets } = setup();
    upstream.start();
    const socket = upstreamSockets[0]; // CONNECTING

    // Overfill the outbox while the socket cannot accept writes.
    for (let i = 0; i < 100; i += 1) socket.emitMessage({ T: 'success', msg: 'connected' });
    expect(socket.sent).toHaveLength(0); // nothing sent while CONNECTING

    socket.emitOpen(); // flush
    expect(socket.sent.length).toBeGreaterThan(0);
    expect(socket.sent.length).toBeLessThanOrEqual(64); // bounded
    expect(socket.frames().every((frame) => frame.action === 'auth')).toBe(true);
  });

});

/**
 * The liveness watchdog and the connection-limit-safe reconnect backoff — the
 * two behaviours behind the Railway 406 / stale-feed reconnect loop. A
 * delay-aware fake scheduler lets each timer (heartbeat=interval, pong=timeout,
 * reconnect=backoff) be fired independently and asserts cancellation actually
 * happens, none of which a "run everything" scheduler could prove.
 */
describe('Gateway liveness watchdog and backoff', () => {
  interface Task { cb: () => void; delay: number; done: boolean }

  function makeWatchdog(
    options: { getSubscriptions?: () => ChannelRef[]; heartbeatIntervalMs?: number; pongTimeoutMs?: number } = {},
  ) {
    let clock = 0;
    const sockets: FakeSocket[] = [];
    const tasks: Task[] = [];
    const scheduler: Scheduler = (cb, delay) => {
      const task: Task = { cb, delay, done: false };
      tasks.push(task);
      return () => { task.done = true; };
    };
    /** Fire every currently-pending timer whose delay matches, exactly once. */
    const runDelay = (delay: number): void => {
      for (const task of tasks.filter((t) => !t.done && t.delay === delay)) { task.done = true; task.cb(); }
    };
    /** Fire everything still pending, exactly once each. */
    const runAll = (): void => {
      for (const task of tasks.filter((t) => !t.done)) { task.done = true; task.cb(); }
    };
    const pending = (delay?: number): Task[] =>
      tasks.filter((t) => !t.done && (delay === undefined || t.delay === delay));
    const upstream = new UpstreamConnection({
      config: { url: 'wss://stream.data.alpaca.markets/v2/test', keyId: 'k', secretKey: 's' },
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      onEvent: () => {},
      getSubscriptions: options.getSubscriptions ?? (() => [{ symbol: 'AAPL', channel: 'trades' }]),
      scheduler,
      random: () => 0,
      now: () => clock,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
      pongTimeoutMs: options.pongTimeoutMs ?? 10_000,
    });
    const authenticate = (socket: FakeSocket): void => {
      socket.emitOpen();
      socket.emitMessage({ T: 'success', msg: 'connected' });
      socket.emitMessage({ T: 'success', msg: 'authenticated' });
    };
    return { upstream, sockets, tasks, runDelay, runAll, pending, authenticate, setClock: (v: number) => { clock = v; } };
  }

  it('backs off (never sub-second) after a 406 connection-limit rejection', () => {
    const { upstream, sockets, tasks, authenticate } = makeWatchdog();
    upstream.start();
    authenticate(sockets[0]);

    sockets[0].emitMessage({ T: 'error', code: 406, msg: 'connection limit exceeded' });
    expect(upstream.getState()).toBe('reconnecting');

    const reconnects = tasks.filter((t) => !t.done);
    expect(reconnects).toHaveLength(1); // exactly one reconnect timer, heartbeat canceled
    expect(reconnects[0].delay).toBeGreaterThanOrEqual(2_500); // equal jitter floor, not a hot loop
    expect(reconnects[0].delay).toBeLessThanOrEqual(5_000);
    expect(sockets).toHaveLength(1); // no new socket opened until the delay elapses
  });

  it('keeps exactly one reconnect timer when several failures arrive together', () => {
    const { upstream, sockets, pending, authenticate } = makeWatchdog();
    upstream.start();
    authenticate(sockets[0]);

    sockets[0].emitClose();
    sockets[0].emitError(new Error('boom')); // must not double-schedule
    expect(pending()).toHaveLength(1);
    expect(upstream.getState()).toBe('reconnecting');
  });

  it('does not reconnect a quiet market while the protocol pong still answers', () => {
    const { upstream, sockets, runDelay, setClock, authenticate } = makeWatchdog();
    upstream.start();
    authenticate(sockets[0]);
    const socket = sockets[0];

    setClock(20_000); // past the 15s silent-wire interval
    runDelay(15_000); // heartbeat tick → active probe ping
    expect(socket.pinged).toBe(1);

    socket.emitPong(); // the feed is alive, merely quiet
    runDelay(10_000); // pong-timeout check
    expect(upstream.getState()).toBe('ready'); // NOT recycled
    expect(sockets).toHaveLength(1);
  });

  it('reconnects exactly once when a probe ping is never answered', () => {
    const { upstream, sockets, runDelay, pending, setClock, authenticate } = makeWatchdog();
    upstream.start();
    authenticate(sockets[0]);
    const socket = sockets[0];

    setClock(20_000);
    runDelay(15_000); // heartbeat tick → probe ping
    expect(socket.pinged).toBe(1);

    setClock(30_000); // no pong arrives
    runDelay(10_000); // pong-timeout check → genuine failure → recycle
    expect(upstream.getState()).toBe('reconnecting');
    expect(socket.closed).toBe(true);
    expect(pending()).toHaveLength(1); // just the single reconnect timer

    runDelay(pending()[0].delay); // fire the backoff
    expect(sockets).toHaveLength(2); // exactly one new socket
    expect(socket.pinged).toBe(1); // never pinged in a loop
  });

  it('never probes or reconnects when zero symbols are desired, however quiet', () => {
    const { upstream, sockets, runDelay, setClock, authenticate } = makeWatchdog({ getSubscriptions: () => [] });
    upstream.start();
    authenticate(sockets[0]);
    const socket = sockets[0];

    setClock(60_000);
    runDelay(15_000); // heartbeat tick with zero desired symbols
    setClock(120_000);
    runDelay(15_000); // and again, much later

    expect(socket.pinged).toBe(0); // market silence never provokes a probe
    expect(upstream.getState()).toBe('ready');
    expect(sockets).toHaveLength(1); // no reconnect
  });

  it('cancels a superseded generation watchdog timer so it cannot recycle the fresh socket', () => {
    const { upstream, sockets, runDelay, runAll, pending, setClock, authenticate } = makeWatchdog();
    upstream.start();
    authenticate(sockets[0]);
    const stale = sockets[0];

    setClock(20_000);
    runDelay(15_000); // gen1 probe → a pong-timeout timer is armed for gen1
    expect(stale.pinged).toBe(1);
    expect(pending(10_000)).toHaveLength(1);

    stale.emitClose(); // gen1 tears down → its watchdog timers are canceled
    expect(pending(10_000)).toHaveLength(0); // the stale pong timer is gone

    runDelay(2_500); // backoff → fresh gen2 socket
    const fresh = sockets[1];
    authenticate(fresh);

    runAll(); // fire everything still pending — nothing may recycle gen2
    expect(upstream.getState()).toBe('ready');
    expect(fresh.closed).toBe(false);
    expect(sockets).toHaveLength(2);
  });

  it('stop() closes the socket and cancels every watchdog timer', () => {
    const { upstream, sockets, pending, runAll, authenticate } = makeWatchdog();
    upstream.start();
    authenticate(sockets[0]);
    const socket = sockets[0];
    expect(pending()).not.toHaveLength(0); // a heartbeat is armed

    upstream.stop();
    expect(upstream.getState()).toBe('stopped');
    expect(socket.closed).toBe(true);
    expect(pending()).toHaveLength(0); // every timer canceled

    runAll();
    expect(sockets).toHaveLength(1); // nothing left to open a socket
  });
});

describe('Gateway end-to-end tracing', () => {
  /** Wire a capturing tracer into both the upstream and the hub. */
  function setupTraced() {
    const lines: string[] = [];
    // sampleIntervalMs 0 + a fixed clock → high-volume stages are never suppressed,
    // so a single test trade deterministically produces one line per hop.
    const tracer = new MarketTracer({ sink: (line) => lines.push(line), now: () => 0, sampleIntervalMs: 0 });
    const upstreamSockets: FakeSocket[] = [];
    let upstream!: UpstreamConnection;
    const hub = new GatewayHub({
      feed: 'test',
      realtime: false,
      applySubscribe: (refs) => upstream.subscribe(refs),
      applyUnsubscribe: (refs) => upstream.unsubscribe(refs),
      tracer,
    });
    upstream = new UpstreamConnection({
      config: { url: 'wss://stream.data.alpaca.markets/v2/test', keyId: 'k', secretKey: 's' },
      createSocket: () => { const socket = new FakeSocket(); upstreamSockets.push(socket); return socket; },
      onEvent: (event) => hub.handleUpstreamEvent(event),
      getSubscriptions: () => hub.subscriptionSnapshot(),
      random: () => 0,
      tracer,
    });
    const authenticate = (socket: FakeSocket): void => {
      socket.emitOpen();
      socket.emitMessage({ T: 'success', msg: 'connected' });
      socket.emitMessage({ T: 'success', msg: 'authenticated' });
    };
    return { hub, upstream, upstreamSockets, tracer, lines, authenticate };
  }

  it('traces subscribe_sent when a client acquires the first interest', () => {
    const { hub, upstream, upstreamSockets, lines, authenticate } = setupTraced();
    upstream.start();
    authenticate(upstreamSockets[0]);
    const client = connectClient(hub);
    client.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades', 'quotes'] });
    const line = lines.find((l) => l.includes('upstream_subscribe_sent'));
    expect(line).toContain(`symbol=${FAKEPACA_SYMBOL}`);
    expect(line).toMatch(/channels=.*trades/);
  });

  it('traces the Alpaca subscription ack (what is actually subscribed)', () => {
    const { upstream, upstreamSockets, lines, authenticate } = setupTraced();
    upstream.start();
    authenticate(upstreamSockets[0]);
    upstreamSockets[0].emitMessage({ T: 'subscription', trades: [FAKEPACA_SYMBOL], quotes: [FAKEPACA_SYMBOL] });
    const line = lines.find((l) => l.includes('upstream_subscribed'));
    expect(line).toContain(`symbol=${FAKEPACA_SYMBOL}`);
    expect(line).toMatch(/channels=.*trades/);
  });

  it('traces every hop of a market trade: received → normalized → broadcast', () => {
    const { hub, upstream, upstreamSockets, lines, authenticate } = setupTraced();
    upstream.start();
    authenticate(upstreamSockets[0]);
    const client = connectClient(hub);
    client.emitMessage({ type: 'subscribe', symbols: [FAKEPACA_SYMBOL], channels: ['trades'] });

    upstreamSockets[0].emitMessage(fakepacaTrade(100));

    expect(lines.some((l) => l.startsWith('[market-trace] upstream_market_event_received') && l.includes('type=t'))).toBe(true);
    expect(lines.some((l) => l.includes('gateway_market_event_normalized') && l.includes('type=trade'))).toBe(true);
    expect(lines.some((l) => l.includes('gateway_market_event_broadcast') && l.includes('clients=1'))).toBe(true);
  });

  it('traces a broadcast with clients=0 (live event for a symbol nobody wants)', () => {
    const { upstream, upstreamSockets, lines, authenticate } = setupTraced();
    upstream.start();
    authenticate(upstreamSockets[0]);
    // No client subscribed → the fan-out has zero listeners; the trace still fires.
    upstreamSockets[0].emitMessage(fakepacaTrade(100));
    expect(lines.some((l) => l.includes('gateway_market_event_broadcast') && l.includes('clients=0'))).toBe(true);
  });

  it('traces received-but-not-normalized when a tick fails schema validation', () => {
    const { upstream, upstreamSockets, lines, authenticate } = setupTraced();
    upstream.start();
    authenticate(upstreamSockets[0]);
    // A trade with a non-positive price is received but dropped by the schema, so
    // it must appear as received without a matching normalized line.
    upstreamSockets[0].emitMessage({ T: 't', S: FAKEPACA_SYMBOL, p: 0, s: 5, t: '2024-01-02T15:04:05Z' });
    expect(lines.some((l) => l.includes('upstream_market_event_received') && l.includes('type=t'))).toBe(true);
    expect(lines.some((l) => l.includes('gateway_market_event_normalized'))).toBe(false);
  });
});
