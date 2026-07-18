import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { symbolSchema } from '@/src/lib/market-data/validation';
import { getNewsProvider, NewsProviderError } from '@/src/lib/news/provider';

const cursorSchema = z.coerce.number().int().min(1).max(100).transform(String);
export async function GET(request: NextRequest) {
  const rawSymbol = request.nextUrl.searchParams.get('symbol'); const rawCursor = request.nextUrl.searchParams.get('cursor');
  const parsedSymbol = rawSymbol ? symbolSchema.safeParse(rawSymbol) : null; const parsedCursor = rawCursor ? cursorSchema.safeParse(rawCursor) : null;
  if ((parsedSymbol && !parsedSymbol.success) || (parsedCursor && !parsedCursor.success)) return NextResponse.json({ data: null, error: { code: 'invalid-request', message: 'Invalid news request', retryable: false }, meta: { provider: null, timestamp: new Date().toISOString() } }, { status: 400 });
  try {
    const provider = getNewsProvider(); const cursor = parsedCursor?.success ? parsedCursor.data : undefined;
    const data = parsedSymbol?.success ? await provider.getSymbolNews(parsedSymbol.data, cursor) : await provider.getMarketNews(cursor);
    return NextResponse.json({ data, error: null, meta: { provider: provider.id, timestamp: new Date().toISOString() } }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } });
  } catch (cause) {
    const error = cause instanceof NewsProviderError ? cause : new NewsProviderError('provider-unavailable', 'News is temporarily unavailable');
    const response = NextResponse.json({ data: null, error: { code: error.code, message: error.message, retryable: !['configuration-required', 'invalid-key'].includes(error.code), ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }, meta: { provider: null, timestamp: new Date().toISOString() } }, { status: error.status });
    response.headers.set('Cache-Control', 'no-store'); if (error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds)); return response;
  }
}
