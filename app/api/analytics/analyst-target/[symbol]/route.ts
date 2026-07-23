import { NextResponse } from 'next/server';
import { loadAnalystTarget } from '@/src/lib/analytics/analyst-target/service';
import { checkAnalyticsRateLimit } from '@/src/lib/analytics/rate-limit';
import { getMarketDataGateway } from '@/src/lib/market-data/gateway/service';
import { symbolSchema } from '@/src/lib/market-data/validation';

export const dynamic = 'force-dynamic';

/**
 * Analyst price-target consensus — EXTERNAL reference data, served separately
 * from the Nexora Fair Value model. Always returns a structured result:
 * `available` with real provider numbers, or `unavailable` with a reason. Never a
 * fabricated target.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
): Promise<NextResponse> {
  const parsed = symbolSchema.safeParse((await context.params).symbol);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid-request', message: 'Malformed symbol' } },
      { status: 400 },
    );
  }
  const symbol = parsed.data;

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const identity = forwardedFor && /^[0-9a-f:.]{3,64}$/i.test(forwardedFor) ? forwardedFor : 'anonymous';
  const rate = checkAnalyticsRateLimit(`analyst-target:${identity}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { data: { status: 'unavailable', symbol, reason: 'ระบบจำกัดคำขอชั่วคราว กรุณาลองใหม่ภายหลัง' } },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  // Resolve the listing currency so the card can label the targets truthfully.
  // Best-effort: a resolution failure simply omits the currency, never blocks.
  let currency: string | null = null;
  try {
    const instrument = await getMarketDataGateway().resolveInstrument(symbol);
    currency = instrument.currency ?? null;
  } catch {
    currency = null;
  }

  const data = await loadAnalystTarget(symbol, { currency });
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
