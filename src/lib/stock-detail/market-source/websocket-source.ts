import { isTradeablePrice } from './candle-validation';
import {
  LiveBucketStore,
  isRealtimeInterval,
  parseServerFrame,
  MARKET_CHANNELS,
  computeBackoffDelayMs,
  type NormalizedMarketEvent,
  type RealtimeInterval,
} from '@/src/lib/market-data/realtime';
import { buildRealtimeLabel } from './labels';
import type { MarketSelection } from './config';
import { browserSocketFactory, type RealtimeSocket, type RealtimeSocketFactory } from './realtime-socket';
import type {
  LiveCandle,
  MarketSessionKind,
  MarketUpdate,
  MarketUpdateListener,
  WebSocketMarketSource,
} from './types';

/**
 * Live market source backed by the Phase 12 Gateway.
 *
 * Connects ONLY to the Gateway (`NEXT_PUBLIC_MARKET_WS_URL`) — never to Alpaca,
 * and never with any Alpaca secret. Trade ticks fold into a client-side
 * {@link LiveBucketStore}; higher timeframes are aggregated locally so the active
 * candle updates without a refetch. Owns reconnection (exponential backoff + full
 * jitter, one attempt at a time), an application heartbeat + stale watchdog, and
 * a visibility lifecycle. `stop()` fully tears down (React Strict-Mode safe).
 *
 * Truthfulness: `REAL-TIME` / the `realtime` flag are set only while genuinely
 * connected to a live feed; a degraded (stale/reconnecting) socket downgrades to
 * `STALE`, so a stalled connection can never keep claiming real-time.
 */

export interface WebSocketMarketSourceOptions {
  symbol: string;
  url: string;
  selection?: MarketSelection;
  session?: MarketSessionKind;
  createSocket?: RealtimeSocketFactory;
  now?: () => number;
  random?: () => number;
  scheduler?: (callback: () => void, delayMs: number) => () => void;
  heartbeatMs?: number;
  staleMs?: number;
}

const DEFAULT_SELECTION: MarketSelection = { interval: '5m', session: 'regular', adjusted: false };
const defaultScheduler = (callback: () => void, delayMs: number): (() => void) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

export class WebSocketMarketSourceImpl implements WebSocketMarketSource {
  readonly transport = 'websocket' as const;

  private readonly symbol: string;
  private readonly url: string;
  private readonly createSocket: RealtimeSocketFactory;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly scheduler: (callback: () => void, delayMs: number) => () => void;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;

  private selection: MarketSelection;
  private session: MarketSessionKind;

  private readonly store = new LiveBucketStore();
  private readonly listeners = new Set<MarketUpdateListener>();

  private socket: RealtimeSocket | null = null;
  private state: 'idle' | 'connecting' | 'open' | 'closed' = 'idle';
  private running = false;
  private visible = true;
  private degraded = false;

  private attempt = 0;
  private reconnectPending = false;
  private nextReconnectAt = 0;
  private cancelReconnect: (() => void) | null = null;
  private cancelHeartbeat: (() => void) | null = null;
  private lastMessageAt = 0;

  private feed: string | null = null;
  private realtime = false;

  private lastPrice: number | null = null;
  private lastPriceMs = 0;
  private lastTradeIso: string | null = null;
  private bid: number | null | undefined;
  private ask: number | null | undefined;
  private bidSize: number | null | undefined;
  private askSize: number | null | undefined;
  private lastQuoteMs = 0;
  private quoteIso: string | null | undefined;
  private halted = false;
  private haltReason: string | null | undefined;

  constructor(options: WebSocketMarketSourceOptions) {
    this.symbol = options.symbol.toUpperCase();
    this.url = options.url;
    this.selection = options.selection ?? DEFAULT_SELECTION;
    this.session = options.session ?? 'regular';
    this.createSocket = options.createSocket ?? browserSocketFactory;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.staleMs = options.staleMs ?? 30_000;
  }

  get connectionState(): 'idle' | 'connecting' | 'open' | 'closed' {
    return this.state;
  }

  subscribe(listener: MarketUpdateListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  isSnapshotEntitled(): boolean { return true; }

  cooldownRemainingMs(): number {
    return Math.max(0, this.nextReconnectAt - this.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.visible) this.open();
  }

  stop(): void {
    this.running = false;
    this.teardownSocket();
    this.clearReconnect();
    this.clearHeartbeat();
    this.state = 'closed';
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!this.running) return;
    if (!visible) {
      // Hidden: release the socket to save resources; the coordinator may poll.
      this.teardownSocket();
      this.clearReconnect();
      this.clearHeartbeat();
      this.state = 'idle';
      this.degraded = true;
      this.emit(false);
      return;
    }
    // Shown again: reconnect (which resubscribes). The coordinator reconciles a
    // REST snapshot around this transition.
    this.attempt = 0;
    this.open();
  }

  setSession(session: MarketSessionKind): void {
    if (this.session === session) return;
    this.session = session;
    this.emit(false);
  }

  setSelection(selection: MarketSelection): void {
    if (
      selection.interval === this.selection.interval
      && selection.session === this.selection.session
      && selection.adjusted === this.selection.adjusted
    ) return;
    this.selection = selection;
    // Aggregation is client-side, so no resubscribe is needed: re-derive the
    // active candle for the new interval from the existing 1m buckets and emit.
    this.emit(false);
  }

  refresh(): Promise<void> {
    this.emit(false);
    return Promise.resolve();
  }

  /* ------------------------------- connection ------------------------------- */

