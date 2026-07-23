import { describe, expect, it } from 'vitest';
import { resolveChartProvenance } from './chart-live-provenance';

const liveLabel = {
  mode: 'REAL-TIME' as const,
  provider: 'alpaca:iex',
  source: 'aggregate-fallback' as const,
  exchangeTimestamp: '2026-07-24T15:30:00.000Z',
  receivedAt: '2026-07-24T15:30:00.100Z',
  delayAgeSeconds: 0.1,
  fallbackNote: null,
  realtime: true,
  feed: 'iex',
};

describe('chart live provenance', () => {
  it('labels the chart realtime only while drawing an entitled live candle', () => {
    expect(resolveChartProvenance({
      historyStatus: 'delayed',
      historyProvider: 'polygon',
      historyAsOf: '2026-07-24T15:29:00.000Z',
      coveredByLiveSource: true,
      hasLiveCandle: true,
      marketLabel: liveLabel,
    })).toEqual({
      status: 'live',
      provider: 'alpaca:iex',
      asOf: '2026-07-24T15:30:00.000Z',
      realtime: true,
    });
  });

  it('does not claim realtime for history or a non-entitled feed', () => {
    expect(resolveChartProvenance({
      historyStatus: 'partial',
      historyProvider: 'polygon',
      coveredByLiveSource: true,
      hasLiveCandle: false,
      marketLabel: liveLabel,
    }).status).toBe('delayed');
    expect(resolveChartProvenance({
      historyStatus: 'real-time',
      historyProvider: 'polygon',
      coveredByLiveSource: true,
      hasLiveCandle: true,
      marketLabel: { ...liveLabel, realtime: false, mode: 'DELAYED' },
    }).status).toBe('delayed');
  });
});
