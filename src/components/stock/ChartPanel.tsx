'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useToast } from '@/src/components/ui/Toast';
import { compatibleSelection, GATEWAY_INTERVALS, GATEWAY_RANGES } from '@/src/lib/market-data/gateway/capabilities';
import type { CandleInterval, HistoricalRange, MarketSessionMode } from '@/src/lib/market-data/gateway/contracts';
import type { AcceptedPriceCandidate, LiveCandle, MarketDataLabel, MarketSelection } from '@/src/lib/stock-detail/market-source';
import type { HistoryResponse } from './history-request';

const MarketCandleChartPanel = dynamic(
  () => import('./IntradayChartPanel').then((module) => module.MarketCandleChartPanel),
  { ssr: false, loading: () => <Skeleton className="h-[420px] w-full" /> },
);

const RANGE_LABELS: Record<HistoricalRange, string> = {
  '1d': '1D', '5d': '5D', '1m': '1M', '3m': '3M', '6m': '6M',
  ytd: 'YTD', '1y': '1Y', '3y': '3Y', '5y': '5Y',
};

interface Props {
  symbol: string;
  active: boolean;
  initialHistory?: HistoryResponse | null;
  currentPrice?: number | null;
  /** Provenance of the accepted price for the decision panel (never REAL-TIME). */
  marketLabel?: MarketDataLabel | null;
  /** Latest accepted candle from the shared market source (single source of truth). */
  liveCandle?: LiveCandle | null;
  /** Whether the shared market source is running (provider configured). */
  liveActive?: boolean;
  /** Trigger one shared-source refresh (header + candle) instead of a history reload. */
  onLiveRefresh?: () => void;
  /** Disable the shared-refresh button while the source is loading or cooling down. */
  liveRefreshDisabled?: boolean;
  /** Report the live-relevant selection (interval/session/adjusted) up so the shared source follows it. */
  onSelectionChange?: (selection: MarketSelection) => void;
  /** Report the chart's newest completed displayed bar up as the header's history-fallback price. */
  onHistoryFallbackChange?: (fallback: AcceptedPriceCandidate | null) => void;
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
  currentPrice,
  marketLabel,
  liveCandle,
  liveActive,
  onLiveRefresh,
  liveRefreshDisabled,
  onSelectionChange,
  onHistoryFallbackChange,
  technicalIndicatorsEnabled,
  advancedChartTypesEnabled,
  extendedIndicatorsEnabled,
  supportResistanceEnabled,
  fairValueEnabled,
}: Props) {
  const { addToast } = useToast();
  const [interval, setInterval] = useState<CandleInterval>('5m');
  const [range, setRange] = useState<HistoricalRange>('1d');
  const [session, setSession] = useState<MarketSessionMode>('regular');
  const [adjusted, setAdjusted] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const intraday = !['1D', 'Week', 'Month'].includes(interval);

  // Report only the live-relevant dimensions (range is a history scope, not part
  // of the live bucket). The single shared source reconfigures to follow this.
  useEffect(() => {
    onSelectionChange?.({ interval, session, adjusted });
  }, [interval, session, adjusted, onSelectionChange]);

  const applySelection = (nextInterval: CandleInterval, nextRange: HistoricalRange, changedControl: 'interval' | 'range') => {
    const next = compatibleSelection(nextInterval, nextRange, changedControl);
    setInterval(next.interval);
    setRange(next.range);
    setSelectionNotice(next.notice);
    if (next.notice) addToast({ title: 'ปรับช่วงกราฟอัตโนมัติ', message: next.notice, type: 'info' });
    if (!['1D', 'Week', 'Month'].includes(next.interval)) setAdjusted(false);
  };

  return <div className="space-y-3">
    <section aria-label="Historical range" className="rounded-xl border border-slate-800 bg-[#151B28] p-2">
      <div className="flex min-w-0 gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Historical range">
        {GATEWAY_RANGES.map((value) => <button key={value} type="button" role="tab" aria-selected={range === value} onClick={() => applySelection(interval, value, 'range')} className={`min-h-11 min-w-12 shrink-0 rounded-lg px-3 text-xs ${range === value ? 'bg-[#D4FF00] font-semibold text-black' : 'text-slate-300'}`}>{RANGE_LABELS[value]}</button>)}
      </div>
    </section>

    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-[#151B28] p-2">
      <label className="flex min-h-11 items-center gap-2 text-xs text-slate-400">Interval
        <select aria-label="Candle interval" value={interval} onChange={(event) => applySelection(event.target.value as CandleInterval, range, 'interval')} className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200">
          {GATEWAY_INTERVALS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {intraday && <select aria-label="Market session" value={session} onChange={(event) => setSession(event.target.value as MarketSessionMode)} className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200"><option value="regular">Regular session</option><option value="extended">Extended session</option></select>}
      {!intraday && <button type="button" aria-pressed={adjusted} onClick={() => setAdjusted((value) => !value)} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">{adjusted ? 'Adjusted' : 'Unadjusted'}</button>}
      <span className="ml-auto text-xs text-slate-500">{RANGE_LABELS[range]} · {interval}</span>
    </div>
    {selectionNotice && <p role="status" className="text-xs text-amber-300">{selectionNotice}</p>}

    <MarketCandleChartPanel symbol={symbol} active={active} interval={interval} range={range} session={session} adjusted={adjusted} currentPrice={currentPrice} marketLabel={marketLabel} liveCandle={liveCandle} liveActive={liveActive} onLiveRefresh={onLiveRefresh} liveRefreshDisabled={liveRefreshDisabled} onHistoryFallbackChange={onHistoryFallbackChange} technicalIndicatorsEnabled={technicalIndicatorsEnabled} advancedChartTypesEnabled={advancedChartTypesEnabled} extendedIndicatorsEnabled={extendedIndicatorsEnabled} supportResistanceEnabled={supportResistanceEnabled} fairValueEnabled={fairValueEnabled} />
  </div>;
}
