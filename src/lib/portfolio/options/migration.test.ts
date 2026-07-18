import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202607180005_phase_4_portfolio_options.sql'), 'utf8').replace(/\s+/g, ' ').toLowerCase();
describe('portfolio options migration', () => {
  it('uses parent ownership and enables RLS', () => {
    expect(sql).toContain('alter table public.portfolio_option_positions enable row level security');
    expect(sql.match(/p\.id = portfolio_id and p\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(5);
  });
  it('keeps writes behind owner-scoped RPCs with idempotency', () => {
    expect(sql).toContain('unique (portfolio_id, idempotency_key)');
    expect(sql).toContain('revoke insert, update, delete on public.portfolio_option_positions from authenticated');
    expect(sql).toContain('p.user_id = (select auth.uid())');
  });
});
