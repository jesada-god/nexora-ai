export type OptionKind = 'call' | 'put';
export type StoredOptionStatus = 'open' | 'closed' | 'cancelled';
export type OptionStatus = StoredOptionStatus | 'expired';

export interface OptionPosition {
  id: string;
  portfolioId: string;
  underlyingSymbol: string;
  optionKind: OptionKind;
  contracts: string;
  premiumPerShare: string;
  strikePrice: string;
  openedAt: string;
  expirationDate: string;
  impliedVolatility: string | null;
  delta: string | null;
  theta: string | null;
  note: string | null;
  status: StoredOptionStatus;
  closedAt: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface OptionInput {
  underlyingSymbol: string;
  optionKind: OptionKind;
  contracts: string;
  premiumPerShare: string;
  strikePrice: string;
  openedAt: string;
  expirationDate: string;
  impliedVolatility?: string;
  delta?: string;
  theta?: string;
  note?: string;
  status: StoredOptionStatus;
  idempotencyKey: string;
}
