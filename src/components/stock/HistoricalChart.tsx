'use client';

import { useMemo, useState } from 'react';
import {
  Area, Bar, Brush, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { HistoricalPrice } from '@/src/lib/market-data/types';
import type { BollingerPoint, IchimokuPoint, TechnicalAnalysis, TechnicalIndicatorId } from '@/src/lib/analytics/technical/types';
import type { AdvancedChartType, ChartCandle } from '@/src/lib/analytics/chart-types/types';
import { heikinAshi, rawChartCandles } from '@/src/lib/analytics/chart-types/calculations';
import type { SupportResistanceResult, SupportResistanceZone } from '@/src/lib/analytics/support-resistance/types';
import type { VolumeProfileResult } from '@/src/lib/analytics/volume-profile/types';
import type { FibonacciResult } from '@/src/lib/analytics/fibonacci/types';

const colors: Record<TechnicalIndicatorId, string> = {
  sma: '#38bdf8', sma50: '#0ea5e9', sma100: '#6366f1', sma200: '#8b5cf6',
  ema: '#f59e0b', ema50: '#fb923c', ema100: '#f97316', ema200: '#ef4444',
  bollinger: '#a78bfa', rsi: '#2dd4bf', macd: '#fb7185', atr: '#facc15',
  volume: '#64748b', averageVolume: '#60a5fa', averageVolume50: '#818cf8',
  stochastic: '#22d3ee', adx: '#e879f9', obv: '#34d399', ichimoku: '#f472b6', roc: '#c084fc', vwap: '#fde047',
};
const OVERLAYS: TechnicalIndicatorId[] = ['sma', 'sma50', 'sma100', 'sma200', 'ema', 'ema50', 'ema100', 'ema200', 'bollinger', 'ichimoku', 'vwap'];
const labels: Record<TechnicalIndicatorId, string> = {
  sma: 'SMA 20', sma50: 'SMA 50', sma100: 'SMA 100', sma200: 'SMA 200', ema: 'EMA 20', ema50: 'EMA 50', ema100: 'EMA 100', ema200: 'EMA 200',
  rsi: 'RSI 14', macd: 'MACD', bollinger: 'Bollinger', atr: 'ATR 14', volume: 'Volume', averageVolume: 'Average Volume 20', averageVolume50: 'Average Volume 50',
  stochastic: 'Stochastic 14/3/3', adx: 'ADX / DMI 14', obv: 'OBV', ichimoku: 'Ichimoku', roc: 'ROC 12', vwap: 'Session VWAP',
};

type ChartDatum = ChartCandle & Record<string, number | string | boolean | HistoricalPrice | [number, number] | undefined>;

function mergePriceData(prices: HistoricalPrice[], chartType: AdvancedChartType, technical: TechnicalAnalysis | undefined, enabled: TechnicalIndicatorId[]): ChartDatum[] {
  const candles = chartType === 'heikin-ashi' ? heikinAshi(prices) : rawChartCandles(prices);
  const data = candles.map((candle, index) => ({ ...candle, range: [candle.low, candle.high] as [number, number], previousClose: index ? candles[index - 1].raw.close : candle.raw.open })) as ChartDatum[];
  const byDate = new Map(data.map((point) => [point.date, point]));
  if (technical?.status !== 'available') return data;
  enabled.forEach((id) => {
    const result = technical.indicators[id]; if (result.status !== 'available') return;
    result.points.forEach((point) => {
      const target = byDate.get(point.date); if (!target) return; target[id] = point.value;
      if (id === 'bollinger') { const band = point as BollingerPoint; target.bbUpper = band.upper; target.bbMiddle = band.middle; target.bbLower = band.lower; }
      if (id === 'ichimoku') { const cloud = point as IchimokuPoint; target.ichimokuConversion = cloud.conversion; target.ichimokuBase = cloud.base; target.ichimokuA = cloud.leadingA ?? undefined; target.ichimokuB = cloud.leadingB ?? undefined; }
    });
  });
  return data;
}

interface ShapeProps { x?: number; y?: number; width?: number; height?: number; payload?: ChartDatum; }
function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload, hollowStyle = false, ohlc = false }: ShapeProps & { hollowStyle?: boolean; ohlc?: boolean }) {
  if (!payload) return null;
  const span = payload.high - payload.low || 1; const scale = height / span; const openY = y + (payload.high - payload.open) * scale; const closeY = y + (payload.high - payload.close) * scale;
  const rawDirection = payload.raw.close === payload.raw.open ? 'flat' : payload.raw.close > (payload.previousClose as number) ? 'up' : 'down';
  const stroke = rawDirection === 'flat' ? '#94a3b8' : rawDirection === 'up' ? '#34d399' : '#fb7185'; const center = x + width / 2;
  if (ohlc) return <g><line x1={center} x2={center} y1={y} y2={y + height} stroke={stroke}/><line x1={x} x2={center} y1={openY} y2={openY} stroke={stroke}/><line x1={center} x2={x + width} y1={closeY} y2={closeY} stroke={stroke}/></g>;
  const bodyY = Math.min(openY, closeY); const bodyHeight = Math.max(Math.abs(closeY - openY), 1); const isHollow = hollowStyle && payload.close > payload.open;
  return <g><line x1={center} x2={center} y1={y} y2={y + height} stroke={stroke}/><rect x={x + Math.max(1, width * 0.15)} y={bodyY} width={Math.max(1, width * 0.7)} height={bodyHeight} fill={isHollow ? '#151B28' : stroke} stroke={stroke}/></g>;
}

