import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/src/types/database';
import type { OptionInput, OptionPosition } from './types';

type Row = Database['public']['Tables']['portfolio_option_positions']['Row'];
const stringValue = (value: string | number | null) => value == null ? null : String(value);

function mapRow(row: Row): OptionPosition {
  return { id: row.id, portfolioId: row.portfolio_id, underlyingSymbol: row.underlying_symbol, optionKind: row.option_kind,
    contracts: String(row.contracts), premiumPerShare: String(row.premium_per_share), strikePrice: String(row.strike_price),
    openedAt: row.opened_at, expirationDate: row.expiration_date, impliedVolatility: stringValue(row.implied_volatility),
    delta: stringValue(row.delta), theta: stringValue(row.theta), note: row.note, status: row.status, closedAt: row.closed_at,
    idempotencyKey: row.idempotency_key, createdAt: row.created_at, updatedAt: row.updated_at };
}

function rpcInput(input: OptionInput) {
  const nullable = (value?: string) => value?.trim() || null;
  return { input_underlying_symbol: input.underlyingSymbol.toUpperCase(), input_option_kind: input.optionKind,
    input_contracts: Number(input.contracts), input_premium_per_share: input.premiumPerShare, input_strike_price: input.strikePrice,
    input_opened_at: input.openedAt, input_expiration_date: input.expirationDate, input_implied_volatility: nullable(input.impliedVolatility),
    input_delta: nullable(input.delta), input_theta: nullable(input.theta), input_note: nullable(input.note), input_status: input.status };
}

export class OptionPositionRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async getAll(portfolioId: string): Promise<OptionPosition[]> {
    const { data, error } = await this.client.from('portfolio_option_positions').select('*').eq('portfolio_id', portfolioId)
      .order('expiration_date', { ascending: true }).order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }
  async create(input: OptionInput): Promise<string> {
    const { data, error } = await this.client.rpc('create_option_position', { ...rpcInput(input), input_idempotency_key: input.idempotencyKey });
    if (error || !data) throw error ?? new Error('Option position was not created');
    return data;
  }
  async update(id: string, input: OptionInput): Promise<void> {
    const { error } = await this.client.rpc('update_option_position', { position_id: id, ...rpcInput(input) }); if (error) throw error;
  }
  async close(id: string, closedAt: string): Promise<void> {
    const { error } = await this.client.rpc('close_option_position', { position_id: id, input_closed_at: closedAt }); if (error) throw error;
  }
  async delete(id: string): Promise<void> {
    const { error } = await this.client.rpc('delete_option_position', { position_id: id }); if (error) throw error;
  }
}
