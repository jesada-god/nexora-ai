import 'server-only';

import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/src/config/env/server';
import type { Database } from '@/src/types/database';
import { isQuietHour } from './quiet-hours';

const MAX_ATTEMPTS = 3;

export function isPushConfigured(): boolean {
  return Boolean(serverEnv.WEB_PUSH_VAPID_PUBLIC_KEY && serverEnv.WEB_PUSH_VAPID_PRIVATE_KEY && serverEnv.WEB_PUSH_SUBJECT);
}

function configureWebPush() {
  if (!isPushConfigured()) throw new Error('push-not-configured');
  webpush.setVapidDetails(
    serverEnv.WEB_PUSH_SUBJECT as string,
    serverEnv.WEB_PUSH_VAPID_PUBLIC_KEY as string,
    serverEnv.WEB_PUSH_VAPID_PRIVATE_KEY as string,
  );
}

export async function deliverPendingPushes(client: SupabaseClient<Database>, limit = 50, now = new Date()) {
  const summary = { sent: 0, failed: 0, deferred: 0, cleaned: 0 };
  const staleDisabled = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const { data: expired } = await client.from('push_subscriptions').delete().not('expiration_time', 'is', null).lt('expiration_time', now.getTime()).select('id');
  const { data: disabled } = await client.from('push_subscriptions').delete().not('disabled_at', 'is', null).lt('disabled_at', staleDisabled).select('id');
  summary.cleaned += (expired?.length ?? 0) + (disabled?.length ?? 0);
  if (!isPushConfigured()) return summary;
  configureWebPush();
  const { data, error } = await client.from('push_deliveries')
    .select('*, notification:notifications(title, message, metadata, user_id), subscription:push_subscriptions(*)')
    .in('status', ['pending', 'retrying']).lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at').limit(limit);
  if (error) throw error;

  for (const delivery of data ?? []) {
    const notification = delivery.notification as unknown as { title: string; message: string; metadata: unknown; user_id: string } | null;
    const subscription = delivery.subscription as unknown as Database['public']['Tables']['push_subscriptions']['Row'] | null;
    if (!notification || !subscription || subscription.disabled_at) {
      await client.from('push_deliveries').update({ status: 'skipped', updated_at: now.toISOString(), last_error_code: 'inactive-subscription' }).eq('id', delivery.id);
      continue;
    }
    const { data: settings } = await client.from('user_settings').select('push_enabled, price_alerts_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone').eq('user_id', notification.user_id).maybeSingle();
    if (!settings?.push_enabled || !settings.price_alerts_enabled) {
      await client.from('push_deliveries').update({ status: 'skipped', updated_at: now.toISOString(), last_error_code: 'preference-disabled' }).eq('id', delivery.id);
      continue;
    }
    if (settings.quiet_hours_enabled && isQuietHour(now, settings.timezone, settings.quiet_hours_start, settings.quiet_hours_end)) {
      await client.from('push_deliveries').update({ next_attempt_at: new Date(now.getTime() + 15 * 60_000).toISOString(), updated_at: now.toISOString() }).eq('id', delivery.id);
      summary.deferred += 1; continue;
    }
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, expirationTime: subscription.expiration_time, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({
        title: notification.title, body: notification.message, url: '/notifications', tag: `notification-${delivery.notification_id}`,
      }), { TTL: 60 * 60, urgency: 'normal' });
      await client.from('push_deliveries').update({ status: 'sent', attempt_count: delivery.attempt_count + 1, sent_at: now.toISOString(), updated_at: now.toISOString(), last_error_code: null }).eq('id', delivery.id);
      await client.from('push_subscriptions').update({ failure_count: 0, last_seen_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', subscription.id);
      summary.sent += 1;
    } catch (cause) {
      const statusCode = typeof cause === 'object' && cause && 'statusCode' in cause ? Number(cause.statusCode) : 0;
      const gone = statusCode === 404 || statusCode === 410;
      const attempts = delivery.attempt_count + 1;
      const terminal = gone || attempts >= MAX_ATTEMPTS;
      const code = gone ? 'subscription-gone' : statusCode ? `push-http-${statusCode}` : 'push-failed';
      await client.from('push_deliveries').update({ status: terminal ? 'failed' : 'retrying', attempt_count: attempts,
        next_attempt_at: new Date(now.getTime() + Math.min(60, 2 ** attempts * 5) * 60_000).toISOString(), last_error_code: code, updated_at: now.toISOString() }).eq('id', delivery.id);
      await client.from('push_subscriptions').update({ failure_count: subscription.failure_count + 1,
        ...(gone ? { disabled_at: now.toISOString() } : {}), updated_at: now.toISOString() }).eq('id', subscription.id);
      summary.failed += 1; if (gone) summary.cleaned += 1;
    }
  }
  return summary;
}
