import { NextResponse } from 'next/server';
import { fairValueEnabled } from '@/src/config/features';
import { requireAnalyticsUser } from '@/src/lib/analytics/api-auth';
import { checkAnalyticsRateLimit } from '@/src/lib/analytics/rate-limit';
import { loadFairValue } from '@/src/lib/analytics/valuation/orchestration';
import { symbolSchema } from '@/src/lib/market-data/validation';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  if (!fairValueEnabled()) return NextResponse.json({ error: { code: 'feature-disabled', message: 'Fair Value feature is disabled' } }, { status: 404 });
  const auth = await requireAnalyticsUser(); if ('response' in auth) return auth.response;
  const parsed = symbolSchema.safeParse((await context.params).symbol); if (!parsed.success) return NextResponse.json({ error: { code: 'invalid-request', message: 'Malformed symbol' } }, { status: 400 });
  const rate = checkAnalyticsRateLimit(`fair-value:${auth.user.id}`, 10); if (!rate.allowed) return NextResponse.json({ error: { code: 'rate-limited', message: 'Fair Value workload limit exceeded' } }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
  const data = await loadFairValue(parsed.data); return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
