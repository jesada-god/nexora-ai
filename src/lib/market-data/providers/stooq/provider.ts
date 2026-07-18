import { MarketDataError, mapProviderFailure } from '../../errors';
import { historicalPricesSchema, type HistoricalPrice, type HistoricalPrices, type HistoricalRange, type ProviderResult } from '../../types';

const BASE_URL = 'https://stooq.com/q/d/l/';
const TIMEOUT_MS = 8_000;
const MINIMUM_ROWS = 2;
const EXPECTED_HEADERS = ['date', 'open', 'high', 'low', 'close', 'volume'] as const;

export type StooqFailureCode =
  | 'FALLBACK_NETWORK_ERROR'
  | 'FALLBACK_INVALID_CONTENT_TYPE'
  | 'FALLBACK_EMPTY_DATASET'
  | 'FALLBACK_INVALID_CSV'
  | 'FALLBACK_UNSUPPORTED_SYMBOL'
  | 'FALLBACK_INSUFFICIENT_ROWS';

export class StooqProviderError extends MarketDataError {
  constructor(
    readonly failureCode: StooqFailureCode,
    message: string,
    code: 'invalid-request' | 'upstream-unavailable' | 'invalid-provider-response' | 'insufficient-data',
    readonly validRows = 0,
  ) { super(code, message); }
}

function rangeStart(range: HistoricalRange, now: Date): Date | null {
  if (range === 'max') return null;
  const start = new Date(now);
  const amounts: Record<Exclude<HistoricalRange, 'max'>, [number, 'month' | 'year']> = {
    '1m': [1, 'month'], '3m': [3, 'month'], '6m': [6, 'month'], '1y': [1, 'year'], '5y': [5, 'year'],
  };
  const [amount, unit] = amounts[range];
  if (unit === 'month') start.setUTCMonth(start.getUTCMonth() - amount);
  else start.setUTCFullYear(start.getUTCFullYear() - amount);
  return start;
}

export function toStooqUsSymbol(symbol: string): string {
  const normalized = symbol.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]{0,19}$/.test(normalized)) {
    throw new StooqProviderError('FALLBACK_UNSUPPORTED_SYMBOL', 'Fallback provider does not support this symbol format', 'invalid-request');
  }
  if (normalized.endsWith('.us')) return normalized;
  return `${normalized.replaceAll('.', '-')}.us`;
}

function parseDate(value: string): string | null {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function parseNumber(value: string | undefined): number | null {
  const text = value?.trim();
  if (!text || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseRow(line: string): HistoricalPrice | null {
  const columns = line.split(',');
  if (columns.length !== EXPECTED_HEADERS.length) return null;
  const date = parseDate(columns[0]);
  const open = parseNumber(columns[1]);
  const high = parseNumber(columns[2]);
  const low = parseNumber(columns[3]);
  const close = parseNumber(columns[4]);
  const volume = parseNumber(columns[5]);
  if (!date || open === null || high === null || low === null || close === null || volume === null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 || !Number.isInteger(volume)) return null;
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null;
  return { date, open, high, low, close, volume };
}

export function normalizeStooqHistory(csv: string, symbol: string, range: HistoricalRange, now = new Date()): HistoricalPrices {
  const text = csv.replace(/^\uFEFF/, '').trim();
  if (!text || /^no data\.?$/i.test(text)) {
    throw new StooqProviderError('FALLBACK_EMPTY_DATASET', 'Fallback provider returned no OHLCV data', 'insufficient-data');
  }
  if (/^\s*<(?:!doctype|html)/i.test(text)) {
    throw new StooqProviderError('FALLBACK_INVALID_CSV', 'Fallback provider returned HTML instead of CSV', 'invalid-provider-response');
  }
  const lines = text.split(/\r?\n/);
  const headers = lines.shift()?.split(',').map((header) => header.trim().toLowerCase());
  if (!headers || headers.length !== EXPECTED_HEADERS.length || !EXPECTED_HEADERS.every((header, index) => headers[index] === header)) {
    throw new StooqProviderError('FALLBACK_INVALID_CSV', 'Fallback provider returned invalid CSV headers', 'invalid-provider-response');
  }

  const start = rangeStart(range, now);
  const byDate = new Map<string, HistoricalPrice>();
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = parseRow(line);
    if (row && (!start || new Date(`${row.date}T00:00:00.000Z`) >= start)) byDate.set(row.date, row);
  }
  const prices = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (prices.length < MINIMUM_ROWS) {
    throw new StooqProviderError(
      'FALLBACK_INSUFFICIENT_ROWS',
      `Fallback provider returned ${prices.length} valid OHLCV rows; ${MINIMUM_ROWS} required`,
      'insufficient-data',
      prices.length,
    );
  }
  return historicalPricesSchema.parse({ symbol: symbol.toUpperCase().replace(/\.US$/i, ''), range, interval: '1d', prices });
}

function acceptsCsv(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'text/csv' || mediaType === 'text/plain' || mediaType === 'application/octet-stream';
}

export class StooqHistoricalProvider {
  readonly id = 'stooq';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getHistoricalPrices(symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>> {
    const url = new URL(BASE_URL);
    url.searchParams.set('s', toStooqUsSymbol(symbol));
    url.searchParams.set('i', 'd');
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: 'text/csv,text/plain;q=0.9', 'User-Agent': 'Nexora-Market-Data/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (cause) {
      const mapped = mapProviderFailure({ cause });
      throw new StooqProviderError('FALLBACK_NETWORK_ERROR', mapped.message, 'upstream-unavailable');
    }
    if (!response.ok) {
      const mapped = mapProviderFailure({ status: response.status });
      throw new StooqProviderError('FALLBACK_NETWORK_ERROR', mapped.message, 'upstream-unavailable');
    }
    if (!acceptsCsv(response.headers.get('content-type'))) {
      throw new StooqProviderError(
        'FALLBACK_INVALID_CONTENT_TYPE',
        'Fallback provider did not return CSV content',
        'invalid-provider-response',
      );
    }
    const data = normalizeStooqHistory(await response.text(), symbol, range);
    const latestDate = data.prices.at(-1)?.date ?? null;
    return {
      data,
      provider: this.id,
      freshness: { status: 'end-of-day', asOf: latestDate ? `${latestDate}T00:00:00.000Z` : null, maxAgeSeconds: 21_600 },
    };
  }
}
