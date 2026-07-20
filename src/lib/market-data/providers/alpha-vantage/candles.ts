import 'server-only';
import { MarketDataError } from '../../errors';
import { ALPHA_VANTAGE_CANDLE_CAPABILITIES } from '../../candles/capabilities';
import { normalizeCandles, validatedCandle } from '../../candles/normalize';
import { candleRangeBounds } from '../../candles/range';
import type { CandleInterval, CandleRange, CandleRequest, NormalizedCandleResult, NormalizedMarketDataProvider } from '../../candles/contracts';
import { AlphaVantageProvider } from './provider';
import { AlphaVantageIntradayProvider } from './intraday';
import type { HistoricalRange, DataFreshness } from '../../types';
import type { IntradayInterval } from '../../intraday/contracts';

const INTRADAY_INTERVALS: Partial<Record<CandleInterval, IntradayInterval>> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m',
};

function legacyRange(range: CandleRange): HistoricalRange {
  if (range === '1d' || range === '5d' || range === '1m') return '1m';
  if (range === '3m') return '3m';
  if (range === '6m') return '6m';
  if (range === 'ytd' || range === '1y') return '1y';
  return '5y';
}

function candleStatus(freshness: DataFreshness, intraday: boolean) {
  if (freshness.status === 'realtime') return 'live' as const;
  if (freshness.status === 'cached') return 'cached' as const;
  if (freshness.status === 'stale') return 'stale' as const;
  if (freshness.status === 'end-of-day') return 'end-of-day' as const;
  return intraday ? 'delayed' as const : 'end-of-day' as const;
}

export class AlphaVantageCandleProvider implements NormalizedMarketDataProvider {
  readonly id = 'alpha-vantage';
  private readonly daily: AlphaVantageProvider;
  private readonly intraday: AlphaVantageIntradayProvider;

  constructor(apiKey: string) {
    this.daily = new AlphaVantageProvider(apiKey);
    this.intraday = new AlphaVantageIntradayProvider(apiKey);
  }

  getCapabilities() { return ALPHA_VANTAGE_CANDLE_CAPABILITIES; }

  async getCandles(input: CandleRequest & { sourceInterval: CandleInterval }): Promise<NormalizedCandleResult> {
    if (input.adjusted) throw new MarketDataError('unsupported', 'The configured Alpha Vantage entitlement does not authorize adjusted daily candles');
    const bounds = input.period1 && input.period2
      ? { period1: input.period1, period2: input.period2 }
      : candleRangeBounds(input.range);
    const source = INTRADAY_INTERVALS[input.sourceInterval];
    if (source) {
      const providerResult = await this.intraday.getIntraday(input.symbol, source, input.session ?? 'regular');
      const normalized = normalizeCandles(providerResult.bars.map((bar) => validatedCandle({
        timestamp: Math.floor(Date.parse(bar.timestamp) / 1_000),
        open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
        session: bar.sessionType === 'premarket' ? 'pre' : bar.sessionType === 'afterhours' ? 'post' : 'regular',
      }))).candles.filter((bar) => bar.timestamp >= bounds.period1 && bar.timestamp <= bounds.period2);
      if (!normalized.length) throw new MarketDataError('insufficient-data', `No valid ${input.sourceInterval} candles were returned for ${input.symbol}`);
      const freshness = { status: providerResult.status === 'live' ? 'realtime' as const : 'delayed' as const, asOf: providerResult.asOf, maxAgeSeconds: 60 };
      return {
        symbol: input.symbol, provider: this.id, attemptedProviders: [this.id],
        requestedInterval: input.interval, actualInterval: input.sourceInterval, sourceInterval: input.sourceInterval,
        requestedRange: input.range, actualStart: normalized[0]?.timestamp ?? null, actualEnd: normalized.at(-1)?.timestamp ?? null,
        exchangeTimezone: providerResult.exchangeTimezone, currency: null,
        dataStatus: candleStatus(freshness, true), delayedByMinutes: providerResult.delayedMinutes,
        adjusted: false, aggregated: false, cacheStatus: 'miss', candles: normalized,
        warnings: [...providerResult.warnings, 'Historical prices are unadjusted'], fallbackReason: null,
      };
    }
    if (input.sourceInterval !== '1D') throw new MarketDataError('unsupported', `Alpha Vantage does not expose ${input.sourceInterval} as a source interval`);
    const providerResult = await this.daily.getHistoricalPrices(input.symbol, legacyRange(input.range));
    const normalized = normalizeCandles(providerResult.data.prices.map((bar) => validatedCandle({
      timestamp: Math.floor(Date.parse(`${bar.date}T00:00:00.000Z`) / 1_000),
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
    }))).candles.filter((bar) => bar.timestamp >= bounds.period1 && bar.timestamp <= bounds.period2);
    if (!normalized.length) throw new MarketDataError('insufficient-data', `No valid ${input.sourceInterval} candles were returned for ${input.symbol}`);
    return {
      symbol: input.symbol,
      provider: this.id,
      attemptedProviders: [this.id],
      requestedInterval: input.interval,
      actualInterval: input.sourceInterval,
      sourceInterval: input.sourceInterval,
      requestedRange: input.range,
      actualStart: normalized[0]?.timestamp ?? null,
      actualEnd: normalized.at(-1)?.timestamp ?? null,
      exchangeTimezone: 'America/New_York',
      currency: 'USD',
      dataStatus: candleStatus(providerResult.freshness, false),
      delayedByMinutes: null,
      adjusted: false,
      aggregated: false,
      cacheStatus: 'miss',
      candles: normalized,
      warnings: [
        'Historical prices are unadjusted',
      ],
      fallbackReason: null,
    };
  }
}
