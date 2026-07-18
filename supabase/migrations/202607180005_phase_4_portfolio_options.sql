begin;

create table if not exists public.portfolio_option_positions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  underlying_symbol text not null check (underlying_symbol = upper(trim(underlying_symbol)) and underlying_symbol ~ '^(\^[A-Z0-9]+|[A-Z0-9][A-Z0-9.-]{0,19})$'),
  option_kind text not null check (option_kind in ('call', 'put')),
  contracts integer not null check (contracts between 1 and 1000000),
  premium_per_share numeric(28,8) not null check (premium_per_share > 0),
  strike_price numeric(28,8) not null check (strike_price > 0),
  opened_at date not null check (opened_at <= current_date),
  expiration_date date not null check (expiration_date >= opened_at),
  implied_volatility numeric(12,8) check (implied_volatility between 0 and 1000),
  delta numeric(12,8) check (delta between -1 and 1),
  theta numeric(12,8),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  closed_at date,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint option_position_close_state check ((status = 'closed' and closed_at is not null and closed_at >= opened_at and closed_at <= current_date) or (status <> 'closed' and closed_at is null)),
  constraint portfolio_option_positions_idempotent unique (portfolio_id, idempotency_key)
);

create index if not exists portfolio_option_positions_portfolio_idx
  on public.portfolio_option_positions (portfolio_id, expiration_date, created_at, id);

alter table public.portfolio_option_positions enable row level security;

drop policy if exists "Users can read own option positions" on public.portfolio_option_positions;
create policy "Users can read own option positions" on public.portfolio_option_positions for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
drop policy if exists "Users can create own option positions" on public.portfolio_option_positions;
create policy "Users can create own option positions" on public.portfolio_option_positions for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
drop policy if exists "Users can update own option positions" on public.portfolio_option_positions;
create policy "Users can update own option positions" on public.portfolio_option_positions for update to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
drop policy if exists "Users can delete own option positions" on public.portfolio_option_positions;
create policy "Users can delete own option positions" on public.portfolio_option_positions for delete to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));

create or replace function public.create_option_position(
  input_underlying_symbol text, input_option_kind text, input_contracts integer, input_premium_per_share numeric,
  input_strike_price numeric, input_opened_at date, input_expiration_date date, input_implied_volatility numeric,
  input_delta numeric, input_theta numeric, input_note text, input_status text, input_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target_portfolio uuid; result_id uuid;
begin
  target_portfolio := public.get_or_create_default_portfolio();
  perform 1 from public.portfolios where id = target_portfolio and user_id = (select auth.uid()) for update;
  insert into public.portfolio_option_positions (portfolio_id, underlying_symbol, option_kind, contracts, premium_per_share, strike_price, opened_at, expiration_date, implied_volatility, delta, theta, note, status, idempotency_key)
  values (target_portfolio, upper(trim(input_underlying_symbol)), input_option_kind, input_contracts, input_premium_per_share, input_strike_price, input_opened_at, input_expiration_date, input_implied_volatility, input_delta, input_theta, nullif(trim(input_note), ''), input_status, input_idempotency_key)
  on conflict (portfolio_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.update_option_position(
  position_id uuid, input_underlying_symbol text, input_option_kind text, input_contracts integer, input_premium_per_share numeric,
  input_strike_price numeric, input_opened_at date, input_expiration_date date, input_implied_volatility numeric,
  input_delta numeric, input_theta numeric, input_note text, input_status text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.portfolio_option_positions op set underlying_symbol = upper(trim(input_underlying_symbol)), option_kind = input_option_kind,
    contracts = input_contracts, premium_per_share = input_premium_per_share, strike_price = input_strike_price,
    opened_at = input_opened_at, expiration_date = input_expiration_date, implied_volatility = input_implied_volatility,
    delta = input_delta, theta = input_theta, note = nullif(trim(input_note), ''), status = input_status,
    closed_at = case when input_status = 'closed' then op.closed_at else null end, updated_at = now()
  from public.portfolios p where op.id = position_id and p.id = op.portfolio_id and p.user_id = (select auth.uid());
  if not found then raise exception 'Option position not found' using errcode = '42501'; end if;
end;
$$;

create or replace function public.close_option_position(position_id uuid, input_closed_at date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.portfolio_option_positions op set status = 'closed', closed_at = input_closed_at, updated_at = now()
  from public.portfolios p where op.id = position_id and p.id = op.portfolio_id and p.user_id = (select auth.uid()) and op.status = 'open';
  if not found then raise exception 'Open option position not found' using errcode = '42501'; end if;
end;
$$;

create or replace function public.delete_option_position(position_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.portfolio_option_positions op using public.portfolios p
  where op.id = position_id and p.id = op.portfolio_id and p.user_id = (select auth.uid());
  if not found then raise exception 'Option position not found' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.create_option_position(text,text,integer,numeric,numeric,date,date,numeric,numeric,numeric,text,text,uuid) from public, anon;
revoke all on function public.update_option_position(uuid,text,text,integer,numeric,numeric,date,date,numeric,numeric,numeric,text,text) from public, anon;
revoke all on function public.close_option_position(uuid,date) from public, anon;
revoke all on function public.delete_option_position(uuid) from public, anon;
grant execute on function public.create_option_position(text,text,integer,numeric,numeric,date,date,numeric,numeric,numeric,text,text,uuid) to authenticated;
grant execute on function public.update_option_position(uuid,text,text,integer,numeric,numeric,date,date,numeric,numeric,numeric,text,text) to authenticated;
grant execute on function public.close_option_position(uuid,date) to authenticated;
grant execute on function public.delete_option_position(uuid) to authenticated;
revoke insert, update, delete on public.portfolio_option_positions from authenticated;

commit;
