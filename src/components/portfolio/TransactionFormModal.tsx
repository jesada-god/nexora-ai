'use client';

import { useRef, type FormEvent } from 'react';
import { Button } from '@/src/components/ui/Button';
import { Modal } from '@/src/components/ui/Modal';
import type { PortfolioTransactionType } from '@/src/lib/portfolio/types';
import { DecimalInput, Field } from './FormControls';
import { SymbolPreview } from './SymbolPreview';

export interface TransactionFormState {
  type: PortfolioTransactionType; symbol: string; quantity: string; price: string; amount: string;
  originalCurrency: 'USD' | 'THB'; fxRateAtTransaction: string; occurredAt: string; note: string; idempotencyKey: string;
}

export const transactionLabels: Record<PortfolioTransactionType, string> = {
  acquisition: 'ซื้อหรือเพิ่มสินทรัพย์', disposal: 'ขายหรือลดสินทรัพย์', dividend: 'รับเงินปันผล',
  deposit: 'ฝากเงินเข้าพอร์ต', withdrawal: 'ถอนเงินออกจากพอร์ต', fee: 'บันทึกค่าธรรมเนียม', adjustment: 'ปรับยอดเงินสด',
};
const helpers: Record<PortfolioTransactionType, string> = {
  acquisition: 'บันทึกย้อนหลังเมื่อมีสินทรัพย์เพิ่มขึ้น', disposal: 'บันทึกย้อนหลังเมื่อมีสินทรัพย์ลดลง โดยห้ามเกินจำนวนที่มี',
  dividend: 'เพิ่มเงินปันผลที่ได้รับแล้วเข้าสู่ยอดเงินสด', deposit: 'เพิ่มเงินสดที่ฝากเข้าพอร์ตจำลอง',
  withdrawal: 'หักเงินสดที่ถอนออกจากพอร์ตจำลอง', fee: 'หักค่าธรรมเนียมที่เกิดขึ้นแล้ว', adjustment: 'เพิ่มยอดเงินสดเพื่อแก้ไขข้อมูลย้อนหลัง',
};

export function TransactionFormModal({ open, editing, form, errors, pending, onChange, onClose, onSubmit }: {
  open: boolean; editing: boolean; form: TransactionFormState; errors: Record<string, string>; pending: boolean;
  onChange: (name: keyof TransactionFormState, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent) => void;
}) {
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const assetType = form.type === 'acquisition' || form.type === 'disposal';
  return <Modal isOpen={open} onClose={onClose} initialFocusRef={firstFieldRef} title={editing ? 'แก้ไขรายการย้อนหลัง' : 'บันทึกรายการย้อนหลัง'} className="scroll-pb-40">
    <form onSubmit={onSubmit} className="space-y-4 pb-2">
      <p className="rounded-lg bg-slate-950/50 p-3 text-xs text-slate-400">ใช้บันทึกข้อมูลที่เกิดขึ้นแล้วเท่านั้น ไม่มีการส่งคำสั่งไปตลาดหรือโบรกเกอร์</p>
      <Field label="ประเภทรายการ" error={errors.type} helper={helpers[form.type]}><select ref={firstFieldRef} value={form.type} onChange={(event) => onChange('type', event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-white">
        {Object.entries(transactionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      {assetType ? <div className="grid gap-4 sm:grid-cols-2"><SymbolPreview value={form.symbol} onChange={(value) => onChange('symbol', value)} error={errors.symbol} />
        <Field label="จำนวน" error={errors.quantity}><DecimalInput value={form.quantity} onChange={(value) => onChange('quantity', value)} /></Field>
        <Field label="ราคาต่อหน่วย (USD)" error={errors.price}><DecimalInput value={form.price} onChange={(value) => onChange('price', value)} /></Field></div> :
        <div className="grid gap-4 sm:grid-cols-2"><Field label="สกุลเงินของรายการ" error={errors.originalCurrency}><select value={form.originalCurrency} onChange={(event) => onChange('originalCurrency', event.target.value)} className="form-input"><option value="USD">USD ($)</option><option value="THB">THB (฿)</option></select></Field>
          <Field label={`จำนวนเงิน (${form.originalCurrency})`} error={errors.amount}><DecimalInput value={form.amount} onChange={(value) => onChange('amount', value)} /></Field>
          {form.originalCurrency === 'THB' && <Field label="อัตราแลกเปลี่ยน ณ วันที่รายการ" error={errors.fxRateAtTransaction} helper="จำนวน THB ต่อ 1 USD"><DecimalInput value={form.fxRateAtTransaction} onChange={(value) => onChange('fxRateAtTransaction', value)} /></Field>}</div>}
      <Field label="วันที่เกิดรายการ" error={errors.occurredAt}><input type="date" value={form.occurredAt} max={new Date().toISOString().slice(0, 10)} onChange={(event) => onChange('occurredAt', event.target.value)} className="form-input" /></Field>
      <Field label="หมายเหตุ (ไม่บังคับ)" error={errors.note}><textarea value={form.note} onChange={(event) => onChange('note', event.target.value)} maxLength={500} rows={3} className="form-input h-auto py-3" /></Field>
      <div className="sticky bottom-0 -mx-1 flex gap-2 bg-[#151B28] px-1 pb-[max(.25rem,env(safe-area-inset-bottom))] pt-2"><Button type="button" variant="outline" className="flex-1" disabled={pending} onClick={onClose}>ยกเลิก</Button><Button type="submit" className="flex-1" disabled={pending}>{pending ? 'กำลังบันทึก…' : 'ยืนยันการบันทึก'}</Button></div>
    </form>
  </Modal>;
}
