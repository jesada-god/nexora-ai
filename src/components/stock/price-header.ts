import type { DataFreshness } from '@/src/lib/market-data/types';

export type MarketSession = 'halted' | 'holiday' | 'early-close' | 'premarket' | 'open' | 'after-hours' | 'closed' | 'unknown';
export type PriceDirection = 'up' | 'down' | 'neutral';
export type PriceDisplayCurrency = 'USD' | 'THB';
export type PriceDataStatus = 'live' | 'delayed' | 'cached' | 'stale' | 'unknown' | 'unavailable';

export interface MarketSessionSignals {
  halted?: boolean;
  holiday?: boolean;
  earlyClose?: boolean;
  premarket?: boolean;
  regularOpen?: boolean;
  afterHours?: boolean;
  closed?: boolean;
}

export interface PriceChange {
  amount: number;
  percent: number;
  direction: PriceDirection;
}

export interface PriceCurrencyInput {
  profileCurrency: string | null | undefined;
  quoteCurrency: string | null | undefined;
  instrumentCurrency: string | null | undefined;
  exchange: string | null | undefined;
}

export interface ResolvedPriceCurrency {
  currency: string | null;
  source: 'profile' | 'quote' | 'instrument' | 'exchange' | null;
}

const TRUSTED_EXCHANGE_CURRENCIES: Record<string, string> = {
  AMEX: 'USD',
  CBOE: 'USD',
  IEX: 'USD',
  NASDAQ: 'USD',
  NYSE: 'USD',
  'NYSE AMERICAN': 'USD',
  'NYSE ARCA': 'USD',
  'NYSE MKT': 'USD',
  MAI: 'THB',
  SET: 'THB',
  'STOCK EXCHANGE OF THAILAND': 'THB',
};

const MARKET_SESSION_PRESENTATION: Record<MarketSession, { emoji: string; label: string; fullName: string }> = {
  'early-close': { emoji: '⏱️', label: 'ตลาดปิดเร็ว', fullName: 'Early Close Session' },
  halted: { emoji: '⏸️', label: 'ระงับการซื้อขาย', fullName: 'Trading Halt / Symbol Halted' },
  holiday: { emoji: '📅', label: 'วันหยุดตลาด', fullName: 'Market Holiday' },
  premarket: { emoji: '🌅', label: 'ก่อนตลาดเปิด', fullName: 'Pre-market Session' },
  open: { emoji: '☀️', label: 'ตลาดเปิด', fullName: 'Regular Market Session' },
  'after-hours': { emoji: '🌇', label: 'หลังเวลาทำการ', fullName: 'After-hours / Post-market Session' },
  closed: { emoji: '🌙', label: 'ปิดตลาด', fullName: 'Market Closed' },
  unknown: { emoji: '⚠️', label: 'ไม่ทราบสถานะตลาด', fullName: 'Unknown Market Session' },
};

const DATA_STATUS_PRESENTATION: Record<PriceDataStatus, { emoji: string | null; label: string }> = {
  live: { emoji: null, label: 'ข้อมูลสด' },
  delayed: { emoji: '⏱️', label: 'ข้อมูลล่าช้า' },
  cached: { emoji: '💾', label: 'ข้อมูลแคช' },
  stale: { emoji: '🕒', label: 'ข้อมูลเก่า' },
  unknown: { emoji: null, label: 'ไม่ทราบความสดของข้อมูล' },
  unavailable: { emoji: '⚠️', label: 'ไม่มีข้อมูลราคา' },
};

const PRICE_DIRECTION_PRESENTATION: Record<PriceDirection, { sign: '+' | '-' | ''; arrow: '▲' | '▼' | null; tone: 'positive' | 'negative' | 'neutral' }> = {
  up: { sign: '+', arrow: '▲', tone: 'positive' },
  down: { sign: '-', arrow: '▼', tone: 'negative' },
  neutral: { sign: '', arrow: null, tone: 'neutral' },
};

export function resolveMarketSession(signals: MarketSessionSignals): MarketSession {
  if (signals.halted) return 'halted';
  if (signals.holiday) return 'holiday';
  if (signals.earlyClose) return 'early-close';
  if (signals.premarket) return 'premarket';
  if (signals.regularOpen) return 'open';
  if (signals.afterHours) return 'after-hours';
  if (signals.closed) return 'closed';
  return 'unknown';
}

