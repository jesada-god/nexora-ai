import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(new URL('./PriceTargetWorkspace.tsx', import.meta.url), 'utf8');
const search = readFileSync(new URL('./StockSearch.tsx', import.meta.url), 'utf8');
const info = readFileSync(new URL('./InfoPopover.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../../app/tools/price-target/page.tsx', import.meta.url), 'utf8');

describe('price target workspace UI contract', () => {
  it('uses the system title and keeps P/E as one valuation method', () => {
    expect(page).toContain('title="วิเคราะห์ราคาเป้าหมายหุ้น"');
    expect(workspace).toContain('วิเคราะห์ราคาเป้าหมายหุ้น');
    expect(workspace).toContain('P/E Multiple เป็นหนึ่งในวิธีประเมินมูลค่า');
    expect(workspace).not.toContain('Simulate delay');
  });

  it('searches and selects a real instrument with combobox semantics', () => {
    expect(search).toContain('ค้นหาด้วย Symbol หรือชื่อบริษัท');
    expect(search).toContain('role="combobox"');
    expect(search).toContain('aria-autocomplete="list"');
    expect(search).toContain('aria-activedescendant');
    expect(search).toContain('role="option"');
    expect(search).toContain('onSelect(result)');
    expect(search).toContain('window.setTimeout');
  });

  it('loads only from existing market, analytics, and FX endpoints', () => {
    expect(workspace).toContain('/api/market/quote/');
    expect(workspace).toContain('/api/market/profile/');
    expect(workspace).toContain('/api/analytics/key-statistics/');
    expect(workspace).toContain('fetchFxRate()');
    expect(workspace).toContain('EPS/Key Statistics unavailable');
    expect(workspace).toContain('ระบบไม่สร้างสมมติฐาน Growth ให้เอง');
  });

  it('gives every reusable field and result metric an accessible help dialog', () => {
    expect(info).toContain('min-h-11 min-w-11');
    expect(info).toContain('aria-label={`อธิบาย ${title}`}');
    expect(info).toContain('aria-expanded={open}');
    expect(info).toContain('aria-haspopup="dialog"');
    expect(info).toContain('role="dialog"');
    expect(info).toContain('aria-modal="true"');
    expect(info).toContain('useDialogA11y');
    expect(info).toContain('คืออะไร / ใส่อะไร');
    expect(info).toContain('ดูค่าจากไหน');
    expect(info).toContain('ตัวอย่าง');
    expect(info).toContain('มีผลอย่างไร');
    expect(workspace).toContain('<FieldHeader');
    expect(workspace).toContain('<ResultMetric');
  });

  it('shows source tags, forward-growth confirmation, disabled reason, and explicit disclaimer', () => {
    expect(workspace).toContain('ข้อมูลจริง');
    expect(workspace).toContain('กำหนดเอง');
    expect(workspace).toContain('unavailable');
    expect(workspace).toContain('Forward EPS อาจรวมการเติบโตไว้แล้ว');
    expect(workspace).toContain('ยังคำนวณไม่ได้:');
    expect(workspace).toContain('เป็นมูลค่าจากสมมติฐาน ไม่ใช่ราคาตลาดหรือคำแนะนำลงทุน');
  });

  it('keeps USD authoritative and makes THB display-only without a fallback', () => {
    expect(workspace).toContain('คำนวณใน USD แล้วแปลง THB เฉพาะตอนแสดงผล');
    expect(workspace).toContain("disabled={currency === 'THB' && (fxState !== 'ready' || !fxQuote)}");
    expect(workspace).toContain('ไม่มีอัตรา USD/THB ที่ตรวจสอบได้');
    expect(workspace).not.toContain('usdThbRate ?? 1');
  });

  it('retains mobile-first overflow, touch target, safe-area, and numeric keyboard protections', () => {
    expect(workspace).toContain('min-w-0');
    expect(workspace).toContain('break-words');
    expect(workspace).toContain('env(safe-area-inset-bottom)');
    expect(workspace).toContain('inputMode="decimal"');
    expect(workspace).toContain('min-h-11');
  });
});
