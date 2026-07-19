import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/202607190001_phase_10_5_option_simulations.sql', 'utf8');

describe('option simulation migration', () => {
  it('is owner scoped, indexed and payload limited', () => {
    expect(migration).toContain('create table if not exists public.option_simulations');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('(select auth.uid()) = user_id');
    expect(migration).toContain('option_simulations_user_updated_idx');
    expect(migration).toContain('option_simulations_user_symbol_idx');
    expect(migration).toContain('octet_length(results_summary_json::text) <= 250000');
  });
});
