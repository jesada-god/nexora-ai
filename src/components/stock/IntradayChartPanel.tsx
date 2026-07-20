'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataProvenance } from '@/src/components/market-data/DataProvenance';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useAppActive } from '@/src/hooks/useAppActive';
import { normalizedCandleResultSchema, type CandleInterval, type CandleRange, type CandleSession, type NormalizedCandleResult } from '@/src/lib/market-data/candles/contracts';
import type { HistoricalPrices, MarketDataEnvelope } from '@/src/lib/market-data/types';

const Chart = dynamic(() => import('./HistoricalChart'), { ssr: false, loading: () => <Skeleton className="h-[420px] w-full" /> });
const TechnicalIndicatorControls = dynamic(() => import('@/src/components/analytics/TechnicalIndicatorControls').then((module) => module.TechnicalIndicatorControls), { ssr: false });

type Envelope = { data: unknown; error?: { code?: string; message?: string; retryAfterSeconds?: number; reason?: string } };
interface Props {
  symbol: string; active: boolean; interval: CandleInterval; range: CandleRange; session: CandleSession; adjusted: boolean;
  technicalIndicatorsEnabled: boolean; advancedChartTypesEnabled: boolean; extendedIndicatorsEnabled: boolean;
  supportResistanceEnabled: boolean; fairValueEnabled: boolean;
}

function limitationMessage(code: string | undefined): string {
  if (code === 'forbidden' || code === 'provider-unauthorized') return 'The configured API package does not authorize this timeframe.';
  if (code === 'rate-limited') return 'The provider is cooling down after a rate limit.';
  if (code === 'unsupported') return 'No provider supports this timeframe and historical range combination.';
  if (code === 'not-found' || code === 'insufficient-data') return 'No real OHLCV is available for this symbol and selection.';
  return 'Market candles are temporarily unavailable.';
}

function analyticsRange(range: CandleRange): HistoricalPrices['range'] {
  if (range === '1d' || range === '5d' || range === '1m') return '1m';
  if (range === '3m') return '3m';
  if (range === '6m') return '6m';
  if (range === 'ytd' || range === '1y') return '1y';
  return '5y';
}

