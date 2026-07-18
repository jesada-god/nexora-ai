import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/202607180008_market_fx_rates.sql', 'utf8');

describe('market FX rate migration', () => {
  it('creates a positive fixed-point cache without hardcoded rate data', () => {
    expect(sql).toContain('create table public.market_fx_rates');
    expect(sql).toContain('numeric(28,8)');
    expect(sql).toContain('check (rate > 0)');
    expect(sql).not.toMatch(/insert\s+into\s+public\.market_fx_rates/i);
  });

  it('prevents browser writes and grants server service role only', () => {
    expect(sql).toContain('revoke all on public.market_fx_rates from public, anon, authenticated');
    expect(sql).toContain('grant select, insert, update on public.market_fx_rates to service_role');
  });
});
