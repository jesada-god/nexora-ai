import type { MarketDataApiError, Quote } from '@/src/lib/market-data/types';

/**
 * The market update source is deliberately transport-agnostic. Today only a
 * REST {@link PollingMarketSource} exists; the {@link WebSocketMarketSource}
 * type is a forward-looking contract with no production implementation because
 * the configured Polygon key is not entitled to the real-time WebSocket feed.
 * See the `polygon-ws-entitlement` memory. Nothing here may ever be labelled
 * REAL-TIME.
 */

/**
 * Truthful data-mode vocabulary. REAL-TIME is intentionally absent: the account
 * is not entitled to a live stream, so no code path may claim it.
 */
export type MarketDataMode =
  | 'DELAYED'
  | 'END-OF-DAY'
  | 'CACHED'
  | 'STALE'
  | 'UNAVAILABLE';

/**
 * Where the currently displayed price came from, in descending trust order:
 * an entitled `snapshot`, an accepted live `aggregate-fallback` close, or the
 * newest displayed `history-fallback` bar close (Daily/Week/Month, or any
 * selection when neither snapshot nor live aggregate is available).
 */
export type MarketPriceSource = 'snapshot' | 'aggregate-fallback' | 'history-fallback';

/** Regular trading session vs. a closed market, which drives the poll cadence. */
export type MarketSessionKind = 'regular' | 'closed';

/**
 * A single deterministic OHLCV bucket. `time` is the bucket start in unix
 * seconds and is the ordering key used to replace/append/ignore updates.
 */
export interface LiveCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Provenance for the currently displayed value. Always carries the provider,
 * the exchange (source) timestamp, when we received it and the derived delay
 * age so the UI can be honest about staleness.
 */
export interface MarketDataLabel {
  mode: MarketDataMode;
  provider: string | null;
  source: MarketPriceSource | null;
  /** Provider/exchange timestamp for the value (ISO-8601), if known. */
  exchangeTimestamp: string | null;
  /** When this client received/derived the value (ISO-8601). */
  receivedAt: string;
  /** receivedAt − exchangeTimestamp, in seconds, when both are known. */
  delayAgeSeconds: number | null;
  /** Human-facing note when a fallback path is in use. */
  fallbackNote: string | null;
}

/** The normalized snapshot the source emits to subscribers. */
export interface MarketUpdate {
  symbol: string;
  price: number | null;
  quote: Quote | null;
  candle: LiveCandle | null;
  label: MarketDataLabel;
  error: MarketDataApiError | null;
}

export type MarketUpdateListener = (update: MarketUpdate) => void;

/**
 * Normalized freshness statuses the transport may report. Mirrors the provider
 * freshness vocabulary minus `realtime`, which the label layer downgrades.
 */
export type TransportFreshness =
  | 'realtime'
  | 'delayed'
  | 'end-of-day'
  | 'cached'
  | 'stale'
  | 'unknown';

export interface SnapshotValue {
  quote: Quote;
  price: number;
  provider: string | null;
  status: TransportFreshness;
  asOf: string | null;
}

export interface AggregateValue {
  bars: LiveCandle[];
  provider: string | null;
  status: TransportFreshness;
  asOf: string | null;
}

/**
 * Structured transport outcome. Errors are surfaced (not thrown) so the engine
 * can route on entitlement (403), rate limits (429) and transient faults
 * without a try/catch treadmill.
 */
export type TransportOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: MarketDataApiError; retryAfterSeconds: number | null };

export interface SnapshotRequest {
  symbol: string;
  signal: AbortSignal;
}

export interface AggregateRequest {
  symbol: string;
  interval: string;
  session: string;
  /** Minimal chart-route-compatible range that still contains the newest bucket. */
  range: string;
  /** Split/dividend adjustment; part of the single-flight key. */
  adjusted: boolean;
  signal: AbortSignal;
}

/**
 * The pluggable REST/WS boundary. Each verified endpoint is a method so the
 * engine can probe capabilities independently and disable an endpoint once it
 * returns an entitlement error.
 */
export interface MarketSourceTransport {
  fetchSnapshot(request: SnapshotRequest): Promise<TransportOutcome<SnapshotValue>>;
  fetchAggregate(request: AggregateRequest): Promise<TransportOutcome<AggregateValue>>;
}

/** Effective polling cadence per session. */
export interface PollingCadence {
  /** Regular session interval; requirement mandates 10–15s. */
  regularMs: number;
  /** Slower cadence while the market is closed. */
  closedMs: number;
}

/**
 * Transport-agnostic market update source. Implementations own their own
 * lifecycle (timers, sockets) and single-flight guarantees.
 */
export interface MarketSource {
  readonly transport: 'polling' | 'websocket';
  /** Begin producing updates (idempotent). */
  start(): void;
  /** Stop producing updates and release timers/sockets (idempotent). */
  stop(): void;
  /** Pause when hidden, resume with exactly one request when shown. */
  setVisible(visible: boolean): void;
  /** Switch cadence between regular and closed sessions. */
  setSession(session: MarketSessionKind): void;
  /** Manual refresh: one request, joins an identical in-flight request. */
  refresh(): Promise<void>;
  /** Remaining rate-limit / backoff cooldown in ms (0 when clear). */
  cooldownRemainingMs(): number;
  /** Whether the entitled snapshot endpoint is still being polled. */
  isSnapshotEntitled(): boolean;
  subscribe(listener: MarketUpdateListener): () => void;
}

/**
 * Forward-looking contract for an entitled real-time stream. Declared for
 * future use only — there is deliberately NO production implementation, because
 * the configured provider key has no WebSocket entitlement. Do not instantiate.
 */
export interface WebSocketMarketSource extends MarketSource {
  readonly transport: 'websocket';
  /** Underlying socket connection state, once a real stream exists. */
  readonly connectionState: 'idle' | 'connecting' | 'open' | 'closed';
}
