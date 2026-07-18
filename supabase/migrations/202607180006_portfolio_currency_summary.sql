begin;

alter table public.portfolios alter column base_currency set default 'USD';
alter table public.user_settings alter column base_currency set default 'USD';

-- Phase 4 created every portfolio with THB before currency display was implemented.
-- Ledger amounts remain untouched; only the newly introduced display preference changes.
update public.portfolios set base_currency = 'USD', updated_at = now() where base_currency = 'THB';
update public.user_settings set base_currency = 'USD', updated_at = now() where base_currency = 'THB';

alter table public.portfolio_transactions
  add column if not exists original_amount numeric(28,8),
  add column if not exists original_currency text not null default 'USD',
  add column if not exists fx_rate_at_transaction numeric(28,8),
  add column if not exists normalized_amount_usd numeric(28,8);

update public.portfolio_transactions
set original_amount = amount,
    original_currency = 'USD',
    normalized_amount_usd = amount
where amount is not null and normalized_amount_usd is null;

alter table public.portfolio_transactions
  drop constraint if exists portfolio_transactions_currency_metadata;
alter table public.portfolio_transactions
  add constraint portfolio_transactions_currency_metadata check (
    original_currency in ('USD', 'THB')
    and (
      (amount is null and original_amount is null and fx_rate_at_transaction is null and normalized_amount_usd is null)
      or
      (amount is not null and original_amount is not null and normalized_amount_usd is not null
        and normalized_amount_usd > 0 and (
          (original_currency = 'USD' and fx_rate_at_transaction is null)
          or (original_currency = 'THB' and fx_rate_at_transaction > 0)
        ))
    )
  );

drop function if exists public.create_portfolio_transaction(text,text,numeric,numeric,numeric,date,text,uuid);
drop function if exists public.update_portfolio_transaction(uuid,text,text,numeric,numeric,numeric,date,text);

create function public.create_portfolio_transaction(
  input_type text, input_symbol text, input_quantity numeric, input_price numeric,
  input_amount numeric, input_occurred_at date, input_note text, input_idempotency_key uuid,
  input_original_currency text, input_fx_rate_at_transaction numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target_portfolio uuid; result_id uuid; normalized numeric(28,8);
begin
  target_portfolio := public.get_or_create_default_portfolio();
  perform 1 from public.portfolios where id = target_portfolio and user_id = (select auth.uid()) for update;
  normalized := case
    when input_amount is null then null
    when input_original_currency = 'USD' then input_amount
    when input_original_currency = 'THB' and input_fx_rate_at_transaction > 0 then round(input_amount / input_fx_rate_at_transaction, 8)
    else null
  end;
  insert into public.portfolio_transactions (
    portfolio_id, transaction_type, symbol, quantity, price, amount, occurred_at, note, idempotency_key,
    original_amount, original_currency, fx_rate_at_transaction, normalized_amount_usd
  ) values (
    target_portfolio, input_type, nullif(upper(trim(input_symbol)), ''), input_quantity, input_price,
    input_amount, input_occurred_at, nullif(trim(input_note), ''), input_idempotency_key,
    input_amount, coalesce(input_original_currency, 'USD'), input_fx_rate_at_transaction, normalized
  ) on conflict (portfolio_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
  returning id into result_id;
  perform public.assert_portfolio_ledger_valid(target_portfolio);
  return result_id;
end;
$$;

create function public.update_portfolio_transaction(
  transaction_id uuid, input_type text, input_symbol text, input_quantity numeric, input_price numeric,
  input_amount numeric, input_occurred_at date, input_note text, input_original_currency text,
  input_fx_rate_at_transaction numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare target_portfolio uuid; normalized numeric(28,8);
begin
  select pt.portfolio_id into target_portfolio from public.portfolio_transactions pt
  join public.portfolios p on p.id = pt.portfolio_id
  where pt.id = transaction_id and p.user_id = (select auth.uid());
  if target_portfolio is null then raise exception 'Transaction not found' using errcode = '42501'; end if;
  perform 1 from public.portfolios where id = target_portfolio for update;
  normalized := case
    when input_amount is null then null
    when input_original_currency = 'USD' then input_amount
    when input_original_currency = 'THB' and input_fx_rate_at_transaction > 0 then round(input_amount / input_fx_rate_at_transaction, 8)
    else null
  end;
  update public.portfolio_transactions set transaction_type = input_type,
    symbol = nullif(upper(trim(input_symbol)), ''), quantity = input_quantity, price = input_price,
    amount = input_amount, original_amount = input_amount, original_currency = coalesce(input_original_currency, 'USD'),
    fx_rate_at_transaction = input_fx_rate_at_transaction, normalized_amount_usd = normalized,
    occurred_at = input_occurred_at, note = nullif(trim(input_note), ''), updated_at = now()
  where id = transaction_id and portfolio_id = target_portfolio;
  perform public.assert_portfolio_ledger_valid(target_portfolio);
end;
$$;

create or replace function public.set_portfolio_base_currency(input_currency text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if input_currency not in ('USD', 'THB') then raise exception 'Unsupported currency' using errcode = '22023'; end if;
  update public.portfolios set base_currency = input_currency, updated_at = now() where user_id = (select auth.uid());
  if not found then raise exception 'Portfolio not found' using errcode = '42501'; end if;
  insert into public.user_settings (user_id, base_currency) values ((select auth.uid()), input_currency)
  on conflict (user_id) do update set base_currency = excluded.base_currency, updated_at = now();
end;
$$;

revoke all on function public.create_portfolio_transaction(text,text,numeric,numeric,numeric,date,text,uuid,text,numeric) from public, anon;
revoke all on function public.update_portfolio_transaction(uuid,text,text,numeric,numeric,numeric,date,text,text,numeric) from public, anon;
revoke all on function public.set_portfolio_base_currency(text) from public, anon;
grant execute on function public.create_portfolio_transaction(text,text,numeric,numeric,numeric,date,text,uuid,text,numeric) to authenticated;
grant execute on function public.update_portfolio_transaction(uuid,text,text,numeric,numeric,numeric,date,text,text,numeric) to authenticated;
grant execute on function public.set_portfolio_base_currency(text) to authenticated;

commit;
