export interface LogicalRange {
  start: number;
  end: number;
}

export function fitLogicalRange(length: number): LogicalRange {
  return { start: 0, end: Math.max(0, length - 1) };
}

export function clampLogicalRange(range: LogicalRange, length: number): LogicalRange {
  if (length <= 1) return { start: 0, end: 0 };
  const width = Math.min(Math.max(2, Math.round(range.end - range.start + 1)), length);
  const start = Math.min(Math.max(0, Math.round(range.start)), length - width);
  return { start, end: start + width - 1 };
}

export function zoomLogicalRange(range: LogicalRange, length: number, scale: number, anchorRatio = 0.5): LogicalRange {
  const current = clampLogicalRange(range, length);
  const currentWidth = current.end - current.start + 1;
  const nextWidth = Math.min(length, Math.max(2, Math.round(currentWidth * scale)));
  const anchor = current.start + currentWidth * Math.min(1, Math.max(0, anchorRatio));
  return clampLogicalRange({ start: anchor - nextWidth * anchorRatio, end: anchor - nextWidth * anchorRatio + nextWidth - 1 }, length);
}

export function panLogicalRange(range: LogicalRange, length: number, slots: number): LogicalRange {
  const current = clampLogicalRange(range, length);
  return clampLogicalRange({ start: current.start + slots, end: current.end + slots }, length);
}

