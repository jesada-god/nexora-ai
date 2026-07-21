import type {
  MarketDataLabel,
  MarketDataMode,
  MarketPriceSource,
  TransportFreshness,
} from './types';

/**
 * Map a transport freshness status to a truthful display mode.
 *
 * `realtime` is deliberately downgraded to `DELAYED`: the account is not
 * entitled to a real-time feed, so even when a provider tags a value as
 * real-time we must not repeat that claim. `unknown` is likewise treated as
 * `DELAYED` — we know it is at best delayed, never live.
 */
export function modeFromFreshness(
  status: TransportFreshness,
  hasPrice: boolean,
): MarketDataMode {
  if (!hasPrice) return 'UNAVAILABLE';
  switch (status) {
    case 'end-of-day':
      return 'END-OF-DAY';
    case 'cached':
      return 'CACHED';
    case 'stale':
      return 'STALE';
    case 'realtime':
    case 'delayed':
    case 'unknown':
      return 'DELAYED';
    default:
      return 'DELAYED';
  }
}

interface LabelInput {
  status: TransportFreshness;
  hasPrice: boolean;
  provider: string | null;
  source: MarketPriceSource | null;
  exchangeTimestamp: string | null;
  receivedAt: string;
  fallbackNote?: string | null;
}

/** Build a fully provenanced, truthful label for an emitted value. */
export function buildLabel(input: LabelInput): MarketDataLabel {
  const mode = modeFromFreshness(input.status, input.hasPrice);
  const exchangeMs = input.exchangeTimestamp ? Date.parse(input.exchangeTimestamp) : Number.NaN;
  const receivedMs = Date.parse(input.receivedAt);
  const delayAgeSeconds = Number.isFinite(exchangeMs) && Number.isFinite(receivedMs)
    ? Math.max(0, Math.round((receivedMs - exchangeMs) / 1_000))
    : null;
  return {
    mode,
    provider: input.provider,
    source: input.hasPrice ? input.source : null,
    exchangeTimestamp: input.exchangeTimestamp,
    receivedAt: input.receivedAt,
    delayAgeSeconds,
    fallbackNote: input.fallbackNote ?? null,
  };
}

/** The unavailable label used when no valid value could be produced. */
export function unavailableLabel(receivedAt: string, provider: string | null = null): MarketDataLabel {
  return {
    mode: 'UNAVAILABLE',
    provider,
    source: null,
    exchangeTimestamp: null,
    receivedAt,
    delayAgeSeconds: null,
    fallbackNote: null,
  };
}
