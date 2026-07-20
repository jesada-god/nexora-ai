'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import type { AdvancedChartType } from '@/src/lib/analytics/chart-types/types';
import { canUpdateLatest } from './chart-data-adapter';
import { asLineStyle } from './chart-overlays';
import { addPrimarySeries, addVolumeSeries, setPrimaryData, setVolumeData, updatePrimary, updateVolume, type PrimarySeries } from './chart-series-manager';
import { ChartTooltip } from './chart-tooltip';
import type { ChartActions, ChartBar, ChartIndicatorLine, ChartPriceLine, ChartTooltipContext } from './chart-types';

export function LightweightChartHost({
  bars,
  chartType,
  volumeVisible,
  priceLines,
  indicatorLines,
  datasetKey,
  tooltipContext,
  onActions,
}: {
  bars: readonly ChartBar[];
  chartType: AdvancedChartType;
  volumeVisible: boolean;
  priceLines: readonly ChartPriceLine[];
  indicatorLines: readonly ChartIndicatorLine[];
  datasetKey: string;
  tooltipContext: ChartTooltipContext;
  onActions(actions: ChartActions | null): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const primaryRef = useRef<PrimarySeries | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlayRefs = useRef<Array<{ series: PrimarySeries; line: IPriceLine }>>([]);
  const indicatorRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const previousBarsRef = useRef<ChartBar[]>([]);
  const barsRef = useRef<readonly ChartBar[]>(bars);
  const fittedDatasetRef = useRef<string | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const [tooltipBar, setTooltipBar] = useState<ChartBar | null>(null);

  useEffect(() => { barsRef.current = bars; }, [bars]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: false,
      layout: { background: { type: ColorType.Solid, color: '#101621' }, textColor: '#94a3b8', attributionLogo: true },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { vertLine: { color: '#94a3b8' }, horzLine: { color: '#94a3b8' } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    chartRef.current = chart;
    const crosshair = (parameter: MouseEventParams<Time>) => {
      if (parameter.time == null) { setTooltipBar(null); return; }
      const key = typeof parameter.time === 'number' ? parameter.time : String(parameter.time);
      const match = barsRef.current.find((bar) => (typeof key === 'number' ? Number(bar.time) === key : bar.sourceTime === key));
      setTooltipBar(match ?? null);
    };
    chart.subscribeCrosshairMove(crosshair);
    const resize = () => {
      if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(280, container.clientHeight);
        chart.applyOptions({ width, height });
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const actions: ChartActions = {
      fitContent: () => chart.timeScale().fitContent(),
      reset: () => chart.timeScale().resetTimeScale(),
    };
    onActions(actions);
    setChartReady(true);
    return () => {
      onActions(null);
      setChartReady(false);
      observer.disconnect();
      chart.unsubscribeCrosshairMove(crosshair);
      if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current);
      chart.remove();
      chartRef.current = null;
      primaryRef.current = null;
      volumeRef.current = null;
      previousBarsRef.current = [];
      fittedDatasetRef.current = null;
    };
  }, [onActions]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chartReady || !chart) return;
    if (primaryRef.current) chart.removeSeries(primaryRef.current);
    primaryRef.current = addPrimarySeries(chart, chartType);
    previousBarsRef.current = [];
  }, [chartReady, chartType]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chartReady || !chart) return;
    if (!volumeRef.current) volumeRef.current = addVolumeSeries(chart);
    volumeRef.current.applyOptions({ visible: volumeVisible });
  }, [chartReady, volumeVisible]);

  useEffect(() => {
    if (!chartReady) return;
    const primary = primaryRef.current;
    const volume = volumeRef.current;
    if (!primary || !volume) return;
    const previous = previousBarsRef.current;
    if (canUpdateLatest(previous, bars)) {
      if (bars.length > previous.length && bars.length > 1) {
        updatePrimary(primary, chartType, bars.at(-2)!);
        updateVolume(volume, bars.at(-2)!);
      }
      const latest = bars.at(-1);
      if (latest) { updatePrimary(primary, chartType, latest); updateVolume(volume, latest); }
    } else {
      setPrimaryData(primary, chartType, bars);
      setVolumeData(volume, bars);
    }
    previousBarsRef.current = [...bars];
    if (bars.length >= 2 && fittedDatasetRef.current !== datasetKey) {
      chartRef.current?.timeScale().fitContent();
      fittedDatasetRef.current = datasetKey;
    }
  }, [chartReady, bars, chartType, datasetKey]);

  useEffect(() => {
    const primary = primaryRef.current;
    if (!primary) return;
    overlayRefs.current.forEach(({ series, line }) => series.removePriceLine(line));
    overlayRefs.current = priceLines.map((item) => ({
      series: primary,
      line: primary.createPriceLine({
        price: item.price,
        color: item.color,
        lineWidth: 1,
        lineStyle: asLineStyle(item.lineStyle),
        axisLabelVisible: true,
        title: item.title,
      }),
    }));
    return () => {
      overlayRefs.current.forEach(({ series, line }) => {
        try { series.removePriceLine(line); } catch { /* chart may already be removed */ }
      });
      overlayRefs.current = [];
    };
  }, [chartReady, chartType, priceLines]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chartReady || !chart) return;
    indicatorRefs.current.forEach((series) => chart.removeSeries(series));
    indicatorRefs.current = indicatorLines.map((indicator) => {
      const series = chart.addSeries(LineSeries, { color: indicator.color, lineWidth: 1, title: indicator.label, lastValueVisible: false }, indicator.pane);
      series.setData(indicator.data);
      return series;
    });
    return () => {
      const active = chartRef.current;
      if (!active) return;
      indicatorRefs.current.forEach((series) => {
        try { active.removeSeries(series); } catch { /* chart may already be removed */ }
      });
      indicatorRefs.current = [];
    };
  }, [chartReady, indicatorLines]);

  return <div className="relative h-[26rem] min-h-[20rem] w-full overflow-hidden rounded-xl border border-slate-800 bg-[#101621] md:h-[32rem]" aria-label="Interactive price and volume chart" data-testid="lightweight-chart-host">
    <div ref={containerRef} className="h-full w-full" />
    {tooltipBar && <div className="absolute left-2 top-2 z-10"><ChartTooltip bar={tooltipBar} context={tooltipContext}/></div>}
  </div>;
}
