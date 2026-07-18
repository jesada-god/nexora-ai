import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/src/types/database';

vi.mock('server-only', () => ({}));
const { OptionPositionRepository } = await import('./repository');

const input = { underlyingSymbol: 'NVDA', optionKind: 'call' as const, contracts: '2', premiumPerShare: '1.25', strikePrice: '150', openedAt: '2026-07-01', expirationDate: '2026-08-01', impliedVolatility: '35', delta: '0.4', theta: '-0.03', note: '', status: 'open' as const, idempotencyKey: '550e8400-e29b-41d4-a716-446655440000' };

describe('OptionPositionRepository mutations', () => {
  it('uses owner-scoped RPCs for edit, close, and delete', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: undefined, error: null });
    const repo = new OptionPositionRepository({ rpc } as unknown as SupabaseClient<Database>);
    await repo.update('position-1', input); await repo.close('position-1', '2026-07-18'); await repo.delete('position-1');
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(['update_option_position', 'close_option_position', 'delete_option_position']);
    expect(rpc).toHaveBeenNthCalledWith(3, 'delete_option_position', { position_id: 'position-1' });
  });
  it('does not hide an RLS authorization failure', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) } as unknown as SupabaseClient<Database>;
    await expect(new OptionPositionRepository(client).delete('other-user-position')).rejects.toMatchObject({ code: '42501' });
  });
});
