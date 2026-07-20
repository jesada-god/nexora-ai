'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BollingerPoint, IchimokuPoint, TechnicalAnalysis, TechnicalIndicatorId } from '@/src/lib/analytics/technical/types';
import type { AdvancedChartType, ChartCandle } from '@/src/lib/analytics/chart-types/types';
import { heikinAshi, rawChartCandles } from '@/src/lib/analytics/chart-types/calculations';
import type { SupportResistanceResult } from '@/src/lib/analytics/support-resistance/types';
import type { VolumeProfileResult } from '@/src/lib/analytics/volume-profile/types';
import type { FibonacciResult } from '@/src/lib/analytics/fibonacci/types';
import { normalizeOhlcvTimeline, type NormalizedBar, type OhlcvInputBar } from '@/src/lib/analytics/chart-data/timeline';
import { fitLogicalRange, panLogicalRange, zoomLogicalRange, type LogicalRange } from '@/src/lib/analytics/chart-data/viewport';
import {
  buildSupportResistanceView,
  summaryRows,
  type ChartLevel,
  type SupportResistanceMode,
  type SupportResistanceView,
} from '@/src/lib/analytics/support-resistance/levels';
import { parseStrikeLines, strikeDistance, type StrikeLine } from '@/src/lib/analytics/chart-layers/strike-lines';

const PRICE_AXIS_WIDTH = 58;
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 8 } as const;
const DEFAULT_VISIBLE_BARS = 80;

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

type ChartDatum = ChartCandle & Record<string, number | string | boolean | NormalizedBar | [number, number] | null | undefined>;

function mergePriceData(prices: readonly OhlcvInputBar[], chartType: AdvancedChartType, technical: TechnicalAnalysis | undefined, enabled: TechnicalIndicatorId[]): ChartDatum[] {
  const normalized = normalizeOhlcvTimeline(prices);
  const candles = chartType === 'heikin-ashi'
    ? heikinAshi(normalized.map((bar) => ({ date: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0 })))
    : rawChartCandles(normalized.map((bar) => ({ date: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0 })));
  const data = candles.map((candle, index) => {
    const raw = normalized[index];
    return {
      ...candle,
      raw,
      volume: raw.volume,
      range: [candle.low, candle.high] as [number, number],
      previousClose: index ? normalized[index - 1].close : raw.open,
    };
  }) as ChartDatum[];
  const byTime = new Map(data.map((point) => [point.date, point]));
  if (technical?.status !== 'available') return data;
  enabled.forEach((id) => {
    const result = technical.indicators[id];
    if (result.status !== 'available') return;
    result.points.forEach((point) => {
      const target = byTime.get(point.date);
      if (!target) return;
      target[id] = point.value;
      if (id === 'bollinger') {
        const band = point as BollingerPoint;
        target.bbUpper = band.upper; target.bbMiddle = band.middle; target.bbLower = band.lower;
      }
      if (id === 'ichimoku') {
        const cloud = point as IchimokuPoint;
        target.ichimokuConversion = cloud.conversion; target.ichimokuBase = cloud.base;
        target.ichimokuA = cloud.leadingA ?? undefined; target.ichimokuB = cloud.leadingB ?? undefined;
      }
    });
  });
  return data;
}

interface ShapeProps { x?: number; y?: number; width?: number; height?: number; payload?: ChartDatum; }
function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload, hollowStyle = false, ohlc = false }: ShapeProps & { hollowStyle?: boolean; ohlc?: boolean }) {
  if (!payload) return null;
  const span = payload.high - payload.low || 1;
  const scale = height / span;
  const openY = y + (payload.high - payload.open) * scale;
  const closeY = y + (payload.high - payload.close) * scale;
  const direction = payload.raw.close >= payload.raw.open ? 'up' : 'down';
  const stroke = direction === 'up' ? '#34d399' : '#fb7185';
  const center = x + width / 2;
  if (ohlc) return <g><line x1={center} x2={center} y1={y} y2={y + height} stroke={stroke}/><line x1={x} x2={center} y1={openY} y2={openY} stroke={stroke}/><line x1={center} x2={x + width} y1={closeY} y2={closeY} stroke={stroke}/></g>;
  const bodyY = Math.min(openY, closeY);
  const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
  const isHollow = hollowStyle && payload.close >= payload.open;
  return <g><line x1={center} x2={center} y1={y} y2={y + height} stroke={stroke}/><rect x={x + Math.max(1, width * 0.15)} y={bodyY} width={Math.max(1, width * 0.7)} height={bodyHeight} fill={isHollow ? '#151B28' : stroke} stroke={stroke}/></g>;
}

