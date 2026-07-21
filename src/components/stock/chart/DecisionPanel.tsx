'use client';

import { useMemo, useState } from 'react';
import type { InstitutionalZone } from '@/src/lib/analytics/institutional-sr/types';
import type { VisibleRangeVolumeProfile } from '@/src/lib/analytics/institutional-sr/visible-range-profile';
import type { AnchoredVwapResult } from '@/src/lib/analytics/institutional-sr/anchored-vwap';
import type { OptionsSrResult } from '@/src/lib/analytics/options-sr/types';
import type { MarketDataLabel } from '@/src/lib/stock-detail/market-source';
import {
  buildDecisionPanelModel,
  collectReferences,
  dataModeLabel,
  formatDelayAgeTh,
  formatEtaRangeTh,
  resolveDedupTolerance,
  type AtrEtaInput,
  type CurrentPriceAnchor,
  type DecisionDataMode,
  type DecisionPanelItem,
  type DecisionReliability,
  type DecisionSide,
  type DecisionSourceType,
  type DecisionStrength,
  type OptionsSectionStatus,
} from '@/src/lib/analytics/decision-panel';
import { InfoHint } from '@/src/components/ui/InfoHint';
import type { GlossaryTermId } from '@/src/lib/analytics/glossary';

export interface DecisionPanelProps {
  /** The single accepted current price shared with the header and chart. */
  acceptedPrice: number | null;
  /** Provenance of the accepted price (mode/provider/timestamp/delay). Never REAL-TIME. */
  marketLabel?: MarketDataLabel | null;
  zones?: readonly InstitutionalZone[];
  volumeProfile?: VisibleRangeVolumeProfile | null;
  anchoredVwap?: AnchoredVwapResult | null;
  optionsResult?: OptionsSrResult | null;
  /** Whether the options toggle is on (an off toggle hides the options section entirely). */
  optionsEnabled?: boolean;
  optionsLoading?: boolean;
  /** Confirmed 1-hour ATR, when the chart is on the 1h interval. Enables ATR ETA. */
  atr?: AtrEtaInput | null;
  proximityThresholdPercent?: number;
}

const SIDE_ACCENT: Record<DecisionSide, string> = {
  resistance: 'border-l-rose-500 bg-rose-500/5',
  support: 'border-l-emerald-500 bg-emerald-500/5',
  neutral: 'border-l-slate-500 bg-slate-500/5',
};
const SIDE_TEXT: Record<DecisionSide, string> = {
  resistance: 'text-rose-300',
  support: 'text-emerald-300',
  neutral: 'text-slate-300',
};

// Beginner-Thai presentation maps. These are display-only; the analytics library
// keeps its English source labels for stable, testable geometry output.
const SIDE_TH: Record<DecisionSide, string> = { resistance: 'แนวต้าน', support: 'แนวรับ', neutral: 'คร่อมราคา' };
const RELIABILITY_TH: Record<DecisionReliability, string> = { high: 'น่าเชื่อถือสูง', moderate: 'น่าเชื่อถือปานกลาง', low: 'น่าเชื่อถือต่ำ' };
const STRENGTH_TH: Record<DecisionStrength, string> = { strong: 'สัญญาณแข็งแรง', moderate: 'สัญญาณปานกลาง', weak: 'สัญญาณอ่อน' };
const SOURCE_TH: Record<DecisionSourceType, { label: string; term: GlossaryTermId | null }> = {
  'd1-zone': { label: 'โซนรายวัน', term: null },
  poc: { label: 'จุดควบคุมราคา (POC)', term: 'poc' },
  vah: { label: 'ขอบบน Value Area (VAH)', term: 'vah' },
  val: { label: 'ขอบล่าง Value Area (VAL)', term: 'val' },
  avwap: { label: 'ต้นทุนเฉลี่ย (AVWAP)', term: 'avwap' },
  'call-wall': { label: 'กำแพงฝั่งคอล (Call Wall)', term: 'callWall' },
  'put-wall': { label: 'กำแพงฝั่งพุต (Put Wall)', term: 'putWall' },
  'max-pain': { label: 'ราคาเจ็บตัวมากสุด (Max Pain)', term: 'maxPain' },
};

function sourceMeta(item: Pick<DecisionPanelItem, 'sourceType' | 'sourceLabel'>): { label: string; term: GlossaryTermId | null } {
  if (item.sourceType === 'd1-zone') {
    const demand = item.sourceLabel.toLowerCase().includes('demand');
    return { label: demand ? 'โซนอุปสงค์รายวัน (แนวรับ)' : 'โซนอุปทานรายวัน (แนวต้าน)', term: demand ? 'support' : 'resistance' };
  }
  return SOURCE_TH[item.sourceType];
}

