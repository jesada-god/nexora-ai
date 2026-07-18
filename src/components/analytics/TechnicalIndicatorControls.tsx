'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { HistoricalPrices, MarketDataEnvelope } from '@/src/lib/market-data/types';
import { calculateTechnicalAnalysis } from '@/src/lib/analytics/technical/calculations';
import type { TechnicalIndicatorId } from '@/src/lib/analytics/technical/types';

const Chart = dynamic(() => import('@/src/components/stock/HistoricalChart'), { ssr: false });
const STORAGE_KEY = 'nexora:technical-indicators:v1';
const INDICATORS: Array<{ id: TechnicalIndicatorId; label: string }> = [
  { id: 'sma', label: 'SMA 20' }, { id: 'ema', label: 'EMA 20' }, { id: 'rsi', label: 'RSI 14 (Wilder)' },
  { id: 'macd', label: 'MACD 12/26/9' }, { id: 'bollinger', label: 'Bollinger 20/2' },
  { id: 'atr', label: 'ATR 14' }, { id: 'averageVolume', label: 'Average Volume 20' },
];

export function TechnicalIndicatorControls({ history, meta }: { history: HistoricalPrices; meta: MarketDataEnvelope<HistoricalPrices>['meta'] }) {
  const [enabled, setEnabled] = useState<TechnicalIndicatorId[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    queueMicrotask(() => {
      update();
      try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
        if (Array.isArray(saved)) setEnabled(saved.filter((id): id is TechnicalIndicatorId => INDICATORS.some((item) => item.id === id)).slice(0, media.matches ? 3 : 7));
      } catch { /* invalid device preference is ignored */ }
    });
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const analysis = useMemo(() => calculateTechnicalAnalysis(history.prices, {
    symbol: history.symbol, source: meta.provider, freshness: meta.freshness,
  }), [history, meta.freshness, meta.provider]);
  const toggle = (id: TechnicalIndicatorId) => {
    const next = enabled.includes(id) ? enabled.filter((value) => value !== id) : [...enabled, id];
    if (isMobile && next.length > 3) return;
    setEnabled(next); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };
  return <div className="space-y-3">
    <details className="rounded-xl border border-slate-800 bg-[#151B28] p-3">
      <summary className="cursor-pointer select-none text-sm font-semibold text-white">Indicators / Layers <span className="ml-2 text-xs font-normal text-slate-500">{enabled.length} เปิดอยู่</span></summary>
      <fieldset className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><legend className="sr-only">เลือก Technical Indicators</legend>{INDICATORS.map((item) => {
        const result = analysis.status === 'available' ? analysis.indicators[item.id] : null;
        const disabled = result?.status === 'unavailable' || (!enabled.includes(item.id) && isMobile && enabled.length >= 3);
        return <label key={item.id} className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${disabled ? 'border-slate-800 text-slate-600' : 'border-slate-700 text-slate-200'}`} title={result?.status === 'unavailable' ? result.reason : undefined}><input type="checkbox" checked={enabled.includes(item.id)} disabled={disabled} onChange={() => toggle(item.id)} className="accent-[#D4FF00]"/><span>{item.label}</span>{result?.status === 'available' && <span className="ml-auto font-mono text-[10px] text-slate-500">{result.latest.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}</label>;
      })}</fieldset>
      {isMobile && <p className="mt-2 text-xs text-slate-500">บนมือถือเปิดได้สูงสุด 3 indicators พร้อมกัน</p>}
      <details className="mt-3 border-t border-slate-800 pt-3 text-xs text-slate-400"><summary className="cursor-pointer text-slate-300">รายละเอียดวิธีคำนวณและแหล่งข้อมูล</summary><dl className="mt-2 grid gap-1 sm:grid-cols-2"><div>Symbol: <span className="text-slate-200">{analysis.symbol}</span></div><div>Source: <span className="text-slate-200">{analysis.dataSource ?? 'unavailable'}</span></div><div>Data points: <span className="text-slate-200">{analysis.dataPoints}</span></div><div>Latest data: <span className="text-slate-200">{analysis.latestDataAt ?? 'unavailable'}</span></div><div>Calculated: <span className="text-slate-200">{new Date(analysis.calculatedAt).toLocaleString('th-TH')}</span></div><div>Freshness: <span className="text-slate-200">{analysis.freshness.status}</span></div><div className="sm:col-span-2">Method: <span className="text-slate-200">{analysis.methodology}; price field = close</span></div></dl><ul className="mt-2 list-disc space-y-1 pl-4">{analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><p className="mt-2 text-amber-300">ค่าทั้งหมดคำนวณจากข้อมูลย้อนหลัง ไม่ใช่คำแนะนำหรือการรับประกันผลตอบแทน</p></details>
    </details>
    <Chart prices={history.prices} technical={analysis} enabledIndicators={enabled}/>
  </div>;
}
