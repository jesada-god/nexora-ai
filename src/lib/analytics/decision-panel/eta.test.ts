import { describe, expect, it } from 'vitest';
import { blendEta, estimateAtrEta, estimateEta, estimateIvEta } from './eta';
import { formatEtaRange } from './format';

describe('estimateAtrEta', () => {
  it('is a deterministic fixture: 5 price units at ATR 2.5 over 1h bars', () => {
    const result = estimateAtrEta({ priceDistance: 5, atr: { value: 2.5, barMinutes: 60, timeframe: '1h' } });
    expect(result.status).toBe('available');
    expect(result.method).toBe('atr');
    // bars = 5 / 2.5 = 2; central = 2h; band 0.6–1.8 → 1.2h – 3.6h.
    expect(result.minMarketHours).toBeCloseTo(1.2, 10);
    expect(result.maxMarketHours).toBeCloseTo(3.6, 10);
    expect(result.confidence).toBe('high');
  });

  it('returns unavailable when the ATR is missing or non-positive', () => {
    expect(estimateAtrEta({ priceDistance: 5, atr: { value: 0, barMinutes: 60, timeframe: '1h' } }).status).toBe('unavailable');
    expect(estimateAtrEta({ priceDistance: 5, atr: { value: Number.NaN, barMinutes: 60, timeframe: '1h' } }).status).toBe('unavailable');
  });

  it('lowers confidence for far levels', () => {
    expect(estimateAtrEta({ priceDistance: 100, atr: { value: 2, barMinutes: 60, timeframe: '1h' } }).confidence).toBe('low');
  });
});

describe('estimateIvEta', () => {
  it('is a deterministic fixture from real ATM IV and days-to-expiration', () => {
    const result = estimateIvEta({ priceDistance: 5, acceptedPrice: 100, iv: { atmIv: 0.4, daysToExpiration: 30 }, marketHoursPerDay: 6.5 });
    expect(result.status).toBe('available');
    expect(result.method).toBe('iv');
    // t = 365 * (5/(100*0.4))^2 = 365 * (0.125)^2 = 5.703125 calendar days.
    // tradingDays = 5.703125 * 252/365 = 3.9375 ; hours = *6.5 = 25.59375 ; band 0.5–2.0.
    expect(result.minMarketHours).toBeCloseTo(12.796875, 6);
    expect(result.maxMarketHours).toBeCloseTo(51.1875, 6);
  });

  it('returns unavailable when IV is missing (never substituted)', () => {
    expect(estimateIvEta({ priceDistance: 5, acceptedPrice: 100, iv: { atmIv: 0, daysToExpiration: 30 }, marketHoursPerDay: 6.5 }).status).toBe('unavailable');
  });
});

describe('blendEta and estimateEta', () => {
  it('blends only when both ATR and IV are available', () => {
    const atr = estimateAtrEta({ priceDistance: 5, atr: { value: 2.5, barMinutes: 60, timeframe: '1h' } });
    const iv = estimateIvEta({ priceDistance: 5, acceptedPrice: 100, iv: { atmIv: 0.4, daysToExpiration: 30 }, marketHoursPerDay: 6.5 });
    const blended = blendEta(atr, iv);
    expect(blended.status).toBe('available');
    expect(blended.method).toBe('blended');
    expect(blended.minMarketHours).toBeCloseTo((1.2 + 12.796875) / 2, 6);
    expect(blended.maxMarketHours).toBeCloseTo((3.6 + 51.1875) / 2, 6);
  });

  it('prefers blended when both inputs valid, falls back to the single method otherwise', () => {
    const both = estimateEta({ priceDistance: 5, acceptedPrice: 100, eta: { atr: { value: 2.5, barMinutes: 60, timeframe: '1h' }, iv: { atmIv: 0.4, daysToExpiration: 30 } } });
    expect(both.method).toBe('blended');

    const atrOnly = estimateEta({ priceDistance: 5, acceptedPrice: 100, eta: { atr: { value: 2.5, barMinutes: 60, timeframe: '1h' } } });
    expect(atrOnly.method).toBe('atr');

    const ivOnly = estimateEta({ priceDistance: 5, acceptedPrice: 100, eta: { iv: { atmIv: 0.4, daysToExpiration: 30 } } });
    expect(ivOnly.method).toBe('iv');
  });

  it('returns unavailable when neither ATR nor IV is present', () => {
    const none = estimateEta({ priceDistance: 5, acceptedPrice: 100, eta: {} });
    expect(none.status).toBe('unavailable');
    expect(none.method).toBeNull();
  });
});

describe('formatEtaRange — no false precision', () => {
  it('never emits minute-level precision', () => {
    const eta = estimateEta({ priceDistance: 5, acceptedPrice: 100, eta: { iv: { atmIv: 0.4, daysToExpiration: 30 } } });
    const text = formatEtaRange(eta);
    expect(text).toMatch(/estimated range/i);
    // No "13h 52m" / "1:23" style precision.
    expect(text).not.toMatch(/\d+\s*h\s*\d+\s*m/i);
    expect(text).not.toMatch(/\d+:\d+/);
  });

  it('uses coarse buckets (hours then half-days)', () => {
    expect(formatEtaRange({ status: 'available', method: 'atr', minMarketHours: 1.2, maxMarketHours: 3.6, confidence: 'high', assumptions: [], limitations: [] }))
      .toBe('Estimated range: 1h–4h (market hours)');
    expect(formatEtaRange({ status: 'available', method: 'iv', minMarketHours: 13, maxMarketHours: 52, confidence: 'low', assumptions: [], limitations: [] }, 6.5))
      .toMatch(/\dd/);
  });

  it('renders unavailable estimates truthfully', () => {
    expect(formatEtaRange({ status: 'unavailable', method: null, minMarketHours: null, maxMarketHours: null, confidence: null, assumptions: [], limitations: [] }))
      .toBe('Estimated range: unavailable');
  });
});
