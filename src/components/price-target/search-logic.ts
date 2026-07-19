export const STOCK_SEARCH_DEBOUNCE_MS = 300;

export type SearchKeyDecision =
  | { action: 'ignore' }
  | { action: 'move'; index: number }
  | { action: 'select'; index: number }
  | { action: 'close' };

export function searchKeyDecision(key: string, open: boolean, activeIndex: number, count: number): SearchKeyDecision {
  if (!open) return { action: 'ignore' };
  if (key === 'Escape') return { action: 'close' };
  if (key === 'ArrowDown') return { action: 'move', index: count === 0 ? -1 : activeIndex >= count - 1 ? 0 : activeIndex + 1 };
  if (key === 'ArrowUp') return { action: 'move', index: count === 0 ? -1 : activeIndex <= 0 ? count - 1 : activeIndex - 1 };
  if (key === 'Enter' && activeIndex >= 0 && activeIndex < count) return { action: 'select', index: activeIndex };
  return { action: 'ignore' };
}
