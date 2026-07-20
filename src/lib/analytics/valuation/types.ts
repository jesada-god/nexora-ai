import type { AnalyticsSourceType } from '../fundamentals/types';
import type { DataFreshness, HistoricalPrice } from '@/src/lib/market-data/types';

export const METHODOLOGY_VERSION = 'nexora-fv-v1' as const;
export const SECTOR_RULE_VERSION = 'nexora-sector-valuation-v1' as const;
export type FairValueFailureKind =
  | 'provider-unavailable'
  | 'insufficient-data'
  | 'not-meaningful'
  | 'rate-limited'
  | 'server-error';
export type CompanyClassification = 'profitable-growth' | 'mature-dividend-paying' | 'cyclical' | 'financial-institution' | 'reit' | 'early-stage-high-growth' | 'loss-making' | 'asset-heavy' | 'commodity-sensitive';
export type ModelId = 'fcff-dcf' | 'fcfe' | 'ddm' | 'relative' | 'asset-based' | 'ev-sales' | 'ev-ebitda' | 'pe' | 'peg' | 'pb';
export type FairValueDataStatus = 'live' | 'delayed' | 'cached' | 'stale' | 'limited' | 'unavailable';

export interface FinancialPeriod {
  periodEnd: string;
  currency: string;
  revenue: number;
  operatingIncome: number;
  netIncome: number;
  depreciationAmortization: number;
  capitalExpenditure: number;
  changeInWorkingCapital: number;
  operatingCashFlow: number;
  freeCashFlow: number;
  dividendsPaid: number | null;
  interestExpense: number;
  totalDebt: number;
  cash: number;
  totalAssets: number;
  totalLiabilities: number;
  dilutedShares: number;
  grossProfit?: number | null;
  ebitda?: number | null;
  dilutedEps?: number | null;
  totalEquity?: number | null;
  restated?: boolean;
}

export interface ValuationInput {
  symbol: string;
  currency: string;
  marketPrice: number;
  priceAsOf: string;
  source: string;
  sourceType: AnalyticsSourceType;
  sector: string;
  industry: string;
  marketCapitalization?: number | null;
  periods: FinancialPeriod[];
  historicalPrices: HistoricalPrice[];
  historySource: string;
  historyFreshness: DataFreshness;
  assumptions?: DcfAssumptions;
  forwardEpsGrowth?: {
    value: number;
    unit: 'decimal';
    provider: string;
    asOf: string;
    period: string;
  } | null;
  providerStatus?: Exclude<FairValueDataStatus, 'unavailable'>;
  displayFx?: {
    rate: number;
    asOf: string;
    provider: string;
    status: 'live' | 'cached' | 'stale';
  } | null;
  calculatedAt?: string;
}

export interface DcfAssumptions {
  forecastHorizon: number;
  revenueGrowth: number;
  operatingMargin: number;
  taxRate: number;
  depreciationPercentRevenue: number;
  capexPercentRevenue: number;
  workingCapitalPercentRevenue: number;
  wacc: number;
  terminalGrowth: number;
  dilutionRate: number;
}

export interface ModelResult {
  model: ModelId;
  fairValue: number;
  weight?: number;
  configuredWeight?: number;
  normalizedWeight?: number;
  scenarios?: { conservative: number; base: number; optimistic: number };
  reason?: string;
  methodology: string;
  inputs: Record<string, number | string>;
  assumptions: Record<string, number | string>;
  limitations: string[];
}
export interface ExcludedModel { model: ModelId; reason: string; }
export interface ClassificationResult { classification: CompanyClassification[]; evidence: string[]; eligibleModels: ModelId[]; excludedModels: ExcludedModel[]; }
export interface ValuationInputDisclosure {
  field: string;
  value: number | string;
  currency: string | null;
  period: string;
  provider: string;
  asOf: string;
  status: 'available' | 'limited' | 'stale';
  origin: 'provider' | 'derived';
}
export interface ValuationAssumptionDisclosure {
  field: string;
  value: number | string;
  source: 'model-assumption' | 'provider' | 'historical-derived';
  ruleVersion: typeof SECTOR_RULE_VERSION;
}

export interface FairValueUnavailable {
  status: 'unavailable';
  failureKind: FairValueFailureKind;
  symbol: string;
  currency: string | null;
  provider: string | null;
  reason: string;
  missingFields: string[];
  /** Backward-compatible alias used by the existing details UI and audit logs. */
  missingInputs: string[];
  staleInputs: string[];
  asOf: string;
  calculatedAt: string;
  methodologyVersion: typeof METHODOLOGY_VERSION;
  limitations: string[];
}

export interface FairValueAvailable {
  status: 'available'; symbol: string; currency: string; marketPrice: { value: number; asOf: string; source: string; sourceType: AnalyticsSourceType };
  companyClassification: ClassificationResult; modelResults: Array<ModelResult & { weight: number }>; excludedModels: ExcludedModel[];
  fundamentalFairValue: { conservative: { low: number; high: number }; base: { low: number; high: number }; optimistic: { low: number; high: number }; centralEstimate: number; dispersion: number };
  technicalContext: { status: 'available'; trendState: string; smaEmaStructure: string; rsi: number | null; macd: number | null; atr: number | null; realizedVolatility: number | null; relativeVolume: number | null; drawdown: number; fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number; distanceFromHigh: number; distanceFromLow: number; distanceFromFairValueRange: number; supportResistance: unknown; source: string; asOf: string; limitations: string[] } | { status: 'unavailable'; reason: string };
  fundamentalQuality: QualityScore;
  dataQuality: { score: number; completeness: number; freshness: number; periodConsistency: number; currencyConsistency: number };
  modelReliability: ReliabilityResult;
  reliabilityReasons: string[];
  missingInputs: string[];
  dataStatus: Exclude<FairValueDataStatus, 'unavailable'>;
  selectedModel: ModelId | 'blended';
  upsideAmount: number;
  upsidePercent: number;
  sector: string;
  industry: string;
  sectorRuleId: string;
  sectorRuleVersion: typeof SECTOR_RULE_VERSION;
  inputDetails: ValuationInputDisclosure[];
  assumptionDetails: ValuationAssumptionDisclosure[];
  displayFx: ValuationInput['displayFx'];
  inputs: Record<string, unknown>; assumptions: Record<string, unknown>; sources: Array<{ name: string; asOf: string; sourceType: AnalyticsSourceType }>;
  latestDataAt: string; calculatedAt: string; methodologyVersion: typeof METHODOLOGY_VERSION; limitations: string[];
}

export type FairValueResult = FairValueAvailable | FairValueUnavailable;
export interface QualityCategory { name: string; rawInputs: Record<string, number | null>; normalizedScore: number | null; formula: string; weight: number; missingDataHandling: string; limitation: string; }
export interface QualityScore { score: number; categories: QualityCategory[]; limitation: string; }
export interface ReliabilityResult { level: 'High' | 'Moderate' | 'Low' | 'Unavailable'; score: number | null; components: Record<string, number>; explanation: string; }
