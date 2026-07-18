import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202607180009_phase_7_alerts_notifications.sql'), 'utf8').replace(/\s+/g, ' ').toLowerCase();
describe('Phase 7 alerts and notifications migration', () => {
  it('supports all conditions, cooldown, and enables RLS', () => {
    for (const condition of ['above', 'below', 'percent_change_up', 'percent_change_down']) expect(sql).toContain(condition);
    expect(sql).toContain('cooldown_minutes between 1 and 10080');
    expect(sql).toContain('alter table public.price_alerts enable row level security');
    expect(sql).toContain('alter table public.notifications enable row level security');
  });
  it('scopes alert and notification policies to auth.uid ownership', () => {
    expect(sql.match(/\(select auth\.uid\(\)\) = user_id/g)?.length).toBeGreaterThanOrEqual(6);
    for (const operation of ['select', 'insert', 'update', 'delete']) expect(sql).toContain(`for ${operation} to authenticated`);
  });
  it('allows notification creation only through owner-scoped atomic cooldown RPC', () => {
    expect(sql).toContain('where id = alert_id and user_id = requesting_user and enabled = true for update');
    expect(sql).toContain('make_interval(mins => owned_alert.cooldown_minutes)');
    expect(sql).toContain('revoke insert, delete on public.notifications from authenticated');
    expect(sql).toContain("owned_alert.condition = 'percent_change_down'");
  });
});

