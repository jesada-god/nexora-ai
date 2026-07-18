import type { InstrumentAssetType, InstrumentSyncParseResult, MarketInstrumentInput } from './types.ts';
import { normalizeInstrumentSymbol } from './csv.ts';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,31}$/;

export type NasdaqTraderDirectory = 'nasdaqlisted' | 'otherlisted';

const EXCHANGE_NAMES: Readonly<Record<string, string>> = {
  Q: 'NASDAQ',
  NASDAQ: 'NASDAQ',
  N: 'NYSE',
  NYSE: 'NYSE',
  A: 'NYSE American',
  'NYSE AMERICAN': 'NYSE American',
  P: 'NYSE Arca',
  'NYSE ARCA': 'NYSE Arca',
  Z: 'Cboe',
  CBOE: 'Cboe',
  V: 'IEX',
  IEX: 'IEX',
};

const REQUIRED_HEADERS: Record<NasdaqTraderDirectory, readonly string[]> = {
  nasdaqlisted: ['Symbol', 'Security Name', 'Market Category', 'Test Issue', 'ETF'],
  otherlisted: ['ACT Symbol', 'Security Name', 'Exchange', 'ETF', 'Test Issue', 'NASDAQ Symbol'],
};

function cleanField(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

function mapExchange(value: string): string | null {
  const original = cleanField(value);
  if (!original) return null;
  return EXCHANGE_NAMES[original.toUpperCase()] ?? original;
}

function mapEtf(value: string): InstrumentAssetType | null {
  const flag = cleanField(value).toUpperCase();
  if (flag === 'Y') return 'ETF';
  if (flag === 'N') return 'Stock';
  return null;
}

function splitPipeRecords(text: string): string[][] {
  return text.split(/\r?\n/)
    .map((line) => line.split('|').map(cleanField))
    .filter((record) => record.some(Boolean));
}

export function parseNasdaqTraderDirectory(text: string, directory: NasdaqTraderDirectory): InstrumentSyncParseResult {
  const records = splitPipeRecords(text);
  if (records.length === 0) throw new Error(`${directory}.txt is empty`);

  const headers = records[0];
  const required = REQUIRED_HEADERS[directory];
  const indexes = Object.fromEntries(required.map((header) => [header, headers.indexOf(header)]));
  const missing = required.filter((header) => indexes[header] === -1);
  if (missing.length > 0) throw new Error(`${directory}.txt is missing required columns: ${missing.join(', ')}`);

  const symbolHeader = directory === 'nasdaqlisted' ? 'Symbol' : 'ACT Symbol';
  const providerSymbolHeader = directory === 'nasdaqlisted' ? 'Symbol' : 'NASDAQ Symbol';
  const exchangeHeader = directory === 'nasdaqlisted' ? 'Market Category' : 'Exchange';
  const byProviderSymbol = new Map<string, MarketInstrumentInput>();
  const errors: InstrumentSyncParseResult['errors'] = [];

  records.slice(1).forEach((record, offset) => {
    const rowNumber = offset + 2;
    if (record[0]?.toLowerCase().startsWith('file creation time')) return;

    const testIssue = cleanField(record[indexes['Test Issue']] ?? '').toUpperCase();
    if (testIssue === 'Y') return;

    const symbol = normalizeInstrumentSymbol(record[headers.indexOf(symbolHeader)] ?? '');
    const rawProviderSymbol = record[headers.indexOf(providerSymbolHeader)] ?? symbol;
    const providerSymbol = normalizeInstrumentSymbol(rawProviderSymbol || symbol);
    const name = cleanField(record[indexes['Security Name']] ?? '');
    const assetType = mapEtf(record[indexes.ETF] ?? '');
    if (testIssue !== 'N' || !SYMBOL_PATTERN.test(symbol) || !SYMBOL_PATTERN.test(providerSymbol) || !name || !assetType) {
      errors.push({ row: rowNumber, code: 'malformed-row', message: 'Invalid symbol, name, ETF flag, or test issue flag' });
      return;
    }

    byProviderSymbol.set(providerSymbol, {
      provider_symbol: providerSymbol,
      symbol,
      name,
      exchange: mapExchange(record[headers.indexOf(exchangeHeader)] ?? ''),
      asset_type: assetType,
      currency: 'USD',
      country: 'US',
      status: 'active',
      ipo_date: null,
      delisting_date: null,
    });
  });

  return { instruments: [...byProviderSymbol.values()], failed: errors.length, errors };
}

export function mergeNasdaqTraderDirectories(...results: InstrumentSyncParseResult[]): InstrumentSyncParseResult {
  const instruments = new Map<string, MarketInstrumentInput>();
  for (const result of results) {
    for (const instrument of result.instruments) {
      if (!instruments.has(instrument.provider_symbol)) instruments.set(instrument.provider_symbol, instrument);
    }
  }
  return {
    instruments: [...instruments.values()],
    failed: results.reduce((total, result) => total + result.failed, 0),
    errors: results.flatMap((result) => result.errors),
  };
}
