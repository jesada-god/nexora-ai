'use client';

import { useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Edit3, Plus, ScrollText, Trash2 } from 'lucide-react';
import { closeOptionPositionAction, createOptionPositionAction, deleteOptionPositionAction, updateOptionPositionAction } from '@/app/portfolio/option-actions';
import { Button } from '@/src/components/ui/Button';
import { Modal } from '@/src/components/ui/Modal';
import { useToast } from '@/src/components/ui/Toast';
import { calculateDte, calculateOptionStatus, calculateOptionTotalCost } from '@/src/lib/portfolio/options/calculations';
import type { OptionInput, OptionPosition, OptionStatus } from '@/src/lib/portfolio/options/types';
import { DecimalInput, Field } from './FormControls';
import { SymbolPreview } from './SymbolPreview';
import type { SupportedCurrency } from '@/src/lib/market-data/fx/types';
import { formatPortfolioMoney } from '@/src/lib/portfolio/presentation';

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (): OptionInput => ({ underlyingSymbol: '', optionKind: 'call', contracts: '', premiumPerShare: '', strikePrice: '', openedAt: today(), expirationDate: today(), impliedVolatility: '', delta: '', theta: '', note: '', status: 'open', idempotencyKey: crypto.randomUUID() });
const statusLabels: Record<OptionStatus, string> = { open: 'Open', closed: 'Closed', expired: 'Expired', cancelled: 'Cancelled' };

function date(value: string) { return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)); }

