import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import type { AdvancedChartType } from '@/src/lib/analytics/chart-types/types';
import { areaData, barData, candlestickData, lineData, volumeData } from './chart-data-adapter';
import type { ChartBar } from './chart-types';

export type PrimarySeries = ISeriesApi<SeriesType, Time>;

export function addPrimarySeries(chart: IChartApi, chartType: AdvancedChartType): PrimarySeries {
  if (chartType === 'line') return chart.addSeries(LineSeries, { color: '#D4FF00', lineWidth: 2 });
  if (chartType === 'area') return chart.addSeries(AreaSeries, {
    lineColor: '#D4FF00', topColor: '#D4FF0055', bottomColor: '#D4FF0000', lineWidth: 2,
  });
  if (chartType === 'ohlc') return chart.addSeries(BarSeries, { upColor: '#34d399', downColor: '#fb7185', thinBars: false });
  return chart.addSeries(CandlestickSeries, {
    upColor: chartType === 'hollow-candles' ? 'transparent' : '#34d399',
    downColor: '#fb7185', borderUpColor: '#34d399', borderDownColor: '#fb7185',
    wickUpColor: '#34d399', wickDownColor: '#fb7185',
  });
}

export function setPrimaryData(series: PrimarySeries, chartType: AdvancedChartType, bars: readonly ChartBar[]): void {
  if (chartType === 'line') { (series as ISeriesApi<'Line'>).setData(lineData(bars)); return; }
  if (chartType === 'area') { (series as ISeriesApi<'Area'>).setData(areaData(bars)); return; }
  if (chartType === 'ohlc') { (series as ISeriesApi<'Bar'>).setData(barData(bars)); return; }
  (series as ISeriesApi<'Candlestick'>).setData(candlestickData(bars));
}

export function updatePrimary(series: PrimarySeries, chartType: AdvancedChartType, bar: ChartBar): void {
  if (chartType === 'line') { (series as ISeriesApi<'Line'>).update(lineData([bar])[0]); return; }
  if (chartType === 'area') { (series as ISeriesApi<'Area'>).update(areaData([bar])[0]); return; }
  if (chartType === 'ohlc') { (series as ISeriesApi<'Bar'>).update(barData([bar])[0]); return; }
  (series as ISeriesApi<'Candlestick'>).update(candlestickData([bar])[0]);
}

export function addVolumeSeries(chart: IChartApi): ISeriesApi<'Histogram'> {
  return chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  }, 1);
}

export function setVolumeData(series: ISeriesApi<'Histogram'>, bars: readonly ChartBar[]): void {
  series.setData(volumeData(bars));
}

export function updateVolume(series: ISeriesApi<'Histogram'>, bar: ChartBar): void {
  series.update(volumeData([bar])[0]);
}

