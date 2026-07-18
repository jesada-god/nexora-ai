begin;

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'พอร์ตโฟลิโอหลัก' check (char_length(trim(name)) between 1 and 80),
  base_currency text not null default 'THB' check (base_currency in ('THB', 'USD')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolios_one_per_user unique (user_id)
);

create table if not exists public.portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('acquisition', 'disposal', 'dividend', 'deposit', 'withdrawal', 'fee', 'adjustment')),
  symbol text check (symbol is null or (symbol = upper(trim(symbol)) and symbol ~ '^(\^[A-Z0-9]+|[A-Z0-9][A-Z0-9.-]{0,19})$')),
  quantity numeric(28,8),
  price numeric(28,8),
  amount numeric(28,8),
  occurred_at date not null check (occurred_at <= current_date),
  note text check (char_length(note) <= 500),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_transactions_idempotent unique (portfolio_id, idempotency_key),
  constraint portfolio_transactions_fields check (
    (transaction_type in ('acquisition', 'disposal') and symbol is not null and quantity > 0 and price > 0 and amount is null)
    or
    (transaction_type in ('dividend', 'deposit', 'withdrawal', 'fee', 'adjustment') and symbol is null and quantity is null and price is null and amount > 0)
  )
);

create index if not exists portfolio_transactions_ledger_order_idx
  on public.portfolio_transactions (portfolio_id, occurred_at, created_at, id);

alter table public.portfolios enable row level security;
alter table public.portfolio_transactions enable row level security;

drop policy if exists "Users can read own portfolio" on public.portfolios;
create policy "Users can read own portfolio" on public.portfolios for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can create own portfolio" on public.portfolios;
create policy "Users can create own portfolio" on public.portfolios for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own portfolio" on public.portfolios;
create policy "Users can update own portfolio" on public.portfolios for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own portfolio" on public.portfolios;
create policy "Users can delete own portfolio" on public.portfolios for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Transaction ownership is derived exclusively through the parent portfolio.
drop policy if exists "Users can read own portfolio transactions" on public.portfolio_transactions;
create policy "Users can read own portfolio transactions" on public.portfolio_transactions for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
drop policy if exists "Users can create own portfolio transactions" on public.portfolio_transactions;
create policy "Users can create own portfolio transactions" on public.portfolio_transactions for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
drop policy if exists "Users can update own portfolio transactions" on public.portfolio_transactions;
create policy "Users can update own portfolio transactions" on public.portfolio_transactions for update to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
drop policy if exists "Users can delete own portfolio transactions" on public.portfolio_transactions;
create policy "Users can delete own portfolio transactions" on public.portfolio_transactions for delete to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));

create or replace function public.get_or_create_default_portfolio()
returns uuid language plpgsql security definer set search_path = '' as $$
declare requesting_user uuid := (select auth.uid()); result_id uuid;
begin
  if requesting_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.portfolios (user_id) values (requesting_user)
  on conflict (user_id) do update set user_id = excluded.user_id returning id into result_id;
  return result_id;
end;
$$;

