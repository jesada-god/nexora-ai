import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverEnv } from '@/src/config/env/server';
import { createClient } from '@/src/lib/supabase/server';
import { isPushConfigured } from '@/src/lib/push/service';

const subscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  expirationTime: z.number().int().nonnegative().nullable(),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});
const removeSchema = z.object({ endpoint: z.url().max(2048) });

async function authenticated() {
  const client = await createClient();
  if (!client) return null;
  const { data: { user } } = await client.auth.getUser();
  return user ? { client, user } : null;
}

export async function GET() {
  const auth = await authenticated();
  if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  return NextResponse.json({ data: { configured: isPushConfigured(), publicKey: isPushConfigured() ? serverEnv.WEB_PUSH_VAPID_PUBLIC_KEY : null } });
}

export async function POST(request: NextRequest) {
  const auth = await authenticated();
  if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!isPushConfigured()) return NextResponse.json({ error: 'Push is not configured' }, { status: 503 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 });
  const now = new Date().toISOString();
  const { error } = await auth.client.from('push_subscriptions').upsert({ user_id: auth.user.id, endpoint: parsed.data.endpoint,
    expiration_time: parsed.data.expirationTime, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth,
    user_agent: request.headers.get('user-agent')?.slice(0, 200) ?? null, disabled_at: null, failure_count: 0,
    last_seen_at: now, updated_at: now }, { onConflict: 'user_id,endpoint' });
  if (error) return NextResponse.json({ error: 'Could not save push subscription' }, { status: 503 });
  await auth.client.from('user_settings').update({ push_enabled: true, updated_at: now }).eq('user_id', auth.user.id);
  return NextResponse.json({ data: { subscribed: true } });
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticated();
  if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 });
  const { error } = await auth.client.from('push_subscriptions').delete().eq('user_id', auth.user.id).eq('endpoint', parsed.data.endpoint);
  if (error) return NextResponse.json({ error: 'Could not remove push subscription' }, { status: 503 });
  const { count } = await auth.client.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id).is('disabled_at', null);
  if (!count) await auth.client.from('user_settings').update({ push_enabled: false, updated_at: new Date().toISOString() }).eq('user_id', auth.user.id);
  return NextResponse.json({ data: { subscribed: false } });
}