export function OptionsSection({ positions, currency, usdThbRate, showBalances }: { positions: OptionPosition[]; currency: SupportedCurrency; usdThbRate: string | null; showBalances: boolean }) {
  const router = useRouter(); const { addToast } = useToast(); const [pending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<OptionPosition | null>(null);
  const [form, setForm] = useState<OptionInput>(emptyForm); const [errors, setErrors] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState<OptionPosition | null>(null); const [closedAt, setClosedAt] = useState(today());
  const [deleting, setDeleting] = useState<OptionPosition | null>(null); const firstFieldRef = useRef<HTMLInputElement>(null);
  const totalCost = useMemo(() => {
    try { return form.premiumPerShare && form.contracts ? calculateOptionTotalCost(form.premiumPerShare, form.contracts) : 0; } catch { return 0; }
  }, [form.premiumPerShare, form.contracts]);
  const liveDte = form.expirationDate ? calculateDte(form.expirationDate) : 0;
  const money = (value: number | string, visible = showBalances) => formatPortfolioMoney(value, currency, usdThbRate, visible);

  function change(name: keyof OptionInput, value: string) { setForm((current) => ({ ...current, [name]: value })); setErrors((current) => ({ ...current, [name]: '' })); }
  function create() { setEditing(null); setErrors({}); setForm(emptyForm()); setFormOpen(true); }
  function edit(position: OptionPosition) {
    setEditing(position); setErrors({}); setForm({ underlyingSymbol: position.underlyingSymbol, optionKind: position.optionKind, contracts: position.contracts,
      premiumPerShare: position.premiumPerShare, strikePrice: position.strikePrice, openedAt: position.openedAt, expirationDate: position.expirationDate,
      impliedVolatility: position.impliedVolatility ?? '', delta: position.delta ?? '', theta: position.theta ?? '', note: position.note ?? '', status: position.status, idempotencyKey: position.idempotencyKey }); setFormOpen(true);
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    startTransition(async () => {
      const result = editing ? await updateOptionPositionAction(editing.id, form) : await createOptionPositionAction(form);
      if (!result.ok) { setErrors(result.fields ?? {}); addToast({ title: 'บันทึกสัญญาไม่สำเร็จ', message: result.message, type: 'error' }); return; }
      setFormOpen(false); addToast({ title: editing ? 'แก้ไขสัญญาแล้ว' : 'บันทึกสัญญาย้อนหลังแล้ว', type: 'success' }); router.refresh();
    });
  }
  function confirmClose() {
    if (!closing || pending) return; startTransition(async () => {
      const result = await closeOptionPositionAction(closing.id, closedAt);
      if (!result.ok) { addToast({ title: 'ปิดสัญญาไม่สำเร็จ', message: result.message, type: 'error' }); return; }
      setClosing(null); addToast({ title: 'บันทึกการปิดสัญญาแล้ว', type: 'success' }); router.refresh();
    });
  }
  function confirmDelete() {
    if (!deleting || pending) return; startTransition(async () => {
      const result = await deleteOptionPositionAction(deleting.id);
      if (!result.ok) { addToast({ title: 'ลบสัญญาไม่สำเร็จ', message: result.message, type: 'error' }); return; }
      setDeleting(null); addToast({ title: 'ลบข้อมูลสัญญาแล้ว', type: 'success' }); router.refresh();
    });
  }

  return <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#151B28] shadow-xl">
    <div className="flex flex-col gap-4 border-b border-slate-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><ScrollText aria-hidden="true" className="shrink-0 text-[#D4FF00]" size={20} /><h3 className="min-w-0 font-bold text-white">สัญญาออปชันที่ถืออยู่</h3></div><p className="mt-1 text-xs text-slate-500">รายการจำลองที่คุณบันทึกย้อนหลัง</p></div>
      <Button onClick={create}><Plus size={17} /> บันทึกสัญญาย้อนหลัง</Button>
    </div>
    <div className="flex gap-3 border-b border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-100"><AlertTriangle size={18} className="shrink-0 text-amber-300" /><p>การเพิ่ม แก้ไข หรือ “ปิดสัญญา” เป็นการบันทึกข้อมูลย้อนหลังเท่านั้น ไม่มีการส่งคำสั่งไปตลาดหรือโบรกเกอร์</p></div>
    {positions.length === 0 ? <div className="p-10 text-center"><p className="font-semibold text-white">ยังไม่มีสัญญาออปชันที่บันทึก</p><p className="mt-1 text-sm text-slate-400">เพิ่มข้อมูลสัญญาที่เกิดขึ้นแล้วเพื่อดู DTE และต้นทุนรวม</p></div> :
      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-xs"><thead><tr className="border-b border-slate-800 text-slate-500">
        {['หุ้นแม่','ประเภท','Strike','สัญญา','Premium','วันเปิด','วันหมดอายุ','DTE','IV','Delta','Theta','ต้นทุนรวม','สถานะ','จัดการ'].map((label, index) => <th key={label} className={`px-3 py-3 ${index > 1 && index < 13 ? 'text-right' : ''}`}>{label}</th>)}
      </tr></thead><tbody>{positions.map((position) => {
        const status = calculateOptionStatus(position); const dte = Math.max(0, calculateDte(position.expirationDate)); const call = position.optionKind === 'call';
        return <tr key={position.id} className="border-b border-slate-800/60 last:border-0"><td className="px-3 py-4 font-bold text-white">{position.underlyingSymbol}</td>
          <td className="px-3 py-4"><span className={`rounded-md px-2 py-1 font-bold ${call ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>BUY {call ? 'CALL' : 'PUT'}</span></td>
          <td className="px-3 py-4 text-right font-mono">{money(position.strikePrice)}</td><td className="px-3 py-4 text-right font-mono">{showBalances ? position.contracts : '••••'}</td><td className="px-3 py-4 text-right font-mono">{money(position.premiumPerShare)}</td>
          <td className="px-3 py-4 text-right">{date(position.openedAt)}</td><td className="px-3 py-4 text-right">{date(position.expirationDate)}</td><td className="px-3 py-4 text-right font-mono">{dte}</td>
          <td className="px-3 py-4 text-right font-mono">{position.impliedVolatility ? `${position.impliedVolatility}%` : '—'}</td><td className="px-3 py-4 text-right font-mono">{position.delta ?? '—'}</td><td className="px-3 py-4 text-right font-mono">{position.theta ?? '—'}</td>
          <td className="px-3 py-4 text-right font-mono font-semibold text-white">{money(calculateOptionTotalCost(position.premiumPerShare, position.contracts))}<span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">estimated value</span></td><td className="px-3 py-4 text-right"><StatusBadge status={status} /></td>
          <td className="px-3 py-2"><div className="flex justify-end gap-1"><button aria-label={`แก้ไข ${position.underlyingSymbol}`} className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-white" onClick={() => edit(position)}><Edit3 size={16} /></button>
            {position.status === 'open' && <button className="min-h-11 rounded-lg px-2 text-xs text-[#D4FF00] hover:bg-[#D4FF00]/10" onClick={() => { setClosing(position); setClosedAt(today()); }}>ปิดสัญญา</button>}
            <button aria-label={`ลบ ${position.underlyingSymbol}`} className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-red-400" onClick={() => setDeleting(position)}><Trash2 size={16} /></button></div></td>
        </tr>;
      })}</tbody></table></div>}

    <Modal isOpen={formOpen} onClose={() => !pending && setFormOpen(false)} initialFocusRef={firstFieldRef} title={editing ? 'แก้ไขสัญญาออปชันย้อนหลัง' : 'บันทึกสัญญาออปชันย้อนหลัง'} className="max-w-2xl scroll-pb-40">
      <form onSubmit={submit} className="space-y-4"><p className="rounded-lg bg-slate-950/50 p-3 text-xs text-slate-400">ไม่มีการส่งคำสั่งไปตลาดหรือโบรกเกอร์ ข้อมูลนี้ใช้ในพอร์ตจำลองเท่านั้น</p>
        <SymbolPreview ref={firstFieldRef} label="ชื่อหุ้นแม่ / Symbol" value={form.underlyingSymbol} onChange={(value) => change('underlyingSymbol', value)} error={errors.underlyingSymbol} />
        <div className="grid gap-4 sm:grid-cols-2"><Field label="ประเภท" error={errors.optionKind}><select value={form.optionKind} onChange={(event) => change('optionKind', event.target.value)} className={`form-input ${form.optionKind === 'call' ? 'border-emerald-500/60' : 'border-red-500/60'}`}><option value="call">BUY CALL</option><option value="put">BUY PUT</option></select></Field>
          <Field label="จำนวนสัญญา" error={errors.contracts}><input inputMode="numeric" value={form.contracts} onChange={(event) => /^\d*$/.test(event.target.value) && change('contracts', event.target.value)} className="form-input" /></Field>
          <Field label="Premium ต่อหุ้น (USD)" error={errors.premiumPerShare} helper="ระบบคูณ 100 ต่อสัญญาให้อัตโนมัติ"><DecimalInput value={form.premiumPerShare} onChange={(value) => change('premiumPerShare', value)} /></Field>
          <Field label="Strike Price (USD)" error={errors.strikePrice}><DecimalInput value={form.strikePrice} onChange={(value) => change('strikePrice', value)} /></Field>
          <Field label="วันเปิดสัญญา" error={errors.openedAt}><input type="date" max={today()} value={form.openedAt} onChange={(event) => change('openedAt', event.target.value)} className="form-input" /></Field>
          <Field label="Expiration Date" error={errors.expirationDate} helper={`DTE อัตโนมัติ: ${liveDte}`}><input type="date" min={form.openedAt} value={form.expirationDate} onChange={(event) => change('expirationDate', event.target.value)} className="form-input" /></Field>
          <Field label="IV%" error={errors.impliedVolatility}><DecimalInput value={form.impliedVolatility ?? ''} onChange={(value) => change('impliedVolatility', value)} /></Field>
          <Field label="Delta" error={errors.delta}><DecimalInput signed value={form.delta ?? ''} onChange={(value) => change('delta', value)} /></Field>
          <Field label="Theta" error={errors.theta}><DecimalInput signed value={form.theta ?? ''} onChange={(value) => change('theta', value)} /></Field>
          <Field label="สถานะที่บันทึก" error={errors.status}><select value={form.status} onChange={(event) => change('status', event.target.value)} className="form-input"><option value="open">Open</option>{editing?.status === 'closed' && <option value="closed">Closed</option>}<option value="cancelled">Cancelled</option></select></Field></div>
        <Field label="หมายเหตุ" error={errors.note}><textarea rows={3} maxLength={500} value={form.note ?? ''} onChange={(event) => change('note', event.target.value)} className="form-input h-auto py-3" /></Field>
        <div className={`rounded-xl border p-4 ${form.optionKind === 'call' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}><p className="text-xs text-slate-400">Live Total Cost (USD)</p><p className="mt-1 font-mono text-2xl font-bold text-white">{formatPortfolioMoney(totalCost, 'USD', null, true)}</p><p className="text-xs text-slate-500">Premium × {form.contracts || 0} สัญญา × 100</p></div>
        <div className="sticky bottom-0 flex gap-2 bg-[#151B28] pb-[max(.25rem,env(safe-area-inset-bottom))] pt-2"><Button type="button" variant="outline" className="flex-1" disabled={pending} onClick={() => setFormOpen(false)}>ยกเลิก</Button><Button type="submit" className="flex-1" disabled={pending}>{pending ? 'กำลังบันทึก…' : 'ยืนยันการบันทึก'}</Button></div>
      </form>
    </Modal>
    <Modal isOpen={Boolean(closing)} onClose={() => !pending && setClosing(null)} title={`บันทึกปิดสัญญา ${closing?.underlyingSymbol ?? ''}`}><p className="text-sm text-slate-300">เป็นการบันทึกย้อนหลังเท่านั้น ไม่มีการส่งคำสั่งไปตลาดหรือโบรกเกอร์</p><Field label="วันที่ปิดสัญญา"><input type="date" min={closing?.openedAt} max={today()} value={closedAt} onChange={(event) => setClosedAt(event.target.value)} className="form-input mt-4" /></Field><div className="mt-5 flex gap-2"><Button variant="outline" className="flex-1" onClick={() => setClosing(null)}>ยกเลิก</Button><Button className="flex-1" disabled={pending} onClick={confirmClose}>บันทึกการปิด</Button></div></Modal>
    <Modal isOpen={Boolean(deleting)} onClose={() => !pending && setDeleting(null)} title={`ลบสัญญา ${deleting?.underlyingSymbol ?? ''} หรือไม่`}><p className="text-sm text-slate-300">ข้อมูลสัญญา {deleting?.optionKind.toUpperCase()} และต้นทุนรวมจะถูกนำออกจากกระเป๋าพอร์ตจำลอง การดำเนินการนี้ไม่ส่งผลต่อตลาดหรือโบรกเกอร์</p><div className="mt-5 flex gap-2"><Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>ยกเลิก</Button><Button className="flex-1 bg-red-500 text-white hover:bg-red-400" disabled={pending} onClick={confirmDelete}>ยืนยันการลบ</Button></div></Modal>
  </section>;
}

function StatusBadge({ status }: { status: OptionStatus }) {
  const style = status === 'open' ? 'bg-emerald-500/15 text-emerald-400' : status === 'expired' ? 'bg-amber-500/15 text-amber-300' : status === 'closed' ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-700 text-slate-300';
  return <span className={`rounded-full px-2 py-1 font-semibold ${style}`}>{statusLabels[status]}</span>;
}
