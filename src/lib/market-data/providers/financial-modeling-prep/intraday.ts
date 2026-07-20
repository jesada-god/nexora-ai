import 'server-only';
import { z, ZodError } from 'zod';
import { MarketDataError } from '../../errors';
import { ProviderHttpClient } from '../../provider-http';
import { classifyUsEquitySession, exchangeSessionDate, US_EQUITY_TIMEZONE, zonedLocalToUtc } from '../../session';
import type { IntradayInterval, IntradayProviderResult, IntradaySessionMode } from '../../intraday/contracts';
import { normalizeCanonicalIntradayBars } from '../../intraday/normalize';
import type { IntradayProvider } from '../alpha-vantage/intraday';

const INTERVALS: Record<IntradayInterval, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '60m': '1hour',
};
const rowSchema = z.object({
  date: z.string(), open: z.number().finite(), high: z.number().finite(),
  low: z.number().finite(), close: z.number().finite(),
  volume: z.number().finite().nullable().optional(),
});

export class FinancialModelingPrepIntradayProvider implements IntradayProvider {
  readonly id = 'financial-modeling-prep';

  constructor(
    private readonly apiKey: string,
    private readonly http = new ProviderHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getIntraday(symbol: string, interval: IntradayInterval, sessionMode: IntradaySessionMode): Promise<IntradayProviderResult> {
    if (sessionMode === 'extended') {
      throw new MarketDataError('unsupported', 'FMP does not expose a verified regular/extended session selector for this endpoint');
    }
    const url = new URL(`https://financialmodelingprep.com/stable/historical-chart/${INTERVALS[interval]}`);
    url.searchParams.set('symbol', symbol);
    const payload = await this.http.json({
      provider: this.id, operation: `intraday-${interval}`,
      route: '/api/market/history/intraday', symbol, url,
      init: { cache: 'no-store', headers: { apikey: this.apiKey } }, timeoutMs: 10_000,
    });
    try {
      const rows = z.array(rowSchema).parse(payload);
      const retrievedAt = this.now().toISOString();
      const candidates = rows.flatMap((row) => {
        const timestamp = zonedLocalToUtc(row.date, US_EQUITY_TIMEZONE);
        if (!timestamp) return [];
        const sessionType = classifyUsEquitySession(timestamp, US_EQUITY_TIMEZONE);
        const sessionDate = exchangeSessionDate(timestamp, US_EQUITY_TIMEZONE);
        if (sessionType !== 'regular' || !sessionDate) return [];
        const volume = row.volume == null || !Number.isInteger(row.volume) || row.volume < 0 ? null : row.volume;
        return [{
          timestamp, sessionDate, open: row.open, high: row.high, low: row.low, close: row.close,
          volume, interval, exchangeTimezone: US_EQUITY_TIMEZONE, sessionType,
          provider: this.id, asOf: retrievedAt,
        }];
      });
      const bars = normalizeCanonicalIntradayBars(candidates);
      if (!bars.length) throw new MarketDataError('insufficient-data', `No valid ${interval} bars were returned for ${symbol}`);
      return {
        symbol, interval, sessionMode, bars, exchangeTimezone: US_EQUITY_TIMEZONE,
        provider: this.id, asOf: bars.at(-1)?.timestamp ?? retrievedAt,
        status: 'delayed', delayedMinutes: null,
        warnings: ['Provider response omits exchange timezone and explicit delay; US equity timezone is disclosed and freshness remains delayed'],
      };
    } catch (cause) {
      if (cause instanceof MarketDataError) throw cause;
      if (cause instanceof ZodError) throw new MarketDataError('invalid-provider-response', 'Secondary intraday response did not match its validated schema');
      throw cause;
    }
  }
}
