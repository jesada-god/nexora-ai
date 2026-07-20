import type { CandleInterval, HistoricalRange, MarketSessionMode, ResolvedInstrument } from './contracts';

export function gatewayBarsCacheKey(input: {
  provider: string;
  instrument: ResolvedInstrument;
  interval: CandleInterval;
  range: HistoricalRange;
  adjusted: boolean;
  session: MarketSessionMode;
  from?: number;
  to?: number;
}): string {
  return [
    'market-gateway', input.provider, input.instrument.canonicalSymbol,
    input.instrument.providerSymbol, input.interval, input.range,
    input.adjusted, input.session, input.from ?? '', input.to ?? '',
  ].join(':');
}

