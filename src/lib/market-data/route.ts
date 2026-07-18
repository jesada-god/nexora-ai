import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { MARKET_DATA_PROVIDER_ID } from './index';
import { fromZodError, MarketDataError } from './errors';
import type { HistoricalPrices, HistoricalUnavailableData, MarketDataEnvelope, ProviderResult } from './types';

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
