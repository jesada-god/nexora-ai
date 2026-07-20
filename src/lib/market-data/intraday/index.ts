import 'server-only';
import { serverEnv } from '@/src/config/env/server';
import { AlphaVantageIntradayProvider, type IntradayProvider } from '../providers/alpha-vantage/intraday';
import { FinancialModelingPrepIntradayProvider } from '../providers/financial-modeling-prep/intraday';
import { IntradayMarketDataService } from './service';

let configurationKey = '';
let service: IntradayMarketDataService | undefined;

export function getIntradayMarketDataService(): IntradayMarketDataService {
  const nextKey = `${serverEnv.ALPHA_VANTAGE_API_KEY ?? ''}\u0000${serverEnv.FMP_API_KEY ?? ''}`;
  if (!service || configurationKey !== nextKey) {
    configurationKey = nextKey;
    const providers: IntradayProvider[] = [];
    if (serverEnv.ALPHA_VANTAGE_API_KEY) providers.push(new AlphaVantageIntradayProvider(serverEnv.ALPHA_VANTAGE_API_KEY));
    if (serverEnv.FMP_API_KEY) providers.push(new FinancialModelingPrepIntradayProvider(serverEnv.FMP_API_KEY));
    service = new IntradayMarketDataService(providers);
  }
  return service;
}
