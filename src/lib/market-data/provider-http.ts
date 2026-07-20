import { MarketDataError, mapProviderFailure } from './errors';

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface ProviderRequestLog {
  event: 'provider_request';
  requestId: string;
  route: string;
  symbol: string | null;
  provider: string;
  operation: string;
  durationMs: number;
  cacheStatus: 'provider';
  resultStatus: 'success' | 'error';
  errorCode: string | null;
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

export class ProviderCircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  constructor(
    private readonly failureThreshold = 3,
    private readonly openMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  assertAvailable(key: string): void {
    const state = this.states.get(key);
    if (!state || state.openUntil <= this.now()) return;
    throw new MarketDataError(
      'provider-unavailable',
      'Market data provider circuit is temporarily open',
      Math.max(1, Math.ceil((state.openUntil - this.now()) / 1_000)),
    );
  }

  success(key: string): void {
    this.states.delete(key);
  }

  failure(key: string): void {
    const previous = this.states.get(key);
    const failures = (previous?.openUntil && previous.openUntil > this.now())
      ? previous.failures
      : (previous?.failures ?? 0) + 1;
    this.states.set(key, {
      failures,
      openUntil: failures >= this.failureThreshold ? this.now() + this.openMs : 0,
    });
  }
}

export interface ProviderJsonRequest {
  provider: string;
  operation: string;
  route: string;
  symbol?: string;
  url: URL;
  init?: RequestInit;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface ProviderHttpDependencies {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  logger?: (entry: ProviderRequestLog) => void;
  breaker?: ProviderCircuitBreaker;
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  return Number.isFinite(date)
    ? Math.max(1, Math.ceil((date - Date.now()) / 1_000))
    : undefined;
}

function providerMessage(payload: unknown): string | null {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of ['Note', 'Information', 'Error Message', 'message', 'error']) {
    if (typeof record[key] === 'string') return record[key];
  }
  return null;
}

function requestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `req-${Date.now().toString(36)}`;
}

export class ProviderHttpClient {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly logger: (entry: ProviderRequestLog) => void;
  private readonly breaker: ProviderCircuitBreaker;

  constructor(dependencies: ProviderHttpDependencies = {}) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = dependencies.now ?? Date.now;
    this.random = dependencies.random ?? Math.random;
    this.logger = dependencies.logger ?? ((entry) => console.info(JSON.stringify(entry)));
    this.breaker = dependencies.breaker ?? new ProviderCircuitBreaker();
  }

  async json(input: ProviderJsonRequest): Promise<unknown> {
    const id = requestId();
    const startedAt = this.now();
    const circuitKey = `${input.provider}:${input.operation}`;
    const maxAttempts = Math.max(1, Math.min(3, input.maxAttempts ?? 3));
    this.breaker.assertAvailable(circuitKey);

    let finalError: MarketDataError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(input.timeoutMs ?? 8_000);
        const signal = input.init?.signal
          ? AbortSignal.any([input.init.signal, timeout])
          : timeout;
        response = await this.fetcher(input.url, {
          ...input.init,
          signal,
          headers: { Accept: 'application/json', ...input.init?.headers },
        });
      } catch (cause) {
        finalError = mapProviderFailure({ cause });
        if (attempt < maxAttempts && finalError.retryable) {
          await this.sleep(150 * (2 ** (attempt - 1)) + Math.floor(this.random() * 100));
          continue;
        }
        break;
      }

      const retryAfter = retryAfterSeconds(response);
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('json')) {
        finalError = mapProviderFailure({
          status: response.status,
          cause: new Error('Provider returned a non-JSON response'),
          retryAfterSeconds: retryAfter,
        });
      } else {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (cause) {
          finalError = mapProviderFailure({ status: response.status, cause, retryAfterSeconds: retryAfter });
          payload = null;
        }
        if (payload !== null) {
          const message = providerMessage(payload);
          const providerFailure = !response.ok
            || (message !== null && (
              !Array.isArray((payload as Record<string, unknown>)?.data)
              || /artificial|premium endpoint|rate limit|call frequency|invalid api/i.test(message)
            ));
          if (!providerFailure) {
            this.breaker.success(circuitKey);
            this.logger({
              event: 'provider_request', requestId: id, route: input.route,
              symbol: input.symbol ?? null, provider: input.provider,
              operation: input.operation, durationMs: this.now() - startedAt,
              cacheStatus: 'provider', resultStatus: 'success', errorCode: null,
            });
            return payload;
          }
          finalError = mapProviderFailure({
            status: response.status,
            payload,
            retryAfterSeconds: retryAfter,
          });
        }
      }

      if (!TRANSIENT_STATUSES.has(response.status) || attempt >= maxAttempts) break;
      if (retryAfter && retryAfter > 5) break;
      const delay = retryAfter
        ? retryAfter * 1_000
        : 150 * (2 ** (attempt - 1)) + Math.floor(this.random() * 100);
      await this.sleep(delay);
    }

    const error = finalError ?? new MarketDataError('provider-unavailable', 'Market data provider is unavailable');
    if (error.retryable) this.breaker.failure(circuitKey);
    this.logger({
      event: 'provider_request', requestId: id, route: input.route,
      symbol: input.symbol ?? null, provider: input.provider,
      operation: input.operation, durationMs: this.now() - startedAt,
      cacheStatus: 'provider', resultStatus: 'error', errorCode: error.code,
    });
    throw error;
  }
}
