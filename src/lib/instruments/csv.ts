import type { InstrumentAssetType, InstrumentStatus, InstrumentSyncParseResult, MarketInstrumentInput } from './types.ts';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,31}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeInstrumentSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function parseCsvRecords(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) throw new Error('CSV ended inside a quoted field');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((record) => record.some((value) => value.trim() !== ''));
}

function optionalDate(value: string): string | null {
  const normalized = value.trim();
  return normalized && normalized !== 'null' && DATE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeAssetType(value: string): InstrumentAssetType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stock' || normalized === 'equity' || normalized === 'common stock') return 'Stock';
  if (normalized === 'etf' || normalized === 'exchange traded fund') return 'ETF';
  return null;
}

function normalizeStatus(value: string, fallback: InstrumentStatus): InstrumentStatus {
  return value.trim().toLowerCase() === 'delisted' ? 'delisted' : fallback;
}

export function parseListingStatusCsv(csv: string, fallbackStatus: InstrumentStatus): InstrumentSyncParseResult {
  const records = parseCsvRecords(csv);
  if (records.length === 0) return { instruments: [], failed: 0, errors: [] };
  const headers = records[0].map((header) => header.trim().replace(/^\uFEFF/, ''));
  const required = ['symbol', 'name', 'exchange', 'assetType', 'ipoDate', 'delistingDate', 'status'];
  const indexes = Object.fromEntries(required.map((header) => [header, headers.indexOf(header)]));
  if (required.some((header) => indexes[header] === -1)) {
    throw new Error(`LISTING_STATUS CSV is missing required columns: ${required.filter((header) => indexes[header] === -1).join(', ')}`);
  }

  const byProviderSymbol = new Map<string, MarketInstrumentInput>();
  const errors: InstrumentSyncParseResult['errors'] = [];
  records.slice(1).forEach((record, offset) => {
    const rowNumber = offset + 2;
    const providerSymbol = normalizeInstrumentSymbol(record[indexes.symbol] ?? '');
    const name = (record[indexes.name] ?? '').trim();
    const assetType = normalizeAssetType(record[indexes.assetType] ?? '');
    if (!SYMBOL_PATTERN.test(providerSymbol) || !name || !assetType) {
      errors.push({ row: rowNumber, code: 'malformed-row', message: 'Invalid symbol, name, or unsupported asset type' });
      return;
    }
    byProviderSymbol.set(providerSymbol, {
      provider_symbol: providerSymbol,
      symbol: providerSymbol,
      name,
      exchange: (record[indexes.exchange] ?? '').trim() || null,
      asset_type: assetType,
      currency: 'USD',
      country: 'US',
      status: normalizeStatus(record[indexes.status] ?? '', fallbackStatus),
      ipo_date: optionalDate(record[indexes.ipoDate] ?? ''),
      delisting_date: optionalDate(record[indexes.delistingDate] ?? ''),
    });
  });
  return { instruments: [...byProviderSymbol.values()], failed: errors.length, errors };
}

