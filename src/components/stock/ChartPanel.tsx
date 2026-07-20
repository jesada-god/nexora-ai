'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TechnicalIndicatorControls } from '@/src/components/analytics/TechnicalIndicatorControls';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useAppActive } from '@/src/hooks/useAppActive';
import type { HistoricalRange } from '@/src/lib/market-data/types';
import { formatMarketDataAsOf } from '@/src/lib/presentation/datetime';
import { canLoadHistory, historyErrorMessage } from './history-policy';
import {
  canRetryHistory,
  historyRangeForIndicator,
  historyRequestClient,
  HistoryRequestSession,
  rangeCovers,
  visibleBarsForRange,
  type HistoryResponse,
} from './history-request';

const Chart = dynamic(() => import('./HistoricalChart'), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });
const IntradayChartPanel = dynamic(() => import('./IntradayChartPanel').then((module) => module.IntradayChartPanel), { ssr: false, loading: () => <Skeleton className="h-[420px] w-full" /> });

interface Props {
  symbol: string;
  active: boolean;
  initialHistory?: HistoryResponse | null;
  technicalIndicatorsEnabled: boolean;
  advancedChartTypesEnabled: boolean;
  extendedIndicatorsEnabled: boolean;
  supportResistanceEnabled: boolean;
  fairValueEnabled: boolean;
}

