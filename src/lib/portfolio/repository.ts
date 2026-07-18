import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/src/types/database';
import type { PortfolioRecord, PortfolioTransaction } from './types';
import type { TransactionInput } from './validation';

type TransactionRow = Database['public']['Tables']['portfolio_transactions']['Row'];

function numericString(value: string | number | null): string | null {
  if (value == null) return null;
  return typeof value === 'number' ? value.toFixed(8) : String(value);
}

function mapTransaction(row: TransactionRow): PortfolioTransaction {
  return {
    id: row.id, portfolioId: row.portfolio_id, type: row.transaction_type, symbol: row.symbol,
    quantity: numericString(row.quantity), price: numericString(row.price), amount: numericString(row.amount), occurredAt: row.occurred_at,
    originalAmount: numericString(row.original_amount), originalCurrency: row.original_currency,
    fxRateAtTransaction: numericString(row.fx_rate_at_transaction), normalizedAmountUsd: numericString(row.normalized_amount_usd),
    note: row.note, idempotencyKey: row.idempotency_key, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rpcInput(input: TransactionInput) {
  const asset = input.type === 'acquisition' || input.type === 'disposal';
  return {
    input_type: input.type,
    input_symbol: asset ? input.symbol!.trim().toUpperCase() : null,
    input_quantity: asset ? input.quantity! : null,
    input_price: asset ? input.price! : null,
    input_amount: asset ? null : input.amount!,
    input_original_currency: asset ? 'USD' : input.originalCurrency,
    input_fx_rate_at_transaction: asset || input.originalCurrency === 'USD' ? null : input.fxRateAtTransaction || null,
    input_occurred_at: input.occurredAt,
    input_note: input.note?.trim() || null,
  };
}

export class PortfolioRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async ensureDefault(): Promise<string> {
    const { data, error } = await this.client.rpc('get_or_create_default_portfolio');
    if (error || !data) throw error ?? new Error('Default portfolio was not created');
    return data;
  }

  async getDefault(): Promise<PortfolioRecord> {
    const id = await this.ensureDefault();
    const [{ data: portfolio, error: portfolioError }, { data: rows, error: rowsError }] = await Promise.all([
      this.client.from('portfolios').select('id, name, base_currency').eq('id', id).single(),
      this.client.from('portfolio_transactions').select('*').eq('portfolio_id', id)
        .order('occurred_at', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }),
    ]);
    if (portfolioError || !portfolio) throw portfolioError ?? new Error('Portfolio not found');
    if (rowsError) throw rowsError;
    return { id: portfolio.id, name: portfolio.name, baseCurrency: portfolio.base_currency, transactions: (rows ?? []).map(mapTransaction) };
  }

  async create(input: TransactionInput): Promise<string> {
    const { data, error } = await this.client.rpc('create_portfolio_transaction', { ...rpcInput(input), input_idempotency_key: input.idempotencyKey });
    if (error || !data) throw error ?? new Error('Transaction was not created');
    return data;
  }

  async update(id: string, input: TransactionInput): Promise<void> {
    const { error } = await this.client.rpc('update_portfolio_transaction', { transaction_id: id, ...rpcInput(input) });
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.rpc('delete_portfolio_transaction', { transaction_id: id });
    if (error) throw error;
  }

  async setBaseCurrency(currency: 'USD' | 'THB'): Promise<void> {
    const { error } = await this.client.rpc('set_portfolio_base_currency', { input_currency: currency });
    if (error) throw error;
  }
}
