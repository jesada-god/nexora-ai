import {
  computeOptionsSupportResistance,
  optionsUnavailable,
  type OptionsSrConfig,
  type OptionsSrResult,
} from '@/src/lib/analytics/options-sr';
import { optionsChainSchema, optionsExpirationsSchema } from '@/src/lib/market-data/options/contracts';
import { classifyOptionsFailure, type OptionsFailureClassification } from './planner';

/**
 * Browser data-source for Options S/R. It reuses the EXISTING Phase 11 options
 * endpoints (`/api/market/options/expirations` and `/api/market/options/chain`)
 * — it never opens a second chain pipeline — and always resolves to a typed
 * {@link OptionsSrResult}, folding HTTP/entitlement failures into a typed
 * unavailable state so a failure isolates cleanly (item 19).
 */

interface Envelope<T> {
  data: T | null;
  error?: { code?: string; message?: string; retryable?: boolean; retryAfterSeconds?: number };
  meta?: { provider?: string | null };
}

export interface ExpirationsOutcome {
  ok: boolean;
  expirations: string[];
  provider: string | null;
  classification: OptionsFailureClassification | null;
  message: string | null;
  /** Seconds the caller should wait before retrying, when the route supplied a Retry-After (429). */
  retryAfterSeconds: number | null;
}

async function readEnvelope<T>(response: Response): Promise<Envelope<T>> {
  try {
    return (await response.json()) as Envelope<T>;
  } catch {
    return { data: null };
  }
}

/** Load the available non-expired expirations for a symbol (reuses the real route). */
export async function fetchOptionsExpirations(symbol: string, signal: AbortSignal): Promise<ExpirationsOutcome> {
  const query = new URLSearchParams({ symbol });
  const response = await fetch(`/api/market/options/expirations?${query.toString()}`, {
    signal, headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  const payload = await readEnvelope<unknown>(response);
  const retryAfterHeader = Number(response.headers.get('retry-after'));
  const retryAfterSeconds = payload.error?.retryAfterSeconds ?? (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : null);
  if (!response.ok || !payload.data) {
    const classification = classifyOptionsFailure(response.status, payload.error?.code);
    return { ok: false, expirations: [], provider: payload.meta?.provider ?? null, classification, message: payload.error?.message ?? 'Options expirations are unavailable.', retryAfterSeconds };
  }
  const parsed = optionsExpirationsSchema.safeParse(payload.data);
  if (!parsed.success) {
    return { ok: false, expirations: [], provider: payload.meta?.provider ?? null, classification: classifyOptionsFailure(null, 'invalid-provider-response'), message: 'Options expirations failed validation.', retryAfterSeconds: null };
  }
  const today = new Date().toISOString().slice(0, 10);
  const expirations = [...new Set(parsed.data.expirations.filter((value) => value >= today))].sort();
  return { ok: true, expirations, provider: parsed.data.provider, classification: null, message: null, retryAfterSeconds: null };
}

export interface FetchOptionsSrOptions {
  /** Injected clock for deterministic freshness/expiration handling in tests. */
  nowMs?: number;
  /** Pure-calc config overrides. */
  config?: Partial<OptionsSrConfig>;
}

/**
 * Load one expiration's chain and compute Options S/R. The single accepted
 * underlying price is passed in so options levels derive their distance from the
 * exact same price the header/chart use — never a second, divergent spot.
 */
export async function fetchOptionsSr(
  symbol: string,
  expiration: string,
  acceptedPrice: number | null,
  signal: AbortSignal,
  options: FetchOptionsSrOptions = {},
): Promise<OptionsSrResult> {
  const query = new URLSearchParams({ symbol, expiration });
  const response = await fetch(`/api/market/options/chain?${query.toString()}`, {
    signal, headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  const payload = await readEnvelope<unknown>(response);
  if (!response.ok || !payload.data) {
    const classification = classifyOptionsFailure(response.status, payload.error?.code);
    return optionsUnavailable(symbol, expiration, classification.reason, payload.error?.message ?? 'Options chain is unavailable.', payload.meta?.provider ?? null);
  }
  const parsed = optionsChainSchema.safeParse(payload.data);
  if (!parsed.success) {
    return optionsUnavailable(symbol, expiration, 'chain-unavailable', 'Options chain failed validation.', payload.meta?.provider ?? null);
  }
  const chain = parsed.data;
  const price = acceptedPrice !== null && Number.isFinite(acceptedPrice) && acceptedPrice > 0 ? acceptedPrice : chain.spot;
  return computeOptionsSupportResistance({
    symbol: chain.underlyingSymbol,
    expiration: chain.expiration,
    acceptedPrice: price,
    calls: chain.calls,
    puts: chain.puts,
    provider: chain.provider,
    asOf: chain.asOf,
    status: chain.status,
  }, { ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}), ...(options.config ?? {}) });
}
