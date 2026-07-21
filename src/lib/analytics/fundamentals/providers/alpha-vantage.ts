import { MarketDataError, mapProviderFailure } from '../../../market-data/errors';
import { normalizeFinancialStatements, type DatasetName, type RawStatementPayload } from '../normalize';
import type { FundamentalsProvider, FundamentalsSnapshot } from '../provider';

const BASE_URL = 'https://www.alphavantage.co/query';
const TTL_MS = 24 * 60 * 60 * 1_000;
const STALE_MS = 7 * TTL_MS;
const TIMEOUT_MS = 10_000;
const FUNCTIONS: Record<DatasetName, string> = { 'income-statement': 'INCOME_STATEMENT', 'balance-sheet': 'BALANCE_SHEET', 'cash-flow': 'CASH_FLOW' };
type Fetcher = typeof fetch;
interface Cached { payload: RawStatementPayload; fetchedAt: number }

export class AlphaVantageFundamentalsProvider implements FundamentalsProvider {
  readonly id = 'alpha-vantage';
  private readonly cache = new Map<string, Cached>();
  private readonly inflight = new Map<string, Promise<{ payload: RawStatementPayload; cache: 'hit' | 'miss' | 'stale'; fetchedAt: number }>>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly apiKey: string, private readonly fetcher: Fetcher = fetch, private readonly now: () => number = Date.now, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  private async slot() { if (this.active >= 2) await new Promise<void>((resolve) => this.waiters.push(resolve)); this.active += 1; }
  private release() { this.active -= 1; this.waiters.shift()?.(); }

