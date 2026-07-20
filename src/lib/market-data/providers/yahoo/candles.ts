import 'server-only';
import { z, ZodError } from 'zod';
import { MarketDataError } from '../../errors';
import { ProviderHttpClient } from '../../provider-http';
import { YAHOO_CANDLE_CAPABILITIES } from '../../candles/capabilities';
import { applyAdjustment, normalizeCandles, validatedCandle } from '../../candles/normalize';
import { candleRangeBounds } from '../../candles/range';
import type { CandleInterval, CandleRequest, NormalizedCandleResult, NormalizedMarketDataProvider } from '../../candles/contracts';

const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const MAX_CANDLES = 20_000;
const INTERVALS: Partial<Record<CandleInterval, string>> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m',
  '1D': '1d', Week: '1wk', Month: '1mo',
};

const chartSchema = z.object({
  chart: z.object({
    result: z.array(z.object({
      meta: z.object({
        symbol: z.string().optional(),
        currency: z.string().nullable().optional(),
        exchangeTimezoneName: z.string().optional(),
        exchangeDataDelayedBy: z.number().int().nonnegative().optional(),
        marketState: z.string().optional(),
      }).passthrough(),
      timestamp: z.array(z.number().int()),
      indicators: z.object({
        quote: z.array(z.object({
          open: z.array(z.unknown()).optional(),
          high: z.array(z.unknown()).optional(),
          low: z.array(z.unknown()).optional(),
          close: z.array(z.unknown()).optional(),
          volume: z.array(z.unknown()).optional(),
        }).passthrough()).min(1),
        adjclose: z.array(z.object({ adjclose: z.array(z.unknown()).optional() }).passthrough()).optional(),
      }).passthrough(),
    }).passthrough()).nullable(),
    error: z.object({ code: z.string().nullable(), description: z.string().nullable() }).nullable(),
  }),
});

function intervalSeconds(interval: CandleInterval): number {
  if (interval === '1m') return 60;
  if (interval === '5m') return 300;
  if (interval === '15m') return 900;
  if (interval === '30m') return 1_800;
  if (interval === '1h') return 3_600;
  return 86_400;
}

function exchangePeriodKey(timestamp: number, timeZone: string, interval: 'Week' | 'Month'): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp * 1_000));
  if (interval === 'Month') return date.slice(0, 7);
  const parsed = new Date(`${date}T12:00:00.000Z`);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  return `${parsed.getUTCFullYear()}-${Math.ceil((((parsed.valueOf() - yearStart.valueOf()) / 86_400_000) + 1) / 7)}`;
}

export class YahooCandleProvider implements NormalizedMarketDataProvider {
  readonly id = 'yahoo-finance-chart';

