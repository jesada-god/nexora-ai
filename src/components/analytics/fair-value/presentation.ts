import type {
  FairValueAvailable,
  FairValueFailureKind,
  ModelId,
} from '@/src/lib/analytics/valuation/types';

export type DisplayCurrency = 'USD' | 'THB';
export type UpsideTone = 'success' | 'danger' | 'neutral';

const MODEL_LABELS: Record<ModelId | 'blended', string> = {
  'fcff-dcf': 'DCF',
  fcfe: 'FCFE',
  ddm: 'DDM',
  relative: 'Relative',
  'asset-based': 'Asset',
  'ev-sales': 'EV/Sales',
  'ev-ebitda': 'EV/EBITDA',
  pe: 'P/E',
  peg: 'PEG',
  pb: 'P/B',
  blended: 'Blended',
};

export function modelLabel(model: ModelId | 'blended'): string {
  return MODEL_LABELS[model];
}

export function convertUsdForDisplay(valueUsd: number, currency: DisplayCurrency, usdThbRate: number | null): number | null {
  if (!Number.isFinite(valueUsd)) return null;
  if (currency === 'USD') return valueUsd;
  return usdThbRate && Number.isFinite(usdThbRate) && usdThbRate > 0 ? valueUsd * usdThbRate : null;
}

export function formatFairValueMoney(value: number | null, currency: DisplayCurrency): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function upsideTone(percent: number | null): UpsideTone {
  if (percent == null || !Number.isFinite(percent) || Math.abs(percent) < 0.005) return 'neutral';
  return percent > 0 ? 'success' : 'danger';
}

export function formatUpsidePercent(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return 'Unavailable';
  const normalized = Math.abs(percent) < 0.005 ? 0 : percent;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(2)}%`;
}

export function displayStatus(data: FairValueAvailable): string {
  return data.dataStatus.charAt(0).toUpperCase() + data.dataStatus.slice(1);
}

const FAILURE_LABELS: Record<FairValueFailureKind, { th: string; en: string }> = {
  'provider-unavailable': {
    th: 'ผู้ให้บริการไม่มีข้อมูล',
    en: 'Provider data unavailable',
  },
  'insufficient-data': {
    th: 'ข้อมูลไม่ผ่านเกณฑ์ขั้นต่ำ',
    en: 'Insufficient data',
  },
  'calculation-failure': {
    th: 'การคำนวณไม่สำเร็จ',
    en: 'Calculation failed',
  },
};

export function fairValueUnavailableLabel(
  failureKind: FairValueFailureKind,
  language: 'th' | 'en',
): string {
  return FAILURE_LABELS[failureKind][language];
}
