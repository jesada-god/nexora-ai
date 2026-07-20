import { NextResponse } from 'next/server';

import { AlertsRepository } from '@/src/lib/alerts/repository';
import { evaluateEnabledAlerts } from '@/src/lib/alerts/evaluation';
import { getMarketDataProvider } from '@/src/lib/market-data';
import { createClient } from '@/src/lib/supabase/server';

export const dynamic = 'force-dynamic';

function errorDetails(
  error: unknown,
  defaults: { message: string; code: string; status: number },
) {
  const record =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : null;

  return {
    message:
      error instanceof Error && error.message
        ? error.message
        : defaults.message,
    code:
      typeof record?.code === 'string'
        ? record.code
        : defaults.code,
    status:
      typeof record?.status === 'number'
        ? record.status
        : defaults.status,
  };
}

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

  let authResult: Awaited<ReturnType<typeof client.auth.getUser>>;

  try {
    authResult = await client.auth.getUser();
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'alert_evaluation_auth_failed',
        ...errorDetails(error, {
          message: 'Authentication session could not be verified',
          code: 'auth-verification-failed',
          status: 401,
        }),
      }),
    );

    return NextResponse.json(
      {
        error: 'Authentication session is invalid',
      },
      {
        status: 401,
      },
    );
  }

  const {
    data: { user },
    error: authError,
  } = authResult;

  if (authError) {
    console.warn(
      JSON.stringify({
        event: 'alert_evaluation_auth_failed',
        ...errorDetails(authError, {
          message: 'Authentication session is invalid',
          code: 'auth-session-invalid',
          status: 401,
        }),
      }),
    );

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
    console.error(
      JSON.stringify({
        event: 'alert_evaluation_failed',
        ...errorDetails(error, {
          message: 'Unknown evaluation error',
          code: 'alert-evaluation-failed',
          status: 503,
        }),
      }),
    );

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
