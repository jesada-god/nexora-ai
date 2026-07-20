import type { ChartActions } from './chart-types';

export function ChartControls({
  volumeVisible,
  onToggleVolume,
  supportResistanceAvailable,
  supportResistanceVisible,
  onToggleSupportResistance,
  fullscreen,
  onToggleFullscreen,
  actions,
}: {
  volumeVisible: boolean;
  onToggleVolume?: () => void;
  supportResistanceAvailable: boolean;
  supportResistanceVisible: boolean;
  onToggleSupportResistance(): void;
  fullscreen: boolean;
  onToggleFullscreen(): void;
  actions: ChartActions | null;
}) {
  return <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-[#151B28]/80 p-2">
    {onToggleVolume && <button type="button" aria-pressed={volumeVisible} onClick={onToggleVolume} className={`min-h-11 rounded-lg border px-3 text-xs ${volumeVisible ? 'border-[#D4FF00] text-[#D4FF00]' : 'border-slate-700 text-slate-300'}`}>Volume</button>}
    {supportResistanceAvailable && <button type="button" aria-pressed={supportResistanceVisible} onClick={onToggleSupportResistance} className={`min-h-11 rounded-lg border px-3 text-xs ${supportResistanceVisible ? 'border-emerald-400 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>S/R</button>}
    <span className="hidden text-[10px] text-slate-500 sm:inline">drag · wheel/pinch zoom · native crosshair</span>
    <div className="ml-auto flex gap-2"><button type="button" onClick={() => actions?.fitContent()} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">Fit</button><button type="button" onClick={() => actions?.reset()} className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">Reset</button><button type="button" onClick={onToggleFullscreen} className="min-h-11 rounded-lg bg-slate-800 px-3 text-xs text-white">{fullscreen ? 'Exit full screen' : 'Full screen'}</button></div>
  </div>;
}

