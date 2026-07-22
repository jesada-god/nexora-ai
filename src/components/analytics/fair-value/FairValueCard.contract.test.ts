import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const card = readFileSync(new URL('./FairValueCard.tsx', import.meta.url), 'utf8');
const drawer = readFileSync(new URL('./FairValueDetailsDrawer.tsx', import.meta.url), 'utf8');
const stock = readFileSync(new URL('../../stock/StockDetailClient.tsx', import.meta.url), 'utf8');

describe('Stock Overview Fair Value contract', () => {
  it('replaces Previous Close in the same eight-slot grid without a fallback', () => {
    expect(stock).not.toContain("['Previous close'");
    const before = stock.indexOf('beforeFairValue.map');
    const fairValue = stock.indexOf('<FairValueCard', before);
    const after = stock.indexOf('afterFairValue.map', fairValue);
    expect(before).toBeGreaterThan(-1);
    expect(fairValue).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(fairValue);
    expect(stock.slice(fairValue, after)).toContain('symbol={symbol}');
    expect(stock.slice(fairValue, after)).toContain('enabled={fairValueEnabled}');
  });

  it('uses the existing accessible Drawer behavior and a 44px trigger', () => {
    expect(card).toContain('min-h-11 min-w-11');
    expect(card).toContain('aria-label="ดูวิธีคำนวณ Fair Value"');
    expect(card).toContain('aria-expanded={open}');
    expect(card).toContain('aria-controls={drawerId}');
    expect(card).toContain('aria-haspopup="dialog"');
    expect(drawer).toContain('<Drawer id={id}');
  });

  it('has no Fair Value currency toggle and never converts the model estimate to THB', () => {
    // Section 5: the USD/THB toggle and conversion were removed from the Fair Value UI.
    // The model estimate is always shown in the instrument's source currency (USD).
    expect(card).not.toContain('setCurrency');
    expect(card).not.toContain('convertUsdForDisplay');
    expect(card).not.toContain("'THB'");
    expect(drawer).not.toContain('displayFx');
    expect(card).toContain('formatFairValueMoney(base)');
  });

  it('does not refetch when details change and exposes provider disclosure', () => {
    expect(card).toContain('onClick={() => setOpen(true)}');
    expect(card.match(/requestFairValue\(/g)).toHaveLength(1);
    expect(drawer).toContain('Provider:');
    expect(drawer).toContain('Model estimate — not a market quote');
  });

  it('aborts on symbol change/unmount and guards against stale responses', () => {
    expect(card).toContain('const controller = new AbortController()');
    expect(card).toContain('if (current) setResult({ key: requestKey, data, error: null })');
    expect(card).toContain('result?.key === requestKey');
    expect(card).toContain('controller.abort()');
  });

  it('localizes disabled and unavailable Fair Value copy', () => {
    expect(card).toContain("'ไม่พร้อมใช้งาน'");
    expect(card).toContain("'Unavailable'");
    expect(card).toContain("'ระบบ Fair Value ถูกปิดอยู่'");
    expect(card).toContain("'Fair Value feature is disabled'");
  });
});
