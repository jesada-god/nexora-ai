export const transactionTypes = ['acquisition', 'disposal', 'dividend', 'deposit', 'withdrawal', 'fee', 'adjustment'] as const;

export type PortfolioTransactionType = typeof transactionTypes[number];

export interface PortfolioTransaction {
  id: string;
  portfolioId: string;
  type: PortfolioTransactionType;
  symbol: string | null;
  quantity: string | null;
  price: string | null;
  amount: string | null;
  originalAmount?: string | null;
  originalCurrency?: 'THB' | 'USD';
  fxRateAtTransaction?: string | null;
  normalizedAmountUsd?: string | null;
  occurredAt: string;
  note: string | null;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioRecord {
  id: string;
  name: string;
  baseCurrency: 'THB' | 'USD';
  transactions: PortfolioTransaction[];
}

export interface HoldingSummary {
  symbol: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  marketPrice: number;
  marketValue: number;
  realizedGain: number;
  unrealizedGain: number;
  allocation: number;
  priceEstimated: boolean;
  priceCached: boolean;
  todayChange: number;
}

export interface PortfolioSummary {
  holdings: HoldingSummary[];
  cashBalance: number;
  marketValue: number;
  costBasis: number;
  realizedGain: number;
  unrealizedGain: number;
  totalValue: number;
  equityMarketValue: number;
  optionsMarketValue: number;
  netDepositedCapital: number;
  totalGain: number;
  totalGainPercent: number;
  todayChange: number;
  todayChangePercent: number;
}

export interface MarketPriceInput { price: string | number; previousClose?: string | number | null; cached?: boolean }
