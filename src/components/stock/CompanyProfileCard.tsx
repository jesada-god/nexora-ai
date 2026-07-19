'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  CompanyProfile,
  DataFreshness,
  MarketDataApiError,
} from '@/src/lib/market-data/types';
import { companyProfileErrorPresentation } from '@/src/lib/stock-detail/error-presentation';
import {
  companyProfileLabels,
  displayCountry,
  displayFiscalYearEnd,
  resolvedDescription,
  type CompanyProfileLanguage,
} from '@/src/lib/stock-detail/profile-presentation';
import { companyProfileTranslationClient } from './company-profile-translation-client';

interface TranslationResult {
  key: string;
  attempt: number;
  text: string | null;
  error: string | null;
}

function Field({
  label,
  value,
  missingLabel,
}: {
  label: string;
  value: string | null;
  missingLabel: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm text-white">{value ?? missingLabel}</p>
    </div>
  );
}

const PROFILE_STATUS_LABELS: Record<DataFreshness['status'], string> = {
  realtime: 'ข้อมูลสด',
  delayed: 'ข้อมูลล่าช้า',
  'end-of-day': 'ข้อมูลสิ้นวัน',
  cached: 'ข้อมูลแคช',
  stale: 'ข้อมูลเก่า',
  unknown: 'ไม่ทราบความสดของข้อมูล',
  unavailable: 'ข้อมูลไม่พร้อมใช้งาน',
};

export function CompanyProfileCard({
  symbol,
  profile,
  freshness,
  provider,
  error,
  loading,
  retryAt,
  onRetry,
}: {
  symbol: string;
  profile: CompanyProfile | null;
  freshness: DataFreshness;
  provider: string | null;
  error: MarketDataApiError | null;
  loading: boolean;
  retryAt: number;
  onRetry: () => void;
}) {
  const sourceText = profile?.description ?? null;
  const [language, setLanguage] = useState<CompanyProfileLanguage>(
    sourceText ? 'th' : 'en',
  );
  const [attempt, setAttempt] = useState(0);
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const translationKey = `${symbol}:${sourceText ?? ''}`;
  const activeLanguage = sourceText ? language : 'en';

  useEffect(() => {
    if (activeLanguage !== 'th' || !sourceText) return;
    const controller = new AbortController();
    let current = true;
    void companyProfileTranslationClient.request({
      symbol,
      sourceText,
      targetLanguage: 'th',
    }, controller.signal).then(
      (text) => {
        if (current) setTranslation({ key: translationKey, attempt, text, error: null });
      },
      (cause) => {
        if (current && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setTranslation({
            key: translationKey,
            attempt,
            text: null,
            error: cause instanceof Error ? cause.message : 'Translation is unavailable',
          });
        }
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [activeLanguage, attempt, sourceText, symbol, translationKey]);

  const activeTranslation = translation?.key === translationKey ? translation : null;
  const loadingTranslation = activeLanguage === 'th'
    && Boolean(sourceText)
    && (activeTranslation?.attempt !== attempt || (!activeTranslation.text && !activeTranslation.error));
  const description = resolvedDescription({
    language: activeLanguage,
    sourceText,
    translatedText: activeTranslation?.text ?? null,
    translationFailed: Boolean(activeTranslation?.error),
  });
  const labels = companyProfileLabels[activeLanguage];
  const errorPresentation = companyProfileErrorPresentation(error);
  const status = PROFILE_STATUS_LABELS[freshness.status];
  const website = profile?.website ?? null;
  const profileCoolingDown = retryAt > 0;
  const fields = useMemo(() => [
    {
      label: labels.country,
      value: displayCountry(profile?.country ?? null, activeLanguage),
    },
    {
      label: labels.employees,
      value: profile?.employees == null ? null : profile.employees.toLocaleString('en-US'),
    },
    {
      label: labels.currency,
      value: profile?.currency ?? null,
    },
    {
      label: labels.fiscalYearEnd,
      value: displayFiscalYearEnd(profile?.fiscalYearEnd ?? null, activeLanguage),
    },
  ], [activeLanguage, labels, profile]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#151B28] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-white">{labels.title}</h2>
          <p className="mt-1 break-words text-[10px] text-slate-500">
            {status} · {provider ?? 'ไม่ทราบผู้ให้บริการ'}
            {freshness.asOf ? ` · ${new Date(freshness.asOf).toLocaleString('th-TH')}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-slate-700 p-1" aria-label="Company Profile language">
          <button
            type="button"
            aria-pressed={activeLanguage === 'th'}
            disabled={!sourceText}
            title={!sourceText ? 'ยังไม่มีข้อความต้นฉบับสำหรับแปล' : undefined}
            onClick={() => setLanguage('th')}
            className={`min-h-9 rounded-md px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${activeLanguage === 'th' ? 'bg-[#D4FF00] text-black' : 'text-slate-300'}`}
          >
            ไทย
          </button>
          <button
            type="button"
            aria-pressed={activeLanguage === 'en'}
            onClick={() => setLanguage('en')}
            className={`min-h-9 rounded-md px-3 text-xs ${activeLanguage === 'en' ? 'bg-[#D4FF00] text-black' : 'text-slate-300'}`}
          >
            English
          </button>
        </div>
      </div>

      {errorPresentation && (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="font-semibold text-amber-200">{errorPresentation.title}</p>
          <p className="mt-1 text-sm text-slate-300">{errorPresentation.detail}</p>
          {error?.retryable && (
            <button
              type="button"
              disabled={loading || profileCoolingDown}
              onClick={onRetry}
              className="mt-3 min-h-10 rounded-lg border border-amber-400/30 px-3 text-xs text-amber-200 disabled:opacity-50"
            >
              {loading
                ? 'กำลังโหลด…'
                : profileCoolingDown
                  ? 'รอตามระยะเวลาที่กำหนดแล้วลองอีกครั้ง'
                  : 'ลองโหลดข้อมูลบริษัทอีกครั้ง'}
            </button>
          )}
        </div>
      )}

      <div className="mt-4 min-h-24">
        <p className="whitespace-pre-line text-sm leading-7 text-slate-300">
          {description.text ?? labels.missing}
        </p>
        {loadingTranslation && <p className="mt-2 text-xs text-slate-500">กำลังโหลดคำแปล…</p>}
        {description.fellBackToEnglish && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-300">
            <span>ไม่สามารถโหลดคำแปลได้ กำลังแสดงข้อความภาษาอังกฤษต้นฉบับ</span>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="min-h-9 rounded-lg border border-amber-400/30 px-3"
            >
              ลองแปลอีกครั้ง
            </button>
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-4 border-t border-slate-800 pt-4 sm:grid-cols-2">
        {fields.map((field) => (
          <Field
            key={field.label}
            label={field.label}
            value={field.value}
            missingLabel={labels.missing}
          />
        ))}
      </div>

      {website && (
        <a
          href={website}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex min-h-11 items-center rounded-lg px-1 text-sm text-[#D4FF00]"
        >
          {labels.website} ↗
        </a>
      )}
    </section>
  );
}
