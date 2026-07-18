import type { NextRequest } from 'next/server';
import { getHistoricalMarketDataService } from '@/src/lib/market-data';
import { historicalMarketDataResponse } from '@/src/lib/market-data/route';
import { historyQuerySchema, symbolSchema } from '@/src/lib/market-data/validation';

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  return historicalMarketDataResponse(async () => {
    const { symbol: rawSymbol } = await context.params;
    const symbol = symbolSchema.parse(rawSymbol);
    const { range } = historyQuerySchema.parse({
      range: request.nextUrl.searchParams.get('range') ?? undefined,
    });
    return getHistoricalMarketDataService().getHistoricalPrices(symbol, range);
  });
}
