import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/src/types/database';
import type { SimulationWorkspace } from './types';

type Row = Database['public']['Tables']['option_simulations']['Row'];
export interface SavedSimulation extends SimulationWorkspace { id: string; createdAt: string; updatedAt: string; version: number }

function asJson(value: unknown): Json { return value as Json; }

function mapRow(row: Row): SavedSimulation {
  const inputs = row.inputs_json as unknown as Pick<SimulationWorkspace, 'exchange' | 'underlyingPrice' | 'stockQuantity' | 'cashPosition' | 'entryDate' | 'valuationDate' | 'legs' | 'scenarios'>;
  return {
    id: row.id, name: row.name, description: row.description, symbol: row.symbol, companyName: row.company_name,
    currency: row.currency, simulationType: row.simulation_type, strategyType: row.strategy_type,
    exchange: inputs.exchange, underlyingPrice: inputs.underlyingPrice, stockQuantity: inputs.stockQuantity, cashPosition: inputs.cashPosition,
    entryDate: inputs.entryDate, valuationDate: inputs.valuationDate, legs: inputs.legs, scenarios: inputs.scenarios,
    monteCarlo: row.settings_json as unknown as SimulationWorkspace['monteCarlo'], dataSource: row.data_source,
    dataTimestamp: row.source_timestamp, dataStatus: row.data_status,
    resultSnapshot: row.results_summary_json as unknown as SimulationWorkspace['resultSnapshot'], methodologyVersion: 'options-simulator-v1',
    createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
  };
}

function toWrite(workspace: SimulationWorkspace) {
  return {
    name: workspace.name, description: workspace.description, symbol: workspace.symbol, company_name: workspace.companyName,
    currency: workspace.currency, simulation_type: workspace.simulationType, strategy_type: workspace.strategyType,
    inputs_json: asJson({ exchange: workspace.exchange, underlyingPrice: workspace.underlyingPrice, stockQuantity: workspace.stockQuantity,
      cashPosition: workspace.cashPosition, entryDate: workspace.entryDate, valuationDate: workspace.valuationDate, legs: workspace.legs, scenarios: workspace.scenarios }),
    assumptions_json: asJson({ pricing: 'Black-Scholes with continuous dividend yield for European options; binomial for American options', monteCarlo: 'Geometric Brownian motion' }),
    settings_json: asJson(workspace.monteCarlo), methodology_version: workspace.methodologyVersion,
    results_summary_json: workspace.resultSnapshot === null ? null : asJson(workspace.resultSnapshot),
    data_source: workspace.dataSource, data_status: workspace.dataStatus, source_timestamp: workspace.dataTimestamp,
  };
}

export class OptionSimulationsRepository {
  constructor(private readonly client: SupabaseClient<Database>, private readonly userId: string) {}

  async list(page: number, pageSize: number): Promise<{ items: SavedSimulation[]; total: number }> {
    const from = (page - 1) * pageSize;
    const { data, count, error } = await this.client.from('option_simulations').select('*', { count: 'exact' })
      .eq('user_id', this.userId).order('updated_at', { ascending: false }).range(from, from + pageSize - 1);
    if (error) throw error;
    return { items: (data ?? []).map(mapRow), total: count ?? 0 };
  }

  async create(workspace: SimulationWorkspace): Promise<SavedSimulation> {
    const { data, error } = await this.client.from('option_simulations').insert({ user_id: this.userId, ...toWrite(workspace) }).select('*').single();
    if (error || !data) throw error ?? new Error('Simulation was not created');
    return mapRow(data);
  }

  async update(id: string, workspace: SimulationWorkspace, expectedUpdatedAt: string): Promise<SavedSimulation | null> {
    const { data: current, error: readError } = await this.client.from('option_simulations').select('version')
      .eq('id', id).eq('user_id', this.userId).eq('updated_at', expectedUpdatedAt).maybeSingle();
    if (readError) throw readError;
    if (!current) return null;
    const now = new Date().toISOString();
    const { data, error } = await this.client.from('option_simulations').update({ ...toWrite(workspace), updated_at: now, version: current.version + 1 })
      .eq('id', id).eq('user_id', this.userId).eq('updated_at', expectedUpdatedAt).select('*').maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  }

  async remove(id: string): Promise<boolean> {
    const { data, error } = await this.client.from('option_simulations').delete().eq('id', id).eq('user_id', this.userId).select('id');
    if (error) throw error;
    return Boolean(data?.length);
  }
}
