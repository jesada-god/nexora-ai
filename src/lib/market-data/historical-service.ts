import { MarketDataError } from './errors';
import type { HistoricalPrices, HistoricalRange, ProviderResult } from './types';
import { StooqProviderError, type StooqFailureCode } from './providers/stooq/provider';

export interface HistoricalProvider {
  readonly id: string;
  getHistoricalPrices(symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>>;
}

export const HISTORICAL_CACHE_POLICY = {
  freshMs: 6 * 60 * 60_000,
  staleMs: 7 * 24 * 60 * 60_000,
} as const;

interface CacheEntry {
  result: ProviderResult<HistoricalPrices>;
  cachedAt: number;
  freshUntil: number;
  staleUntil: number;
}

function cacheResult(entry: CacheEntry, status: 'cached' | 'stale'): ProviderResult<HistoricalPrices> {
  const cachedAt = new Date(entry.cachedAt).toISOString();
  return {
    ...entry.result,
    data: { ...entry.result.data, cachedAt, freshness: status },
    freshness: {
      ...entry.result.freshness,
      status,
      cachedAt,
      maxAgeSeconds: status === 'stale' ? 60 : HISTORICAL_CACHE_POLICY.freshMs / 1000,
      staleWhileRevalidateSeconds: status === 'stale' ? 60 * 60 : HISTORICAL_CACHE_POLICY.staleMs / 1000,
    },
  };
}

type PrimaryFailureCode = 'PRIMARY_RATE_LIMITED' | 'PRIMARY_TIMEOUT' | 'PRIMARY_INVALID_RESPONSE';

function primaryFailureCode(error: MarketDataError): PrimaryFailureCode {
  if (error.code === 'rate-limited') return 'PRIMARY_RATE_LIMITED';
  if (error.code === 'timeout') return 'PRIMARY_TIMEOUT';
  return 'PRIMARY_INVALID_RESPONSE';
}

function fallbackFailureCode(error: MarketDataError): StooqFailureCode {
  return error instanceof StooqProviderError ? error.failureCode : 'FALLBACK_NETWORK_ERROR';
}

function logHistoricalFailure(input: { provider: string; failureCode: string; status: number; validRows: number }): void {
  console.warn(JSON.stringify({
    event: 'historical_provider_result',
    provider: input.provider,
    failureCode: input.failureCode,
    status: input.status,
    fallbackUsed: true,
    validRows: input.validRows,
  }));
}

export class HistoricalMarketDataService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<ProviderResult<HistoricalPrices>>>();
  private primaryBlockedUntil = 0;

  constructor(
    private readonly primary: HistoricalProvider,
    private readonly fallback: HistoricalProvider,
    private readonly now: () => number = Date.now,
    private readonly tertiaryFallback?: HistoricalProvider,
  ) {}

