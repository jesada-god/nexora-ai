import { describe, expect, it } from 'vitest';
import { planInstrumentSync, redactInstrumentSyncError } from './sync-plan';
import type { MarketInstrumentInput } from './types';

function instrument(symbol: string, overrides: Partial<MarketInstrumentInput> = {}): MarketInstrumentInput {
  return { provider_symbol: symbol, symbol, name: symbol, exchange: 'NYSE', asset_type: 'Stock', currency: 'USD', country: 'US', status: 'active', ipo_date: null, delisting_date: null, ...overrides };
}

describe('instrument batch upsert planning', () => {
  it('counts inserted, updated, skipped and marks missing active instruments updated', () => {
    const counts = planInstrumentSync(
      [instrument('SAME'), instrument('CHANGED'), instrument('MISSING')],
      [instrument('SAME'), instrument('CHANGED', { name: 'Changed name' }), instrument('NEW')],
      2,
    );
    expect(counts).toEqual({ inserted: 1, updated: 2, skipped: 1, failed: 2 });
  });

  it('is idempotent when the same normalized snapshot is applied again', () => {
    const snapshot = [instrument('BRK.B'), instrument('SPY', { asset_type: 'ETF' })];
    expect(planInstrumentSync(snapshot, snapshot)).toEqual({ inserted: 0, updated: 0, skipped: 2, failed: 0 });
  });

  it('redacts API keys from structured errors', () => {
    const message = redactInstrumentSyncError('https://example.test?function=X&apikey=super-secret ALPHA_VANTAGE_API_KEY=another-secret');
    expect(message).not.toContain('super-secret');
    expect(message).not.toContain('another-secret');
    expect(message).toContain('[redacted]');
  });
});

