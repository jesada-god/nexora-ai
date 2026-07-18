import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/202607180007_instrument_master.sql'), 'utf8');
const databaseTestSql = readFileSync(
  join(process.cwd(), 'supabase/tests/202607180007_instrument_master.test.sql'),
  'utf8',
);

describe('instrument master migration', () => {
  it('enables public read while withholding browser writes', () => {
    expect(sql).toContain('alter table public.market_instruments enable row level security');
    expect(sql).toContain('grant select on public.market_instruments to anon, authenticated');
    expect(sql).toContain('revoke all on public.market_instruments from anon, authenticated');
    expect(sql).not.toMatch(/grant (insert|update|delete).*market_instruments.*(anon|authenticated)/i);
  });
  it('uses transactional staging, idempotency, and a non-destructive delisting update', () => {
    expect(sql).toContain('constraint market_instrument_sync_runs_idempotent unique (provider, idempotency_key)');
    expect(sql).toContain("update public.market_instruments i set status = 'delisted'");
    expect(sql).not.toMatch(/delete from public\.market_instruments/i);
    expect(sql).toContain("if run_record.status = 'completed'");
  });
  it('defines exact, prefix, name and trigram ranking with active and asset filters', () => {
    expect(sql).toContain('when lower(i.symbol) = q.value then 0');
    expect(sql).toContain('when lower(i.symbol) like');
    expect(sql).toContain('when lower(i.name) like');
    expect(sql).toContain('extensions.similarity(i.searchable_text, q.value) desc');
    expect(sql).toContain("i.status = 'active'");
    expect(sql).toContain('i.asset_type = input_asset_type');
  });
  it('installs and schema-qualifies every pg_trgm object used by the migration', () => {
    expect(sql).toContain('create extension if not exists pg_trgm with schema extensions');
    expect(sql).toContain('searchable_text extensions.gin_trgm_ops');
    expect(sql).toContain('extensions.similarity(i.searchable_text, q.value)::real');
    expect(sql).toContain('i.searchable_text operator(extensions.%) q.value');
    expect(sql).not.toMatch(/(?<!extensions\.)similarity\(/);
    expect(sql).not.toMatch(/searchable_text\s+gin_trgm_ops/);
  });
  it('has a database regression test for extension availability and fuzzy ranking', () => {
    expect(databaseTestSql).toContain("e.extname = 'pg_trgm'");
    expect(databaseTestSql).toContain("n.nspname = 'extensions'");
    expect(databaseTestSql).toContain("public.search_market_instruments('NVDA')");
    expect(databaseTestSql).toContain("public.search_market_instruments('migraton fuzz ranking')");
    expect(databaseTestSql).toContain("public.search_market_instruments('MIGRATION.FUZZ.RANK')");
    expect(databaseTestSql).toContain('rollback;');
  });
});
