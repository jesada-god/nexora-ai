'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Time, UTCTimestamp } from 'lightweight-charts';
import type { TechnicalAnalysis, TechnicalIndicatorId } from '@/src/lib/analytics/technical/types';
import type { AdvancedChartType } from '@/src/lib/analytics/chart-types/types';
import type { SupportResistanceResult } from '@/src/lib/analytics/support-resistance/types';
import type { VolumeProfileResult } from '@/src/lib/analytics/volume-profile/types';
import type { FibonacciResult } from '@/src/lib/analytics/fibonacci/types';
import { normalizeOhlcvTimeline, type OhlcvInputBar } from '@/src/lib/analytics/chart-data/timeline';
import { buildSupportResistanceView, summaryRows } from '@/src/lib/analytics/support-resistance/levels';
import { adaptChartBars } from './chart-data-adapter';
import { ChartControls } from './chart-controls';
import { currentQuotePriceLine, supportResistancePriceLines } from './chart-overlays';
import type { ChartActions, ChartIndicatorLine, ChartTooltipContext } from './chart-types';
import { LightweightChartHost } from './LightweightChartHost';

const INDICATOR_COLORS: Partial<Record<TechnicalIndicatorId, string>> = {
  sma: '#38bdf8', sma50: '#0ea5e9', sma100: '#6366f1', sma200: '#8b5cf6',
  ema: '#f59e0b', ema50: '#fb923c', ema100: '#f97316', ema200: '#ef4444',
  bollinger: '#a78bfa', rsi: '#2dd4bf', macd: '#fb7185', atr: '#facc15',
  stochastic: '#22d3ee', adx: '#e879f9', obv: '#34d399', ichimoku: '#f472b6', roc: '#c084fc', vwap: '#fde047',
};
const PRICE_OVERLAYS = new Set<TechnicalIndicatorId>(['sma', 'sma50', 'sma100', 'sma200', 'ema', 'ema50', 'ema100', 'ema200', 'bollinger', 'ichimoku', 'vwap']);

function indicatorSeries(technical: TechnicalAnalysis | undefined, enabled: readonly TechnicalIndicatorId[]): ChartIndicatorLine[] {
  if (technical?.status !== 'available') return [];
  return enabled.flatMap((id) => {
    const result = technical.indicators[id];
    if (result.status !== 'available') return [];
    const data = result.points.flatMap((point) => {
      if (!Number.isFinite(point.value)) return [];
      const parsed = new Date(point.date);
      if (Number.isNaN(parsed.valueOf())) return [];
      return [{ time: Math.floor(parsed.valueOf() / 1_000) as UTCTimestamp as Time, value: point.value }];
    });
    return [{ id, label: id.toUpperCase(), color: INDICATOR_COLORS[id] ?? '#94a3b8', pane: PRICE_OVERLAYS.has(id) ? 0 : 2, data }];
  });
}

export interface StockChartProps {
  prices: readonly OhlcvInputBar[];
  symbol?: string;
  technical?: TechnicalAnalysis;
  enabledIndicators?: TechnicalIndicatorId[];
  chartType?: AdvancedChartType;
  supportResistance?: SupportResistanceResult;
  volumeProfile?: VolumeProfileResult;
  fibonacci?: FibonacciResult;
  showVolume?: boolean;
  onToggleVolume?: () => void;
  showVpvr?: boolean;
  showFibonacci?: boolean;
  currentPrice?: number | null;
  datasetKey?: string;
  tooltipContext?: ChartTooltipContext;
}

