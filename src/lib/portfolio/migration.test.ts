import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202607180004_phase_4_portfolio_core.sql'), 'utf8').replace(/\s+/g, ' ').toLowerCase();

describe('Phase 4 portfolio migration security contract', () => {
  it('allows one portfolio per user and idempotent submissions', () => {
    expect(sql).toContain('constraint portfolios_one_per_user unique (user_id)');
    expect(sql).toContain('unique (portfolio_id, idempotency_key)');
  });
  it('enables RLS and resolves transaction ownership through the parent', () => {
    expect(sql).toContain('alter table public.portfolios enable row level security');
    expect(sql).toContain('alter table public.portfolio_transactions enable row level security');
    expect(sql.match(/p\.id = portfolio_id and p\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(5);
  });
  it('prevents direct writes and validates the full ordered ledger in mutation RPCs', () => {
    expect(sql).toContain('revoke insert, update, delete on public.portfolio_transactions from authenticated');
    expect(sql).toContain('order by occurred_at asc, created_at asc, id asc');
    expect(sql).toContain('disposal exceeds available quantity');
    expect(sql.match(/perform public\.assert_portfolio_ledger_valid\(target_portfolio\)/g)).toHaveLength(3);
  });
});
