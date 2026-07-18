begin;

create extension if not exists pg_trgm with schema extensions;

create table public.market_instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol = upper(trim(symbol)) and symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,31}$'),
  name text not null check (char_length(trim(name)) between 1 and 300),
  exchange text,
  asset_type text not null check (asset_type in ('Stock', 'ETF')),
  currency text not null default 'USD',
  country text not null default 'US',
  status text not null check (status in ('active', 'delisted')),
  ipo_date date,
  delisting_date date,
  provider text not null,
  provider_symbol text not null,
  searchable_text text generated always as (lower(symbol || ' ' || name)) stored,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_instruments_provider_symbol_key unique (provider, provider_symbol)
);

create index market_instruments_symbol_lower_idx on public.market_instruments (lower(symbol));
create index market_instruments_name_lower_idx on public.market_instruments (lower(name));
create index market_instruments_status_idx on public.market_instruments (status);
create index market_instruments_asset_type_idx on public.market_instruments (asset_type);
create index market_instruments_search_trgm_idx on public.market_instruments
  using gin (searchable_text extensions.gin_trgm_ops);
create index market_instruments_search_fts_idx on public.market_instruments
  using gin (to_tsvector('simple', searchable_text));

create table public.market_instrument_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  idempotency_key text not null,
  status text not null default 'staging' check (status in ('staging', 'completed', 'failed')),
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  error jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint market_instrument_sync_runs_idempotent unique (provider, idempotency_key)
);

create table public.market_instrument_sync_stage (
  run_id uuid not null references public.market_instrument_sync_runs(id) on delete cascade,
  provider_symbol text not null,
  symbol text not null,
  name text not null,
  exchange text,
  asset_type text not null,
  currency text not null,
  country text not null,
  status text not null,
  ipo_date date,
  delisting_date date,
  primary key (run_id, provider_symbol)
);

alter table public.market_instruments enable row level security;
alter table public.market_instrument_sync_runs enable row level security;
alter table public.market_instrument_sync_stage enable row level security;

create policy "Market instruments are publicly readable" on public.market_instruments
  for select to anon, authenticated using (true);

revoke all on public.market_instruments from anon, authenticated;
grant select on public.market_instruments to anon, authenticated;
revoke all on public.market_instrument_sync_runs from anon, authenticated;
revoke all on public.market_instrument_sync_stage from anon, authenticated;

