import type { InstrumentSyncCounts, MarketInstrumentInput } from './types';

type ExistingInstrument = MarketInstrumentInput;

const comparableKeys = ['symbol', 'name', 'exchange', 'asset_type', 'currency', 'country', 'status', 'ipo_date', 'delisting_date'] as const;

export function sameInstrument(left: ExistingInstrument, right: MarketInstrumentInput): boolean {
  return comparableKeys.every((key) => (left[key] ?? null) === (right[key] ?? null));
}

export function planInstrumentSync(existing: ExistingInstrument[], incoming: MarketInstrumentInput[], failed = 0): InstrumentSyncCounts {
  const current = new Map(existing.map((row) => [row.provider_symbol, row]));
  const uniqueIncoming = new Map(incoming.map((row) => [row.provider_symbol, row]));
  let inserted = 0; let updated = 0; let skipped = 0;
  for (const row of uniqueIncoming.values()) {
    const previous = current.get(row.provider_symbol);
    if (!previous) inserted += 1;
    else if (sameInstrument(previous, row)) skipped += 1;
    else updated += 1;
  }
  for (const row of existing) {
    if (row.status === 'active' && !uniqueIncoming.has(row.provider_symbol)) updated += 1;
  }
  return { inserted, updated, skipped, failed };
}

export function redactInstrumentSyncError(message: string): string {
  return message
    .replace(/([?&]apikey=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(ALPHA_VANTAGE_API_KEY\s*[=:]\s*)\S+/gi, '$1[redacted]');
}

