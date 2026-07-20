import { describe, expect, it } from 'vitest';
import {
  convertUsdForDisplay,
  fairValueUnavailableLabel,
  formatUpsidePercent,
  upsideTone,
} from './presentation';

describe('Fair Value card presentation', () => {
  it('keeps USD authoritative and converts THB exactly once', () => {
    expect(convertUsdForDisplay(100, 'USD', 35)).toBe(100);
    expect(convertUsdForDisplay(100, 'THB', 35)).toBe(3500);
    expect(convertUsdForDisplay(3500, 'THB', null)).toBeNull();
  });

  it('formats deterministic semantic upside states without NaN or Infinity', () => {
    expect(formatUpsidePercent(12.4)).toBe('+12.40%');
    expect(formatUpsidePercent(-8.25)).toBe('-8.25%');
    expect(formatUpsidePercent(Number.NaN)).toBe('Unavailable');
    expect(upsideTone(12.4)).toBe('success');
    expect(upsideTone(-8.25)).toBe('danger');
    expect(upsideTone(0)).toBe('neutral');
  });

  it('distinguishes provider, sufficiency, and calculation failures', () => {
    expect(fairValueUnavailableLabel('provider-unavailable', 'th')).toBe('ผู้ให้บริการไม่มีข้อมูล');
    expect(fairValueUnavailableLabel('insufficient-data', 'th')).toBe('ข้อมูลไม่ผ่านเกณฑ์ขั้นต่ำ');
    expect(fairValueUnavailableLabel('calculation-failure', 'en')).toBe('Calculation failed');
  });
});
