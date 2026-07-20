import type { NextRequest } from 'next/server';
import { getMarketDataGateway } from '@/src/lib/market-data/gateway/service';
import { gatewayRouteResponse } from '@/src/lib/market-data/gateway/route';
import { symbolSchema } from '@/src/lib/market-data/validation';

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  return gatewayRouteResponse(request, async () => {
    const symbol = symbolSchema.parse((await context.params).symbol);
    const gateway = getMarketDataGateway();
    const instrument = await gateway.resolveInstrument(symbol);
    const session = await gateway.getSession({ instrument });
    return { data: { instrument, session }, provider: session.provider };
  });
}

