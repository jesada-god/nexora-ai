import { describe, expect, it, vi } from 'vitest';
import { canLoadFairValue, toggleFairValueLayer } from './load-policy';
describe('Fair Value lazy UI policy', () => {
  it('loads only after the enabled section is open and Analyze is requested', () => { expect(canLoadFairValue(true, true, true, false)).toBe(true); expect(canLoadFairValue(true, true, false, false)).toBe(false); expect(canLoadFairValue(false, true, true, false)).toBe(false); });
  it('toggles the chart layer with zero provider calls', () => { const provider = vi.fn(); expect(toggleFairValueLayer(false)).toBe(true); expect(toggleFairValueLayer(true)).toBe(false); expect(provider).not.toHaveBeenCalled(); });
});
