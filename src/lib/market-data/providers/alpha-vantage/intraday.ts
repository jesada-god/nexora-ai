import 'server-only';
import { z, ZodError } from 'zod';
import { MarketDataError } from '../../errors';
import { ProviderHttpClient } from '../../provider-http';
import { classifyUsEquitySession, exchangeSessionDate, US_EQUITY_TIMEZONE, zonedLocalToUtc } from '../../session';
import type { IntradayInterval, IntradayProviderResult, IntradaySessionMode } from '../../intraday/contracts';
import { normalizeCanonicalIntradayBars } from '../../intraday/normalize';

const BASE_URL = 'https://www.alphavantage.co/query';
const INTERVALS: Record<IntradayInterval, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '60m': '60min',
};
const rawBarSchema = z.object({
  '1. open': z.string(), '2. high': z.string(), '3. low': z.string(),
  '4. close': z.string(), '5. volume': z.string().optional(),
});

export interface IntradayProvider {
  readonly id: string;
  getIntraday(symbol: string, interval: IntradayInterval, sessionMode: IntradaySessionMode): Promise<IntradayProviderResult>;
}

function providerTimezone(value: unknown): string {
  return value === 'US/Eastern' || value === 'America/New_York'
    ? US_EQUITY_TIMEZONE
    : US_EQUITY_TIMEZONE;
}

export class AlphaVantageIntradayProvider implements IntradayProvider {
  readonly id = 'alpha-vantage';

  constructor(
    private readonly apiKey: string,
    private readonly http = new ProviderHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getIntraday(symbol: string, interval: IntradayInterval, sessionMode: IntradaySessionMode): Promise<IntradayProviderResult> {
    const url = new URL(BASE_URL);
    url.searchParams.set('function', 'TIME_SERIES_INTRADAY');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', INTERVALS[interval]);
    url.searchParams.set('adjusted', 'false');
    url.searchParams.set('extended_hours', sessionMode === 'extended' ? 'true' : 'false');
    url.searchParams.set('outputsize', 'full');
    url.searchParams.set('apikey', this.apiKey);
    const payload = await this.http.json({
      provider: this.id, operation: `intraday-${interval}`,
      route: '/api/market/history/intraday', symbol, url,
      init: { cache: 'no-store' }, timeoutMs: 10_000,
    });
    try {
      const record = z.record(z.string(), z.unknown()).parse(payload);
      const meta = z.record(z.string(), z.unknown()).parse(record['Meta Data']);
      const timeZone = providerTimezone(meta['6. Time Zone']);
      const seriesKey = `Time Series (${INTERVALS[interval]})`;
      const series = z.record(z.string(), z.unknown()).parse(record[seriesKey]);
      const retrievedAt = this.now().toISOString();
      const candidates = Object.entries(series).flatMap(([localTimestamp, raw]) => {
        const timestamp = zonedLocalToUtc(localTimestamp, timeZone);
        const parsed = rawBarSchema.safeParse(raw);
        if (!timestamp || !parsed.success) return [];
        const sessionType = classifyUsEquitySession(timestamp, timeZone);
        const sessionDate = exchangeSessionDate(timestamp, timeZone);
        if (!sessionType || !sessionDate || (sessionMode === 'regular' && sessionType !== 'regular')) return [];
        const volume = parsed.data['5. volume'] === undefined ? null : Number(parsed.data['5. volume']);
        return [{
          timestamp, sessionDate,
          open: Number(parsed.data['1. open']), high: Number(parsed.data['2. high']),
          low: Number(parsed.data['3. low']), close: Number(parsed.data['4. close']),
          volume: volume !== null && Number.isInteger(volume) && volume >= 0 ? volume : null,
          interval, exchangeTimezone: timeZone, sessionType,
          provider: this.id, asOf: retrievedAt,
        }];
      });
      const bars = normalizeCanonicalIntradayBars(candidates);
      if (!bars.length) throw new MarketDataError('insufficient-data', `No valid ${interval} bars were returned for ${symbol}`);
      return {
        symbol, interval, sessionMode, bars, exchangeTimezone: timeZone,
        provider: this.id, asOf: retrievedAt, status: 'delayed', delayedMinutes: null,
        warnings: ['Provider entitlement was not requested as realtime; bars are not labelled real-world realtime'],
      };
    } catch (cause) {
      if (cause instanceof MarketDataError) throw cause;
      if (cause instanceof ZodError) throw new MarketDataError('invalid-provider-response', 'Intraday provider response did not match its validated schema');
      throw cause;
    }
  }
}
