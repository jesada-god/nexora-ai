import { SharedRequestCache } from '@/src/lib/shared-request-cache';
import { MarketDataError } from '../errors';
import type { ProviderResult } from '../types';
import type { IntradayProvider } from '../providers/alpha-vantage/intraday';
import {
  canonicalIntradaySeriesSchema,
  type CanonicalIntradaySeries,
  type IntradayProviderResult,
  type IntradayInterval,
  type IntradayRange,
  type IntradaySessionMode,
} from './contracts';

const POLICY = { freshMs: 60_000, staleMs: 15 * 60_000, errorMs: 30_000 } as const;
const SESSION_COUNTS: Record<IntradayRange, number> = { '1d': 1, '5d': 5, '1m': 22 };

function filterSessions(result: IntradayProviderResult, range: IntradayRange) {
  const dates = [...new Set(result.bars.map((bar) => bar.sessionDate))].sort();
  const selected = new Set(dates.slice(-SESSION_COUNTS[range]));
  return result.bars.filter((bar) => selected.has(bar.sessionDate));
}

function priority(error: MarketDataError): number {
  return error.code === 'rate-limited' ? 5
    : error.code === 'timeout' ? 4
      : error.code === 'forbidden' ? 3
        : error.code === 'unsupported' ? 2 : 1;
}

export class IntradayMarketDataService {
  constructor(
    private readonly providers: readonly IntradayProvider[],
    private readonly cache = new SharedRequestCache(),
  ) {}

  async getIntraday(
    symbol: string,
    interval: IntradayInterval,
    range: IntradayRange,
    sessionMode: IntradaySessionMode,
  ): Promise<ProviderResult<CanonicalIntradaySeries>> {
    if (!this.providers.length) throw new MarketDataError('provider-not-configured', 'Intraday provider is not configured');
    const failures: MarketDataError[] = [];
    for (const provider of this.providers) {
      try {
        const resolution = await this.cache.resolve(
          `intraday:${provider.id}:${symbol}:${interval}:${range}:${sessionMode}`,
          () => provider.getIntraday(symbol, interval, sessionMode),
          POLICY,
        );
        const cachedStatus = resolution.state === 'fresh'
          ? resolution.value.status
          : resolution.state === 'stale' ? 'stale' as const : 'cached' as const;
        const warnings = [...resolution.value.warnings];
        if (resolution.state !== 'fresh') warnings.push(resolution.state === 'stale' ? 'Serving stale intraday bars after a provider failure' : 'Serving server-cached intraday bars');
        const data = canonicalIntradaySeriesSchema.parse({
          symbol, interval, range, sessionMode,
          bars: filterSessions(resolution.value, range),
          exchangeTimezone: resolution.value.exchangeTimezone,
          provider: resolution.value.provider,
          asOf: resolution.value.asOf,
          status: cachedStatus,
          delayedMinutes: resolution.value.delayedMinutes,
          warnings,
        });
        if (!data.bars.length) throw new MarketDataError('insufficient-data', `No ${interval} bars are available in the requested range`);
        return {
          data,
          provider: data.provider,
          freshness: {
            status: data.status === 'live' ? 'realtime' : data.status,
            asOf: data.asOf,
            maxAgeSeconds: POLICY.freshMs / 1_000,
            staleWhileRevalidateSeconds: POLICY.staleMs / 1_000,
          },
        };
      } catch (cause) {
        failures.push(cause instanceof MarketDataError
          ? cause
          : new MarketDataError('provider-unavailable', 'Intraday provider failed'));
      }
    }
    throw failures.sort((left, right) => priority(right) - priority(left))[0]
      ?? new MarketDataError('provider-unavailable', 'Intraday data is unavailable');
  }
}
