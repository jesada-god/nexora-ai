import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { OptionSimulationsRepository } from '@/src/lib/options-simulator/repository';
import type { SimulationWorkspace } from '@/src/lib/options-simulator/types';
import { simulationWorkspaceSchema } from '@/src/lib/options-simulator/validation';
import { createClient } from '@/src/lib/supabase/server';

async function authenticatedRepository() {
  const client = await createClient();
  if (!client) return null;
  const { data: { user } } = await client.auth.getUser();
  return user ? new OptionSimulationsRepository(client, user.id) : null;
}

export async function GET(request: NextRequest) {
  const repository = await authenticatedRepository();
  if (!repository) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: 'Invalid pagination' }, { status: 400 });
  try { return NextResponse.json({ data: await repository.list(query.data.page, query.data.pageSize) }); }
  catch { return NextResponse.json({ error: 'Unable to load simulations' }, { status: 503 }); }
}

export async function POST(request: Request) {
  const repository = await authenticatedRepository();
  if (!repository) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 500_000) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* schema response below */ }
  const parsed = simulationWorkspaceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid simulation', issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json({ data: await repository.create(parsed.data as SimulationWorkspace) }, { status: 201 }); }
  catch { return NextResponse.json({ error: 'Unable to save simulation' }, { status: 503 }); }
}
