import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollingMarketSource } from './polling-source';
import type {
  AggregateValue,
  LiveCandle,
  MarketSourceTransport,
  MarketUpdate,
  SnapshotValue,
  TransportOutcome,
} from './types';

const CADENCE = { regularMs: 12_000, closedMs: 60_000 };

function bar(time: number, close: number): LiveCandle {
  return { time, open: close, high: close, low: close, close, volume: 100 };
}

function aggregateOk(
  bars: LiveCandle[],
  status: AggregateValue['status'] = 'delayed',
): TransportOutcome<AggregateValue> {
  return { ok: true, value: { bars, provider: 'polygon', status, asOf: '2026-07-21T13:00:00.000Z' } };
}

function snapshotOk(price: number, status: SnapshotValue['status'] = 'delayed'): TransportOutcome<SnapshotValue> {
  return {
    ok: true,
    value: {
      quote: {
        symbol: 'RKLB', price, open: price, high: price, low: price,
        previousClose: price, change: 0, changePercent: 0, volume: 1, latestTradingDay: '2026-07-21', currency: 'USD',
      },
      price,
      provider: 'polygon',
      status,
      asOf: '2026-07-21T13:00:00.000Z',
    },
  };
}

function forbidden<T>(): TransportOutcome<T> {
  return { ok: false, error: { code: 'forbidden', message: 'not entitled', retryable: false }, retryAfterSeconds: null };
}

function rateLimited<T>(retryAfterSeconds: number): TransportOutcome<T> {
  return { ok: false, error: { code: 'rate-limited', message: 'slow down', retryable: true, retryAfterSeconds }, retryAfterSeconds };
}

interface Harness {
  transport: MarketSourceTransport;
  snapshot: ReturnType<typeof vi.fn>;
  aggregate: ReturnType<typeof vi.fn>;
  updates: MarketUpdate[];
  source: PollingMarketSource;
}

