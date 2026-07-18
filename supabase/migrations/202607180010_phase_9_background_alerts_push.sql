begin;

alter table public.user_settings
  add column if not exists push_enabled boolean not null default false,
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_hours_start time not null default '22:00',
  add column if not exists quiet_hours_end time not null default '07:00',
  add column if not exists timezone text not null default 'Asia/Bangkok'
    check (char_length(timezone) between 1 and 64);

alter table public.notifications
  add column if not exists idempotency_key text;

create unique index if not exists notifications_alert_idempotency_idx
  on public.notifications (price_alert_id, idempotency_key)
  where price_alert_id is not null and idempotency_key is not null;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  failure_count integer not null default 0 check (failure_count >= 0),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'retrying', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, subscription_id)
);

create table if not exists public.alert_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_window timestamptz not null unique,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  evaluated_count integer not null default 0,
  triggered_count integer not null default 0,
  unavailable_count integer not null default 0,
  push_sent_count integer not null default 0,
  push_failed_count integer not null default 0,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists price_alerts_background_due_idx
  on public.price_alerts (last_evaluated_at asc nulls first) where enabled = true;
create index if not exists push_deliveries_due_idx
  on public.push_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'retrying');
create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id, last_seen_at desc) where disabled_at is null;

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
alter table public.alert_evaluation_runs enable row level security;

drop policy if exists "Users can read own push subscriptions" on public.push_subscriptions;
create policy "Users can read own push subscriptions" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create own push subscriptions" on public.push_subscriptions;
create policy "Users can create own push subscriptions" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own push subscriptions" on public.push_subscriptions;
create policy "Users can update own push subscriptions" on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own push subscriptions" on public.push_subscriptions;
create policy "Users can delete own push subscriptions" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Queue one delivery per active device. The unique constraint makes retries safe.
create or replace function public.enqueue_notification_push()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.push_deliveries (notification_id, subscription_id)
  select new.id, subscription.id
  from public.push_subscriptions as subscription
  join public.user_settings as settings on settings.user_id = subscription.user_id
  where subscription.user_id = new.user_id
    and subscription.disabled_at is null
    and settings.push_enabled = true
    and settings.price_alerts_enabled = true
  on conflict (notification_id, subscription_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_notification_enqueue_push on public.notifications;
create trigger on_notification_enqueue_push
  after insert on public.notifications
  for each row execute procedure public.enqueue_notification_push();

revoke all on function public.enqueue_notification_push() from public, anon, authenticated;

-- Service-role-only equivalent of the Phase 7 owner RPC. It keeps notification
-- creation, cooldown and idempotency atomic while the row is locked.
create or replace function public.trigger_price_alert_service(
  alert_id uuid,
  observed_price numeric,
  observed_change_percent numeric,
  observed_at timestamptz,
  notification_title text,
  notification_message text,
  input_idempotency_key text
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  owned_alert public.price_alerts%rowtype;
  result_id uuid;
  alerts_allowed boolean;
begin
  select * into owned_alert from public.price_alerts
  where id = alert_id and enabled = true
  for update;
  if not found then return null; end if;

  select coalesce(settings.price_alerts_enabled, true) into alerts_allowed
  from public.user_settings as settings where settings.user_id = owned_alert.user_id;
  if alerts_allowed is false then return null; end if;

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

  insert into public.notifications (user_id, price_alert_id, title, message, metadata, idempotency_key)
  values (owned_alert.user_id, owned_alert.id, notification_title, notification_message,
    jsonb_build_object('symbol', owned_alert.symbol, 'condition', owned_alert.condition,
      'targetValue', owned_alert.target_value, 'observedPrice', observed_price,
      'observedChangePercent', observed_change_percent, 'observedAt', observed_at),
    input_idempotency_key)
  on conflict (price_alert_id, idempotency_key)
    where price_alert_id is not null and idempotency_key is not null
    do nothing
  returning id into result_id;

  if result_id is not null then
    update public.price_alerts set last_triggered_at = observed_at, updated_at = now()
    where id = owned_alert.id;
  end if;
  return result_id;
end;
$$;

revoke all on function public.trigger_price_alert_service(uuid, numeric, numeric, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.trigger_price_alert_service(uuid, numeric, numeric, timestamptz, text, text, text) to service_role;

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;
grant select, insert, update, delete on public.push_deliveries to service_role;
grant select, insert, update on public.alert_evaluation_runs to service_role;

commit;
