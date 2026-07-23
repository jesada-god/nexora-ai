import 'server-only';
import { z } from 'zod';
import { serverEnv } from '@/src/config/env/server';
import type {
  AnalystPriceTarget,
  AnalystPriceTargetUnavailable,
  AnalystTargetResult,
} from './types';

export type { AnalystPriceTarget, AnalystPriceTargetUnavailable, AnalystTargetResult } from './types';

/**
 * Analyst price-target consensus — EXTERNAL reference data, kept strictly
 * separate from the Nexora model's Fair Value.
 *
 * This is NOT a valuation the app computes: it is the published consensus of
 * sell-side analysts, sourced server-side from Financial Modeling Prep (an
 * entitled provider), and displayed only when real values come back. It never
 * writes to a `fairValue` field, never borrows the model's confidence, and is
 * never labelled "Fair Value". When the provider is unconfigured, unentitled,
 * throttled, or simply has no coverage for a symbol, the result is a truthful
 * `unavailable` — no number is fabricated, interpolated, or defaulted.
 *
 * Field mapping (FMP `/stable`):
 *   price-target-consensus → targetHigh/Low/Median/Consensus (consensus = mean)
 *   price-target-summary   → per-window analyst counts (recency of coverage)
 *
 * Both endpoints are parsed defensively: any shape mismatch or missing/ non-finite
 * consensus collapses to `unavailable` rather than guessing.
 */

const BASE_URL = 'https://financialmodelingprep.com/stable';
const TIMEOUT_MS = 8_000;

const finite = z.number().finite();

const consensusRowSchema = z
  .object({
    symbol: z.string().optional(),
    targetHigh: finite.optional(),
    targetLow: finite.optional(),
    targetConsensus: finite.optional(),
    targetMedian: finite.optional(),
  })
  .passthrough();

const summaryRowSchema = z
  .object({
    lastQuarterCount: z.number().int().nonnegative().optional(),
    lastYearCount: z.number().int().nonnegative().optional(),
    allTimeCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export interface LoadAnalystTargetOptions {
  apiKey?: string | null;
  /** Listing currency for the symbol, resolved upstream (e.g. from the instrument). */
  currency?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function unavailable(symbol: string, reason: string): AnalystPriceTargetUnavailable {
  return { status: 'unavailable', symbol, reason };
}

/**
 * Load the analyst price-target consensus for a symbol. Always resolves (never
 * throws) to either a fully-populated `available` result or a truthful
 * `unavailable` one.
 */
export async function loadAnalystTarget(
  rawSymbol: string,
  options: LoadAnalystTargetOptions = {},
): Promise<AnalystTargetResult> {
  const symbol = rawSymbol.trim().toUpperCase();
  const apiKey = options.apiKey ?? serverEnv.FMP_API_KEY ?? null;
  if (!apiKey) {
    return unavailable(symbol, 'ยังไม่ได้ตั้งค่าแหล่งข้อมูลราคาเป้าหมายนักวิเคราะห์');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());

  const [consensus, summary] = await Promise.all([
    getRow(`${BASE_URL}/price-target-consensus`, symbol, apiKey, fetchImpl, consensusRowSchema),
    getRow(`${BASE_URL}/price-target-summary`, symbol, apiKey, fetchImpl, summaryRowSchema),
  ]);

  if (!consensus) {
    return unavailable(symbol, 'ยังไม่มีราคาเป้าหมายจากแหล่งข้อมูลที่ตรวจสอบได้');
  }

  const { targetHigh, targetLow, targetConsensus, targetMedian } = consensus;
  // A meaningful consensus needs a real average and a real range. Anything less is
  // reported as unavailable rather than a partial guess.
  if (
    targetConsensus === undefined || targetHigh === undefined || targetLow === undefined
    || !(targetConsensus > 0) || !(targetHigh > 0) || !(targetLow > 0)
    || targetHigh < targetLow
  ) {
    return unavailable(symbol, 'ยังไม่มีราคาเป้าหมายจากแหล่งข้อมูลที่ตรวจสอบได้');
  }

  const count = analystCount(summary);
  return {
    status: 'available',
    symbol,
    low: targetLow,
    median: targetMedian !== undefined && targetMedian > 0 ? targetMedian : null,
    average: targetConsensus,
    high: targetHigh,
    analystCount: count?.value ?? null,
    coverageWindow: count?.window ?? null,
    currency: options.currency ?? null,
    asOf: null,
    retrievedAt: new Date(now()).toISOString(),
    source: 'financial-modeling-prep',
  };
}

function analystCount(
  summary: z.infer<typeof summaryRowSchema> | null,
): { value: number; window: AnalystPriceTarget['coverageWindow'] } | null {
  if (!summary) return null;
  if (summary.lastQuarterCount && summary.lastQuarterCount > 0) return { value: summary.lastQuarterCount, window: 'last-quarter' };
  if (summary.lastYearCount && summary.lastYearCount > 0) return { value: summary.lastYearCount, window: 'last-year' };
  if (summary.allTimeCount && summary.allTimeCount > 0) return { value: summary.allTimeCount, window: 'all-time' };
  return null;
}

async function getRow<T extends z.ZodTypeAny>(
  endpoint: string,
  symbol: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  schema: T,
): Promise<z.infer<T> | null> {
  const url = new URL(endpoint);
  url.searchParams.set('symbol', symbol);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', apikey: apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    // FMP returns an array of rows (or an { "Error Message" } object on plan errors).
    const first = Array.isArray(payload) ? payload[0] : undefined;
    if (!first) return null;
    const parsed = schema.safeParse(first);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
