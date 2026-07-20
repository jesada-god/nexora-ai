'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { CANDLE_INTERVALS, CANDLE_RANGES, supportedRangesFor } from '@/src/lib/market-data/candles/capabilities';
import type { CandleInterval, CandleRange, CandleSession } from '@/src/lib/market-data/candles/contracts';
import type { HistoryResponse } from './history-request';

const MarketCandleChartPanel = dynamic(
  () => import('./IntradayChartPanel').then((module) => module.MarketCandleChartPanel),
  { ssr: false, loading: () => <Skeleton className="h-[420px] w-full" /> },
);

const RANGE_LABELS: Record<CandleRange, string> = {
  '1d': '1D', '5d': '5D', '1m': '1M', '3m': '3M', '6m': '6M',
  ytd: 'YTD', '1y': '1Y', '3y': '3Y', '5y': '5Y',
};

interface Props {
  symbol: string;
  active: boolean;
  initialHistory?: HistoryResponse | null;
  technicalIndicatorsEnabled: boolean;
  advancedChartTypesEnabled: boolean;
  extendedIndicatorsEnabled: boolean;
  supportResistanceEnabled: boolean;
  fairValueEnabled: boolean;
}

export function ChartPanel({
  symbol,
  active,
  initialHistory: _initialHistory,
  technicalIndicatorsEnabled,
  advancedChartTypesEnabled,
  extendedIndicatorsEnabled,
  supportResistanceEnabled,
  fairValueEnabled,
}: Props) {
  const [interval, setInterval] = useState<CandleInterval>('1D');
  const [range, setRange] = useState<CandleRange>('3m');
  const [session, setSession] = useState<CandleSession>('regular');
  const [adjusted, setAdjusted] = useState(true);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const supportedRanges = supportedRangesFor(interval);
  const intraday = !['1D', 'Week', 'Month'].includes(interval);

  const selectInterval = (next: CandleInterval) => {
    const nextRanges = supportedRangesFor(next);
    setInterval(next);
    if (!nextRanges.includes(range)) {
      const fallback = nextRanges.includes('5d') ? '5d' : nextRanges.at(-1) ?? '1d';
      setRange(fallback);
      setSelectionNotice(`${next} does not support ${RANGE_LABELS[range]}; range changed to ${RANGE_LABELS[fallback]}.`);
    } else {
      setSelectionNotice(null);
    }
    if (!['1D', 'Week', 'Month'].includes(next)) setAdjusted(false);
  };

  return <div className="space-y-3">
    <section aria-label="Candle timeframe" className="space-y-2 rounded-xl border border-slate-800 bg-[#151B28] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Candle Timeframe</p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Candle timeframe">
        {CANDLE_INTERVALS.map((value) => <button key={value} type="button" role="tab" aria-selected={interval === value} onClick={() => selectInterval(value)} className={`min-h-11 rounded-lg px-3 text-sm ${interval === value ? 'bg-[#D4FF00] font-semibold text-black' : 'text-slate-300'}`}>{value}</button>)}
      </div>
    </section>

    <section aria-label="Historical range" className="space-y-2 rounded-xl border border-slate-800 bg-[#151B28] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Historical Range</p>
      <div className="flex flex-wrap gap-2">
        {CANDLE_RANGES.map((value) => {
          const supported = supportedRanges.includes(value);
          return <button key={value} type="button" disabled={!supported} title={supported ? undefined : `Provider does not support ${interval} + ${RANGE_LABELS[value]}`} onClick={() => { setRange(value); setSelectionNotice(null); }} className={`min-h-11 min-w-12 rounded-full px-3 text-xs ${range === value ? 'bg-[#D4FF00] text-black' : 'bg-slate-800 text-slate-300'} disabled:cursor-not-allowed disabled:opacity-30`}>{RANGE_LABELS[value]}</button>;
        })}
      </div>
      {selectionNotice && <p role="status" className="text-xs text-amber-300">{selectionNotice}</p>}
      <p className="text-xs text-slate-500">5Y is supported only by 1D, Week, and Month. Intraday never falls back to daily candles.</p>
    </section>

    <div className="flex flex-wrap gap-2">
      {intraday && <select aria-label="Market session" value={session} onChange={(event) => setSession(event.target.value as CandleSession)} className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200"><option value="regular">Regular session</option><option value="extended">Extended (provider permitting)</option></select>}
      {!intraday && <button type="button" aria-pressed={adjusted} onClick={() => setAdjusted((value) => !value)} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">{adjusted ? 'Adjusted' : 'Unadjusted'}</button>}
    </div>

    <MarketCandleChartPanel symbol={symbol} active={active} interval={interval} range={range} session={session} adjusted={adjusted} technicalIndicatorsEnabled={technicalIndicatorsEnabled} advancedChartTypesEnabled={advancedChartTypesEnabled} extendedIndicatorsEnabled={extendedIndicatorsEnabled} supportResistanceEnabled={supportResistanceEnabled} fairValueEnabled={fairValueEnabled} />
  </div>;
}
