import { getHistoricalMarketDataService, getMarketDataProvider } from '@/src/lib/market-data';
import { getIntradayMarketDataService } from '@/src/lib/market-data/intraday';
import { marketDataResponse } from '@/src/lib/market-data/route';
import { symbolSchema } from '@/src/lib/market-data/validation';
import { loadQuoteWithHistoryFallback } from '@/src/lib/stock-detail/load';

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  const response = await marketDataResponse(async () => {
    const { symbol: rawSymbol } = await context.params;
    const symbol = symbolSchema.parse(rawSymbol);
    let provider: ReturnType<typeof getMarketDataProvider> | null = null;
    try {
      provider = getMarketDataProvider();
    } catch {
      // Daily history can still provide a verified previous-trading-day quote.
    }
    if (provider) {
      try {
        return await provider.getQuote(symbol);
      } catch {
        // A verified intraday close is a better fallback than an older daily bar.
      }
    }
    for (const session of ['extended', 'regular'] as const) {
      try {
        const result = await getIntradayMarketDataService().getIntraday(symbol, '1m', '1d', session);
        const latest = result.data.bars.at(-1);
        if (!latest) continue;
        return {
          data: {
            symbol,
            price: latest.close,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            previousClose: null,
            change: null,
            changePercent: null,
            volume: latest.volume,
            latestTradingDay: latest.sessionDate,
          },
          freshness: result.freshness,
          provider: `${result.provider ?? result.data.provider} (${latest.sessionType} intraday fallback)`,
        };
      } catch {
        // Fall through to verified daily history; no candle is synthesized.
      }
    }
    return loadQuoteWithHistoryFallback(symbol, null, getHistoricalMarketDataService());
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
