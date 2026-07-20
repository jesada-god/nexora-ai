// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('recharts', async () => {
  const ReactModule = await import('react');
  const container = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children);
  const chart = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('svg', { 'data-chart-instance': true }, children);
  const reference = ({ y, y1, y2, label }: { y?: number; y1?: number; y2?: number; label?: { value?: string } }) => ReactModule.createElement('g', {
    'data-reference-level': label?.value ?? '',
    'data-y': y,
    'data-y1': y1,
    'data-y2': y2,
  });
  const empty = () => null;
  return {
    Area: empty, Bar: empty, CartesianGrid: empty, Cell: empty, ComposedChart: chart,
    Legend: empty, Line: empty, ReferenceArea: reference, ReferenceLine: reference,
    ResponsiveContainer: container, Tooltip: empty, XAxis: empty, YAxis: empty,
  };
});

import HistoricalChart, { formatChartTime } from './HistoricalChart';
import type { SupportResistanceResult } from '@/src/lib/analytics/support-resistance/types';
import { DEFAULT_SUPPORT_RESISTANCE_PARAMETERS } from '@/src/lib/analytics/support-resistance/validation';

const isNonPassive = (options: boolean | EventListenerOptions | AddEventListenerOptions | undefined) => (
  typeof options === 'object' && (options as AddEventListenerOptions).passive === false
);

const prices = Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  open: 40 + index,
  high: 42 + index,
  low: 39 + index,
  close: 41 + index,
  volume: 1_000 + index,
}));

const supportResistance: SupportResistanceResult = {
  status: 'available',
  symbol: 'RKLB',
  source: 'fixture',
  sourceType: 'provider/cache historical OHLCV',
  dataPoints: prices.length,
  latestDataAt: prices.at(-1)!.date,
  calculatedAt: '2026-02-01T00:00:00.000Z',
  freshness: { status: 'end-of-day', asOf: '2026-01-30T00:00:00.000Z', maxAgeSeconds: 86_400 },
  methodology: 'fixture methodology',
  parameters: DEFAULT_SUPPORT_RESISTANCE_PARAMETERS,
  assumptions: [],
  limitations: [],
  currentPrice: prices.at(-1)!.close,
  zones: [
    {
      id: 'resistance-75', type: 'resistance', classification: 'Resistance', lower: 74.5, upper: 75.5, midpoint: 75,
      touches: 3, latestTouchAt: '2026-01-20', strengthScore: 60,
      scoreComponents: { touches: 0.75, recency: 0.5, rejection: 0.4, relativeVolume: 0.5, psychological: 0 },
      reasons: [{ id: 'touches', label: '3 confirmed touches', score: 31.5 }],
    },
    {
      id: 'support-65', type: 'support', classification: 'Support', lower: 64.5, upper: 65.5, midpoint: 65,
      touches: 3, latestTouchAt: '2026-01-18', strengthScore: 58,
      scoreComponents: { touches: 0.75, recency: 0.4, rejection: 0.3, relativeVolume: 0.4, psychological: 0 },
      reasons: [{ id: 'touches', label: '3 confirmed touches', score: 31.5 }],
    },
  ],
};

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

    await act(async () => root.render(<HistoricalChart symbol="RKLB" prices={prices} visibleBarCount={10} chartType="candlestick"/>));
    expect(host.querySelectorAll('[data-chart-instance]')).toHaveLength(2);

    const fullscreen = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Full screen');
    await act(async () => fullscreen?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelectorAll('[data-chart-instance]')).toHaveLength(2);

    const interactive = host.querySelector('[aria-label="Interactive price and volume chart"]');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: 100 });
    await act(async () => interactive?.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();

    const fit = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Fit');
    const reset = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Reset');
    await act(async () => fit?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.textContent).toContain('visible range 0 to 29');
    await act(async () => reset?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.textContent).toContain('visible range 20 to 29');

    await act(async () => root.unmount());
    const added = add.mock.calls.filter(([type]) => type === 'fullscreenchange').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'fullscreenchange').length;
    expect(added).toBe(removed);
    host.remove();
  });

  it('keeps exactly one scoped non-passive listener per event in Strict Mode and removes both', async () => {
    const add = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    const remove = vi.spyOn(HTMLElement.prototype, 'removeEventListener');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<React.StrictMode><HistoricalChart prices={prices}/></React.StrictMode>));
    for (const type of ['wheel', 'touchmove']) {
      const added = add.mock.calls.filter(([eventType, , options]) => eventType === type && isNonPassive(options));
      const removed = remove.mock.calls.filter(([eventType, , options]) => eventType === type && isNonPassive(options));
      expect(added.length - removed.length).toBe(1);
    }

    await act(async () => root.unmount());
    for (const type of ['wheel', 'touchmove']) {
      const added = add.mock.calls.filter(([eventType, , options]) => eventType === type && isNonPassive(options));
      const removed = remove.mock.calls.filter(([eventType, , options]) => eventType === type && isNonPassive(options));
      expect(removed).toHaveLength(added.length);
    }
    host.remove();
  });

  it('removes the Overlay and source selector UI and renders card/lines from one S/R view', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<HistoricalChart symbol="RKLB" prices={prices} supportResistance={supportResistance}/>));

    expect(host.querySelector('select[aria-label="Support resistance source"]')).toBeNull();
    for (const removedText of ['Overlay', 'Pivot', 'Smart Structure', 'OI Concentration', 'Expected Move', 'Confluence']) {
      expect(host.textContent).not.toContain(removedText);
    }
    const srButtons = [...host.querySelectorAll('button')].filter((button) => button.textContent === 'S/R');
    expect(srButtons).toHaveLength(1);
    await act(async () => srButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const chartLabels = [...host.querySelectorAll('[data-reference-level]')].map((node) => node.getAttribute('data-reference-level'));
    expect(chartLabels).toEqual(expect.arrayContaining(['R1 75.00', 'S1 65.00']));
    const summary = host.querySelector('[aria-label="Support and resistance summary"]');
    expect(summary?.textContent).toContain('R1');
    expect(summary?.textContent).toContain('$75.00');
    expect(summary?.textContent).toContain('S1');
    expect(summary?.textContent).toContain('$65.00');

    await act(async () => root.unmount());
    host.remove();
  });
});
