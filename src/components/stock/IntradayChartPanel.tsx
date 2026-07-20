'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataProvenance } from '@/src/components/market-data/DataProvenance';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useAppActive } from '@/src/hooks/useAppActive';
import { aggregateSessionAwareH4 } from '@/src/lib/market-data/intraday/aggregate';
import { canonicalIntradaySeriesSchema, type CanonicalIntradaySeries, type IntradayInterval, type IntradayRange, type IntradaySessionMode } from '@/src/lib/market-data/intraday/contracts';

const Chart = dynamic(() => import('./HistoricalChart'), { ssr: false, loading: () => <Skeleton className="h-[420px] w-full" /> });
type DisplayInterval = IntradayInterval | '4h';
type Envelope = { data: unknown; error?: { code: string; message: string; retryAfterSeconds?: number } };
const intervals: Array<{ id: DisplayInterval; label: string; source: string }> = [
  { id: '1m', label: '1m', source: 'provider' },
  { id: '5m', label: '5m', source: 'provider' },
  { id: '15m', label: '15m', source: 'provider' },
  { id: '30m', label: '30m', source: 'provider' },
  { id: '60m', label: '60m', source: 'provider' },
  { id: '4h', label: 'H4', source: 'derived from real 60m regular-session bars' },
];

function intradayError(code: string | undefined): string {
  if (code === 'forbidden') return 'แพ็กเกจข้อมูลปัจจุบันไม่มีสิทธิ์ Intraday';
  if (code === 'rate-limited') return 'ผู้ให้บริการจำกัดจำนวนคำขอชั่วคราว';
  if (code === 'unsupported') return 'ผู้ให้บริการไม่รองรับ interval/session นี้';
  if (code === 'provider-not-configured') return 'ยังไม่ได้ตั้งค่าผู้ให้บริการ Intraday';
  if (code === 'insufficient-data') return 'ไม่มีแท่งราคาจริงในช่วงที่เลือก';
  return 'Intraday data ไม่พร้อมใช้งาน';
}

