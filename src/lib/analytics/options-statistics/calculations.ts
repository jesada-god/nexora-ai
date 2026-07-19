export interface OptionAggregate { type: 'call' | 'put'; volume: number | null; openInterest: number | null; expiration: string; }
export type PutCallResult = { status: 'available'; value: number; putTotal: number; callTotal: number; type: 'volume' | 'open-interest'; scope: 'symbol' | 'expiration' | 'all-expirations'; expirations: string[] } | { status: 'unavailable'; reason: string; };

export function putCallRatio(rows: readonly OptionAggregate[], type: 'volume' | 'open-interest', scope: 'symbol' | 'expiration' | 'all-expirations' = 'all-expirations'): PutCallResult {
  if (!rows.length) return { status: 'unavailable', reason: 'Options data unavailable: provider ไม่มี options chain จริง' };
  const field = type === 'volume' ? 'volume' : 'openInterest';
  if (rows.some((row) => row[field] == null || !Number.isFinite(row[field]!) || row[field]! < 0)) return { status: 'unavailable', reason: 'Options chain ไม่ครบหรือมีค่าที่ไม่ถูกต้อง' };
  const putTotal = rows.filter((row) => row.type === 'put').reduce((sum, row) => sum + row[field]!, 0);
  const callTotal = rows.filter((row) => row.type === 'call').reduce((sum, row) => sum + row[field]!, 0);
  if (callTotal === 0) return { status: 'unavailable', reason: 'คำนวณ Put/Call Ratio ไม่ได้เพราะ call denominator เท่ากับศูนย์' };
  return { status: 'available', value: putTotal / callTotal, putTotal, callTotal, type, scope, expirations: [...new Set(rows.map((row) => row.expiration))].sort() };
}
