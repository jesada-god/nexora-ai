import { getMarketDataProvider } from '@/src/lib/market-data';
import { marketDataResponse } from '@/src/lib/market-data/route';
import { symbolSchema } from '@/src/lib/market-data/validation';

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  return marketDataResponse(async () => {
    const { symbol: rawSymbol } = await context.params;
    const symbol = symbolSchema.parse(rawSymbol);
    return getMarketDataProvider().getQuote(symbol);
  });
}