interface TooltipEntry { payload?: ChartDatum; }
const compactVolume = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
function PriceTooltip({ active, payload, chartType }: { active?: boolean; payload?: TooltipEntry[]; chartType: AdvancedChartType }) {
  const point = payload?.[0]?.payload; if (!active || !point) return null; const raw = point.raw;
  const row = (name: string, candle: HistoricalPrice | ChartDatum) => <div className="grid grid-cols-4 gap-2"><span className="col-span-4 text-[10px] uppercase text-slate-500">{name}</span><span>O {candle.open.toFixed(2)}</span><span>H {candle.high.toFixed(2)}</span><span>L {candle.low.toFixed(2)}</span><span>C {candle.close.toFixed(2)}</span></div>;
  return <div className="min-w-56 rounded-lg border border-slate-700 bg-[#151B28] p-3 text-xs text-slate-200 shadow-xl"><p className="mb-2 font-semibold">{point.date}</p>{row('Raw OHLC', raw)}{chartType === 'heikin-ashi' && <div className="mt-2 border-t border-slate-700 pt-2">{row('Heikin Ashi (transformed)', point)}</div>}<p className="mt-2 text-slate-400">Volume {raw.volume.toLocaleString()} ({compactVolume(raw.volume)})</p></div>;
}

function SecondaryChart({ id, technical }: { id: Exclude<TechnicalIndicatorId, 'sma' | 'sma50' | 'sma100' | 'sma200' | 'ema' | 'ema50' | 'ema100' | 'ema200' | 'bollinger' | 'ichimoku' | 'vwap' | 'volume'>; technical: Extract<TechnicalAnalysis, { status: 'available' }> }) {
  const result = technical.indicators[id]; if (result.status !== 'available') return <p className="rounded-lg border border-amber-500/20 p-3 text-sm text-amber-300">{result.reason}</p>;
  const domain = id === 'rsi' || id === 'stochastic' ? [0, 100] : ['auto', 'auto'];
  return <section aria-label={`${labels[id]} chart`} className="rounded-xl border border-slate-800 bg-[#151B28]/50 p-2"><div className="mb-1 flex justify-between px-2 text-xs"><span className="font-semibold text-slate-300">{labels[id]}</span><span className="font-mono text-slate-500">ล่าสุด {result.latest.value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div><div className="h-36"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={result.points} margin={{ top: 4, right: 18, bottom: 0, left: -16 }}><CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" hide/><YAxis domain={domain} tick={{ fontSize: 9 }} stroke="#64748b"/><Tooltip contentStyle={{ background: '#151B28', border: '1px solid #334155', borderRadius: 8 }}/>{id === 'rsi' && <><ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="3 3"/><ReferenceLine y={30} stroke="#38bdf8" strokeDasharray="3 3"/></>}<Line type="monotone" dataKey="value" name={labels[id]} stroke={colors[id]} dot={false} isAnimationActive={false}/>{id === 'macd' && <><Line type="monotone" dataKey="signal" name="Signal" stroke="#facc15" dot={false} isAnimationActive={false}/><Bar dataKey="histogram" name="Histogram" fill="#94a3b8" isAnimationActive={false}/></>}{id === 'stochastic' && <Line type="monotone" dataKey="d" name="%D" stroke="#facc15" dot={false} isAnimationActive={false}/>} {id === 'adx' && <><Line type="monotone" dataKey="plusDi" name="+DI" stroke="#34d399" dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="minusDi" name="-DI" stroke="#fb7185" dot={false} isAnimationActive={false}/></>}</ComposedChart></ResponsiveContainer></div></section>;
}

function zoneColor(zone: SupportResistanceZone) { return zone.type === 'support' ? '#34d399' : zone.type === 'resistance' ? '#fb7185' : '#94a3b8'; }

interface Props {
  prices: HistoricalPrice[]; technical?: TechnicalAnalysis; enabledIndicators?: TechnicalIndicatorId[]; chartType?: AdvancedChartType;
  supportResistance?: SupportResistanceResult; volumeProfile?: VolumeProfileResult; fibonacci?: FibonacciResult;
  showVolume?: boolean; showVpvr?: boolean; showFibonacci?: boolean; showSmartSupportResistance?: boolean;
  showSupport?: boolean; showResistance?: boolean;
}

export default function HistoricalChart({ prices, technical, enabledIndicators = [], chartType = 'area', supportResistance, volumeProfile, fibonacci, showVolume = true, showVpvr = false, showFibonacci = false, showSmartSupportResistance = false, showSupport = false, showResistance = false }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = useMemo(() => mergePriceData(prices, chartType, technical, enabledIndicators), [chartType, enabledIndicators, prices, technical]);
  const structuralZones = useMemo(() => supportResistance?.status === 'available' ? supportResistance.zones.filter((zone) => showSmartSupportResistance || (zone.type === 'support' ? showSupport : showResistance)) : [], [showResistance, showSmartSupportResistance, showSupport, supportResistance]);
  const fastZones = showSmartSupportResistance && supportResistance?.status === 'available' ? supportResistance.fastZones : [];
  if (!prices.length || !data.length) return <div className="flex h-full items-center justify-center text-sm text-slate-500">ไม่มีข้อมูลกราฟที่ถูกต้องในช่วงนี้</div>;
  const secondary = enabledIndicators.filter((id) => !OVERLAYS.includes(id) && id !== 'volume');
  const allZones = [...structuralZones, ...fastZones]; const lastDate = data.at(-1)!.date;
  const mainChart = <div className="h-[280px] md:h-[390px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} syncId="nexora-price-volume" syncMethod="value" margin={{ top: 8, right: 18, bottom: 0, left: -16 }}><defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D4FF00" stopOpacity={0.3}/><stop offset="1" stopColor="#D4FF00" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#64748b" minTickGap={36}/><YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} stroke="#64748b"/><Tooltip content={<PriceTooltip chartType={chartType}/>} cursor={{ stroke: '#64748b', strokeDasharray: '3 3' }}/><Legend verticalAlign="top" height={28}/>
    {allZones.map((zone) => <ReferenceArea key={zone.id} y1={zone.lower} y2={zone.upper} fill={zoneColor(zone)} fillOpacity={zone.classification.startsWith('Strong') ? 0.18 : 0.1} stroke={zoneColor(zone)} strokeDasharray={zone.type === 'fast-zone' ? '4 3' : undefined} strokeOpacity={0.55} label={{ value: `${zone.classification} · ${zone.midpoint.toLocaleString()}${zone.type === 'fast-zone' ? '' : ` · ${zone.strengthScore}`}`, position: 'insideTopRight', fill: zoneColor(zone), fontSize: 9 }}/>) }
    {showVpvr && volumeProfile?.status === 'available' && volumeProfile.bins.filter((bin) => bin.volume > 0).map((bin) => { const width = Math.max(1, Math.round(bin.normalizedVolume * Math.min(data.length * 0.28, 20))); const start = data[Math.max(0, data.length - 1 - width)].date; return <ReferenceArea key={`vpvr-${bin.index}`} x1={start} x2={lastDate} y1={bin.priceLow} y2={bin.priceHigh} fill="#64748b" fillOpacity={0.18} strokeOpacity={0}/>; })}
    {showVpvr && volumeProfile?.status === 'available' && <><ReferenceLine y={(volumeProfile.poc.priceLow + volumeProfile.poc.priceHigh) / 2} stroke="#D4FF00" strokeDasharray="5 3" label={{ value: `POC ${compactVolume(volumeProfile.poc.volume)}`, position: 'insideTopLeft', fill: '#D4FF00', fontSize: 9 }}/><ReferenceLine y={volumeProfile.vah} stroke="#94a3b8" strokeDasharray="2 4"/><ReferenceLine y={volumeProfile.val} stroke="#94a3b8" strokeDasharray="2 4"/></>}
    {showFibonacci && fibonacci?.status === 'available' && fibonacci.levels.map((level) => <ReferenceLine key={level.ratio} y={level.price} stroke="#c084fc" strokeDasharray="4 3" label={{ value: `Fib ${level.ratio}`, position: 'insideLeft', fill: '#c084fc', fontSize: 9 }}/>) }
    {chartType === 'area' && <Area type="monotone" dataKey="close" name="Raw close" stroke="#D4FF00" fill="url(#priceFill)" dot={false} isAnimationActive={false}/>} {chartType === 'line' && <Line type="monotone" dataKey="close" name="Raw close" stroke="#D4FF00" dot={false} isAnimationActive={false}/>} {(chartType === 'candlestick' || chartType === 'heikin-ashi') && <Bar dataKey="range" name={chartType === 'heikin-ashi' ? 'Heikin Ashi' : 'Candlestick'} shape={<CandleShape/>} isAnimationActive={false}/>} {chartType === 'hollow-candles' && <Bar dataKey="range" name="Hollow Candles" shape={<CandleShape hollowStyle/>} isAnimationActive={false}/>} {chartType === 'ohlc' && <Bar dataKey="range" name="OHLC" shape={<CandleShape ohlc/>} isAnimationActive={false}/>}
    {enabledIndicators.filter((id) => ['sma', 'sma50', 'sma100', 'sma200', 'ema', 'ema50', 'ema100', 'ema200', 'vwap'].includes(id)).map((id) => { const result = technical?.status === 'available' ? technical.indicators[id] : undefined; const latest = result?.status === 'available' ? result.latest.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : null; return <Line key={id} type="monotone" dataKey={id} name={`${labels[id]}${latest ? ` · ${latest}` : ''}`} stroke={colors[id]} dot={false} connectNulls={false} isAnimationActive={false}/>; })}
    {enabledIndicators.includes('bollinger') && <><Line type="monotone" dataKey="bbUpper" name="BB Upper" stroke={colors.bollinger} strokeDasharray="4 3" dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="bbMiddle" name="BB Middle" stroke={colors.bollinger} dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="bbLower" name="BB Lower" stroke={colors.bollinger} strokeDasharray="4 3" dot={false} isAnimationActive={false}/></>} {enabledIndicators.includes('ichimoku') && <><Line type="monotone" dataKey="ichimokuConversion" name="Tenkan" stroke="#22d3ee" dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="ichimokuBase" name="Kijun" stroke="#fb7185" dot={false} isAnimationActive={false}/></>} <Brush dataKey="date" height={20} stroke="#64748b" travellerWidth={8}/></ComposedChart></ResponsiveContainer></div>;
  const volumePane = showVolume && <section aria-label="Volume pane" className="rounded-b-xl border-x border-b border-slate-800 bg-[#151B28]/35 px-0 pb-[max(0.25rem,env(safe-area-inset-bottom))]"><div className="flex items-center justify-between px-3 pt-1 text-[10px] text-slate-500"><span>Volume · raw OHLC direction</span><span>{compactVolume(prices.at(-1)!.volume)}</span></div><div className="h-20 md:h-28"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} syncId="nexora-price-volume" syncMethod="value" margin={{ top: 2, right: 18, bottom: 2, left: -16 }}><CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" hide/><YAxis yAxisId="volume" orientation="right" width={48} tick={{ fontSize: 9 }} stroke="#64748b" domain={[0, 'dataMax']}/><Tooltip content={<PriceTooltip chartType={chartType}/>} cursor={{ fill: '#64748b18' }}/><Bar yAxisId="volume" dataKey="volume" name="Volume" isAnimationActive={false}>{data.map((point) => <Cell key={point.date} fill={point.raw.close > point.raw.open ? '#34d39999' : point.raw.close < point.raw.open ? '#fb718599' : '#94a3b899'}/>)}</Bar></ComposedChart></ResponsiveContainer></div></section>;
  const content = <div className="space-y-3"><div>{mainChart}{volumePane}</div>{chartType === 'heikin-ashi' && <p className="text-xs text-amber-300">Indicators, Volume และ Smart S/R ใช้ raw OHLCV; tooltip แยกค่าดิบกับค่าที่แปลงแล้ว</p>}{showVpvr && <p className="text-xs text-slate-500">Estimated from historical OHLCV; not order-book data. Coverage {volumeProfile ? Math.round(volumeProfile.coverage * 100) : 0}%.</p>}{showVpvr && volumeProfile?.status === 'unavailable' && <p className="text-xs text-amber-300">VPVR unavailable: {volumeProfile.reason}</p>}{showFibonacci && fibonacci?.status === 'unavailable' && <p className="text-xs text-amber-300">Fibonacci unavailable: {fibonacci.reason}</p>}{technical?.status === 'available' && secondary.map((id) => <SecondaryChart key={id} id={id as Parameters<typeof SecondaryChart>[0]['id']} technical={technical}/>)}{supportResistance?.status === 'available' && allZones.length > 0 && <details className="rounded-xl border border-slate-800 bg-[#151B28]/50 p-3 text-xs"><summary className="cursor-pointer text-slate-300">Smart S/R details ({allZones.length})</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{allZones.map((zone) => <div key={zone.id} className="rounded-lg border border-slate-700 p-2 text-slate-400"><p style={{ color: zoneColor(zone) }} className="font-semibold">{zone.classification} · {zone.midpoint.toLocaleString()} · {zone.strengthScore}/100</p><p>{zone.lower.toLocaleString()}–{zone.upper.toLocaleString()} · {zone.reasons.map((reason) => reason.label).slice(0, 2).join(' + ')}</p></div>)}</div></details>}</div>;
  const latest = prices.at(-1)!;
  return <div className="relative"><button type="button" aria-label="เปิดกราฟเต็มจอ" onClick={() => setFullscreen(true)} className="absolute right-3 top-9 z-10 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white">เต็มจอ</button>{content}<p className="sr-only" aria-live="polite">กราฟ {prices.length} จุด ถึงวันที่ {latest.date} ราคาปิดล่าสุด {latest.close}. ประเภท {chartType}. เปิด indicators {enabledIndicators.join(', ') || 'ไม่มี'}.</p>{fullscreen && <div role="dialog" aria-modal="true" aria-label="กราฟเต็มจอ" className="fixed inset-0 z-50 overflow-y-auto bg-[#0A0E17] p-3 sm:p-6"><button type="button" autoFocus onClick={() => setFullscreen(false)} className="fixed right-4 top-4 z-10 rounded-lg bg-slate-800 px-4 py-2 text-sm">ปิด</button><div className="pt-12">{content}</div></div>}</div>;
}
