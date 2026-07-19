import { NextResponse } from 'next/server';
import { keyStatisticsEnabled } from '@/src/config/features';
import { requireAnalyticsUser } from '@/src/lib/analytics/api-auth';
import { checkAnalyticsRateLimit } from '@/src/lib/analytics/rate-limit';
import { loadKeyStatistics } from '@/src/lib/analytics/fundamentals/orchestration';
import { symbolSchema } from '@/src/lib/market-data/validation';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  if (!keyStatisticsEnabled()) return NextResponse.json({ error: { code: 'feature-disabled', message: 'Key Statistics feature is disabled' } }, { status: 404 });
  const auth = await requireAnalyticsUser(); if ('response' in auth) return auth.response;
  const parsed = symbolSchema.safeParse((await context.params).symbol); if (!parsed.success) return NextResponse.json({ error: { code: 'invalid-request', message: 'Malformed symbol', issues: parsed.error.issues } }, { status: 400 });
  const rate = checkAnalyticsRateLimit(`key-statistics:${auth.user.id}`); if (!rate.allowed) return NextResponse.json({ error: { code: 'rate-limited', message: 'Analytics workload limit exceeded' } }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
  try { const data = await loadKeyStatistics(parsed.data); return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } }); }
  catch { return NextResponse.json({ error: { code: 'upstream-unavailable', message: 'Key Statistics unavailable from configured providers' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
