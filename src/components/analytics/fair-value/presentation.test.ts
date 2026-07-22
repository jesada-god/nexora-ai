import { describe, expect, it } from 'vitest';
import {
  fairValueUnavailableLabel,
  fairValueMissingFieldsSummary,
  fairValueUnavailableReason,
  formatFairValueMoney,
  formatUpsidePercent,
  upsideTone,
} from './presentation';

describe('Fair Value card presentation', () => {
  it('always formats the model estimate in USD with no THB conversion', () => {
    expect(formatFairValueMoney(100)).toBe('$100.00');
    expect(formatFairValueMoney(3.92)).toBe('$3.92');
    expect(formatFairValueMoney(null)).toBe('Unavailable');
    expect(formatFairValueMoney(Number.NaN)).toBe('Unavailable');
  });

  it('formats deterministic semantic upside states without NaN or Infinity', () => {
    expect(formatUpsidePercent(12.4)).toBe('+12.40%');
    expect(formatUpsidePercent(-8.25)).toBe('-8.25%');
    expect(formatUpsidePercent(Number.NaN)).toBe('Unavailable');
    expect(upsideTone(12.4)).toBe('success');
    expect(upsideTone(-8.25)).toBe('danger');
    expect(upsideTone(0)).toBe('neutral');
  });

  it('distinguishes provider, sufficiency, meaningfulness, rate-limit, and server failures', () => {
    expect(fairValueUnavailableLabel('provider-unavailable', 'th')).toBe('ผู้ให้บริการไม่มีข้อมูล');
    expect(fairValueUnavailableLabel('insufficient-data', 'th')).toBe('ข้อมูลไม่ผ่านเกณฑ์ขั้นต่ำ');
    expect(fairValueUnavailableLabel('not-meaningful', 'en')).toBe('No meaningful valuation model');
    expect(fairValueUnavailableLabel('rate-limited', 'en')).toBe('Rate limited');
    expect(fairValueUnavailableLabel('server-error', 'en')).toBe('Server error');
  });

  it('turns provider field identifiers into a human-readable Thai reason', () => {
    expect(fairValueMissingFieldsSummary([
      'annual:2025-12-31:freeCashFlow',
      'annual:2025-12-31:ebitda',
      'historicalFinancials>=3Periods',
    ], 'th')).toBe('ขาด FCF, EBITDA และข้อมูลย้อนหลัง 3 งวด');
  });

  it('keeps the provider reason visible for RKLB unavailable results', () => {
    expect(fairValueUnavailableReason({
      status: 'unavailable',
      failureKind: 'provider-unavailable',
      symbol: 'RKLB',
      currency: 'USD',
      provider: 'alpha-vantage',
      reason: 'Provider has no complete financial statements for RKLB.',
      missingFields: ['historicalFinancials>=3Periods'],
      missingInputs: ['historicalFinancials>=3Periods'],
      staleInputs: [],
      asOf: '2026-07-17',
      calculatedAt: '2026-07-20T00:00:00.000Z',
      methodologyVersion: 'nexora-fv-v1',
      limitations: [],
    }, 'en')).toBe(
      'Missing three historical financial periods · Provider has no complete financial statements for RKLB.',
    );
  });
});
