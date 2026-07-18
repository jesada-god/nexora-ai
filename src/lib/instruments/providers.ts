import { parseListingStatusCsv } from './csv.ts';
import { mergeNasdaqTraderDirectories, parseNasdaqTraderDirectory } from './nasdaq-trader.ts';
import type { MarketInstrumentInput } from './types.ts';

export const PRIMARY_INSTRUMENT_PROVIDER = 'alpha-vantage';
export const FALLBACK_INSTRUMENT_PROVIDER = 'nasdaq-trader';

const ALPHA_VANTAGE_URL = 'https://www.alphavantage.co/query';
const NASDAQ_TRADER_URLS = {
  nasdaqlisted: 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
  otherlisted: 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt',
} as const;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

export interface ProviderFailure {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
}

export interface InstrumentSnapshot {
  primaryProvider: typeof PRIMARY_INSTRUMENT_PROVIDER;
  providerUsed: typeof PRIMARY_INSTRUMENT_PROVIDER | typeof FALLBACK_INSTRUMENT_PROVIDER | null;
  fallbackReason: string | null;
  instruments: MarketInstrumentInput[];
  failed: number;
  incomplete: boolean;
  failures: ProviderFailure[];
}

export interface LoadInstrumentSnapshotOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
}

export function providerFailure(code: string, message: string, retryable: boolean, status?: number): Error & ProviderFailure {
  return Object.assign(new Error(message), { code, retryable, ...(status === undefined ? {} : { status }) });
}

export function toProviderFailure(error: unknown): ProviderFailure {
  const value = error as Partial<ProviderFailure> | null;
  return {
    code: typeof value?.code === 'string' ? value.code : 'provider-error',
    message: error instanceof Error ? error.message : typeof value?.message === 'string' ? value.message : 'Unknown provider failure',
    retryable: Boolean(value?.retryable),
    ...(typeof value?.status === 'number' ? { status: value.status } : {}),
  };
}

function alphaUrl(apiKey: string, state: 'active' | 'delisted'): URL {
  const url = new URL(ALPHA_VANTAGE_URL);
  url.searchParams.set('function', 'LISTING_STATUS');
  url.searchParams.set('state', state);
  url.searchParams.set('apikey', apiKey);
  return url;
}

function isAllowedContentType(contentType: string, provider: 'alpha' | 'nasdaq'): boolean {
  const normalized = contentType.split(';', 1)[0].trim().toLowerCase();
  const common = ['text/plain', 'text/csv', 'application/octet-stream', 'application/x-download'];
  return common.includes(normalized) || (provider === 'alpha' && normalized === 'application/csv');
}

async function fetchText(
  url: URL | string,
  label: string,
  provider: 'alpha' | 'nasdaq',
  options: Required<Pick<LoadInstrumentSnapshotOptions, 'fetchImpl' | 'timeoutMs' | 'maxAttempts'>>,
): Promise<string> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const response = await options.fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs), cache: 'no-store' });
      if (!response.ok) {
        throw providerFailure('provider-http-error', `${label} returned HTTP ${response.status}`, response.status === 429 || response.status >= 500, response.status);
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw providerFailure('provider-response-too-large', `${label} exceeded the response size limit`, false);
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!isAllowedContentType(contentType, provider)) {
        throw providerFailure('invalid-provider-response', `${label} returned an unsupported content type`, true);
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        throw providerFailure('provider-response-too-large', `${label} exceeded the response size limit`, false);
      }
      const prefix = body.trimStart().slice(0, 32).toLowerCase();
      if (!body.trim() || prefix.startsWith('{') || prefix.startsWith('[') || prefix.startsWith('<!doctype') || prefix.startsWith('<html')) {
        throw providerFailure('invalid-provider-response', `${label} did not return the expected directory data`, true);
      }
      return body;
    } catch (error) {
      const structured = toProviderFailure(error);
      const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      const retryable = structured.retryable || isTimeout;
      const normalized = isTimeout
        ? providerFailure('provider-timeout', `${label} timed out`, true)
        : providerFailure(structured.code, structured.message, retryable, structured.status);
      if (!retryable || attempt === options.maxAttempts) throw normalized;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    }
  }
  throw providerFailure('provider-unavailable', `${label} exhausted retries`, true);
}

