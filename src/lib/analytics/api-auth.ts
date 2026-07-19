import 'server-only';
import { NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';

export async function requireAnalyticsUser() {
  const client = await createClient();
  if (!client) return { response: NextResponse.json({ error: { code: 'service-unavailable', message: 'Supabase is not configured' } }, { status: 503 }) };
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: { code: 'unauthorized', message: 'Authentication required' } }, { status: 401 }) };
  return { user };
}
