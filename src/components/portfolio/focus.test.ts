import { describe, expect, it, vi } from 'vitest';
import { normalizeSymbolInput, safeScrollIntoView } from './focus';

describe('portfolio form focus regression', () => {
  it('keeps every character while typing NVDA', () => {
    let value = '';
    for (const character of 'NVDA') value = normalizeSymbolInput(value + character);
    expect(value).toBe('NVDA');
  });
  it('does not scroll null or an unmounted element', () => {
    expect(safeScrollIntoView(null)).toBe(false);
    const scrollIntoView = vi.fn();
    expect(safeScrollIntoView({ isConnected: false, scrollIntoView })).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
