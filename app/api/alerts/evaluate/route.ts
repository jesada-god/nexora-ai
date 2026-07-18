import { NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';
import { AlertsRepository } from '@/src/lib/alerts/repository';
import { evaluateEnabledAlerts } from '@/src/lib/alerts/evaluation';
import { getMarketDataProvider } from '@/src/lib/market-data';

export async function POST() {
  const client = await createClient();
  if (!client) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  try {
    const summary = await evaluateEnabledAlerts(new AlertsRepository(client, user.id), getMarketDataProvider());
    return NextResponse.json({ data: summary });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Evaluation failed' }, { status: 503 });
  }
}

