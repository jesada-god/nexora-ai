import 'server-only';
import { serverEnv } from '@/src/config/env/server';
import { MarketDataError } from '../errors';
import { AlphaVantageProvider } from '../providers/alpha-vantage/provider';
import { AlphaVantageOptionsProvider } from '../providers/alpha-vantage/options';
import { OptionsMarketDataService } from './service';

let key: string | undefined;
let service: OptionsMarketDataService | undefined;

export function getOptionsMarketDataService(): OptionsMarketDataService {
  if (!serverEnv.ALPHA_VANTAGE_API_KEY) {
    throw new MarketDataError('provider-not-configured', 'Options provider is not configured');
  }
  if (!service || key !== serverEnv.ALPHA_VANTAGE_API_KEY) {
    key = serverEnv.ALPHA_VANTAGE_API_KEY;
    service = new OptionsMarketDataService(
      new AlphaVantageOptionsProvider(key),
      new AlphaVantageProvider(key),
    );
  }
  return service;
}
