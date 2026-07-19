import 'server-only';
import { serverEnv } from '@/src/config/env/server';
import type { FinancialPeriod } from '../valuation/types';
import { AlphaVantageFundamentalsProvider } from './providers/alpha-vantage';
import type { NormalizedFinancialRecord } from './normalize';

export interface FundamentalsDiagnostics {
  provider: string;
  capabilities: string[];
  datasets: Record<string, 'available' | 'unavailable'>;
  cache: Record<string, 'hit' | 'miss' | 'stale'>;
  datasetFetchedAt: Record<string, string | null>;
  latencyMs: number;
  normalizedPeriodCount: { annual: number; quarterly: number };
}

export interface FundamentalsSnapshot {
  symbol: string;
  periods: FinancialPeriod[];
  quarterlyPeriods: FinancialPeriod[];
  annualRecords: NormalizedFinancialRecord[];
  quarterlyRecords: NormalizedFinancialRecord[];
  asOf: string;
  fetchedAt: string;
  currency: string;
  dilutedEpsTtm: number | null;
  dilutedEpsAsOf: string | null;
  missingInputs: string[];
  diagnostics: FundamentalsDiagnostics;
}

/** Vendor-neutral server-only capability boundary. */
export interface FundamentalsProvider {
  readonly id: string;
  getFinancialPeriods(symbol: string, signal?: AbortSignal): Promise<FundamentalsSnapshot>;
  getConsensusForwardEps?(symbol: string): Promise<{ value: number; period: string; asOf: string; analystCount: number }>;
}

let instance: AlphaVantageFundamentalsProvider | null = null;
let instanceKey: string | undefined;

export function getFundamentalsProvider(): FundamentalsProvider | null {
  const key = serverEnv.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  if (!instance || instanceKey !== key) {
    instanceKey = key;
    instance = new AlphaVantageFundamentalsProvider(key);
  }
  return instance;
}
