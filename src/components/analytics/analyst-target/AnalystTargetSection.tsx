'use client';
import { useState } from 'react';
import type { AnalystPriceTarget, AnalystTargetResult } from '@/src/lib/analytics/analyst-target/types';
import { formatBangkokDateTime } from '@/src/lib/presentation/datetime';

/**
 * Analyst price-target consensus — a card kept deliberately SEPARATE from the
 * Nexora Fair Value model. It sources published sell-side consensus from an
 * entitled provider and shows only real values (low / median / average / high,
 * analyst count, currency, source, freshness). It never borrows the model's
 * confidence and is never called "Fair Value". When no verified data exists it
 * says so plainly instead of showing a number.
 */

const COVERAGE_LABEL: Record<NonNullable<AnalystPriceTarget['coverageWindow']>, string> = {
  'last-quarter': 'ไตรมาสล่าสุด',
  'last-year': 'ปีล่าสุด',
  'all-time': 'ทั้งหมด',
};

export function AnalystTargetSection({ symbol }: { symbol: string }) {
  const [data, setData] = useState<AnalystTargetResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/analytics/analyst-target/${encodeURIComponent(symbol)}`, { cache: 'no-store' });
      const body = (await response.json()) as { data?: AnalystTargetResult };
      if (!body.data) throw new Error('ไม่พบข้อมูล');
      setData(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#151B28] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-white">ราคาเป้าหมายนักวิเคราะห์</h2>
          <p className="mt-1 text-xs text-slate-400">ข้อมูลอ้างอิงภายนอก — ไม่ใช่การประเมินของแบบจำลอง Nexora</p>
        </div>
        {!data && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="min-h-11 rounded-lg border border-slate-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'กำลังดึงข้อมูล…' : 'แสดงราคาเป้าหมาย'}
          </button>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-300">เกิดข้อผิดพลาด: {error}</p>}

      {data?.status === 'unavailable' && (
        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-800/30 p-4">
          <p className="font-semibold text-slate-200">ยังไม่มีราคาเป้าหมายจากแหล่งข้อมูลที่ตรวจสอบได้</p>
          <p className="mt-2 text-sm text-slate-400">{data.reason}</p>
        </div>
      )}

      {data?.status === 'available' && <AnalystTargetBody target={data} />}
    </section>
  );
}

function AnalystTargetBody({ target }: { target: AnalystPriceTarget }) {
  const suffix = target.currency ? ` ${target.currency}` : '';
  const fmt = (value: number): string => `${value.toFixed(2)}${suffix}`;
  return (
    <div className="mt-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cell label="ต่ำสุด" value={fmt(target.low)} />
        <Cell label="มัธยฐาน" value={target.median === null ? '—' : fmt(target.median)} />
        <Cell label="เฉลี่ย" value={fmt(target.average)} />
        <Cell label="สูงสุด" value={fmt(target.high)} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          จำนวนนักวิเคราะห์:{' '}
          {target.analystCount === null
            ? 'ไม่ระบุ'
            : `${target.analystCount}${target.coverageWindow ? ` (${COVERAGE_LABEL[target.coverageWindow]})` : ''}`}
        </span>
        <span>สกุลเงิน: {target.currency ?? 'ไม่ระบุ'}</span>
        {target.asOf && <span>ข้อมูล ณ: {formatBangkokDateTime(target.asOf)}</span>}
        <span>ดึงข้อมูลเมื่อ: {formatBangkokDateTime(target.retrievedAt)}</span>
        <span>แหล่งข้อมูล: Financial Modeling Prep</span>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 p-3">
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p className="mt-2 font-mono text-white">{value}</p>
    </div>
  );
}
