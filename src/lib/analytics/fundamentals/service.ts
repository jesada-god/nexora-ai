import 'server-only';
import { MarketDataError } from '../../market-data/errors';
import type { FundamentalsProvider, FundamentalsSnapshot } from './provider';

/**
 * Deterministic primary → secondary fundamentals fallback.
 *
 * The primary (Alpha Vantage) never throws on a throttled dataset: it returns an
 * unusable snapshot (zero periods) carrying per-dataset `datasetErrors`. This
 * service reads that truthful state and, only for eligible temporary failures,
 * asks the configured secondary (FMP) for one complete replacement snapshot. It
 * never merges periods from two providers and never erases a usable primary or a
 * truthful typed failure. Every returned snapshot keeps honest provenance.
 */

const ELIGIBLE_CODES = new Set([
  'rate-limited',
  'timeout',
  'upstream-unavailable',
  'provider-unavailable',
  'invalid-provider-response',
]);
const DEFAULT_COOLDOWN_SECONDS = 60;

export interface FundamentalsServiceLog {
  event: string;
  symbol: string;
  primaryProvider?: string;
  providerUsed?: string | null;
  fallbackReason?: string | null;
  errorCode?: string | null;
}

type Logger = (entry: FundamentalsServiceLog) => void;

function defaultLogger(entry: FundamentalsServiceLog): void {
  const payload = { ...entry, timestamp: new Date().toISOString() };
  if (entry.errorCode) console.warn(JSON.stringify(payload));
  else console.info(JSON.stringify(payload));
}

function isUsable(snapshot: FundamentalsSnapshot): boolean {
  return snapshot.periods.length > 0;
}

/** A primary snapshot is fallback-eligible only when it produced no usable real
 * data *and* every dataset that failed did so for an eligible temporary reason.
 * Genuinely-empty filings (no dataset errors) and operator-action faults
 * (unauthorized/not-configured/invalid-symbol) are deliberately excluded. */
function primaryEligibleReason(snapshot: FundamentalsSnapshot): string | null {
  if (isUsable(snapshot)) return null;
  const codes = Object.values(snapshot.datasetErrors ?? {});
  if (codes.length === 0) return null;
  if (!codes.every((code) => ELIGIBLE_CODES.has(code))) return null;
  const dominant = codes.includes('rate-limited') ? 'rate-limited' : codes[0];
  return `PRIMARY_${dominant.toUpperCase().replaceAll('-', '_')}`;
}

function errorReason(prefix: 'PRIMARY' | 'SECONDARY', error: MarketDataError): string {
  return `${prefix}_${error.code.toUpperCase().replaceAll('-', '_')}`;
}

function withProvenance(
  snapshot: FundamentalsSnapshot,
  provenance: Pick<FundamentalsSnapshot, 'primaryProvider' | 'providerUsed' | 'fallbackUsed' | 'fallbackReason'>,
): FundamentalsSnapshot {
  return { ...snapshot, ...provenance };
}

export class FundamentalsService implements FundamentalsProvider {
  readonly id: string;
  private readonly cooldowns = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<FundamentalsSnapshot>>();

  constructor(
    private readonly primary: FundamentalsProvider,
    private readonly secondary: FundamentalsProvider | null,
    private readonly now: () => number = Date.now,
    private readonly log: Logger = defaultLogger,
  ) {
    this.id = primary.id;
  }

  getConsensusForwardEps(symbol: string) {
    if (!this.primary.getConsensusForwardEps) {
      return Promise.reject(new MarketDataError('unsupported', 'Consensus forward EPS is not supported'));
    }
    return this.primary.getConsensusForwardEps(symbol);
  }

  async getFinancialPeriods(rawSymbol: string, signal?: AbortSignal): Promise<FundamentalsSnapshot> {
    const symbol = rawSymbol.trim().toUpperCase();
    const existing = this.inflight.get(symbol);
    if (existing) return existing;
    const operation = this.resolve(symbol, signal).finally(() => this.inflight.delete(symbol));
    this.inflight.set(symbol, operation);
    return operation;
  }

  private cooldownActive(providerId: string): boolean {
    return (this.cooldowns.get(providerId) ?? 0) > this.now();
  }

