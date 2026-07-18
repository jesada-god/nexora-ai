'use client';

import { useEffect, useMemo, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Briefcase, Edit3, Eye, EyeOff, History, LoaderCircle, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { createPortfolioTransactionAction, deletePortfolioTransactionAction, setPortfolioBaseCurrencyAction, updatePortfolioTransactionAction } from '@/app/portfolio/actions';
import { Button } from '@/src/components/ui/Button';
import { Modal } from '@/src/components/ui/Modal';
import { useToast } from '@/src/components/ui/Toast';
import { calculatePortfolio } from '@/src/lib/portfolio/calculations';
import { calculateOpenOptionsMarketValue } from '@/src/lib/portfolio/options/calculations';
import type { OptionPosition } from '@/src/lib/portfolio/options/types';
import type { MarketPriceInput, PortfolioRecord, PortfolioTransaction } from '@/src/lib/portfolio/types';
import type { FxResult } from '@/src/lib/market-data/fx/service';
import type { SupportedCurrency } from '@/src/lib/market-data/fx/types';
import { fetchFxRate, formatFxRate } from '@/src/lib/market-data/fx/client';
import { formatPortfolioMoney, gainColor, signedMoney, signedPercent } from '@/src/lib/portfolio/presentation';
import { OptionsSection } from './OptionsSection';
import { TransactionFormModal, transactionLabels, type TransactionFormState } from './TransactionFormModal';

const emptyForm = (): TransactionFormState => ({ type: 'acquisition', symbol: '', quantity: '', price: '', amount: '', originalCurrency: 'USD', fxRateAtTransaction: '', occurredAt: new Date().toISOString().slice(0, 10), note: '', idempotencyKey: crypto.randomUUID() });
function number(value: number, maximumFractionDigits = 8) { return new Intl.NumberFormat('th-TH', { maximumFractionDigits }).format(value); }
function transactionDate(value: string) { return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)); }

