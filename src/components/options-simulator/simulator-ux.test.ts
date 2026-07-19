import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  aggregatePortfolioSensitivity,
  BASIC_PATH_OPTIONS,
  calendarDaysBetween,
  clampTargetDate,
  engineVolatilityToPercent,
  formatPremiumDigits,
  isBasicPathOption,
  normalizePercentDraft,
  parseFiniteDraft,
  parsePercentDraft,
  parsePremiumPaste,
  percentVolatilityToEngine,
  premiumFromDigitString,
  targetDateError,
} from './simulator-ux';

describe('Options Simulator UX helpers', () => {
  it('keeps calendar dates stable without local timezone conversion', () => {
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(calendarDaysBetween('2026-12-31', '2027-01-02')).toBe(2);
  });

  it('clamps Target Date after valuation and no later than expiration', () => {
    expect(clampTargetDate('2026-07-19', '2026-07-19', '2026-08-19')).toBe('2026-07-20');
    expect(clampTargetDate('2026-09-01', '2026-07-19', '2026-08-19')).toBe('2026-08-19');
    expect(targetDateError('2026-07-19', '2026-07-19', '2026-08-19')).toContain('หลังวันที่คำนวณ');
    expect(targetDateError('2026-08-20', '2026-07-19', '2026-08-19')).toContain('ไม่เกินวันหมดอายุ');
  });

  it('allows an empty numeric draft and never returns NaN or Infinity', () => {
    expect(parseFiniteDraft('')).toBeNull();
    expect(parseFiniteDraft('1.50')).toBe(1.5);
    expect(parseFiniteDraft('Infinity')).toBeNull();
    expect(parseFiniteDraft('not-a-number')).toBeNull();
  });

  it('supports cents-style Premium typing and currency paste without NaN', () => {
    expect(formatPremiumDigits('1')).toBe('0.01');
    expect(formatPremiumDigits('14')).toBe('0.14');
    expect(formatPremiumDigits('140')).toBe('1.40');
    expect(formatPremiumDigits('1500')).toBe('15.00');
    expect(premiumFromDigitString('140')).toBe(1.4);
    expect(parsePremiumPaste('$1.40')).toBe(1.4);
    expect(parsePremiumPaste('1.40')).toBe(1.4);
    expect(parsePremiumPaste('140')).toBe(1.4);
    expect(parsePremiumPaste('-1.40')).toBeNull();
  });

  it('converts IV once between percentage points and engine decimals', () => {
    expect(percentVolatilityToEngine(114.5)).toBeCloseTo(1.145, 10);
    expect(engineVolatilityToPercent(1.145)).toBeCloseTo(114.5, 10);
    expect(percentVolatilityToEngine(engineVolatilityToPercent(1.145))).toBeCloseTo(1.145, 10);
    expect(normalizePercentDraft('00114.50')).toBe('114.50');
    expect(normalizePercentDraft('114.501')).toBeNull();
    expect(parsePercentDraft('114.50')).toBe(114.5);
  });

  it('aggregates each leg Greek by side, quantity and multiplier', () => {
    expect(aggregatePortfolioSensitivity([
      { side: 'buy', quantity: 2, multiplier: 100, delta: 0.5, theta: -0.04 },
      { side: 'sell', quantity: 1, multiplier: 50, delta: 0.2, theta: -0.01 },
    ])).toEqual({ delta: 90, theta: -7.5 });
  });

  it('exposes only the approved path counts in the requested order', () => {
    expect(BASIC_PATH_OPTIONS).toEqual([1_000, 5_000, 10_000, 25_000, 50_000]);
    expect(isBasicPathOption(10_000)).toBe(true);
    expect(isBasicPathOption(2_000)).toBe(false);
  });
});
