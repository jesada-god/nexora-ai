import { describe, expect, it } from 'vitest';
import {
  classifyAlpacaControl,
  isHaltCode,
  normalizeAlpacaMessage,
  rfc3339ToMillis,
} from './alpaca-normalize';

describe('rfc3339ToMillis', () => {
  it('parses millisecond precision', () => {
    expect(rfc3339ToMillis('2024-01-02T15:04:05.123Z')).toBe(Date.parse('2024-01-02T15:04:05.123Z'));
  });

  it('truncates nanosecond precision to milliseconds', () => {
    expect(rfc3339ToMillis('2024-01-02T15:04:05.123456789Z')).toBe(Date.parse('2024-01-02T15:04:05.123Z'));
  });

  it('returns null for garbage', () => {
    expect(rfc3339ToMillis('not-a-date')).toBeNull();
  });
});

describe('normalizeAlpacaMessage', () => {
  it('maps a trade (t) and upper-cases the symbol', () => {
    const event = normalizeAlpacaMessage({ T: 't', S: 'aapl', p: 190.25, s: 100, t: '2024-01-02T15:04:05.5Z', z: 'C', c: ['@'] });
    expect(event).toMatchObject({ kind: 'trade', symbol: 'AAPL', price: 190.25, size: 100, tape: 'C', conditions: ['@'] });
  });

  it('maps a quote (q) with separate bid/ask', () => {
    const event = normalizeAlpacaMessage({ T: 'q', S: 'AAPL', bp: 190.1, bs: 2, ap: 190.2, as: 3, t: '2024-01-02T15:04:05Z' });
    expect(event).toMatchObject({ kind: 'quote', bidPrice: 190.1, askPrice: 190.2, bidSize: 2, askSize: 3 });
  });

  it('maps an official bar (b) as updated:false and an updated bar (u) as updated:true', () => {
    const base = { S: 'AAPL', o: 1, h: 2, l: 0.5, c: 1.5, v: 1000, t: '2024-01-02T15:04:00Z' };
    expect(normalizeAlpacaMessage({ T: 'b', ...base })).toMatchObject({ kind: 'bar', updated: false, volume: 1000 });
    expect(normalizeAlpacaMessage({ T: 'u', ...base })).toMatchObject({ kind: 'bar', updated: true });
  });

  it('maps a trading status (s) and derives halted from the code', () => {
    const halted = normalizeAlpacaMessage({ T: 's', S: 'AAPL', sc: 'H', sm: 'Trading Halt', rc: 'T12', rm: 'News Pending', t: '2024-01-02T15:04:05Z' });
    expect(halted).toMatchObject({ kind: 'status', halted: true, statusCode: 'H', reasonCode: 'T12' });
    const resumed = normalizeAlpacaMessage({ T: 's', S: 'AAPL', sc: 'T', sm: 'Trading Resumption', t: '2024-01-02T15:04:05Z' });
    expect(resumed).toMatchObject({ kind: 'status', halted: false });
  });

  it('rejects a non-positive trade price', () => {
    expect(normalizeAlpacaMessage({ T: 't', S: 'AAPL', p: 0, s: 100, t: '2024-01-02T15:04:05Z' })).toBeNull();
  });

  it('returns null for missing fields or non-market frames', () => {
    expect(normalizeAlpacaMessage({ T: 't', S: 'AAPL', s: 100, t: '2024-01-02T15:04:05Z' })).toBeNull();
    expect(normalizeAlpacaMessage({ T: 'success', msg: 'connected' })).toBeNull();
    expect(normalizeAlpacaMessage(null)).toBeNull();
    expect(normalizeAlpacaMessage('nope')).toBeNull();
  });
});

describe('classifyAlpacaControl', () => {
  it('classifies success and error frames', () => {
    expect(classifyAlpacaControl({ T: 'success', msg: 'authenticated' })).toEqual({ kind: 'success', message: 'authenticated' });
    expect(classifyAlpacaControl({ T: 'error', code: 402, msg: 'auth failed' })).toEqual({ kind: 'error', code: 402, message: 'auth failed' });
    expect(classifyAlpacaControl({ T: 't', S: 'AAPL' })).toBeNull();
  });

  it('surfaces the subscription ack: the union of symbols and per-channel lists', () => {
    const control = classifyAlpacaControl({
      T: 'subscription',
      trades: ['AAPL'],
      quotes: ['AAPL', 'msft'],
      bars: [],
      statuses: ['AAPL'],
    });
    expect(control).toEqual({
      kind: 'subscription',
      symbols: ['AAPL', 'MSFT'],
      channels: { trades: ['AAPL'], quotes: ['AAPL', 'msft'], statuses: ['AAPL'] },
    });
  });

  it('reports an empty subscription (feed subscribed to nothing) honestly', () => {
    expect(classifyAlpacaControl({ T: 'subscription', trades: [], quotes: [] })).toEqual({
      kind: 'subscription',
      symbols: [],
      channels: {},
    });
  });
});

describe('isHaltCode', () => {
  it('flags halt/pause codes and not resumption', () => {
    expect(isHaltCode('H')).toBe(true);
    expect(isHaltCode('luds')).toBe(true);
    expect(isHaltCode('MWC1')).toBe(true);
    expect(isHaltCode('T')).toBe(false);
    expect(isHaltCode('Q')).toBe(false);
  });
});
