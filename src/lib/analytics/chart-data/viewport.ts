export interface LogicalRange {
  start: number;
  end: number;
}

export const MIN_VISIBLE_BARS = 8;

export function fitLogicalRange(length: number): LogicalRange {
  return { start: 0, end: Math.max(0, length - 1) };
}

export function initialLogicalRange(length: number, visibleBarCount: number): LogicalRange {
  if (length <= 1) return { start: 0, end: 0 };
  const width = Math.min(length, Math.max(MIN_VISIBLE_BARS, Math.round(visibleBarCount)));
  return { start: length - width, end: length - 1 };
}

export function clampLogicalRange(range: LogicalRange, length: number): LogicalRange {
  if (length <= 1) return { start: 0, end: 0 };
  const width = Math.min(Math.max(2, Math.round(range.end - range.start + 1)), length);
  const start = Math.min(Math.max(0, Math.round(range.start)), length - width);
  return { start, end: start + width - 1 };
}

export function zoomLogicalRange(
  range: LogicalRange,
  length: number,
  scale: number,
  anchorRatio = 0.5,
  minimumVisibleBars = MIN_VISIBLE_BARS,
): LogicalRange {
  const current = clampLogicalRange(range, length);
  const currentWidth = current.end - current.start + 1;
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const minimum = Math.min(length, Math.max(2, Math.round(minimumVisibleBars)));
  const nextWidth = Math.min(length, Math.max(minimum, Math.round(currentWidth * scale)));
  const anchor = current.start + (currentWidth - 1) * ratio;
  return clampLogicalRange({ start: anchor - (nextWidth - 1) * ratio, end: anchor + (nextWidth - 1) * (1 - ratio) }, length);
}

export function panLogicalRange(range: LogicalRange, length: number, slots: number): LogicalRange {
  const current = clampLogicalRange(range, length);
  return clampLogicalRange({ start: current.start + slots, end: current.end + slots }, length);
}