export function ChartPanel({
  symbol,
  active,
  initialHistory,
  technicalIndicatorsEnabled,
  advancedChartTypesEnabled,
  extendedIndicatorsEnabled,
  supportResistanceEnabled,
  fairValueEnabled,
}: Props) {
  const appActive = useAppActive();
  const [mode, setMode] = useState<'daily' | 'intraday'>('daily');
  const [range, setRange] = useState<HistoricalRange>('3m');
  const [fetchRange, setFetchRange] = useState<HistoricalRange>('3m');
  const [result, setResult] = useState<{ key: string; response: HistoryResponse } | null>(() => initialHistory ? { key: `${symbol}:3m`, response: initialHistory } : null);
  const [loading, setLoading] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(0);
  const [session] = useState(() => new HistoryRequestSession(historyRequestClient));
  const loadingRef = useRef(false);
  const cooldownRef = useRef(0);
  const key = `${symbol}:${fetchRange}`;

  const startRequest = useCallback((targetSymbol: string, targetRange: HistoricalRange, reason: 'selection' | 'retry') => {
    if (!appActive || !canLoadHistory(active && mode === 'daily', document.visibilityState)) return;
    const currentTime = Date.now();
    if (reason === 'retry' && !canRetryHistory(cooldownRef.current, currentTime, loadingRef.current)) return;
    if (loadingRef.current && reason === 'retry') return;
    loadingRef.current = true;
    setLoading(true);
    const run = session.begin(targetSymbol, targetRange, reason === 'retry');
    const viewKey = `${targetSymbol}:${targetRange}`;
    void run.promise.then((response) => {
      if (!session.isCurrent(run)) return;
      setResult({ key: viewKey, response });
      if (response.error?.retryable) {
        const failedAt = Date.now();
        const deadline = failedAt + (response.error.retryAfterSeconds ?? 30) * 1_000;
        cooldownRef.current = deadline;
        setNow(failedAt);
        setRetryAt(deadline);
      } else {
        cooldownRef.current = 0;
        setRetryAt(0);
      }
    }).catch((cause: unknown) => {
      if (!session.isCurrent(run) || (cause instanceof Error && cause.name === 'AbortError')) return;
      const failedAt = Date.now();
      const deadline = failedAt + 30_000;
      cooldownRef.current = deadline;
      setNow(failedAt);
      setRetryAt(deadline);
      setResult({ key: viewKey, response: { data: null, error: { code: 'upstream-unavailable', message: 'History unavailable', retryable: true }, meta: { provider: null, timestamp: new Date().toISOString(), freshness: { status: 'unavailable', asOf: null, maxAgeSeconds: null } } } });
    }).finally(() => {
      if (session.isCurrent(run)) {
        loadingRef.current = false;
        setLoading(false);
      }
    });
  }, [active, appActive, mode, session]);

  useEffect(() => {
    if (mode !== 'daily' || !active || !appActive || !canLoadHistory(true, document.visibilityState)) return;
    if (result?.key === `${symbol}:${fetchRange}`) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) startRequest(symbol, fetchRange, 'selection'); });
    return () => { cancelled = true; session.cancel(); loadingRef.current = false; };
  }, [active, appActive, fetchRange, mode, result?.key, session, startRequest, symbol]);
  useEffect(() => {
    if (!retryAt || !appActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [appActive, retryAt]);

  const current = result?.key === key ? result.response : null;
  const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1_000));
  const timestamp = current?.meta.freshness.asOf ?? current?.meta.timestamp;
  const history = current?.data && 'prices' in current.data ? current.data : null;
  const analyticsEnabled = technicalIndicatorsEnabled || advancedChartTypesEnabled || extendedIndicatorsEnabled || supportResistanceEnabled || fairValueEnabled;
  const selectVisibleRange = (value: HistoricalRange) => {
    setRange(value);
    if (!rangeCovers(fetchRange, value)) setFetchRange(value);
  };
  const requestIndicatorHistory = (minimumDataPoints: number) => {
    const target = historyRangeForIndicator(minimumDataPoints);
    if (!rangeCovers(fetchRange, target)) setFetchRange(target);
  };

  return <div className="space-y-3">
    <div className="flex gap-2 rounded-xl border border-slate-800 bg-[#151B28] p-2" role="tablist" aria-label="Chart timeframe family">
      <button type="button" role="tab" aria-selected={mode === 'daily'} onClick={() => setMode('daily')} className={`min-h-11 rounded-lg px-4 text-sm ${mode === 'daily' ? 'bg-[#D4FF00] font-semibold text-black' : 'text-slate-300'}`}>D1</button>
      <button type="button" role="tab" aria-selected={mode === 'intraday'} onClick={() => { session.cancel(); loadingRef.current = false; setLoading(false); setMode('intraday'); }} className={`min-h-11 rounded-lg px-4 text-sm ${mode === 'intraday' ? 'bg-[#D4FF00] font-semibold text-black' : 'text-slate-300'}`}>Intraday</button>
      <span className="self-center text-xs text-slate-500">D1 ใช้ canonical daily OHLCV เดิม · H4 ไม่สร้างจาก Daily</span>
    </div>
    {mode === 'intraday'
      ? <IntradayChartPanel symbol={symbol} active={active && mode === 'intraday'} />
      : <>
        <div className="flex items-center gap-1 overflow-x-auto">{(['1m', '3m', '6m', '1y', '5y', 'max'] as HistoricalRange[]).map((value) => <button key={value} onClick={() => selectVisibleRange(value)} className={`min-h-11 min-w-12 rounded-full px-3 text-xs ${range === value ? 'bg-[#D4FF00] text-black' : 'bg-slate-800 text-slate-300'}`}>{value.toUpperCase()}</button>)}<div className="ml-auto shrink-0 text-right"><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase text-slate-400">{loading && !current ? 'loading' : current?.meta.freshness.status ?? 'ready'}</span>{timestamp && <p className="mt-1 text-[10px] text-slate-500">{formatMarketDataAsOf(timestamp, { dateOnly: timestamp === current?.meta.freshness.asOf && current?.meta.freshness.status === 'end-of-day' })}</p>}</div></div>
        {history
          ? analyticsEnabled
            ? <TechnicalIndicatorControls history={history} meta={current!.meta} visibleBarCount={visibleBarsForRange(range)} onRequestMoreHistory={requestIndicatorHistory} technicalIndicatorsEnabled={technicalIndicatorsEnabled} advancedChartTypesEnabled={advancedChartTypesEnabled} extendedIndicatorsEnabled={extendedIndicatorsEnabled} supportResistanceEnabled={supportResistanceEnabled} fairValueEnabled={fairValueEnabled} />
            : <Chart symbol={symbol} prices={history.prices} visibleBarCount={visibleBarsForRange(range)} />
          : current?.error
            ? <div className="flex h-[300px] flex-col items-center justify-center gap-3 rounded-xl border border-red-500/20 px-4 text-center text-sm text-red-300"><p>{historyErrorMessage(current.error.code)}</p>{current.error.retryable && <button disabled={loading || cooldown > 0} onClick={() => startRequest(symbol, fetchRange, 'retry')} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 disabled:opacity-50">{loading ? 'กำลังโหลด…' : cooldown ? `ลองใหม่ใน ${cooldown} วินาที` : 'ลองใหม่'}</button>}</div>
            : <Skeleton className="h-[300px] w-full rounded-xl md:h-[420px]" />}
      </>}
  </div>;
}
