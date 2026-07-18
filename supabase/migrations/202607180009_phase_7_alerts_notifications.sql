begin;

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (
    symbol = upper(trim(symbol))
    and char_length(symbol) between 1 and 20
    and symbol ~ '^(\^[A-Z0-9]+|[A-Z0-9][A-Z0-9.-]*)$'
  ),
  condition text not null check (condition in ('above', 'below', 'percent_change_up', 'percent_change_down')),
  target_value numeric not null check (target_value > 0),
  enabled boolean not null default true,
  cooldown_minutes integer not null default 60 check (cooldown_minutes between 1 and 10080),
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  price_alert_id uuid references public.price_alerts(id) on delete set null,
  type text not null default 'price_alert' check (type in ('price_alert', 'system')),
  title text not null check (char_length(title) between 1 and 160),
  message text not null check (char_length(message) between 1 and 1000),
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists price_alerts_user_enabled_idx
  on public.price_alerts (user_id, enabled, created_at desc);
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

alter table public.price_alerts enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Users can read own price alerts" on public.price_alerts;
create policy "Users can read own price alerts" on public.price_alerts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create own price alerts" on public.price_alerts;
create policy "Users can create own price alerts" on public.price_alerts
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own price alerts" on public.price_alerts;
create policy "Users can update own price alerts" on public.price_alerts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own price alerts" on public.price_alerts;
create policy "Users can delete own price alerts" on public.price_alerts
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications" on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications" on public.notifications
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Notifications are created only through this owner-scoped, atomic function.
-- It takes the observed quote from the app and applies cooldown under a row lock.
create or replace function public.trigger_price_alert(
  alert_id uuid,
  observed_price numeric,
  observed_change_percent numeric,
  observed_at timestamptz,
  notification_title text,
  notification_message text
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  owned_alert public.price_alerts%rowtype;
  result_id uuid;
begin
  if requesting_user is null then raise exception 'Authentication required'; end if;

  select * into owned_alert from public.price_alerts
  where id = alert_id and user_id = requesting_user and enabled = true
  for update;
  if not found then return null; end if;

  update public.price_alerts set last_evaluated_at = observed_at, updated_at = now()
  where id = owned_alert.id;

  if not (
    (owned_alert.condition = 'above' and observed_price >= owned_alert.target_value)
    or (owned_alert.condition = 'below' and observed_price <= owned_alert.target_value)
    or (owned_alert.condition = 'percent_change_up' and observed_change_percent >= owned_alert.target_value)
    or (owned_alert.condition = 'percent_change_down' and observed_change_percent <= -owned_alert.target_value)
  ) then return null; end if;

  if owned_alert.last_triggered_at is not null
     and observed_at < owned_alert.last_triggered_at + make_interval(mins => owned_alert.cooldown_minutes)
  then return null; end if;

  insert into public.notifications (user_id, price_alert_id, title, message, metadata)
  values (requesting_user, owned_alert.id, notification_title, notification_message,
    jsonb_build_object('symbol', owned_alert.symbol, 'condition', owned_alert.condition,
      'targetValue', owned_alert.target_value, 'observedPrice', observed_price,
      'observedChangePercent', observed_change_percent, 'observedAt', observed_at))
  returning id into result_id;

  update public.price_alerts set last_triggered_at = observed_at, updated_at = now()
  where id = owned_alert.id;
  return result_id;
end;
$$;

revoke all on function public.trigger_price_alert(uuid, numeric, numeric, timestamptz, text, text) from public, anon;
grant execute on function public.trigger_price_alert(uuid, numeric, numeric, timestamptz, text, text) to authenticated;
revoke insert, delete on public.notifications from authenticated;

commit;