export function MarketCandleChartPanel({ symbol, active, interval, range, session, adjusted, technicalIndicatorsEnabled, advancedChartTypesEnabled, extendedIndicatorsEnabled, supportResistanceEnabled, fairValueEnabled }: Props) {
  const appActive = useAppActive();
  const [series, setSeries] = useState<NormalizedCandleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string; diagnostics?: string } | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [saveData] = useState(() => typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData));
  const [userStarted, setUserStarted] = useState(false);
  const cache = useRef(new Map<string, NormalizedCandleResult>());
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
    if (!navigator.onLine) { setError({ code: 'offline', message: 'You are offline, so no provider request was made.' }); return; }
    if (!force) {
      const saved = cache.current.get(requestKey);
      if (saved) { setSeries(saved); setError(null); return; }
      const pending = inflight.current.get(requestKey);
      if (pending) return pending;
    }
    if (Date.now() < cooldownUntil) return;
    const requestGeneration = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true); setError(null);
    const operation = (async () => {
      try {
        const query = new URLSearchParams({ symbol, interval, range, adjusted: String(adjusted), session });
        const response = await fetch(`/api/market/candles?${query.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
        const payload = await response.json() as Envelope;
        if (!response.ok) {
          const retry = Number(response.headers.get('Retry-After') ?? payload.error?.retryAfterSeconds ?? 0);
          if (retry > 0) { const deadline = Date.now() + retry * 1_000; setNow(Date.now()); setCooldownUntil(deadline); }
          throw Object.assign(new Error(limitationMessage(payload.error?.code)), { code: payload.error?.code, diagnostics: process.env.NODE_ENV === 'development' ? payload.error?.reason ?? payload.error?.message : undefined });
        }
        const parsed = normalizedCandleResultSchema.safeParse(payload.data);
        if (!parsed.success) throw Object.assign(new Error('Market candle response failed validation.'), { code: 'invalid-provider-response' });
        if (generation.current !== requestGeneration) return;
        cache.current.set(requestKey, parsed.data); setSeries(parsed.data); setCooldownUntil(0);
      } catch (cause) {
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        setSeries(null);
        setError({ code: (cause as { code?: string }).code, message: cause instanceof Error ? cause.message : 'Market candles are unavailable.', diagnostics: (cause as { diagnostics?: string }).diagnostics });
      } finally { if (generation.current === requestGeneration) setLoading(false); }
    })().finally(() => inflight.current.delete(requestKey));
    inflight.current.set(requestKey, operation);
    return operation;
  }, [active, adjusted, appActive, cooldownUntil, interval, range, requestKey, session, symbol]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSeries(null);
      setError(null);
      if (active && appActive && (!saveData || userStarted)) void request();
    });
    return () => { cancelled = true; generation.current += 1; abort.current?.abort(); };
  }, [active, appActive, request, requestKey, saveData, userStarted]);
  useEffect(() => {
    if (!active || !appActive || series?.dataStatus !== 'live') return;
    const timer = window.setInterval(() => { void request(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [active, appActive, request, series?.dataStatus]);
  useEffect(() => () => abort.current?.abort(), []);

  const prices = useMemo(() => series?.candles.map((bar) => ({ date: new Date(bar.timestamp * 1_000).toISOString(), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })) ?? [], [series]);
  const history = useMemo<HistoricalPrices | null>(() => series ? { symbol, range: analyticsRange(range), interval: '1d', prices, providerUsed: series.provider, fallbackReason: series.fallbackReason, asOf: series.actualEnd ? new Date(series.actualEnd * 1_000).toISOString() : null, freshness: series.cacheStatus === 'stale' ? 'stale' : series.cacheStatus === 'hit' ? 'cached' : 'fresh', methodology: `Canonical ${interval} OHLCV from ${series.provider}; source interval ${series.sourceInterval}`, limitations: series.warnings } : null, [interval, prices, range, series, symbol]);
  const meta = useMemo<MarketDataEnvelope<HistoricalPrices>['meta'] | null>(() => series ? { provider: series.provider, timestamp: new Date().toISOString(), freshness: { status: series.dataStatus === 'live' ? 'realtime' : series.dataStatus, asOf: series.actualEnd ? new Date(series.actualEnd * 1_000).toISOString() : null, maxAgeSeconds: ['1D', 'Week', 'Month'].includes(interval) ? 21_600 : 60 } } : null, [interval, series]);
  const analyticsEnabled = technicalIndicatorsEnabled || advancedChartTypesEnabled || extendedIndicatorsEnabled || supportResistanceEnabled || fairValueEnabled;
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1_000));

  if (saveData && !userStarted) return <div className="rounded-xl border border-slate-700 p-5 text-sm text-slate-300"><p>Data Saver is enabled. Candles have not been loaded.</p><button type="button" className="mt-3 min-h-11 rounded-lg border border-[#D4FF00]/40 px-3 text-[#D4FF00]" onClick={() => setUserStarted(true)}>Load real OHLCV</button></div>;

  return <div className="space-y-3" data-testid="market-candle-chart-panel">
    <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={loading || cooldown > 0 || !appActive} onClick={() => void request(true)} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 disabled:opacity-40">{cooldown ? `Refresh in ${cooldown}s` : 'Refresh'}</button>{series && <span className="text-xs text-slate-500">{series.candles.length.toLocaleString()} candles · {series.exchangeTimezone} · {series.actualStart ? new Date(series.actualStart * 1_000).toLocaleDateString() : '—'}–{series.actualEnd ? new Date(series.actualEnd * 1_000).toLocaleDateString() : '—'}</span>}</div>
    <DataProvenance status={series?.dataStatus ?? (error ? 'unavailable' : 'delayed')} provider={series?.provider} asOf={series?.actualEnd ? new Date(series.actualEnd * 1_000).toISOString() : undefined} delayedMinutes={series?.delayedByMinutes} reason={error?.message ?? series?.fallbackReason ?? (series?.aggregated ? `${interval} aggregated from real ${series.sourceInterval} OHLCV` : null)}/>
    {series?.warnings.map((warning) => <p key={warning} className="text-xs text-amber-300">{warning}</p>)}
    {loading && !series && <Skeleton className="h-[420px] w-full rounded-xl" />}
    {error && !loading && <div role="alert" className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-amber-500/20 p-4 text-center text-sm text-amber-200"><p>{error.message}</p><p className="mt-1 text-xs text-slate-500">No candle is mocked, interpolated, forward-filled, or replaced with daily data.</p>{error.diagnostics && <details className="mt-2 max-w-xl text-left text-xs text-slate-500"><summary>Development diagnostics</summary><p className="mt-1 break-words">{error.diagnostics}</p></details>}<button type="button" disabled={cooldown > 0} onClick={() => void request(true)} className="mt-3 min-h-11 rounded-lg border border-slate-700 px-3 disabled:opacity-40">{cooldown ? `Try again in ${cooldown}s` : 'Try again'}</button></div>}
    {series && history && meta && prices.length > 0 && (analyticsEnabled ? <TechnicalIndicatorControls history={history} meta={meta} visibleBarCount={Math.min(1_260, prices.length)} technicalIndicatorsEnabled={technicalIndicatorsEnabled} advancedChartTypesEnabled={advancedChartTypesEnabled} extendedIndicatorsEnabled={extendedIndicatorsEnabled} supportResistanceEnabled={supportResistanceEnabled} fairValueEnabled={fairValueEnabled} /> : <Chart symbol={symbol} prices={prices} visibleBarCount={Math.min(1_260, prices.length)} chartType="candlestick" />)}
    {series && prices.length === 0 && <p className="rounded-xl border border-amber-500/20 p-4 text-sm text-amber-200">No validated real candles are available for this selection.</p>}
    {process.env.NODE_ENV === 'development' && series && <details className="rounded-xl border border-slate-800 p-3 text-xs text-slate-400"><summary>Development diagnostics</summary><dl className="mt-2 grid gap-1 sm:grid-cols-2"><div>Selected provider: {series.provider}</div><div>Attempted: {series.attemptedProviders.join(', ')}</div><div>Requested interval: {series.requestedInterval}</div><div>Actual/source: {series.actualInterval}/{series.sourceInterval}</div><div>Range: {series.requestedRange}</div><div>Actual start/end: {series.actualStart ?? '—'} / {series.actualEnd ?? '—'}</div><div>Candles: {series.candles.length}</div><div>Timezone/currency: {series.exchangeTimezone} / {series.currency ?? '—'}</div><div>Adjusted: {String(series.adjusted)}</div><div>Aggregated: {String(series.aggregated)}</div><div>Cache: {series.cacheStatus}</div><div>Fallback: {series.fallbackReason ?? 'none'}</div></dl></details>}
  </div>;
}

export const IntradayChartPanel = MarketCandleChartPanel;
