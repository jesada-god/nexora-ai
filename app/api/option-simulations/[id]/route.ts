import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OptionSimulationsRepository } from '@/src/lib/options-simulator/repository';
import type { SimulationWorkspace } from '@/src/lib/options-simulator/types';
import { simulationWorkspaceSchema } from '@/src/lib/options-simulator/validation';
import { createClient } from '@/src/lib/supabase/server';

const paramsSchema = z.object({ id: z.string().uuid() });
async function contextRepository() {
  const client = await createClient();
  if (!client) return null;
  const { data: { user } } = await client.auth.getUser();
  return user ? new OptionSimulationsRepository(client, user.id) : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const repository = await contextRepository();
  if (!repository) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const params = paramsSchema.safeParse(await context.params);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 500_000) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  let body: { workspace?: unknown; expectedUpdatedAt?: unknown } | null;
  try { body = JSON.parse(raw) as { workspace?: unknown; expectedUpdatedAt?: unknown }; } catch { body = null; }
  const workspace = simulationWorkspaceSchema.safeParse(body?.workspace);
  const timestamp = z.iso.datetime().safeParse(body?.expectedUpdatedAt);
  if (!params.success || !workspace.success || !timestamp.success) return NextResponse.json({ error: 'Invalid update' }, { status: 400 });
  try {
    const updated = await repository.update(params.data.id, workspace.data as SimulationWorkspace, timestamp.data);
    return updated ? NextResponse.json({ data: updated }) : NextResponse.json({ error: 'Simulation changed on another device', code: 'conflict' }, { status: 409 });
  } catch { return NextResponse.json({ error: 'Unable to update simulation' }, { status: 503 }); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const repository = await contextRepository();
  if (!repository) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: 'Invalid simulation id' }, { status: 400 });
  try { return await repository.remove(params.data.id) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: 'Not found' }, { status: 404 }); }
  catch { return NextResponse.json({ error: 'Unable to delete simulation' }, { status: 503 }); }
}
