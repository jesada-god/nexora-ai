'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { optionsUnavailable, type OptionsSrResult } from '@/src/lib/analytics/options-sr';
import {
  fetchOptionsSr,
  optionsExpirationsCoordinator,
  optionsRequestKey,
  planOptionsRequest,
  shouldApplyOptionsResponse,
} from '@/src/lib/stock-detail/options-source';

export interface UseOptionsSupportResistanceOptions {
  symbol: string;
  /** The single accepted underlying price shared with the header/chart. */
  acceptedPrice: number | null;
  /** The Options S/R overlay toggle — the lazy-load gate (item 15). */
  enabled: boolean;
  /** True only while the Chart tab is active/mounted, so nothing loads off-tab. */
  active: boolean;
}

export interface UseOptionsSupportResistanceResult {
  result: OptionsSrResult | null;
  loading: boolean;
  expirations: string[];
  selectedExpiration: string | null;
  setExpiration: (expiration: string) => void;
  refresh: () => void;
}

/**
 * Lazily loads Options-Driven S/R for the active chart. It reuses the shared
 * Phase 11 options endpoints via {@link fetchOptionsSr}, caches by symbol +
 * expiration, runs exactly one request per key, aborts a superseded expiration's
 * response, and stops permanently on a non-retryable entitlement failure. It
 * deliberately does NOT depend on the viewport or the live price tick, so a
 * pan/zoom or a price update never refetches (item 15).
 */
export function useOptionsSupportResistance({ symbol, acceptedPrice, enabled, active }: UseOptionsSupportResistanceOptions): UseOptionsSupportResistanceResult {
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const [result, setResult] = useState<OptionsSrResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const cache = useRef(new Map<string, OptionsSrResult>());
  const inflight = useRef(new Set<string>());
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const entitlementBlocked = useRef(false);
  const [expirationsToken, setExpirationsToken] = useState(0);

  // The accepted price is kept in a ref so a live price tick never re-triggers a
  // chain fetch; it is read only at fetch time to anchor level distances.
  const acceptedPriceRef = useRef(acceptedPrice);
  useEffect(() => { acceptedPriceRef.current = acceptedPrice; }, [acceptedPrice]);

  // Reset all per-symbol scope when the symbol changes so another symbol's
  // expirations, cache or entitlement-block can never leak across instruments.
  // Placed before the load effects (effects run in definition order) so the
  // reload guard is cleared before expirations are re-fetched.
  const previousSymbol = useRef(symbol);
  useEffect(() => {
    if (previousSymbol.current === symbol) return; // skip the initial mount
    previousSymbol.current = symbol;
    entitlementBlocked.current = false;
    cache.current.clear();
    inflight.current.clear();
    generation.current += 1;
    abort.current?.abort();
    setExpirations([]);
    setSelectedExpiration(null);
    setResult(null);
  }, [symbol]);

  // Load the available non-expired expirations, only when the overlay is enabled
  // and the tab is active. The coordinator guarantees exactly one request per
  // symbol and enforces the 429 cooldown, so re-renders / StrictMode re-mounts
  // never produce repeated expirations requests (items 16–17).
  useEffect(() => {
    if (!enabled || !active || entitlementBlocked.current) return;
    let cancelled = false;
    (async () => {
      const outcome = await optionsExpirationsCoordinator.load(symbol);
      if (cancelled) return;
      if (!outcome.ok) {
        if (outcome.classification?.stopsPolling) entitlementBlocked.current = true;
        const reason = outcome.classification?.reason ?? 'chain-unavailable';
        setResult(optionsUnavailable(symbol, null, reason, outcome.message ?? 'Options expirations are unavailable.', outcome.provider));
        return;
      }
      if (outcome.expirations.length === 0) {
        setResult(optionsUnavailable(symbol, null, 'no-expirations', 'No non-expired option expirations were returned.', outcome.provider));
        return;
      }
      setExpirations(outcome.expirations);
      // Default to the nearest non-expired expiration; keep the user's choice if
      // it is still valid.
      setSelectedExpiration((current) => (current && outcome.expirations.includes(current) ? current : outcome.expirations[0]));
    })();
    return () => { cancelled = true; };
  }, [symbol, enabled, active, expirationsToken]);

  // Load one expiration's chain and compute the levels. Cached by symbol +
  // expiration; a superseded expiration's response is aborted and generation-guarded.
  useEffect(() => {
    if (!enabled || !active || !selectedExpiration || entitlementBlocked.current) return;
    const key = optionsRequestKey(symbol, selectedExpiration);
    const plan = planOptionsRequest({
      enabled,
      entitlementBlocked: entitlementBlocked.current,
      hasExpiration: true,
      cacheHas: cache.current.has(key),
      inflightHas: inflight.current.has(key),
      force: false,
    });
    if (plan === 'serve-cache') { setResult(cache.current.get(key)!); return; }
    if (plan === 'skip' || plan === 'join-inflight') return;

    const requestGeneration = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    inflight.current.add(key);
    setLoading(true);
    void (async () => {
      try {
        const res = await fetchOptionsSr(symbol, selectedExpiration, acceptedPriceRef.current, controller.signal);
        if (!shouldApplyOptionsResponse(generation.current, requestGeneration, controller.signal.aborted)) return;
        if (res.status === 'unavailable' && res.reason === 'entitlement-required') entitlementBlocked.current = true;
        cache.current.set(key, res);
        setResult(res);
      } catch (cause) {
        if (controller.signal.aborted || !shouldApplyOptionsResponse(generation.current, requestGeneration, false)) return;
        setResult(optionsUnavailable(symbol, selectedExpiration, 'chain-unavailable', cause instanceof Error ? cause.message : 'Options chain request failed.'));
      } finally {
        inflight.current.delete(key);
        if (generation.current === requestGeneration) setLoading(false);
      }
    })();
    return () => { controller.abort(); };
  }, [symbol, selectedExpiration, enabled, active, refreshToken]);

  const setExpiration = useCallback((expiration: string) => setSelectedExpiration(expiration), []);
  const refresh = useCallback(() => {
    if (selectedExpiration) cache.current.delete(optionsRequestKey(symbol, selectedExpiration));
    // A manual refresh is the sanctioned way past the expirations cooldown.
    optionsExpirationsCoordinator.reset(symbol);
    setExpirationsToken((token) => token + 1);
    setRefreshToken((token) => token + 1);
  }, [symbol, selectedExpiration]);

  return { result, loading, expirations, selectedExpiration, setExpiration, refresh };
}
