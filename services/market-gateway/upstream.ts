import {
  buildAuthFrame,
  buildSubscriptionFrame,
  channelOfEvent,
  classifyAlpacaControl,
  computeBackoffDelayMs,
  normalizeAlpacaMessage,
  type ChannelRef,
  type MarketChannel,
  type NormalizedMarketEvent,
} from '@/src/lib/market-data/realtime';
import { defaultScheduler, type Scheduler, type SocketLike } from './socket';

/**
 * The single upstream connection to Alpaca owned by one Gateway instance.
 *
 * Drives the handshake state machine (connect → authenticate → subscribe),
 * normalizes every market message before emitting it, and owns reconnection:
 * exponential backoff with full jitter (cap 30s), one pending reconnect at a
 * time, and a full resubscribe from the live registry snapshot once
 * re-authenticated. A stale-feed watchdog force-recycles a silent socket.
 *
 * CONNECTION GENERATION GUARD — every {@link open} mints a fresh generation
 * token. Each socket's open/message/close/error/ping/pong handler captures its
 * generation and no-ops unless it is still current. This is what makes reconnect
 * race-safe: a message delivered by a superseded socket can never authenticate,
 * resubscribe, or otherwise `send()` through the freshly-created (and possibly
 * still-CONNECTING) replacement socket.
 */

export type UpstreamState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'reconnecting'
  | 'stopped';

export interface UpstreamOptions {
  config: { url: string; keyId: string; secretKey: string };
  /** Opens a new transport to `config.url`. Injected so tests use fake sockets. */
  createSocket: (url: string) => SocketLike;
  /** Receives every normalized market event. */
  onEvent: (event: NormalizedMarketEvent) => void;
  /** The current live subscriptions to replay after a reconnect. */
  getSubscriptions: () => ChannelRef[];
  onStateChange?: (state: UpstreamState) => void;
  scheduler?: Scheduler;
  random?: () => number;
  now?: () => number;
  /** No message/heartbeat for this long → force reconnect. 0 disables it. */
  staleTimeoutMs?: number;
}

/**
 * Upper bound on the control-frame queue. Only auth/subscribe/unsubscribe
 * frames are ever queued (market events are emitted upward, never queued), so
 * this can only fill during a wedged handshake — dropping the oldest keeps
 * memory bounded rather than growing without limit.
 */
const MAX_OUTBOX = 64;

function groupByChannel(refs: ChannelRef[]): Partial<Record<MarketChannel, string[]>> {
  const grouped: Partial<Record<MarketChannel, string[]>> = {};
  for (const { symbol, channel } of refs) {
    (grouped[channel] ??= []).push(symbol);
  }
  return grouped;
}

