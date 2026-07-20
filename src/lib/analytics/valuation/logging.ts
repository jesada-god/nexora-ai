import type { FairValueFailureKind } from './types';

export interface FairValueLogEntry {
  event: 'fair_value_evaluation';
  status: 'available' | 'unavailable' | 'disabled';
  symbol?: string;
  provider?: string;
  failureKind?: FairValueFailureKind | 'feature-disabled';
  missingInputCount?: number;
  errorCode?: string;
}

export type FairValueLogger = (entry: FairValueLogEntry) => void;

const SAFE_ERROR_CODES = new Set([
  'provider-not-configured',
  'invalid-request',
  'invalid-symbol',
  'not-found',
  'rate-limited',
  'timeout',
  'provider-unauthorized',
  'upstream-unavailable',
  'invalid-provider-response',
  'insufficient-data',
  'internal-error',
]);

const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'AbortError',
  'TimeoutError',
  'MarketDataError',
]);

export function safeFairValueErrorCode(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
    if (SAFE_ERROR_CODES.has(cause.code)) return cause.code;
  }
  return cause instanceof Error && SAFE_ERROR_NAMES.has(cause.name)
    ? cause.name
    : 'unknown-error';
}

export const writeFairValueLog: FairValueLogger = (entry) => {
  const serialized = JSON.stringify(entry);
  if (entry.status === 'available') console.info(serialized);
  else console.warn(serialized);
};
