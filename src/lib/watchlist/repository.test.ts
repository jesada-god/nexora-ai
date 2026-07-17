import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/src/types/database';

vi.mock('server-only', () => ({}));

const { WatchlistRepository } = await import('./repository');

function clientWith(from: ReturnType<typeof vi.fn>, rpcData = 'watchlist-1') {
  return {
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: null }),
    from,
  } as unknown as SupabaseClient<Database>;
}

describe('WatchlistRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates/loads the default watchlist and its persisted items', async () => {
    const watchlistQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'watchlist-1', name: 'รายการโปรด' }, error: null }),
    };
    const itemQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [{ id: 'item-1', symbol: 'AAPL', created_at: '2026-07-18T00:00:00.000Z' }], error: null }),
    };
    const from = vi.fn((table: string) => table === 'watchlists' ? watchlistQuery : itemQuery);
    const repo = new WatchlistRepository(clientWith(from));

    await expect(repo.getDefault()).resolves.toEqual({
      id: 'watchlist-1', name: 'รายการโปรด',
      items: [{ id: 'item-1', symbol: 'AAPL', createdAt: '2026-07-18T00:00:00.000Z' }],
    });
  });

  it('supports create and surfaces the database duplicate constraint', async () => {
    const insertQuery = {
      insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn()
        .mockResolvedValueOnce({ data: { id: 'item-1', symbol: 'AAPL', created_at: '2026-07-18T00:00:00.000Z' }, error: null })
        .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } }),
    };
    const repo = new WatchlistRepository(clientWith(vi.fn(() => insertQuery)));
    await expect(repo.add('AAPL')).resolves.toMatchObject({ symbol: 'AAPL' });
    await expect(repo.add('AAPL')).rejects.toMatchObject({ code: '23505' });
    expect(insertQuery.insert).toHaveBeenCalledWith({ watchlist_id: 'watchlist-1', symbol: 'AAPL' });
  });

  it('scopes update and delete operations to the caller default watchlist', async () => {
    const deleteQuery = {
      delete: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: 'item-1' }], error: null }),
    };
    const updateQuery = {
      update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const watchlistDeleteQuery = {
      delete: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const from = vi.fn()
      .mockReturnValueOnce(deleteQuery)
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(watchlistDeleteQuery);
    const repo = new WatchlistRepository(clientWith(from));

    await expect(repo.remove('AAPL')).resolves.toBe(true);
    await expect(repo.rename('ติดตาม')).resolves.toBeUndefined();
    await expect(repo.delete()).resolves.toBeUndefined();
    expect(deleteQuery.eq).toHaveBeenNthCalledWith(1, 'watchlist_id', 'watchlist-1');
    expect(deleteQuery.eq).toHaveBeenNthCalledWith(2, 'symbol', 'AAPL');
    expect(updateQuery.eq).toHaveBeenCalledWith('id', 'watchlist-1');
    expect(watchlistDeleteQuery.eq).toHaveBeenCalledWith('id', 'watchlist-1');
  });

  it('does not hide an RLS authorization failure', async () => {
    const insertQuery = {
      insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'row-level security policy' } }),
    };
    const repo = new WatchlistRepository(clientWith(vi.fn(() => insertQuery)));
    await expect(repo.add('MSFT')).rejects.toMatchObject({ code: '42501' });
  });
});