function mergeAlphaRows(rows: MarketInstrumentInput[]): MarketInstrumentInput[] {
  const merged = new Map<string, MarketInstrumentInput>();
  for (const row of rows) {
    const previous = merged.get(row.provider_symbol);
    if (!previous || previous.status === 'delisted' || row.status === 'active') merged.set(row.provider_symbol, row);
  }
  return [...merged.values()];
}

async function loadAlphaVantage(
  apiKey: string,
  options: Required<Pick<LoadInstrumentSnapshotOptions, 'fetchImpl' | 'timeoutMs' | 'maxAttempts'>>,
): Promise<{ instruments: MarketInstrumentInput[]; failed: number }> {
  try {
    const [activeText, delistedText] = await Promise.all([
      fetchText(alphaUrl(apiKey, 'active'), 'LISTING_STATUS active', 'alpha', options),
      fetchText(alphaUrl(apiKey, 'delisted'), 'LISTING_STATUS delisted', 'alpha', options),
    ]);
    const active = parseListingStatusCsv(activeText, 'active');
    const delisted = parseListingStatusCsv(delistedText, 'delisted');
    return { instruments: mergeAlphaRows([...delisted.instruments, ...active.instruments]), failed: active.failed + delisted.failed };
  } catch (error) {
    if (typeof (error as Partial<ProviderFailure> | null)?.code === 'string') throw error;
    throw providerFailure('invalid-provider-response', 'LISTING_STATUS did not contain the required CSV header', true);
  }
}

async function loadNasdaqTrader(
  options: Required<Pick<LoadInstrumentSnapshotOptions, 'fetchImpl' | 'timeoutMs' | 'maxAttempts'>>,
): Promise<{ instruments: MarketInstrumentInput[]; failed: number }> {
  try {
    const [nasdaqText, otherText] = await Promise.all([
      fetchText(NASDAQ_TRADER_URLS.nasdaqlisted, 'nasdaqlisted.txt', 'nasdaq', options),
      fetchText(NASDAQ_TRADER_URLS.otherlisted, 'otherlisted.txt', 'nasdaq', options),
    ]);
    const result = mergeNasdaqTraderDirectories(
      parseNasdaqTraderDirectory(nasdaqText, 'nasdaqlisted'),
      parseNasdaqTraderDirectory(otherText, 'otherlisted'),
    );
    if (result.instruments.length === 0) throw providerFailure('invalid-provider-response', 'Nasdaq Trader directories contained no usable instruments', true);
    return result;
  } catch (error) {
    if (typeof (error as Partial<ProviderFailure> | null)?.code === 'string') throw error;
    throw providerFailure('invalid-provider-response', 'Nasdaq Trader directory did not contain the required pipe-delimited header', true);
  }
}

export async function loadInstrumentSnapshot(options: LoadInstrumentSnapshotOptions): Promise<InstrumentSnapshot> {
  const requestOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  };
  let primaryFailure: ProviderFailure;
  try {
    const result = await loadAlphaVantage(options.apiKey, requestOptions);
    return { primaryProvider: PRIMARY_INSTRUMENT_PROVIDER, providerUsed: PRIMARY_INSTRUMENT_PROVIDER, fallbackReason: null, ...result, incomplete: false, failures: [] };
  } catch (error) {
    primaryFailure = toProviderFailure(error);
  }

  try {
    const result = await loadNasdaqTrader(requestOptions);
    return {
      primaryProvider: PRIMARY_INSTRUMENT_PROVIDER,
      providerUsed: FALLBACK_INSTRUMENT_PROVIDER,
      fallbackReason: primaryFailure.code,
      ...result,
      incomplete: false,
      failures: [primaryFailure],
    };
  } catch (error) {
    return {
      primaryProvider: PRIMARY_INSTRUMENT_PROVIDER,
      providerUsed: null,
      fallbackReason: primaryFailure.code,
      instruments: [],
      failed: 0,
      incomplete: true,
      failures: [primaryFailure, toProviderFailure(error)],
    };
  }
}