function qualityLabelTh(item: Pick<DecisionPanelItem, 'reliability' | 'strength'>): string | null {
  if (item.reliability) return RELIABILITY_TH[item.reliability];
  if (item.strength) return STRENGTH_TH[item.strength];
  return null;
}

/** Compact beginner-Thai message for the isolated options section. */
function optionsMessageTh(status: OptionsSectionStatus): string {
  if (status.reason === 'rate-limited') return 'ข้อมูลออปชันติดข้อจำกัดชั่วคราว กรุณาลองใหม่ภายหลัง';
  if (status.reason === 'entitlement-required') return 'บัญชีนี้ยังไม่มีสิทธิ์เข้าถึงข้อมูลออปชัน';
  if (status.reason === 'no-expirations') return 'ยังไม่มีชุดวันหมดอายุออปชันสำหรับหุ้นนี้';
  if (status.reason === 'insufficient-coverage') return 'ข้อมูลออปชันมีไม่พอสำหรับคำนวณระดับอ้างอิง';
  return status.message && /loading|กำลัง/i.test(status.message) ? 'กำลังโหลดข้อมูลออปชัน…' : 'ข้อมูลออปชันไม่พร้อมใช้งานในขณะนี้';
}

function anchorFrom(acceptedPrice: number | null, label: MarketDataLabel | null | undefined, direction: CurrentPriceAnchor['lastDirection']): CurrentPriceAnchor {
  if (acceptedPrice == null || !Number.isFinite(acceptedPrice)) {
    return { price: null, lastDirection: 'unknown', dataMode: 'UNAVAILABLE', provider: label?.provider ?? null, exchangeTimestamp: label?.exchangeTimestamp ?? null, delayAgeSeconds: label?.delayAgeSeconds ?? null, stale: true };
  }
  // No label yet → the value is at best delayed; never claim real-time.
  const mode: DecisionDataMode = label?.mode ?? 'DELAYED';
  return {
    price: acceptedPrice,
    lastDirection: direction,
    dataMode: mode,
    provider: label?.provider ?? null,
    exchangeTimestamp: label?.exchangeTimestamp ?? null,
    delayAgeSeconds: label?.delayAgeSeconds ?? null,
    stale: mode === 'STALE' || mode === 'UNAVAILABLE',
  };
}

function optionsSectionStatus(result: OptionsSrResult | null | undefined, enabled: boolean, loading: boolean): OptionsSectionStatus {
  if (!enabled) return { status: 'off', reason: null, message: null, dataMode: null, retryable: true };
  if (!result) return { status: 'unavailable', reason: null, message: loading ? 'Loading options open interest…' : null, dataMode: null, retryable: true };
  if (result.status === 'available') return { status: 'available', reason: null, message: null, dataMode: result.dataMode, retryable: true };
  // 401/403 entitlement failures must not be auto-retried; 429 respects Retry-After upstream.
  const retryable = result.reason !== 'entitlement-required';
  return { status: 'unavailable', reason: result.reason, message: result.message, dataMode: result.dataMode, retryable };
}

function ConfluenceBadges({ item }: { item: DecisionPanelItem }) {
  if (item.confluence.length <= 1) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {item.confluence.map((badge) => (
        <span key={`${badge.sourceType}:${badge.sourceLabel}`} className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-300">
          {badge.sourceLabel}
        </span>
      ))}
    </div>
  );
}

