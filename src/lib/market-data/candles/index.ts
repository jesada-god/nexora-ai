import 'server-only';
import { serverEnv } from '@/src/config/env/server';
import { AlphaVantageCandleProvider } from '../providers/alpha-vantage/candles';
import { FinancialModelingPrepCandleProvider } from '../providers/financial-modeling-prep/candles';
import type { NormalizedMarketDataProvider } from './contracts';
import { CandleMarketDataService } from './service';

let configurationKey = '';
let service: CandleMarketDataService | undefined;

export function getCandleMarketDataService(): CandleMarketDataService {
  const nextKey = `${serverEnv.FMP_API_KEY ?? ''}\u0000${serverEnv.ALPHA_VANTAGE_API_KEY ?? ''}`;
  if (!service || nextKey !== configurationKey) {
    configurationKey = nextKey;
    const providers: NormalizedMarketDataProvider[] = [];
    if (serverEnv.FMP_API_KEY) providers.push(new FinancialModelingPrepCandleProvider(serverEnv.FMP_API_KEY));
    if (serverEnv.ALPHA_VANTAGE_API_KEY) providers.push(new AlphaVantageCandleProvider(serverEnv.ALPHA_VANTAGE_API_KEY));
    service = new CandleMarketDataService(providers);
  }
  return service;
}

export type {
  CandleDataStatus,
  CandleInterval,
  CandleRange,
  CandleRequest,
  CandleSession,
  NormalizedCandle,
  NormalizedCandleResult,
  NormalizedMarketDataProvider,
  ProviderCapabilities,
  TimeframeCapability,
} from './contracts';
