import { NextResponse } from 'next/server';
import { fairValueEnabled } from '@/src/config/features';
import { checkAnalyticsRateLimit } from '@/src/lib/analytics/rate-limit';
import { writeFairValueLog } from '@/src/lib/analytics/valuation/logging';
import { loadFairValue } from '@/src/lib/analytics/valuation/orchestration';
import { createFairValueUnavailable } from '@/src/lib/analytics/valuation/result';
import { fairValueResultSchema } from '@/src/lib/analytics/valuation/schemas';
import { symbolSchema } from '@/src/lib/market-data/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
): Promise<NextResponse> {
  if (!fairValueEnabled()) {
    writeFairValueLog({
      event: 'fair_value_evaluation',
      status: 'disabled',
      failureKind: 'feature-disabled',
    });
    return NextResponse.json(
      { error: { code: 'feature-disabled', message: 'Fair Value feature is disabled by FEATURE_FAIR_VALUE=false' } },
      { status: 404 },
    );
  }

  const parsed = symbolSchema.safeParse((await context.params).symbol);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid-request', message: 'Malformed symbol' } },
      { status: 400 },
    );
  }

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const requestIdentity = forwardedFor && /^[0-9a-f:.]{3,64}$/i.test(forwardedFor)
    ? forwardedFor
    : 'anonymous';
  const rate = checkAnalyticsRateLimit(`fair-value:${requestIdentity}`, 10);
  if (!rate.allowed) {
    const calculatedAt = new Date().toISOString();
    const data = createFairValueUnavailable({
      failureKind: 'rate-limited',
      symbol: parsed.data,
      reason: 'ระบบจำกัดคำขอ Fair Value ชั่วคราว กรุณาลองใหม่ภายหลัง',
      missingFields: [],
      asOf: calculatedAt,
      calculatedAt,
      limitations: ['No valuation is returned while the workload limit is active.'],
    });
    return NextResponse.json(
      { data },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      },
    );
  }

  try {
    const data = fairValueResultSchema.parse(await loadFairValue(parsed.data));
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    const calculatedAt = new Date().toISOString();
    const data = createFairValueUnavailable({
      failureKind: 'server-error',
      symbol: parsed.data,
      reason: 'เซิร์ฟเวอร์ไม่สามารถประมวลผล Fair Value ได้อย่างปลอดภัย',
      missingFields: ['valuationService'],
      asOf: calculatedAt,
      calculatedAt,
      limitations: ['No partial or synthetic fair value is returned after a server error.'],
    });
    writeFairValueLog({
      event: 'fair_value_evaluation',
      status: 'unavailable',
      symbol: parsed.data,
      failureKind: data.failureKind,
      missingInputCount: data.missingFields.length,
      errorCode: 'internal-error',
    });
    return NextResponse.json(
      { data },
      {
        status: 500,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