const compactVolume = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const price = (value: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const signed = (value: number) => `${value >= 0 ? '+' : '-'}${price(Math.abs(value))}`;

export function formatChartTime(time: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(time);
  const parsed = new Date(dateOnly ? `${time}T00:00:00.000Z` : time);
  if (Number.isNaN(parsed.valueOf())) return time;
  return new Intl.DateTimeFormat('en-US', dateOnly
    ? { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }
    : { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(parsed);
}

function InspectionTooltip({ point, enabled, chartType }: { point: ChartDatum; enabled: TechnicalIndicatorId[]; chartType: AdvancedChartType }) {
  const raw = point.raw;
  const change = raw.close - Number(point.previousClose);
  const changePercent = Number(point.previousClose) === 0 ? null : change / Number(point.previousClose) * 100;
  return <div className="w-[min(19rem,calc(100vw-2rem))] rounded-lg border border-slate-700 bg-[#101621]/95 p-3 text-xs text-slate-200 shadow-xl backdrop-blur">
    <p className="mb-2 font-semibold">{formatChartTime(point.date)}</p>
    <div className="grid grid-cols-4 gap-x-3 gap-y-1 font-mono"><span>O {price(raw.open)}</span><span>H {price(raw.high)}</span><span>L {price(raw.low)}</span><span>C {price(raw.close)}</span></div>
    <div className="mt-2 grid grid-cols-2 gap-2 text-slate-400"><span>Change <b className={change >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{signed(change)}</b></span><span>Change % <b className={change >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{changePercent == null ? 'unavailable' : `${signed(changePercent)}%`}</b></span></div>
    <p className="mt-2 text-slate-400">Volume {raw.volume == null ? <span className="text-amber-300">unavailable</span> : `${raw.volume.toLocaleString('en-US')} (${compactVolume(raw.volume)})`}</p>
    {chartType === 'heikin-ashi' && <p className="mt-1 text-amber-300">Heikin Ashi C {price(point.close)} · raw OHLCV shown above</p>}
    {enabled.flatMap((id) => typeof point[id] === 'number' ? [<p key={id} className="mt-1 text-slate-400">{labels[id]} <span className="font-mono text-slate-200">{price(point[id] as number)}</span></p>] : [])}
  </div>;
}

function SecondaryChart({ id, technical }: { id: Exclude<TechnicalIndicatorId, 'sma' | 'sma50' | 'sma100' | 'sma200' | 'ema' | 'ema50' | 'ema100' | 'ema200' | 'bollinger' | 'ichimoku' | 'vwap' | 'volume'>; technical: Extract<TechnicalAnalysis, { status: 'available' }> }) {
  const result = technical.indicators[id];
  if (result.status !== 'available') return <p className="rounded-lg border border-amber-500/20 p-3 text-sm text-amber-300">{result.reason}</p>;
  const domain = id === 'rsi' || id === 'stochastic' ? [0, 100] : ['auto', 'auto'];
  return <section aria-label={`${labels[id]} chart`} className="rounded-xl border border-slate-800 bg-[#151B28]/50 p-2"><div className="mb-1 flex justify-between px-2 text-xs"><span className="font-semibold text-slate-300">{labels[id]}</span><span className="font-mono text-slate-500">Latest {result.latest.value.toLocaleString('en-US', { maximumFractionDigits: 3 })}</span></div><div className="h-36"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={result.points} margin={{ top: 4, right: 18, bottom: 0, left: -16 }}><CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" hide/><YAxis domain={domain} tick={{ fontSize: 9 }} stroke="#64748b"/><Tooltip contentStyle={{ background: '#151B28', border: '1px solid #334155', borderRadius: 8 }}/>{id === 'rsi' && <><ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="3 3"/><ReferenceLine y={30} stroke="#38bdf8" strokeDasharray="3 3"/></>}<Line type="monotone" dataKey="value" name={labels[id]} stroke={colors[id]} dot={false} isAnimationActive={false}/>{id === 'macd' && <><Line type="monotone" dataKey="signal" name="Signal" stroke="#facc15" dot={false} isAnimationActive={false}/><Bar dataKey="histogram" name="Histogram" fill="#94a3b8" isAnimationActive={false}/></>}{id === 'stochastic' && <Line type="monotone" dataKey="d" name="%D" stroke="#facc15" dot={false} isAnimationActive={false}/>} {id === 'adx' && <><Line type="monotone" dataKey="plusDi" name="+DI" stroke="#34d399" dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="minusDi" name="-DI" stroke="#fb7185" dot={false} isAnimationActive={false}/></>}</ComposedChart></ResponsiveContainer></div></section>;
}

function levelColor(level: ChartLevel) {
  return level.side === 'support' ? '#34d399' : level.side === 'resistance' ? '#fb7185' : '#facc15';
}

function SupportResistancePanel({ view }: { view: SupportResistanceView }) {
  if (view.status === 'unavailable') return <section aria-label="Support and resistance summary" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><h3 className="font-semibold text-white">แนวรับ–แนวต้าน</h3><p className="mt-2 text-sm text-amber-300">Unavailable: {view.reason}</p><p className="mt-1 text-xs text-slate-500">Missing: {view.missingInputs.join(', ')}</p></section>;
  const distance = strikeDistance(view.nearest.price, view.currentPrice);
  return <section aria-label="Support and resistance summary" className="rounded-xl border border-slate-800 bg-[#151B28]/70 p-3 sm:p-4">
    <div className="mb-3"><h3 className="font-semibold text-white">แนวรับ–แนวต้าน</h3><p className="mt-1 text-sm text-slate-300">ใกล้ถึง {view.nearest.label} ที่ ${price(view.nearest.price)} (ห่าง {Math.abs(distance.percent ?? 0).toFixed(2)}%)</p>{view.nearestEstimate && <p className="mt-1 text-xs text-amber-200">{view.nearestEstimate.label} · {view.nearestEstimate.basis}</p>}</div>
    <div className="space-y-1">{summaryRows(view).map((row) => {
      if ('current' in row) return <div key="current" className="grid min-h-12 grid-cols-[3.5rem_1fr] items-center rounded-lg border border-[#D4FF00]/40 bg-[#D4FF00]/10 px-3 text-sm"><b className="text-[#D4FF00]">Now</b><span className="text-right font-mono text-white">${price(row.price)}</span></div>;
      const gap = strikeDistance(row.price, view.currentPrice);
      return <div key={row.id} className="grid min-h-12 grid-cols-[3.5rem_1fr] items-center rounded-lg border border-slate-800 px-3 text-sm"><b style={{ color: levelColor(row) }}>{row.label}</b><div className="text-right"><p className="font-mono text-white">${price(row.price)} <span className="text-xs text-slate-500">{signed(gap.dollars)} · {gap.percent == null ? '—' : `${signed(gap.percent)}%`}</span></p><p className="truncate text-[10px] text-slate-500">{row.source} · asOf {row.asOf} · {row.timeframe}{row.score == null ? '' : ` · score ${row.score.toFixed(1)}`}</p></div></div>;
    })}</div>
    <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer text-slate-300">Methodology and limitations</summary><p className="mt-2">{view.methodology}</p>{view.limitations.map((limitation) => <p key={limitation} className="mt-1">{limitation}</p>)}</details>
  </section>;
}

interface Props {
  prices: readonly OhlcvInputBar[];
  symbol?: string;
  visibleBarCount?: number;
  technical?: TechnicalAnalysis;
  enabledIndicators?: TechnicalIndicatorId[];
  chartType?: AdvancedChartType;
  supportResistance?: SupportResistanceResult;
  volumeProfile?: VolumeProfileResult;
  fibonacci?: FibonacciResult;
  showVolume?: boolean;
  showVpvr?: boolean;
  showFibonacci?: boolean;
  showSmartSupportResistance?: boolean;
}

interface ChartMouseState { activeLabel?: string | number; activeTooltipIndex?: number; }

export default function HistoricalChart({ prices, symbol, visibleBarCount = DEFAULT_VISIBLE_BARS, technical, enabledIndicators = [], chartType = 'area', supportResistance, volumeProfile, fibonacci, showVolume = true, showVpvr = false, showFibonacci = false, showSmartSupportResistance = false }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; at: number; range: LogicalRange; velocity: number } | null>(null);
  const pinchRef = useRef<{ distance: number; range: LogicalRange } | null>(null);
  const longPressRef = useRef<number | null>(null);
  const lastTapRef = useRef(0);
  const viewportSnapshotRef = useRef<{ timelineKey: string; visibleBarCount: number; startTime: string | null; endTime: string | null } | null>(null);
  const previousSmartPropRef = useRef(showSmartSupportResistance);
  const [fullscreen, setFullscreen] = useState(false);
  const [volumeVisible, setVolumeVisible] = useState(showVolume);
  const [volumeMode, setVolumeMode] = useState<'separate' | 'overlay'>('separate');
  const [logicalRange, setLogicalRange] = useState<LogicalRange>(() => fitLogicalRange(prices.length));
  const [crosshairTime, setCrosshairTime] = useState<string | null>(null);
  const [inspectionLocked, setInspectionLocked] = useState(false);
  const [showSr, setShowSr] = useState(showSmartSupportResistance);
  const [srMode, setSrMode] = useState<SupportResistanceMode>(showSmartSupportResistance ? 'structure' : 'pivot');
  const [strikeEditorOpen, setStrikeEditorOpen] = useState(false);
  const [strikeLines, setStrikeLines] = useState<StrikeLine[]>([]);
  const [editingStrikeId, setEditingStrikeId] = useState<string | null>(null);
  const [strikePrice, setStrikePrice] = useState('');
  const [strikeLabel, setStrikeLabel] = useState('');
  const [strikeType, setStrikeType] = useState<'call' | 'put'>('call');
  const [strikeExpiration, setStrikeExpiration] = useState('');

  const normalized = useMemo(() => normalizeOhlcvTimeline(prices), [prices]);
  const data = useMemo(() => mergePriceData(prices, chartType, technical, enabledIndicators), [chartType, enabledIndicators, prices, technical]);
  const timelineKey = `${data[0]?.date ?? ''}:${data.at(-1)?.date ?? ''}:${data.length}`;
  const visibleData = useMemo(() => data.slice(logicalRange.start, logicalRange.end + 1), [data, logicalRange.end, logicalRange.start]);
  const crosshairPoint = useMemo(() => data.find((point) => point.date === crosshairTime) ?? null, [crosshairTime, data]);
  const crosshairVisibleIndex = crosshairPoint ? visibleData.findIndex((point) => point.date === crosshairPoint.date) : -1;
  const srView = useMemo(() => buildSupportResistanceView(srMode, normalized, supportResistance), [normalized, srMode, supportResistance]);
  const storageSymbol = symbol ?? technical?.symbol ?? 'chart';
  const storageKey = `nexora:strike-lines:${storageSymbol.toUpperCase()}:v1`;

  const resetRange = useCallback(() => {
    const length = data.length;
    const start = Math.max(0, length - Math.min(visibleBarCount, length));
    setLogicalRange({ start, end: Math.max(0, length - 1) });
  }, [data.length, visibleBarCount]);
  const fitContent = useCallback(() => setLogicalRange(fitLogicalRange(data.length)), [data.length]);

  useEffect(() => {
    const previous = viewportSnapshotRef.current;
    viewportSnapshotRef.current = {
      timelineKey,
      visibleBarCount,
      startTime: visibleData[0]?.date ?? null,
      endTime: visibleData.at(-1)?.date ?? null,
    };
    if (previous?.timelineKey === timelineKey && previous.visibleBarCount === visibleBarCount) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (previous && previous.visibleBarCount === visibleBarCount && previous.startTime && previous.endTime) {
        const start = data.findIndex((point) => point.date === previous.startTime);
        const end = data.findIndex((point) => point.date === previous.endTime);
        if (start >= 0 && end >= start) setLogicalRange({ start, end });
        else resetRange();
      } else resetRange();
      if (crosshairTime && !data.some((point) => point.date === crosshairTime)) setCrosshairTime(null);
      setInspectionLocked(false);
    });
    return () => { cancelled = true; };
  }, [crosshairTime, data, resetRange, timelineKey, visibleBarCount, visibleData]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setVolumeVisible(showVolume); });
    return () => { cancelled = true; };
  }, [showVolume]);
  useEffect(() => {
    if (previousSmartPropRef.current === showSmartSupportResistance) return;
    previousSmartPropRef.current = showSmartSupportResistance;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setShowSr(showSmartSupportResistance);
      if (showSmartSupportResistance) setSrMode('structure');
    });
    return () => { cancelled = true; };
  }, [showSmartSupportResistance]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try { setStrikeLines(parseStrikeLines(window.localStorage.getItem(storageKey))); } catch { setStrikeLines([]); }
    });
    return () => { cancelled = true; };
  }, [storageKey]);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => () => {
    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    if (longPressRef.current != null) window.clearTimeout(longPressRef.current);
  }, []);

  const saveStrikes = (next: StrikeLine[]) => {
    setStrikeLines(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* local preferences are best effort */ }
  };
  const clearStrikeForm = () => { setEditingStrikeId(null); setStrikePrice(''); setStrikeLabel(''); setStrikeType('call'); setStrikeExpiration(''); };
  const submitStrike = () => {
    const parsed = Number(strikePrice);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const id = editingStrikeId ?? (globalThis.crypto?.randomUUID?.() ?? `strike-${Date.now()}`);
    const nextLine: StrikeLine = { id, price: parsed, label: strikeLabel.trim() || `${strikeType === 'call' ? 'Call' : 'Put'} ${price(parsed)}`, optionType: strikeType, expiration: strikeExpiration || null, visible: true };
    saveStrikes(editingStrikeId ? strikeLines.map((line) => line.id === editingStrikeId ? nextLine : line) : [...strikeLines, nextLine]);
    clearStrikeForm();
  };
  const editStrike = (line: StrikeLine) => { setStrikeEditorOpen(true); setEditingStrikeId(line.id); setStrikePrice(String(line.price)); setStrikeLabel(line.label); setStrikeType(line.optionType); setStrikeExpiration(line.expiration ?? ''); };

  const updateCrosshairFromRatio = (ratio: number) => {
    if (!visibleData.length) return;
    const index = Math.min(visibleData.length - 1, Math.max(0, Math.round(ratio * (visibleData.length - 1))));
    setCrosshairTime(visibleData[index].date);
  };
  const pointerRatio = (clientX: number) => {
    const bounds = interactionRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= PRICE_AXIS_WIDTH) return 0.5;
    return Math.min(1, Math.max(0, (clientX - bounds.left) / (bounds.width - PRICE_AXIS_WIDTH)));
  };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setLogicalRange((current) => zoomLogicalRange(current, data.length, event.deltaY > 0 ? 1.18 : 0.84, pointerRatio(event.clientX)));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, at: performance.now(), range: logicalRange, velocity: 0 };
    updateCrosshairFromRatio(pointerRatio(event.clientX));
    if (event.pointerType !== 'mouse') longPressRef.current = window.setTimeout(() => setInspectionLocked(true), 450);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    updateCrosshairFromRatio(pointerRatio(event.clientX));
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !interactionRef.current) return;
    const width = interactionRef.current.clientWidth - PRICE_AXIS_WIDTH;
    const slots = width > 0 ? -((event.clientX - drag.x) / width) * (drag.range.end - drag.range.start + 1) : 0;
    setLogicalRange(panLogicalRange(drag.range, data.length, slots));
    const now = performance.now();
    drag.velocity = now === drag.at ? 0 : (event.clientX - drag.x) / (now - drag.at);
    if (Math.abs(event.clientX - drag.x) > 6 && longPressRef.current != null) { window.clearTimeout(longPressRef.current); longPressRef.current = null; }
  };
  const startKineticScroll = (velocity: number) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (reduced || saveData || Math.abs(velocity) < 0.08) return;
    let currentVelocity = velocity;
    let previous = performance.now();
    const step = (now: number) => {
      const elapsed = now - previous; previous = now;
      const width = Math.max(1, (interactionRef.current?.clientWidth ?? 1) - PRICE_AXIS_WIDTH);
      setLogicalRange((current) => panLogicalRange(current, data.length, -(currentVelocity * elapsed / width) * (current.end - current.start + 1)));
      currentVelocity *= 0.9;
      if (Math.abs(currentVelocity) >= 0.02) animationRef.current = requestAnimationFrame(step);
    };
    animationRef.current = requestAnimationFrame(step);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (longPressRef.current != null) { window.clearTimeout(longPressRef.current); longPressRef.current = null; }
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.pointerType !== 'mouse') {
      const now = Date.now();
      if (now - lastTapRef.current < 320) resetRange();
      else setInspectionLocked(true);
      lastTapRef.current = now;
    }
    if (drag) startKineticScroll(drag.velocity);
  };
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    const distance = Math.abs(event.touches[0].clientX - event.touches[1].clientX);
    pinchRef.current = { distance: Math.max(distance, 1), range: logicalRange };
  };
  const onTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || !pinchRef.current) return;
    event.preventDefault();
    const distance = Math.max(Math.abs(event.touches[0].clientX - event.touches[1].clientX), 1);
    const midpoint = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    setLogicalRange(zoomLogicalRange(pinchRef.current.range, data.length, pinchRef.current.distance / distance, pointerRatio(midpoint)));
  };
  const onMouseState = (state: unknown) => {
    const active = state as ChartMouseState | undefined;
    if (active?.activeLabel != null) setCrosshairTime(String(active.activeLabel));
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === rootRef.current) { await document.exitFullscreen(); return; }
    if (rootRef.current?.requestFullscreen) { await rootRef.current.requestFullscreen(); return; }
    setFullscreen((current) => !current);
  };

  if (!normalized.length || !data.length) return <div className="flex h-full items-center justify-center text-sm text-slate-500">ไม่มีข้อมูล OHLC ที่ถูกต้องในช่วงนี้</div>;
  const secondary = enabledIndicators.filter((id) => !OVERLAYS.includes(id) && id !== 'volume');
  const latest = normalized.at(-1)!;
  const lastDate = visibleData.at(-1)?.date;
  const visibleVolume = visibleData.flatMap((point) => typeof point.volume === 'number' ? [point.volume] : []);
  const volumeDomainMax = Math.max(...visibleVolume, 1) * 4.25;
  const srLevels = showSr && srView.status === 'available' ? srView.levels : [];
  const strikeLevels = strikeLines.filter((line) => line.visible);
  const tooltipOnRight = crosshairVisibleIndex >= 0 && crosshairVisibleIndex < visibleData.length / 2;

  const sharedCrosshair = <>{crosshairTime && <ReferenceLine x={crosshairTime} stroke="#94a3b8" strokeDasharray="3 3" ifOverflow="extendDomain"/>}</>;
  const priceChart = <div className={fullscreen ? 'h-[58dvh] min-h-[22rem]' : 'h-[20rem] md:h-[25rem]'}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={visibleData} syncId="nexora-professional-chart" syncMethod="index" margin={CHART_MARGIN} barCategoryGap="18%" onMouseMove={onMouseState} onMouseLeave={() => { if (!inspectionLocked && !dragRef.current) setCrosshairTime(null); }}>
    <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D4FF00" stopOpacity={0.3}/><stop offset="1" stopColor="#D4FF00" stopOpacity={0}/></linearGradient></defs>
    <CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" hide/><YAxis yAxisId="price" orientation="right" width={PRICE_AXIS_WIDTH} domain={['auto', 'auto']} tick={{ fontSize: 10 }} stroke="#64748b"/><Tooltip content={() => null} cursor={false}/><Legend verticalAlign="top" height={28}/>
    {sharedCrosshair}{crosshairPoint && <ReferenceLine yAxisId="price" y={crosshairPoint.raw.close} stroke="#64748b" strokeDasharray="2 4"/>}
    {srLevels.map((level) => level.lower !== level.upper
      ? <ReferenceArea yAxisId="price" key={level.id} y1={level.lower} y2={level.upper} fill={levelColor(level)} fillOpacity={0.1} stroke={levelColor(level)} strokeDasharray="4 3" label={{ value: `${level.label} ${price(level.price)}`, position: 'insideTopRight', fill: levelColor(level), fontSize: 9 }}/>
      : <ReferenceLine yAxisId="price" key={level.id} y={level.price} stroke={levelColor(level)} strokeDasharray="5 4" label={{ value: `${level.label} ${price(level.price)}`, position: 'insideTopRight', fill: levelColor(level), fontSize: 9 }}/>) }
    {strikeLevels.map((line) => <ReferenceLine yAxisId="price" key={line.id} y={line.price} stroke={line.optionType === 'call' ? '#38bdf8' : '#c084fc'} strokeDasharray="7 3" label={{ value: `${line.label} ${price(line.price)}`, position: 'insideBottomRight', fill: line.optionType === 'call' ? '#38bdf8' : '#c084fc', fontSize: 9 }}/>) }
    {showVpvr && volumeProfile?.status === 'available' && volumeProfile.bins.filter((bin) => bin.volume > 0).map((bin) => { const width = Math.max(1, Math.round(bin.normalizedVolume * Math.min(visibleData.length * 0.28, 20))); const start = visibleData[Math.max(0, visibleData.length - 1 - width)]?.date; return start && lastDate ? <ReferenceArea yAxisId="price" key={`vpvr-${bin.index}`} x1={start} x2={lastDate} y1={bin.priceLow} y2={bin.priceHigh} fill="#64748b" fillOpacity={0.18} strokeOpacity={0}/> : null; })}
    {showVpvr && volumeProfile?.status === 'available' && <><ReferenceLine yAxisId="price" y={(volumeProfile.poc.priceLow + volumeProfile.poc.priceHigh) / 2} stroke="#D4FF00" strokeDasharray="5 3"/><ReferenceLine yAxisId="price" y={volumeProfile.vah} stroke="#94a3b8" strokeDasharray="2 4"/><ReferenceLine yAxisId="price" y={volumeProfile.val} stroke="#94a3b8" strokeDasharray="2 4"/></>}
    {showFibonacci && fibonacci?.status === 'available' && fibonacci.levels.map((level) => <ReferenceLine yAxisId="price" key={level.ratio} y={level.price} stroke="#c084fc" strokeDasharray="4 3" label={{ value: `Fib ${level.ratio}`, position: 'insideLeft', fill: '#c084fc', fontSize: 9 }}/>) }
    {chartType === 'area' && <Area yAxisId="price" type="monotone" dataKey="close" name="Raw close" stroke="#D4FF00" fill="url(#priceFill)" dot={false} isAnimationActive={false}/>} {chartType === 'line' && <Line yAxisId="price" type="monotone" dataKey="close" name="Raw close" stroke="#D4FF00" dot={false} isAnimationActive={false}/>} {(chartType === 'candlestick' || chartType === 'heikin-ashi') && <Bar yAxisId="price" dataKey="range" name={chartType === 'heikin-ashi' ? 'Heikin Ashi' : 'Candlestick'} shape={<CandleShape/>} isAnimationActive={false}/>} {chartType === 'hollow-candles' && <Bar yAxisId="price" dataKey="range" name="Hollow Candles" shape={<CandleShape hollowStyle/>} isAnimationActive={false}/>} {chartType === 'ohlc' && <Bar yAxisId="price" dataKey="range" name="OHLC" shape={<CandleShape ohlc/>} isAnimationActive={false}/>}
    {enabledIndicators.filter((id) => ['sma', 'sma50', 'sma100', 'sma200', 'ema', 'ema50', 'ema100', 'ema200', 'vwap'].includes(id)).map((id) => <Line yAxisId="price" key={id} type="monotone" dataKey={id} name={labels[id]} stroke={colors[id]} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false}/>)}
    {enabledIndicators.includes('bollinger') && <><Line yAxisId="price" type="monotone" dataKey="bbUpper" name="BB Upper" stroke={colors.bollinger} strokeDasharray="4 3" dot={false} isAnimationActive={false}/><Line yAxisId="price" type="monotone" dataKey="bbMiddle" name="BB Middle" stroke={colors.bollinger} dot={false} isAnimationActive={false}/><Line yAxisId="price" type="monotone" dataKey="bbLower" name="BB Lower" stroke={colors.bollinger} strokeDasharray="4 3" dot={false} isAnimationActive={false}/></>}
    {enabledIndicators.includes('ichimoku') && <><Line yAxisId="price" type="monotone" dataKey="ichimokuConversion" name="Tenkan" stroke="#22d3ee" dot={false} isAnimationActive={false}/><Line yAxisId="price" type="monotone" dataKey="ichimokuBase" name="Kijun" stroke="#fb7185" dot={false} isAnimationActive={false}/></>}
    {volumeVisible && volumeMode === 'overlay' && <><YAxis yAxisId="volume" hide domain={[0, volumeDomainMax]}/><Bar yAxisId="volume" dataKey="volume" name="Volume" fillOpacity={0.42} isAnimationActive={false}>{visibleData.map((point) => <Cell key={point.date} fill={point.raw.close >= point.raw.open ? '#34d39970' : '#fb718570'}/>)}</Bar></>}
  </ComposedChart></ResponsiveContainer></div>;

  const volumePane = volumeVisible && volumeMode === 'separate' && <section aria-label="Volume pane" className="border-t border-slate-800 bg-[#101621]/70"><div className="flex items-center justify-between px-3 pt-1 text-[10px] text-slate-500"><span>Volume · canonical raw OHLC direction</span><span>{latest.volume == null ? 'unavailable' : compactVolume(latest.volume)}</span></div><div className={fullscreen ? 'h-[18dvh] min-h-28' : 'h-[5.5rem] md:h-[6.5rem]'}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={visibleData} syncId="nexora-professional-chart" syncMethod="index" margin={CHART_MARGIN} barCategoryGap="18%" onMouseMove={onMouseState}><CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" tickFormatter={formatChartTime} minTickGap={42} height={24} tick={{ fontSize: 9 }} stroke="#64748b"/><YAxis yAxisId="volume" orientation="right" width={PRICE_AXIS_WIDTH} tickFormatter={compactVolume} tick={{ fontSize: 9 }} stroke="#64748b" domain={[0, 'dataMax']}/><Tooltip content={() => null} cursor={false}/>{sharedCrosshair}<Bar yAxisId="volume" dataKey="volume" name="Volume" isAnimationActive={false}>{visibleData.map((point) => <Cell key={point.date} fill={point.raw.close >= point.raw.open ? '#34d39999' : '#fb718599'}/>)}</Bar></ComposedChart></ResponsiveContainer></div></section>;

  return <div ref={rootRef} className={fullscreen ? 'fixed inset-0 z-50 overflow-y-auto bg-[#0A0E17] p-[max(0.75rem,env(safe-area-inset-top))_max(0.75rem,env(safe-area-inset-right))_max(0.75rem,env(safe-area-inset-bottom))_max(0.75rem,env(safe-area-inset-left))]' : 'relative'}>
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-[#151B28]/80 p-2">
      <button type="button" aria-pressed={volumeVisible} onClick={() => setVolumeVisible((current) => !current)} className={`min-h-11 rounded-lg border px-3 text-xs ${volumeVisible ? 'border-[#D4FF00] text-[#D4FF00]' : 'border-slate-700 text-slate-300'}`}>Volume</button>
      {volumeVisible && <button type="button" onClick={() => setVolumeMode((current) => current === 'separate' ? 'overlay' : 'separate')} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">{volumeMode === 'separate' ? 'Separate pane' : 'Overlay'}</button>}
      {supportResistance !== undefined && <button type="button" aria-pressed={showSr} onClick={() => setShowSr((current) => !current)} className={`min-h-11 rounded-lg border px-3 text-xs ${showSr ? 'border-emerald-400 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>S/R</button>}
      {showSr && <select aria-label="Support resistance source" value={srMode} onChange={(event) => setSrMode(event.target.value as SupportResistanceMode)} className="min-h-11 rounded-lg border border-slate-700 bg-[#151B28] px-3 text-xs text-slate-200"><option value="pivot">Pivot</option><option value="structure">Smart Structure</option><option value="oi">OI Concentration</option><option value="expected-move">Expected Move</option><option value="confluence">Confluence</option></select>}
      <button type="button" aria-pressed={strikeEditorOpen} onClick={() => setStrikeEditorOpen((current) => !current)} className={`min-h-11 rounded-lg border px-3 text-xs ${strikeEditorOpen ? 'border-sky-400 text-sky-300' : 'border-slate-700 text-slate-300'}`}>Strike</button>
      <span className="hidden text-[10px] text-slate-500 sm:inline">drag · wheel/pinch zoom · double-click/tap reset</span>
      <div className="ml-auto flex gap-2"><button type="button" onClick={fitContent} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">Fit</button><button type="button" onClick={resetRange} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">Reset</button><button type="button" onClick={() => void toggleFullscreen()} className="min-h-11 rounded-lg bg-slate-800 px-3 text-xs text-white">{fullscreen ? 'Exit full screen' : 'Full screen'}</button></div>
    </div>
    {strikeEditorOpen && <section className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><input aria-label="Strike price" inputMode="decimal" value={strikePrice} onChange={(event) => setStrikePrice(event.target.value)} placeholder="Strike > 0" className="min-h-11 rounded-lg border border-slate-700 bg-[#101621] px-3 text-sm"/><input aria-label="Strike label" value={strikeLabel} onChange={(event) => setStrikeLabel(event.target.value)} placeholder="Label" className="min-h-11 rounded-lg border border-slate-700 bg-[#101621] px-3 text-sm"/><select aria-label="Call or Put" value={strikeType} onChange={(event) => setStrikeType(event.target.value as 'call' | 'put')} className="min-h-11 rounded-lg border border-slate-700 bg-[#101621] px-3 text-sm"><option value="call">Call</option><option value="put">Put</option></select><input aria-label="Expiration" type="date" value={strikeExpiration} onChange={(event) => setStrikeExpiration(event.target.value)} className="min-h-11 rounded-lg border border-slate-700 bg-[#101621] px-3 text-sm"/><button type="button" disabled={!Number.isFinite(Number(strikePrice)) || Number(strikePrice) <= 0} onClick={submitStrike} className="min-h-11 rounded-lg bg-sky-500 px-3 text-sm font-semibold text-slate-950 disabled:opacity-40">{editingStrikeId ? 'Save strike' : 'Add strike'}</button></div>
      {strikeLines.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{strikeLines.map((line) => { const gap = strikeDistance(line.price, latest.close); return <div key={line.id} className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-800 px-3 text-xs"><span className={line.optionType === 'call' ? 'text-sky-300' : 'text-purple-300'}>{line.label} · ${price(line.price)}</span><span className="text-slate-500">{signed(gap.dollars)} / {gap.percent == null ? '—' : `${signed(gap.percent)}%`}</span><div className="ml-auto flex gap-1"><button type="button" onClick={() => saveStrikes(strikeLines.map((item) => item.id === line.id ? { ...item, visible: !item.visible } : item))} className="min-h-11 px-2 text-slate-300">{line.visible ? 'Hide' : 'Show'}</button><button type="button" onClick={() => editStrike(line)} className="min-h-11 px-2 text-slate-300">Edit</button><button type="button" onClick={() => saveStrikes(strikeLines.filter((item) => item.id !== line.id))} className="min-h-11 px-2 text-rose-300">Delete</button></div></div>; })}</div>}
      <p className="mt-2 text-[10px] text-slate-500">เก็บใน local preference ของอุปกรณ์นี้เท่านั้น ไม่สร้าง trade, order หรือ options data</p>
    </section>}
    <div ref={interactionRef} aria-label="Interactive price and volume chart" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => { if (!inspectionLocked && !dragRef.current) setCrosshairTime(null); }} onDoubleClick={resetRange} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={() => { pinchRef.current = null; }} className="relative overflow-hidden rounded-xl border border-slate-800 bg-[#101621] select-none" style={{ touchAction: 'pan-y' }}>
      {crosshairPoint && <div className={`pointer-events-none absolute top-12 z-20 ${tooltipOnRight ? 'right-2' : 'left-2'}`}><InspectionTooltip point={crosshairPoint} enabled={enabledIndicators} chartType={chartType}/></div>}
      {priceChart}{volumePane}
    </div>
    <div className="mt-3 space-y-3">
      {chartType === 'heikin-ashi' && <p className="text-xs text-amber-300">Heikin Ashi เปลี่ยนเฉพาะ OHLC; Volume, indicators และ S/R ใช้ canonical raw OHLCV ที่ time เดียวกัน</p>}
      {visibleData.some((point) => point.raw.volume == null) && <p className="text-xs text-amber-300">Provider ไม่มี volume ในบาง session; time slot ยังคงอยู่และแสดง unavailable โดยไม่เลื่อน alignment</p>}
      {showSr && <SupportResistancePanel view={srView}/>}
      {showVpvr && <p className="text-xs text-slate-500">VPVR estimated from historical OHLCV; not order-book data. Coverage {volumeProfile ? Math.round(volumeProfile.coverage * 100) : 0}%.</p>}
      {showVpvr && volumeProfile?.status === 'unavailable' && <p className="text-xs text-amber-300">VPVR unavailable: {volumeProfile.reason}</p>}
      {showFibonacci && fibonacci?.status === 'unavailable' && <p className="text-xs text-amber-300">Fibonacci unavailable: {fibonacci.reason}</p>}
      {technical?.status === 'available' && secondary.map((id) => <SecondaryChart key={id} id={id as Parameters<typeof SecondaryChart>[0]['id']} technical={technical}/>)}
    </div>
    <p className="sr-only" aria-live="polite">Chart {normalized.length} canonical slots through {latest.time}; latest close {latest.close}. Price and volume visible range {logicalRange.start} to {logicalRange.end}. Crosshair {crosshairTime ?? 'inactive'}.</p>
  </div>;
}
