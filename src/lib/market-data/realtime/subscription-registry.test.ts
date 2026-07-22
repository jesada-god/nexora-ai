import { describe, expect, it } from 'vitest';
import { SubscriptionRegistry } from './subscription-registry';

describe('SubscriptionRegistry reference counting', () => {
  it('subscribes upstream only on the 0 → 1 transition', () => {
    const registry = new SubscriptionRegistry();
    const first = registry.acquire(['AAPL'], ['trades']);
    expect(first.added).toEqual([{ symbol: 'AAPL', channel: 'trades' }]);
    const second = registry.acquire(['AAPL'], ['trades']);
    expect(second.added).toEqual([]);
    expect(registry.refCount('AAPL', 'trades')).toBe(2);
  });

  it('unsubscribes upstream only on the 1 → 0 transition', () => {
    const registry = new SubscriptionRegistry();
    registry.acquire(['AAPL'], ['trades']);
    registry.acquire(['AAPL'], ['trades']);
    expect(registry.release(['AAPL'], ['trades']).removed).toEqual([]);
    expect(registry.release(['AAPL'], ['trades']).removed).toEqual([{ symbol: 'AAPL', channel: 'trades' }]);
    expect(registry.refCount('AAPL', 'trades')).toBe(0);
  });

  it('normalizes and de-duplicates symbols', () => {
    const registry = new SubscriptionRegistry();
    const result = registry.acquire([' aapl ', 'AAPL', 'msft'], ['quotes']);
    expect(result.accepted).toEqual(['AAPL', 'MSFT']);
    expect(registry.activeSymbols()).toEqual(['AAPL', 'MSFT']);
  });

  it('enforces the distinct-symbol cap and reports rejected symbols', () => {
    const registry = new SubscriptionRegistry(3);
    const result = registry.acquire(['A', 'B', 'C', 'D', 'E'], ['trades']);
    expect(result.accepted).toEqual(['A', 'B', 'C']);
    expect(result.rejected).toEqual(['D', 'E']);
    expect(registry.activeSymbols()).toEqual(['A', 'B', 'C']);
  });

  it('always admits an already-active symbol even when at capacity', () => {
    const registry = new SubscriptionRegistry(2);
    registry.acquire(['A', 'B'], ['trades']);
    const result = registry.acquire(['A'], ['quotes']);
    expect(result.accepted).toEqual(['A']);
    expect(result.rejected).toEqual([]);
    expect(result.added).toEqual([{ symbol: 'A', channel: 'quotes' }]);
  });

  it('frees a slot when a symbol fully releases', () => {
    const registry = new SubscriptionRegistry(1);
    registry.acquire(['A'], ['trades']);
    expect(registry.acquire(['B'], ['trades']).rejected).toEqual(['B']);
    registry.release(['A'], ['trades']);
    expect(registry.acquire(['B'], ['trades']).accepted).toEqual(['B']);
  });

  it('snapshots every active pair for resubscribe after reconnect', () => {
    const registry = new SubscriptionRegistry();
    registry.acquire(['AAPL', 'MSFT'], ['trades', 'quotes']);
    const snapshot = registry.snapshot();
    expect(snapshot).toContainEqual({ symbol: 'AAPL', channel: 'trades' });
    expect(snapshot).toContainEqual({ symbol: 'MSFT', channel: 'quotes' });
    expect(snapshot).toHaveLength(4);
  });
});
