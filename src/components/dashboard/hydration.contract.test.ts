import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatBangkokDateTime } from '@/src/lib/presentation/datetime';

const read = (relative: string) => readFileSync(
  new URL(`../../../${relative}`, import.meta.url),
  'utf8',
);

describe('Home hydration contract', () => {
  it('formats a timestamp independently of the host time zone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const fromUtcHost = formatBangkokDateTime('2026-07-20T04:00:00.000Z');
      process.env.TZ = 'America/New_York';
      const fromNewYorkHost = formatBangkokDateTime('2026-07-20T04:00:00.000Z');
      expect(fromUtcHost).toBe(fromNewYorkHost);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('hydrates persisted settings only after mount and does not mask mismatches', () => {
    const store = read('src/store/useStore.ts');
    const runtime = read('src/components/layout/AppRuntime.tsx');
    const layout = read('app/layout.tsx');

    expect(store).toContain('skipHydration: true');
    expect(runtime).toContain('useStore.persist.rehydrate()');
    expect(layout).not.toContain('suppressHydrationWarning');
  });

  it('keeps Home render output free of host-time and browser-only initializers', () => {
    const dashboard = read('src/components/dashboard/DashboardClient.tsx');
    const watchlist = read('src/components/watchlist/WatchlistClient.tsx');
    const news = read('src/components/news/NewsFeed.tsx');

    expect(dashboard).not.toContain('Date.now()');
    expect(watchlist).not.toContain('Date.now()');
    expect(news).not.toContain("useState(() => typeof navigator");
  });
});
