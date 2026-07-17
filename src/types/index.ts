export type AssetType = 'STOCK' | 'CRYPTO' | 'INDEX';

export interface Asset {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  type: AssetType;
  market: string;
  currency: 'THB' | 'USD';
  sparkline: number[];
  updatedAt: string;
  marketStatus?: 'OPEN' | 'CLOSED';
  marketCap?: number;
  volume?: number;
  avgVolume?: number;
  peRatio?: number;
  eps?: number;
  dividendYield?: number;
  high52w?: number;
  low52w?: number;
}

export interface PortfolioItem {
  symbol: string;
  name: string;
  shares: number;
  averageCost: number;
  currentPrice: number;
  currency: 'THB' | 'USD';
  type: AssetType;
}

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'ALERT' | 'INFO' | 'SYSTEM' | 'SUCCESS';
}
