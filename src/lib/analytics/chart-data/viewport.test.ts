import { describe, expect, it } from 'vitest';
import { fitLogicalRange, initialLogicalRange, panLogicalRange, zoomLogicalRange } from './viewport';

describe('professional chart logical viewport', () => {
  it('uses one range for both panes while zooming and panning', () => {
    const fitted = fitLogicalRange(100);
    const zoomed = zoomLogicalRange(fitted, 100, 0.5, 0.75);
    const panned = panLogicalRange(zoomed, 100, -10);
    expect(zoomed.end - zoomed.start + 1).toBe(50);
    expect(panned).toEqual({ start: 28, end: 77 });
    expect([panned.start, panned.end]).toEqual([panned.start, panned.end]);
  });

  it('clamps at both timeline edges', () => {
    expect(panLogicalRange({ start: 0, end: 9 }, 20, -99)).toEqual({ start: 0, end: 9 });
    expect(panLogicalRange({ start: 0, end: 9 }, 20, 99)).toEqual({ start: 10, end: 19 });
  });

  it('keeps zoom inside safe bounds and distinguishes Fit from Reset', () => {
    expect(initialLogicalRange(100, 30)).toEqual({ start: 70, end: 99 });
    expect(fitLogicalRange(100)).toEqual({ start: 0, end: 99 });
    expect(zoomLogicalRange({ start: 20, end: 39 }, 100, 0.001, 0.5)).toEqual({ start: 26, end: 33 });
    expect(zoomLogicalRange({ start: 20, end: 39 }, 100, 999, 0.5)).toEqual({ start: 0, end: 99 });
  });
});
