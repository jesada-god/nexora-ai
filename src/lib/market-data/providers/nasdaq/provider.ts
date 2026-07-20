import { z } from 'zod';
import { MarketDataError, mapProviderFailure } from '../../errors';
import { historicalPricesSchema, type HistoricalPrice, type HistoricalPrices, type HistoricalRange, type ProviderResult } from '../../types';

const BASE_URL = 'https://api.nasdaq.com/api/quote';
const TIMEOUT_MS = 8_000;
const MINIMUM_ROWS = 2;

const responseSchema = z.object({
  data: z.object({
    tradesTable: z.object({
      rows: z.array(z.object({
        date: z.string(), close: z.string(), volume: z.string(), open: z.string(), high: z.string(), low: z.string(),
      })),
    }),
  }).nullable(),
  status: z.object({ rCode: z.number() }).optional(),
});

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }

function startDate(range: HistoricalRange, now: Date): Date {
  const start = new Date(now);
  const amounts: Record<HistoricalRange, [number, 'month' | 'year']> = {
    '1m': [1, 'month'], '3m': [3, 'month'], '6m': [6, 'month'], '1y': [1, 'year'], '5y': [5, 'year'], max: [10, 'year'],
  };
  const [amount, unit] = amounts[range];
  if (unit === 'month') start.setUTCMonth(start.getUTCMonth() - amount);
  else start.setUTCFullYear(start.getUTCFullYear() - amount);
  return start;
}

function parseNumber(value: string): number | null {
  const text = value.replaceAll('$', '').replaceAll(',', '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseNasdaqDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const date = `${match[3]}-${match[1]}-${match[2]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function normalizeNasdaqHistory(input: unknown, symbol: string, range: HistoricalRange): HistoricalPrices {
  const parsed = responseSchema.parse(input);
  if (!parsed.data || parsed.status?.rCode !== 200) throw new MarketDataError('invalid-provider-response', 'Nasdaq returned an invalid historical response');
  const byDate = new Map<string, HistoricalPrice>();
  for (const source of parsed.data.tradesTable.rows) {
    const date = parseNasdaqDate(source.date);
    const open = parseNumber(source.open); const high = parseNumber(source.high); const low = parseNumber(source.low);
    const close = parseNumber(source.close); const volume = parseNumber(source.volume);
    if (!date || open === null || high === null || low === null || close === null) continue;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || (volume !== null && (volume < 0 || !Number.isInteger(volume)))) continue;
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
    byDate.set(date, { date, open, high, low, close, volume });
  }
  const prices = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (prices.length < MINIMUM_ROWS) throw new MarketDataError('insufficient-data', 'Nasdaq returned insufficient valid OHLCV rows');
  return historicalPricesSchema.parse({ symbol, range, interval: '1d', prices });
}

export class NasdaqHistoricalProvider {
  readonly id = 'nasdaq';
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  async getHistoricalPrices(symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>> {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(symbol)) throw new MarketDataError('invalid-request', 'Nasdaq fallback does not support this symbol format');
    const now = this.now();
    const url = new URL(`${BASE_URL}/${encodeURIComponent(symbol.toUpperCase())}/historical`);
    url.searchParams.set('assetclass', 'stocks');
    url.searchParams.set('fromdate', isoDate(startDate(range, now)));
    url.searchParams.set('todate', isoDate(now));
    url.searchParams.set('limit', '5000');
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Nexora-Market-Data/1.0)' },
        signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store',
      });
    } catch (cause) { throw mapProviderFailure({ cause }); }
    if (!response.ok) throw mapProviderFailure({ status: response.status });
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw new MarketDataError('invalid-provider-response', 'Nasdaq did not return JSON content');
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new MarketDataError('invalid-provider-response', 'Nasdaq returned invalid JSON'); }
    let data: HistoricalPrices;
    try { data = normalizeNasdaqHistory(payload, symbol, range); }
    catch (cause) {
      if (cause instanceof MarketDataError) throw cause;
      throw new MarketDataError('invalid-provider-response', 'Nasdaq historical data did not match its contract');
    }
    const latestDate = data.prices.at(-1)?.date ?? null;
    return {
      data: range === 'max' ? { ...data, limitations: ['Nasdaq fallback max range is limited to 10 years'] } : data,
      provider: this.id,
      freshness: { status: 'end-of-day', asOf: latestDate ? `${latestDate}T00:00:00.000Z` : null, maxAgeSeconds: 21_600 },
    };
  }
}
