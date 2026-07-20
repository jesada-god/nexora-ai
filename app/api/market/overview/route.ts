import { getMarketDataProvider } from '@/src/lib/market-data';
import { marketDataResponse } from '@/src/lib/market-data/route';

export async function GET() {
  const response = await marketDataResponse(() => getMarketDataProvider().getMarketOverview());
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
