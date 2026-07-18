import { NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';
import { NotificationsRepository } from '@/src/lib/alerts/repository';

export async function GET() {
  const client = await createClient(); if (!client) return NextResponse.json({ count: 0 });
  const { data: { user } } = await client.auth.getUser(); if (!user) return NextResponse.json({ count: 0 });
  try { return NextResponse.json({ count: await new NotificationsRepository(client, user.id).unreadCount() }); }
  catch { return NextResponse.json({ count: 0 }, { status: 503 }); }
}
