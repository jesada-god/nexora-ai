'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAcceptedResource,
  candidateFromUpdate,
  createBrowserMarketTransport,
  createMarketSource,
  freshnessFromMode,
  labelFromAccepted,
  resolveAcceptedPrice,
  selectionKeyOf,
  type AcceptedPriceCandidate,
  type LiveCandle,
  type MarketDataLabel,
  type MarketSelection,
  type MarketSessionKind,
  type MarketSource,
} from '@/src/lib/stock-detail/market-source';
import { resolvePublicMarketWsUrl } from '@/src/lib/market-data/realtime';
import type { MarketDataApiError } from '@/src/lib/market-data/types';
import type { StockDetailQuoteResource } from '@/src/lib/stock-detail/types';

/** Regular-session cadence is 12s (inside the mandated 10–15s window); closed is slower. */
const CADENCE = { regularMs: 12_000, closedMs: 60_000 };

export interface UseMarketSourceOptions {
  symbol: string;
  initialQuote: StockDetailQuoteResource;
  session: MarketSessionKind;
  /**
   * The chart's current selection. The single {@link PollingMarketSource} follows
   * it so the header price and the chart's active candle derive from one accepted
   * event. Defaults to 5m/regular (the header's current-price proxy) when the
   * chart is not driving a selection.
   */
  selection?: MarketSelection;
  /**
   * The newest completed bar the chart currently displays for this symbol +
   * selection, as a history-fallback candidate. Used only when neither an
   * entitled snapshot nor an accepted live aggregate is available (e.g. a
   * Daily/Week/Month header, or a snapshot-403 selection). Pass null while the
   * chart has no result so a stale bar can never linger.
   */
  historyFallback?: AcceptedPriceCandidate | null;
  active: boolean;
  online: boolean;
  enabled: boolean;
}

export interface UseMarketSourceResult {
  quoteResource: StockDetailQuoteResource;
  quoteLoading: boolean;
  quoteRetryAt: number;
  dataLabel: MarketDataLabel | null;
  /**
   * The latest accepted active candle from the shared source, or null before the
   * first tick. This is the single source of truth the chart consumes so the
   * header price, chart current candle and S/R distance all derive from one
   * accepted market event.
   */
  liveCandle: LiveCandle | null;
  /**
   * The single accepted price shared by the header, the chart price line and the
   * (future) S/R currentPrice, or null when unavailable. Equal to
   * `quoteResource.data?.price` for the accepted source.
   */
  acceptedPrice: number | null;
  /**
   * Top-of-book and halt state from the live stream (null/false on REST paths).
   * Shown separately from Last Price in the header.
   */
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  quoteTimestamp: string | null;
  halted: boolean;
  haltReason: string | null;
  /**
   * True on the most recent emission that finalized a bar (a new bucket opened or
   * an official/updated bar closed one). The chart gates heavy S/R + indicator
   * recomputation on this so intra-bar ticks stay cheap.
   */
  barFinalized: boolean;
  refresh: () => void;
}

/** A market source that additionally follows the chart selection. */
type SelectableSource = MarketSource & { setSelection: (selection: MarketSelection) => void };

interface LiveMeta {
  symbol: string;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  quoteTimestamp: string | null;
  halted: boolean;
  haltReason: string | null;
  barFinalized: boolean;
}

const EMPTY_META: LiveMeta = {
  symbol: '', bid: null, ask: null, bidSize: null, askSize: null,
  quoteTimestamp: null, halted: false, haltReason: null, barFinalized: false,
};

/**
 * Drives the Stock Detail header/price from a transport-agnostic
 * {@link PollingMarketSource}: entitlement-aware REST polling that pauses when
 * hidden/offline, honors rate limits and never claims real-time data.
 *
 * The displayed price follows one deterministic priority — entitled snapshot →
 * accepted live aggregate close → newest displayed history bar close →
 * unavailable — so the header, the chart price line and the S/R currentPrice can
 * never diverge onto different market events. An older history bar can never
 * overwrite a newer aggregate/snapshot (source rank dominates), and a selection
 * change isolates the aggregate candidate by selection key so sessions/intervals
 * never mix.
 */
