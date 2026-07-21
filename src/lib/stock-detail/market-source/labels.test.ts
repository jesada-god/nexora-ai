import { describe, expect, it } from 'vitest';
import { buildLabel, modeFromFreshness, unavailableLabel } from './labels';

describe('modeFromFreshness', () => {
  it('never labels delayed or end-of-day data as REAL-TIME', () => {
    // The account is not entitled to a real-time feed: realtime is downgraded.
    expect(modeFromFreshness('realtime', true)).toBe('DELAYED');
    expect(modeFromFreshness('delayed', true)).toBe('DELAYED');
    expect(modeFromFreshness('end-of-day', true)).toBe('END-OF-DAY');
    for (const status of ['realtime', 'delayed', 'end-of-day', 'cached', 'stale', 'unknown'] as const) {
      expect(modeFromFreshness(status, true)).not.toBe('REAL-TIME');
    }
  });

  it('maps cached and stale truthfully', () => {
    expect(modeFromFreshness('cached', true)).toBe('CACHED');
    expect(modeFromFreshness('stale', true)).toBe('STALE');
    expect(modeFromFreshness('unknown', true)).toBe('DELAYED');
  });

  it('reports UNAVAILABLE when there is no price', () => {
    expect(modeFromFreshness('delayed', false)).toBe('UNAVAILABLE');
    expect(modeFromFreshness('realtime', false)).toBe('UNAVAILABLE');
  });
});

describe('buildLabel', () => {
  it('carries provider, timestamps and a computed delay age', () => {
    const label = buildLabel({
      status: 'delayed',
      hasPrice: true,
      provider: 'polygon',
      source: 'snapshot',
      exchangeTimestamp: '2026-07-21T13:00:00.000Z',
      receivedAt: '2026-07-21T13:15:30.000Z',
    });
    expect(label.mode).toBe('DELAYED');
    expect(label.provider).toBe('polygon');
    expect(label.source).toBe('snapshot');
    expect(label.exchangeTimestamp).toBe('2026-07-21T13:00:00.000Z');
    expect(label.receivedAt).toBe('2026-07-21T13:15:30.000Z');
    expect(label.delayAgeSeconds).toBe(930);
  });

  it('leaves delay age null when the exchange timestamp is unknown', () => {
    const label = buildLabel({
      status: 'end-of-day',
      hasPrice: true,
      provider: 'polygon',
      source: 'aggregate-fallback',
      exchangeTimestamp: null,
      receivedAt: '2026-07-21T13:15:30.000Z',
      fallbackNote: 'fallback',
    });
    expect(label.delayAgeSeconds).toBeNull();
    expect(label.fallbackNote).toBe('fallback');
  });

  it('drops the source when there is no price', () => {
    const label = buildLabel({
      status: 'delayed',
      hasPrice: false,
      provider: null,
      source: 'snapshot',
      exchangeTimestamp: null,
      receivedAt: '2026-07-21T13:15:30.000Z',
    });
    expect(label.mode).toBe('UNAVAILABLE');
    expect(label.source).toBeNull();
  });
});

describe('unavailableLabel', () => {
  it('is always UNAVAILABLE with no derived source', () => {
    const label = unavailableLabel('2026-07-21T13:15:30.000Z', 'polygon');
    expect(label.mode).toBe('UNAVAILABLE');
    expect(label.source).toBeNull();
    expect(label.provider).toBe('polygon');
  });
});