export function StockChart({
  prices,
  symbol = 'chart',
  technical,
  enabledIndicators = [],
  chartType = 'candlestick',
  supportResistance,
  volumeProfile,
  fibonacci,
  showVolume = true,
  onToggleVolume,
  showVpvr = false,
  showFibonacci = false,
  currentPrice,
  datasetKey,
  tooltipContext = {},
}: StockChartProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showSr, setShowSr] = useState(false);
  const [actions, setActions] = useState<ChartActions | null>(null);
  const onActions = useCallback((next: ChartActions | null) => setActions(next), []);
  const normalized = useMemo(() => normalizeOhlcvTimeline(prices), [prices]);
  const bars = useMemo(() => adaptChartBars(prices, chartType), [chartType, prices]);
  const srView = useMemo(() => buildSupportResistanceView(normalized, supportResistance), [normalized, supportResistance]);
  const indicators = useMemo(() => indicatorSeries(technical, enabledIndicators), [enabledIndicators, technical]);
  const priceLines = useMemo(() => {
    const lines = [...currentQuotePriceLine(currentPrice ?? normalized.at(-1)?.close)];
    if (showSr && srView.status === 'available') lines.push(...supportResistancePriceLines(srView.levels));
    if (showFibonacci && fibonacci?.status === 'available') {
      lines.push(...fibonacci.levels.map((level) => ({ id: `fib-${level.ratio}`, price: level.price, title: `Fib ${level.ratio}`, color: '#c084fc', lineStyle: 2 })));
    }
    if (showVpvr && volumeProfile?.status === 'available') {
      lines.push(
        { id: 'vpvr-poc', price: (volumeProfile.poc.priceLow + volumeProfile.poc.priceHigh) / 2, title: 'POC', color: '#D4FF00', lineStyle: 2 },
        { id: 'vpvr-vah', price: volumeProfile.vah, title: 'VAH', color: '#94a3b8', lineStyle: 2 },
        { id: 'vpvr-val', price: volumeProfile.val, title: 'VAL', color: '#94a3b8', lineStyle: 2 },
      );
    }
    return lines;
  }, [currentPrice, fibonacci, normalized, showFibonacci, showSr, showVpvr, srView, volumeProfile]);
  const stableDatasetKey = datasetKey ?? `${symbol}:${bars[0]?.time ?? ''}:${bars.length}`;

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const toggleFullscreen = async () => {
    if (document.fullscreenElement === rootRef.current) await document.exitFullscreen();
    else if (rootRef.current?.requestFullscreen) await rootRef.current.requestFullscreen();
  };

  if (bars.length < 2) return <div className="flex min-h-[20rem] items-center justify-center rounded-xl border border-amber-500/20 p-5 text-center text-sm text-amber-200">{bars.length === 1 ? 'ช่วงที่เลือกมีข้อมูลจริงเพียง 1 แท่ง กรุณาเลือกช่วงที่ยาวขึ้น' : 'ไม่มี OHLCV ที่ผ่าน validation สำหรับช่วงนี้'}</div>;

  return <div ref={rootRef} className={fullscreen ? 'fixed inset-0 z-50 overflow-y-auto bg-[#0A0E17] p-3' : 'relative'}>
    <ChartControls volumeVisible={showVolume} onToggleVolume={onToggleVolume} supportResistanceAvailable={supportResistance !== undefined} supportResistanceVisible={showSr} onToggleSupportResistance={() => setShowSr((value) => !value)} fullscreen={fullscreen} onToggleFullscreen={() => void toggleFullscreen()} actions={actions}/>
    <LightweightChartHost bars={bars} chartType={chartType} volumeVisible={showVolume} priceLines={priceLines} indicatorLines={indicators} datasetKey={stableDatasetKey} tooltipContext={tooltipContext} onActions={onActions}/>
    {chartType === 'heikin-ashi' && <p className="mt-2 text-xs text-amber-300">Heikin Ashi เปลี่ยนเฉพาะ OHLC; Volume, indicators และ S/R ใช้ canonical raw OHLCV เดิม</p>}
    {showSr && <section aria-label="Support and resistance summary" className="mt-3 rounded-xl border border-slate-800 bg-[#151B28]/70 p-3 text-xs text-slate-300">{srView.status === 'available' ? summaryRows(srView).map((row) => <div key={'current' in row ? 'current' : row.id} className="flex min-h-10 items-center justify-between border-b border-slate-800 last:border-0"><b>{'current' in row ? 'Now' : row.label}</b><span>${row.price.toFixed(2)}</span></div>) : <p>{srView.reason}</p>}</section>}
  </div>;
}

export default StockChart;

