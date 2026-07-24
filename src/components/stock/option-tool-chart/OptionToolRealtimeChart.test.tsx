// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lightweight = vi.hoisted(() => ({ charts: [] as Array<Record<string, unknown>> }));

vi.mock('lightweight-charts', () => {
  const definition = (name: string) => ({ name });
  return {
    ColorType: { Solid: 'solid' },
    LineStyle: { Solid: 0 },
    CandlestickSeries: definition('Candlestick'),
    HistogramSeries: definition('Histogram'),
    createChart: vi.fn(() => {
      const visibleHandlers = new Set<(range: { from: number; to: number } | null) => void>();
      const series: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
      const timeScale = {
        subscribeVisibleLogicalRangeChange: vi.fn((handler) => visibleHandlers.add(handler)),
        unsubscribeVisibleLogicalRangeChange: vi.fn((handler) => visibleHandlers.delete(handler)),
        setVisibleLogicalRange: vi.fn(),
        scrollToRealTime: vi.fn(),
      };
      const priceScales = new Map<string, { applyOptions: ReturnType<typeof vi.fn> }>();
      const chart = {
        series,
        visibleHandlers,
        timeScaleApi: timeScale,
        addSeries: vi.fn(() => {
          const item = {
            setData: vi.fn(),
            update: vi.fn(),
            createPriceLine: vi.fn((options) => ({ options })),
            removePriceLine: vi.fn(),
          };
          series.push(item);
          return item;
        }),
        timeScale: vi.fn(() => timeScale),
        priceScale: vi.fn((id: string) => {
          if (!priceScales.has(id)) priceScales.set(id, { applyOptions: vi.fn() });
          return priceScales.get(id);
        }),
        applyOptions: vi.fn(),
        remove: vi.fn(),
      };
      lightweight.charts.push(chart);
      return chart;
    }),
  };
});

import { OptionToolRealtimeChart } from './OptionToolRealtimeChart';

const prices = Array.from({ length: 20 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 1_000 + index,
}));

const resizeCallbacks: Array<() => void> = [];
class ResizeObserverMock {
  constructor(private readonly callback: () => void) { resizeCallbacks.push(callback); }
  observe = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  lightweight.charts.length = 0;
  resizeCallbacks.length = 0;
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('OptionToolRealtimeChart', () => {
  it('creates separate synchronized price and volume charts', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <OptionToolRealtimeChart symbol="NVDA" interval="5m" prices={prices} datasetKey="NVDA:5m" />,
    ));

    expect(lightweight.charts).toHaveLength(2);
    const [priceChart, volumeChart] = lightweight.charts as Array<{
      visibleHandlers: Set<(range: { from: number; to: number }) => void>;
      timeScaleApi: { setVisibleLogicalRange: ReturnType<typeof vi.fn> };
    }>;
    await act(async () => priceChart.visibleHandlers.forEach((handler) => handler({ from: 2, to: 12 })));
    expect(volumeChart.timeScaleApi.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 2, to: 12 });
    await act(async () => root.unmount());
  });

  it('updates the latest candle and volume without recreating either chart', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <OptionToolRealtimeChart symbol="NVDA" interval="5m" prices={prices} datasetKey="NVDA:5m" />,
    ));
    const charts = lightweight.charts as Array<{
      series: Array<Record<string, ReturnType<typeof vi.fn>>>;
      timeScaleApi: { scrollToRealTime: ReturnType<typeof vi.fn> };
    }>;
    const initialScrolls = charts.map((chart) => chart.timeScaleApi.scrollToRealTime.mock.calls.length);
    const refreshed = [...prices.slice(0, -1), { ...prices.at(-1)!, close: prices.at(-1)!.close + 1 }];
    await act(async () => root.render(
      <OptionToolRealtimeChart symbol="NVDA" interval="5m" prices={refreshed} datasetKey="NVDA:5m" />,
    ));

    expect(lightweight.charts).toHaveLength(2);
    expect(charts[0].series[0].update).toHaveBeenCalled();
    expect(charts[1].series[0].update).toHaveBeenCalled();
    expect(charts.map((chart) => chart.timeScaleApi.scrollToRealTime.mock.calls.length)).toEqual(initialScrolls);
    await act(async () => root.unmount());
  });

  it('resets both views and disposes both charts safely', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <OptionToolRealtimeChart symbol="NVDA" interval="5m" prices={prices} datasetKey="NVDA:5m" />,
    ));
    const charts = lightweight.charts as Array<{
      applyOptions: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      timeScaleApi: { scrollToRealTime: ReturnType<typeof vi.fn> };
    }>;
    const initialScrolls = charts.map((chart) => chart.timeScaleApi.scrollToRealTime.mock.calls.length);
    const reset = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('รีเซ็ต'));
    await act(async () => reset?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(charts.map((chart) => chart.timeScaleApi.scrollToRealTime.mock.calls.length)).toEqual(initialScrolls.map((count) => count + 1));

    const resizeCalls = charts.map((chart) => chart.applyOptions.mock.calls.length);
    await act(async () => root.unmount());
    expect(charts.every((chart) => chart.remove.mock.calls.length === 1)).toBe(true);
    expect(() => resizeCallbacks.forEach((callback) => callback())).not.toThrow();
    expect(charts.map((chart) => chart.applyOptions.mock.calls.length)).toEqual(resizeCalls);
  });
});
