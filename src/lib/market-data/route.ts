import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { MARKET_DATA_PROVIDER_ID } from './index';
import { fromZodError, MarketDataError } from './errors';
import type { MarketDataEnvelope, ProviderResult } from './types';

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
      response.headers.set(
        'Cache-Control',
        `public, s-maxage=${result.freshness.maxAgeSeconds}, stale-while-revalidate=${result.freshness.maxAgeSeconds * 2}`,
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
