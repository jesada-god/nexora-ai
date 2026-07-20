import type { NextRequest } from 'next/server';
import { getMarketDataGateway } from '@/src/lib/market-data/gateway/service';
import { observedMarketDataResponse } from '@/src/lib/market-data/route';
import { symbolSchema } from '@/src/lib/market-data/validation';

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  const rawSymbol = (await context.params).symbol;
  const response = await observedMarketDataResponse(
    request,
    { route: '/api/market/quote/[symbol]', symbol: rawSymbol },
    async () => {
      const symbol = symbolSchema.parse(rawSymbol);
      const gateway = getMarketDataGateway();
      const instrument = await gateway.resolveInstrument(symbol);
      const quote = await gateway.getQuote({ instrument });
      return {
        data: {
          symbol: quote.symbol,
          currency: quote.currency,
          price: quote.price,
          open: quote.open ?? null,
          high: quote.high ?? null,
          low: quote.low ?? null,
          previousClose: quote.previousClose,
          change: quote.change,
          changePercent: quote.changePercent,
          volume: quote.volume == null ? null : Math.round(quote.volume),
          latestTradingDay: new Date(quote.timestamp * 1_000).toISOString().slice(0, 10),
        },
        provider: quote.provider,
        freshness: {
          status: quote.status === 'real-time' ? 'realtime' as const : quote.status,
          asOf: new Date(quote.timestamp * 1_000).toISOString(),
          maxAgeSeconds: quote.status === 'real-time' ? 15 : 60,
        },
      };
    },
  );
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Market-Data-Provenance', 'market-data-gateway');
  return response;
}
