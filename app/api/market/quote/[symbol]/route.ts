import { getHistoricalMarketDataService, getMarketDataProvider } from '@/src/lib/market-data';
import { marketDataResponse } from '@/src/lib/market-data/route';
import { symbolSchema } from '@/src/lib/market-data/validation';
import { loadQuoteWithHistoryFallback } from '@/src/lib/stock-detail/load';

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  return marketDataResponse(async () => {
    const { symbol: rawSymbol } = await context.params;
    const symbol = symbolSchema.parse(rawSymbol);
    let provider: ReturnType<typeof getMarketDataProvider> | null = null;
    try {
      provider = getMarketDataProvider();
    } catch {
      // Daily history can still provide a verified previous-trading-day quote.
    }
    return loadQuoteWithHistoryFallback(symbol, provider, getHistoricalMarketDataService());
  });
}