function makeHarness(overrides?: {
  snapshot?: () => Promise<TransportOutcome<SnapshotValue>>;
  aggregate?: () => Promise<TransportOutcome<AggregateValue>>;
  session?: 'regular' | 'closed';
}): Harness {
  const snapshot = vi.fn(overrides?.snapshot ?? (async () => snapshotOk(50)));
  const aggregate = vi.fn(overrides?.aggregate ?? (async () => aggregateOk([bar(100, 42)])));
  const transport: MarketSourceTransport = {
    fetchSnapshot: snapshot as unknown as MarketSourceTransport['fetchSnapshot'],
    fetchAggregate: aggregate as unknown as MarketSourceTransport['fetchAggregate'],
  };
  const updates: MarketUpdate[] = [];
  const source = new PollingMarketSource({
    symbol: 'RKLB',
    transport,
    session: overrides?.session ?? 'regular',
    cadence: CADENCE,
  });
  source.subscribe((update) => updates.push(update));
  return { transport, snapshot, aggregate, updates, source };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('PollingMarketSource', () => {
  it('disables future snapshot polling after a 403 entitlement error', async () => {
    const { source, snapshot, aggregate } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
    });
    source.start();
    await flush();

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(source.isSnapshotEntitled()).toBe(false);

    await vi.advanceTimersByTimeAsync(CADENCE.regularMs);
    expect(snapshot).toHaveBeenCalledTimes(1); // never called again
    expect(aggregate).toHaveBeenCalledTimes(2);

    source.stop();
  });

  it('falls back to the newest aggregate bar for the displayed price', async () => {
    const { source, updates } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => aggregateOk([bar(90, 41), bar(100, 42.5)], 'delayed'),
    });
    source.start();
    await flush();

    const last = updates.at(-1)!;
    expect(last.price).toBe(42.5);
    expect(last.label.source).toBe('aggregate-fallback');
    expect(last.label.mode).toBe('DELAYED');
    expect(last.label.fallbackNote).toContain('fallback');
    expect(last.error).toBeNull();

    source.stop();
  });

  it('pauses polling while the tab is hidden', async () => {
    const { source, aggregate } = makeHarness();
    source.start();
    await flush();
    expect(aggregate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CADENCE.regularMs);
    expect(aggregate).toHaveBeenCalledTimes(2);

    source.setVisible(false);
    await vi.advanceTimersByTimeAsync(CADENCE.regularMs * 5);
    expect(aggregate).toHaveBeenCalledTimes(2); // no polling while hidden

    source.stop();
  });

  it('resumes with exactly one request', async () => {
    const { source, aggregate } = makeHarness();
    source.start();
    await flush();
    source.setVisible(false);
    await vi.advanceTimersByTimeAsync(CADENCE.regularMs * 3);
    const before = aggregate.mock.calls.length;

    source.setVisible(true);
    await flush();
    expect(aggregate.mock.calls.length).toBe(before + 1); // exactly one

    source.stop();
  });

  it('coalesces a concurrent timer poll and manual refresh into one fetch', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = () => resolve(); });
    const { source, aggregate } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => { await gate; return aggregateOk([bar(100, 42)]); },
    });
    source.start(); // immediate (automatic) poll begins and stays in flight
    expect(aggregate).toHaveBeenCalledTimes(1);

    void source.refresh(); // manual refresh joins the in-flight poll
    expect(aggregate).toHaveBeenCalledTimes(1); // still one fetch

    release!();
    await flush();
    expect(aggregate).toHaveBeenCalledTimes(1);

    source.stop();
  });

  it('never labels realtime or end-of-day data as REAL-TIME', async () => {
    const realtime = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => aggregateOk([bar(100, 42)], 'realtime'),
    });
    realtime.source.start();
    await flush();
    expect(realtime.updates.at(-1)!.label.mode).toBe('DELAYED');
    expect(realtime.updates.at(-1)!.label.mode).not.toBe('REAL-TIME');
    realtime.source.stop();

    const endOfDay = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => aggregateOk([bar(100, 42)], 'end-of-day'),
    });
    endOfDay.source.start();
    await flush();
    expect(endOfDay.updates.at(-1)!.label.mode).toBe('END-OF-DAY');
    endOfDay.source.stop();
  });

  it('does not let a stale aggregate overwrite a newer candle', async () => {
    let phase = 0;
    const { source, updates } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => {
        phase += 1;
        return phase === 1
          ? aggregateOk([bar(200, 12)])       // newest bucket t=200
          : aggregateOk([bar(100, 99)]);      // late, older bucket t=100
      },
    });
    source.start();
    await flush();
    expect(updates.at(-1)!.candle?.time).toBe(200);

    await vi.advanceTimersByTimeAsync(CADENCE.regularMs);
    const last = updates.at(-1)!;
    expect(last.candle?.time).toBe(200);   // unchanged
    expect(last.candle?.close).toBe(12);   // not overwritten by the stale 99

    source.stop();
  });

  it('emits the header price and the chart candle from one accepted event', async () => {
    // A single emission feeds both the header and the chart, so they can never
    // diverge onto two different market events.
    const { source, updates } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => aggregateOk([bar(100, 42.5)]),
    });
    source.start();
    await flush();

    expect(updates).toHaveLength(1);
    const only = updates[0];
    expect(only.price).toBe(42.5);          // header price
    expect(only.candle?.close).toBe(42.5);  // chart current candle — same event
    expect(only.candle?.time).toBe(100);

    source.stop();
  });

  it('runs a single polling loop — one aggregate request per cadence tick', async () => {
    const { source, aggregate } = makeHarness({ snapshot: async () => forbidden<SnapshotValue>() });
    source.start();
    await flush();
    expect(aggregate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CADENCE.regularMs);
    expect(aggregate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(CADENCE.regularMs);
    expect(aggregate).toHaveBeenCalledTimes(3); // exactly one loop, never two

    source.stop();
  });

  it('switching selection (5m→1m) drops the previous generation and isolates candles', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = () => resolve(); });
    let phase = 0;
    const { source, updates } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => {
        phase += 1;
        if (phase === 1) { await gate; return aggregateOk([bar(100, 42)]); } // slow 5m
        return aggregateOk([bar(500, 7)]);                                    // fast 1m
      },
    });
    source.start();                                                            // 5m poll begins, stuck on gate

    source.setSelection({ interval: '1m', session: 'regular', adjusted: false });
    await flush();                                                             // exactly one new (1m) loop resolves
    expect(updates.at(-1)!.candle?.time).toBe(500);

    release!();                                                                // the late 5m response arrives now
    await flush();
    // The superseded 5m bucket (t=100) is never applied to the 1m series.
    expect(updates.at(-1)!.candle?.time).toBe(500);
    expect(updates.every((update) => update.candle?.time !== 100)).toBe(true);

    source.stop();
  });

  it('resets the live candle on a regular→extended switch so sessions never mix', async () => {
    let phase = 0;
    const { source, updates } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => {
        phase += 1;
        return phase === 1
          ? aggregateOk([bar(500, 42)])   // regular bucket t=500
          : aggregateOk([bar(200, 9)]);   // extended bucket t=200 (older start)
      },
    });
    source.start();
    await flush();
    expect(updates.at(-1)!.candle?.time).toBe(500);

    source.setSelection({ interval: '5m', session: 'extended', adjusted: false });
    await flush();
    // Without the reset, t=200 < lastAppliedTime(500) would be rejected as stale
    // and the regular bucket would linger (mixing sessions). The reset starts the
    // extended series clean at its own bucket.
    const last = updates.at(-1)!;
    expect(last.candle?.time).toBe(200);
    expect(last.candle?.close).toBe(9);

    source.stop();
  });

  it('does not rapid-poll the aggregate/history for a daily (history-only) selection', async () => {
    const { source, aggregate } = makeHarness();
    source.start();
    await flush();
    aggregate.mockClear();

    source.setSelection({ interval: '1D', session: 'regular', adjusted: false });
    await flush();
    await vi.advanceTimersByTimeAsync(CADENCE.regularMs * 3);
    // The header snapshot may still refresh, but the daily aggregate is never polled.
    expect(aggregate).not.toHaveBeenCalled();

    source.stop();
  });

  it('emits a typed unavailable and runs no loop for an unsupported selection', async () => {
    const { source, updates, aggregate, snapshot } = makeHarness();
    source.start();
    await flush();
    aggregate.mockClear();
    snapshot.mockClear();
    updates.length = 0;

    source.setSelection({ interval: '1D', session: 'extended', adjusted: false });
    const emitted = updates.at(-1)!;
    expect(emitted.price).toBeNull();
    expect(emitted.label.mode).toBe('UNAVAILABLE');
    expect(emitted.error?.code).toBe('unsupported');
    expect(emitted.error?.retryable).toBe(false);

    await vi.advanceTimersByTimeAsync(CADENCE.regularMs * 3);
    expect(aggregate).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();

    source.stop();
  });

  it('manual refresh issues exactly one request and coalesces a concurrent refresh', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = () => resolve(); });
    const { source, aggregate } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => { await gate; return aggregateOk([bar(100, 42)]); },
    });
    // Not started: a manual refresh drives exactly one poll.
    const first = source.refresh();
    expect(aggregate).toHaveBeenCalledTimes(1);
    void source.refresh();                     // joins the in-flight request
    expect(aggregate).toHaveBeenCalledTimes(1);

    release!();
    await first;
    await flush();
    expect(aggregate).toHaveBeenCalledTimes(1);

    source.stop();
  });

  it('deduplicates an identical selection switch (no abort, no extra request)', async () => {
    const { source, aggregate } = makeHarness({ snapshot: async () => forbidden<SnapshotValue>() });
    source.start();
    await flush();
    expect(aggregate).toHaveBeenCalledTimes(1);

    // Re-selecting the same 5m/regular selection is a no-op: no new loop.
    source.setSelection({ interval: '5m', session: 'regular', adjusted: false });
    await flush();
    expect(aggregate).toHaveBeenCalledTimes(1);

    source.stop();
  });

  it('rejects a future-dated bucket so it cannot poison the candle', async () => {
    // A far-future bucket (t≈now+1h) must not be applied — otherwise its time
    // would advance lastAppliedTime past every legitimate later bar.
    const futureTime = Math.floor(Date.now() / 1_000) + 3_600;
    const validTime = Math.floor(Date.now() / 1_000) - 300;
    let phase = 0;
    const { source, updates } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => {
        phase += 1;
        return phase === 1
          ? aggregateOk([bar(validTime, 42)])       // legitimate current bucket
          : aggregateOk([bar(futureTime, 999)]);    // poisoned future bucket
      },
    });
    source.start();
    await flush();
    expect(updates.at(-1)!.candle?.time).toBe(validTime);
    expect(updates.at(-1)!.price).toBe(42);

    await vi.advanceTimersByTimeAsync(CADENCE.regularMs);
    const last = updates.at(-1)!;
    expect(last.candle?.time).toBe(validTime); // future bucket rejected
    expect(last.candle?.close).toBe(42);       // not overwritten by the poisoned 999
    expect(last.price).not.toBe(999);          // price never derives from a rejected bar

    source.stop();
  });

  it('rejects a non-positive aggregate price rather than surfacing it', async () => {
    const time = Math.floor(Date.now() / 1_000) - 300;
    const { source, updates } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => aggregateOk([bar(time, 0)]), // zero close — not tradeable
    });
    source.start();
    await flush();

    const last = updates.at(-1)!;
    expect(last.price).toBeNull();               // rejected, no bogus 0 price
    expect(last.candle).toBeNull();              // no candle from an invalid bar
    expect(last.label.mode).toBe('UNAVAILABLE');

    source.stop();
  });

  it('honors Retry-After after a 429 before polling again', async () => {
    const { source, aggregate } = makeHarness({
      snapshot: async () => forbidden<SnapshotValue>(),
      aggregate: async () => rateLimited<AggregateValue>(45),
    });
    source.start();
    await flush();
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(source.cooldownRemainingMs()).toBeGreaterThan(40_000);

    // The regular cadence would fire at 12s, but the cooldown must win.
    await vi.advanceTimersByTimeAsync(CADENCE.regularMs);
    expect(aggregate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(45_000 - CADENCE.regularMs);
    expect(aggregate).toHaveBeenCalledTimes(2);

    source.stop();
  });
});
