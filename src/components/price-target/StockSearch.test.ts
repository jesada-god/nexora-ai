import { describe, expect, it } from 'vitest';
import { STOCK_SEARCH_DEBOUNCE_MS, searchKeyDecision } from './search-logic';

describe('price target stock search keyboard contract', () => {
  it('uses a deterministic debounce interval', () => {
    expect(STOCK_SEARCH_DEBOUNCE_MS).toBe(300);
  });

  it('supports Arrow keys, Enter selection, and Escape close', () => {
    expect(searchKeyDecision('ArrowDown', true, -1, 3)).toEqual({ action: 'move', index: 0 });
    expect(searchKeyDecision('ArrowDown', true, 2, 3)).toEqual({ action: 'move', index: 0 });
    expect(searchKeyDecision('ArrowUp', true, 0, 3)).toEqual({ action: 'move', index: 2 });
    expect(searchKeyDecision('Enter', true, 1, 3)).toEqual({ action: 'select', index: 1 });
    expect(searchKeyDecision('Escape', true, 1, 3)).toEqual({ action: 'close' });
  });

  it('does not select a typed symbol until an actual result is active', () => {
    expect(searchKeyDecision('Enter', true, -1, 3)).toEqual({ action: 'ignore' });
    expect(searchKeyDecision('Enter', true, 0, 0)).toEqual({ action: 'ignore' });
    expect(searchKeyDecision('ArrowDown', true, -1, 0)).toEqual({ action: 'move', index: -1 });
  });
});
