'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataProvenance, type DisplayDataStatus } from '@/src/components/market-data/DataProvenance';
import { planChartRequest, shouldApplyResponse } from './chart-request';
import { matchesLiveSelection, mergeLiveCandleIntoBars, shouldPollChart } from './live-candle-bridge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useAppActive } from '@/src/hooks/useAppActive';
import { chartGatewayResponseSchema, type CandleInterval, type HistoricalRange, type MarketSessionMode } from '@/src/lib/market-data/gateway/contracts';
import { historyFallbackModeFromStatus, type AcceptedPriceCandidate, type LiveCandle, type MarketDataLabel } from '@/src/lib/stock-detail/market-source';
import type { HistoricalPrices, MarketDataEnvelope } from '@/src/lib/market-data/types';

const Chart = dynamic(() => import('./HistoricalChart'), { ssr: false, loading: () => <Skeleton className="h-[420px] w-full" /> });
const TechnicalIndicatorControls = dynamic(() => import('@/src/components/analytics/TechnicalIndicatorControls').then((module) => module.TechnicalIndicatorControls), { ssr: false });

type Envelope = { data: unknown; error?: { code?: string; message?: string; retryAfterSeconds?: number; reason?: string; retryable?: boolean } };
type ChartResult = ReturnType<typeof chartGatewayResponseSchema.parse>;

interface Props {
  symbol: string;
  active: boolean;
  interval: CandleInterval;
  range: HistoricalRange;
  session: MarketSessionMode;
  adjusted: boolean;
  currentPrice?: number | null;
  /** Provenance of the accepted price for the decision panel (never REAL-TIME). */
  marketLabel?: MarketDataLabel | null;
  liveCandle?: LiveCandle | null;
  liveActive?: boolean;
  onLiveRefresh?: () => void;
  liveRefreshDisabled?: boolean;
  /** Report the newest completed displayed bar up as a history-fallback price candidate. */
  onHistoryFallbackChange?: (fallback: AcceptedPriceCandidate | null) => void;
  technicalIndicatorsEnabled: boolean;
  advancedChartTypesEnabled: boolean;
  extendedIndicatorsEnabled: boolean;
  supportResistanceEnabled: boolean;
  fairValueEnabled: boolean;
}

function limitationMessage(code: string | undefined): string {
  if (code === 'provider-not-configured') return 'Configuration required: set POLYGON_API_KEY and MARKET_DATA_PROVIDER=polygon.';
  if (code === 'forbidden' || code === 'provider-unauthorized') return 'The configured Polygon plan does not authorize this market-data operation.';
  if (code === 'rate-limited') return 'Polygon is cooling down after a rate limit.';
  if (code === 'unsupported') return 'This instrument or interval/range combination is unsupported.';
  if (code === 'invalid-symbol') return 'This instrument is delisted or cannot be resolved safely.';
  if (code === 'not-found' || code === 'insufficient-data') return 'No real Polygon OHLCV is available for this symbol and selection.';
  return 'Market candles are temporarily unavailable.';
}

function displayStatus(value: ChartResult['bars']['dataStatus']): DisplayDataStatus {
  // This account is not entitled to a real-time feed, so the chart provenance
  // must never claim it — mirror the market-source label layer and downgrade a
  // provider 'real-time'/'partial' bucket to DELAYED (a partial bar is the
  // still-forming, non-real-time current bucket). Never surface a LIVE badge.
  if (value === 'real-time' || value === 'partial') return 'delayed';
  return value === 'unavailable' ? 'unavailable' : value;
}

function analyticsRange(range: HistoricalRange): HistoricalPrices['range'] {
  if (range === '1d' || range === '5d' || range === '1m') return '1m';
  if (range === '3m') return '3m';
  if (range === '6m') return '6m';
  if (range === 'ytd' || range === '1y') return '1y';
  return '5y';
}

