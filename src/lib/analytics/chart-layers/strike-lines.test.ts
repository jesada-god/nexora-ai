import { describe, expect, it } from 'vitest';
import { normalizeStrikeLine, parseStrikeLines, strikeDistance } from './strike-lines';

describe('manual strike price lines', () => {
  it('accepts only positive local-only strike preferences', () => {
    expect(normalizeStrikeLine({ id: 'a', price: 0, optionType: 'call' })).toBeNull();
    expect(normalizeStrikeLine({ id: 'a', price: 50, optionType: 'put', label: '', expiration: '2026-08-21', visible: true })).toEqual({ id: 'a', price: 50, optionType: 'put', label: 'Put 50', expiration: '2026-08-21', visible: true });
  });

  it('dedupes ids and ignores malformed storage', () => {
    expect(parseStrikeLines('{')).toEqual([]);
    expect(parseStrikeLines(JSON.stringify([
      { id: 'a', price: 50, optionType: 'call' },
      { id: 'a', price: 55, optionType: 'call' },
    ]))).toHaveLength(1);
  });

  it('reports signed dollar and percentage distance from spot', () => {
    expect(strikeDistance(110, 100)).toEqual({ dollars: 10, percent: 10 });
  });
});
