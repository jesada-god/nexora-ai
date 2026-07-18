import { alphaVantageFxSchema, frankfurterFxSchema, fxQuoteSchema, type FxQuote, type SupportedCurrency } from './types';

const ENDPOINT = 'https://www.alphavantage.co/query';
const FRANKFURTER_ENDPOINT = 'https://api.frankfurter.dev/v2/rate';
const TIMEOUT_MS = 4_000;
const RETRIES = 1;

export interface FxProvider {
  readonly id: string;
  getRate(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote>;
}

async function fetchWithRetry(url: URL, fetchImpl: typeof fetch): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
      if (!response.ok) throw new Error(`FX provider returned ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('FX provider request failed');
}

export class AlphaVantageFxProvider implements FxProvider {
  readonly id = 'alpha-vantage';
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async getRate(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote> {
    if (base === quote) throw new Error('FX pair must contain different currencies');
    const url = new URL(ENDPOINT);
    url.searchParams.set('function', 'CURRENCY_EXCHANGE_RATE');
    url.searchParams.set('from_currency', base);
    url.searchParams.set('to_currency', quote);
    url.searchParams.set('apikey', this.apiKey);
    const response = await fetchWithRetry(url, this.fetchImpl);
    const payload = alphaVantageFxSchema.parse(await response.json());
    const item = payload['Realtime Currency Exchange Rate'];
    if (item['1. From_Currency Code'] !== base || item['3. To_Currency Code'] !== quote) throw new Error('FX pair mismatch');
    const refreshed = item['6. Last Refreshed'];
    const asOf = /z$/i.test(refreshed) ? refreshed : `${refreshed.replace(' ', 'T')}Z`;
    return fxQuoteSchema.parse({ base, quote, rate: item['5. Exchange Rate'], asOf: new Date(asOf).toISOString(), fetchedAt: new Date().toISOString(), source: this.id, cached: false, stale: false });
  }
}

export class FrankfurterFxProvider implements FxProvider {
  readonly id = 'frankfurter';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getRate(base: SupportedCurrency, quote: SupportedCurrency): Promise<FxQuote> {
    if (base === quote) throw new Error('FX pair must contain different currencies');
    const response = await fetchWithRetry(new URL(`${FRANKFURTER_ENDPOINT}/${base}/${quote}`), this.fetchImpl);
    const payload = frankfurterFxSchema.parse(await response.json());
    if (payload.base !== base || payload.quote !== quote) throw new Error('FX pair mismatch');
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
