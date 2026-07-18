import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202607180006_portfolio_currency_summary.sql'), 'utf8').replace(/\s+/g, ' ').toLowerCase();

describe('portfolio currency migration', () => {
  it('defaults portfolios to USD and preserves the original transaction amount', () => {
    expect(sql).toContain("alter table public.portfolios alter column base_currency set default 'usd'");
    expect(sql).toContain('original_amount numeric(28,8)');
    expect(sql).toContain('fx_rate_at_transaction numeric(28,8)');
    expect(sql).toContain('normalized_amount_usd numeric(28,8)');
  });
  it('normalizes THB in the mutation RPC without overwriting input_amount', () => {
    expect(sql).toContain('round(input_amount / input_fx_rate_at_transaction, 8)');
    expect(sql).toContain('original_amount, original_currency, fx_rate_at_transaction, normalized_amount_usd');
  });
  it('persists the selected currency in the portfolio so refresh uses it again', () => {
    expect(sql).toContain('update public.portfolios set base_currency = input_currency');
    expect(sql).toContain('on conflict (user_id) do update set base_currency = excluded.base_currency');
  });
});
