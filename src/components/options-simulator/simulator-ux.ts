export const BASIC_PATH_OPTIONS = [1_000, 5_000, 10_000, 25_000, 50_000] as const;

export type BasicPathOption = typeof BASIC_PATH_OPTIONS[number];

export function isBasicPathOption(value: number): value is BasicPathOption {
  return BASIC_PATH_OPTIONS.includes(value as BasicPathOption);
}

function finiteNonnegative(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function premiumFromDigitString(value: string): number | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  return finiteNonnegative(Number(digits) / 100);
}

export function parsePremiumPaste(value: string): number | null {
  const normalized = value.trim().replace(/[$,\s]/g, '');
  if (!normalized || normalized.startsWith('-')) return null;
  if (!normalized.includes('.')) return /^\d+$/.test(normalized) ? premiumFromDigitString(normalized) : null;
  if (!/^\d*\.\d{0,2}$/.test(normalized)) return null;
  return finiteNonnegative(Number(normalized));
}

export function premiumDigitsFromValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return String(Math.round(value * 100));
}

export function formatPremiumDigits(value: string): string {
  const parsed = premiumFromDigitString(value);
  return parsed === null ? '' : parsed.toFixed(2);
}

export function engineVolatilityToPercent(value: number): number {
  return Number.isFinite(value) ? value * 100 : 0;
}

export function percentVolatilityToEngine(value: number): number {
  return Number.isFinite(value) ? value / 100 : 0;
}

export function normalizePercentDraft(value: string): string | null {
  const normalized = value.trim().replace(/%$/, '');
  if (!normalized) return '';
  if (!/^\d*(?:\.\d{0,2})?$/.test(normalized)) return null;
  if (normalized.startsWith('.')) return `0${normalized}`;
  return normalized.replace(/^0+(?=\d)/, '');
}

export function parsePercentDraft(value: string): number | null {
  const normalized = normalizePercentDraft(value);
  if (normalized === null || !normalized || normalized === '.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ResolvedLegSensitivity {
  side: 'buy' | 'sell';
  quantity: number;
  multiplier: number;
  delta: number | null;
  theta: number | null;
}

export function aggregatePortfolioSensitivity(legs: ResolvedLegSensitivity[]): { delta: number; theta: number } {
  return legs.reduce((total, leg) => {
    const scale = (leg.side === 'buy' ? 1 : -1) * leg.quantity * leg.multiplier;
    return {
      delta: leg.delta === null ? total.delta : total.delta + leg.delta * scale,
      theta: leg.theta === null ? total.theta : total.theta + leg.theta * scale,
    };
  }, { delta: 0, theta: 0 });
}

function calendarParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, date);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) return null;
  return [year, month, date];
}

export function addCalendarDays(value: string, amount: number): string {
  const parts = calendarParts(value);
  if (!parts) return value;
  const next = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + amount));
  return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, '0'), String(next.getUTCDate()).padStart(2, '0')].join('-');
}

export function calendarDaysBetween(start: string, end: string): number {
  const startParts = calendarParts(start);
  const endParts = calendarParts(end);
  if (!startParts || !endParts) return 0;
  const startValue = Date.UTC(startParts[0], startParts[1] - 1, startParts[2]);
  const endValue = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);
  return Math.round((endValue - startValue) / 86_400_000);
}

export function clampTargetDate(value: string, valuationDate: string, expiration: string): string {
  const minimum = addCalendarDays(valuationDate, 1);
  if (!calendarParts(value)) return minimum <= expiration ? minimum : expiration;
  if (value < minimum) return minimum <= expiration ? minimum : expiration;
  if (value > expiration) return expiration;
  return value;
}

export function targetDateError(value: string, valuationDate: string, expiration: string): string | null {
  if (!calendarParts(value) || value <= valuationDate) return 'Target Date ต้องอยู่หลังวันที่คำนวณ';
  if (value > expiration) return 'Target Date ต้องไม่เกินวันหมดอายุ';
  return null;
}

export function parseFiniteDraft(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
