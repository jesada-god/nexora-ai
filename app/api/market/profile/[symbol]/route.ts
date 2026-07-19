import { getCompanyProfileService } from '@/src/lib/market-data';
import { companyProfileMarketDataResponse } from '@/src/lib/market-data/route';
import { symbolSchema } from '@/src/lib/market-data/validation';

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  return companyProfileMarketDataResponse(async () => {
    const { symbol: rawSymbol } = await context.params;
    const symbol = symbolSchema.parse(rawSymbol);
    return getCompanyProfileService().getCompanyProfile(symbol);
  });
}
