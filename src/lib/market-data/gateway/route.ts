import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZodError, MarketDataError } from '../errors';

export interface GatewayEnvelope<T> {
  data: T | null;
  error?: ReturnType<MarketDataError['toApiError']>;
  meta: {
    provider: string | null;
    timestamp: string;
    requestId: string;
    provenance: 'market-data-gateway';
  };
}

export async function gatewayRouteResponse<T>(
  request: Pick<NextRequest, 'headers'>,
  operation: () => Promise<{ data: T; provider: string | null }>,
): Promise<NextResponse<GatewayEnvelope<T>>> {
  const supplied = request.headers.get('x-request-id');
  const requestId = supplied && /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : crypto.randomUUID();
  const timestamp = new Date().toISOString();
  try {
    const result = await operation();
    const response = NextResponse.json({
      data: result.data,
      meta: { provider: result.provider, timestamp, requestId, provenance: 'market-data-gateway' as const },
    });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Request-Id', requestId);
    return response;
  } catch (cause) {
    const error = cause instanceof ZodError ? fromZodError(cause)
      : cause instanceof MarketDataError ? cause
        : new MarketDataError('internal-error', 'Unexpected market data gateway error');
    const response = NextResponse.json({
      data: null,
      error: error.toApiError(),
      meta: { provider: null, timestamp, requestId, provenance: 'market-data-gateway' as const },
    }, { status: error.status });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Request-Id', requestId);
    if (error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
}