create or replace function public.search_market_instruments(
  input_query text,
  input_asset_type text default null,
  input_include_delisted boolean default false,
  input_limit integer default 15
)
returns table (
  symbol text,
  name text,
  exchange text,
  asset_type text,
  currency text,
  status text,
  match_score real
)
language sql
stable
security definer
set search_path = ''
as $$
  with query as (
    select lower(trim(left(input_query, 80))) as value
  )
  select i.symbol, i.name, i.exchange, i.asset_type, i.currency, i.status,
    extensions.similarity(i.searchable_text, q.value)::real as match_score
  from public.market_instruments i
  cross join query q
  where q.value <> ''
    and (input_include_delisted or i.status = 'active')
    and (input_asset_type is null or i.asset_type = input_asset_type)
    and (
      lower(i.symbol) = q.value
      or lower(i.symbol) like replace(replace(replace(q.value, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%' escape E'\\'
      or lower(i.name) like replace(replace(replace(q.value, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%' escape E'\\'
      or i.searchable_text operator(extensions.%) q.value
      or to_tsvector('simple', i.searchable_text) @@ plainto_tsquery('simple', q.value)
    )
  order by
    case
      when lower(i.symbol) = q.value then 0
      when lower(i.symbol) like replace(replace(replace(q.value, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%' escape E'\\' then 1
      when lower(i.name) like replace(replace(replace(q.value, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%' escape E'\\' then 2
      else 3
    end,
    extensions.similarity(i.searchable_text, q.value) desc,
    length(i.symbol), i.symbol
  limit least(greatest(input_limit, 1), 20);
$$;

revoke all on function public.search_market_instruments(text, text, boolean, integer) from public;
grant execute on function public.search_market_instruments(text, text, boolean, integer) to anon, authenticated;

create or replace function public.begin_market_instrument_sync(input_provider text, input_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid;
begin
  insert into public.market_instrument_sync_runs (provider, idempotency_key)
  values (input_provider, input_idempotency_key)
  on conflict (provider, idempotency_key) do update set
    provider = excluded.provider,
    status = case when public.market_instrument_sync_runs.status = 'failed' then 'staging' else public.market_instrument_sync_runs.status end,
    error = case when public.market_instrument_sync_runs.status = 'failed' then null else public.market_instrument_sync_runs.error end,
    completed_at = case when public.market_instrument_sync_runs.status = 'failed' then null else public.market_instrument_sync_runs.completed_at end
  returning id into result_id;
  delete from public.market_instrument_sync_stage where run_id = result_id;
  return result_id;
end;
$$;

create or replace function public.stage_market_instruments(input_run_id uuid, input_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare staged integer; run_status text;
begin
  select status into run_status from public.market_instrument_sync_runs where id = input_run_id;
  if run_status is null then raise exception 'Instrument sync run not found'; end if;
  if run_status = 'completed' then return 0; end if;
  if run_status <> 'staging' then raise exception 'Instrument sync run is not writable'; end if;
  insert into public.market_instrument_sync_stage
    (run_id, provider_symbol, symbol, name, exchange, asset_type, currency, country, status, ipo_date, delisting_date)
  select input_run_id, r.provider_symbol, r.symbol, r.name, r.exchange, r.asset_type, r.currency,
    r.country, r.status, r.ipo_date, r.delisting_date
  from jsonb_to_recordset(input_rows) as r(
    provider_symbol text, symbol text, name text, exchange text, asset_type text,
    currency text, country text, status text, ipo_date date, delisting_date date
  )
  on conflict (run_id, provider_symbol) do update set
    symbol = excluded.symbol, name = excluded.name, exchange = excluded.exchange,
    asset_type = excluded.asset_type, currency = excluded.currency, country = excluded.country,
    status = excluded.status, ipo_date = excluded.ipo_date, delisting_date = excluded.delisting_date;
  get diagnostics staged = row_count;
  return staged;
end;
$$;

create or replace function public.fail_market_instrument_sync(input_run_id uuid, input_error jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.market_instrument_sync_runs set status = 'failed', error = input_error,
    failed_count = greatest(failed_count, 1), completed_at = now()
  where id = input_run_id and status = 'staging';
end;
$$;

create or replace function public.finalize_market_instrument_sync(input_run_id uuid, input_failed_count integer default 0)
returns table (inserted integer, updated integer, skipped integer, failed integer)
language plpgsql security definer set search_path = '' as $$
declare run_record record; inserted_value integer; changed_value integer; missing_value integer; skipped_value integer;
begin
  select * into run_record from public.market_instrument_sync_runs where id = input_run_id for update;
  if run_record.id is null then raise exception 'Instrument sync run not found'; end if;
  if run_record.status = 'completed' then
    return query select run_record.inserted_count, run_record.updated_count, run_record.skipped_count, run_record.failed_count;
    return;
  end if;

  select count(*)::integer into inserted_value
  from public.market_instrument_sync_stage s
  left join public.market_instruments i on i.provider = run_record.provider and i.provider_symbol = s.provider_symbol
  where s.run_id = input_run_id and i.id is null;

  select count(*)::integer into changed_value
  from public.market_instrument_sync_stage s
  join public.market_instruments i on i.provider = run_record.provider and i.provider_symbol = s.provider_symbol
  where s.run_id = input_run_id and
    row(i.symbol, i.name, i.exchange, i.asset_type, i.currency, i.country, i.status, i.ipo_date, i.delisting_date)
    is distinct from row(s.symbol, s.name, s.exchange, s.asset_type, s.currency, s.country, s.status, s.ipo_date, s.delisting_date);

  select count(*)::integer into missing_value from public.market_instruments i
  where i.provider = run_record.provider and i.status = 'active'
    and not exists (select 1 from public.market_instrument_sync_stage s where s.run_id = input_run_id and s.provider_symbol = i.provider_symbol);

  select greatest(count(*)::integer - inserted_value - changed_value, 0) into skipped_value
  from public.market_instrument_sync_stage where run_id = input_run_id;

  insert into public.market_instruments
    (symbol, name, exchange, asset_type, currency, country, status, ipo_date, delisting_date, provider, provider_symbol, last_synced_at)
  select s.symbol, s.name, s.exchange, s.asset_type, s.currency, s.country, s.status,
    s.ipo_date, s.delisting_date, run_record.provider, s.provider_symbol, now()
  from public.market_instrument_sync_stage s where s.run_id = input_run_id
  on conflict (provider, provider_symbol) do update set
    symbol = excluded.symbol, name = excluded.name, exchange = excluded.exchange,
    asset_type = excluded.asset_type, currency = excluded.currency, country = excluded.country,
    status = excluded.status, ipo_date = excluded.ipo_date, delisting_date = excluded.delisting_date,
    last_synced_at = excluded.last_synced_at,
    updated_at = case when row(public.market_instruments.symbol, public.market_instruments.name, public.market_instruments.exchange,
      public.market_instruments.asset_type, public.market_instruments.currency, public.market_instruments.country,
      public.market_instruments.status, public.market_instruments.ipo_date, public.market_instruments.delisting_date)
      is distinct from row(excluded.symbol, excluded.name, excluded.exchange, excluded.asset_type, excluded.currency,
      excluded.country, excluded.status, excluded.ipo_date, excluded.delisting_date)
      then now() else public.market_instruments.updated_at end;

  update public.market_instruments i set status = 'delisted', delisting_date = coalesce(i.delisting_date, current_date),
    last_synced_at = now(), updated_at = now()
  where i.provider = run_record.provider and i.status = 'active'
    and not exists (select 1 from public.market_instrument_sync_stage s where s.run_id = input_run_id and s.provider_symbol = i.provider_symbol);

  update public.market_instrument_sync_runs set status = 'completed', inserted_count = inserted_value,
    updated_count = changed_value + missing_value, skipped_count = skipped_value,
    failed_count = greatest(input_failed_count, 0), completed_at = now()
  where id = input_run_id;

  delete from public.market_instrument_sync_stage where run_id = input_run_id;
  return query select inserted_value, changed_value + missing_value, skipped_value, greatest(input_failed_count, 0);
end;
$$;

revoke all on function public.begin_market_instrument_sync(text, text) from public, anon, authenticated;
revoke all on function public.stage_market_instruments(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_market_instrument_sync(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_market_instrument_sync(uuid, integer) from public, anon, authenticated;
grant execute on function public.begin_market_instrument_sync(text, text) to service_role;
grant execute on function public.stage_market_instruments(uuid, jsonb) to service_role;
grant execute on function public.fail_market_instrument_sync(uuid, jsonb) to service_role;
grant execute on function public.finalize_market_instrument_sync(uuid, integer) to service_role;

commit;
