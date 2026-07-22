import { createMarketSource } from './coordinator';
import type { MarketSelection } from './config';
import type { RealtimeSocketFactory } from './realtime-socket';
import type {
  MarketSessionKind,
  MarketSource,
  MarketSourceTransport,
  PollingCadence,
} from './types';

/**
 * Tab-wide singleton registry for the live market connection.
 *
 * Every consumer of the live stream (the header/Overview and the Chart both read
 * from one {@link useMarketSource} today, but a Strict-Mode remount, a fast
 * re-navigation or any future second consumer would otherwise each open their own
 * socket) shares exactly ONE {@link MarketSource} per Gateway URL per browser tab.
 *
 * Why this exists — the production 1006 bug:
 *   React mounts an effect, the socket starts CONNECTING, then the effect is torn
 *   down (Strict-Mode double-invoke, a transient re-render, a focus/visibility
 *   blur while DevTools is focused) BEFORE the WebSocket finished its handshake.
 *   Calling `close()` on a CONNECTING socket makes the browser log "WebSocket is
 *   closed before the connection is established" and drop it with code 1006, so
 *   the app socket never survived to receive `connected`/`subscribed` — even
 *   though a raw hand-rolled socket to the same URL connected fine.
 *
 * The fix is a reference-counted connection with a short close grace period:
 *   - acquire() hands back the shared source and bumps the subscriber count.
 *   - release() decrements it; when it reaches zero the socket is NOT closed
 *     immediately — a {@link GRACE_MS} timer is armed. A subscriber returning
 *     within the grace window (the remount) cancels the timer, so the same live
 *     socket is reused and the handshake is never interrupted.
 *   - Only a genuine teardown — no subscribers after the grace window, a
 *     `pagehide`/`beforeunload`, or an explicit reset — actually stops the source.
 *
 * A per-entry generation guard makes a late/stale release from a previous
 * connection a no-op so it can never stop a freshly-created one that reused the
 * same URL key.
 */

/** Grace window before a zero-subscriber connection is actually torn down. */
export const GRACE_MS = 750;

/** A market source that may additionally follow selection/symbol changes in place. */
export type ManagedMarketSource = MarketSource & {
  setSelection?: (selection: MarketSelection) => void;
  setSymbol?: (symbol: string) => void;
};

export interface AcquireMarketConnectionParams {
  /** Gateway URL (null → REST-only). The connection is keyed by this per tab. */
  wsUrl: string | null;
  symbol: string;
  transport: MarketSourceTransport;
  session: MarketSessionKind;
  selection: MarketSelection;
  cadence: PollingCadence;
  /** Initial visibility, applied before `start()` so a hidden tab never opens a socket. */
  visible: boolean;
  createSocket?: RealtimeSocketFactory;
  /** Test seam: build the shared source (defaults to {@link createMarketSource}). */
  createSource?: (params: AcquireMarketConnectionParams) => ManagedMarketSource;
  /** Test seam: schedule the grace-period close (defaults to `setTimeout`). */
  scheduler?: (callback: () => void, delayMs: number) => () => void;
}

export interface MarketConnectionHandle {
  /** The shared source. Drive selection/symbol/session/visibility through it. */
  readonly source: ManagedMarketSource;
  /** Drop this subscriber; arms the grace-period close when it was the last one. */
  release(reason: string): void;
}

interface ConnectionEntry {
  key: string;
  source: ManagedMarketSource;
  refCount: number;
  /** Bumped every time a NEW entry takes a key, so stale handles can be ignored. */
  generation: number;
  cancelClose: (() => void) | null;
  disposed: boolean;
}

const connections = new Map<string, ConnectionEntry>();
let generationCounter = 0;
let unloadHooked = false;

/** Secret-free lifecycle diagnostics (the Gateway URL is public, no credential is logged). */
function log(message: string): void {
  console.info(`[market-ws] ${message}`);
}

const defaultScheduler = (callback: () => void, delayMs: number): (() => void) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

