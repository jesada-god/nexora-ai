import type { MarketDataApiError } from '@/src/lib/market-data/types';
import { mergeCandle, newestBar } from './candle-merge';
import {
  DEFAULT_FUTURE_TOLERANCE_SECONDS,
  isTradeablePrice,
  validateLiveCandle,
} from './candle-validation';
import { buildLabel, unavailableLabel } from './labels';
import {
  resolveMarketSourceConfig,
  type MarketSelection,
  type MarketSourceConfig,
} from './config';
import type {
  AggregateValue,
  LiveCandle,
  MarketSessionKind,
  MarketSource,
  MarketUpdate,
  MarketUpdateListener,
  MarketSourceTransport,
  PollingCadence,
  SnapshotValue,
  TransportOutcome,
} from './types';

export interface PollingMarketSourceOptions {
  symbol: string;
  transport: MarketSourceTransport;
  /** Aggregate interval used for the active candle + fallback price. */
  aggregateInterval?: string;
  /** Aggregate session (regular/extended) — part of the single-flight key. */
  aggregateSession?: string;
  /** Split/dividend adjustment — part of the single-flight key. */
  aggregateAdjusted?: boolean;
  /** Initial cadence class. */
  session?: MarketSessionKind;
  cadence?: PollingCadence;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (handle: number) => void;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

const DEFAULT_CADENCE: PollingCadence = { regularMs: 12_000, closedMs: 60_000 };
const AGGREGATE_FALLBACK_NOTE =
  'Latest displayed price derived from the newest verified aggregate bar (fallback).';

/** Provider outcomes that mean "stop asking this endpoint" (entitlement/auth/config). */
function isEntitlementError(error: MarketDataApiError): boolean {
  return error.code === 'forbidden'
    || error.code === 'provider-unauthorized'
    || error.code === 'provider-not-configured';
}

/**
 * REST polling market update source. Configurable by (symbol, interval, session,
 * adjusted): a single loop follows the current selection. Single-flight per
 * selection; pauses when hidden and resumes with exactly one request; routes on
 * endpoint capability (a snapshot entitlement error disables snapshot polling
 * for good and falls back to the newest aggregate bar); honors 429 Retry-After
 * and applies bounded exponential backoff to transient faults.
 *
 * On a selection change it aborts the previous generation, clears the
 * incompatible live candle and starts exactly one new loop — an older bucket can
 * never overwrite a newer candle, and a bucket from a superseded selection can
 * never enter the new series. History-only selections (daily/weekly/monthly) are
 * never rapid-polled; unsupported selections emit a typed unavailable and run no
 * loop. Nothing is fabricated, interpolated or forward-filled.
 */
export class PollingMarketSource implements MarketSource {
  readonly transport = 'polling' as const;

  private symbol: string;
  private readonly api: MarketSourceTransport;
  private readonly cadence: PollingCadence;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => number;
  private readonly clearTimer: (handle: number) => void;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  private config: MarketSourceConfig;

  private session: MarketSessionKind;
  private running = false;
  private visible = true;
  private snapshotEntitled = true;
  /** A non-retryable aggregate failure halts the automatic loop (no retry loop). */
  private fatal = false;
  private cooldownUntil = 0;
  private backoffAttempt = 0;

  private timerHandle: number | null = null;
  private inflight: Promise<void> | null = null;
  private generation = 0;
  private abort: AbortController | null = null;

  private activeCandle: LiveCandle | null = null;
  private lastAppliedTime: number | null = null;

  private readonly listeners = new Set<MarketUpdateListener>();

