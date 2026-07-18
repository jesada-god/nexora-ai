begin;

create table public.market_fx_rates (
  base_currency text not null check (base_currency = upper(trim(base_currency)) and char_length(base_currency) = 3),
  quote_currency text not null check (quote_currency = upper(trim(quote_currency)) and char_length(quote_currency) = 3),
  rate numeric(28,8) not null check (rate > 0),
  source text not null check (char_length(trim(source)) > 0),
  provider_updated_at timestamptz not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (base_currency, quote_currency),
  check (base_currency <> quote_currency)
);

create or replace function public.set_market_fx_rates_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger market_fx_rates_set_updated_at
before update on public.market_fx_rates
for each row execute function public.set_market_fx_rates_updated_at();

alter table public.market_fx_rates enable row level security;
revoke all on public.market_fx_rates from public, anon, authenticated;
grant select, insert, update on public.market_fx_rates to service_role;
revoke all on function public.set_market_fx_rates_updated_at() from public, anon, authenticated;

commit;
