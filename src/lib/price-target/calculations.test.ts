import { describe, expect, it } from 'vitest';
import {
  calculatePriceTarget,
  convertUsdForDisplay,
  formatDisplayMoney,
  formatSignedPercent,
  parseFiniteDraft,
  validatePriceTarget,
  type PriceTargetInput,
} from './calculations';

function validInput(overrides: Partial<PriceTargetInput> = {}): PriceTargetInput {
  return {
    symbol: 'NVDA',
    currentPriceUsd: 100,
    stockCurrency: 'USD',
    quoteFreshness: 'realtime',
    years: 3,
    epsMode: 'ttm',
    eps: 5,
    marginOfSafetyPercent: 20,
    forwardGrowthConfirmed: false,
    scenarios: {
      conservative: { growthPercent: 5, targetPe: 15 },
      base: { growthPercent: 10, targetPe: 20 },
      optimistic: { growthPercent: 15, targetPe: 25 },
    },
    ...overrides,
  };
}

describe('price target formulas and scenarios', () => {
  it('applies growth and margin percentages exactly once without intermediate rounding', () => {
    const result = calculatePriceTarget(validInput());
    expect(result.scenarios.base.futureEps).toBeCloseTo(5 * (1.1 ** 3), 12);
    expect(result.scenarios.base.targetPriceUsd).toBeCloseTo(5 * (1.1 ** 3) * 20, 12);
    expect(result.scenarios.base.mosPriceUsd).toBeCloseTo(5 * (1.1 ** 3) * 20 * 0.8, 12);
  });

  it('calculates conservative, base, and optimistic independently', () => {
    const result = calculatePriceTarget(validInput());
    expect(result.scenarios.conservative.targetPriceUsd).toBeLessThan(result.scenarios.base.targetPriceUsd);
    expect(result.scenarios.base.targetPriceUsd).toBeLessThan(result.scenarios.optimistic.targetPriceUsd);
    expect(result.scenarios.base.differenceUsd).toBeCloseTo(result.scenarios.base.targetPriceUsd - 100, 12);
  });

  it('labels near-zero differences neutrally and normalizes negative zero', () => {
    const result = calculatePriceTarget(validInput({
      years: 1,
      eps: 5,
      marginOfSafetyPercent: 0,
      scenarios: {
        conservative: { growthPercent: 0, targetPe: 20 },
        base: { growthPercent: 0, targetPe: 20 },
        optimistic: { growthPercent: 0, targetPe: 20 },
      },
    }));
    expect(result.scenarios.base.direction).toBe('neutral');
    expect(Object.is(result.scenarios.base.differenceUsd, -0)).toBe(false);
    expect(formatSignedPercent(-0)).toBe('0.00%');
  });
});

describe('price target validation', () => {
  it('blocks P/E results for zero or negative EPS and recommends alternative methods', () => {
    const validation = validatePriceTarget(validInput({ eps: -2 }));
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('DCF, P/S หรือ EV/Sales');
  });

  it('requires explicit confirmation before applying growth to Forward EPS', () => {
    const blocked = validatePriceTarget(validInput({ epsMode: 'forward', forwardGrowthConfirmed: false }));
    expect(blocked.errors.join(' ')).toContain('ป้องกันการนับซ้ำ');
    expect(validatePriceTarget(validInput({ epsMode: 'forward', forwardGrowthConfirmed: true })).valid).toBe(true);
  });

  it('allows Forward EPS without confirmation when all growth assumptions are zero', () => {
    const scenarios = {
      conservative: { growthPercent: 0, targetPe: 15 },
      base: { growthPercent: 0, targetPe: 20 },
      optimistic: { growthPercent: 0, targetPe: 25 },
    };
    expect(validatePriceTarget(validInput({ epsMode: 'forward', scenarios })).valid).toBe(true);
  });

  it('validates selection, years, finite inputs, percentages, currency, and stale data', () => {
    const validation = validatePriceTarget(validInput({
      symbol: null,
      currentPriceUsd: Number.POSITIVE_INFINITY,
      stockCurrency: 'THB',
      quoteFreshness: 'stale',
      years: 2,
      eps: Number.NaN,
      marginOfSafetyPercent: 100,
      scenarios: {
        conservative: { growthPercent: -100, targetPe: 0 },
        base: { growthPercent: Number.NaN, targetPe: Number.POSITIVE_INFINITY },
        optimistic: { growthPercent: 501, targetPe: 501 },
      },
    }));
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('เลือกหุ้น');
    expect(validation.errors.join(' ')).toContain('USD เป็น source of truth');
    expect(validation.errors.join(' ')).toContain('stale');
    expect(validation.errors.join(' ')).toContain('1, 3 หรือ 5 ปี');
  });

  it('warns for unusually high growth, target P/E, and delayed quotes', () => {
    const scenarios = {
      conservative: { growthPercent: 31, targetPe: 51 },
      base: { growthPercent: 31, targetPe: 51 },
      optimistic: { growthPercent: 31, targetPe: 51 },
    };
    const validation = validatePriceTarget(validInput({ quoteFreshness: 'delayed', scenarios }));
    expect(validation.valid).toBe(true);
    expect(validation.warnings.join(' ')).toContain('ไม่ใช่ราคาสด');
    expect(validation.warnings.join(' ')).toContain('สูงกว่า 30%');
    expect(validation.warnings.join(' ')).toContain('สูงกว่า 50 เท่า');
  });
});

describe('price target display-only currency conversion and parsing', () => {
  it('keeps USD as source of truth and converts only the displayed value', () => {
    expect(convertUsdForDisplay(100, 'USD', null)).toBe(100);
    expect(convertUsdForDisplay(100, 'THB', 35)).toBe(3500);
    expect(formatDisplayMoney(100, 'THB', 35)).toContain('3,500.00');
  });

  it('never falls back to a 1:1 THB rate when FX is missing or invalid', () => {
    expect(convertUsdForDisplay(100, 'THB', null)).toBeNull();
    expect(convertUsdForDisplay(100, 'THB', 0)).toBeNull();
    expect(formatDisplayMoney(100, 'THB', null)).toBe('unavailable');
  });

  it('rejects NaN and Infinity drafts and outputs', () => {
    expect(parseFiniteDraft('NaN')).toBeNull();
    expect(parseFiniteDraft('Infinity')).toBeNull();
    expect(parseFiniteDraft('')).toBeNull();
    expect(parseFiniteDraft('-0')).toBe(0);
    expect(formatDisplayMoney(Number.POSITIVE_INFINITY, 'USD', null)).toBe('unavailable');
  });
});
