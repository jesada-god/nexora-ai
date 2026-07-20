export interface StrikeLine {
  id: string;
  price: number;
  label: string;
  optionType: 'call' | 'put';
  expiration: string | null;
  visible: boolean;
}

function validExpiration(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function normalizeStrikeLine(value: unknown): StrikeLine | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<Record<keyof StrikeLine, unknown>>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price <= 0) return null;
  if (row.optionType !== 'call' && row.optionType !== 'put') return null;
  return {
    id: row.id,
    price: row.price,
    label: typeof row.label === 'string' && row.label.trim() ? row.label.trim().slice(0, 40) : `${row.optionType === 'call' ? 'Call' : 'Put'} ${row.price}`,
    optionType: row.optionType,
    expiration: validExpiration(row.expiration),
    visible: row.visible !== false,
  };
}

export function parseStrikeLines(raw: string | null): StrikeLine[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, StrikeLine>();
    parsed.forEach((value) => {
      const line = normalizeStrikeLine(value);
      if (line) unique.set(line.id, line);
    });
    return [...unique.values()];
  } catch {
    return [];
  }
}

export function strikeDistance(price: number, spot: number) {
  const dollars = price - spot;
  return { dollars, percent: spot === 0 ? null : (dollars / spot) * 100 };
}