function ReferenceCard({ item }: { item: DecisionPanelItem }) {
  const band = item.priceLow === item.priceHigh
    ? `$${item.midpoint.toFixed(2)}`
    : `$${item.priceLow.toFixed(2)}–$${item.priceHigh.toFixed(2)}`;
  const quality = qualityLabelTh(item);
  const eta = item.eta && item.eta.status === 'available' ? formatEtaRangeTh(item.eta) : null;
  const isConfluence = item.confluence.length > 1;
  const meta = sourceMeta(item);
  const hintTerm: GlossaryTermId = isConfluence ? 'confluence' : meta.term ?? (item.side === 'support' ? 'support' : 'resistance');
  return (
    <div className={`flex min-h-11 flex-col justify-center rounded-lg border border-slate-800 border-l-4 px-3 py-2 motion-safe:transition-colors ${SIDE_ACCENT[item.side]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`flex min-w-0 items-center gap-1 text-xs font-semibold ${SIDE_TEXT[item.side]}`}>
          <span className="truncate">{isConfluence ? 'จุดที่หลายสัญญาณมาซ้อนกัน' : meta.label}</span>
          <InfoHint term={hintTerm} />
        </span>
        <span className="shrink-0 font-mono text-xs text-white">{band}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-400">
        <span>ห่างจากราคาปัจจุบัน {item.distancePercent.toFixed(2)}%</span>
        {quality && <span className="tracking-wide">{quality}</span>}
      </div>
      {eta && <p className="mt-0.5 text-[10px] text-slate-500">{eta}</p>}
      {item.expiration && <p className="text-[10px] text-slate-600">หมดอายุ {item.expiration}</p>}
      <ConfluenceBadges item={item} />
    </div>
  );
}

const DIRECTION_GLYPH: Record<CurrentPriceAnchor['lastDirection'], string> = { up: '▲', down: '▼', flat: '▬', unknown: '·' };
const DIRECTION_COLOR: Record<CurrentPriceAnchor['lastDirection'], string> = { up: 'text-emerald-400', down: 'text-rose-400', flat: 'text-slate-400', unknown: 'text-slate-500' };

function AnchorCard({ anchor }: { anchor: CurrentPriceAnchor }) {
  const delay = formatDelayAgeTh(anchor);
  return (
    <div className="rounded-xl border border-[#D4FF00]/40 bg-[#D4FF00]/5 px-3 py-2.5 text-center">
      <div className="flex items-center justify-center gap-2">
        <span className={`text-sm ${DIRECTION_COLOR[anchor.lastDirection]}`} aria-hidden>{DIRECTION_GLYPH[anchor.lastDirection]}</span>
        <span className="font-mono text-lg font-bold text-white">{anchor.price != null ? `$${anchor.price.toFixed(2)}` : '—'}</span>
      </div>
      <p className="mt-1 flex items-center justify-center gap-1 text-[10px] tracking-wide text-[#D4FF00]/80">
        ราคาปัจจุบันที่ระบบใช้อ้างอิง
        <InfoHint term="acceptedPrice" />
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1">{dataModeLabel(anchor.dataMode)}<InfoHint term="dataLabels" /></span>
        {anchor.provider && <span>· {anchor.provider}</span>}
        {anchor.exchangeTimestamp && <span>· {new Date(anchor.exchangeTimestamp).toLocaleString(undefined, { hour12: false, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
        {delay && <span>· {delay}</span>}
      </div>
      <p className="mt-1 text-[9px] text-slate-600">ข้อมูลล่าช้า/สิ้นวัน ไม่ใช่ราคาเรียลไทม์ ใช้เป็นข้อมูลอ้างอิงเท่านั้น</p>
    </div>
  );
}

export function DecisionPanel({
  acceptedPrice,
  marketLabel,
  zones,
  volumeProfile,
  anchoredVwap,
  optionsResult,
  optionsEnabled = false,
  optionsLoading = false,
  atr,
  proximityThresholdPercent = 3,
}: DecisionPanelProps) {
  // Price-independent geometry — memoised on the analytics results only, so a
  // price tick reprojects distance/side/alert/ETA without rebuilding any zone.
  const references = useMemo(
    () => collectReferences({ zones, volumeProfile, anchoredVwap, options: optionsResult }),
    [zones, volumeProfile, anchoredVwap, optionsResult],
  );

  // Last-tick direction, derived during render via React's sanctioned
  // "adjust state when a prop changes" pattern — no effect, no market request.
  const [priceMemory, setPriceMemory] = useState<{ prev: number | null; direction: CurrentPriceAnchor['lastDirection'] }>({ prev: null, direction: 'unknown' });
  let direction = priceMemory.direction;
  if (acceptedPrice != null && Number.isFinite(acceptedPrice) && acceptedPrice !== priceMemory.prev) {
    direction = priceMemory.prev == null ? 'unknown' : acceptedPrice > priceMemory.prev ? 'up' : 'down';
    setPriceMemory({ prev: acceptedPrice, direction });
  }

  const anchor = useMemo(() => anchorFrom(acceptedPrice, marketLabel, direction), [acceptedPrice, marketLabel, direction]);
  const options = useMemo(() => optionsSectionStatus(optionsResult, optionsEnabled, optionsLoading), [optionsResult, optionsEnabled, optionsLoading]);
  const atrTolerance = useMemo(() => resolveDedupTolerance({ atrValue: atr?.value ?? null, acceptedPrice }), [atr, acceptedPrice]);

  const model = useMemo(
    () => buildDecisionPanelModel({
      references,
      acceptedPrice,
      anchor,
      atrTolerance,
      eta: { atr: atr ?? null },
      proximityThresholdPercent,
      maxPerSide: 3,
      options,
    }),
    [references, acceptedPrice, anchor, atrTolerance, atr, proximityThresholdPercent, options],
  );

  const [showMore, setShowMore] = useState(false);
  // Spam-safe live region: the announced text is the level *identity* only (no
  // changing distance), so it stays constant while the same level is active and
  // aria-live announces exactly once per newly-active level — never per tick.
  const announcement = model.alert.status === 'active' && model.alert.item
    ? `ราคาเข้าใกล้${SIDE_TH[model.alert.item.side]} ${sourceMeta(model.alert.item).label} ภายใน ${model.alert.thresholdPercent}%`
    : '';

  const hasReferences = references.length > 0;
  const extra = [...model.extraResistance, ...model.extraSupport, ...model.extraNeutral];

  return (
    <section aria-label="แผงสรุปแนวรับ-แนวต้าน" className="mt-3 rounded-xl border border-slate-800 bg-[#151B28]/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-slate-200">
          สรุปแนวรับ-แนวต้าน
          <InfoHint term="support" />
          <InfoHint term="resistance" />
        </h3>
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">{dataModeLabel(anchor.dataMode)}<InfoHint term="dataLabels" align="end" /></span>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">จุดราคาที่น่าจับตา จัดเรียงจากใกล้ราคาปัจจุบันที่สุด — เป็นข้อมูลอ้างอิง ไม่ใช่คำแนะนำซื้อขาย</p>

      {/* Reduced-motion-safe live region: announces once per newly-active level only. */}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {model.alert.status === 'active' && model.alert.item && (
        <div role="status" className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200 motion-safe:transition-colors">
          <span className="inline-flex items-center gap-1"><b>ราคาเข้าใกล้ (≤{model.alert.thresholdPercent}%)</b><InfoHint term="proximity" /></span>{' '}
          ห่าง {model.alert.item.distancePercent.toFixed(2)}% จาก{SIDE_TH[model.alert.item.side]}{' '}
          <b>{sourceMeta(model.alert.item).label}</b>{' '}
          ({model.alert.item.priceLow === model.alert.item.priceHigh ? `$${model.alert.item.midpoint.toFixed(2)}` : `$${model.alert.item.priceLow.toFixed(2)}–$${model.alert.item.priceHigh.toFixed(2)}`})
          {model.alert.item.reliability && <span className="text-amber-300/80"> · {RELIABILITY_TH[model.alert.item.reliability]}</span>}
        </div>
      )}

      {!hasReferences && (
        <p className="mt-3 text-xs text-slate-500">ยังไม่มีข้อมูลแนวรับ-แนวต้านสำหรับหุ้นนี้ ลองเปิดเลเยอร์บนกราฟ (โซนรายวัน, VRVP, AVWAP) หรือเลือกวันหมดอายุออปชันที่มีข้อมูล</p>
      )}

      {hasReferences && (
        <div className="mt-3 space-y-2">
          {/* Resistance — above the accepted price. */}
          {model.resistance.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-rose-300/80">แนวต้าน (เหนือราคาปัจจุบัน)<InfoHint term="resistance" /></p>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {model.resistance.map((item) => <ReferenceCard key={item.id} item={item} />)}
              </div>
            </div>
          )}

          <AnchorCard anchor={anchor} />

          {/* Support — below the accepted price. */}
          {model.support.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-emerald-300/80">แนวรับ (ใต้ราคาปัจจุบัน)<InfoHint term="support" /></p>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {model.support.map((item) => <ReferenceCard key={item.id} item={item} />)}
              </div>
            </div>
          )}

          {/* Neutral references straddling the price — compact. */}
          {model.neutral.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold tracking-wide text-slate-400">คร่อมราคาปัจจุบัน</p>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {model.neutral.map((item) => <ReferenceCard key={item.id} item={item} />)}
              </div>
            </div>
          )}

          {extra.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore} className="min-h-11 w-full rounded-lg border border-slate-700 px-3 text-xs text-slate-300 motion-safe:transition-colors">
                {showMore ? 'ย่อรายการ' : `ดูจุดอ้างอิงเพิ่มอีก ${extra.length} จุด`}
              </button>
              {showMore && (
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {extra.map((item) => <ReferenceCard key={item.id} item={item} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Options section — isolated: its failure never breaks the technical panel above. */}
      {options.status !== 'off' && (
        <div className="mt-3 border-t border-slate-800 pt-2 text-[10px]">
          {options.status === 'available'
            ? <p className="inline-flex flex-wrap items-center gap-1 text-slate-500">รวมระดับราคาอ้างอิงจากข้อมูลออปชัน{options.dataMode ? ` · ${dataModeLabel(options.dataMode)}` : ''} — เป็นระดับอ้างอิงเท่านั้น ไม่ได้แปลว่าราคาจะถูกตรึงไว้<InfoHint term="callWall" /><InfoHint term="putWall" /><InfoHint term="maxPain" /></p>
            : <p className="text-amber-300/90">{optionsMessageTh(options)} ข้อมูลแนวรับ-แนวต้านด้านบนยังใช้งานได้ตามปกติ{options.retryable === false ? ' (ระบบจะไม่ลองใหม่อัตโนมัติ)' : ''}</p>}
        </div>
      )}
    </section>
  );
}

export default DecisionPanel;