export class UpstreamConnection {
  private socket: SocketLike | null = null;
  private state: UpstreamState = 'idle';
  /** Monotonic token identifying the current socket; bumped on every open(). */
  private generation = 0;
  private attempt = 0;
  private stopped = false;
  private reconnectPending = false;
  private cancelReconnect: (() => void) | null = null;
  private cancelStaleTimer: (() => void) | null = null;
  private lastMessageAt = 0;
  /** Bounded queue of control frames awaiting an OPEN socket of this generation. */
  private outbox: string[] = [];
  private readonly scheduler: Scheduler;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly options: UpstreamOptions) {
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  getState(): UpstreamState {
    return this.state;
  }

  getGeneration(): number {
    return this.generation;
  }

  /** Open the upstream and begin the handshake. Idempotent while active. */
  start(): void {
    this.stopped = false;
    if (
      this.state === 'connecting' ||
      this.state === 'authenticating' ||
      this.state === 'ready' ||
      this.state === 'reconnecting'
    ) {
      return; // a connect is already in flight — never open a second socket
    }
    this.open();
  }

  /** Intentional shutdown — cancels every timer and schedules no reconnect. */
  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    const socket = this.socket;
    this.teardownSocket();
    socket?.close();
    this.setState('stopped');
  }

  /** Subscribe the given pairs upstream (no-op unless authenticated). */
  subscribe(refs: ChannelRef[]): void {
    if (this.state !== 'ready' || refs.length === 0) return;
    this.enqueueControl(buildSubscriptionFrame('subscribe', groupByChannel(refs)));
  }

  /** Unsubscribe the given pairs upstream (no-op unless authenticated). */
  unsubscribe(refs: ChannelRef[]): void {
    if (this.state !== 'ready' || refs.length === 0) return;
    this.enqueueControl(buildSubscriptionFrame('unsubscribe', groupByChannel(refs)));
  }

  private open(): void {
    // Detach any lingering socket + drop its stale control frames BEFORE minting
    // the new generation, so nothing from the previous socket survives.
    this.teardownSocket();
    const generation = ++this.generation;
    this.setState('connecting');

    let socket: SocketLike;
    try {
      socket = this.options.createSocket(this.options.config.url);
    } catch (error) {
      // createSocket threw synchronously (bad URL, resource limit): treat as a
      // transient failure and retry with backoff rather than crashing.
      this.log('warn', generation, 'create-socket-failed', error);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    // Register error/close first so a synchronous failure is contained.
    socket.onError((error) => this.onDisconnect(generation, 'error', error));
    socket.onClose(() => this.onDisconnect(generation, 'close'));
    socket.onOpen(() => this.onOpen(generation, socket));
    socket.onMessage((data) => this.onUpstreamMessage(generation, data));
    socket.onPing(() => this.onHeartbeat(generation));
    socket.onPong(() => this.onHeartbeat(generation));
  }

  /** Is `generation` the socket the connection currently cares about? */
  private isCurrent(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  private onOpen(generation: number, socket: SocketLike): void {
    if (!this.isCurrent(generation)) return; // superseded socket opened late
    this.markAlive();
    this.armStaleTimer(generation);
    // Alpaca sends {"T":"success","msg":"connected"} first; auth follows that.
    // Anything queued while CONNECTING can flush now that the socket is OPEN.
    this.flushOutbox(socket);
  }

  private onHeartbeat(generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.markAlive();
  }

  private onUpstreamMessage(generation: number, data: string): void {
    if (!this.isCurrent(generation)) return; // ignore stale-socket messages
    this.markAlive();
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    // Alpaca frames arrive as arrays of messages.
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages) this.handleOne(generation, message);
  }

  private handleOne(generation: number, message: unknown): void {
    if (!this.isCurrent(generation)) return;
    const control = classifyAlpacaControl(message);
    if (control) {
      if (control.kind === 'success' && control.message === 'connected') {
        this.setState('authenticating');
        // authenticate is sent only after OPEN — enqueueControl guarantees it.
        this.enqueueControl(buildAuthFrame(this.options.config.keyId, this.options.config.secretKey));
      } else if (control.kind === 'success' && control.message === 'authenticated') {
        this.attempt = 0;
        this.setState('ready');
        // resubscribe happens only after authentication success.
        this.subscribe(this.options.getSubscriptions());
      } else if (control.kind === 'error') {
        // Distinguish a fatal auth/protocol error from a transient drop for the
        // operator's benefit; both still recycle with backoff so a redeploy of
        // corrected credentials can recover the process without a manual kick.
        const fatal = control.code === 401 || control.code === 402;
        this.log('error', generation, fatal ? 'fatal-auth-error' : 'protocol-error', {
          code: control.code,
          message: control.message,
        });
        this.recycle(generation);
      }
      return;
    }
    const event = normalizeAlpacaMessage(message);
    if (event) {
      // channelOfEvent keeps updatedBars distinct from bars for downstream fan-out.
      void channelOfEvent(event);
      this.options.onEvent(event);
    }
  }

  /**
   * Queue a control frame and flush what we can. Only OPEN sockets of the
   * current generation are written to; a CONNECTING/CLOSING socket holds the
   * frame until onOpen flushes it. Bounded so a stuck handshake cannot grow it.
   */
  private enqueueControl(frame: string): void {
    if (this.outbox.length >= MAX_OUTBOX) this.outbox.shift();
    this.outbox.push(frame);
    if (this.socket) this.flushOutbox(this.socket);
  }

  private flushOutbox(socket: SocketLike): void {
    if (socket !== this.socket || !socket.isOpen()) return;
    while (this.outbox.length > 0) {
      const frame = this.outbox[0];
      if (socket.send(frame) !== 'sent') break; // socket slipped out of OPEN
      this.outbox.shift();
    }
  }

  private onDisconnect(generation: number, reason: string, error?: unknown): void {
    // A stale socket's close/error must never drive reconnection.
    if (generation !== this.generation) return;
    this.log('warn', generation, `disconnect:${reason}`, error);
    this.teardownSocket();
    if (this.stopped) {
      this.setState('stopped');
      return;
    }
    this.scheduleReconnect();
  }

  /** Force-recycle the current socket through the normal reconnect path. */
  private recycle(generation: number): void {
    if (generation !== this.generation) return;
    const socket = this.socket;
    this.teardownSocket();
    socket?.close();
    if (this.stopped) {
      this.setState('stopped');
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectPending || this.stopped) return; // exactly one pending reconnect
    this.reconnectPending = true;
    this.setState('reconnecting');
    const delay = computeBackoffDelayMs(this.attempt, { random: this.random });
    this.attempt += 1;
    this.cancelReconnect = this.scheduler(() => {
      this.reconnectPending = false;
      this.cancelReconnect = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private armStaleTimer(generation: number): void {
    const timeout = this.options.staleTimeoutMs ?? 0;
    if (timeout <= 0) return;
    this.clearStaleTimer();
    const tick = (): void => {
      if (!this.isCurrent(generation) || this.socket === null) return;
      // Only a fully-ready socket can be judged stale. While connecting or
      // authenticating we never recycle — a slow handshake is not a dead feed,
      // and any real connect failure arrives as a close/error event instead.
      if (this.state !== 'ready') {
        this.cancelStaleTimer = this.scheduler(tick, timeout);
        return;
      }
      if (this.now() - this.lastMessageAt >= timeout) {
        // Silent socket past the deadline: recycle through the reconnect path.
        // Protocol ping/pong count as liveness (see onHeartbeat), so a quiet
        // FAKEPACA feed with no trades is NOT mistaken for a dead connection.
        this.log('warn', generation, 'stale-feed');
        this.recycle(generation);
        return;
      }
      this.cancelStaleTimer = this.scheduler(tick, timeout);
    };
    this.cancelStaleTimer = this.scheduler(tick, timeout);
  }

  private markAlive(): void {
    this.lastMessageAt = this.now();
  }

  /** Detach the current socket's listeners and drop its queued control frames. */
  private teardownSocket(): void {
    this.clearStaleTimer();
    this.outbox = [];
    const socket = this.socket;
    this.socket = null;
    socket?.detach();
  }

  private clearStaleTimer(): void {
    this.cancelStaleTimer?.();
    this.cancelStaleTimer = null;
  }

  private clearReconnect(): void {
    this.cancelReconnect?.();
    this.cancelReconnect = null;
    this.reconnectPending = false;
  }

  private setState(state: UpstreamState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }

  /** Structured log — deliberately never includes credentials. */
  private log(level: 'warn' | 'error', generation: number, reason: string, detail?: unknown): void {
    const base = `[gateway] upstream ${reason} gen=${generation} state=${this.state}`;
    const extra = detail instanceof Error ? detail.message : detail;
    if (extra === undefined) console[level](base);
    else console[level](base, extra);
  }
}
