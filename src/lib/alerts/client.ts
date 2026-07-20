'use client';

import type { User } from '@supabase/supabase-js';
import { createClient } from '@/src/lib/supabase/client';

interface AlertAuthClient {
  auth: {
    getUser(): Promise<{
      data: { user: User | null };
      error: Error | null;
    }>;
  };
}

interface AlertEvaluationRequestOptions {
  client?: AlertAuthClient | null;
  fetchImpl?: typeof fetch;
}

export class AlertEvaluationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AlertEvaluationRequestError';
  }
}

export async function requestAlertEvaluation(
  options: AlertEvaluationRequestOptions = {},
): Promise<Response> {
  const client = options.client === undefined
    ? createClient()
    : options.client;

  if (!client) {
    throw new AlertEvaluationRequestError(
      'Supabase is not configured',
      503,
    );
  }

  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error || !user) {
    throw new AlertEvaluationRequestError(
      'Authentication required',
      401,
    );
  }

  return (options.fetchImpl ?? fetch)('/api/alerts/evaluate', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
}
