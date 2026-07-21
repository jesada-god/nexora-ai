import type { AvwapAnchorPreset } from '@/src/lib/analytics/institutional-sr';
import type { OptionsReliability } from '@/src/lib/analytics/options-sr';
import type { ChartActions } from './chart-types';

/** Independent, locally-persisted institutional overlay controls (no market request on toggle). */
export interface InstitutionalControls {
  /** D1 zones are only meaningful on the daily interval; the toggle disables otherwise. */
  zonesAvailable: boolean;
  zonesVisible: boolean;
  onToggleZones(): void;
  volumeProfileVisible: boolean;
  onToggleVolumeProfile(): void;
  anchoredVwapVisible: boolean;
  onToggleAnchoredVwap(): void;
  anchorPreset: AvwapAnchorPreset;
  onAnchorPresetChange(preset: AvwapAnchorPreset): void;
}

/**
 * Options-Driven S/R controls. Independent of the institutional overlays (item
 * 14). Unlike those, enabling this lazily loads options data; the expiration
 * selector and status reflect that load (items 16, 19, 20).
 */
export interface OptionsSrControls {
  /** True only for a real ticker (never the standalone 'chart' placeholder). */
  available: boolean;
  visible: boolean;
  onToggle(): void;
  loading: boolean;
  expirations: string[];
  selectedExpiration: string | null;
  onExpirationChange(expiration: string): void;
  reliability: OptionsReliability | null;
  dataMode: string | null;
  /** Human-facing typed reason when the computation is unavailable. */
  statusReason: string | null;
}

const OPTIONS_REASON_LABELS: Record<string, string> = {
  'entitlement-required': 'Options entitlement required',
  'no-expirations': 'No expirations available',
  'chain-unavailable': 'Options chain unavailable',
  'insufficient-coverage': 'Insufficient chain coverage',
  stale: 'Options data is stale',
  'rate-limited': 'Rate limited — retry shortly',
  'no-open-interest': 'No open interest returned',
  'expired-expiration': 'Expiration has expired',
  'no-accepted-price': 'No accepted price',
};

const ANCHOR_LABELS: Record<AvwapAnchorPreset, string> = {
  'latest-swing-low': 'Swing low',
  'latest-swing-high': 'Swing high',
  'earliest-visible': 'Earliest visible',
};

function toggleClass(active: boolean, accent: string): string {
  return `min-h-11 min-w-11 rounded-lg border px-3 text-xs ${active ? accent : 'border-slate-700 text-slate-300'}`;
}

export function ChartControls({
  volumeVisible,
  onToggleVolume,
  supportResistanceAvailable,
  supportResistanceVisible,
  onToggleSupportResistance,
  institutional,
  optionsSr,
  fullscreen,
  onToggleFullscreen,
  actions,
}: {
  volumeVisible: boolean;
  onToggleVolume?: () => void;
  supportResistanceAvailable: boolean;
  supportResistanceVisible: boolean;
  onToggleSupportResistance(): void;
  institutional?: InstitutionalControls;
  optionsSr?: OptionsSrControls;
  fullscreen: boolean;
  onToggleFullscreen(): void;
  actions: ChartActions | null;
}) {
  return <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-[#151B28]/80 p-2">
    {onToggleVolume && <button type="button" aria-pressed={volumeVisible} onClick={onToggleVolume} className={`min-h-11 rounded-lg border px-3 text-xs ${volumeVisible ? 'border-[#D4FF00] text-[#D4FF00]' : 'border-slate-700 text-slate-300'}`}>Volume</button>}
    {supportResistanceAvailable && <button type="button" aria-pressed={supportResistanceVisible} onClick={onToggleSupportResistance} className={`min-h-11 rounded-lg border px-3 text-xs ${supportResistanceVisible ? 'border-emerald-400 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>S/R</button>}
    {institutional && <>
      <button type="button" aria-pressed={institutional.zonesVisible} disabled={!institutional.zonesAvailable} onClick={institutional.onToggleZones} title={institutional.zonesAvailable ? 'Institutional demand/supply zones (1D)' : 'D1 zones require the 1D interval'} className={`${toggleClass(institutional.zonesVisible && institutional.zonesAvailable, 'border-emerald-400 text-emerald-300')} disabled:opacity-40`}>Zones</button>
      <button type="button" aria-pressed={institutional.volumeProfileVisible} onClick={institutional.onToggleVolumeProfile} title="Visible-range volume profile (POC/VAH/VAL)" className={toggleClass(institutional.volumeProfileVisible, 'border-[#D4FF00] text-[#D4FF00]')}>Vol Profile</button>
      <button type="button" aria-pressed={institutional.anchoredVwapVisible} onClick={institutional.onToggleAnchoredVwap} title="Anchored VWAP" className={toggleClass(institutional.anchoredVwapVisible, 'border-sky-400 text-sky-300')}>AVWAP</button>
      {institutional.anchoredVwapVisible && <label className="flex min-h-11 items-center gap-1 text-[10px] text-slate-400">Anchor
        <select aria-label="Anchored VWAP anchor" value={institutional.anchorPreset} onChange={(event) => institutional.onAnchorPresetChange(event.target.value as AvwapAnchorPreset)} className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200">
          {(Object.keys(ANCHOR_LABELS) as AvwapAnchorPreset[]).map((preset) => <option key={preset} value={preset}>{ANCHOR_LABELS[preset]}</option>)}
        </select>
      </label>}
    </>}
    {optionsSr?.available && <>
      <button type="button" aria-pressed={optionsSr.visible} onClick={optionsSr.onToggle} title="Options-derived reference levels (Call Wall, Put Wall, Max Pain)" className={toggleClass(optionsSr.visible, 'border-fuchsia-400 text-fuchsia-300')}>Options S/R</button>
      {optionsSr.visible && optionsSr.expirations.length > 0 && <label className="flex min-h-11 items-center gap-1 text-[10px] text-slate-400">Expiry
        <select aria-label="Options expiration" value={optionsSr.selectedExpiration ?? ''} onChange={(event) => optionsSr.onExpirationChange(event.target.value)} className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200">
          {optionsSr.expirations.map((expiration) => <option key={expiration} value={expiration}>{expiration}</option>)}
        </select>
      </label>}
      {optionsSr.visible && optionsSr.loading && <span role="status" className="text-[10px] text-slate-400">Loading options…</span>}
      {optionsSr.visible && !optionsSr.loading && optionsSr.statusReason && <span role="status" className="text-[10px] text-amber-300">{OPTIONS_REASON_LABELS[optionsSr.statusReason] ?? 'Options S/R unavailable'}</span>}
      {optionsSr.visible && !optionsSr.loading && !optionsSr.statusReason && optionsSr.reliability && <span className="text-[10px] text-slate-400">{optionsSr.dataMode ?? 'DELAYED'} · reliability {optionsSr.reliability}</span>}
    </>}
    <span className="hidden text-[10px] text-slate-500 sm:inline">drag · wheel/pinch zoom · native crosshair</span>
    <div className="ml-auto flex gap-2"><button type="button" onClick={() => actions?.fitContent()} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">Fit</button><button type="button" onClick={() => actions?.reset()} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">Reset</button><button type="button" onClick={onToggleFullscreen} className="min-h-11 rounded-lg bg-slate-800 px-3 text-xs text-white">{fullscreen ? 'Exit full screen' : 'Full screen'}</button></div>
  </div>;
}
