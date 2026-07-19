import type { CompanyProfile, MarketDataApiError } from '@/src/lib/market-data/types';
import { profileEnvelopeSchema } from '@/src/lib/stock-detail/api-schemas';
import type { StockDetailResource } from '@/src/lib/stock-detail/types';

type ProfileFetcher = (
  url: string,
  init: { headers: { Accept: 'application/json' } },
) => Promise<Response>;

interface InflightProfileRequest {
  fetcher: ProfileFetcher;
  promise: Promise<StockDetailResource<CompanyProfile>>;
}

const inflight = new Map<string, InflightProfileRequest>();

const unavailableFreshness = {
  status: 'unavailable' as const,
  asOf: null,
  maxAgeSeconds: null,
};

function internalError(message: string): MarketDataApiError {
  return {
    code: 'internal-error',
    message,
    retryable: true,
  };
}

async function loadCompanyProfile(
  symbol: string,
  fetcher: ProfileFetcher,
): Promise<StockDetailResource<CompanyProfile>> {
  const response = await fetcher(`/api/market/profile/${encodeURIComponent(symbol)}`, {
    headers: { Accept: 'application/json' },
  });
  const parsed = profileEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) {
    const error = internalError('Profile API returned an invalid response');
    return {
      data: null,
      freshness: unavailableFreshness,
      provider: null,
      reason: `${error.code}: ${error.message}`,
      error,
      fallbackUsed: false,
      retryAfterSeconds: 0,
      reasonCode: 'INVALID_ENVELOPE',
    };
  }

  const envelope = parsed.data;
  if (!response.ok || !envelope.data) {
    const error = envelope.error ?? internalError('Company profile is unavailable');
    return {
      data: null,
      freshness: envelope.meta.freshness,
      provider: envelope.meta.provider,
      reason: `${error.code}: ${error.message}`,
      error,
      fallbackUsed: envelope.fallbackUsed,
      retryAfterSeconds: envelope.retryAfterSeconds,
      reasonCode: envelope.reasonCode,
    };
  }

  return {
    data: envelope.data,
    freshness: envelope.meta.freshness,
    provider: envelope.providerUsed ?? envelope.meta.provider,
    reason: null,
    error: null,
    fallbackUsed: envelope.fallbackUsed,
    retryAfterSeconds: envelope.retryAfterSeconds,
    reasonCode: envelope.reasonCode,
  };
}

export function requestCompanyProfile(
  symbol: string,
  fetcher: ProfileFetcher = fetch,
): Promise<StockDetailResource<CompanyProfile>> {
  const current = inflight.get(symbol);
  if (current && current.fetcher === fetcher) return current.promise;

  const request = loadCompanyProfile(symbol, fetcher).finally(() => {
    const active = inflight.get(symbol);
    if (active?.promise === request) inflight.delete(symbol);
  });
  inflight.set(symbol, { fetcher, promise: request });
  return request;
}
