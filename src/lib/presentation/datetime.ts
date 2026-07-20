export const THAI_LOCALE = 'th-TH';
export const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

export function formatBangkokDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat(THAI_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: BANGKOK_TIME_ZONE,
  }).format(date);
}

export function isStaleAt(
  asOf: string | null,
  maxAgeSeconds: number | null,
  referenceTime: string,
): boolean {
  if (!asOf) return false;
  const asOfMs = Date.parse(asOf);
  const referenceMs = Date.parse(referenceTime);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(referenceMs)) return false;
  return referenceMs - asOfMs > Math.max(300, maxAgeSeconds ?? 0) * 1_000;
}
