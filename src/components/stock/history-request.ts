import type { HistoricalPrices, HistoricalRange, MarketDataEnvelope } from '@/src/lib/market-data/types';

export type HistoryResponse = MarketDataEnvelope<HistoricalPrices>;
type HistoryFetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ json(): Promise<HistoryResponse> }>;
type CachedHistory = { response: HistoryResponse; savedAt: number };
type InflightEntry = { controller: AbortController; promise: Promise<HistoryResponse>; consumers: Set<symbol> };

const CLIENT_CACHE_MS = 15 * 60_000;
export function historyRequestKey(symbol: string, range: HistoricalRange) { return `history:${symbol}:${range}`; }
export function canRetryHistory(cooldownUntil: number, now: number, loading: boolean) { return !loading && now >= cooldownUntil; }

export class HistoryRequestClient {
  private readonly data = new Map<string, CachedHistory>();
  private readonly inflight = new Map<string, InflightEntry>();
  constructor(private readonly fetcher: HistoryFetcher, private readonly now: () => number = Date.now) {}

  request(symbol: string, range: HistoricalRange, options: { force?: boolean; signal: AbortSignal }): Promise<HistoryResponse> {
    const key = historyRequestKey(symbol, range); const saved = this.data.get(key);
    if (!options.force && saved && this.now() - saved.savedAt < CLIENT_CACHE_MS) return Promise.resolve(saved.response);
    let entry = this.inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = this.fetcher(`/api/market/history/${encodeURIComponent(symbol)}?range=${range}`, { signal: controller.signal }).then(async (response) => {
        const body = await response.json();
        if (body.data) this.data.set(key, { response: body, savedAt: this.now() });
        else if (saved?.response.data) return { ...saved.response, meta: { ...saved.response.meta, freshness: { ...saved.response.meta.freshness, status: 'cached' as const } } };
        return body;
      }).finally(() => this.inflight.delete(key));
      entry = { controller, promise, consumers: new Set() }; this.inflight.set(key, entry);
    }
    const consumer = Symbol(key); entry.consumers.add(consumer); const activeEntry = entry;
    const release = () => {
      activeEntry.consumers.delete(consumer);
      queueMicrotask(() => { if (activeEntry.consumers.size === 0 && this.inflight.get(key) === activeEntry) activeEntry.controller.abort(); });
    };
    if (options.signal.aborted) release(); else options.signal.addEventListener('abort', release, { once: true });
    return activeEntry.promise.finally(() => { options.signal.removeEventListener('abort', release); activeEntry.consumers.delete(consumer); });
  }
}

export interface HistoryRun { key: string; generation: number; promise: Promise<HistoryResponse> }
export class HistoryRequestSession {
  private generation = 0;
  private current: (HistoryRun & { controller: AbortController }) | null = null;
  constructor(private readonly client: HistoryRequestClient) {}
  begin(symbol: string, range: HistoricalRange, force = false): HistoryRun {
    const key = historyRequestKey(symbol, range);
    if (this.current?.key === key) return this.current;
    this.current?.controller.abort(); const controller = new AbortController(); const generation = ++this.generation;
    const promise = this.client.request(symbol, range, { force, signal: controller.signal });
    const run = { key, generation, controller, promise }; this.current = run;
    void promise.finally(() => { if (this.current === run) this.current = null; }).catch(() => undefined);
    return run;
  }
  isCurrent(run: HistoryRun) { return run.generation === this.generation; }
  cancel() { this.generation += 1; this.current?.controller.abort(); this.current = null; }
}

export const historyRequestClient = new HistoryRequestClient((url, init) => fetch(url, init));
