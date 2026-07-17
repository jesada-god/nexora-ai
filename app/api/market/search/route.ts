import type { NextRequest } from 'next/server';
import { getMarketDataProvider } from '@/src/lib/market-data';
import { marketDataResponse } from '@/src/lib/market-data/route';
import { searchParamsSchema } from '@/src/lib/market-data/validation';

export async function GET(request: NextRequest) {
  return marketDataResponse(async () => {
    const { q } = searchParamsSchema.parse({ q: request.nextUrl.searchParams.get('q') ?? '' });
    return getMarketDataProvider().search(q);
  });
}
