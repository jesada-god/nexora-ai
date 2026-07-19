'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, ChevronDown, Database, RefreshCw, Target } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { fetchFxRate } from '@/src/lib/market-data/fx/client';
import type { FxQuote } from '@/src/lib/market-data/fx/types';
import type { KeyStatisticsResult, MetricResult } from '@/src/lib/analytics/fundamentals/types';
import type {
  CompanyProfile,
  DataFreshness,
  MarketDataEnvelope,
  Quote,
  SymbolSearchResult,
} from '@/src/lib/market-data/types';
import {
  EVALUATION_YEARS,
  SCENARIOS,
  calculatePriceTarget,
  formatDisplayMoney,
  formatSignedPercent,
  parseFiniteDraft,
  validatePriceTarget,
  type DisplayCurrency,
  type EpsMode,
  type PriceTargetInput,
  type PriceTargetResult,
  type ScenarioKey,
} from '@/src/lib/price-target/calculations';
import { InfoPopover } from './InfoPopover';
import { StockSearch } from './StockSearch';

type SourceTag = 'actual' | 'custom' | 'unavailable';
type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable';

interface StockSnapshot {
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string | null;
  currentPrice: number | null;
  dataTimestamp: string | null;
  responseTimestamp: string | null;
  freshness: DataFreshness['status'] | null;
  provider: string | null;
}

interface ScenarioDraft {
  growth: string;
  targetPe: string;
  growthSource: SourceTag;
  targetPeSource: SourceTag;
}

interface InfoSpec {
  title: string;
  what: string;
  source: string;
  example: string;
  effect: string;
}

const scenarioLabels: Record<ScenarioKey, { title: string; subtitle: string }> = {
  conservative: { title: 'Conservative', subtitle: 'กรณีระมัดระวัง' },
  base: { title: 'Base', subtitle: 'กรณีฐาน' },
  optimistic: { title: 'Optimistic', subtitle: 'กรณีเชิงบวก' },
};

const emptyScenarios = (): Record<ScenarioKey, ScenarioDraft> => ({
  conservative: { growth: '', targetPe: '', growthSource: 'unavailable', targetPeSource: 'unavailable' },
  base: { growth: '', targetPe: '', growthSource: 'unavailable', targetPeSource: 'unavailable' },
  optimistic: { growth: '', targetPe: '', growthSource: 'unavailable', targetPeSource: 'unavailable' },
});

const epsInfo: InfoSpec = {
  title: 'EPS ที่ใช้คำนวณ',
  what: 'EPS คือกำไรต่อหุ้น ถ้า EPS ติดลบหรือเป็นศูนย์ วิธี P/E อาจไม่เหมาะ ระบบจะปิดผลลัพธ์ P/E',
  source: 'TTM มาจากงบ 12 เดือนล่าสุด, Forward มาจากประมาณการที่ตรวจสอบได้ หรือเลือก Manual เพื่อกรอกเอง',
  example: 'บริษัทมีกำไร 5 ดอลลาร์ต่อหุ้น ให้ใส่ 5 ไม่ต้องใส่เครื่องหมาย $',
  effect: 'EPS สูงขึ้นทำให้ Future EPS และราคาเป้าหมายสูงขึ้นตามสัดส่วน',
};

const growthInfo: InfoSpec = {
  title: 'อัตราเติบโต EPS ต่อปี',
  what: 'อัตราเติบโต EPS ต่อปี ไม่ใช่การเติบโตของราคาหุ้น กรอกเป็นเปอร์เซ็นต์ เช่น 10 หมายถึง 10%',
  source: 'พิจารณาจากประวัติกำไร แนวโน้มธุรกิจ และประมาณการที่คุณตรวจสอบแล้ว',
  example: 'EPS 5, Growth 10%, 3 ปี จะได้ Future EPS = 5 × (1.10)^3',
  effect: 'Growth สูงขึ้นจะทบต้น Future EPS และราคาเป้าหมาย จึงควรใช้สมมติฐานอย่างระมัดระวัง',
};

const peInfo: InfoSpec = {
  title: 'Target P/E',
  what: 'ค่า P/E ที่คาดว่าตลาดจะยอมจ่าย ยิ่งสูงราคาเป้าหมายยิ่งสูง',
  source: 'ดู P/E ปัจจุบัน ประวัติของบริษัท และบริษัทที่ใกล้เคียง แต่ต้องพิจารณาความเสี่ยงและคุณภาพกำไร',
  example: 'Future EPS 6 และ Target P/E 20 เท่า ให้ราคาเป้าหมาย 120 ดอลลาร์',
  effect: 'Target P/E เพิ่ม 10% จะเพิ่มราคาเป้าหมาย 10% เมื่อปัจจัยอื่นคงเดิม',
};

