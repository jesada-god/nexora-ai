begin;

create table if not exists public.option_simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  symbol text not null check (symbol = upper(trim(symbol)) and symbol ~ '^(\^[A-Z0-9]+|[A-Z0-9][A-Z0-9.-]{0,19})$'),
  company_name text not null,
  currency text not null,
  simulation_type text not null check (simulation_type in ('what-if', 'monte-carlo')),
  strategy_type text not null,
  inputs_json jsonb not null,
  assumptions_json jsonb not null default '{}'::jsonb,
  settings_json jsonb not null,
  results_summary_json jsonb,
  methodology_version text not null default 'options-simulator-v1',
  data_source text,
  data_status text not null check (data_status in ('live', 'delayed', 'stale', 'manual', 'unavailable')),
  source_timestamp timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (octet_length(inputs_json::text) <= 250000),
  check (octet_length(settings_json::text) <= 50000),
  check (results_summary_json is null or octet_length(results_summary_json::text) <= 250000)
);

create index if not exists option_simulations_user_updated_idx on public.option_simulations (user_id, updated_at desc);
create index if not exists option_simulations_user_symbol_idx on public.option_simulations (user_id, symbol);

alter table public.option_simulations enable row level security;

drop policy if exists "Users can read own option simulations" on public.option_simulations;
create policy "Users can read own option simulations" on public.option_simulations for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can create own option simulations" on public.option_simulations;
create policy "Users can create own option simulations" on public.option_simulations for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own option simulations" on public.option_simulations;
create policy "Users can update own option simulations" on public.option_simulations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own option simulations" on public.option_simulations;
create policy "Users can delete own option simulations" on public.option_simulations for delete to authenticated
  using ((select auth.uid()) = user_id);

commit;
