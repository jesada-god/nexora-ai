import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireMarketConnection,
  __activeMarketConnectionsForTest,
  __resetMarketConnectionsForTest,
  type AcquireMarketConnectionParams,
  type ManagedMarketSource,
} from './market-connection-manager';

const WS_URL = 'wss://loving-growth-production-0965.up.railway.app/ws';
const SELECTION = { interval: '1m', session: 'regular', adjusted: false } as const;
const CADENCE = { regularMs: 12_000, closedMs: 60_000 };

function fakeSource() {
  const calls: string[] = [];
  let started = false;
  const source: ManagedMarketSource = {
    transport: 'websocket',
    start() { started = true; calls.push('start'); },
    stop() { started = false; calls.push('stop'); },
    setVisible(v) { calls.push(`visible:${v}`); },
    setSession() { calls.push('session'); },
    setSelection() { calls.push('selection'); },
    setSymbol(s) { calls.push(`symbol:${s}`); },
    refresh() { return Promise.resolve(); },
    cooldownRemainingMs() { return 0; },
    isSnapshotEntitled() { return true; },
    subscribe() { return () => {}; },
  };
  return { source, calls, isStarted: () => started };
}

/** A controllable grace scheduler: nothing fires until `flush()`. */
function makeScheduler() {
  const pending: Array<{ cb: () => void; cancelled: boolean }> = [];
  const scheduler = (cb: () => void): (() => void) => {
    const item = { cb, cancelled: false };
    pending.push(item);
    return () => { item.cancelled = true; };
  };
  const flush = (): void => {
    for (const item of pending.splice(0)) if (!item.cancelled) item.cb();
  };
  return { scheduler, flush };
}

function harness() {
  const created: ReturnType<typeof fakeSource>[] = [];
  const { scheduler, flush } = makeScheduler();
  const acquire = (overrides: Partial<AcquireMarketConnectionParams> = {}) =>
    acquireMarketConnection({
      wsUrl: WS_URL,
      symbol: 'RKLB',
      transport: {} as never,
      session: 'regular',
      selection: SELECTION,
      cadence: CADENCE,
      visible: true,
      scheduler,
      createSource: () => { const f = fakeSource(); created.push(f); return f.source; },
      ...overrides,
    });
  return { created, flush, acquire };
}

afterEach(() => { __resetMarketConnectionsForTest(); vi.restoreAllMocks(); });

describe('market connection manager', () => {
  it('creates one shared source and sets visibility before starting it', () => {
    const { created, acquire } = harness();
    acquire();
    expect(created).toHaveLength(1);
    // Visibility must be applied before start() so a hidden tab never opens a socket.
    expect(created[0].calls).toEqual(['visible:true', 'start']);
    expect(__activeMarketConnectionsForTest()).toBe(1);
  });

  it('shares a single source across two subscribers (Overview + Chart)', () => {
    const { created, acquire } = harness();
    acquire();
    acquire();
    expect(created).toHaveLength(1);
    expect(__activeMarketConnectionsForTest()).toBe(1);
  });

  it('cancels the scheduled close when a subscriber returns within the grace window', () => {
    const { created, flush, acquire } = harness();
    const h1 = acquire();
    h1.release('transient-unmount'); // refCount 0 → close scheduled (not yet run)
    const h2 = acquire();            // returns within grace → cancels the close
    flush();                          // any surviving timer would fire here
    expect(created[0].isStarted()).toBe(true); // socket was never torn down
    expect(created).toHaveLength(1);            // and never re-created
    expect(__activeMarketConnectionsForTest()).toBe(1);
    h2.release('done');
  });

  it('tears the socket down only after the grace window with no subscribers', () => {
    const { created, flush, acquire } = harness();
    const h1 = acquire();
    h1.release('permanent-unmount');
    expect(created[0].isStarted()).toBe(true); // still alive during grace
    flush();                                    // grace elapses, no subscriber returned
    expect(created[0].isStarted()).toBe(false);
    expect(__activeMarketConnectionsForTest()).toBe(0);
  });

  it('reuses the SAME source across a mount→release→remount (Strict-Mode) cycle', () => {
    const { created, flush, acquire } = harness();
    const h1 = acquire();      // mount
    h1.release('cleanup');     // Strict-Mode cleanup: refCount 0, close scheduled
    const h2 = acquire();      // remount: cancels close, reuses source
    flush();
    expect(created).toHaveLength(1);
    expect(created[0].isStarted()).toBe(true);
    h2.release('final');
    flush();
    expect(created[0].isStarted()).toBe(false); // torn down only once truly idle
  });

  it('ignores a stale release so it cannot stop a freshly-created connection', () => {
    const { created, acquire } = harness();
    const stale = acquire();            // generation 1
    __resetMarketConnectionsForTest();  // dispose gen 1 out from under the stale handle
    const fresh = acquire();            // generation 2 — a brand new source
    expect(created).toHaveLength(2);
    stale.release('late-cleanup');      // must NOT touch the new connection
    expect(created[1].isStarted()).toBe(true);
    expect(__activeMarketConnectionsForTest()).toBe(1);
    fresh.release('done');
  });

  it('emits the required lifecycle diagnostics', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { flush, acquire } = harness();
    const h1 = acquire();
    h1.release('unmount');
    const h2 = acquire();   // cancels close
    h2.release('unmount');
    flush();                // executes close
    const messages = info.mock.calls.map((c) => String(c[0]));
    expect(messages).toContain('[market-ws] acquire subscriber=1');
    expect(messages.some((m) => m.startsWith('[market-ws] release subscriber=0 reason='))).toBe(true);
    expect(messages).toContain('[market-ws] close-scheduled');
    expect(messages).toContain('[market-ws] close-cancelled');
    expect(messages).toContain('[market-ws] close-executed');
  });

  it('does not close a still-referenced connection when only one of two subscribers leaves', () => {
    const { created, flush, acquire } = harness();
    const h1 = acquire();
    const h2 = acquire();
    h1.release('one-consumer-left');
    flush(); // no close should have been scheduled (refCount is still 1)
    expect(created[0].isStarted()).toBe(true);
    h2.release('last-consumer-left');
    flush();
    expect(created[0].isStarted()).toBe(false);
  });
});