const mosInfo: InfoSpec = {
  title: 'Margin of Safety',
  what: 'ส่วนลดจากมูลค่าประเมินเพื่อเผื่อความคลาดเคลื่อน กรอกเป็นเปอร์เซ็นต์',
  source: 'เป็นสมมติฐานส่วนบุคคลตามความไม่แน่นอนของธุรกิจและความมั่นใจในข้อมูล',
  example: 'ราคาเป้าหมาย 100 และ Margin of Safety 20% จะได้ MOS Price 80',
  effect: 'Margin of Safety สูงขึ้นจะลด MOS Price แต่ไม่เปลี่ยน Target Price เดิม',
};

function sourceLabel(source: SourceTag): string {
  if (source === 'actual') return 'ข้อมูลจริง';
  if (source === 'custom') return 'กำหนดเอง';
  return 'unavailable';
}

function sourceClass(source: SourceTag): string {
  if (source === 'actual') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (source === 'custom') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
}

function SourceBadge({ source }: { source: SourceTag }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceClass(source)}`}>{sourceLabel(source)}</span>;
}

function FieldHeader({ label, source, info, htmlFor }: { label: string; source: SourceTag; info: InfoSpec; htmlFor?: string }) {
  return (
    <div className="mb-1 flex min-w-0 items-center gap-1">
      {htmlFor
        ? <label htmlFor={htmlFor} className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-200">{label}</label>
        : <span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-200">{label}</span>}
      <SourceBadge source={source} />
      <InfoPopover {...info} />
    </div>
  );
}

function NumericField({
  id,
  label,
  value,
  source,
  info,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  source: SourceTag;
  info: InfoSpec;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <FieldHeader label={label} source={source} info={info} htmlFor={id} />
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 min-w-0 text-base"
      />
    </div>
  );
}

function metricValue(metric: MetricResult | undefined): number | null {
  return metric && 'value' in metric && Number.isFinite(metric.value) ? metric.value : null;
}

function metricInput(metric: MetricResult | undefined, key: string): number | null {
  const value = metric?.inputs[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function freshnessDisplay(status: DataFreshness['status'] | null): 'live' | 'delayed' | 'cached' | 'stale' {
  if (status === 'realtime') return 'live';
  if (status === 'delayed' || status === 'end-of-day') return 'delayed';
  if (status === 'cached') return 'cached';
  return 'stale';
}

function freshnessClass(status: ReturnType<typeof freshnessDisplay>): string {
  if (status === 'live') return 'bg-emerald-500/15 text-emerald-300';
  if (status === 'delayed' || status === 'cached') return 'bg-amber-500/15 text-amber-300';
  return 'bg-red-500/15 text-red-300';
}

async function marketEnvelope<T>(url: string, signal: AbortSignal): Promise<MarketDataEnvelope<T>> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const payload = await response.json() as MarketDataEnvelope<T>;
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'ข้อมูลตลาด unavailable');
  return payload;
}

async function keyStatistics(symbol: string, signal: AbortSignal): Promise<KeyStatisticsResult> {
  const response = await fetch(`/api/analytics/key-statistics/${encodeURIComponent(symbol)}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json() as { data?: KeyStatisticsResult; error?: { message?: string } };
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Key Statistics unavailable');
  return payload.data;
}

function snapshotInfo(title: string, source: string, effect: string): InfoSpec {
  return {
    title,
    what: `ข้อมูล ${title} ของหุ้นที่เลือก`,
    source,
    example: 'หากแหล่งข้อมูลไม่ส่งค่าที่ตรวจสอบได้ ระบบจะแสดง unavailable แทนการสร้างค่า',
    effect,
  };
}

function SnapshotMetric({ label, value, info }: { label: string; value: ReactNode; info: InfoSpec }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex min-w-0 items-center gap-1">
        <p className="min-w-0 flex-1 break-words text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <InfoPopover {...info} />
      </div>
      <div className="mt-1 min-w-0 break-words text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function ResultMetric({
  label,
  value,
  info,
  className = 'text-white',
}: {
  label: string;
  value: ReactNode;
  info: InfoSpec;
  className?: string;
}) {
  return (
    <div className="min-w-0 border-b border-slate-800 py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 break-words text-xs text-slate-400">{label}</span>
        <InfoPopover {...info} />
      </div>
      <div className={`mt-1 min-w-0 break-words font-mono text-lg font-bold ${className}`}>{value}</div>
    </div>
  );
}

