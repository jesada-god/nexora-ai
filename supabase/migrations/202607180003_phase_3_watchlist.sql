begin;

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'รายการโปรด' check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watchlists_one_per_user unique (user_id)
);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  symbol text not null check (
    symbol = upper(trim(symbol))
    and char_length(symbol) between 1 and 20
    and symbol ~ '^(\^[A-Z0-9]+|[A-Z0-9][A-Z0-9.-]*)$'
  ),
  created_at timestamptz not null default now(),
  constraint watchlist_items_symbol_unique unique (watchlist_id, symbol)
);

create index if not exists watchlist_items_watchlist_created_idx
  on public.watchlist_items (watchlist_id, created_at desc);

alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;

drop policy if exists "Users can read own watchlist" on public.watchlists;
create policy "Users can read own watchlist" on public.watchlists
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create own watchlist" on public.watchlists;
create policy "Users can create own watchlist" on public.watchlists
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own watchlist" on public.watchlists;
create policy "Users can update own watchlist" on public.watchlists
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own watchlist" on public.watchlists;
create policy "Users can delete own watchlist" on public.watchlists
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Item ownership is always derived from the parent. No caller can attach an item
-- to, read from, update in, or delete from another user's watchlist.
drop policy if exists "Users can read own watchlist items" on public.watchlist_items;
create policy "Users can read own watchlist items" on public.watchlist_items
  for select to authenticated using (exists (
    select 1 from public.watchlists w
    where w.id = watchlist_id and w.user_id = (select auth.uid())
  ));
drop policy if exists "Users can create own watchlist items" on public.watchlist_items;
create policy "Users can create own watchlist items" on public.watchlist_items
  for insert to authenticated with check (exists (
    select 1 from public.watchlists w
    where w.id = watchlist_id and w.user_id = (select auth.uid())
  ));
drop policy if exists "Users can update own watchlist items" on public.watchlist_items;
create policy "Users can update own watchlist items" on public.watchlist_items
  for update to authenticated using (exists (
    select 1 from public.watchlists w
    where w.id = watchlist_id and w.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.watchlists w
    where w.id = watchlist_id and w.user_id = (select auth.uid())
  ));
drop policy if exists "Users can delete own watchlist items" on public.watchlist_items;
create policy "Users can delete own watchlist items" on public.watchlist_items
  for delete to authenticated using (exists (
    select 1 from public.watchlists w
    where w.id = watchlist_id and w.user_id = (select auth.uid())
  ));

create or replace function public.get_or_create_default_watchlist()
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  result_id uuid;
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  insert into public.watchlists (user_id, name)
  values (requesting_user, 'รายการโปรด')
  on conflict (user_id) do update set user_id = excluded.user_id
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.get_or_create_default_watchlist() from public, anon;
grant execute on function public.get_or_create_default_watchlist() to authenticated;

insert into public.watchlists (user_id, name)
select id, 'รายการโปรด' from auth.users
on conflict (user_id) do nothing;

-- Extend the existing signup hook so new users start with exactly one watchlist.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  insert into public.watchlists (user_id, name) values (new.id, 'รายการโปรด')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
