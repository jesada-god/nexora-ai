import type { NextRequest } from 'next/server';
import { getIntradayMarketDataService } from '@/src/lib/market-data/intraday';
import { observedMarketDataResponse } from '@/src/lib/market-data/route';
import { intradayQuerySchema } from '@/src/lib/market-data/validation';
import { checkMarketDataRateLimit } from '@/src/lib/market-data/api-rate-limit';
import { NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const rate = checkMarketDataRateLimit(request, 'intraday-history');
  if (!rate.allowed) return NextResponse.json({ data: null, error: { code: 'rate-limited', message: 'Public market-data request limit exceeded', retryable: true, retryAfterSeconds: rate.retryAfterSeconds }, meta: { provider: null, timestamp: new Date().toISOString(), freshness: { status: 'unavailable', asOf: null, maxAgeSeconds: null } } }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds), 'Cache-Control': 'no-store' } });
  return observedMarketDataResponse(request, { route: '/api/market/history/intraday', symbol: request.nextUrl.searchParams.get('symbol') }, async () => {
    const query = intradayQuerySchema.parse({
      symbol: request.nextUrl.searchParams.get('symbol'),
      interval: request.nextUrl.searchParams.get('interval'),
      range: request.nextUrl.searchParams.get('range') ?? undefined,
      session: request.nextUrl.searchParams.get('session') ?? undefined,
    });
    return getIntradayMarketDataService().getIntraday(
      query.symbol,
      query.interval,
      query.range,
      query.session,
    );
  });
}
