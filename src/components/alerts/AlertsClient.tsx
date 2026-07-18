'use client';

import { useState, useTransition } from 'react';
import { BellRing, Edit3, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { createAlertAction, deleteAlertAction, setAlertEnabledAction, updateAlertAction, type AlertInput } from '@/app/alerts/actions';
import { Button } from '@/src/components/ui/Button';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Input } from '@/src/components/ui/Input';
import { Modal } from '@/src/components/ui/Modal';
import { useToast } from '@/src/components/ui/Toast';
import { describeCondition } from '@/src/lib/alerts/logic';
import type { AlertCondition, PriceAlert } from '@/src/lib/alerts/types';

const blank: AlertInput = { symbol: '', condition: 'above', targetValue: 1, cooldownMinutes: 60, enabled: true };
const conditionOptions: Array<{ value: AlertCondition; label: string }> = [
  { value: 'above', label: 'ราคาสูงกว่า/เท่ากับ' }, { value: 'below', label: 'ราคาต่ำกว่า/เท่ากับ' },
  { value: 'percent_change_up', label: 'เปอร์เซ็นต์เพิ่มขึ้น' }, { value: 'percent_change_down', label: 'เปอร์เซ็นต์ลดลง' },
];
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : 'ยังไม่เคย';

export function AlertsClient({ initialAlerts }: { initialAlerts: PriceAlert[] }) {
  const [alerts, setAlerts] = useState(initialAlerts); const [editing, setEditing] = useState<PriceAlert | null>(null);
  const [form, setForm] = useState<AlertInput>(blank); const [open, setOpen] = useState(false); const [pending, startTransition] = useTransition();
  const [evaluating, setEvaluating] = useState(false); const { addToast } = useToast();

  function showForm(alert?: PriceAlert) {
    setEditing(alert ?? null); setForm(alert ? { symbol: alert.symbol, condition: alert.condition, targetValue: alert.targetValue, cooldownMinutes: alert.cooldownMinutes, enabled: alert.enabled } : blank); setOpen(true);
  }
  function submit(event: React.FormEvent) {
    event.preventDefault(); startTransition(async () => {
      const result = editing ? await updateAlertAction(editing.id, form) : await createAlertAction(form);
      if (!result.ok || !result.alert) { addToast({ title: 'บันทึกไม่สำเร็จ', message: result.ok ? undefined : result.message, type: 'error' }); return; }
      setAlerts((current) => editing ? current.map((item) => item.id === result.alert!.id ? result.alert! : item) : [result.alert!, ...current]);
      setOpen(false); addToast({ title: editing ? 'แก้ไข Alert แล้ว' : 'สร้าง Alert แล้ว', type: 'success' });
    });
  }
  function toggle(alert: PriceAlert) { startTransition(async () => {
    const result = await setAlertEnabledAction(alert.id, !alert.enabled);
    if (!result.ok) { addToast({ title: 'เปลี่ยนสถานะไม่สำเร็จ', message: result.message, type: 'error' }); return; }
    setAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, enabled: !item.enabled } : item));
  }); }
  function remove(alert: PriceAlert) { if (!window.confirm(`ลบ Price Alert ของ ${alert.symbol}?`)) return; startTransition(async () => {
    const result = await deleteAlertAction(alert.id); if (!result.ok) { addToast({ title: 'ลบไม่สำเร็จ', message: result.message, type: 'error' }); return; }
    setAlerts((current) => current.filter((item) => item.id !== alert.id)); addToast({ title: 'ลบ Alert แล้ว', type: 'success' });
  }); }
  async function evaluate() {
    setEvaluating(true); try { const response = await fetch('/api/alerts/evaluate', { method: 'POST' }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Evaluation failed');
      window.dispatchEvent(new Event('notifications-updated'));
      addToast({ title: 'ตรวจสอบ Alerts แล้ว', message: `ตรวจ ${payload.data.evaluated} รายการ · แจ้งเตือนใหม่ ${payload.data.triggered} รายการ`, type: 'success' });
    } catch (error) { addToast({ title: 'ตรวจสอบไม่สำเร็จ', message: error instanceof Error ? error.message : undefined, type: 'error' }); }
    finally { setEvaluating(false); }
  }

  return <div className="space-y-5">
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      <strong className="block text-amber-300">ไม่ใช่ Background Real-time Alert</strong>
      ระบบตรวจเงื่อนไขเมื่อคุณเปิด/รีเฟรชแอป หรือกด “ตรวจสอบตอนนี้” เท่านั้น ไม่มีการตรวจสอบต่อเนื่องเมื่อปิดแอป
    </section>
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">Price Alerts</h2><p className="text-xs text-slate-500">{alerts.length} รายการ</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={evaluate} isLoading={evaluating}><RefreshCw size={16} className="mr-2" />ตรวจสอบตอนนี้</Button><Button onClick={() => showForm()}><Plus size={16} className="mr-2" />สร้าง Alert</Button></div></div>
    {alerts.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-[#151B28]"><EmptyState icon={BellRing} title="ยังไม่มี Price Alert" description="สร้างเงื่อนไขจากราคาหรือเปอร์เซ็นต์การเปลี่ยนแปลงได้จากปุ่มด้านบน" /></div> :
      <div className="space-y-3">{alerts.map((alert) => <article key={alert.id} className={`rounded-2xl border p-4 sm:p-5 ${alert.enabled ? 'border-slate-700 bg-[#151B28]' : 'border-slate-800 bg-slate-900/50 opacity-70'}`}>
        <div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-lg font-bold text-white">{alert.symbol}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${alert.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>{alert.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span></div>
          <p className="text-sm text-slate-300">{describeCondition(alert.condition, alert.targetValue)}</p><p className="mt-2 text-xs text-slate-500">Cooldown {alert.cooldownMinutes} นาที · ตรวจล่าสุด {dateTime(alert.lastEvaluatedAt)} · Trigger ล่าสุด {dateTime(alert.lastTriggeredAt)}</p></div>
          <div className="flex items-center gap-1"><label className="flex min-h-11 cursor-pointer items-center gap-2 px-2 text-xs text-slate-400"><input type="checkbox" checked={alert.enabled} disabled={pending} onChange={() => toggle(alert)} className="h-4 w-4 accent-[#D4FF00]" />เปิด</label>
            <button aria-label={`แก้ไข ${alert.symbol}`} onClick={() => showForm(alert)} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"><Edit3 size={17} /></button>
            <button aria-label={`ลบ ${alert.symbol}`} onClick={() => remove(alert)} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400"><Trash2 size={17} /></button></div></div>
      </article>)}</div>}
    <Modal isOpen={open} onClose={() => !pending && setOpen(false)} title={editing ? `แก้ไข Alert: ${editing.symbol}` : 'สร้าง Price Alert'}><form onSubmit={submit} className="space-y-4">
      <label className="block text-sm text-slate-300">Symbol<Input value={form.symbol} disabled={Boolean(editing)} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase().trim() })} placeholder="เช่น AAPL" required className="mt-1" /></label>
      <label className="block text-sm text-slate-300">เงื่อนไข<select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as AlertCondition })} className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-[#151B28] px-3 text-sm text-white">{conditionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="block text-sm text-slate-300">{form.condition.startsWith('percent') ? 'เปอร์เซ็นต์ (ใส่ค่าบวก)' : 'ราคาเป้าหมาย'}<Input type="number" min="0.000001" step="any" value={form.targetValue} onChange={(e) => setForm({ ...form, targetValue: Number(e.target.value) })} required className="mt-1" /></label>
      <label className="block text-sm text-slate-300">Cooldown (นาที)<Input type="number" min="1" max="10080" value={form.cooldownMinutes} onChange={(e) => setForm({ ...form, cooldownMinutes: Number(e.target.value) })} required className="mt-1" /></label>
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 accent-[#D4FF00]" />เปิดใช้งาน</label>
      <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>ยกเลิก</Button><Button type="submit" isLoading={pending}>บันทึก</Button></div>
    </form></Modal>
  </div>;
}