  private async resolve(symbol: string, signal?: AbortSignal): Promise<FundamentalsSnapshot> {
    let primary: FundamentalsSnapshot | null = null;
    let primaryReason: string | null = null;
    try {
      primary = await this.primary.getFinancialPeriods(symbol, signal);
      if (Object.values(primary.diagnostics.cache ?? {}).includes('hit')) {
        this.log({ event: 'fundamentals-cache-used', symbol, primaryProvider: this.primary.id });
      }
      primaryReason = primaryEligibleReason(primary);
      if (!primaryReason) {
        return withProvenance(primary, {
          primaryProvider: this.primary.id,
          providerUsed: this.primary.id,
          fallbackUsed: false,
          fallbackReason: null,
        });
      }
    } catch (cause) {
      const error = cause instanceof MarketDataError ? cause : new MarketDataError('upstream-unavailable', 'Fundamentals provider failed');
      if (!ELIGIBLE_CODES.has(error.code)) throw error;
      primaryReason = errorReason('PRIMARY', error);
    }

    this.log({ event: 'fundamentals-primary-failed', symbol, primaryProvider: this.primary.id, fallbackReason: primaryReason });

    if (!this.secondary || this.cooldownActive(this.secondary.id)) {
      return this.primaryOrThrow(symbol, primary, primaryReason, this.secondary ? 'SECONDARY_COOLDOWN' : 'SECONDARY_NOT_CONFIGURED');
    }

    this.log({ event: 'fundamentals-fallback-started', symbol, primaryProvider: this.primary.id, providerUsed: this.secondary.id, fallbackReason: primaryReason });

    let secondary: FundamentalsSnapshot;
    try {
      secondary = await this.secondary.getFinancialPeriods(symbol, signal);
    } catch (cause) {
      const error = cause instanceof MarketDataError ? cause : new MarketDataError('upstream-unavailable', 'Secondary fundamentals provider failed');
      if (error.code === 'rate-limited') {
        this.cooldowns.set(this.secondary.id, this.now() + (error.retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS) * 1_000);
      }
      this.log({ event: 'fundamentals-fallback-failed', symbol, providerUsed: this.secondary.id, fallbackReason: primaryReason, errorCode: error.code });
      return this.primaryOrThrow(symbol, primary, primaryReason, errorReason('SECONDARY', error), error);
    }

    if (secondary.symbol.trim().toUpperCase() !== symbol) {
      this.log({ event: 'provider-identity-mismatch', symbol, providerUsed: this.secondary.id, errorCode: 'provider-identity-mismatch' });
      return this.primaryOrThrow(symbol, primary, primaryReason, 'SECONDARY_IDENTITY_MISMATCH');
    }

    if (!isUsable(secondary)) {
      const secondaryCodes = Object.values(secondary.datasetErrors ?? {});
      const secondaryReason = secondaryCodes.includes('rate-limited')
        ? 'SECONDARY_RATE_LIMITED'
        : secondaryCodes.length > 0 ? `SECONDARY_${secondaryCodes[0].toUpperCase().replaceAll('-', '_')}` : 'SECONDARY_INSUFFICIENT_DATA';
      this.log({ event: 'fundamentals-fallback-failed', symbol, providerUsed: this.secondary.id, fallbackReason: primaryReason, errorCode: secondaryReason });
      return this.primaryOrThrow(symbol, primary, primaryReason, secondaryReason);
    }

    this.log({ event: 'fundamentals-fallback-succeeded', symbol, primaryProvider: this.primary.id, providerUsed: this.secondary.id, fallbackReason: primaryReason });
    return withProvenance(secondary, {
      primaryProvider: this.primary.id,
      providerUsed: this.secondary.id,
      fallbackUsed: true,
      fallbackReason: primaryReason,
    });
  }

  /** Preserve the truthful primary snapshot when the secondary cannot help. If the
   * primary itself threw an eligible error and produced no snapshot, surface that
   * as a typed failure so the caller reports an honest unavailable/rate-limited
   * state rather than fabricating data. */
  private primaryOrThrow(
    symbol: string,
    primary: FundamentalsSnapshot | null,
    primaryReason: string | null,
    secondaryReason: string,
    thrown?: MarketDataError,
  ): FundamentalsSnapshot {
    const fallbackReason = `${primaryReason ?? 'PRIMARY_UNAVAILABLE'}; ${secondaryReason}`;
    if (primary) {
      return withProvenance(primary, {
        primaryProvider: this.primary.id,
        providerUsed: this.primary.id,
        fallbackUsed: false,
        fallbackReason,
      });
    }
    throw thrown ?? new MarketDataError(
      primaryReason?.includes('RATE_LIMITED') ? 'rate-limited' : 'upstream-unavailable',
      'Fundamentals are temporarily unavailable across all configured providers',
      undefined,
      undefined,
      { reason: fallbackReason },
    );
  }
}