  async getHistoricalPrices(symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>> {
    const key = `${symbol}:${range}`;
    const currentTime = this.now();
    const cached = this.cache.get(key);
    if (cached && cached.freshUntil > currentTime) return cacheResult(cached, 'cached');
    if (cached && cached.staleUntil > currentTime) {
      void this.refresh(key, symbol, range).catch(() => undefined);
      return cacheResult(cached, 'stale');
    }
    return this.refresh(key, symbol, range);
  }

  private refresh(key: string, symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>> {
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const request = this.load(symbol, range).then((result) => {
      const cachedAt = this.now();
      const cachedAtIso = new Date(cachedAt).toISOString();
      const normalized = {
        ...result,
        data: {
          ...result.data,
          providerUsed: result.provider ?? this.primary.id,
          cachedAt: cachedAtIso,
          asOf: result.freshness.asOf,
          freshness: 'fresh' as const,
          methodology: 'Daily OHLCV normalized from the selected provider; no interpolation or synthetic candles',
          limitations: [...(result.data.limitations ?? []), 'Daily interval only', 'Missing or invalid candles are not fabricated'],
        },
        freshness: {
          ...result.freshness,
          maxAgeSeconds: HISTORICAL_CACHE_POLICY.freshMs / 1000,
          staleWhileRevalidateSeconds: HISTORICAL_CACHE_POLICY.staleMs / 1000,
        },
      };
      this.cache.set(key, {
        result: normalized,
        cachedAt,
        freshUntil: cachedAt + HISTORICAL_CACHE_POLICY.freshMs,
        staleUntil: cachedAt + HISTORICAL_CACHE_POLICY.freshMs + HISTORICAL_CACHE_POLICY.staleMs,
      });
      return normalized;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  private async load(symbol: string, range: HistoricalRange): Promise<ProviderResult<HistoricalPrices>> {
    let primaryError: unknown;
    const currentTime = this.now();
    if (currentTime < this.primaryBlockedUntil) {
      primaryError = new MarketDataError('rate-limited', 'Primary provider is in Retry-After cooldown', Math.max(1, Math.ceil((this.primaryBlockedUntil - currentTime) / 1000)));
    } else {
      try {
        const result = await this.primary.getHistoricalPrices(symbol, range);
        return {
          ...result,
          provider: result.provider ?? this.primary.id,
          data: { ...result.data, providerUsed: result.provider ?? this.primary.id, fallbackReason: null },
        };
      } catch (cause) {
        primaryError = cause;
        if (cause instanceof MarketDataError && cause.code === 'rate-limited') {
          this.primaryBlockedUntil = currentTime + (cause.retryAfterSeconds ?? 60) * 1000;
        }
      }
    }

    try {
      const result = await this.fallback.getHistoricalPrices(symbol, range);
      const primary = primaryError instanceof MarketDataError ? primaryError : new MarketDataError('upstream-unavailable', 'Primary provider failed');
      const reason = primaryFailureCode(primary);
      logHistoricalFailure({ provider: result.provider ?? this.fallback.id, failureCode: reason, status: 200, validRows: result.data.prices.length });
      return {
        ...result,
        provider: result.provider ?? this.fallback.id,
        data: { ...result.data, providerUsed: result.provider ?? this.fallback.id, fallbackReason: reason },
      };
    } catch (fallbackError) {
      const primary = primaryError instanceof MarketDataError ? primaryError : new MarketDataError('upstream-unavailable', 'Primary provider failed');
      let fallback = fallbackError instanceof MarketDataError ? fallbackError : new MarketDataError('upstream-unavailable', 'Fallback provider failed');
      const primaryReason = primaryFailureCode(primary);
      let fallbackReason: string = fallbackFailureCode(fallback);
      if (this.tertiaryFallback) {
        try {
          const result = await this.tertiaryFallback.getHistoricalPrices(symbol, range);
          logHistoricalFailure({
            provider: result.provider ?? this.tertiaryFallback.id,
            failureCode: fallbackReason,
            status: 200,
            validRows: result.data.prices.length,
          });
          return {
            ...result,
            provider: result.provider ?? this.tertiaryFallback.id,
            data: {
              ...result.data,
              providerUsed: result.provider ?? this.tertiaryFallback.id,
              fallbackReason: primaryReason,
              limitations: [`Stooq unavailable: ${fallbackReason}`],
            },
          };
        } catch (tertiaryError) {
          fallback = tertiaryError instanceof MarketDataError
            ? tertiaryError
            : new MarketDataError('upstream-unavailable', 'Tertiary fallback provider failed');
          fallbackReason = `${fallbackReason}; TERTIARY_${fallback.code.toUpperCase().replaceAll('-', '_')}`;
        }
      }
      logHistoricalFailure({
        provider: this.tertiaryFallback?.id ?? this.fallback.id,
        failureCode: fallbackReason,
        status: fallback.status,
        validRows: fallback instanceof StooqProviderError ? fallback.validRows : 0,
      });
      const previous = this.cache.get(`${symbol}:${range}`);
      const retryAfterSeconds = primary.code === 'rate-limited'
        ? primary.retryAfterSeconds ?? Math.max(1, Math.ceil((this.primaryBlockedUntil - this.now()) / 1000))
        : fallback.retryAfterSeconds;
      const finalCode = primary.code === 'rate-limited' || primary.code === 'timeout'
        ? primary.code
        : fallback.code === 'insufficient-data' ? 'insufficient-data' : 'invalid-provider-response';
      throw new MarketDataError(
        finalCode,
        'Historical OHLCV is temporarily unavailable',
        retryAfterSeconds,
        undefined,
        {
          reason: `${primaryReason}; ${fallbackReason}`,
          primaryReason,
          fallbackReason,
          lastAvailableAt: previous ? new Date(previous.cachedAt).toISOString() : null,
        },
      );
    }
  }
}
