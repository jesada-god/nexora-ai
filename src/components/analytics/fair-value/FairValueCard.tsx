'use client';

import { useEffect, useId, useState } from 'react';
import type { FairValueResult } from '@/src/lib/analytics/valuation/types';
import type { CompanyProfileLanguage } from '@/src/lib/stock-detail/profile-presentation';
import { FairValueDetailsDrawer } from './FairValueDetailsDrawer';
import { requestFairValue } from './fair-value-client';
import { convertUsdForDisplay, displayStatus, fairValueUnavailableLabel, fairValueUnavailableReason, formatFairValueMoney, formatUpsidePercent, modelLabel, upsideTone, type DisplayCurrency } from './presentation';

export function FairValueCard({
  symbol,
  enabled,
  language = 'th',
}: {
  symbol: string;
  enabled: boolean;
  language?: CompanyProfileLanguage;
}) {
  const requestKey = `${symbol}:${enabled}`;
  const [result, setResult] = useState<{ key: string; data: FairValueResult | null; error: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<DisplayCurrency>('USD');
  const drawerId = `fair-value-details-${useId().replaceAll(':', '')}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let current = true;
    void requestFairValue(symbol, controller.signal).then(
      (data) => { if (current) setResult({ key: requestKey, data, error: null }); },
      (cause) => {
        if (current && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setResult({
            key: requestKey,
            data: null,
            error: cause instanceof Error ? cause.message : 'ไม่สามารถโหลด Fair Value ได้',
          });
        }
      },
    );
    return () => { current = false; controller.abort(); };
  }, [enabled, requestKey, symbol]);

  const currentResult = result?.key === requestKey ? result : null;
  const data = currentResult?.data ?? null;
  const loading = enabled && currentResult === null;
  const unavailableLabel = data?.status === 'unavailable'
    ? fairValueUnavailableLabel(data.failureKind, language)
    : currentResult?.error
      ? language === 'th' ? 'เกิดข้อผิดพลาด' : 'Error'
      : language === 'th' ? 'ไม่พร้อมใช้งาน' : 'Unavailable';
  const error = enabled
    ? currentResult?.error ?? null
    : language === 'th' ? 'ระบบ Fair Value ถูกปิดอยู่' : 'Fair Value feature is disabled';
  const available = data?.status === 'available' ? data : null;
  const fxRate = available?.displayFx?.rate ?? null;
  const thbAvailable = fxRate != null && Number.isFinite(fxRate) && fxRate > 0;
  const displayCurrency = currency === 'THB' && !thbAvailable ? 'USD' : currency;
  const base = available ? convertUsdForDisplay(available.fundamentalFairValue.centralEstimate, displayCurrency, fxRate) : null;
  const tone = upsideTone(available?.upsidePercent ?? null);
  const toneClass = tone === 'success' ? 'text-emerald-400' : tone === 'danger' ? 'text-red-400' : 'text-slate-400';
  const unavailableReason = error ?? (data?.status === 'unavailable'
    ? fairValueUnavailableReason(data, language)
    : null);

  return (
    <>
      <div className="min-h-20 rounded-xl border border-slate-800 bg-[#151B28] p-3" aria-live="polite">
        <div className="flex min-h-11 items-center justify-between gap-1">
          <p className="text-[10px] uppercase text-slate-500">Fair Value</p>
          <button type="button" aria-label="ดูวิธีคำนวณ Fair Value" aria-expanded={open} aria-controls={drawerId} aria-haspopup="dialog" onClick={() => setOpen(true)} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-slate-400 outline-none hover:bg-slate-800 hover:text-[#D4FF00] focus-visible:ring-2 focus-visible:ring-[#D4FF00]">
            <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-bold">?</span>
          </button>
        </div>
        {loading ? <div data-testid="fair-value-skeleton" className="space-y-2"><p className="text-xs text-slate-400">{language === 'th' ? 'กำลังโหลด Fair Value…' : 'Loading Fair Value…'}</p><div className="h-3 w-28 animate-pulse rounded bg-slate-800" /></div> : available ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="font-mono text-sm font-semibold tabular-nums text-white">{formatFairValueMoney(base, displayCurrency)}</p>
              <p className={`font-mono text-xs tabular-nums ${toneClass}`}>{formatUpsidePercent(available.upsidePercent)}</p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
              <span>{modelLabel(available.selectedModel)}</span><span aria-hidden="true">·</span><span>{displayStatus(available)}</span>
              <span className="ml-auto inline-flex rounded-md border border-slate-700 p-0.5" aria-label="สกุลเงินที่แสดง">
                {(['USD', 'THB'] as const).map((item) => <button key={item} type="button" aria-pressed={displayCurrency === item} disabled={item === 'THB' && !thbAvailable} onClick={() => setCurrency(item)} className={`min-h-7 rounded px-1.5 ${displayCurrency === item ? 'bg-slate-700 text-white' : 'text-slate-500'} disabled:cursor-not-allowed disabled:opacity-40`}>{item}</button>)}
              </span>
            </div>
          </>
        ) : (
          <div>
            <p className="font-mono text-sm text-amber-300">{unavailableLabel}</p>
            <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">{unavailableReason ?? 'ข้อมูลจริงไม่เพียงพอ'}</p>
          </div>
        )}
      </div>
      <FairValueDetailsDrawer id={drawerId} open={open} onClose={() => setOpen(false)} data={data} unavailableReason={unavailableReason} />
    </>
  );
}
