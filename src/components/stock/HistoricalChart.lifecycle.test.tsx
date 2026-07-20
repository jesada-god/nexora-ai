// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('recharts', async () => {
  const ReactModule = await import('react');
  const container = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children);
  const chart = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('svg', { 'data-chart-instance': true }, children);
  const empty = () => null;
  return {
    Area: empty, Bar: empty, CartesianGrid: empty, Cell: empty, ComposedChart: chart,
    Legend: empty, Line: empty, ReferenceArea: empty, ReferenceLine: empty,
    ResponsiveContainer: container, Tooltip: empty, XAxis: empty, YAxis: empty,
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

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HistoricalChart lifecycle and deterministic labels', () => {
  it('formats date-only slots without midnight and independently of host timezone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const server = formatChartTime('2026-07-17');
      process.env.TZ = 'America/New_York';
      const client = formatChartTime('2026-07-17');
      expect(client).toBe(server);
      expect(client).not.toContain('00:00');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('does not duplicate panes in fullscreen, cleans its listener, or fetch while zooming', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<HistoricalChart symbol="RKLB" prices={prices} chartType="candlestick"/>));
    expect(host.querySelectorAll('[data-chart-instance]')).toHaveLength(2);

    const fullscreen = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Full screen');
    await act(async () => fullscreen?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelectorAll('[data-chart-instance]')).toHaveLength(2);

    const interactive = host.querySelector('[aria-label="Interactive price and volume chart"]');
    await act(async () => interactive?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100, clientX: 100 })));
    expect(fetcher).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    const added = add.mock.calls.filter(([type]) => type === 'fullscreenchange').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'fullscreenchange').length;
    expect(added).toBe(removed);
    host.remove();
  });
});