  constructor(options: PollingMarketSourceOptions) {
    this.symbol = options.symbol;
    this.api = options.transport;
    this.session = options.session ?? 'closed';
    this.cadence = options.cadence ?? DEFAULT_CADENCE;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs) as unknown as number);
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.baseBackoffMs = options.baseBackoffMs ?? 2_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.config = resolveMarketSourceConfig({
      interval: (options.aggregateInterval ?? '5m') as MarketSelection['interval'],
      session: (options.aggregateSession ?? 'regular') as MarketSelection['session'],
      adjusted: options.aggregateAdjusted ?? false,
    });
  }

  /** Stable single-flight identity: symbol + interval + session + adjusted. */
  get key(): string {
    return `${this.symbol}:${this.config.selectionKey}`;
  }

  subscribe(listener: MarketUpdateListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  isSnapshotEntitled(): boolean { return this.snapshotEntitled; }

  cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.fatal = false;
    this.beginCycle();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clearPendingTimer();
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!this.running) return;
    if (!visible) {
      // Pause the cadence. Any in-flight request is allowed to finish and emit
      // its result once; no new poll is scheduled while hidden.
      this.clearPendingTimer();
      return;
    }
    // Resume with exactly one request (unless one is already in flight or a
    // cooldown is active), then restore normal scheduling.
    if (this.inflight) return;
    if (!this.hasWork()) return;
    if (this.cooldownRemainingMs() > 0) { this.scheduleNext(); return; }
    void this.pollOnce().finally(() => this.scheduleNext());
  }

  setSession(session: MarketSessionKind): void {
    if (this.session === session) return;
    this.session = session;
    if (this.running && this.visible) this.scheduleNext();
  }

  /**
   * Switch the streamed selection. Deduplicates an identical selection, aborts
   * the previous generation, clears the incompatible live candle so no old
   * bucket can enter the new series, and starts exactly one new loop.
   */
  setSelection(selection: MarketSelection): void {
    const next = resolveMarketSourceConfig(selection);
    if (next.selectionKey === this.config.selectionKey) return;
    this.config = next;
    // Clear the incompatible live candle and its ordering guard: the new series
    // starts empty so a bucket from the previous selection can never appear in it.
    this.activeCandle = null;
    this.lastAppliedTime = null;
    // Abort the previous generation; drop the stale in-flight promise so the next
    // poll starts fresh instead of joining work for the old selection.
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.inflight = null;
    this.backoffAttempt = 0;
    this.fatal = false;
    this.clearPendingTimer();
    if (this.running) this.beginCycle();
  }

  /**
   * Switch the polled instrument in place: abort the previous generation, reset
   * all per-symbol state (candle, entitlement probe, backoff/cooldown) so the old
   * instrument's price or bucket can never enter the new series, and start exactly
   * one new loop for the new symbol.
   */
  setSymbol(symbol: string): void {
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    this.activeCandle = null;
    this.lastAppliedTime = null;
    this.snapshotEntitled = true;
    this.backoffAttempt = 0;
    this.cooldownUntil = 0;
    this.fatal = false;
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.inflight = null;
    this.clearPendingTimer();
    if (this.running) this.beginCycle();
  }

  refresh(): Promise<void> {
    // Join an identical request already in flight — exactly one network cycle.
    if (this.inflight) return this.inflight;
    // Nothing to fetch for this selection (unsupported, or history-only with no
    // entitled snapshot): emit the current typed state without a network cycle.
    if (!this.hasWork()) { this.emitConfigState(); return Promise.resolve(); }
    // Blocked by a rate-limit / backoff cooldown: caller surfaces the countdown.
    if (this.cooldownRemainingMs() > 0) return Promise.resolve();
    // A manual refresh gets one fresh attempt even after a fatal auto-stop.
    this.fatal = false;
    return this.pollOnce().finally(() => this.scheduleNext());
  }

  /** Begin the loop for the current selection: one poll now (if visible), then cadence. */
  private beginCycle(): void {
    if (!this.hasWork()) {
      // Unsupported / nothing to poll: emit one typed update and run no loop.
      this.emitConfigState();
      return;
    }
    if (this.visible) void this.pollOnce().finally(() => this.scheduleNext());
    else this.scheduleNext();
  }

  /** Whether the current selection has any endpoint worth polling. */
  private hasWork(): boolean {
    if (this.config.mode === 'unsupported') return false;
    if (this.config.pollsAggregate) return true;
    // History-only: the only rapid work left is the symbol snapshot for the header.
    return this.snapshotEntitled;
  }

  private pollOnce(): Promise<void> {
    if (this.inflight) return this.inflight;
    const operation = this.doPoll().finally(() => {
      if (this.inflight === operation) this.inflight = null;
    });
    this.inflight = operation;
    return operation;
  }

  private async doPoll(): Promise<void> {
    const generation = ++this.generation;
    const controller = new AbortController();
    this.abort = controller;
    const signal = controller.signal;

    const wantAggregate = this.config.pollsAggregate;
    const wantSnapshot = this.snapshotEntitled;

    const [aggOutcome, snapOutcome] = await Promise.all([
      wantAggregate ? this.safeAggregate(signal) : Promise.resolve(null),
      wantSnapshot ? this.safeSnapshot(signal) : Promise.resolve(null),
    ]);
    // Superseded by a newer poll, a stop, a selection change or a visibility
    // change: drop silently so no old bucket enters the current series.
    if (generation !== this.generation) return;

    const aggregate = aggOutcome && aggOutcome.ok ? aggOutcome.value : null;
    const snapshot = snapOutcome && snapOutcome.ok ? snapOutcome.value : null;

    // Capability routing: a snapshot entitlement error disables snapshot polling
    // permanently; transient snapshot errors are ignored (aggregate covers price).
    if (snapOutcome && !snapOutcome.ok && isEntitlementError(snapOutcome.error)) {
      this.snapshotEntitled = false;
    }

    // Validate the newest bar once, before it can drive the candle or the price.
    // A rejected bar (non-positive price, invalid OHLC, negative volume or a
    // future-dated bucket) is dropped: the previous accepted candle/price stands
    // and `lastAppliedTime` is never advanced by bad data.
    const acceptedBar = this.acceptedNewestBar(aggregate);
    const candle = this.applyCandle(acceptedBar);
    this.emitUpdate({ aggregate, snapshot, candle, acceptedBar, aggOutcome, snapOutcome });
    this.applyScheduleState({ aggregate, aggOutcome, snapOutcome });
  }

  private async safeAggregate(signal: AbortSignal): Promise<TransportOutcome<AggregateValue>> {
    try {
      return await this.api.fetchAggregate({
        symbol: this.symbol,
        interval: this.config.interval,
        session: this.config.session,
        range: this.config.aggregateRange ?? '1d',
        adjusted: this.config.adjusted,
        signal,
      });
    } catch (cause) {
      return this.abortSafe(cause);
    }
  }

  private async safeSnapshot(signal: AbortSignal): Promise<TransportOutcome<SnapshotValue>> {
    try {
      return await this.api.fetchSnapshot({ symbol: this.symbol, signal });
    } catch (cause) {
      return this.abortSafe(cause);
    }
  }

  private abortSafe<T>(cause: unknown): TransportOutcome<T> {
    const aborted = cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError');
    return {
      ok: false,
      error: {
        code: aborted ? 'timeout' : 'upstream-unavailable',
        message: cause instanceof Error ? cause.message : 'Market data request failed',
        retryable: true,
      },
      retryAfterSeconds: null,
    };
  }

  /**
   * The newest bar from an aggregate response, but only if it passes normalized-
   * event validation. An invalid bucket returns null so neither the candle nor
   * the fallback price is derived from it.
   */
  private acceptedNewestBar(aggregate: AggregateValue | null): LiveCandle | null {
    if (!aggregate) return null;
    const bar = newestBar(aggregate.bars);
    if (!bar) return null;
    const validation = validateLiveCandle(bar, {
      nowMs: this.now(),
      futureToleranceSeconds: DEFAULT_FUTURE_TOLERANCE_SECONDS,
    });
    return validation.ok ? bar : null;
  }

  private applyCandle(bar: LiveCandle | null): LiveCandle | null {
    if (bar) {
      const merged = mergeCandle(this.activeCandle, bar, this.lastAppliedTime);
      if (merged.applied && merged.candle) {
        this.activeCandle = merged.candle;
        this.lastAppliedTime = merged.candle.time;
      }
    }
    return this.activeCandle;
  }

  /** Emit the current typed state without a network request (unsupported / no-work). */
  private emitConfigState(): void {
    const receivedAt = new Date(this.now()).toISOString();
    const error: MarketDataApiError | null = this.config.mode === 'unsupported'
      ? { code: 'unsupported', message: this.config.reason ?? 'Selection is unsupported', retryable: false }
      : null;
    const update: MarketUpdate = {
      symbol: this.symbol,
      price: null,
      quote: null,
      candle: this.activeCandle,
      label: unavailableLabel(receivedAt),
      error,
    };
    for (const listener of this.listeners) listener(update);
  }

  private emitUpdate(input: {
    aggregate: AggregateValue | null;
    snapshot: SnapshotValue | null;
    candle: LiveCandle | null;
    acceptedBar: LiveCandle | null;
    aggOutcome: TransportOutcome<AggregateValue> | null;
    snapOutcome: TransportOutcome<SnapshotValue> | null;
  }): void {
    const receivedAt = new Date(this.now()).toISOString();
    const { aggregate, candle, acceptedBar } = input;
    // A snapshot is only usable when it carries a tradeable (finite, positive)
    // price; a 0/negative snapshot price falls through to the aggregate fallback.
    const snapshot = input.snapshot && isTradeablePrice(input.snapshot.price) ? input.snapshot : null;
    const aggregateBar = acceptedBar;

    let update: MarketUpdate;
    if (snapshot) {
      update = {
        symbol: this.symbol,
        price: snapshot.price,
        quote: snapshot.quote,
        candle,
        label: buildLabel({
          status: snapshot.status,
          hasPrice: true,
          provider: snapshot.provider,
          source: 'snapshot',
          exchangeTimestamp: snapshot.asOf,
          receivedAt,
        }),
        error: null,
      };
    } else if (aggregate && aggregateBar) {
      // Explicit, clearly-labelled fallback: newest verified aggregate close.
      update = {
        symbol: this.symbol,
        price: aggregateBar.close,
        quote: null,
        candle,
        label: buildLabel({
          status: aggregate.status,
          hasPrice: true,
          provider: aggregate.provider,
          source: 'aggregate-fallback',
          exchangeTimestamp: aggregate.asOf,
          receivedAt,
          fallbackNote: AGGREGATE_FALLBACK_NOTE,
        }),
        error: null,
      };
    } else {
      const error = this.resolveError(input.aggOutcome, input.snapOutcome);
      update = {
        symbol: this.symbol,
        price: null,
        quote: null,
        candle,
        label: unavailableLabel(receivedAt),
        error,
      };
    }

    for (const listener of this.listeners) listener(update);
  }

  private resolveError(
    aggOutcome: TransportOutcome<AggregateValue> | null,
    snapOutcome: TransportOutcome<SnapshotValue> | null,
  ): MarketDataApiError {
    if (aggOutcome && !aggOutcome.ok) return aggOutcome.error;
    if (snapOutcome && !snapOutcome.ok) return snapOutcome.error;
    return { code: 'upstream-unavailable', message: 'Market data is unavailable', retryable: true };
  }

  private applyScheduleState(input: {
    aggregate: AggregateValue | null;
    aggOutcome: TransportOutcome<AggregateValue> | null;
    snapOutcome: TransportOutcome<SnapshotValue> | null;
  }): void {
    let maxRetryAfter = -1;
    for (const outcome of [input.aggOutcome, input.snapOutcome]) {
      if (outcome && !outcome.ok && outcome.error.code === 'rate-limited') {
        const seconds = outcome.retryAfterSeconds ?? outcome.error.retryAfterSeconds ?? 30;
        if (seconds > maxRetryAfter) maxRetryAfter = seconds;
      }
    }

    if (maxRetryAfter >= 0) {
      // 429 → honor the longest Retry-After before the next request.
      this.cooldownUntil = this.now() + maxRetryAfter * 1_000;
      this.backoffAttempt = 0;
      return;
    }

    const anySuccess = Boolean(input.aggOutcome?.ok) || Boolean(input.snapOutcome?.ok);
    if (anySuccess) {
      // A clean response clears backoff and any cooldown.
      this.backoffAttempt = 0;
      this.cooldownUntil = 0;
      return;
    }

    // The primary endpoint for this selection: aggregate for intraday-live,
    // snapshot for history-only (header-only).
    const primary = this.config.pollsAggregate ? input.aggOutcome : input.snapOutcome;
    if (primary && !primary.ok && primary.error.retryable === false) {
      // 400/401/403/not-configured on the primary endpoint → no retry loop.
      this.fatal = true;
      return;
    }

    // Transient network/5xx/timeout → bounded exponential backoff.
    this.backoffAttempt += 1;
  }

  private nextDelayMs(): number {
    const base = this.session === 'regular' ? this.cadence.regularMs : this.cadence.closedMs;
    const cooldown = this.cooldownRemainingMs();
    if (cooldown > 0) return cooldown;
    if (this.backoffAttempt > 0) {
      const backoff = this.baseBackoffMs * 2 ** (this.backoffAttempt - 1);
      return Math.min(this.maxBackoffMs, Math.max(base, backoff));
    }
    return base;
  }

  private scheduleNext(): void {
    this.clearPendingTimer();
    if (!this.running || !this.visible || this.fatal) return;
    if (!this.hasWork()) return;
    this.timerHandle = this.setTimer(() => { this.timerHandle = null; this.tick(); }, this.nextDelayMs());
  }

  private tick(): void {
    if (!this.running || !this.visible || this.fatal) return;
    void this.pollOnce().finally(() => this.scheduleNext());
  }

  private clearPendingTimer(): void {
    if (this.timerHandle !== null) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = null;
    }
  }
}