export function MarketCandleChartPanel(props: Props) {
  const { symbol, active, interval, range, session, adjusted, currentPrice, marketLabel, liveCandle, liveActive, onLiveRefresh, liveRefreshDisabled, onHistoryFallbackChange } = props;
  const appActive = useAppActive();
  // When the current selection is the exact bucket the shared market source
  // streams, the chart consumes that single accepted candle instead of running a
  // duplicate `/api/market/chart` poll. History still loads once below.
  const coveredByLiveSource = Boolean(liveActive) && matchesLiveSelection(interval, session);
  const [result, setResult] = useState<ChartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string; diagnostics?: string; retryable?: boolean } | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);
  const cache = useRef(new Map<string, ChartResult>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const requestKey = `${symbol}:${interval}:${range}:${adjusted}:${session}`;

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const request = useCallback(async (force = false) => {
    if (!active || !appActive) return;
    if (!navigator.onLine) { setError({ code: 'offline', message: 'You are offline, so no provider request was made.', retryable: true }); return; }
    const plan = planChartRequest({
      force,
      hasCache: cache.current.has(requestKey),
      hasInflight: inflight.current.has(requestKey),
      now: Date.now(),
      cooldownUntil,
    });
    if (plan === 'serve-cache') { setResult(cache.current.get(requestKey)!); setError(null); return; }
    if (plan === 'join-inflight') return inflight.current.get(requestKey);
    if (plan === 'wait-cooldown') return;
    const requestGeneration = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError(null);
    const operation = (async () => {
      try {
        const query = new URLSearchParams({ symbol, interval, range, adjusted: String(adjusted), session });
        const response = await fetch(`/api/market/chart?${query.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
        const payload = await response.json() as Envelope;
        if (!response.ok) {
          const retry = Number(response.headers.get('Retry-After') ?? payload.error?.retryAfterSeconds ?? 0);
          if (retry > 0) setCooldownUntil(Date.now() + retry * 1_000);
          throw Object.assign(new Error(limitationMessage(payload.error?.code)), {
            code: payload.error?.code,
            retryable: payload.error?.retryable,
            diagnostics: process.env.NODE_ENV === 'development' ? payload.error?.reason ?? payload.error?.message : undefined,
          });
        }
        const parsed = chartGatewayResponseSchema.safeParse(payload.data);
        if (!parsed.success) throw Object.assign(new Error('Market gateway response failed validation.'), { code: 'invalid-provider-response' });
        if (!shouldApplyResponse(generation.current, requestGeneration, controller.signal.aborted)) return;
        cache.current.set(requestKey, parsed.data);
        setResult(parsed.data);
        setCooldownUntil(0);
      } catch (cause) {
        if (!shouldApplyResponse(generation.current, requestGeneration, controller.signal.aborted)) return;
        setResult(null);
        setError({ code: (cause as { code?: string }).code, message: cause instanceof Error ? cause.message : 'Market candles are unavailable.', diagnostics: (cause as { diagnostics?: string }).diagnostics, retryable: (cause as { retryable?: boolean }).retryable });
      } finally {
        if (generation.current === requestGeneration) setLoading(false);
      }
    })().finally(() => inflight.current.delete(requestKey));
    inflight.current.set(requestKey, operation);
    return operation;
  }, [active, adjusted, appActive, cooldownUntil, interval, range, requestKey, session, symbol]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setResult(null);
      setError(null);
      if (active && appActive) void request();
    });
    return () => { cancelled = true; generation.current += 1; abort.current?.abort(); };
  }, [active, appActive, request, requestKey]);
  useEffect(() => {
    // The shared market source is the single polling loop for the live bucket:
    // when it covers this selection the chart never runs its own recurring poll.
    if (!shouldPollChart({
      active,
      appActive,
      hasResult: Boolean(result),
      dataStatus: result?.bars.dataStatus ?? '',
      coveredByLiveSource,
    })) return;
    const timer = window.setInterval(() => { void request(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [active, appActive, coveredByLiveSource, request, result]);
  useEffect(() => () => abort.current?.abort(), []);

  const prices = useMemo(() => result?.bars.bars.map((bar) => ({
    date: new Date(bar.time * 1_000).toISOString(),
    open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
    transactions: bar.transactions, vwap: bar.vwap, partial: bar.partial,
  })) ?? [], [result]);
  // Fold the shared source's accepted active candle into the loaded history:
  // same bucket updates in place, a newer bucket appends once, stale is ignored.
  const displayPrices = useMemo(
    () => (coveredByLiveSource ? mergeLiveCandleIntoBars(prices, liveCandle ?? null) : prices),
    [coveredByLiveSource, liveCandle, prices],
  );
  // The newest completed (non-partial) bar the chart currently displays, reported
  // up as a history-fallback price candidate — the exact bar shown, never a
  // fabricated one. It is the header's last-resort price for Daily/Week/Month (or
  // any snapshot-403 selection); the shared accepted-price priority ranks it below
  // an entitled snapshot and an accepted live aggregate, so it can never overwrite
  // a newer live value. Reported as null while there is no result so a stale bar
  // from a superseded selection can never linger.
  const historyFallback = useMemo<AcceptedPriceCandidate | null>(() => {
    if (!result) return null;
    let newestCompleted: (typeof displayPrices)[number] | null = null;
    for (const priced of displayPrices) {
      if (priced.partial === true) continue; // exclude the still-forming bucket
      newestCompleted = priced; // displayPrices is ascending by time
    }
    if (!newestCompleted || !Number.isFinite(newestCompleted.close)) return null;
    return {
      price: newestCompleted.close,
      source: 'history-fallback',
      exchangeTimestamp: newestCompleted.date,
      mode: historyFallbackModeFromStatus(result.bars.dataStatus),
      provider: result.bars.provider,
    };
  }, [result, displayPrices]);
  useEffect(() => { onHistoryFallbackChange?.(historyFallback); }, [historyFallback, onHistoryFallbackChange]);

  const history = useMemo<HistoricalPrices | null>(() => result ? {
    symbol: result.instrument.canonicalSymbol,
    range: analyticsRange(range),
    interval: '1d',
    prices: displayPrices,
    providerUsed: result.bars.provider,
    fallbackReason: null,
    asOf: result.bars.asOf ? new Date(result.bars.asOf * 1_000).toISOString() : null,
    freshness: result.bars.dataStatus === 'stale' ? 'stale' : result.bars.dataStatus === 'cached' ? 'cached' : 'fresh',
    methodology: `Canonical ${interval} Polygon OHLCV for ${result.instrument.providerSymbol}`,
    limitations: result.bars.warnings,
  } : null, [displayPrices, interval, range, result]);
  const meta = useMemo<MarketDataEnvelope<HistoricalPrices>['meta'] | null>(() => result ? {
    provider: result.bars.provider,
    timestamp: new Date().toISOString(),
    freshness: {
      status: result.bars.dataStatus === 'real-time' || result.bars.dataStatus === 'partial' ? 'realtime' : result.bars.dataStatus,
      asOf: result.bars.asOf ? new Date(result.bars.asOf * 1_000).toISOString() : null,
      maxAgeSeconds: ['1D', 'Week', 'Month'].includes(interval) ? 21_600 : 60,
    },
  } : null, [interval, result]);
  const analyticsEnabled = props.technicalIndicatorsEnabled || props.advancedChartTypesEnabled || props.extendedIndicatorsEnabled || props.supportResistanceEnabled || props.fairValueEnabled;
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1_000));
  // When the shared source owns this bucket, Refresh triggers exactly one
  // shared request that updates the header and current candle together — it never
  // reloads the full chart history (that only happens on a range/interval change).
  const onRefresh = coveredByLiveSource && onLiveRefresh ? onLiveRefresh : () => void request(true);
  const refreshDisabled = coveredByLiveSource
    ? Boolean(liveRefreshDisabled) || !appActive
    : loading || cooldown > 0 || !appActive || error?.retryable === false;
  const refreshLabel = !coveredByLiveSource && cooldown ? `Refresh in ${cooldown}s` : 'Refresh';
  const tooltipContext = result ? {
    provider: result.bars.provider,
    range,
    interval,
    dataStatus: result.bars.dataStatus,
    timezone: result.bars.timezone,
  } : {};

  return <div className="space-y-3" data-testid="market-candle-chart-panel">
    <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={refreshDisabled} onClick={onRefresh} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 disabled:opacity-40">{refreshLabel}</button>{result && <span className="text-xs text-slate-500">{result.bars.bars.length.toLocaleString()} bars · {result.bars.timezone} · {result.bars.firstTimestamp ? new Date(result.bars.firstTimestamp * 1_000).toLocaleDateString() : '—'}–{result.bars.lastTimestamp ? new Date(result.bars.lastTimestamp * 1_000).toLocaleDateString() : '—'}</span>}</div>
    <DataProvenance status={result ? displayStatus(result.bars.dataStatus) : error ? 'unavailable' : 'delayed'} provider={result?.bars.provider} asOf={result?.bars.asOf ? new Date(result.bars.asOf * 1_000).toISOString() : undefined} delayedMinutes={result?.bars.delayedByMinutes} reason={error?.message}/>
    {result?.bars.warnings.map((warning) => <p key={warning} className="text-xs text-amber-300">{warning}</p>)}
    {loading && !result && <Skeleton className="h-[420px] w-full rounded-xl" />}
    {error && !loading && <div role="alert" className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-amber-500/20 p-4 text-center text-sm text-amber-200"><p>{error.message}</p><p className="mt-1 text-xs text-slate-500">No candle is mocked, interpolated, forward-filled, or replaced by another provider.</p>{error.diagnostics && <details className="mt-2 max-w-xl text-left text-xs text-slate-500"><summary>Development diagnostics</summary><p className="mt-1 break-words">{error.diagnostics}</p></details>}{error.retryable !== false && <button type="button" disabled={cooldown > 0} onClick={() => void request(true)} className="mt-3 min-h-11 rounded-lg border border-slate-700 px-3 disabled:opacity-40">{cooldown ? `Try again in ${cooldown}s` : 'Try again'}</button>}</div>}
    {result && displayPrices.length === 1 && <div role="status" className="rounded-xl border border-amber-500/20 p-5 text-sm text-amber-200">ช่วงนี้มีข้อมูลจริงเพียง 1 แท่ง อาจเป็นหลักทรัพย์เพิ่งเข้าตลาดหรือช่วงที่เลือกสั้นเกินไป กรุณาเลือก range ที่ยาวขึ้น</div>}
    {result && displayPrices.length >= 2 && history && meta && (analyticsEnabled
      ? <TechnicalIndicatorControls history={history} meta={meta} interval={interval} visibleBarCount={Math.min(1_260, displayPrices.length)} technicalIndicatorsEnabled={props.technicalIndicatorsEnabled} advancedChartTypesEnabled={props.advancedChartTypesEnabled} extendedIndicatorsEnabled={props.extendedIndicatorsEnabled} supportResistanceEnabled={props.supportResistanceEnabled} fairValueEnabled={props.fairValueEnabled} currentPrice={currentPrice} marketLabel={marketLabel} datasetKey={requestKey} tooltipContext={tooltipContext}/>
      : <Chart symbol={result.instrument.canonicalSymbol} prices={displayPrices} interval={interval} chartType="candlestick" currentPrice={currentPrice} marketLabel={marketLabel} datasetKey={requestKey} tooltipContext={tooltipContext}/>)}
    {result && displayPrices.length === 0 && <p className="rounded-xl border border-amber-500/20 p-4 text-sm text-amber-200">No validated real Polygon candles are available for this selection.</p>}
    {process.env.NODE_ENV === 'development' && result && <details className="rounded-xl border border-slate-800 p-3 text-xs text-slate-400"><summary>Development diagnostics</summary><dl className="mt-2 grid gap-1 sm:grid-cols-2"><div>Requested: {symbol}</div><div>Canonical/provider: {result.instrument.canonicalSymbol} / {result.instrument.providerSymbol}</div><div>Exchange/MIC: {result.instrument.exchange ?? '—'} / {result.instrument.mic ?? '—'}</div><div>Asset: {result.instrument.assetType}</div><div>Interval/range: {interval} / {range}</div><div>Actual first/last: {result.bars.firstTimestamp ?? '—'} / {result.bars.lastTimestamp ?? '—'}</div><div>Bars: {result.bars.bars.length}</div><div>Status: {result.bars.dataStatus}</div></dl></details>}
  </div>;
}

export const IntradayChartPanel = MarketCandleChartPanel;
