import type { NextRequest } from 'next/server';
import { getOptionsMarketDataService } from '@/src/lib/market-data/options';
import { observedMarketDataResponse } from '@/src/lib/market-data/route';
import { optionExpirationsQuerySchema } from '@/src/lib/market-data/validation';
import { checkMarketDataRateLimit } from '@/src/lib/market-data/api-rate-limit';
import { NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const rate = checkMarketDataRateLimit(request, 'options-expirations');
  if (!rate.allowed) return NextResponse.json({ data: null, error: { code: 'rate-limited', message: 'Public market-data request limit exceeded', retryable: true, retryAfterSeconds: rate.retryAfterSeconds }, meta: { provider: null, timestamp: new Date().toISOString(), freshness: { status: 'unavailable', asOf: null, maxAgeSeconds: null } } }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds), 'Cache-Control': 'no-store' } });
  return observedMarketDataResponse(request, { route: '/api/market/options/expirations', symbol: request.nextUrl.searchParams.get('symbol') }, async () => {
    const query = optionExpirationsQuerySchema.parse({
      symbol: request.nextUrl.searchParams.get('symbol'),
    });
    return getOptionsMarketDataService().getExpirations(query.symbol);
  });
}
