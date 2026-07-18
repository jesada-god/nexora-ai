import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202607180010_phase_9_background_alerts_push.sql'), 'utf8').replace(/\s+/g, ' ').toLowerCase();

describe('Phase 9 background alerts and push migration', () => {
  it('keeps subscriptions owner-scoped while service tables have RLS', () => {
    expect(sql).toContain('alter table public.push_subscriptions enable row level security');
    expect(sql).toContain('alter table public.push_deliveries enable row level security');
    expect(sql).toContain('alter table public.alert_evaluation_runs enable row level security');
    expect(sql).toContain('(select auth.uid()) = user_id');
  });
  it('provides atomic cooldown and idempotency for service evaluation', () => {
    expect(sql).toContain('for update;');
    expect(sql).toContain('make_interval(mins => owned_alert.cooldown_minutes)');
    expect(sql).toContain('notifications_alert_idempotency_idx');
    expect(sql).toContain('grant execute on function public.trigger_price_alert_service');
    expect(sql).toContain('to service_role');
  });
  it('queues only opted-in active devices with unique deliveries', () => {
    expect(sql).toContain('settings.push_enabled = true');
    expect(sql).toContain('subscription.disabled_at is null');
    expect(sql).toContain('unique (notification_id, subscription_id)');
  });
});
