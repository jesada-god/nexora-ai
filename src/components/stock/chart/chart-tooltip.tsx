import type { ChartBar, ChartTooltipContext } from './chart-types';

const price = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function ChartTooltip({ bar, context }: { bar: ChartBar; context: ChartTooltipContext }) {
  const change = bar.rawClose - bar.rawOpen;
  const percent = bar.rawOpen === 0 ? null : (change / bar.rawOpen) * 100;
  const timestamp = new Intl.DateTimeFormat('en-US', {
    timeZone: context.timezone ?? 'UTC', year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(Number(bar.time) * 1_000));
  return <div className="pointer-events-none w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-slate-700 bg-[#101621]/95 p-3 text-xs text-slate-200 shadow-xl">
    <p className="mb-2 font-semibold">{timestamp}</p>
    <div className="grid grid-cols-2 gap-1 font-mono sm:grid-cols-4"><span>O {price(bar.rawOpen)}</span><span>H {price(bar.rawHigh)}</span><span>L {price(bar.rawLow)}</span><span>C {price(bar.rawClose)}</span></div>
    <div className="mt-2 grid grid-cols-2 gap-1 text-slate-400"><span>Change {change >= 0 ? '+' : ''}{price(change)}</span><span>Change % {percent == null ? '—' : `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`}</span><span>Volume {bar.volume.toLocaleString('en-US')}</span><span>Partial {bar.partial ? 'yes' : 'no'}</span>{bar.transactions !== undefined && <span>Transactions {bar.transactions.toLocaleString('en-US')}</span>}{bar.vwap !== undefined && <span>VWAP {price(bar.vwap)}</span>}</div>
    <p className="mt-2 text-slate-500">{context.provider ?? 'Provider unavailable'} · {context.range ?? '—'} / {context.interval ?? '—'} · {context.dataStatus ?? 'unknown'}</p>
  </div>;
}

