import 'server-only';
import type { ProviderResult, Quote } from './types';

export interface ResolvedQuote { price: number; previousClose: number | null; cached: boolean; asOf: string | null }
const lastKnown = new Map<string, ResolvedQuote>();

export async function resolveQuote(symbol: string, operation: () => Promise<ProviderResult<Quote>>): Promise<ResolvedQuote | null> {
  try {
    const result = await operation();
    const quote = { price: result.data.price, previousClose: result.data.previousClose, cached: result.freshness.status === 'cached', asOf: result.freshness.asOf };
    lastKnown.set(symbol, quote);
    return quote;
  } catch {
    const cached = lastKnown.get(symbol);
    return cached ? { ...cached, cached: true } : null;
  }
}

export function resetQuoteCacheForTests() { lastKnown.clear(); }