  constructor(
    private readonly http = new ProviderHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  getCapabilities() { return YAHOO_CANDLE_CAPABILITIES; }

  async getCandles(input: CandleRequest & { sourceInterval: CandleInterval }): Promise<NormalizedCandleResult> {
    const providerInterval = INTERVALS[input.sourceInterval];
    if (!providerInterval) throw new MarketDataError('unsupported', `Yahoo does not expose ${input.sourceInterval} as a source interval`);
    if (input.adjusted && !['1D', 'Week', 'Month'].includes(input.sourceInterval)) {
      throw new MarketDataError('unsupported', 'Adjusted intraday candles are not available from Yahoo Chart');
    }
    const bounds = input.period1 && input.period2
      ? { period1: input.period1, period2: input.period2 }
      : candleRangeBounds(input.range, this.now());
    const url = new URL(`${BASE_URL}/${encodeURIComponent(input.symbol)}`);
    url.searchParams.set('interval', providerInterval);
    url.searchParams.set('period1', String(bounds.period1));
    url.searchParams.set('period2', String(bounds.period2));
    url.searchParams.set('includePrePost', input.session === 'extended' ? 'true' : 'false');
    url.searchParams.set('events', 'div,splits');
    const payload = await this.http.json({
      provider: this.id,
      operation: `candles-${input.sourceInterval}`,
      route: '/api/market/candles',
      symbol: input.symbol,
      url,
      init: { cache: 'no-store' },
      timeoutMs: 10_000,
      maxAttempts: 2,
    });
    try {
      const parsed = chartSchema.parse(payload);
      const result = parsed.chart.result?.[0];
      if (!result || parsed.chart.error) throw new MarketDataError('not-found', `No Yahoo candles were returned for ${input.symbol}`);
      if (result.timestamp.length > MAX_CANDLES) throw new MarketDataError('invalid-provider-response', 'Yahoo candle response exceeded the safe row limit');
      const quote = result.indicators.quote[0];
      const adjusted = result.indicators.adjclose?.[0]?.adjclose ?? [];
      const rows = result.timestamp.map((timestamp, index) => {
        const candle = validatedCandle({
          timestamp,
          open: quote.open?.[index], high: quote.high?.[index], low: quote.low?.[index], close: quote.close?.[index],
          adjustedClose: adjusted[index], volume: quote.volume?.[index],
          session: 'regular',
        });
        return input.adjusted && candle?.adjustedClose === undefined ? null : candle;
      });
      const normalized = normalizeCandles(rows);
      const candles = input.adjusted ? normalized.candles.map(applyAdjustment) : normalized.candles;
      if (!candles.length) throw new MarketDataError('insufficient-data', `No valid ${input.sourceInterval} candles were returned for ${input.symbol}`);
      const delayedByMinutes = result.meta.exchangeDataDelayedBy ?? null;
      const marketState = result.meta.marketState?.toUpperCase();
      const last = candles.at(-1)!;
      const isCurrent = Math.floor(this.now().valueOf() / 1_000) - last.timestamp <= intervalSeconds(input.sourceInterval) * 3;
      const dataStatus = ['1D', 'Week', 'Month'].includes(input.sourceInterval)
        ? 'end-of-day' as const
        : delayedByMinutes === 0 && isCurrent && ['REGULAR', 'PRE', 'POST'].includes(marketState ?? '')
          ? 'live' as const : 'delayed' as const;
      if (dataStatus === 'live') last.partial = true;
      if (input.sourceInterval === 'Week' || input.sourceInterval === 'Month') {
        const timeZone = result.meta.exchangeTimezoneName ?? 'UTC';
        last.partial = exchangePeriodKey(last.timestamp, timeZone, input.sourceInterval)
          === exchangePeriodKey(Math.floor(this.now().valueOf() / 1_000), timeZone, input.sourceInterval);
      }
      const warnings = [
        ...(normalized.invalidCount ? [`Discarded ${normalized.invalidCount} invalid provider candles`] : []),
        ...(!input.adjusted && ['1D', 'Week', 'Month'].includes(input.sourceInterval) ? ['Historical prices are unadjusted'] : []),
      ];
      return {
        symbol: input.symbol,
        provider: this.id,
        attemptedProviders: [this.id],
        requestedInterval: input.interval,
        actualInterval: input.sourceInterval,
        sourceInterval: input.sourceInterval,
        requestedRange: input.range,
        actualStart: candles[0]?.timestamp ?? null,
        actualEnd: last.timestamp,
        exchangeTimezone: result.meta.exchangeTimezoneName ?? 'UTC',
        currency: result.meta.currency ?? null,
        dataStatus,
        delayedByMinutes,
        adjusted: Boolean(input.adjusted),
        aggregated: false,
        cacheStatus: 'miss',
        candles,
        warnings,
        fallbackReason: null,
      };
    } catch (cause) {
      if (cause instanceof MarketDataError) throw cause;
      if (cause instanceof ZodError) throw new MarketDataError('invalid-provider-response', 'Yahoo Chart response did not match its validated schema');
      throw cause;
    }
  }
}
