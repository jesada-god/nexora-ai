import { describe, expect, it } from 'vitest';
import { nextSymbolIndex, symbolKeyDecision } from './SymbolPreview';

describe('symbol preview keyboard navigation', () => {
  it('supports arrows and wraps at both ends', () => {
    expect(nextSymbolIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextSymbolIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextSymbolIndex(0, 'ArrowUp', 3)).toBe(2);
  });
  it('stays inactive when empty', () => expect(nextSymbolIndex(0, 'ArrowDown', 0)).toBe(-1));
  it('selects with Enter and closes only the dropdown with Escape', () => {
    expect(symbolKeyDecision('Enter', true, 1, 3)).toEqual({ action: 'select', index: 1 });
    expect(symbolKeyDecision('Escape', true, 1, 3)).toEqual({ action: 'close' });
    expect(symbolKeyDecision('Escape', false, 1, 3)).toEqual({ action: 'ignore' });
  });
});
