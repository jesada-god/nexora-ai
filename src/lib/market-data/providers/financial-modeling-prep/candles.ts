import 'server-only';
import { z, ZodError } from 'zod';
import { MarketDataError } from '../../errors';
import { ProviderHttpClient } from '../../provider-http';
import { classifyUsEquitySession, exchangeSessionDate, US_EQUITY_TIMEZONE, zonedLocalToUtc } from '../../session';
import { FMP_CANDLE_CAPABILITIES } from '../../candles/capabilities';
import { normalizeCandles, validatedCandle } from '../../candles/normalize';
import { candleRangeBounds, isoDateFromEpoch } from '../../candles/range';
import type { CandleInterval, CandleRequest, NormalizedCandleResult, NormalizedMarketDataProvider } from '../../candles/contracts';

const MAX_CANDLES = 20_000;
const INTERVALS: Partial<Record<CandleInterval, string>> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1hour', '4h': '4hour',
};
const rowSchema = z.object({
  date: z.string(), open: z.unknown(), high: z.unknown(), low: z.unknown(), close: z.unknown(), volume: z.unknown(),
}).passthrough();

export class FinancialModelingPrepCandleProvider implements NormalizedMarketDataProvider {
  readonly id = 'financial-modeling-prep';

  constructor(
    private readonly apiKey: string,
    private readonly http = new ProviderHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  getCapabilities() { return FMP_CANDLE_CAPABILITIES; }

  async getCandles(input: CandleRequest & { sourceInterval: CandleInterval }): Promise<NormalizedCandleResult> {
    if (input.adjusted) throw new MarketDataError('unsupported', 'FMP candle endpoints do not disclose adjusted OHLC in their response');
    if (input.session === 'extended') throw new MarketDataError('unsupported', 'FMP does not expose a verified extended-session selector for this endpoint');
    const bounds = input.period1 && input.period2
      ? { period1: input.period1, period2: input.period2 }
      : candleRangeBounds(input.range, this.now());
    const intraday = input.sourceInterval !== '1D';
    const providerInterval = INTERVALS[input.sourceInterval];
    if (intraday && !providerInterval) throw new MarketDataError('unsupported', `FMP does not expose ${input.sourceInterval} as a source interval`);
    const url = intraday
      ? new URL(`https://financialmodelingprep.com/stable/historical-chart/${providerInterval}`)
      : new URL('https://financialmodelingprep.com/stable/historical-price-eod/full');
    url.searchParams.set('symbol', input.symbol);
    url.searchParams.set('from', isoDateFromEpoch(bounds.period1));
    url.searchParams.set('to', isoDateFromEpoch(bounds.period2));
    const payload = await this.http.json({
      provider: this.id,
      operation: `candles-${input.sourceInterval}`,
      route: '/api/market/candles',
      symbol: input.symbol,
      url,
      init: { cache: 'no-store', headers: { apikey: this.apiKey } },
      timeoutMs: 10_000,
      maxAttempts: 2,
    });
    try {
      const rows = z.array(rowSchema).parse(payload);
      if (rows.length > MAX_CANDLES) throw new MarketDataError('invalid-provider-response', 'FMP candle response exceeded the safe row limit');
      const candidates = rows.map((row) => {
        const timestampIso = intraday
          ? zonedLocalToUtc(row.date, US_EQUITY_TIMEZONE)
          : /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? `${row.date}T12:00:00.000Z` : null;
        if (!timestampIso) return null;
        const sessionType = intraday ? classifyUsEquitySession(timestampIso, US_EQUITY_TIMEZONE) : null;
        if (intraday && (sessionType !== 'regular' || !exchangeSessionDate(timestampIso, US_EQUITY_TIMEZONE))) return null;
        return validatedCandle({
          timestamp: Math.floor(Date.parse(timestampIso) / 1_000),
          open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
          ...(sessionType === 'regular' ? { session: 'regular' as const } : {}),
        });
      });
      const normalized = normalizeCandles(candidates);
      if (!normalized.candles.length) throw new MarketDataError('insufficient-data', `No valid ${input.sourceInterval} candles were returned for ${input.symbol}`);
      const last = normalized.candles.at(-1)!;
      return {
        symbol: input.symbol,
        provider: this.id,
        attemptedProviders: [this.id],
        requestedInterval: input.interval,
        actualInterval: input.sourceInterval,
        sourceInterval: input.sourceInterval,
        requestedRange: input.range,
        actualStart: normalized.candles[0]?.timestamp ?? null,
        actualEnd: last.timestamp,
        exchangeTimezone: US_EQUITY_TIMEZONE,
        currency: 'USD',
        dataStatus: intraday ? 'delayed' : 'end-of-day',
        delayedByMinutes: null,
        adjusted: false,
        aggregated: false,
        cacheStatus: 'miss',
        candles: normalized.candles,
        warnings: [
          'Provider omits exchange timezone; US equity timezone is disclosed',
          'Historical prices are unadjusted',
          ...(normalized.invalidCount ? [`Discarded ${normalized.invalidCount} invalid provider candles`] : []),
        ],
        fallbackReason: null,
      };
    } catch (cause) {
      if (cause instanceof MarketDataError) throw cause;
      if (cause instanceof ZodError) throw new MarketDataError('invalid-provider-response', 'FMP candle response did not match its validated schema');
      throw cause;
    }
  }
}
