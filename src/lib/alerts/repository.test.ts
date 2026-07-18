import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/src/types/database';
vi.mock('server-only', () => ({}));
const { AlertsRepository, NotificationsRepository } = await import('./repository');

function client(from: ReturnType<typeof vi.fn>) { return { from, rpc: vi.fn() } as unknown as SupabaseClient<Database>; }
describe('alert repository ownership', () => {
  it('adds user_id ownership on create', async () => {
    const row = { id: 'a', user_id: 'user-1', symbol: 'AAPL', condition: 'above', target_value: '100', enabled: true, cooldown_minutes: 60, last_evaluated_at: null, last_triggered_at: null, created_at: 'now', updated_at: 'now' };
    const query = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: row, error: null }) };
    await new AlertsRepository(client(vi.fn(() => query)), 'user-1').create({ symbol: 'AAPL', condition: 'above', targetValue: 100, cooldownMinutes: 60, enabled: true });
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }));
  });
  it('owner-scopes alert mutation by id and user_id', async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockResolvedValue({ data: [{ id: 'a' }], error: null }) };
    await new AlertsRepository(client(vi.fn(() => query)), 'user-1').setEnabled('a', false);
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'a'); expect(query.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-1');
  });
  it('owner-scopes notification reads and mark-all updates', async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockResolvedValue({ data: [{ id: 'n' }], error: null }) };
    await new NotificationsRepository(client(vi.fn(() => query)), 'user-1').markAllRead();
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1'); expect(query.is).toHaveBeenCalledWith('read_at', null);
  });
});
