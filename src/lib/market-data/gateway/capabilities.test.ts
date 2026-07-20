import { describe, expect, it } from 'vitest';
import { compatibleSelection, defaultIntervalForRange, isCompatibleSelection, polygonAggregateResolution, supportedRangesForInterval } from './capabilities';

describe('market gateway compatibility', () => {
  it('defaults Range 1D to intraday candles', () => {
    expect(defaultIntervalForRange('1d')).toBe('5m');
    expect(isCompatibleSelection('5m', '1d')).toBe(true);
  });

  it('repairs Interval 1D + Range 1D before an API request', () => {
    expect(compatibleSelection('1D', '1d', 'interval')).toEqual(expect.objectContaining({ interval: '1D', range: '6m', changed: true }));
    expect(compatibleSelection('1D', '1d', 'interval').notice).toContain('6M');
  });

  it('supports 5Y with daily, weekly, and monthly candles', () => {
    for (const interval of ['1D', 'Week', 'Month'] as const) expect(supportedRangesForInterval(interval)).toContain('5y');
  });

  it('maps Polygon native aggregate resolutions without fabricating bars', () => {
    expect(polygonAggregateResolution('10m')).toMatchObject({ multiplier: 10, timespan: 'minute' });
    expect(polygonAggregateResolution('4h')).toMatchObject({ multiplier: 4, timespan: 'hour' });
    expect(polygonAggregateResolution('Month')).toMatchObject({ multiplier: 1, timespan: 'month' });
  });
});