-- Called only from the locked mutation RPCs below. Any invalid historical edit is rolled back.
create or replace function public.assert_portfolio_ledger_valid(target_portfolio uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare row_record record; balances jsonb := '{}'::jsonb; available numeric(28,8);
begin
  for row_record in
    select transaction_type, symbol, quantity from public.portfolio_transactions
    where portfolio_id = target_portfolio
    order by occurred_at asc, created_at asc, id asc
  loop
    if row_record.transaction_type = 'acquisition' then
      balances := jsonb_set(balances, array[row_record.symbol], to_jsonb(coalesce((balances ->> row_record.symbol)::numeric, 0) + row_record.quantity));
    elsif row_record.transaction_type = 'disposal' then
      available := coalesce((balances ->> row_record.symbol)::numeric, 0);
      if row_record.quantity > available then
        raise exception 'Disposal exceeds available quantity for %', row_record.symbol using errcode = '23514';
      end if;
      balances := jsonb_set(balances, array[row_record.symbol], to_jsonb(available - row_record.quantity));
    end if;
  end loop;
end;
$$;

create or replace function public.create_portfolio_transaction(
  input_type text, input_symbol text, input_quantity numeric, input_price numeric,
  input_amount numeric, input_occurred_at date, input_note text, input_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target_portfolio uuid; result_id uuid;
begin
  target_portfolio := public.get_or_create_default_portfolio();
  perform 1 from public.portfolios where id = target_portfolio and user_id = (select auth.uid()) for update;
  insert into public.portfolio_transactions (portfolio_id, transaction_type, symbol, quantity, price, amount, occurred_at, note, idempotency_key)
  values (target_portfolio, input_type, nullif(upper(trim(input_symbol)), ''), input_quantity, input_price, input_amount, input_occurred_at, nullif(trim(input_note), ''), input_idempotency_key)
  on conflict (portfolio_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
  returning id into result_id;
  perform public.assert_portfolio_ledger_valid(target_portfolio);
  return result_id;
end;
$$;

create or replace function public.update_portfolio_transaction(
  transaction_id uuid, input_type text, input_symbol text, input_quantity numeric, input_price numeric,
  input_amount numeric, input_occurred_at date, input_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare target_portfolio uuid;
begin
  select pt.portfolio_id into target_portfolio from public.portfolio_transactions pt
  join public.portfolios p on p.id = pt.portfolio_id
  where pt.id = transaction_id and p.user_id = (select auth.uid());
  if target_portfolio is null then raise exception 'Transaction not found' using errcode = '42501'; end if;
  perform 1 from public.portfolios where id = target_portfolio for update;
  update public.portfolio_transactions set transaction_type = input_type,
    symbol = nullif(upper(trim(input_symbol)), ''), quantity = input_quantity, price = input_price,
    amount = input_amount, occurred_at = input_occurred_at, note = nullif(trim(input_note), ''), updated_at = now()
  where id = transaction_id and portfolio_id = target_portfolio;
  perform public.assert_portfolio_ledger_valid(target_portfolio);
end;
$$;

create or replace function public.delete_portfolio_transaction(transaction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_portfolio uuid;
begin
  select pt.portfolio_id into target_portfolio from public.portfolio_transactions pt
  join public.portfolios p on p.id = pt.portfolio_id
  where pt.id = transaction_id and p.user_id = (select auth.uid());
  if target_portfolio is null then raise exception 'Transaction not found' using errcode = '42501'; end if;
  perform 1 from public.portfolios where id = target_portfolio for update;
  delete from public.portfolio_transactions where id = transaction_id and portfolio_id = target_portfolio;
  perform public.assert_portfolio_ledger_valid(target_portfolio);
end;
$$;

revoke all on function public.get_or_create_default_portfolio() from public, anon;
revoke all on function public.assert_portfolio_ledger_valid(uuid) from public, anon, authenticated;
revoke all on function public.create_portfolio_transaction(text,text,numeric,numeric,numeric,date,text,uuid) from public, anon;
revoke all on function public.update_portfolio_transaction(uuid,text,text,numeric,numeric,numeric,date,text) from public, anon;
revoke all on function public.delete_portfolio_transaction(uuid) from public, anon;
grant execute on function public.get_or_create_default_portfolio() to authenticated;
grant execute on function public.create_portfolio_transaction(text,text,numeric,numeric,numeric,date,text,uuid) to authenticated;
grant execute on function public.update_portfolio_transaction(uuid,text,text,numeric,numeric,numeric,date,text) to authenticated;
grant execute on function public.delete_portfolio_transaction(uuid) to authenticated;

-- Force all writes through locked RPCs so overselling cannot bypass ledger validation.
revoke insert, update, delete on public.portfolio_transactions from authenticated;

insert into public.portfolios (user_id) select id from auth.users on conflict (user_id) do nothing;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name) values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', '')) on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.watchlists (user_id, name) values (new.id, 'รายการโปรด') on conflict (user_id) do nothing;
  insert into public.portfolios (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
