import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { checkMarketDataRateLimit } from '@/src/lib/market-data/api-rate-limit';
import { getCandleMarketDataService } from '@/src/lib/market-data/candles';
import { candleQuerySchema } from '@/src/lib/market-data/candles/contracts';
import { observedMarketDataResponse } from '@/src/lib/market-data/route';

export async function GET(request: NextRequest) {
  const rate = checkMarketDataRateLimit(request, 'candles');
  if (!rate.allowed) {
    return NextResponse.json({
      data: null,
      error: { code: 'rate-limited', message: 'Public market-data request limit exceeded', retryable: true, retryAfterSeconds: rate.retryAfterSeconds },
      meta: { provider: null, timestamp: new Date().toISOString(), freshness: { status: 'unavailable', asOf: null, maxAgeSeconds: null } },
    }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds), 'Cache-Control': 'private, no-store' } });
  }
  const response = await observedMarketDataResponse(
    request,
    { route: '/api/market/candles', symbol: request.nextUrl.searchParams.get('symbol') },
    async () => {
      const query = candleQuerySchema.parse({
        symbol: request.nextUrl.searchParams.get('symbol'),
        interval: request.nextUrl.searchParams.get('interval') ?? undefined,
        range: request.nextUrl.searchParams.get('range') ?? undefined,
        adjusted: request.nextUrl.searchParams.get('adjusted') ?? undefined,
        session: request.nextUrl.searchParams.get('session') ?? undefined,
        period1: request.nextUrl.searchParams.get('period1') ?? undefined,
        period2: request.nextUrl.searchParams.get('period2') ?? undefined,
      });
      return getCandleMarketDataService().getCandles(query);
    },
  );
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

