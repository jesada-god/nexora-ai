import { NextResponse } from 'next/server';

import { AlertsRepository } from '@/src/lib/alerts/repository';
import { evaluateEnabledAlerts } from '@/src/lib/alerts/evaluation';
import { getMarketDataProvider } from '@/src/lib/market-data';
import { createClient } from '@/src/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const client = await createClient();

  if (!client) {
    return NextResponse.json(
      {
        error: 'Supabase is not configured',
      },
      {
        status: 503,
      },
    );
  }

  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();

  if (authError) {
    console.warn('Alert evaluation authentication failed', {
      code: authError.code,
      status: authError.status,
    });

    return NextResponse.json(
      {
        error: 'Authentication session is invalid',
      },
      {
        status: 401,
      },
    );
  }

  if (!user) {
    return NextResponse.json(
      {
        error: 'Authentication required',
      },
      {
        status: 401,
      },
    );
  }

  try {
    const repository = new AlertsRepository(client, user.id);
    const provider = getMarketDataProvider();

    const summary = await evaluateEnabledAlerts(
      repository,
      provider,
    );

    return NextResponse.json(
      {
        data: summary,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error('Alert evaluation failed', {
      message:
        error instanceof Error
          ? error.message
          : 'Unknown evaluation error',
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Evaluation failed',
      },
      {
        status: 503,
      },
    );
  }
}