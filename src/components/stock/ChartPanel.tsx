'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import type { HistoricalRange } from '@/src/lib/market-data/types';
import { canLoadHistory, historyErrorMessage } from './history-policy';
import { canRetryHistory, historyRequestClient, HistoryRequestSession, type HistoryResponse } from './history-request';
import { useAppActive } from '@/src/hooks/useAppActive';
import { TechnicalIndicatorControls } from '@/src/components/analytics/TechnicalIndicatorControls';
const Chart = dynamic(() => import('./HistoricalChart'), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

export function ChartPanel({ symbol, active, initialHistory, technicalIndicatorsEnabled, advancedChartTypesEnabled, extendedIndicatorsEnabled, supportResistanceEnabled, fairValueEnabled }: { symbol: string; active: boolean; initialHistory?: HistoryResponse | null; technicalIndicatorsEnabled: boolean; advancedChartTypesEnabled: boolean; extendedIndicatorsEnabled: boolean; supportResistanceEnabled: boolean; fairValueEnabled: boolean }) {
  const appActive = useAppActive();
  const [range, setRange] = useState<HistoricalRange>('3m'); const [result, setResult] = useState<{ key: string; response: HistoryResponse } | null>(() => initialHistory ? { key: `${symbol}:3m`, response: initialHistory } : null);
  const [loading, setLoading] = useState(false); const [retryAt, setRetryAt] = useState(0); const [now, setNow] = useState(0);
  const [session] = useState(() => new HistoryRequestSession(historyRequestClient));
  const loadingRef = useRef(false); const cooldownRef = useRef(0);
  const key = `${symbol}:${range}`;

  const startRequest = useCallback((targetSymbol: string, targetRange: HistoricalRange, reason: 'selection' | 'retry') => {
    if (!appActive || !canLoadHistory(active, document.visibilityState)) return;
    const currentTime = Date.now();
    if (reason === 'retry' && !canRetryHistory(cooldownRef.current, currentTime, loadingRef.current)) return;
    if (loadingRef.current && reason === 'retry') return;
    loadingRef.current = true; setLoading(true);
    const run = session.begin(targetSymbol, targetRange, reason === 'retry'); const viewKey = `${targetSymbol}:${targetRange}`;
    void run.promise.then((response) => {
      if (!session.isCurrent(run)) return;
      setResult({ key: viewKey, response });
      if (response.error?.retryable) {
        const failedAt = Date.now(); const deadline = failedAt + (response.error.retryAfterSeconds ?? 30) * 1000;
        cooldownRef.current = deadline; setNow(failedAt); setRetryAt(deadline);
      } else { cooldownRef.current = 0; setRetryAt(0); }
    }).catch((cause: unknown) => {
      if (!session.isCurrent(run) || (cause instanceof Error && cause.name === 'AbortError')) return;
      const failedAt = Date.now(); const deadline = failedAt + 30_000; cooldownRef.current = deadline; setNow(failedAt); setRetryAt(deadline);
      setResult({ key: viewKey, response: { data: null, error: { code: 'upstream-unavailable', message: 'History unavailable', retryable: true }, meta: { provider: null, timestamp: new Date().toISOString(), freshness: { status: 'unavailable', asOf: null, maxAgeSeconds: null } } } });
    }).finally(() => { if (session.isCurrent(run)) { loadingRef.current = false; setLoading(false); } });
  }, [active, appActive, session]);

  useEffect(() => {
    if (!active || !appActive || !canLoadHistory(true, document.visibilityState)) return;
    if (result?.key === `${symbol}:${range}`) return;
    let cancelled = false; queueMicrotask(() => { if (!cancelled) startRequest(symbol, range, 'selection'); });
    return () => { cancelled = true; session.cancel(); loadingRef.current = false; };
  }, [active, appActive, range, result?.key, session, startRequest, symbol]);
  useEffect(() => { if (!retryAt || !appActive) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [appActive, retryAt]);
  const current = result?.key === key ? result.response : null; const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1000)); const timestamp = current?.meta.freshness.asOf ?? current?.meta.timestamp;
  const history = current?.data && 'prices' in current.data ? current.data : null;
  const analyticsEnabled = technicalIndicatorsEnabled || advancedChartTypesEnabled || extendedIndicatorsEnabled || supportResistanceEnabled || fairValueEnabled;
  return <div><div className="mb-3 flex items-center gap-1 overflow-x-auto">{(['1m','3m','6m','1y','5y','max'] as HistoricalRange[]).map((value) => <button key={value} onClick={() => setRange(value)} className={`min-w-12 rounded-full px-3 text-xs ${range === value ? 'bg-[#D4FF00] text-black' : 'bg-slate-800 text-slate-300'}`}>{value.toUpperCase()}</button>)}<div className="ml-auto shrink-0 text-right"><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase text-slate-400">{loading && !current ? 'loading' : current?.meta.freshness.status ?? 'ready'}</span>{timestamp && <p className="mt-1 text-[10px] text-slate-500">{new Date(timestamp).toLocaleString('th-TH')}</p>}</div></div>{history ? analyticsEnabled ? <TechnicalIndicatorControls history={history} meta={current!.meta} technicalIndicatorsEnabled={technicalIndicatorsEnabled} advancedChartTypesEnabled={advancedChartTypesEnabled} extendedIndicatorsEnabled={extendedIndicatorsEnabled} supportResistanceEnabled={supportResistanceEnabled} fairValueEnabled={fairValueEnabled} /> : <div className="relative h-[300px] md:h-[420px]"><Chart prices={history.prices}/></div> : current?.error ? <div className="flex h-[300px] flex-col items-center justify-center gap-3 rounded-xl border border-red-500/20 px-4 text-center text-sm text-red-300"><p>{historyErrorMessage(current.error.code)}</p>{current.error.retryable && <button disabled={loading || cooldown > 0} onClick={() => startRequest(symbol, range, 'retry')} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 disabled:opacity-50">{loading ? 'กำลังโหลด…' : cooldown ? `ลองใหม่ใน ${cooldown} วินาที` : 'ลองใหม่'}</button>}</div> : <Skeleton className="h-[300px] w-full rounded-xl md:h-[420px]" />}</div>;
}