const DEFAULT_SELECTION: MarketSelection = { interval: '5m', session: 'regular', adjusted: false };

export function useMarketSource(options: UseMarketSourceOptions): UseMarketSourceResult {
  const { symbol, initialQuote, session, active, online, enabled } = options;
  const selection = options.selection ?? DEFAULT_SELECTION;
  const selectionKey = selectionKeyOf(selection);
  const historyFallback = options.historyFallback ?? null;

  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRetryAt, setQuoteRetryAt] = useState(0);
  const [lastError, setLastError] = useState<MarketDataApiError | null>(null);
  // Last-good snapshot (symbol-scoped: the snapshot is the selection-independent
  // current price) and last-good aggregate (symbol + selection scoped: an
  // aggregate bucket belongs to exactly one interval/session). Both are updated
  // only on a priced success, so a transient blip keeps the last verified value.
  const [snapState, setSnapState] = useState<{ symbol: string; candidate: AcceptedPriceCandidate; resource: StockDetailQuoteResource } | null>(null);
  const [aggState, setAggState] = useState<{ symbol: string; selectionKey: string; candidate: AcceptedPriceCandidate } | null>(null);
  // The active candle, tagged with symbol + selection so a symbol/selection switch
  // never surfaces the previous instrument's or selection's bucket.
  const [candleState, setCandleState] = useState<{ symbol: string; selectionKey: string; candle: LiveCandle } | null>(null);
  const [liveMeta, setLiveMeta] = useState<LiveMeta>(EMPTY_META);

  const sourceRef = useRef<SelectableSource | null>(null);
  const transport = useMemo(() => createBrowserMarketTransport(), []);
  // Public Gateway URL (empty → REST-only). NEXT_PUBLIC_* is inlined by Next at
  // build time, so this is safe to read in the browser; it is never a secret.
  const wsUrl = useMemo(() => resolvePublicMarketWsUrl(), []);
  // Kept current so the subscribe callback (registered once) tags every emission
  // with the source's live selection at emit time.
  const selectionKeyRef = useRef(selectionKey);
  useEffect(() => { selectionKeyRef.current = selectionKey; }, [selectionKey]);
  // Skip a live-meta rerender when nothing the header/chart reads has changed:
  // an intra-bar trade with an unchanged quote and no finalized bar is a no-op.
  const metaKeyRef = useRef('');

  useEffect(() => {
    if (!enabled) return;
    const source = createMarketSource({
      symbol,
      transport,
      session,
      selection,
      cadence: CADENCE,
      wsUrl,
    }) as SelectableSource;
    sourceRef.current = source;
    const unsubscribe = source.subscribe((update) => {
      const tag = selectionKeyRef.current;
      setLastError(update.error);
      const candidate = candidateFromUpdate(update);
      if (candidate?.source === 'snapshot' && update.quote) {
        setSnapState({
          symbol,
          candidate,
          resource: {
            data: update.quote,
            freshness: freshnessFromMode(candidate.mode, candidate.exchangeTimestamp),
            provider: candidate.provider,
            reason: null,
            error: null,
            fallbackLabel: null,
          },
        });
      } else if (candidate?.source === 'aggregate-fallback') {
        setAggState({ symbol, selectionKey: tag, candidate });
      }
      // The candle and the header price come from the same accepted event.
      if (update.candle) setCandleState({ symbol, selectionKey: tag, candle: update.candle });
      // Capture top-of-book / halt state; only rerender when something the header
      // or chart actually reads has changed (or a bar just finalized).
      const nextMeta: LiveMeta = {
        symbol,
        bid: update.bid ?? null,
        ask: update.ask ?? null,
        bidSize: update.bidSize ?? null,
        askSize: update.askSize ?? null,
        quoteTimestamp: update.quoteTimestamp ?? null,
        halted: update.halted ?? false,
        haltReason: update.haltReason ?? null,
        barFinalized: update.barFinalized ?? false,
      };
      const metaKey = `${nextMeta.bid}|${nextMeta.ask}|${nextMeta.bidSize}|${nextMeta.askSize}|${nextMeta.halted}|${nextMeta.haltReason}`;
      if (nextMeta.barFinalized || metaKey !== metaKeyRef.current) {
        metaKeyRef.current = metaKey;
        setLiveMeta(nextMeta);
      }
      setQuoteLoading(false);
      const remaining = source.cooldownRemainingMs();
      setQuoteRetryAt(remaining > 0 ? Date.now() + remaining : 0);
    });
    source.setVisible(active && online);
    source.start();
    return () => {
      unsubscribe();
      source.stop();
      sourceRef.current = null;
    };
    // `session`/`selection` are applied via dedicated effects so cadence and
    // selection changes never tear down and rebuild the source (which would drop
    // the active candle). `selection.*` is read once here for the initial config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, transport, enabled, wsUrl]);

  useEffect(() => { sourceRef.current?.setSession(session); }, [session]);
  useEffect(() => { sourceRef.current?.setVisible(active && online); }, [active, online]);
  // Reconfigure the single loop to follow the chart selection: abort the previous
  // generation, clear the incompatible candle, start exactly one new loop.
  useEffect(() => {
    sourceRef.current?.setSelection(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // The candidates valid for the CURRENT symbol + selection. The snapshot is
  // symbol-scoped; the aggregate and history bar are selection-scoped, so a
  // superseded selection's aggregate/bar can never enter the current price.
  const snapshotResource = snapState?.symbol === symbol ? snapState.resource : null;
  const snapCandidate = snapState?.symbol === symbol ? snapState.candidate : null;
  const aggCandidate = aggState?.symbol === symbol && aggState.selectionKey === selectionKey ? aggState.candidate : null;
  const historyCandidate = historyFallback && historyFallback.source === 'history-fallback' ? historyFallback : null;

  const accepted = useMemo(
    () => resolveAcceptedPrice([snapCandidate, aggCandidate, historyCandidate]),
    [snapCandidate, aggCandidate, historyCandidate],
  );

  const baseQuote = snapshotResource?.data ?? initialQuote.data;
  const quoteResource = useMemo<StockDetailQuoteResource>(() => {
    if (accepted) return buildAcceptedResource({ accepted, snapshotResource, baseQuote, symbol });
    // Nothing accepted yet: surface the last verified snapshot (or the initial
    // resource), annotated with any live error so the header can offer a retry.
    const base = snapshotResource ?? initialQuote;
    if (lastError) return { ...base, reason: `${lastError.code}: ${lastError.message}`, error: lastError };
    return base;
  }, [accepted, snapshotResource, baseQuote, symbol, lastError, initialQuote]);

  const dataLabel = useMemo(() => labelFromAccepted(accepted, new Date().toISOString()), [accepted]);

  const refresh = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return;
    if (source.cooldownRemainingMs() > 0) {
      setQuoteRetryAt(Date.now() + source.cooldownRemainingMs());
      return;
    }
    setQuoteLoading(true);
    void source.refresh().finally(() => setQuoteLoading(false));
  }, []);

  const liveCandle = candleState
    && candleState.symbol === symbol
    && candleState.selectionKey === selectionKey
    ? candleState.candle
    : null;

  // Live meta is symbol-scoped; a stale instrument's book never leaks through.
  const meta = liveMeta.symbol === symbol ? liveMeta : EMPTY_META;

  return {
    quoteResource,
    quoteLoading,
    quoteRetryAt,
    dataLabel,
    liveCandle,
    acceptedPrice: accepted?.price ?? quoteResource.data?.price ?? null,
    bid: meta.bid,
    ask: meta.ask,
    bidSize: meta.bidSize,
    askSize: meta.askSize,
    quoteTimestamp: meta.quoteTimestamp,
    halted: meta.halted,
    haltReason: meta.haltReason,
    barFinalized: meta.barFinalized,
    refresh,
  };
}
