import 'server-only';
import { serverEnv } from '@/src/config/env/server';
import { AlphaVantageFxProvider, FrankfurterFxProvider, type FxProvider } from './provider';

export function getFxProviders(): FxProvider[] {
  return [
    ...(serverEnv.ALPHA_VANTAGE_API_KEY ? [new AlphaVantageFxProvider(serverEnv.ALPHA_VANTAGE_API_KEY)] : []),
    new FrankfurterFxProvider(),
  ];
}
