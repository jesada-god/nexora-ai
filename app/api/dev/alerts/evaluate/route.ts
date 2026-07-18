import { NextResponse } from 'next/server';
import { clientEnv } from '@/src/config/env/client';
import { POST as evaluate } from '@/app/api/alerts/evaluate/route';

export async function POST() {
  if (clientEnv.NEXT_PUBLIC_APP_ENV !== 'development') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return evaluate();
}

