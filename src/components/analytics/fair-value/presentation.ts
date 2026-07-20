import type {
  FairValueAvailable,
  FairValueFailureKind,
  FairValueUnavailable,
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
  'not-meaningful': {
    th: 'ไม่มีโมเดลที่มีความหมายกับข้อมูลชุดนี้',
    en: 'No meaningful valuation model',
  },
  'rate-limited': {
    th: 'ผู้ให้บริการจำกัดคำขอชั่วคราว',
    en: 'Rate limited',
  },
  'server-error': {
    th: 'เซิร์ฟเวอร์ประมวลผลไม่สำเร็จ',
    en: 'Server error',
  },
};

export function fairValueUnavailableLabel(
  failureKind: FairValueFailureKind,
  language: 'th' | 'en',
): string {
  return FAILURE_LABELS[failureKind][language];
}

function missingFieldLabel(field: string, language: 'th' | 'en'): string {
  const normalized = field.toLowerCase();
  const labels = language === 'th'
    ? {
        fcf: 'FCF',
        ebitda: 'EBITDA',
        history: 'ข้อมูลย้อนหลัง 3 งวด',
        ohlcv: 'ราคาย้อนหลังอย่างน้อย 50 วัน',
        income: 'งบกำไรขาดทุน',
        balance: 'งบดุล',
        cashFlow: 'งบกระแสเงินสด',
        shares: 'จำนวนหุ้นถัวเฉลี่ยปรับลด',
        marketCap: 'มูลค่าหลักทรัพย์ตามราคาตลาด',
        sector: 'Sector',
        industry: 'Industry',
        quote: 'ราคาตลาด',
        profile: 'ข้อมูลบริษัท',
        currency: 'สกุลเงินที่ตรวจสอบได้',
        aligned: 'งบการเงินที่ตรงกันตามงวด',
      }
    : {
        fcf: 'FCF',
        ebitda: 'EBITDA',
        history: 'three historical financial periods',
        ohlcv: 'at least 50 daily price rows',
        income: 'income statement',
        balance: 'balance sheet',
        cashFlow: 'cash-flow statement',
        shares: 'diluted shares',
        marketCap: 'market capitalization',
        sector: 'sector',
        industry: 'industry',
        quote: 'market quote',
        profile: 'company profile',
        currency: 'verified currency',
        aligned: 'period-aligned financial statements',
      };

  if (normalized.includes('historicalfinancials')) return labels.history;
  if (normalized.includes('historicalohlcv')) return labels.ohlcv;
  if (normalized.includes('freecashflow')) return labels.fcf;
  if (normalized.includes('ebitda')) return labels.ebitda;
  if (normalized.includes('income-statement') || normalized.includes('incomestatement')) return labels.income;
  if (normalized.includes('balance-sheet') || normalized.includes('balancesheet') || normalized.includes('cashanddebt')) return labels.balance;
  if (normalized.includes('cash-flow') || normalized.includes('cashflowstatement')) return labels.cashFlow;
  if (normalized.includes('dilutedshares')) return labels.shares;
  if (normalized.includes('marketcapitalization')) return labels.marketCap;
  if (normalized === 'sector') return labels.sector;
  if (normalized === 'industry') return labels.industry;
  if (normalized === 'quote' || normalized.includes('marketprice')) return labels.quote;
  if (normalized === 'companyprofile') return labels.profile;
  if (normalized.includes('currency')) return labels.currency;
  if (normalized.includes('alignedstatements')) return labels.aligned;
  return field;
}

function joinHumanList(values: string[], language: 'th' | 'en'): string {
  if (values.length <= 1) return values[0] ?? '';
  return language === 'th'
    ? `${values.slice(0, -1).join(', ')} และ${values.at(-1)}`
    : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}

export function fairValueMissingFieldsSummary(
  missingFields: string[],
  language: 'th' | 'en',
): string {
  const labels = [...new Set(missingFields.map((field) => missingFieldLabel(field, language)))];
  if (!labels.length) return language === 'th' ? 'ไม่มีข้อมูลที่ขาดเพิ่มเติม' : 'No additional fields are missing';
  return `${language === 'th' ? 'ขาด' : 'Missing'} ${joinHumanList(labels, language)}`;
}

export function fairValueUnavailableReason(
  data: FairValueUnavailable,
  language: 'th' | 'en',
): string {
  const missing = data.missingFields.length > 0
    ? fairValueMissingFieldsSummary(data.missingFields, language)
    : null;
  return missing ? `${missing} · ${data.reason}` : data.reason;
}
