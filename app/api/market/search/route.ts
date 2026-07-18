import type { NextRequest } from 'next/server';
import { getMarketDataProvider } from '@/src/lib/market-data';
import { marketDataResponse } from '@/src/lib/market-data/route';
import { searchParamsSchema } from '@/src/lib/market-data/validation';

export async function GET(request: NextRequest) {
  return marketDataResponse(async () => {
    const { q, assetType, includeDelisted, limit } = searchParamsSchema.parse({
      q: request.nextUrl.searchParams.get('q') ?? '',
      assetType: request.nextUrl.searchParams.get('assetType') ?? undefined,
      includeDelisted: request.nextUrl.searchParams.get('includeDelisted') ?? undefined,
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
    });
    const { searchInstrumentMaster } = await import('@/src/lib/instruments/search');
    const master = await searchInstrumentMaster(q, { assetType, includeDelisted, limit });
    const { resolveInstrumentSearch } = await import('@/src/lib/instruments/search-resolution');
    return resolveInstrumentSearch(master, getMarketDataProvider, q, { assetType, includeDelisted, limit });
  });
}
