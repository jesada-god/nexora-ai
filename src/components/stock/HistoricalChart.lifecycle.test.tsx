// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lightweight = vi.hoisted(() => {
  const charts: Array<Record<string, unknown>> = [];
  return { charts };
});

vi.mock('lightweight-charts', () => {
  const definition = (name: string) => ({ name });
  return {
    ColorType: { Solid: 'solid' },
    AreaSeries: definition('Area'),
    BarSeries: definition('Bar'),
    CandlestickSeries: definition('Candlestick'),
    HistogramSeries: definition('Histogram'),
    LineSeries: definition('Line'),
    createChart: vi.fn(() => {
      const series: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
      const crosshair = new Set<(value: unknown) => void>();
      const chart = {
        series,
        addSeries: vi.fn(() => {
          const item = {
            setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(),
            createPriceLine: vi.fn((options) => ({ options })),
            removePriceLine: vi.fn(),
          };
          series.push(item);
          return item;
        }),
        removeSeries: vi.fn(),
        applyOptions: vi.fn(),
        subscribeCrosshairMove: vi.fn((handler) => crosshair.add(handler)),
        unsubscribeCrosshairMove: vi.fn((handler) => crosshair.delete(handler)),
        timeScale: vi.fn(() => ({ fitContent: chart.fitContent, resetTimeScale: chart.resetTimeScale })),
        fitContent: vi.fn(),
        resetTimeScale: vi.fn(),
        remove: vi.fn(),
      };
      lightweight.charts.push(chart);
      return chart;
    }),
  };
});

import HistoricalChart, { formatChartTime } from './HistoricalChart';

const prices = Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  open: 40 + index,
  high: 42 + index,
  low: 39 + index,
  close: 41 + index,
  volume: 1_000 + index,
}));

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  lightweight.charts.length = 0;
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

describe('HistoricalChart Lightweight Charts boundary', () => {
  it('formats date-only slots deterministically', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const server = formatChartTime('2026-07-17');
      process.env.TZ = 'America/New_York';
      expect(formatChartTime('2026-07-17')).toBe(server);
      expect(server).not.toContain('00:00');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('creates/removes safely in Strict Mode and cleans ResizeObserver subscriptions', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<React.StrictMode><HistoricalChart symbol="RKLB" prices={prices} datasetKey="RKLB:1d:5m"/></React.StrictMode>));
    const activeCharts = lightweight.charts.filter((chart) => !(chart.remove as ReturnType<typeof vi.fn>).mock.calls.length);
    expect(activeCharts).toHaveLength(1);
    await act(async () => root.unmount());
    expect(lightweight.charts.every((chart) => (chart.remove as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    expect(lightweight.charts.every((chart) => (chart.unsubscribeCrosshairMove as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
  });

  it('updates the latest bar without recreating the chart or resetting viewport', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<HistoricalChart symbol="RKLB" prices={prices} datasetKey="RKLB:1d:5m"/>));
    const chart = lightweight.charts[0] as { series: Array<Record<string, ReturnType<typeof vi.fn>>>; fitContent: ReturnType<typeof vi.fn> };
    const created = lightweight.charts.length;
    const initialFitCalls = chart.fitContent.mock.calls.length;
    const refreshed = [...prices.slice(0, -1), { ...prices.at(-1)!, close: prices.at(-1)!.close + 1 }];
    await act(async () => root.render(<HistoricalChart symbol="RKLB" prices={refreshed} datasetKey="RKLB:1d:5m"/>));
    expect(lightweight.charts).toHaveLength(created);
    expect(chart.series.some((series) => series.update.mock.calls.length > 0)).toBe(true);
    expect(chart.fitContent).toHaveBeenCalledTimes(initialFitCalls);
    await act(async () => root.unmount());
  });

  it('uses native chart interactions and never fetches while Fit/Reset is used', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<HistoricalChart prices={prices}/>));
    for (const label of ['Fit', 'Reset']) {
      const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
      await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
