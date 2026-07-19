import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import {
  CompanyProfileTranslationError,
  getCompanyProfileTranslationService,
} from '@/src/lib/translation/company-profile';

export async function POST(request: Request) {
  const timestamp = new Date().toISOString();
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 16_000) {
      throw new CompanyProfileTranslationError('invalid-request', 'Translation request is too large');
    }
    const body = await request.json();
    const result = await getCompanyProfileTranslationService().translate(body);
    return NextResponse.json({
      data: result.data,
      meta: { cached: result.cached, timestamp },
    }, {
      headers: {
        'Cache-Control': 'private, max-age=0',
      },
    });
  } catch (cause) {
    const error = cause instanceof CompanyProfileTranslationError
      ? cause
      : cause instanceof ZodError || cause instanceof SyntaxError
        ? new CompanyProfileTranslationError('invalid-request', 'Invalid translation request')
        : new CompanyProfileTranslationError('upstream-unavailable', 'Translation is temporarily unavailable');
    const response = NextResponse.json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      },
      meta: { cached: false, timestamp },
    }, { status: error.status });
    response.headers.set('Cache-Control', 'no-store');
    if (error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
}
