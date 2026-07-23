'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Modal } from '@/src/components/ui/Modal';
import type {
  DataFreshness,
  MarketDataApiError,
  Quote,
} from '@/src/lib/market-data/types';
import type { FxQuote } from '@/src/lib/market-data/fx/types';
import { formatMarketDataAsOf } from '@/src/lib/presentation/datetime';
import { stockDetailErrorMessage } from '@/src/lib/stock-detail/error-presentation';
import {
  calculatePriceChange,
  connectionStatusPresentation,
  convertUsdForDisplay,
  dataStatusPresentation,
  deriveMarketSession,
  marketSessionPresentation,
  priceDirectionPresentation,
  priceFlashDirection,
  resolveDataStatus,
  type PriceDirection,
  type PriceDisplayCurrency,
} from './price-header';
import type { ConnectionStatus } from '@/src/lib/stock-detail/market-source';

interface MarketSummary {
  currentStatus: 'pre-market' | 'open' | 'after-hours' | 'closed' | 'holiday' | 'early-close' | 'unknown';
  notes: string | null;
}

export interface ExtendedHoursQuote {
  session: 'premarket' | 'after-hours';
  price: number;
  asOf: string;
  freshness: DataFreshness;
  provider: string;
}

interface StockPriceHeaderProps {
  symbol: string;
  exchange: string | null;
  sourceCurrency: string | null;
  quote: Quote | null;
  freshness: DataFreshness;
  market: MarketSummary | null;
  provider: string | null;
  providerConfigured: boolean;
  quoteError: MarketDataApiError | null;
  fallbackLabel: 'Previous trading day' | 'Intraday close fallback' | null;
  quoteLoading: boolean;
  quoteRetryAt: number;
  onRetryQuote: () => void;
  fxQuote: FxQuote | null;
  evaluatedAt: string;
  extendedQuote?: ExtendedHoursQuote | null;
  /** True only for a genuine live entitled stream; gates the Real-time badge. */
  realtime?: boolean;
  /** Upstream feed id, e.g. `iex`. The badge names the feed (IEX ≠ consolidated SIP). */
  feed?: string | null;
  /** Top-of-book from the live stream, shown separately from Last Price. */
  bid?: number | null;
  ask?: number | null;
  bidSize?: number | null;
  askSize?: number | null;
  /** Per-symbol trading halt, independent of the market-wide session. */
  symbolHalted?: boolean;
  haltReason?: string | null;
  /**
   * Live-connection lifecycle from the WS coordinator. Status indicator only — it
   * never affects the accepted price, timestamp, session or freshness. `null` on a
   * REST-only deployment, which therefore never shows a "reconnecting" pill.
   */
  connectionState?: ConnectionStatus | null;
}

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatNumber(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'ไม่พบข้อมูล' : numberFormatter.format(value);
}

