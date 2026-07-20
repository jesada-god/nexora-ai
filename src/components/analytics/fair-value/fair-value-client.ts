'use client';

import type { FairValueResult } from '@/src/lib/analytics/valuation/types';
import { fairValueResultSchema } from '@/src/lib/analytics/valuation/schemas';

type FairValueFetcher = (url: string, init: { headers: { Accept: string }; signal: AbortSignal }) => Promise<Response>;
type InflightEntry = { controller: AbortController; promise: Promise<FairValueResult>; consumers: Set<symbol> };

function normalizedSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function validatePayload(value: unknown): FairValueResult {
  const parsed = fairValueResultSchema.safeParse(value);
  if (!parsed.success) throw new Error('Fair Value API returned an invalid response');
  return parsed.data as FairValueResult;
}

/** Follows the stock-history client pattern: shared in-flight work with consumer-aware abort. */
export class FairValueRequestClient {
  private readonly inflight = new Map<string, InflightEntry>();

  constructor(private readonly fetcher: FairValueFetcher) {}

  request(rawSymbol: string, signal: AbortSignal): Promise<FairValueResult> {
    const symbol = normalizedSymbol(rawSymbol);
    let entry = this.inflight.get(symbol);
    if (!entry) {
      const controller = new AbortController();
      const promise = this.fetcher(`/api/analytics/fair-value/${encodeURIComponent(symbol)}`, { headers: { Accept: 'application/json' }, signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as { data?: unknown };
          if (payload.data) return validatePayload(payload.data);
          if (!response.ok) {
            if (response.status === 429) throw new Error('ผู้ให้บริการจำกัดคำขอชั่วคราว กรุณาลองใหม่ภายหลัง');
            throw new Error('ไม่สามารถโหลด Fair Value ได้');
          }
          return validatePayload(payload.data);
        })
        .finally(() => this.inflight.delete(symbol));
      entry = { controller, promise, consumers: new Set() };
      this.inflight.set(symbol, entry);
    }

    const activeEntry = entry;
    const consumer = Symbol(symbol);
    activeEntry.consumers.add(consumer);
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        activeEntry.consumers.delete(consumer);
        queueMicrotask(() => {
          if (activeEntry.consumers.size === 0 && this.inflight.get(symbol) === activeEntry) activeEntry.controller.abort();
        });
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        release();
        reject(new DOMException('Request aborted', 'AbortError'));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      void activeEntry.promise.then(
        (data) => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); release(); resolve(data); } },
        (error) => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); release(); reject(error); } },
      );
    });
  }

  clear(): void {
    for (const entry of this.inflight.values()) entry.controller.abort();
    this.inflight.clear();
  }
}

const fairValueRequestClient = new FairValueRequestClient((url, init) => fetch(url, init));

export function requestFairValue(symbol: string, signal: AbortSignal): Promise<FairValueResult> {
  return fairValueRequestClient.request(symbol, signal);
}

export function clearFairValueClientCacheForTests() {
  fairValueRequestClient.clear();
}
