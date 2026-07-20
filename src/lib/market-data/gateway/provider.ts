import type {
  CandleInterval,
  HistoricalRange,
  MarketSessionMode,
  NormalizedBarsResult,
  NormalizedMarketSession,
  NormalizedQuote,
  ResolvedInstrument,
} from './contracts';

export interface MarketDataProviderV2 {
  readonly id: string;
  getQuote(instrument: ResolvedInstrument): Promise<NormalizedQuote>;
  getSession(instrument: ResolvedInstrument): Promise<NormalizedMarketSession>;
  getBars(input: {
    instrument: ResolvedInstrument;
    interval: CandleInterval;
    range: HistoricalRange;
    adjusted: boolean;
    session: MarketSessionMode;
  }): Promise<NormalizedBarsResult>;
}

export interface OptionsMarketDataProvider {
  getExpirations(symbol: string): Promise<unknown>;
  getChain(symbol: string, expiration: string): Promise<unknown>;
  getContractSnapshot(contract: string): Promise<unknown>;
}

