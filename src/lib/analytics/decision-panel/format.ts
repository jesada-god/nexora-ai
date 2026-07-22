import type { CurrentPriceAnchor, DecisionDataMode, EtaEstimate } from './types';

/**
 * Presentation helpers. The ETA formatter deliberately rounds to coarse buckets
 * so no false precision (minutes, e.g. "13h 52m") can ever be shown, and always
 * uses "estimated range" wording rather than an arrival promise.
 */

/** Round market hours to a coarse, honest bucket (whole hours, then half-days). */
function coarseHours(hours: number, marketHoursPerDay: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return '<1h';
  if (hours < 8) return `${Math.round(hours)}h`;
  const days = hours / marketHoursPerDay;
  const roundedDays = Math.max(0.5, Math.round(days * 2) / 2);
  return `${roundedDays.toFixed(roundedDays % 1 === 0 ? 0 : 1)}d`;
}

/**
 * Render an ETA as an "estimated range" string. Never emits minute-level
 * precision and never implies a guaranteed arrival time.
 */
export function formatEtaRange(eta: EtaEstimate, marketHoursPerDay = 6.5): string {
  if (eta.status !== 'available' || eta.minMarketHours == null || eta.maxMarketHours == null) {
    return 'Estimated range: unavailable';
  }
  const min = coarseHours(eta.minMarketHours, marketHoursPerDay);
  const max = coarseHours(eta.maxMarketHours, marketHoursPerDay);
  const range = min === max ? min : `${min}–${max}`;
  return `Estimated range: ${range} (market hours)`;
}

const DATA_MODE_LABEL: Record<DecisionDataMode, string> = {
  'REAL-TIME': 'Real-time',
  DELAYED: 'Delayed',
  'END-OF-DAY': 'End-of-day',
  CACHED: 'Cached',
  STALE: 'Stale',
  UNAVAILABLE: 'Unavailable',
};

export function dataModeLabel(mode: DecisionDataMode): string {
  return DATA_MODE_LABEL[mode];
}

/**
 * Beginner-Thai ETA range. Same coarse buckets as {@link formatEtaRange} (never
 * minute precision, never an arrival promise) but phrased in plain Thai.
 */
export function formatEtaRangeTh(eta: EtaEstimate, marketHoursPerDay = 6.5): string {
  if (eta.status !== 'available' || eta.minMarketHours == null || eta.maxMarketHours == null) {
    return 'ยังประเมินกรอบเวลาไม่ได้';
  }
  const min = coarseHours(eta.minMarketHours, marketHoursPerDay);
  const max = coarseHours(eta.maxMarketHours, marketHoursPerDay);
  const range = min === max ? min : `${min}–${max}`;
  return `คาดว่าอาจใช้เวลาราว ${range} (เวลาทำการ)`;
}

/** Beginner-Thai delay age (coarse; never claims real-time). */
export function formatDelayAgeTh(anchor: CurrentPriceAnchor): string | null {
  const seconds = anchor.delayAgeSeconds;
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 90) return `ช้ากว่าจริง ~${Math.max(0, Math.round(seconds))} วิ`;
  const minutes = seconds / 60;
  if (minutes < 90) return `ช้ากว่าจริง ~${Math.round(minutes)} นาที`;
  const hours = minutes / 60;
  if (hours < 36) return `ช้ากว่าจริง ~${Math.round(hours)} ชม.`;
  return `ช้ากว่าจริง ~${Math.round(hours / 24)} วัน`;
}

/** Human-friendly delay age (coarse; never claims real-time). */
export function formatDelayAge(anchor: CurrentPriceAnchor): string | null {
  const seconds = anchor.delayAgeSeconds;
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s behind`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m behind`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)}h behind`;
  return `${Math.round(hours / 24)}d behind`;
}