function formatSigned(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'ไม่พบข้อมูล';
  const formatted = numberFormatter.format(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'ไม่พบข้อมูล';
  const formatted = Math.abs(value).toFixed(2);
  return value > 0 ? `(+${formatted}%)` : value < 0 ? `(-${formatted}%)` : `(${formatted}%)`;
}

function formatProviderTimestamp(value: string | null, dateOnly = false): string {
  if (!value) return 'ไม่ทราบเวลาข้อมูล';
  // Intraday values show HH:mm:ss so a live timestamp visibly advances per tick;
  // `withSeconds` is ignored on the date-only path.
  const formatted = formatMarketDataAsOf(value, { dateOnly, withSeconds: true });
  return formatted === '—' ? 'ไม่ทราบเวลาข้อมูล' : formatted;
}

function directionClass(direction: PriceDirection | null): string {
  if (direction && priceDirectionPresentation(direction).tone === 'positive') return 'text-positive';
  if (direction && priceDirectionPresentation(direction).tone === 'negative') return 'text-negative';
  return 'text-text-muted';
}

function directionMark(direction: PriceDirection | null): string | null {
  return direction ? priceDirectionPresentation(direction).arrow : null;
}

function flashClass(direction: PriceDirection | null): string {
  return direction === 'up' ? 'price-flash-up' : direction === 'down' ? 'price-flash-down' : '';
}

/**
 * Tracks the last accepted USD price and, whenever a new tick moves it, returns a
 * flash direction plus a monotonically increasing `nonce`. The nonce is used as a
 * React `key` on the flashing element so the CSS animation replays on every move.
 * Keying on the currency-independent USD price means a USD/THB toggle never
 * flashes — only a genuine market move does. Reduced motion is honored by the
 * global CSS that caps animation-duration.
 */
function usePriceFlash(value: number | null): { direction: PriceDirection | null; nonce: number } {
  const previousRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<{ direction: PriceDirection | null; nonce: number }>({
    direction: null,
    nonce: 0,
  });
  useEffect(() => {
    const direction = priceFlashDirection(previousRef.current, value);
    if (value !== null && Number.isFinite(value) && value > 0) previousRef.current = value;
    if (direction) setFlash((current) => ({ direction, nonce: current.nonce + 1 }));
  }, [value]);
  return flash;
}

function StatusEmoji({ value }: { value: string }) {
  return <span aria-hidden="true" className="shrink-0">{value}</span>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[9rem_1fr]"><dt className="text-text-muted">{label}</dt><dd className="min-w-0 break-words text-text-main">{value}</dd></div>;
}

export function StockPriceHeader({
  symbol,
  exchange,
  sourceCurrency,
  quote,
  freshness,
  market,
  provider,
  providerConfigured,
  quoteError,
  fallbackLabel,
  quoteLoading,
  quoteRetryAt,
  onRetryQuote,
  fxQuote,
  evaluatedAt,
  extendedQuote = null,
  realtime = false,
  feed = null,
  bid = null,
  ask = null,
  bidSize = null,
  askSize = null,
  symbolHalted = false,
  haltReason = null,
  connectionState = null,
}: StockPriceHeaderProps) {
  const [currency, setCurrency] = useState<PriceDisplayCurrency>('USD');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const normalizedSourceCurrency = sourceCurrency?.toUpperCase() ?? null;
  const verifiedUsdSource = normalizedSourceCurrency === 'USD';
  const fxRate = fxQuote ? Number(fxQuote.rate) : null;
  const selectedCurrency = verifiedUsdSource ? currency : 'USD';
  const displayedCurrency = verifiedUsdSource ? selectedCurrency : normalizedSourceCurrency ?? 'ไม่ทราบสกุลเงิน';
  const regularPrice = quote && Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
  const regularChange = calculatePriceChange(regularPrice, quote?.previousClose);
  const displayPrice = regularPrice !== null
    ? verifiedUsdSource
      ? convertUsdForDisplay(regularPrice, selectedCurrency, fxRate)
      : regularPrice
    : null;
  const displayChange = regularChange
    ? verifiedUsdSource
      ? convertUsdForDisplay(regularChange.amount, selectedCurrency, fxRate)
      : regularChange.amount
    : null;
  const extendedChange = extendedQuote ? calculatePriceChange(extendedQuote.price, regularPrice) : null;
  const displayExtendedPrice = extendedQuote
    ? verifiedUsdSource
      ? convertUsdForDisplay(extendedQuote.price, selectedCurrency, fxRate)
      : extendedQuote.price
    : null;
  const displayExtendedChange = extendedChange
    ? verifiedUsdSource
      ? convertUsdForDisplay(extendedChange.amount, selectedCurrency, fxRate)
      : extendedChange.amount
    : null;
  const session = deriveMarketSession(market, extendedChange ? extendedQuote?.session : null);
  const sessionView = marketSessionPresentation(session);
  const dataStatus = regularPrice === null ? 'unavailable' : resolveDataStatus(freshness, Date.parse(evaluatedAt));
  const dataStatusView = dataStatusPresentation(dataStatus);
  const extendedDataStatusView = extendedQuote && extendedChange
    ? dataStatusPresentation(resolveDataStatus(extendedQuote.freshness, Date.parse(evaluatedAt)))
    : null;
  const changeDirection = regularChange?.direction ?? null;
  const extendedDirection = extendedChange?.direction ?? null;
  // Flash the price on a real move only (keyed on the source USD value, so a
  // USD/THB toggle never flashes). Reduced motion is handled by global CSS.
  const priceFlash = usePriceFlash(regularPrice);
  const extendedFlash = usePriceFlash(extendedQuote?.price ?? null);
  const thbUnavailable = !verifiedUsdSource || fxRate === null || !Number.isFinite(fxRate) || fxRate <= 0;
  const quoteCoolingDown = quoteRetryAt > 0;
  const quoteDate = quote?.latestTradingDay ?? null;
  const displayedQuoteAsOf = quoteDate ?? freshness.asOf;
  const combinedStatus = market
    ? `${sessionView.label} · ${dataStatusView.label}`
    : 'ไม่สามารถตรวจสอบสถานะตลาดได้';
  // Real-time badge is gated on the truthful `realtime` flag (a genuine live
  // feed), never on the data-status heuristic alone.
  const feedLabel = feed ? feed.toUpperCase() : null;
  const showRealtime = realtime && regularPrice !== null && feedLabel !== null;
  // Status-only view of the live socket. Never derives price/freshness — it is
  // rendered ALONGSIDE the existing status, never replacing it.
  const connectionView = connectionStatusPresentation(connectionState);
  const displayBid = bid != null && verifiedUsdSource ? convertUsdForDisplay(bid, selectedCurrency, fxRate) : bid;
  const displayAsk = ask != null && verifiedUsdSource ? convertUsdForDisplay(ask, selectedCurrency, fxRate) : ask;
  const showBook = displayBid != null && Number.isFinite(displayBid) && displayAsk != null && Number.isFinite(displayAsk);

  return <>
    <section className="min-h-40 min-w-0 overflow-hidden rounded-2xl border border-border bg-bg-card p-4 shadow-xl sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono tabular-nums">
            <p
              key={priceFlash.nonce}
              className={displayPrice === null
                ? 'max-w-full break-words font-sans text-2xl font-bold leading-tight tracking-tight text-text-main [overflow-wrap:anywhere] sm:text-3xl'
                : `max-w-full break-words rounded-md px-1.5 -mx-1.5 text-[clamp(2rem,11vw,3rem)] font-bold leading-none tracking-tight text-text-main [overflow-wrap:anywhere] ${flashClass(priceFlash.direction)}`}>
              {displayPrice === null ? 'ไม่พบราคาล่าสุด' : formatNumber(displayPrice)}
            </p>
            {regularChange && <div className={`flex min-w-0 flex-wrap items-baseline gap-x-2 text-base font-semibold sm:text-lg ${directionClass(changeDirection)}`}>
              <span className="break-words [overflow-wrap:anywhere]">{formatSigned(displayChange)}</span>
              <span className="break-words [overflow-wrap:anywhere]">{formatPercent(regularChange.percent)}</span>
              {directionMark(changeDirection) && <span aria-label={changeDirection === 'up' ? 'ราคาเพิ่มขึ้น' : 'ราคาลดลง'}>{directionMark(changeDirection)}</span>}
            </div>}
            <span className="text-sm font-semibold text-text-muted">{displayedCurrency}</span>
          </div>

          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            {fallbackLabel && <span className="text-amber-300">{fallbackLabel === 'Intraday close fallback' ? 'ราคาปิด intraday ล่าสุด (fallback)' : 'ข้อมูลจากวันซื้อขายก่อนหน้า'}</span>}
            {fallbackLabel && <span aria-hidden="true">·</span>}
            <span>{formatProviderTimestamp(displayedQuoteAsOf, Boolean(quoteDate))}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <StatusEmoji value={market ? sessionView.emoji : '⚠️'}/>
              <span>{combinedStatus}</span>
            </span>
            {showRealtime && <>
              <span aria-hidden="true">·</span>
              <span
                title={`ข้อมูลเรียลไทม์จากฟีด ${feedLabel} — IEX เป็นตลาดเดียว ไม่ใช่ราคารวมทุกตลาด (consolidated SIP)`}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true"/>
                Real-time · {feedLabel}
              </span>
            </>}
            {symbolHalted && <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300">
                ⏸️ ระงับการซื้อขาย{haltReason ? ` · ${haltReason}` : ''}
              </span>
            </>}
            {connectionView.kind === 'reconnecting' && <>
              <span aria-hidden="true">·</span>
              {/* Reassures the user while the socket recovers; the last accepted
                  price above is untouched. Reduced motion caps the spin globally. */}
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300"
              >
                <span
                  className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-amber-300/40 border-t-amber-300"
                  aria-hidden="true"
                />
                {connectionView.label}
              </span>
            </>}
            {connectionView.kind === 'error' && <>
              <span aria-hidden="true">·</span>
              {/* Degraded/offline: shown next to the existing freshness badge, which
                  continues to reflect the (delayed/cached) data honestly. */}
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300"
              >
                <StatusEmoji value="⚠️"/>
                {connectionView.label}
              </span>
            </>}
          </div>

          {showBook && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm tabular-nums">
            <span className="inline-flex items-baseline gap-1">
              <span className="text-xs uppercase tracking-wide text-text-muted">Bid</span>
              <span className="text-text-main">{formatNumber(displayBid)}</span>
              {bidSize != null && <span className="text-xs text-text-muted">× {bidSize}</span>}
            </span>
            <span className="inline-flex items-baseline gap-1">
              <span className="text-xs uppercase tracking-wide text-text-muted">Ask</span>
              <span className="text-text-main">{formatNumber(displayAsk)}</span>
              {askSize != null && <span className="text-xs text-text-muted">× {askSize}</span>}
            </span>
          </div>}
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-bg-base p-1">
          {verifiedUsdSource && (['USD', 'THB'] as const).map((item) => <button
            key={item}
            type="button"
            aria-pressed={currency === item}
            onClick={() => setCurrency(item)}
            className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${currency === item ? 'bg-primary text-black' : 'text-text-muted hover:text-text-main'}`}
          >{item}</button>)}
          {!verifiedUsdSource && <span className="px-3 text-xs font-semibold text-text-muted">{displayedCurrency}</span>}
          <button
            type="button"
            aria-label="ดูรายละเอียดราคา"
            aria-haspopup="dialog"
            onClick={() => setDetailsOpen(true)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text-muted hover:text-text-main"
          ><Info aria-hidden="true" size={18}/></button>
        </div>
      </div>

      {currency === 'THB' && thbUnavailable && <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-300">ไม่มีอัตรา USD/THB จริงที่ตรวจสอบได้</p>}

      {extendedQuote && extendedChange && displayExtendedPrice !== null && displayExtendedChange !== null && <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-3 font-mono text-sm tabular-nums">
        <span className="inline-flex items-center gap-1.5 font-sans font-semibold text-text-main">
          <StatusEmoji value={marketSessionPresentation(extendedQuote.session).emoji}/>
          {marketSessionPresentation(extendedQuote.session).label}
        </span>
        <span key={extendedFlash.nonce} className={`break-all rounded px-1 -mx-1 text-text-main ${flashClass(extendedFlash.direction)}`}>{formatNumber(displayExtendedPrice)} {displayedCurrency}</span>
        <span className={`break-all ${directionClass(extendedDirection)}`}>{formatSigned(displayExtendedChange)} {formatPercent(extendedChange.percent)} {directionMark(extendedDirection)}</span>
        <span className="text-text-muted">{formatProviderTimestamp(extendedQuote.asOf, extendedQuote.freshness.status === 'end-of-day')}</span>
        {extendedDataStatusView && <span className="inline-flex items-center gap-1.5 text-text-muted">{extendedDataStatusView.emoji && <StatusEmoji value={extendedDataStatusView.emoji}/>} {extendedDataStatusView.label}</span>}
      </div>}

      {regularPrice === null && <div className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-base/60 p-3 text-sm text-amber-300"><p className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{stockDetailErrorMessage(quoteError, 'quote', providerConfigured)}</p><button type="button" disabled={quoteLoading || quoteCoolingDown} onClick={onRetryQuote} className="min-h-11 shrink-0 rounded-lg border border-amber-400/30 px-3 text-xs disabled:opacity-50">{quoteLoading ? 'กำลังโหลด…' : quoteCoolingDown ? 'รอตามระยะเวลาที่กำหนดแล้วลองอีกครั้ง' : 'ลองโหลดราคาอีกครั้ง'}</button></div>}
    </section>

    <Modal isOpen={detailsOpen} onClose={() => setDetailsOpen(false)} title="รายละเอียดราคา">
      <dl className="text-sm">
        <Detail label="Provider" value={provider ?? 'ไม่พบข้อมูล'}/>
        <Detail label="Symbol" value={symbol}/>
        <Detail label="Exchange" value={exchange ?? 'ไม่พบข้อมูล'}/>
        <Detail label="Session" value={combinedStatus}/>
        <Detail label="Regular Price" value={`${formatNumber(regularPrice)} ${normalizedSourceCurrency ?? 'ไม่ทราบสกุลเงิน'}`}/>
        {!fallbackLabel && <Detail label="Previous Close" value={`${formatNumber(quote?.previousClose ?? null)} ${normalizedSourceCurrency ?? 'ไม่ทราบสกุลเงิน'}`}/>}
        {extendedQuote && extendedChange && <Detail label="Extended Price" value={`${formatNumber(extendedQuote.price)} ${normalizedSourceCurrency ?? 'ไม่ทราบสกุลเงิน'} · ${extendedQuote.provider}`}/>}
        {!fallbackLabel && <Detail label="Comparison Base" value={extendedQuote && extendedChange ? 'Official Regular Close' : 'Previous Close'}/>}
        <Detail label="Display Currency" value={displayedCurrency}/>
        <Detail
          label={quoteDate ? 'Trading date' : 'Timestamp'}
          value={`${displayedQuoteAsOf ?? 'ไม่พบข้อมูล'} (${formatProviderTimestamp(displayedQuoteAsOf, Boolean(quoteDate))})`}
        />
        <Detail label="Display Timezone" value="Asia/Bangkok; ข้อมูลแบบ date-only แสดงเฉพาะวันที่"/>
        <Detail label="Data Status" value={dataStatusView.label}/>
        <Detail label="Delay Duration" value="Provider ไม่ได้ระบุ"/>
        {selectedCurrency === 'THB' && <Detail label="FX" value={fxQuote ? `1 USD = ${fxQuote.rate} THB · ${fxQuote.source} · ณ ${fxQuote.asOf}${fxQuote.stale ? ' · ข้อมูลเก่า' : fxQuote.cached ? ' · ข้อมูลแคช' : ''}` : 'ไม่พบข้อมูล'}/>}
      </dl>
      <div className="mt-4 space-y-2 rounded-xl border border-border bg-bg-base/60 p-3 text-xs leading-5 text-text-muted">
        <p>Previous Close ยังใช้เป็นฐานคำนวณ Daily Change แม้ไม่ได้แสดงในการ์ด Overview</p>
        {extendedQuote && extendedChange && <p>ราคาช่วง Extended Hours เปรียบเทียบกับราคาปิดของ Regular Session ล่าสุด</p>}
      </div>
    </Modal>
  </>;
}