export function IntradayChartPanel({ symbol, active }: { symbol: string; active: boolean }) {
  const appActive = useAppActive();
  const [interval, setInterval] = useState<DisplayInterval>('60m');
  const [range, setRange] = useState<IntradayRange>('5d');
  const [sessionMode, setSessionMode] = useState<IntradaySessionMode>('regular');
  const [series, setSeries] = useState<CanonicalIntradaySeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [unsupported, setUnsupported] = useState<Partial<Record<DisplayInterval, string>>>({});
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [saveData] = useState(() => typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData));
  const [userStarted, setUserStarted] = useState(false);
  const cache = useRef(new Map<string, CanonicalIntradaySeries>());
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const sourceInterval: IntradayInterval = interval === '4h' ? '60m' : interval;
  const requestKey = `${symbol}:${sourceInterval}:${range}:${sessionMode}`;

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const request = useCallback(async (force = false) => {
    if (!active || !appActive) return;
    if (!navigator.onLine) { setError({ code: 'offline', message: 'ออฟไลน์อยู่ จึงไม่เรียกผู้ให้บริการ' }); return; }
    if (!force) {
      const saved = cache.current.get(requestKey);
      if (saved) { setSeries(saved); setError(null); return; }
    }
    if (Date.now() < cooldownUntil) return;
    const requestGeneration = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ symbol, interval: sourceInterval, range, session: sessionMode });
      const response = await fetch(`/api/market/history/intraday?${query.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const payload = await response.json() as Envelope;
      if (!response.ok) {
        const retry = Number(response.headers.get('Retry-After') ?? payload.error?.retryAfterSeconds ?? 0);
        if (retry > 0) { const deadline = Date.now() + retry * 1_000; setNow(Date.now()); setCooldownUntil(deadline); }
        throw Object.assign(new Error(intradayError(payload.error?.code)), { code: payload.error?.code });
      }
      const parsed = canonicalIntradaySeriesSchema.safeParse(payload.data);
      if (!parsed.success) throw Object.assign(new Error('Intraday response validation failed'), { code: 'invalid-response' });
      if (generation.current !== requestGeneration) return;
      cache.current.set(requestKey, parsed.data);
      setSeries(parsed.data); setUnsupported((current) => ({ ...current, [interval]: undefined }));
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      const code = (cause as { code?: string }).code;
      const message = cause instanceof Error ? cause.message : 'Intraday unavailable';
      setSeries(null); setError({ code, message });
      if (['forbidden', 'unsupported', 'insufficient-data'].includes(code ?? '')) setUnsupported((current) => ({ ...current, [interval]: message }));
    } finally { if (generation.current === requestGeneration) setLoading(false); }
  }, [active, appActive, cooldownUntil, interval, range, requestKey, sessionMode, sourceInterval, symbol]);

  useEffect(() => {
    if (!active || !appActive || (saveData && !userStarted)) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void request(); });
    return () => { cancelled = true; abort.current?.abort(); };
  }, [active, appActive, request, saveData, userStarted]);
  useEffect(() => () => abort.current?.abort(), []);

  const bars = useMemo(() => {
    if (!series) return [];
    return interval === '4h' ? aggregateSessionAwareH4(series.bars) : series.bars;
  }, [interval, series]);
  const prices = useMemo(() => bars.map((bar) => ({ date: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })), [bars]);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1_000));

  if (saveData && !userStarted) return <div className="rounded-xl border border-slate-700 p-5 text-sm text-slate-300"><p>Data Saver เปิดอยู่ ระบบจึงยังไม่โหลด Intraday</p><button type="button" className="mt-3 min-h-11 rounded-lg border border-[#D4FF00]/40 px-3 text-[#D4FF00]" onClick={() => setUserStarted(true)}>โหลด Intraday</button></div>;

  return <div className="space-y-3" data-testid="intraday-chart-panel">
    <div className="flex flex-wrap gap-2">{intervals.map((item) => <button key={item.id} type="button" title={unsupported[item.id] ?? item.source} disabled={Boolean(unsupported[item.id])} onClick={() => { setInterval(item.id); setError(null); setSeries(null); }} className={`min-h-11 rounded-full border px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${interval === item.id ? 'border-[#D4FF00] bg-[#D4FF00] text-black' : 'border-slate-700 text-slate-300'}`}>{item.label}</button>)}
      <select aria-label="Intraday range" value={range} onChange={(event) => { setRange(event.target.value as IntradayRange); setError(null); setSeries(null); }} className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200"><option value="1d">1 day</option><option value="5d">5 days</option><option value="1m">1 month</option></select>
      <select aria-label="Market session" value={sessionMode} onChange={(event) => { setSessionMode(event.target.value as IntradaySessionMode); setError(null); setSeries(null); }} className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200"><option value="regular">Regular session</option><option value="extended">Extended (provider permitting)</option></select>
      <button type="button" disabled={loading || cooldown > 0 || !appActive} onClick={() => void request(true)} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 disabled:opacity-40">{cooldown ? `Refresh ${cooldown}s` : 'Refresh'}</button>
    </div>
    <DataProvenance status={series?.status ?? (error ? 'unavailable' : 'delayed')} provider={series?.provider} asOf={series?.asOf} delayedMinutes={series?.delayedMinutes} reason={error?.message ?? (interval === '4h' ? 'H4 derived only from real 60m regular-session bars' : null)}/>
    {loading && !series && <Skeleton className="h-[420px] w-full rounded-xl" />}
    {error && !loading && <div role="alert" className="flex h-[300px] flex-col items-center justify-center rounded-xl border border-amber-500/20 p-4 text-center text-sm text-amber-200"><p>{error.message}</p><p className="mt-1 text-xs text-slate-500">ไม่มีการสร้างแท่งราคา Intraday หรือ H4 ทดแทนจาก Daily</p><button type="button" disabled={cooldown > 0} onClick={() => { setError(null); setUserStarted(true); void request(true); }} className="mt-3 min-h-11 rounded-lg border border-slate-700 px-3 disabled:opacity-40">{cooldown ? `ลองใหม่ใน ${cooldown}s` : 'ลองใหม่'}</button></div>}
    {series && prices.length > 0 && <><p className="text-xs text-slate-500">{prices.length.toLocaleString()} bars · {series.exchangeTimezone} · {sessionMode}{interval === '4h' ? ' · session-aware H4' : ''}</p><Chart symbol={symbol} prices={prices} visibleBarCount={Math.min(120, prices.length)} chartType="candlestick" /></>}
    {series && prices.length === 0 && <p className="rounded-xl border border-amber-500/20 p-4 text-sm text-amber-200">ไม่มีแท่งราคาจริงสำหรับ timeframe/session นี้ จึงปิดการแสดงผล</p>}
  </div>;
}