export function PriceTargetWorkspace() {
  const [selected, setSelected] = useState<SymbolSearchResult | null>(null);
  const [stock, setStock] = useState<StockSnapshot | null>(null);
  const [stockState, setStockState] = useState<LoadState>('idle');
  const [stockMessages, setStockMessages] = useState<string[]>([]);
  const [years, setYears] = useState<number>(3);
  const [epsMode, setEpsMode] = useState<EpsMode>('ttm');
  const [epsDrafts, setEpsDrafts] = useState<Record<EpsMode, string>>({ ttm: '', forward: '', manual: '' });
  const [epsSources, setEpsSources] = useState<Record<EpsMode, SourceTag>>({ ttm: 'unavailable', forward: 'unavailable', manual: 'custom' });
  const [scenarios, setScenarios] = useState<Record<ScenarioKey, ScenarioDraft>>(emptyScenarios);
  const [marginOfSafety, setMarginOfSafety] = useState('');
  const [forwardGrowthConfirmed, setForwardGrowthConfirmed] = useState(false);
  const [result, setResult] = useState<PriceTargetResult | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('USD');
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);
  const [fxState, setFxState] = useState<LoadState>('loading');
  const [fxMessage, setFxMessage] = useState('');

  useEffect(() => {
    let active = true;
    void fetchFxRate().then((parsed) => {
      if (!active) return;
      setFxQuote(parsed.quote);
      setFxState(parsed.quote ? 'ready' : 'unavailable');
      setFxMessage(parsed.warning ?? '');
    }).catch(() => {
      if (!active) return;
      setFxQuote(null);
      setFxState('unavailable');
      setFxMessage('ไม่มีอัตรา USD/THB ที่ตรวจสอบได้ จึงปิดการแสดงผล THB');
      setDisplayCurrency('USD');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();

    void Promise.allSettled([
      marketEnvelope<Quote>(`/api/market/quote/${encodeURIComponent(selected.symbol)}`, controller.signal),
      marketEnvelope<CompanyProfile>(`/api/market/profile/${encodeURIComponent(selected.symbol)}`, controller.signal),
      keyStatistics(selected.symbol, controller.signal),
    ]).then(([quoteResult, profileResult, statisticsResult]) => {
      if (controller.signal.aborted) return;
      const messages: string[] = [];
      const quoteEnvelope = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
      const profile = profileResult.status === 'fulfilled' ? profileResult.value.data : null;
      const statistics = statisticsResult.status === 'fulfilled' ? statisticsResult.value : null;
      if (!quoteEnvelope) messages.push(`ราคาปัจจุบัน unavailable: ${quoteResult.status === 'rejected' ? quoteResult.reason.message : 'ไม่ทราบสาเหตุ'}`);
      if (!profile) messages.push(`Company profile unavailable: ${profileResult.status === 'rejected' ? profileResult.reason.message : 'ไม่ทราบสาเหตุ'}`);
      if (!statistics) messages.push(`EPS/Key Statistics unavailable: ${statisticsResult.status === 'rejected' ? statisticsResult.reason.message : 'ไม่ทราบสาเหตุ'}`);

      const quote = quoteEnvelope?.data ?? null;
      const freshness = quoteEnvelope?.meta.freshness.status ?? null;
      const currency = profile?.currency ?? selected.currency;
      setStock({
        symbol: selected.symbol,
        name: profile?.name ?? selected.name,
        exchange: profile?.exchange ?? selected.exchange,
        currency,
        currentPrice: quote?.price ?? null,
        dataTimestamp: quoteEnvelope?.meta.freshness.asOf ?? null,
        responseTimestamp: quoteEnvelope?.meta.timestamp ?? null,
        freshness,
        provider: quoteEnvelope?.meta.provider ?? null,
      });

      const ttm = metricValue(statistics?.metrics.dilutedEpsTtm);
      const forward = metricInput(statistics?.metrics.forwardPe, 'consensusEps');
      const trailingPe = metricValue(statistics?.metrics.trailingPe);
      setEpsDrafts({ ttm: ttm === null ? '' : String(ttm), forward: forward === null ? '' : String(forward), manual: '' });
      setEpsSources({ ttm: ttm === null ? 'unavailable' : 'actual', forward: forward === null ? 'unavailable' : 'actual', manual: 'custom' });
      setScenarios(Object.fromEntries(SCENARIOS.map((key) => [key, {
        growth: '',
        targetPe: trailingPe === null ? '' : String(trailingPe),
        growthSource: 'unavailable',
        targetPeSource: trailingPe === null ? 'unavailable' : 'actual',
      }])) as Record<ScenarioKey, ScenarioDraft>);
      setStockMessages(messages);
      setStockState(quote ? 'ready' : 'unavailable');
    });
    return () => controller.abort();
  }, [selected]);

  const analysisInput = useMemo<PriceTargetInput>(() => ({
    symbol: selected?.symbol ?? null,
    currentPriceUsd: stock?.currentPrice ?? null,
    stockCurrency: stock?.currency ?? null,
    quoteFreshness: stock?.freshness ?? null,
    years,
    epsMode,
    eps: parseFiniteDraft(epsDrafts[epsMode]),
    marginOfSafetyPercent: parseFiniteDraft(marginOfSafety),
    forwardGrowthConfirmed,
    scenarios: Object.fromEntries(SCENARIOS.map((key) => [key, {
      growthPercent: parseFiniteDraft(scenarios[key].growth),
      targetPe: parseFiniteDraft(scenarios[key].targetPe),
    }])) as PriceTargetInput['scenarios'],
  }), [epsDrafts, epsMode, forwardGrowthConfirmed, marginOfSafety, scenarios, selected, stock, years]);

  const validation = useMemo(() => validatePriceTarget(analysisInput), [analysisInput]);
  const usdThbRate = fxQuote ? Number(fxQuote.rate) : null;

  function clearResult() {
    setResult(null);
  }

  function selectStock(nextSelected: SymbolSearchResult) {
    setSelected(nextSelected);
    setStock(null);
    setStockState('loading');
    setStockMessages([]);
    setResult(null);
    setEpsMode('ttm');
    setEpsDrafts({ ttm: '', forward: '', manual: '' });
    setEpsSources({ ttm: 'unavailable', forward: 'unavailable', manual: 'custom' });
    setScenarios(emptyScenarios());
    setMarginOfSafety('');
    setForwardGrowthConfirmed(false);
  }

  function clearSelection() {
    setSelected(null);
    setStock(null);
    setStockState('idle');
    setResult(null);
    setStockMessages([]);
  }

  function updateScenario(key: ScenarioKey, field: 'growth' | 'targetPe', value: string) {
    clearResult();
    setScenarios((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
        [field === 'growth' ? 'growthSource' : 'targetPeSource']: 'custom',
      },
    }));
  }

  function calculate() {
    if (!validation.valid) return;
    try {
      setResult(calculatePriceTarget(analysisInput));
    } catch {
      setResult(null);
    }
  }

  const selectedStatus = freshnessDisplay(stock?.freshness ?? null);
  const selectedPrice = stock?.currentPrice !== null && stock?.currentPrice !== undefined
    ? formatDisplayMoney(stock.currentPrice, 'USD', null)
    : 'unavailable';

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 space-y-6 p-4 pb-[max(2rem,env(safe-area-inset-bottom))] md:p-8">
      <section className="min-w-0 rounded-2xl border border-slate-800 bg-[#151B28] p-4 shadow-xl sm:p-6">
        <div className="mb-6 flex min-w-0 items-start gap-3">
          <div className="shrink-0 rounded-xl bg-[#D4FF00]/10 p-3 text-[#D4FF00]"><Target size={24} aria-hidden="true" /></div>
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold text-white sm:text-2xl">วิเคราะห์ราคาเป้าหมายหุ้น</h1>
            <p className="mt-1 break-words text-sm text-slate-400">P/E Multiple เป็นหนึ่งในวิธีประเมินมูลค่าจากสมมติฐาน ไม่ใช่ราคาตลาด</p>
          </div>
        </div>
        <StockSearch selected={selected} onSelect={selectStock} onClear={clearSelection} />

        {stockState === 'loading' && (
          <div role="status" className="mt-4 flex min-h-24 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 text-sm text-slate-400">
            <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> กำลังโหลดข้อมูลจริงของ {selected?.symbol}…
          </div>
        )}
        {selected && stockState !== 'loading' && stock && (
          <div className="mt-4 min-w-0 rounded-xl border border-slate-700 bg-slate-950/30 p-3 sm:p-4">
            <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
              <SnapshotMetric label="Symbol" value={stock.symbol} info={snapshotInfo('Symbol', 'ผลการค้นหาตราสารของระบบ', 'ใช้ระบุหุ้นที่กำลังวิเคราะห์')} />
              <SnapshotMetric label="ชื่อบริษัท" value={stock.name || 'unavailable'} info={snapshotInfo('ชื่อบริษัท', 'Company profile หรือผลค้นหาจริง', 'ช่วยตรวจว่าคุณเลือกบริษัทถูกตัว')} />
              <SnapshotMetric label="Exchange" value={stock.exchange ?? 'unavailable'} info={snapshotInfo('Exchange', 'Company profile หรือ instrument master', 'ใช้ตรวจตลาดที่หลักทรัพย์จดทะเบียน')} />
              <SnapshotMetric label="ราคาปัจจุบัน" value={selectedPrice} info={snapshotInfo('ราคาปัจจุบัน', 'Quote endpoint เดิมของ Nexora AI', 'ใช้คำนวณ Upside/Downside เทียบราคาเป้าหมาย')} />
              <SnapshotMetric label="Currency" value={stock.currency ?? 'unavailable'} info={snapshotInfo('Currency', 'Company profile หรือ instrument master', 'ต้องเป็น USD เพื่อคง USD เป็น source of truth')} />
              <SnapshotMetric label="Timestamp" value={stock.dataTimestamp ? new Date(stock.dataTimestamp).toLocaleString('th-TH') : 'unavailable'} info={snapshotInfo('Timestamp', 'เวลา as-of ที่ผู้ให้ข้อมูลส่งมา', 'ใช้ประเมินว่าราคาล่าสุดเพียงใด')} />
              <SnapshotMetric label="สถานะราคา" value={<span className={`rounded-full px-2 py-1 text-xs uppercase ${freshnessClass(selectedStatus)}`}>{selectedStatus}</span>} info={snapshotInfo('สถานะราคา', 'Freshness metadata ของ quote', 'stale จะปิดการคำนวณ; delayed/cached จะแสดงคำเตือน')} />
              <SnapshotMetric label="Provider" value={stock.provider ?? 'unavailable'} info={snapshotInfo('Provider', 'Metadata จาก quote response', 'บอกแหล่งที่มาของราคาปัจจุบัน')} />
            </div>
            {stock.responseTimestamp && <p className="mt-3 break-words text-xs text-slate-500">ระบบตอบกลับเมื่อ {new Date(stock.responseTimestamp).toLocaleString('th-TH')}</p>}
          </div>
        )}
        {stockMessages.length > 0 && (
          <div className="mt-3 space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200" role="status">
            {stockMessages.map((message) => <p key={message} className="break-words">• {message}</p>)}
          </div>
        )}
      </section>

      <section className="min-w-0 rounded-2xl border border-slate-800 bg-[#151B28] p-4 shadow-xl sm:p-6" aria-labelledby="price-target-assumptions">
        <div className="flex min-w-0 items-center gap-3">
          <Calculator className="shrink-0 text-[#D4FF00]" size={22} aria-hidden="true" />
          <h2 id="price-target-assumptions" className="min-w-0 break-words text-lg font-bold text-white">สมมติฐานการประเมิน</h2>
        </div>

        <div className="mt-6 grid min-w-0 gap-5 md:grid-cols-2">
          <div className="min-w-0">
            <FieldHeader
              label="ระยะเวลาประเมิน"
              source="custom"
              info={{
                title: 'ระยะเวลาประเมิน',
                what: 'จำนวนปีที่จะทบอัตราเติบโต EPS เลือกได้ 1, 3 หรือ 5 ปี',
                source: 'เลือกตามช่วงเวลาที่คุณต้องการถือและความน่าเชื่อถือของสมมติฐาน',
                example: 'เลือก 3 ปี หมายถึง Future EPS = EPS × (1 + Growth)^3',
                effect: 'ระยะเวลายาวทำให้ผลของ Growth ทบต้นมากขึ้นและเพิ่มความไม่แน่นอน',
              }}
            />
            <div className="grid grid-cols-3 rounded-xl border border-slate-700 bg-slate-950/50 p-1" role="group" aria-label="ระยะเวลาประเมิน">
              {EVALUATION_YEARS.map((year) => (
                <button
                  type="button"
                  key={year}
                  aria-pressed={years === year}
                  onClick={() => { clearResult(); setYears(year); }}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${years === year ? 'bg-[#D4FF00] text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}
                >
                  {year} ปี
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <FieldHeader
              label="EPS ที่ใช้"
              source={epsSources[epsMode]}
              info={{
                title: 'ประเภท EPS',
                what: 'TTM คือกำไร 12 เดือนล่าสุด, Forward คือกำไรประมาณการในอนาคต, Manual คือค่าที่คุณกรอกเอง',
                source: 'TTM/Forward จะเติมจาก Key Statistics เมื่อมีข้อมูลจริงที่ตรวจสอบได้',
                example: 'ถ้าต้องการใช้ EPS ล่าสุด เลือก TTM; ถ้ามีประมาณการของคุณเอง เลือก Manual',
                effect: 'ชนิด EPS กำหนดฐานเริ่มต้นของสูตรและความหมายของ Growth ที่นำไปทบ',
              }}
            />
            <select
              aria-label="เลือกประเภท EPS"
              value={epsMode}
              onChange={(event) => {
                clearResult();
                setEpsMode(event.target.value as EpsMode);
                setForwardGrowthConfirmed(false);
              }}
              className="min-h-11 w-full min-w-0 rounded-md border border-slate-700 bg-[#151B28] px-3 text-base text-white outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/50"
            >
              <option value="ttm">TTM EPS</option>
              <option value="forward">Forward EPS</option>
              <option value="manual">Manual EPS</option>
            </select>
          </div>

          <NumericField
            id="price-target-eps"
            label={epsMode === 'forward' ? 'Forward EPS' : epsMode === 'ttm' ? 'EPS ปัจจุบัน (TTM)' : 'EPS กำหนดเอง'}
            value={epsDrafts[epsMode]}
            source={epsSources[epsMode]}
            info={epsInfo}
            placeholder={epsSources[epsMode] === 'unavailable' ? 'unavailable — กรุณากรอกค่า' : 'เช่น 5.20'}
            onChange={(value) => {
              clearResult();
              setEpsDrafts((current) => ({ ...current, [epsMode]: value }));
              setEpsSources((current) => ({ ...current, [epsMode]: 'custom' }));
            }}
          />

          <NumericField
            id="price-target-margin-of-safety"
            label="Margin of Safety (%)"
            value={marginOfSafety}
            source={marginOfSafety ? 'custom' : 'unavailable'}
            info={mosInfo}
            placeholder="เช่น 20"
            onChange={(value) => { clearResult(); setMarginOfSafety(value); }}
          />
        </div>

        <div className="mt-7">
          <div className="mb-3 min-w-0">
            <h3 className="break-words font-bold text-white">Conservative / Base / Optimistic assumptions</h3>
            <p className="mt-1 break-words text-xs text-slate-500">ระบบไม่สร้างสมมติฐาน Growth ให้เอง หากไม่มีข้อมูลจริงให้กรอกค่าที่คุณตรวจสอบแล้ว</p>
          </div>
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            {SCENARIOS.map((key) => (
              <article key={key} className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/30 p-4">
                <h4 className="break-words font-bold text-white">{scenarioLabels[key].title}</h4>
                <p className="mt-1 text-xs text-slate-500">{scenarioLabels[key].subtitle}</p>
                <div className="mt-4 space-y-4">
                  <NumericField
                    id={`price-target-growth-${key}`}
                    label="EPS Growth ต่อปี (%)"
                    value={scenarios[key].growth}
                    source={scenarios[key].growthSource}
                    info={growthInfo}
                    placeholder="เช่น 10"
                    onChange={(value) => updateScenario(key, 'growth', value)}
                  />
                  <NumericField
                    id={`price-target-pe-${key}`}
                    label="Target P/E (เท่า)"
                    value={scenarios[key].targetPe}
                    source={scenarios[key].targetPeSource}
                    info={peInfo}
                    placeholder="เช่น 20"
                    onChange={(value) => updateScenario(key, 'targetPe', value)}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>

        {epsMode === 'forward' && SCENARIOS.some((key) => parseFiniteDraft(scenarios[key].growth) !== 0 && parseFiniteDraft(scenarios[key].growth) !== null) && (
          <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            <input
              type="checkbox"
              checked={forwardGrowthConfirmed}
              onChange={(event) => { clearResult(); setForwardGrowthConfirmed(event.target.checked); }}
              className="mt-1 h-5 w-5 shrink-0 accent-[#D4FF00]"
            />
            <span className="min-w-0 break-words">ฉันเข้าใจว่า Forward EPS อาจรวมการเติบโตไว้แล้ว และยืนยันให้นำ Growth ไปทบต่ออีก {years} ปี</span>
          </label>
        )}

        {validation.warnings.length > 0 && (
          <div role="status" className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p className="font-semibold">คำเตือนที่ควรตรวจสอบ</p>
            {validation.warnings.map((warning) => <p key={warning} className="mt-1 break-words">• {warning}</p>)}
          </div>
        )}

        <Button
          type="button"
          size="lg"
          onClick={calculate}
          disabled={!validation.valid || stockState === 'loading'}
          aria-describedby="price-target-disabled-reason"
          className="mt-6 min-h-12 w-full text-base font-bold"
        >
          คำนวณราคาเป้าหมาย
        </Button>
        <div id="price-target-disabled-reason" role="status" className="mt-3 min-w-0 text-sm">
          {!validation.valid ? (
            <p className="break-words text-amber-300">ยังคำนวณไม่ได้: {validation.errors[0]}</p>
          ) : (
            <p className="flex items-center gap-2 text-emerald-300"><CheckCircle2 size={16} aria-hidden="true" /> ข้อมูลครบและพร้อมคำนวณ</p>
          )}
          {validation.errors.slice(1).map((error) => <p key={error} className="mt-1 break-words text-xs text-slate-500">• {error}</p>)}
        </div>
      </section>

      {result && stock && (
        <section className="min-w-0 space-y-5" aria-labelledby="price-target-results">
          <div className="min-w-0 rounded-2xl border border-slate-800 bg-[#151B28] p-4 shadow-xl sm:p-6">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 id="price-target-results" className="break-words text-xl font-bold text-white">ผลวิเคราะห์ {stock.symbol}</h2>
                <p className="mt-1 break-words text-sm text-slate-400">คำนวณใน USD แล้วแปลง THB เฉพาะตอนแสดงผล</p>
              </div>
              <div className="min-w-0">
                <div className="grid grid-cols-2 rounded-lg border border-slate-700 bg-slate-950/50 p-1" role="group" aria-label="สกุลเงินที่แสดงผล">
                  {(['USD', 'THB'] as const).map((currency) => (
                    <button
                      type="button"
                      key={currency}
                      aria-pressed={displayCurrency === currency}
                      disabled={currency === 'THB' && (fxState !== 'ready' || !fxQuote)}
                      onClick={() => setDisplayCurrency(currency)}
                      className={`min-h-11 rounded-md px-5 text-sm font-bold ${displayCurrency === currency ? 'bg-[#D4FF00] text-slate-950' : 'text-slate-300 hover:bg-slate-800'} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      {currency}
                    </button>
                  ))}
                </div>
                <div className="mt-1 flex items-center justify-end gap-1">
                  <span className="text-[11px] text-slate-500">สกุลเงินแสดงผล</span>
                  <InfoPopover
                    title="สกุลเงินแสดงผล"
                    what="ผลคำนวณทั้งหมดเก็บเป็น USD; THB เป็นการแปลงเพื่ออ่านผลเท่านั้น"
                    source="ใช้อัตรา USD/THB จริงจาก FX endpoint เดิมเมื่อมีข้อมูล"
                    example="100 USD ที่ FX 35 จะแสดง 3,500 THB โดยค่า USD เดิมไม่เปลี่ยน"
                    effect="การเปลี่ยนสกุลเงินไม่คำนวณราคาเป้าหมายใหม่ และถ้า FX หายจะไม่ใช้ 1:1"
                  />
                </div>
              </div>
            </div>
            {fxQuote ? (
              <p className="mt-3 break-words text-xs text-slate-500">
                1 USD = {Number(fxQuote.rate).toFixed(4)} THB · {fxQuote.source} · {fxQuote.stale ? 'stale' : fxQuote.cached ? 'cached' : 'live'} · {new Date(fxQuote.asOf).toLocaleString('th-TH')}
              </p>
            ) : (
              <p className="mt-3 break-words text-xs text-amber-300">{fxState === 'loading' ? 'กำลังโหลด FX — ยังเลือก THB ไม่ได้' : fxMessage || 'FX unavailable — ปิดการแสดงผล THB'}</p>
            )}
            {fxMessage && fxQuote && <p className="mt-1 break-words text-xs text-amber-300">{fxMessage}</p>}

            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/30 p-4">
              <ResultMetric
                label="Current Price"
                value={formatDisplayMoney(stock.currentPrice ?? Number.NaN, displayCurrency, usdThbRate)}
                info={{
                  title: 'Current Price',
                  what: 'ราคาปัจจุบันของหุ้นที่ใช้เป็นฐานเปรียบเทียบ',
                  source: 'Quote จริงของหุ้น ณ timestamp ที่แสดงด้านบน',
                  example: 'ราคา 100 เทียบเป้าหมาย 120 จะมี Upside 20',
                  effect: 'ไม่เปลี่ยนราคาเป้าหมาย แต่เปลี่ยนจำนวนและเปอร์เซ็นต์ Upside/Downside',
                }}
              />
            </div>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            {SCENARIOS.map((key) => {
              const scenario = result.scenarios[key];
              const tone = scenario.direction === 'upside' ? 'text-emerald-400' : scenario.direction === 'downside' ? 'text-red-400' : 'text-slate-300';
              const directionText = scenario.direction === 'upside' ? 'มี Upside' : scenario.direction === 'downside' ? 'มี Downside' : 'ใกล้เคียงราคาปัจจุบัน';
              return (
                <article key={key} className="min-w-0 rounded-2xl border border-slate-800 bg-[#151B28] p-4 shadow-xl sm:p-5">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-lg font-bold text-white">{scenarioLabels[key].title} Target</h3>
                      <p className={`mt-1 break-words text-sm font-semibold ${tone}`}>{directionText}</p>
                    </div>
                    <InfoPopover
                      title={`${scenarioLabels[key].title} Target`}
                      what="ราคาเป้าหมายจาก EPS และสมมติฐาน Growth กับ Target P/E ของกรณีนี้"
                      source="คำนวณจากค่าที่แสดงในส่วน assumptions"
                      example="Future EPS 6 × Target P/E 20 = Target Price 120"
                      effect="ใช้เปรียบเทียบหลายกรณี ไม่ใช่การทำนายราคาตลาด"
                    />
                  </div>
                  <p className={`mt-3 break-words font-mono text-3xl font-bold ${tone}`}>
                    {formatDisplayMoney(scenario.targetPriceUsd, displayCurrency, usdThbRate)}
                  </p>
                  <ResultMetric
                    label="Upside / Downside เป็นเงิน"
                    value={formatDisplayMoney(scenario.differenceUsd, displayCurrency, usdThbRate, true)}
                    className={tone}
                    info={{
                      title: 'Upside / Downside เป็นเงิน',
                      what: 'ส่วนต่างระหว่าง Target Price กับ Current Price',
                      source: 'Target Price − Current Price',
                      example: '120 − 100 = +20 แปลว่ามี Upside 20',
                      effect: 'ค่าบวกคือ Upside ค่าลบคือ Downside และศูนย์คือใกล้เคียงราคาปัจจุบัน',
                    }}
                  />
                  <ResultMetric
                    label="Upside / Downside (%)"
                    value={`${directionText} · ${formatSignedPercent(scenario.differencePercent)}`}
                    className={tone}
                    info={{
                      title: 'Upside / Downside เป็นเปอร์เซ็นต์',
                      what: 'ส่วนต่างราคาเทียบเป็นเปอร์เซ็นต์ของ Current Price',
                      source: '(Target Price − Current Price) ÷ Current Price × 100',
                      example: 'ส่วนต่าง 20 จากราคาปัจจุบัน 100 เท่ากับ +20%',
                      effect: 'ช่วยเปรียบเทียบสัดส่วนโดยไม่พึ่งสี ระบบจะแสดงข้อความ Upside, Downside หรือใกล้เคียงด้วย',
                    }}
                  />
                  <ResultMetric
                    label="MOS Price"
                    value={formatDisplayMoney(scenario.mosPriceUsd, displayCurrency, usdThbRate)}
                    info={{
                      title: 'MOS Price',
                      what: 'ราคาเป้าหมายหลังหัก Margin of Safety',
                      source: 'Target Price × (1 − Margin of Safety)',
                      example: 'Target 120 และ MOS 20% ได้ MOS Price 96',
                      effect: 'MOS สูงขึ้นจะลดราคานี้เพื่อเผื่อความคลาดเคลื่อน',
                    }}
                  />
                  <ResultMetric
                    label="Future EPS"
                    value={scenario.futureEps.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                    info={{
                      title: 'Future EPS',
                      what: 'EPS ที่ประมาณการเมื่อครบระยะเวลาที่เลือก โดยยังไม่ปัดค่าระหว่างทาง',
                      source: 'EPS × (1 + Growth)^Years',
                      example: 'EPS 5, Growth 10%, 3 ปี ได้ 6.655',
                      effect: 'เป็นฐานที่นำไปคูณ Target P/E เพื่อหาราคาเป้าหมาย',
                    }}
                  />
                  <div className="mt-3 rounded-xl bg-slate-950/40 p-3 text-xs leading-6 text-slate-400">
                    <p>EPS: {result.eps} ({result.epsMode.toUpperCase()})</p>
                    <p>Growth: {scenarios[key].growth}% ต่อปี</p>
                    <p>Target P/E: {scenarios[key].targetPe} เท่า</p>
                    <p>ระยะเวลา: {result.years} ปี · MOS: {result.marginOfSafetyPercent}%</p>
                  </div>
                </article>
              );
            })}
          </div>

          <details className="group min-w-0 rounded-2xl border border-slate-800 bg-[#151B28] p-4 shadow-xl sm:p-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4FF00]">
              <span className="min-w-0 break-words">ดูวิธีคำนวณ</span>
              <ChevronDown size={18} className="shrink-0 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-4 min-w-0 space-y-3 break-words text-sm leading-6 text-slate-300">
              <p><strong className="text-white">1. Future EPS</strong> = EPS × (1 + Growth ÷ 100)<sup>Years</sup></p>
              <p><strong className="text-white">2. Target Price</strong> = Future EPS × Target P/E</p>
              <p><strong className="text-white">3. MOS Price</strong> = Target Price × (1 − Margin of Safety ÷ 100)</p>
              <p><strong className="text-white">4. Upside/Downside</strong> = Target Price − Current Price และหาร Current Price เพื่อแสดง %</p>
              <p className="text-slate-500">ระบบแปลงเปอร์เซ็นต์เป็น decimal ครั้งเดียวที่ขอบเขตสูตร ไม่ปัด intermediate result และป้องกัน NaN, Infinity กับ negative zero</p>
              {result.epsMode === 'forward' && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                  ใช้ Forward EPS เป็นฐาน และ {forwardGrowthConfirmed ? 'ผู้ใช้ยืนยันให้นำ Growth ไปทบต่อแล้ว' : 'ไม่มี Growth ที่ต้องยืนยัน'}
                </p>
              )}
            </div>
          </details>

          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            <AlertTriangle className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
            <p className="min-w-0 break-words">เป็นมูลค่าจากสมมติฐาน ไม่ใช่ราคาตลาดหรือคำแนะนำลงทุน</p>
          </div>
        </section>
      )}

      {!selected && (
        <div className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-400">
          <Database className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
          <p className="min-w-0 break-words">ระบบจะไม่คำนวณจนกว่าจะเลือกหุ้นจริงจากผลค้นหา และจะไม่สร้างราคา EPS หรือ FX สมมติเมื่อข้อมูล unavailable</p>
        </div>
      )}
    </main>
  );
}