export function PortfolioClient({ portfolio, marketPrices, optionPositions, fx }: { portfolio: PortfolioRecord; marketPrices: Record<string, MarketPriceInput | null>; optionPositions: OptionPosition[]; fx: FxResult }) {
  const router = useRouter(); const { addToast } = useToast(); const [pending, startTransition] = useTransition();
  const [showBalances, setShowBalances] = useState(true); const [formOpen, setFormOpen] = useState(false);
  const [currency, setCurrency] = useState<SupportedCurrency>(portfolio.baseCurrency);
  const [currentFx, setCurrentFx] = useState(fx);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState(fx.quote === null);
  const [historyOpen, setHistoryOpen] = useState(false); const [historySymbol, setHistorySymbol] = useState<string | null>(null);
  const [editing, setEditing] = useState<PortfolioTransaction | null>(null); const [deleting, setDeleting] = useState<PortfolioTransaction | null>(null);
  const [form, setForm] = useState<TransactionFormState>(emptyForm); const [errors, setErrors] = useState<Record<string, string>>({});
  const prices = useMemo(() => Object.fromEntries(Object.entries(marketPrices).filter((entry): entry is [string, MarketPriceInput] => entry[1] != null)), [marketPrices]);
  const optionsMarketValue = useMemo(() => calculateOpenOptionsMarketValue(optionPositions), [optionPositions]);
  const summary = useMemo(() => calculatePortfolio(portfolio.transactions, prices, optionsMarketValue), [portfolio.transactions, prices, optionsMarketValue]);
  const history = useMemo(() => [...portfolio.transactions].filter((item) => !historySymbol || item.symbol === historySymbol).reverse(), [portfolio.transactions, historySymbol]);

  async function loadFx() {
    setFxLoading(true); setFxError(false);
    try {
      const parsed = await fetchFxRate(fetch, 1);
      setCurrentFx({ quote: parsed.quote, unavailable: parsed.unavailable });
    } catch { setFxError(true); } finally { setFxLoading(false); }
  }
  useEffect(() => {
    let active = true;
    void fetchFxRate(fetch, 1)
      .then((parsed) => { if (active) { setCurrentFx({ quote: parsed.quote, unavailable: parsed.unavailable }); setFxError(false); } })
      .catch(() => { if (active) setFxError(true); })
      .finally(() => { if (active) setFxLoading(false); });
    return () => { active = false; };
  }, []);

  function openCreate() { setEditing(null); setErrors({}); setForm(emptyForm()); setFormOpen(true); }
  function openHistory(symbol: string | null = null) { setHistorySymbol(symbol); setHistoryOpen(true); }
  function openEdit(transaction: PortfolioTransaction) {
    setEditing(transaction); setErrors({}); setForm({ type: transaction.type, symbol: transaction.symbol ?? '', quantity: transaction.quantity ?? '', price: transaction.price ?? '', amount: transaction.originalAmount ?? transaction.amount ?? '', originalCurrency: transaction.originalCurrency ?? 'USD', fxRateAtTransaction: transaction.fxRateAtTransaction ?? '', occurredAt: transaction.occurredAt, note: transaction.note ?? '', idempotencyKey: transaction.idempotencyKey ?? crypto.randomUUID() });
    setHistoryOpen(false); setFormOpen(true);
  }
  function change(name: keyof TransactionFormState, value: string) { setForm((current) => ({ ...current, [name]: value })); setErrors((current) => ({ ...current, [name]: '' })); }
  function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return; startTransition(async () => {
      const result = editing ? await updatePortfolioTransactionAction(editing.id, form) : await createPortfolioTransactionAction(form);
      if (!result.ok) { setErrors(result.fields ?? {}); addToast({ title: 'บันทึกไม่สำเร็จ', message: result.message, type: 'error' }); return; }
      setFormOpen(false); addToast({ title: editing ? 'แก้ไขรายการย้อนหลังแล้ว' : 'บันทึกรายการย้อนหลังแล้ว', type: 'success' }); router.refresh();
    });
  }
  function confirmDelete() {
    if (!deleting || pending) return; startTransition(async () => {
      const result = await deletePortfolioTransactionAction(deleting.id);
      if (!result.ok) { addToast({ title: 'ลบไม่สำเร็จ', message: result.message, type: 'error' }); return; }
      setDeleting(null); addToast({ title: 'ลบรายการย้อนหลังแล้ว', type: 'success' }); router.refresh();
    });
  }
  const hidden = (value: string) => showBalances ? value : '••••••';
  const rate = currentFx.quote?.rate ?? null;
  const hasValidRate = rate !== null;
  const money = (value: number | string) => formatPortfolioMoney(value, currency, rate, showBalances);
  const signed = (value: number) => signedMoney(value, currency, rate, showBalances);
  function selectCurrency(next: SupportedCurrency) {
    if (next === currency || pending || (next === 'THB' && !hasValidRate)) return;
    setCurrency(next);
    startTransition(async () => {
      const result = await setPortfolioBaseCurrencyAction(next);
      if (!result.ok) { setCurrency(currency); addToast({ title: 'บันทึกสกุลเงินไม่สำเร็จ', message: result.message, type: 'error' }); }
    });
  }

  return <main className="mx-auto w-full max-w-6xl space-y-5 p-4 pb-24 md:p-8">
    <aside className="flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100" role="note"><AlertTriangle className="mt-0.5 shrink-0 text-amber-300" size={19} /><p><strong>พอร์ตจำลองเพื่อบันทึกย้อนหลังเท่านั้น</strong><br />ไม่มีการส่งคำสั่งไปยังตลาดหลักทรัพย์ โบรกเกอร์ หรือผู้ให้บริการซื้อขายใด ๆ</p></aside>
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-[#151B28] to-[#0A0E17] p-5 sm:p-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><p className="text-xs font-medium uppercase tracking-widest text-slate-400">มูลค่าพอร์ตรวม</p><div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-1" aria-label="สกุลเงินที่แสดง">{(['USD', 'THB'] as const).map((item) => <button key={item} type="button" disabled={pending || (item === 'THB' && !hasValidRate)} onClick={() => selectCurrency(item)} className={`min-h-9 rounded-md px-3 text-xs font-bold ${currency === item ? 'bg-[#D4FF00] text-slate-950' : 'text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'}`}>{item}</button>)}</div></div>
        <div className="mt-2 flex items-center gap-2"><h2 className="break-all font-mono text-3xl font-bold tracking-tight text-white sm:text-5xl">{money(summary.totalValue)}</h2><button className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-white" onClick={() => setShowBalances((value) => !value)} aria-label={showBalances ? 'ซ่อนยอดเงินทั้งหมด' : 'แสดงยอดเงินทั้งหมด'}>{showBalances ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
        <p className={`mt-2 font-mono font-semibold ${gainColor(summary.totalGain)}`}>{signed(summary.totalGain)} ({signedPercent(summary.totalGainPercent, showBalances)})</p>
        <p className={`mt-1 text-sm font-mono ${gainColor(summary.todayChange)}`}>วันนี้ {signed(summary.todayChange)} ({signedPercent(summary.todayChangePercent, showBalances)})</p></div>
        <div className="flex w-full flex-col gap-2 sm:w-auto"><Button onClick={openCreate}><Plus size={17} /> บันทึกรายการย้อนหลัง</Button><Button variant="outline" onClick={() => openHistory()}><History size={17} /> ดูประวัติที่บันทึก</Button></div></div>
      <div className="mt-7 grid grid-cols-2 gap-4 border-t border-slate-800 pt-5 lg:grid-cols-4"><Metric label="เงินลงทุนสุทธิ" value={money(summary.netDepositedCapital)} /><Metric label="เงินสด" value={money(summary.cashBalance)} /><Metric label="มูลค่าหุ้น" value={money(summary.equityMarketValue)} /><Metric label="มูลค่าออปชัน" value={money(summary.optionsMarketValue)} /><Metric label="ต้นทุนหุ้นคงเหลือ" value={money(summary.costBasis)} /><Metric label="กำไร/ขาดทุนที่รับรู้แล้ว" value={signed(summary.realizedGain)} tone={gainColor(summary.realizedGain)} /><Metric label="กำไร/ขาดทุนที่ยังไม่รับรู้" value={signed(summary.unrealizedGain)} tone={gainColor(summary.unrealizedGain)} /></div>
      <div className="mt-5 flex flex-col gap-2 border-t border-slate-800 pt-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between"><div>{fxLoading && <p className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={14} /> กำลังโหลดอัตราแลกเปลี่ยน…</p>}{hasValidRate && <p>1 USD = {formatFxRate(rate)} THB · อัปเดตล่าสุด {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(currentFx.quote!.asOf))} · แหล่งข้อมูล {currentFx.quote!.source}</p>}{!fxLoading && !hasValidRate && <p className="text-amber-300">ไม่สามารถแสดงค่า THB ได้ เนื่องจากไม่มีอัตราแลกเปลี่ยนจริงหรืออัตราที่บันทึกไว้</p>}{currentFx.quote?.stale && <p className="mt-1 text-amber-300">กำลังใช้อัตราแลกเปลี่ยนล่าสุดที่บันทึกไว้</p>}{fxError && hasValidRate && <p className="mt-1 text-amber-300">โหลดอัตราใหม่ไม่สำเร็จ แต่ยังใช้อัตราที่มีอยู่ได้</p>}</div><button type="button" onClick={() => void loadFx()} disabled={fxLoading} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-slate-700 px-3 text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"><RefreshCw className={fxLoading ? 'animate-spin' : ''} size={14} /> ลองโหลดอัตราใหม่</button></div>
    </section>
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#151B28] shadow-xl"><div className="flex min-w-0 items-center gap-2 border-b border-slate-800 p-4 sm:px-5"><Briefcase aria-hidden="true" className="shrink-0 text-[#D4FF00]" size={20} /><h3 className="min-w-0 font-bold text-white">สินทรัพย์ที่ถืออยู่</h3></div>
      {summary.holdings.length === 0 ? <div className="p-10 text-center"><p className="font-semibold text-white">ยังไม่มีสินทรัพย์ในพอร์ตจำลอง</p><p className="mt-1 text-sm text-slate-400">เริ่มได้ด้วยการบันทึกรายการย้อนหลัง</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left text-sm"><thead><tr className="border-b border-slate-800 text-xs text-slate-500">
        {['สินทรัพย์','จำนวน','ต้นทุนเฉลี่ย','ต้นทุนคงเหลือ','ราคาตลาด','มูลค่าตลาด','กำไร/ขาดทุน','สัดส่วน','จัดการ'].map((label, index) => <th key={label} className={`px-4 py-3 ${index ? 'text-right' : ''}`}>{label}</th>)}</tr></thead><tbody>{summary.holdings.map((holding) => <tr key={holding.symbol} className="border-b border-slate-800/60 last:border-0">
          <td className="px-4 py-4 font-bold text-white">{holding.symbol}</td><td className="px-4 py-4 text-right font-mono">{hidden(number(holding.quantity))}</td><td className="px-4 py-4 text-right font-mono">{money(holding.averageCost)}</td><td className="px-4 py-4 text-right font-mono">{money(holding.costBasis)}</td>
          <td className="px-4 py-4 text-right font-mono">{money(holding.marketPrice)}{holding.priceEstimated && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">ราคาประมาณการ</span>}{holding.priceCached && <span className="ml-2 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-300">ราคาล่าสุดที่บันทึกไว้</span>}</td><td className="px-4 py-4 text-right font-mono text-white">{money(holding.marketValue)}</td><td className={`px-4 py-4 text-right font-mono ${gainColor(holding.unrealizedGain)}`}>{signed(holding.unrealizedGain)}</td><td className="px-4 py-4 text-right font-mono">{showBalances ? `${holding.allocation.toFixed(2)}%` : '••••'}</td>
          <td className="px-4 py-2 text-right"><button onClick={() => openHistory(holding.symbol)} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"><Settings2 size={15} /> แก้ไข / ลบ</button></td>
        </tr>)}</tbody></table></div>}
      <p className="border-t border-slate-800 px-4 py-3 text-xs text-slate-500">สินทรัพย์คำนวณจาก transaction ต้นทาง จึงต้องแก้หรือลบรายการต้นทาง ไม่สามารถลบสินทรัพย์โดยตรงได้</p>
    </section>
    <OptionsSection positions={optionPositions} currency={currency} usdThbRate={rate} showBalances={showBalances} />

    <TransactionFormModal open={formOpen} editing={Boolean(editing)} form={form} errors={errors} pending={pending} onChange={change} onClose={() => !pending && setFormOpen(false)} onSubmit={submit} />
    <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title={historySymbol ? `รายการต้นทางของ ${historySymbol}` : 'ประวัติรายการย้อนหลัง'} className="max-w-2xl">
      {history.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">ยังไม่มีรายการที่บันทึก</p> : <div className="divide-y divide-slate-800">{history.map((transaction) => <article key={transaction.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="font-semibold text-white">{transactionLabels[transaction.type]} {transaction.symbol && `· ${transaction.symbol}`}</p><p className="text-xs text-slate-400">{transactionDate(transaction.occurredAt)} · {transaction.quantity ? `${showBalances ? number(Number(transaction.quantity)) : '••••'} × ${money(Number(transaction.price))}` : money(Number(transaction.normalizedAmountUsd ?? transaction.amount))}</p>{transaction.originalCurrency === 'THB' && <p className="text-xs text-slate-500">ต้นฉบับ {showBalances ? new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', currencyDisplay: 'narrowSymbol' }).format(Number(transaction.originalAmount)) : '••••••'} · FX {showBalances ? transaction.fxRateAtTransaction : '••••'}</p>}{transaction.note && <p className="mt-1 truncate text-xs text-slate-500">{transaction.note}</p>}</div>
        <button aria-label="แก้ไขรายการ" className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-white" onClick={() => openEdit(transaction)}><Edit3 size={17} /></button><button aria-label="ลบรายการ" className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-red-400" onClick={() => { setHistoryOpen(false); setDeleting(transaction); }}><Trash2 size={17} /></button></article>)}</div>}
    </Modal>
    <Modal isOpen={Boolean(deleting)} onClose={() => !pending && setDeleting(null)} title={`ลบรายการ ${deleting?.symbol ?? transactionLabels[deleting?.type ?? 'adjustment']} หรือไม่`}><p className="text-sm text-slate-300">ระบบจะคำนวณจำนวน ต้นทุน เงินสด และกำไร/ขาดทุนใหม่ทั้งหมด การลบอาจไม่สำเร็จหากทำให้รายการขายภายหลังเกินจำนวนที่มี</p><div className="mt-5 flex gap-2"><Button variant="outline" className="flex-1" disabled={pending} onClick={() => setDeleting(null)}>ยกเลิก</Button><Button className="flex-1 bg-red-500 text-white hover:bg-red-400" disabled={pending} onClick={confirmDelete}>{pending ? 'กำลังลบ…' : 'ยืนยันการลบ'}</Button></div></Modal>
  </main>;
}

function Metric({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) { return <div><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 break-all font-mono text-sm font-semibold sm:text-base ${tone}`}>{value}</p></div>; }
