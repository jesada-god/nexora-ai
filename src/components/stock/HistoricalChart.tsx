'use client';

import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { HistoricalPrice } from '@/src/lib/market-data/types';
import type { TechnicalAnalysis, TechnicalIndicatorId } from '@/src/lib/analytics/technical/types';

const colors = { sma: '#38bdf8', ema: '#f59e0b', bollinger: '#a78bfa', rsi: '#2dd4bf', macd: '#fb7185', atr: '#facc15', averageVolume: '#60a5fa' };

function mergePriceData(prices: HistoricalPrice[], technical: TechnicalAnalysis | undefined, enabled: TechnicalIndicatorId[]) {
  const data = prices.map((price) => ({ ...price })) as Array<HistoricalPrice & Record<string, number | string | undefined>>;
  const byDate = new Map(data.map((point) => [point.date, point]));
  if (technical?.status !== 'available') return data;
  const add = (id: TechnicalIndicatorId, key: string) => {
    const result = technical.indicators[id];
    if (!enabled.includes(id) || result.status !== 'available') return;
    result.points.forEach((point) => { const target = byDate.get(point.date); if (target) target[key] = point.value; });
  };
  add('sma', 'sma'); add('ema', 'ema');
  if (enabled.includes('bollinger') && technical.indicators.bollinger.status === 'available') {
    technical.indicators.bollinger.points.forEach((point) => { const target = byDate.get(point.date); if (target) { target.bbUpper = point.upper; target.bbMiddle = point.middle; target.bbLower = point.lower; } });
  }
  return data;
}
function IndicatorChart({ id, technical }: { id: Exclude<TechnicalIndicatorId, 'sma' | 'ema' | 'bollinger'>; technical: Extract<TechnicalAnalysis, { status: 'available' }> }) {
  const result = technical.indicators[id];
  if (result.status !== 'available') return <p className="rounded-lg border border-amber-500/20 p-3 text-sm text-amber-300">{result.reason}</p>;
  const label = id === 'averageVolume' ? 'Average Volume' : id.toUpperCase();
  return <section aria-label={`${label} chart`} className="rounded-xl border border-slate-800 bg-[#151B28]/50 p-2"><div className="mb-1 flex justify-between px-2 text-xs"><span className="font-semibold text-slate-300">{label}</span><span className="font-mono text-slate-500">ล่าสุด {result.latest.value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div><div className="h-36"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.points} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}><CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" hide/><YAxis domain={id === 'rsi' ? [0, 100] : ['auto', 'auto']} tick={{ fontSize: 9 }} stroke="#64748b"/><Tooltip contentStyle={{ background: '#151B28', border: '1px solid #334155', borderRadius: 8 }}/>{id === 'rsi' && <><ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="3 3"/><ReferenceLine y={30} stroke="#38bdf8" strokeDasharray="3 3"/></>}<Line type="monotone" dataKey="value" name={label} stroke={colors[id]} dot={false} isAnimationActive={false}/>{id === 'macd' && <><Line type="monotone" dataKey="signal" name="Signal" stroke="#facc15" dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="histogram" name="Histogram" stroke="#94a3b8" dot={false} isAnimationActive={false}/></>}</LineChart></ResponsiveContainer></div></section>;
}

export default function HistoricalChart({ prices, technical, enabledIndicators = [] }: { prices: HistoricalPrice[]; technical?: TechnicalAnalysis; enabledIndicators?: TechnicalIndicatorId[] }) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = useMemo(() => mergePriceData(prices, technical, enabledIndicators), [enabledIndicators, prices, technical]);
  if (!prices.length) return <div className="flex h-full items-center justify-center text-sm text-slate-500">ไม่มีข้อมูลกราฟในช่วงนี้</div>;
  const secondary = enabledIndicators.filter((id): id is Exclude<TechnicalIndicatorId, 'sma' | 'ema' | 'bollinger'> => !['sma', 'ema', 'bollinger'].includes(id));
  const content = <div className="space-y-3"><div className="h-[300px] md:h-[420px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}><defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D4FF00" stopOpacity={0.3}/><stop offset="1" stopColor="#D4FF00" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#64748b" minTickGap={36}/><YAxis domain={['auto','auto']} tick={{ fontSize: 10 }} stroke="#64748b"/><Tooltip contentStyle={{ background: '#151B28', border: '1px solid #334155', borderRadius: 8 }}/><Legend verticalAlign="top" height={28}/><Area type="monotone" dataKey="close" name="Close" stroke="#D4FF00" fill="url(#priceFill)" dot={false} isAnimationActive={false}/>{enabledIndicators.includes('sma') && <Line type="monotone" dataKey="sma" name="SMA 20" stroke={colors.sma} dot={false} isAnimationActive={false}/>} {enabledIndicators.includes('ema') && <Line type="monotone" dataKey="ema" name="EMA 20" stroke={colors.ema} dot={false} isAnimationActive={false}/>} {enabledIndicators.includes('bollinger') && <><Line type="monotone" dataKey="bbUpper" name="BB Upper" stroke={colors.bollinger} strokeDasharray="4 3" dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="bbMiddle" name="BB Middle" stroke={colors.bollinger} dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="bbLower" name="BB Lower" stroke={colors.bollinger} strokeDasharray="4 3" dot={false} isAnimationActive={false}/></>}</AreaChart></ResponsiveContainer></div>{technical?.status === 'available' && secondary.map((id) => <IndicatorChart key={id} id={id} technical={technical}/>)}</div>;
  const latest = prices[prices.length - 1];
  return <div className="relative"><button type="button" onClick={() => setFullscreen(true)} className="absolute right-3 top-3 z-10 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white">เต็มจอ</button>{content}<p className="sr-only" aria-live="polite">กราฟ {prices.length} จุด ถึงวันที่ {latest.date} ราคาปิดล่าสุด {latest.close}. เปิด indicators {enabledIndicators.join(', ') || 'ไม่มี'}.</p>{fullscreen && <div role="dialog" aria-modal="true" aria-label="กราฟเต็มจอ" className="fixed inset-0 z-50 overflow-y-auto bg-[#0A0E17] p-3 sm:p-6"><button type="button" autoFocus onClick={() => setFullscreen(false)} className="fixed right-4 top-4 z-10 rounded-lg bg-slate-800 px-4 py-2 text-sm">ปิด</button><div className="pt-12">{content}</div></div>}</div>;
}