function defaultCreateSource(params: AcquireMarketConnectionParams): ManagedMarketSource {
  return createMarketSource({
    symbol: params.symbol,
    transport: params.transport,
    session: params.session,
    selection: params.selection,
    cadence: params.cadence,
    wsUrl: params.wsUrl,
    createSocket: params.createSocket,
  }) as ManagedMarketSource;
}

/** Close every live connection on tab teardown so a socket never leaks past unload. */
function ensureUnloadHook(): void {
  if (unloadHooked || typeof window === 'undefined') return;
  unloadHooked = true;
  const disposeAll = (): void => {
    for (const entry of [...connections.values()]) hardClose(entry);
  };
  window.addEventListener('pagehide', disposeAll);
  window.addEventListener('beforeunload', disposeAll);
}

function scheduleClose(
  entry: ConnectionEntry,
  scheduler: (callback: () => void, delayMs: number) => () => void,
): void {
  if (entry.cancelClose || entry.disposed) return;
  log('close-scheduled');
  entry.cancelClose = scheduler(() => {
    entry.cancelClose = null;
    // A subscriber returned during the grace window, or the entry was already
    // disposed (unload/reset): in either case there is nothing to close here.
    if (entry.refCount > 0 || entry.disposed) return;
    hardClose(entry);
  }, GRACE_MS);
}

function hardClose(entry: ConnectionEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  entry.cancelClose?.();
  entry.cancelClose = null;
  entry.source.stop();
  if (connections.get(entry.key) === entry) connections.delete(entry.key);
  log('close-executed');
}

/**
 * Acquire the tab-shared market connection for `wsUrl`. Reuses a live connection
 * (cancelling any pending grace-period close) or creates and starts a new one.
 * The caller MUST call {@link MarketConnectionHandle.release} exactly once on
 * cleanup.
 */
export function acquireMarketConnection(params: AcquireMarketConnectionParams): MarketConnectionHandle {
  ensureUnloadHook();
  const key = params.wsUrl ?? 'rest-only';
  const scheduler = params.scheduler ?? defaultScheduler;

  let entry = connections.get(key);
  if (entry) {
    if (entry.cancelClose) {
      // A subscriber returned before the socket was actually torn down: keep the
      // live socket (and its in-flight handshake) instead of closing it.
      entry.cancelClose();
      entry.cancelClose = null;
      log('close-cancelled');
    }
  } else {
    const source = (params.createSource ?? defaultCreateSource)(params);
    entry = {
      key,
      source,
      refCount: 0,
      generation: ++generationCounter,
      cancelClose: null,
      disposed: false,
    };
    connections.set(key, entry);
    source.setVisible(params.visible);
    source.start();
  }

  entry.refCount += 1;
  log(`acquire subscriber=${entry.refCount}`);

  const boundEntry = entry;
  const generation = entry.generation;
  let released = false;

  return {
    source: boundEntry.source,
    release: (reason: string): void => {
      if (released) return;
      released = true;
      // Generation guard: if this entry was already disposed and a new connection
      // took the same key, a stale release must not touch the new one.
      const current = connections.get(key);
      if (current !== boundEntry || boundEntry.generation !== generation || boundEntry.disposed) return;
      boundEntry.refCount -= 1;
      log(`release subscriber=${boundEntry.refCount} reason=${reason}`);
      if (boundEntry.refCount > 0) return;
      scheduleClose(boundEntry, scheduler);
    },
  };
}

/** Test-only: synchronously tear down every connection and reset the registry. */
export function __resetMarketConnectionsForTest(): void {
  for (const entry of [...connections.values()]) {
    entry.disposed = true;
    entry.cancelClose?.();
    entry.cancelClose = null;
    entry.source.stop();
  }
  connections.clear();
  generationCounter = 0;
}

/** Test-only: number of live (non-disposed) connections in the tab. */
export function __activeMarketConnectionsForTest(): number {
  return connections.size;
}
