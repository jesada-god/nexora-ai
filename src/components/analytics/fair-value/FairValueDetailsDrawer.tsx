'use client';

import { Drawer } from '@/src/components/ui/Drawer';
import type { FairValueResult } from '@/src/lib/analytics/valuation/types';
import { formatBangkokDateTime, formatMarketDataAsOf } from '@/src/lib/presentation/datetime';
import { fairValueUnavailableLabel, fairValueUnavailableReason, modelLabel } from './presentation';

export function FairValueDetailsDrawer({ id, open, onClose, data, unavailableReason }: {
  id: string;
  open: boolean;
  onClose: () => void;
  data: FairValueResult | null;
  unavailableReason: string | null;
}) {
  return (
    <Drawer id={id} isOpen={open} onClose={onClose} title="วิธีคำนวณ Fair Value">
      <div className="space-y-6 break-words text-sm leading-6 text-slate-300">
        <section>
          <h3 className="font-semibold text-white">Fair Value คืออะไร</h3>
          <p className="mt-1">Fair Value คือราคาประเมินจากข้อมูลทางการเงินและแบบจำลอง ไม่ใช่ราคาตลาดหรือคำแนะนำให้ซื้อขาย</p>
        </section>
        {data?.status === 'unavailable' || !data ? (
          <section>
            <h3 className="font-semibold text-white">เหตุผลที่ยังคำนวณไม่ได้</h3>
            <p className="mt-1 font-semibold text-amber-300">{data?.status === 'unavailable' ? fairValueUnavailableLabel(data.failureKind, 'th') : 'เกิดข้อผิดพลาด'}</p>
            <p className="mt-1 text-slate-300">{data?.status === 'unavailable' ? fairValueUnavailableReason(data, 'th') : unavailableReason ?? 'ไม่มีข้อมูล Fair Value ที่ผ่าน validation'}</p>
            {data?.status === 'unavailable' && <><p className="mt-2 text-xs text-slate-500">Provider: {data.provider ?? 'ไม่ทราบ'} · as of {formatBangkokDateTime(data.asOf)}</p><ul className="mt-2 list-disc pl-5 text-xs text-slate-400">{data.missingFields.map((item) => <li key={item}>{item}</li>)}</ul></>}
          </section>
        ) : (
          <>
            <section>
              <h3 className="font-semibold text-white">โมเดลที่เลือกใช้</h3>
              <p className="mt-1">{modelLabel(data.selectedModel)} · กฎ {data.sectorRuleId} ({data.sectorRuleVersion})</p>
              <p className="text-xs text-slate-400">{data.sector} / {data.industry}</p>
              <ul className="mt-2 space-y-2">
                {data.modelResults.map((model) => <li key={model.model} className="rounded-lg border border-slate-800 p-3"><span className="font-semibold text-[#D4FF00]">{modelLabel(model.model)} · configured {((model.configuredWeight ?? model.weight) * 100).toFixed(2)}% → normalized {(model.weight * 100).toFixed(2)}%</span><p className="mt-1 text-xs text-slate-300">{model.methodology}</p><p className="mt-1 text-xs text-slate-400">{model.reason}</p>{model.scenarios && <p className="mt-1 font-mono text-xs text-slate-400">{model.scenarios.conservative.toFixed(2)} / {model.scenarios.base.toFixed(2)} / {model.scenarios.optimistic.toFixed(2)} USD</p>}</li>)}
              </ul>
              {data.excludedModels.length > 0 && <div className="mt-3"><p className="text-xs font-semibold text-slate-300">โมเดลที่ไม่ผ่าน validator</p><ul className="mt-1 list-disc pl-5 text-xs text-slate-400">{data.excludedModels.map((item) => <li key={item.model}>{modelLabel(item.model)}: {item.reason}</li>)}</ul></div>}
            </section>
            <section>
              <h3 className="font-semibold text-white">Conservative / Base / Optimistic</h3>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <Scenario label="Conservative" low={data.fundamentalFairValue.conservative.low} high={data.fundamentalFairValue.conservative.high} />
                <Scenario label="Base" low={data.fundamentalFairValue.base.low} high={data.fundamentalFairValue.base.high} />
                <Scenario label="Optimistic" low={data.fundamentalFairValue.optimistic.low} high={data.fundamentalFairValue.optimistic.high} />
              </dl>
            </section>
            <section>
              <h3 className="font-semibold text-white">ข้อมูลจริงที่ใช้</h3>
              <div className="mt-2 space-y-2">{data.inputDetails.map((item) => <dl key={item.field} className="rounded-lg border border-slate-800 p-3 text-xs"><dt className="font-semibold text-slate-200">{item.field}</dt><dd className="mt-1">{String(item.value)} {item.currency ?? ''}</dd><dd className="text-slate-500">{item.period} · {item.provider} · as of {item.asOf} · {item.status} · {item.origin}</dd></dl>)}</div>
            </section>
            <section>
              <h3 className="font-semibold text-white">สมมติฐาน</h3>
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-400">{data.assumptionDetails.map((item) => <li key={item.field}>{item.field}: {String(item.value)} · {item.source} · {item.ruleVersion}</li>)}</ul>
            </section>
            <section>
              <h3 className="font-semibold text-white">Reliability</h3>
              <p className="mt-1">{data.modelReliability.level} · {data.modelReliability.score?.toFixed(1) ?? 'Unavailable'}/100</p>
              <p className="text-xs text-slate-400">{data.modelReliability.explanation}</p>
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-400">{data.reliabilityReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              <p className="mt-2 text-xs text-slate-400">Provider: {data.sources.map((source) => source.name).join(', ')} · as of {formatMarketDataAsOf(data.latestDataAt)} · status {data.dataStatus}</p>
              {data.displayFx && <p className="mt-1 text-xs text-slate-400">FX: 1 USD = {data.displayFx.rate.toFixed(4)} THB · {data.displayFx.provider} · {data.displayFx.status} · {formatBangkokDateTime(data.displayFx.asOf)}</p>}
              {!data.displayFx && <p className="mt-1 text-xs text-amber-300">THB: Unavailable — ไม่มีอัตรา USD/THB จริงที่ตรวจสอบได้</p>}
            </section>
          </>
        )}
        <section className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          <p>Model estimate — not a market quote</p>
          <p>เป็นค่าประเมินจากแบบจำลอง ไม่ใช่ราคาตลาดหรือคำแนะนำในการลงทุน</p>
        </section>
      </div>
    </Drawer>
  );
}

function Scenario({ label, low, high }: { label: string; low: number; high: number }) {
  return <div className="rounded-lg border border-slate-800 p-2"><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-mono text-white">{low.toFixed(2)}–{high.toFixed(2)} USD</dd></div>;
}
