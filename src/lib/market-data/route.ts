import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { MARKET_DATA_PROVIDER_ID } from './index';
import { fromZodError, MarketDataError } from './errors';
import type {
  CompanyProfile,
  HistoricalPrices,
  HistoricalUnavailableData,
  MarketDataEnvelope,
  ProviderResult,
} from './types';
import type { CompanyProfileResult } from './profile-service';

const unavailableFreshness = {
  status: 'unavailable' as const,
  asOf: null,
  maxAgeSeconds: null,
};

export async function marketDataResponse<T>(
  operation: () => Promise<ProviderResult<T>>,
): Promise<NextResponse<MarketDataEnvelope<T>>> {
  try {
    const result = await operation();
    const response = NextResponse.json({
      data: result.data,
      meta: {
        provider: result.provider ?? MARKET_DATA_PROVIDER_ID,
        timestamp: new Date().toISOString(),
        freshness: result.freshness,
      },
    });
    if (result.freshness.maxAgeSeconds !== null) {
      const staleWhileRevalidate = result.freshness.staleWhileRevalidateSeconds
        ?? result.freshness.maxAgeSeconds * 2;
      response.headers.set(
        'Cache-Control',
        `public, s-maxage=${result.freshness.maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidate}`,
      );
    }
    return response;
  } catch (cause) {
    const error = cause instanceof ZodError
      ? fromZodError(cause)
      : cause instanceof MarketDataError
        ? cause
        : new MarketDataError('internal-error', 'Unexpected market data error');
    const response = NextResponse.json({
      data: null,
      error: error.toApiError(),
      meta: {
        provider: MARKET_DATA_PROVIDER_ID,
        timestamp: new Date().toISOString(),
        freshness: unavailableFreshness,
      },
    }, { status: error.status });
    response.headers.set('Cache-Control', 'no-store');
    if (error.retryAfterSeconds) {
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
    }
    return response;
  }
}

export async function companyProfileMarketDataResponse(
  operation: () => Promise<CompanyProfileResult>,
): Promise<NextResponse> {
  try {
    const result = await operation();
    const response = NextResponse.json({
      data: result.data satisfies CompanyProfile,
      status: result.profileStatus,
      providerUsed: result.providerUsed,
      fallbackUsed: result.fallbackUsed,
      cachedAt: result.cachedAt,
      retryAfterSeconds: result.retryAfterSeconds,
      reasonCode: result.reasonCode,
      meta: {
        provider: result.providerUsed,
        timestamp: new Date().toISOString(),
        freshness: result.freshness,
      },
    });
    if (result.freshness.maxAgeSeconds !== null) {
      const staleWhileRevalidate = result.freshness.staleWhileRevalidateSeconds
        ?? result.freshness.maxAgeSeconds * 2;
      response.headers.set(
        'Cache-Control',
        `public, s-maxage=${result.freshness.maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidate}`,
      );
    }
    if (result.retryAfterSeconds > 0) {
      response.headers.set('Retry-After', String(result.retryAfterSeconds));
    }
    return response;
  } catch (cause) {
    const error = cause instanceof ZodError
      ? fromZodError(cause)
      : cause instanceof MarketDataError
        ? cause
        : new MarketDataError(
          'internal-error',
          'Unexpected company profile error',
        );
    const preservesOwnStatus = new Set([
      'invalid-request',
      'invalid-symbol',
      'not-found',
    ]).has(error.code);
    const status = error.code === 'rate-limited'
      ? 429
      : preservesOwnStatus ? error.status : 503;
    const retryAfterSeconds = error.retryAfterSeconds ?? 0;
    const response = NextResponse.json({
      data: null,
      status: 'unavailable',
      providerUsed: null,
      fallbackUsed: Boolean(error.context?.fallbackReason),
      cachedAt: null,
      retryAfterSeconds,
      reasonCode: error.context?.reason ?? error.code,
      error: error.toApiError(),
      meta: {
        provider: null,
        timestamp: new Date().toISOString(),
        freshness: unavailableFreshness,
      },
    }, { status });
    response.headers.set('Cache-Control', 'no-store');
    if (retryAfterSeconds > 0) {
      response.headers.set('Retry-After', String(retryAfterSeconds));
    }
    return response;
  }
}

export async function historicalMarketDataResponse(
  operation: () => Promise<ProviderResult<HistoricalPrices>>,
): Promise<NextResponse<MarketDataEnvelope<HistoricalPrices | HistoricalUnavailableData>>> {
  try {
    const result = await operation();
    const response = NextResponse.json({
      data: result.data,
      meta: {
        provider: result.provider ?? MARKET_DATA_PROVIDER_ID,
        timestamp: new Date().toISOString(),
        freshness: result.freshness,
      },
    });
    if (result.freshness.maxAgeSeconds !== null) {
      const staleWhileRevalidate = result.freshness.staleWhileRevalidateSeconds
        ?? result.freshness.maxAgeSeconds * 2;
      response.headers.set('Cache-Control', `public, s-maxage=${result.freshness.maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidate}`);
    }
    return response;
  } catch (cause) {
    const error = cause instanceof ZodError
      ? fromZodError(cause)
      : cause instanceof MarketDataError
        ? cause
        : new MarketDataError('internal-error', 'Unexpected historical market data error');
    const unavailable: HistoricalUnavailableData = {
      status: 'unavailable',
      reason: error.context?.reason ?? error.code,
      primaryReason: error.context?.primaryReason ?? 'PRIMARY_INVALID_RESPONSE',
      fallbackReason: error.context?.fallbackReason ?? 'FALLBACK_NETWORK_ERROR',
      retryable: error.retryable,
      retryAfter: error.retryAfterSeconds ? new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString() : null,
      retryAfterSeconds: error.retryAfterSeconds ?? 0,
      lastAvailableAt: error.context?.lastAvailableAt ?? null,
    };
    const response = NextResponse.json({
      data: unavailable,
      error: error.toApiError(),
      meta: { provider: null, timestamp: new Date().toISOString(), freshness: unavailableFreshness },
    }, { status: error.status });
    response.headers.set('Cache-Control', 'no-store');
    if (error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
}
