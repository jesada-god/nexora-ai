import { describe, expect, it, vi } from 'vitest';
import {
  AlertEvaluationRequestError,
  requestAlertEvaluation,
} from './client';

vi.mock('@/src/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

describe('alert evaluation browser request', () => {
  it('waits for an authenticated user and includes same-origin cookies', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    };

    const response = await requestAlertEvaluation({
      client: client as never,
      fetchImpl: fetchImpl as never,
    });

    expect(response.status).toBe(200);
    expect(client.auth.getUser).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/alerts/evaluate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      }),
    );
  });

  it('does not evaluate before auth resolves to an authenticated user', async () => {
    const fetchImpl = vi.fn();
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: null,
        })),
      },
    };

    await expect(
      requestAlertEvaluation({
        client: client as never,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AlertEvaluationRequestError>>({
        status: 401,
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
