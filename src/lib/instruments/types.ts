export type InstrumentStatus = 'active' | 'delisted';
export type InstrumentAssetType = 'Stock' | 'ETF';

export interface MarketInstrumentInput {
  provider_symbol: string;
  symbol: string;
  name: string;
  exchange: string | null;
  asset_type: InstrumentAssetType;
  currency: string;
  country: string;
  status: InstrumentStatus;
  ipo_date: string | null;
  delisting_date: string | null;
}

export interface InstrumentSyncParseResult {
  instruments: MarketInstrumentInput[];
  failed: number;
  errors: Array<{ row: number; code: string; message: string }>;
}

export interface InstrumentSyncCounts {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