  private async network(symbol: string, dataset: DatasetName, signal?: AbortSignal): Promise<RawStatementPayload> {
    await this.slot();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const url = new URL(BASE_URL); url.searchParams.set('function', FUNCTIONS[dataset]); url.searchParams.set('symbol', symbol); url.searchParams.set('apikey', this.apiKey);
        const timeout = AbortSignal.timeout(TIMEOUT_MS); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let response: Response;
        try { response = await this.fetcher(url, { headers: { Accept: 'application/json' }, signal: combined, cache: 'no-store' }); }
        catch (cause) { const error = mapProviderFailure({ cause }); if (attempt < 2 && error.retryable) { await this.sleep(250 * (2 ** attempt)); continue; } throw error; }
        let payload: unknown; try { payload = await response.json(); } catch (cause) { throw mapProviderFailure({ status: response.status, cause }); }
        const message = payload && typeof payload === 'object' ? Object.values(payload as object).find((value) => typeof value === 'string') : undefined;
        const retryAfter = this.retryAfter(response);
        if (!response.ok || (typeof message === 'string' && /rate limit|call frequency|premium endpoint|invalid api/i.test(message))) {
          const error = mapProviderFailure({ status: response.status, payload, retryAfterSeconds: retryAfter });
          if (attempt < 2 && error.retryable) { await this.sleep((retryAfter ?? (attempt + 1)) * 1_000); continue; }
          throw error;
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new MarketDataError('invalid-provider-response', 'Fundamentals provider returned an invalid statement payload');
        return payload as RawStatementPayload;
      }
      throw new MarketDataError('upstream-unavailable', 'Fundamentals provider retry budget exhausted');
    } finally { this.release(); }
  }

  private retryAfter(response: Response): number | undefined { const raw = response.headers.get('retry-after'); if (!raw) return undefined; const seconds = Number(raw); if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds); const date = Date.parse(raw); return Number.isFinite(date) ? Math.max(0, Math.ceil((date - this.now()) / 1_000)) : undefined; }

  private load(symbol: string, dataset: DatasetName, signal?: AbortSignal) {
    const key = `${this.id}:${symbol}:${dataset}:annual-quarterly`; const existing = this.inflight.get(key); if (existing) return existing;
    const operation = (async () => {
      const cached = this.cache.get(key); const age = cached ? this.now() - cached.fetchedAt : Infinity;
      if (cached && age <= TTL_MS) return { payload: cached.payload, cache: 'hit' as const, fetchedAt: cached.fetchedAt };
      try { const payload = await this.network(symbol, dataset, signal); const fetchedAt = this.now(); this.cache.set(key, { payload, fetchedAt }); return { payload, cache: 'miss' as const, fetchedAt }; }
      catch (error) { if (cached && age <= STALE_MS) return { payload: cached.payload, cache: 'stale' as const, fetchedAt: cached.fetchedAt }; throw error; }
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, operation); return operation;
  }

  async getFinancialPeriods(rawSymbol: string, signal?: AbortSignal): Promise<FundamentalsSnapshot> {
    const symbol = rawSymbol.trim().toUpperCase(); const started = this.now();
    const settled = await Promise.all((Object.keys(FUNCTIONS) as DatasetName[]).map(async (dataset) => {
      try { return { dataset, result: await this.load(symbol, dataset, signal), error: null as string | null }; }
      catch (cause) { return { dataset, result: null, error: cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'upstream-unavailable' }; }
    }));
    const available = new Map<DatasetName, Awaited<ReturnType<AlphaVantageFundamentalsProvider['load']>>>();
    const datasetErrors: Record<string, string> = {};
    for (const item of settled) {
      if (item.result) available.set(item.dataset, item.result);
      else if (item.error) datasetErrors[item.dataset] = item.error;
    }
    const missingDatasets = (Object.keys(FUNCTIONS) as DatasetName[]).filter((dataset) => !available.has(dataset));
    const empty: RawStatementPayload = { symbol, annualReports: [], quarterlyReports: [] };
    const fetchedAtMs = available.size ? Math.max(...[...available.values()].map((item) => item.fetchedAt)) : this.now(); const fetchedAt = new Date(fetchedAtMs).toISOString();
    const normalized = normalizeFinancialStatements(symbol, available.get('income-statement')?.payload ?? empty, available.get('balance-sheet')?.payload ?? empty, available.get('cash-flow')?.payload ?? empty, { source: this.id, fetchedAt });
    const diagnostics = { provider: this.id, capabilities: ['company-profile', 'income-statement', 'balance-sheet', 'cash-flow', 'diluted-eps', 'diluted-shares'], datasets: Object.fromEntries((Object.keys(FUNCTIONS) as DatasetName[]).map((dataset) => [dataset, available.has(dataset) ? 'available' : 'unavailable'])) as Record<string, 'available' | 'unavailable'>, cache: Object.fromEntries((Object.keys(FUNCTIONS) as DatasetName[]).map((dataset) => [dataset, available.get(dataset)?.cache ?? 'miss'])) as Record<string, 'hit' | 'miss' | 'stale'>, datasetFetchedAt: Object.fromEntries((Object.keys(FUNCTIONS) as DatasetName[]).map((dataset) => [dataset, available.has(dataset) ? new Date(available.get(dataset)!.fetchedAt).toISOString() : null])), latencyMs: Math.max(0, this.now() - started), normalizedPeriodCount: { annual: normalized.annual.length, quarterly: normalized.quarterly.length } };
    if (process.env.NODE_ENV === 'development') {
      const sanitizedPayloadShape = Object.fromEntries([...available].map(([dataset, item]) => {
        const annual = Array.isArray(item.payload.annualReports) ? item.payload.annualReports : [];
        const quarterly = Array.isArray(item.payload.quarterlyReports) ? item.payload.quarterlyReports : [];
        const fieldNames = [...new Set([...annual, ...quarterly].flatMap((row) => row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : []))].sort();
        return [dataset, { annualCount: annual.length, quarterlyCount: quarterly.length, fieldNames }];
      }));
      console.info({ event: 'fundamentals_provider_snapshot', ...diagnostics, sanitizedPayloadShape });
    }
    return { symbol, periods: normalized.annual, quarterlyPeriods: normalized.quarterly, annualRecords: normalized.annualRecords, quarterlyRecords: normalized.quarterlyRecords, asOf: normalized.annual.at(-1)?.periodEnd ?? normalized.quarterly.at(-1)?.periodEnd ?? normalized.dilutedEpsAsOf ?? fetchedAt, fetchedAt, currency: normalized.currency, dilutedEpsTtm: normalized.dilutedEpsTtm, dilutedEpsAsOf: normalized.dilutedEpsAsOf, missingInputs: [...missingDatasets.map((dataset) => `dataset:${dataset}`), ...normalized.missingInputs], datasetErrors, diagnostics };
  }
}
