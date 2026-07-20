export interface OhlcvInputBar {
  date?: unknown;
  time?: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume?: unknown;
}

export interface NormalizedBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface PriceSeriesPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumeSeriesPoint {
  time: string;
  value: number | null;
  available: boolean;
  direction: 'up' | 'down';
}

function canonicalTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === text ? text : null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The only chart-boundary normalization step. Invalid price rows are rejected,
 * while an unavailable volume remains a null value on the same time slot.
 * For duplicate canonical times, the last provider row wins deterministically.
 */
export function normalizeOhlcvTimeline(rows: readonly OhlcvInputBar[]): NormalizedBar[] {
  const byTime = new Map<string, NormalizedBar>();
  for (const row of rows) {
    const time = canonicalTime(row.time ?? row.date);
    const open = finite(row.open);
    const high = finite(row.high);
    const low = finite(row.low);
    const close = finite(row.close);
    if (!time || open == null || high == null || low == null || close == null) continue;
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
    const candidateVolume = finite(row.volume);
    const volume = candidateVolume != null && candidateVolume >= 0 ? candidateVolume : null;
    byTime.set(time, { time, open, high, low, close, volume });
  }
  return [...byTime.values()].sort((left, right) => left.time.localeCompare(right.time));
}

export function deriveAlignedSeries(bars: readonly NormalizedBar[]) {
  const price: PriceSeriesPoint[] = bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
  const volume: VolumeSeriesPoint[] = bars.map((bar) => ({
    time: bar.time,
    value: bar.volume,
    available: bar.volume != null,
    direction: bar.close >= bar.open ? 'up' : 'down',
  }));
  assertAlignedTimeline(price, volume);
  return { price, volume };
}

export function assertAlignedTimeline(
  price: readonly Pick<PriceSeriesPoint, 'time'>[],
  volume: readonly Pick<VolumeSeriesPoint, 'time'>[],
): void {
  if (price.length !== volume.length) throw new Error('Price/volume timeline length mismatch');
  for (let index = 0; index < price.length; index += 1) {
    if (price[index].time !== volume[index].time) {
      throw new Error(`Price/volume timeline mismatch at index ${index}`);
    }
  }
}

export function sliceAlignedSeries(bars: readonly NormalizedBar[], start: number, end: number) {
  const { price, volume } = deriveAlignedSeries(bars);
  const visiblePrice = price.slice(start, end + 1);
  const visibleVolume = volume.slice(start, end + 1);
  assertAlignedTimeline(visiblePrice, visibleVolume);
  return { price: visiblePrice, volume: visibleVolume };
}
