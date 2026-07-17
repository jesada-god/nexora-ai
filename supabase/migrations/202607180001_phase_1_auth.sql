begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text check (char_length(full_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  base_currency text not null default 'THB' check (base_currency in ('THB', 'USD')),
  language text not null default 'th' check (language in ('th', 'en')),
  price_alerts_enabled boolean not null default true,
  daily_summary_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;

insert into public.profiles (id, full_name)
select id, nullif(raw_user_meta_data ->> 'full_name', '') from auth.users
on conflict (id) do nothing;

insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Users can read own settings" on public.user_settings;
create policy "Users can read own settings" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own settings" on public.user_settings;
create policy "Users can insert own settings" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own settings" on public.user_settings;
create policy "Users can update own settings" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  delete from auth.users where id = requesting_user;
  if not found then
    raise exception 'Account not found';
  end if;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

commit;
