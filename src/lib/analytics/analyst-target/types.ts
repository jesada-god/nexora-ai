/**
 * Shared types for analyst price-target consensus — EXTERNAL reference data,
 * distinct from the Nexora Fair Value model. Kept in a client-safe module (no
 * `server-only`) so the card component and the server service share one contract
 * without the client importing provider/secret code.
 */

export interface AnalystPriceTarget {
  status: 'available';
  symbol: string;
  low: number;
  /** Median consensus target, when the provider reports one. */
  median: number | null;
  /** Mean (average) consensus target. */
  average: number;
  high: number;
  /** Number of contributing analysts for the freshest window, when known. */
  analystCount: number | null;
  /** Trailing window the count/coverage reflects, when derived from a count. */
  coverageWindow: 'last-quarter' | 'last-year' | 'all-time' | null;
  /** Listing currency of the targets, resolved by the caller (never fabricated). */
  currency: string | null;
  /** Provider-reported as-of date (ISO), when available; otherwise null. */
  asOf: string | null;
  /** When the app retrieved this from the provider (freshness). */
  retrievedAt: string;
  source: 'financial-modeling-prep';
}

export interface AnalystPriceTargetUnavailable {
  status: 'unavailable';
  symbol: string;
  reason: string;
}

export type AnalystTargetResult = AnalystPriceTarget | AnalystPriceTargetUnavailable;