export function deriveMarketSession(
  market: { currentStatus: 'pre-market' | 'open' | 'after-hours' | 'closed' | 'holiday' | 'early-close' | 'unknown'; notes: string | null } | null | undefined,
  extendedSession?: 'premarket' | 'after-hours' | null,
): MarketSession {
  const notes = market?.notes?.toLowerCase() ?? '';
  return resolveMarketSession({
    halted: /\b(halt(?:ed)?|suspend(?:ed)?)\b/.test(notes),
    holiday: market?.currentStatus === 'holiday' || /\bholiday\b/.test(notes),
    earlyClose: market?.currentStatus === 'early-close' || /\bearly[- ]?close\b/.test(notes),
    premarket: market?.currentStatus === 'pre-market' || extendedSession === 'premarket' || /\bpre-?market\b/.test(notes),
    regularOpen: market?.currentStatus === 'open',
    afterHours: market?.currentStatus === 'after-hours' || extendedSession === 'after-hours' || /\b(after[- ]?hours|post[- ]?market)\b/.test(notes),
    closed: market?.currentStatus === 'closed',
  });
}

export function marketSessionPresentation(session: MarketSession) {
  return MARKET_SESSION_PRESENTATION[session];
}

export function resolveDataStatus(freshness: DataFreshness, evaluatedAtMs: number): PriceDataStatus {
  if (freshness.status === 'unavailable') return 'unavailable';
  if (freshness.status === 'stale') return 'stale';

  const asOfMs = freshness.asOf ? Date.parse(freshness.asOf) : Number.NaN;
  if (
    Number.isFinite(evaluatedAtMs)
    && Number.isFinite(asOfMs)
    && freshness.maxAgeSeconds !== null
    && evaluatedAtMs - asOfMs > freshness.maxAgeSeconds * 1000
  ) {
    return 'stale';
  }

  if (freshness.status === 'realtime') return 'live';
  if (freshness.status === 'delayed' || freshness.status === 'end-of-day') return 'delayed';
  if (freshness.status === 'cached') return 'cached';
  return 'unknown';
}

export function dataStatusPresentation(status: PriceDataStatus) {
  return DATA_STATUS_PRESENTATION[status];
}

export function priceDirectionPresentation(direction: PriceDirection) {
  return PRICE_DIRECTION_PRESENTATION[direction];
}

function normalizedCurrency(value: string | null | undefined): string | null {
  const currency = value?.trim().toUpperCase() ?? '';
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function normalizedExchange(value: string | null | undefined): string {
  return value?.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toUpperCase() ?? '';
}

export function resolvePriceCurrency(input: PriceCurrencyInput): ResolvedPriceCurrency {
  const candidates = [
    ['profile', normalizedCurrency(input.profileCurrency)],
    ['quote', normalizedCurrency(input.quoteCurrency)],
    ['instrument', normalizedCurrency(input.instrumentCurrency)],
  ] as const;
  for (const [source, currency] of candidates) {
    if (currency) return { currency, source };
  }

  const currency = TRUSTED_EXCHANGE_CURRENCIES[normalizedExchange(input.exchange)] ?? null;
  return currency
    ? { currency, source: 'exchange' }
    : { currency: null, source: null };
}

export function calculatePriceChange(price: number | null | undefined, comparisonBase: number | null | undefined): PriceChange | null {
  if (
    price === null
    || price === undefined
    || comparisonBase === null
    || comparisonBase === undefined
    || !Number.isFinite(price)
    || !Number.isFinite(comparisonBase)
    || price <= 0
    || comparisonBase <= 0
  ) {
    return null;
  }

  const amount = price - comparisonBase;
  const percent = (amount / comparisonBase) * 100;
  if (!Number.isFinite(amount) || !Number.isFinite(percent)) return null;
  return {
    amount,
    percent,
    direction: amount > 0 ? 'up' : amount < 0 ? 'down' : 'neutral',
  };
}

export function convertUsdForDisplay(
  valueUsd: number | null | undefined,
  currency: PriceDisplayCurrency,
  usdThbRate: number | null,
): number | null {
  if (valueUsd === null || valueUsd === undefined || !Number.isFinite(valueUsd)) return null;
  if (currency === 'USD') return valueUsd;
  if (usdThbRate === null || !Number.isFinite(usdThbRate) || usdThbRate <= 0) return null;
  const converted = valueUsd * usdThbRate;
  return Number.isFinite(converted) ? converted : null;
}
