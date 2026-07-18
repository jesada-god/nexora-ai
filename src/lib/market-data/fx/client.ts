import { fixed, fixedToNumber, fixedToString } from '../../money/fixed';
import { fxApiEnvelopeSchema, type FxQuote } from './types';

export interface ParsedFxResponse {
  quote: FxQuote | null;
  unavailable: boolean;
  warning: string | null;
}

/** Parses the API envelope first, then normalizes its string rate as fixed-point. */
export function parseFxApiResponse(input: unknown): ParsedFxResponse {
  const envelope = fxApiEnvelopeSchema.parse(input);
  if (envelope.data === null) return { quote: null, unavailable: true, warning: null };
  const { warning, ...quote } = envelope.data;
  const normalizedRate = fixedToString(fixed(quote.rate));
  return {
    quote: { ...quote, rate: normalizedRate },
    unavailable: warning !== null,
    warning,
  };
}

export function formatFxRate(rate: string): string {
  return fixedToNumber(fixed(rate)).toFixed(4);
}

export async function fetchFxRate(fetchImpl: typeof fetch = fetch, retries = 1): Promise<ParsedFxResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl('/api/market/fx?base=USD&quote=THB', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const parsed = parseFxApiResponse(await response.json());
      if (!response.ok || parsed.quote === null) throw new Error('FX rate unavailable');
      return parsed;
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('FX rate unavailable');
}
