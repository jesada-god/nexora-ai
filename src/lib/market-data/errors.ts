import { ZodError } from 'zod';
import type { MarketDataApiError, MarketDataErrorCode } from './types';

const STATUS_BY_CODE: Record<MarketDataErrorCode, number> = {
  'provider-not-configured': 503,
  'invalid-request': 400,
  'invalid-symbol': 404,
  'not-found': 404,
  'rate-limited': 429,
  timeout: 504,
  'provider-unauthorized': 502,
  'upstream-unavailable': 502,
  'invalid-provider-response': 502,
  'internal-error': 500,
};

const RETRYABLE_CODES = new Set<MarketDataErrorCode>([
  'provider-not-configured',
  'rate-limited',
  'timeout',
  'upstream-unavailable',
  'internal-error',
]);

export class MarketDataError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    readonly code: MarketDataErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly issues?: MarketDataApiError['issues'],
  ) {
    super(message);
    this.name = 'MarketDataError';
    this.status = STATUS_BY_CODE[code];
    this.retryable = RETRYABLE_CODES.has(code);
  }

  toApiError(): MarketDataApiError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterSeconds ? { retryAfterSeconds: this.retryAfterSeconds } : {}),
      ...(this.issues?.length ? { issues: this.issues } : {}),
    };
  }
}

export interface ProviderFailureInput {
  status?: number;
  payload?: unknown;
  cause?: unknown;
  retryAfterSeconds?: number;
}

function providerMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['Note', 'Information', 'Error Message', 'message']) {
    if (typeof record[key] === 'string') return record[key];
  }
  return undefined;
}

export function mapProviderFailure(input: ProviderFailureInput): MarketDataError {
  const message = providerMessage(input.payload);
  const isAbort = input.cause instanceof Error && (
    input.cause.name === 'AbortError' || input.cause.name === 'TimeoutError'
  );

  if (isAbort) return new MarketDataError('timeout', 'Market data provider timed out');
  // Alpha Vantage quota messages often mention the API key. Quota signals must win
  // over the more general key matcher or exhausted free-tier keys become 502s.
  if (input.status === 429 || /frequency|rate limit|call volume|requests per|calls per|premium endpoint|daily.*limit/i.test(message ?? '')) {
    return new MarketDataError(
      'rate-limited',
      'Market data provider rate limit exceeded',
      input.retryAfterSeconds,
    );
  }
  if (input.status === 401 || input.status === 403 || /invalid api key|invalid apikey|api key is invalid|apikey is invalid/i.test(message ?? '')) {
    return new MarketDataError('provider-unauthorized', 'Market data provider rejected the API key');
  }
  if (/invalid api call|invalid symbol|symbol.*invalid/i.test(message ?? '')) {
    return new MarketDataError('invalid-symbol', 'The market symbol is invalid or unsupported');
  }
  if (input.status && input.status >= 500) {
    return new MarketDataError('upstream-unavailable', 'Market data provider is unavailable');
  }
  if (input.cause instanceof TypeError) {
    return new MarketDataError('upstream-unavailable', 'Could not reach market data provider');
  }
  if (message) return new MarketDataError('invalid-provider-response', message);
  return new MarketDataError('invalid-provider-response', 'Market data provider returned an invalid response');
}

export function fromZodError(error: ZodError): MarketDataError {
  return new MarketDataError(
    'invalid-request',
    'Invalid market data request',
    undefined,
    error.issues.map((issue) => ({
      path: issue.path.join('.') || 'request',
      message: issue.message,
    })),
  );
}
