import type { NextRequest } from 'next/server';

interface Bucket { count: number; resetsAt: number }
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkMarketDataRateLimit(
  request: Pick<NextRequest, 'headers'>,
  operation: string,
  options: { limit?: number; windowMs?: number; now?: number } = {},
): RateLimitResult {
  const limit = options.limit ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now();
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientKey = forwarded || request.headers.get('x-real-ip') || 'anonymous';
  const key = `${operation}:${clientKey.slice(0, 80)}`;
  const current = buckets.get(key);
  if (!current || current.resetsAt <= now) {
    buckets.set(key, { count: 1, resetsAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1_000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearMarketDataRateLimits(): void {
  buckets.clear();
}
