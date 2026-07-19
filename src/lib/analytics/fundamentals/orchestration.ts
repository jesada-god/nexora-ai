import 'server-only';
import { getHistoricalMarketDataService, getMarketDataProvider } from '@/src/lib/market-data';
import { calculateKeyStatistics } from './calculations';
import { getFundamentalsProvider } from './provider';

export async function loadKeyStatistics(symbol: string) {
  const market = getMarketDataProvider(); const fundamentals = getFundamentalsProvider();
  const [quote, profile, history, financials] = await Promise.all([
    market.getQuote(symbol), market.getCompanyProfile(symbol), getHistoricalMarketDataService().getHistoricalPrices(symbol, '1y'),
    fundamentals?.getFinancialPeriods(symbol).catch(() => null) ?? Promise.resolve(null),
  ]);
  const latestPeriod = financials?.periods.at(-1);
  const quoteAge = quote.freshness.asOf ? Date.now() - Date.parse(quote.freshness.asOf) : Infinity;
  const freshness = quoteAge > 7 * 86_400_000 ? { ...quote.freshness, status: 'stale' as const } : quote.freshness;
  return calculateKeyStatistics({ symbol, currency: profile.data.currency, provider: quote.provider ?? market.id, price: quote.data.price, priceAsOf: quote.freshness.asOf, freshness, currentVolume: quote.data.volume, marketCap: profile.data.marketCapitalization, dilutedEpsTtm: financials?.dilutedEpsTtm, dilutedEpsCurrency: financials?.currency, fundamentalsProvider: fundamentals?.id ?? null, fundamentalsAsOf: financials?.dilutedEpsAsOf ?? financials?.asOf ?? null, fundamentalsMissingInputs: financials?.missingInputs ?? ['fundamentalsProvider'], dilutedShares: latestPeriod?.dilutedShares, history: history.data.prices });
}
