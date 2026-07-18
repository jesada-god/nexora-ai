begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(4);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm'
      and n.nspname = 'extensions'
  ),
  'pg_trgm is installed in the extensions schema'
);

insert into public.market_instruments
  (symbol, name, asset_type, currency, country, status, provider, provider_symbol)
values
  ('NVDA', 'NVIDIA Corporation', 'Stock', 'USD', 'US', 'active', 'migration-test', 'NVDA'),
  ('MIGRATION.FUZZ.RANK', 'Migration Exact Instrument', 'Stock', 'USD', 'US', 'active', 'migration-test', 'MIGRATION.FUZZ.RANK'),
  ('ZZFUZ', 'Migration Fuzz Ranking Instrument', 'Stock', 'USD', 'US', 'active', 'migration-test', 'ZZFUZ');

select extensions.lives_ok(
  $$select * from public.search_market_instruments('NVDA')$$,
  'search_market_instruments can search for NVDA with an empty function search_path'
);

select extensions.ok(
  exists (
    select 1
    from public.search_market_instruments('migraton fuzz ranking')
    where symbol = 'ZZFUZ'
      and match_score > 0
  ),
  'a non-prefix typo is found and receives a similarity score'
);

select extensions.results_eq(
  $$
    select symbol
    from public.search_market_instruments('MIGRATION.FUZZ.RANK')
    where symbol in ('MIGRATION.FUZZ.RANK', 'ZZFUZ')
  $$,
  $$values ('MIGRATION.FUZZ.RANK'::text), ('ZZFUZ'::text)$$,
  'an exact symbol ranks before a fuzzy result'
);

select * from extensions.finish();

rollback;
