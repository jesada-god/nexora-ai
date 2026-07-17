import { getMarketDataProvider } from '@/src/lib/market-data';
import { marketDataResponse } from '@/src/lib/market-data/route';

export async function GET() {
  return marketDataResponse(() => getMarketDataProvider().getMarketOverview());
}
