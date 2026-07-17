import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202607180003_phase_3_watchlist.sql'), 'utf8')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('Phase 3 watchlist migration security contract', () => {
  it('enforces one watchlist per user and no duplicate symbol in a watchlist', () => {
    expect(sql).toContain('unique (user_id)');
    expect(sql).toContain('unique (watchlist_id, symbol)');
  });

  it('enables RLS on both tables', () => {
    expect(sql).toContain('alter table public.watchlists enable row level security');
    expect(sql).toContain('alter table public.watchlist_items enable row level security');
  });

  it('authorizes every item operation through its parent owner', () => {
    expect(sql.match(/w\.id = watchlist_id and w\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(5);
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toContain(`for ${operation} to authenticated`);
    }
  });

  it('creates a default watchlist safely for existing and new users', () => {
    expect(sql).toContain('get_or_create_default_watchlist');
    expect(sql).toContain("on conflict (user_id) do nothing");
    expect(sql).toContain("insert into public.watchlists (user_id, name) values (new.id, 'รายการโปรด')");
  });
});
