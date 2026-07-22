import { describe, expect, it } from 'vitest';
import { finalizedTimelineSignature, type TimelineBar } from './finalized-timeline';

interface Bar extends TimelineBar { time: string }
const bar = (time: string, close: number, volume: number | null = 100): Bar => ({
  time, open: close - 1, high: close + 1, low: close - 2, close, volume,
});
const sig = (bars: Bar[]) => finalizedTimelineSignature(bars, (b) => b.time);

describe('finalizedTimelineSignature — recompute gating', () => {
  it('is stable when only the last (forming) bar drifts intra-bar', () => {
    const base = [bar('t1', 10), bar('t2', 11), bar('t3', 12)];
    const drifted = [bar('t1', 10), bar('t2', 11), { ...bar('t3', 12), close: 12.5, high: 13, volume: 250 }];
    // Same last-bar time, different last-bar OHLCV → signature unchanged.
    expect(sig(drifted)).toBe(sig(base));
  });

  it('changes when a new finalized bar is appended (new bucket opens)', () => {
    const before = [bar('t1', 10), bar('t2', 11)];
    const after = [bar('t1', 10), bar('t2', 11), bar('t3', 12)];
    expect(sig(after)).not.toBe(sig(before));
  });

  it('changes when an official-bar reconciliation edits a completed bar', () => {
    const before = [bar('t1', 10), bar('t2', 11), bar('t3', 12)];
    const reconciled = [bar('t1', 10), { ...bar('t2', 11), close: 11.4, volume: 900 }, bar('t3', 12)];
    expect(sig(reconciled)).not.toBe(sig(before));
  });

  it('changes on a dataset/timeframe/symbol switch (different bars entirely)', () => {
    const daily = [bar('2024-01-01', 10), bar('2024-01-02', 11), bar('2024-01-03', 12)];
    const intraday = [bar('2024-01-03T15:00:00Z', 12), bar('2024-01-03T15:01:00Z', 12.2), bar('2024-01-03T15:02:00Z', 12.4)];
    expect(sig(intraday)).not.toBe(sig(daily));
  });

  it('changes when the newest bar time changes even if count is equal', () => {
    const a = [bar('t1', 10), bar('t2', 11), bar('t3', 12)];
    const b = [bar('t1', 10), bar('t2', 11), bar('t4', 12)];
    expect(sig(b)).not.toBe(sig(a));
  });

  it('handles empty and single-bar timelines', () => {
    expect(sig([])).toBe('0');
    // A lone forming bar contributes only its identity, so its drift is ignored.
    expect(sig([bar('t1', 10)])).toBe(sig([{ ...bar('t1', 10), close: 99 }]));
  });
});
