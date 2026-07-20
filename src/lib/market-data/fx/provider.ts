import { alphaVantageFxSchema, frankfurterFxSchema, fxQuoteSchema, type FxQuote, type SupportedCurrency } from './types';

const ENDPOINT = 'https://www.alphavantage.co/query';
const FRANKFURTER_ENDPOINT = 'https://api.frankfurter.dev/v2/rate';
const TIMEOUT_MS = 4_000;
const RETRIES = 1;

export type FxProviderErrorCode =
  | 'missing-key'
  | 'invalid-key'
  | 'rate-limit'
  | 'timeout'
  | 'upstream-error'
  | 'invalid-response';

export class FxProviderError extends Error {
  constructor(
    readonly code: FxProviderErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'FxProviderError';
  }
}

export interface FxProvider {
  readonly id: string;
  getRate(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote>;
}

function providerMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  for (const key of ['Note', 'Information', 'Error Message', 'message']) {
    if (typeof record[key] === 'string') return record[key];
  }

  return null;
}

function classifyResponse(
  status: number,
  payload: unknown,
  supportsApiKey: boolean,
): FxProviderError {
  const message = providerMessage(payload) ?? '';

  if (
    status === 429 ||
    /frequency|rate limit|call volume|requests per|calls per|daily.*limit|limit.*requests/i.test(message)
  ) {
    return new FxProviderError(
      'rate-limit',
      'FX provider rate limit exceeded',
      429,
    );
  }

  if (
    supportsApiKey &&
    (
      status === 401 ||
      status === 403 ||
      /invalid api key|invalid apikey|api key is invalid|apikey is invalid|demo.*api key|premium endpoint/i.test(message)
    )
  ) {
    return new FxProviderError(
      'invalid-key',
      'FX provider rejected the API key',
      status === 401 || status === 403 ? status : 502,
    );
  }

  if (status >= 500) {
    return new FxProviderError(
      'upstream-error',
      'FX provider is unavailable',
      502,
      true,
    );
  }

  if (status >= 400) {
    return new FxProviderError(
      'upstream-error',
      'FX provider request failed',
      502,
    );
  }

  if (message) {
    return new FxProviderError(
      'invalid-response',
      'FX provider returned an error payload',
      502,
    );
  }

  return new FxProviderError(
    'invalid-response',
    'FX provider returned an invalid response',
    502,
  );
}

export function normalizeFxProviderError(error: unknown): FxProviderError {
  if (error instanceof FxProviderError) return error;

  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new FxProviderError(
      'timeout',
      'FX provider timed out',
      504,
      true,
    );
  }

  return new FxProviderError(
    'upstream-error',
    'FX provider request failed',
    502,
    true,
  );
}

async function fetchJsonWithRetry(
  url: URL,
  fetchImpl: typeof fetch,
  supportsApiKey: boolean,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw classifyResponse(
          response.status,
          payload,
          supportsApiKey,
        );
      }

      if (payload === null) {
        throw new FxProviderError(
          'invalid-response',
          'FX provider returned invalid JSON',
          502,
        );
      }

      return payload;
    } catch (error) {
      const classified = normalizeFxProviderError(error);
      lastError = classified;

      if (!classified.retryable || attempt === RETRIES) {
        throw classified;
      }
    }
  }

  throw normalizeFxProviderError(lastError);
}

export class AlphaVantageFxProvider implements FxProvider {
  readonly id = 'alpha-vantage';
  constructor(private readonly apiKey: string | undefined, private readonly fetchImpl: typeof fetch = fetch) {}

  async getRate(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote> {
    if (base === quote) throw new Error('FX pair must contain different currencies');
    if (!this.apiKey?.trim()) {
      throw new FxProviderError(
        'missing-key',
        'Alpha Vantage FX API key is not configured',
        503,
      );
    }

    const url = new URL(ENDPOINT);
    url.searchParams.set('function', 'CURRENCY_EXCHANGE_RATE');
    url.searchParams.set('from_currency', base);
    url.searchParams.set('to_currency', quote);
    url.searchParams.set('apikey', this.apiKey);
    const rawPayload = await fetchJsonWithRetry(
      url,
      this.fetchImpl,
      true,
    );
    const providerError = classifyResponse(200, rawPayload, true);
    const parsed = alphaVantageFxSchema.safeParse(rawPayload);

    if (!parsed.success) {
      throw providerError;
    }

    const payload = parsed.data;
    const item = payload['Realtime Currency Exchange Rate'];
    if (item['1. From_Currency Code'] !== base || item['3. To_Currency Code'] !== quote) {
      throw new FxProviderError(
        'invalid-response',
        'FX provider returned a mismatched currency pair',
        502,
      );
    }

    const refreshed = item['6. Last Refreshed'];
    const asOf = /z$/i.test(refreshed) ? refreshed : `${refreshed.replace(' ', 'T')}Z`;
    const parsedAsOf = new Date(asOf);

    if (Number.isNaN(parsedAsOf.valueOf())) {
      throw new FxProviderError(
        'invalid-response',
        'FX provider returned an invalid timestamp',
        502,
      );
    }

    const quoteResult = fxQuoteSchema.safeParse({ base, quote, rate: item['5. Exchange Rate'], asOf: parsedAsOf.toISOString(), fetchedAt: new Date().toISOString(), source: this.id, cached: false, stale: false });

    if (!quoteResult.success) {
      throw new FxProviderError(
        'invalid-response',
        'FX provider returned an invalid exchange rate',
        502,
      );
    }

    return quoteResult.data;
  }
}

export class FrankfurterFxProvider implements FxProvider {
  readonly id = 'frankfurter';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getRate(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote> {
    if (base === quote) throw new Error('FX pair must contain different currencies');
    const rawPayload = await fetchJsonWithRetry(
      new URL(`${FRANKFURTER_ENDPOINT}/${base}/${quote}`),
      this.fetchImpl,
      false,
    );
    const parsed = frankfurterFxSchema.safeParse(rawPayload);

    if (!parsed.success) {
      throw new FxProviderError(
        'invalid-response',
        'FX provider returned an invalid response',
        502,
      );
    }

    const payload = parsed.data;
    if (payload.base !== base || payload.quote !== quote) {
      throw new FxProviderError(
        'invalid-response',
        'FX provider returned a mismatched currency pair',
        502,
      );
    }

    return fxQuoteSchema.parse({
      base,
      quote,
      rate: payload.rate.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
      asOf: `${payload.date}T00:00:00.000Z`,
      fetchedAt: new Date().toISOString(),
      source: this.id,
      cached: false,
      stale: false,
    });
  }
}