  private open(): void {
    if (this.socket) return; // a live/pending socket already exists
    this.state = 'connecting';
    const socket = this.createSocket(this.url);
    this.socket = socket;
    socket.onOpen(() => { this.lastMessageAt = this.now(); });
    socket.onMessage((data) => this.handleMessage(data));
    socket.onClose(() => this.handleDrop());
    socket.onError(() => this.handleDrop());
  }

  private handleMessage(data: string): void {
    this.lastMessageAt = this.now();
    const frame = parseServerFrame(data);
    if (!frame) return;
    switch (frame.type) {
      case 'connected':
        this.feed = frame.feed;
        this.realtime = frame.realtime;
        this.attempt = 0;
        this.degraded = false;
        this.nextReconnectAt = 0;
        this.state = 'open';
        this.sendSubscribe();
        this.startHeartbeat();
        this.emit(false);
        break;
      case 'event':
        this.applyEvent(frame.event);
        break;
      case 'limit-exceeded':
      case 'subscribed':
      case 'pong':
      case 'error':
        break;
    }
  }

  private sendSubscribe(): void {
    this.socket?.send(JSON.stringify({ type: 'subscribe', symbols: [this.symbol], channels: [...MARKET_CHANNELS] }));
    console.info('[market-ws] subscribed', this.symbol);
  }

  private applyEvent(event: NormalizedMarketEvent): void {
    if (event.symbol !== this.symbol) return;
    let barFinalized = false;
    switch (event.kind) {
      case 'trade': {
        const result = this.store.applyTrade(event);
        if (result.applied && event.timestampMs >= this.lastPriceMs) {
          this.lastPrice = event.price;
          this.lastPriceMs = event.timestampMs;
          this.lastTradeIso = new Date(event.timestampMs).toISOString();
        }
        barFinalized = result.finalizedPrevious;
        break;
      }
      case 'quote': {
        // Ignore an out-of-order quote so bid/ask never regress to older data.
        if (event.timestampMs < this.lastQuoteMs) return;
        this.lastQuoteMs = event.timestampMs;
        this.bid = event.bidPrice;
        this.ask = event.askPrice;
        this.bidSize = event.bidSize;
        this.askSize = event.askSize;
        this.quoteIso = new Date(event.timestampMs).toISOString();
        break;
      }
      case 'bar': {
        // An official/updated 1m bar is only emitted after the minute closes, so
        // it always finalizes that bucket — the chart may recompute heavy S/R.
        this.store.applyBar(event);
        barFinalized = true;
        break;
      }
      case 'status': {
        this.halted = event.halted;
        this.haltReason = event.reasonMessage ?? event.statusMessage ?? null;
        break;
      }
    }
    this.emit(barFinalized);
  }

  private handleDrop(): void {
    this.teardownSocket();
    this.clearHeartbeat();
    if (!this.running || !this.visible) {
      this.state = 'idle';
      return;
    }
    this.degraded = true;
    this.state = 'connecting';
    this.emit(false);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectPending) return; // no overlapping reconnects
    this.reconnectPending = true;
    const delay = computeBackoffDelayMs(this.attempt, { random: this.random });
    this.attempt += 1;
    this.nextReconnectAt = this.now() + delay;
    this.cancelReconnect = this.scheduler(() => {
      this.reconnectPending = false;
      this.cancelReconnect = null;
      if (this.running && this.visible) this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatMs <= 0) return;
    this.clearHeartbeat();
    const tick = (): void => {
      if (!this.running || this.state !== 'open') return;
      if (this.now() - this.lastMessageAt >= this.staleMs) {
        // Silent socket: treat as stale and recycle through the reconnect path.
        this.degraded = true;
        this.socket?.close();
        this.handleDrop();
        return;
      }
      this.socket?.send(JSON.stringify({ type: 'ping', t: this.now() }));
      this.cancelHeartbeat = this.scheduler(tick, this.heartbeatMs);
    };
    this.cancelHeartbeat = this.scheduler(tick, this.heartbeatMs);
  }

  private teardownSocket(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private clearReconnect(): void {
    this.cancelReconnect?.();
    this.cancelReconnect = null;
    this.reconnectPending = false;
    this.nextReconnectAt = 0;
  }

  private clearHeartbeat(): void {
    this.cancelHeartbeat?.();
    this.cancelHeartbeat = null;
  }

  /* --------------------------------- emit ---------------------------------- */

  private activeCandle(): LiveCandle | null {
    const interval = this.selection.interval;
    if (!isRealtimeInterval(interval)) return null;
    return this.store.activeCandle(interval as RealtimeInterval);
  }

  private emit(barFinalized: boolean): void {
    const hasPrice = this.lastPrice !== null && isTradeablePrice(this.lastPrice);
    const receivedAt = new Date(this.now()).toISOString();
    const label = buildRealtimeLabel({
      realtime: this.realtime,
      feed: this.feed,
      hasPrice,
      exchangeTimestamp: this.lastTradeIso,
      receivedAt,
      degraded: this.degraded || this.state !== 'open',
    });
    const update: MarketUpdate = {
      symbol: this.symbol,
      price: hasPrice ? this.lastPrice : null,
      quote: null,
      candle: this.activeCandle(),
      label,
      error: null,
      bid: this.bid,
      ask: this.ask,
      bidSize: this.bidSize,
      askSize: this.askSize,
      quoteTimestamp: this.quoteIso,
      halted: this.halted,
      haltReason: this.haltReason,
      session: this.selection.session,
      barFinalized,
    };
    for (const listener of this.listeners) listener(update);
  }
}
