import type {
  MarketSnapshot,
  NormalizedBar,
  NormalizedMarketEvent,
  NormalizedQuote,
  NormalizedTrade,
} from '@/src/lib/market-data/realtime';

/**
 * Per-symbol "latest state" cache the Gateway warms directly from the live
 * upstream stream.
 *
 * Every normalized trade/quote/bar that flows through the Gateway is recorded
 * here so that when a NEW client subscribes to a symbol another client is
 * already streaming, the Gateway can answer with a snapshot instantly from
 * memory — no REST round-trip, no waiting for the next tick. A REST bootstrap
 * ({@link seed}) fills the same cache for a cold symbol nobody was streaming
 * yet, so the second subscriber is served from cache.
 *
 * Only REAL provider values are stored; nothing is interpolated or synthesized.
 * Out-of-order ticks are ignored (a trade/quote older than the one held never
 * replaces it) and bars are keyed by bucket start so a re-delivered or corrected
 * (`updatedBar`) minute overwrites in place instead of duplicating.
 */

export interface MarketCacheOptions {
  /** Recent finalized 1m bars retained per symbol. 240 = a full 4h window. */
  maxBarsPerSymbol?: number;
  now?: () => number;
}

interface SymbolState {
  trade: NormalizedTrade | null;
  quote: NormalizedQuote | null;
  /** Finalized/updated 1m bars keyed by bucket start (ms); last write wins. */
  bars: Map<number, NormalizedBar>;
}

const DEFAULT_MAX_BARS = 240;

export class MarketCache {
  private readonly symbols = new Map<string, SymbolState>();
  private readonly maxBars: number;
  private readonly now: () => number;

  constructor(options: MarketCacheOptions = {}) {
    this.maxBars = options.maxBarsPerSymbol ?? DEFAULT_MAX_BARS;
    this.now = options.now ?? Date.now;
  }

  /** Fold one normalized upstream event into the per-symbol latest state. */
  record(event: NormalizedMarketEvent): void {
    const state = this.stateFor(event.symbol);
    switch (event.kind) {
      case 'trade':
        // Keep only the newest trade so an out-of-order tick never regresses the
        // last price.
        if (!state.trade || event.timestampMs >= state.trade.timestampMs) state.trade = event;
        break;
      case 'quote':
        if (!state.quote || event.timestampMs >= state.quote.timestampMs) state.quote = event;
        break;
      case 'bar':
        this.recordBar(state, event);
        break;
      case 'status':
        break;
    }
  }

  /**
   * Seed the cache from a REST bootstrap. Each field is recorded through the same
   * newest-wins/keyed-by-bucket path as live events, so a live tick that raced the
   * REST response is never overwritten by older bootstrap data.
   */
  seed(snapshot: MarketSnapshot): void {
    if (snapshot.trade) this.record(snapshot.trade);
    if (snapshot.quote) this.record(snapshot.quote);
    for (const bar of snapshot.bars) this.record(bar);
  }

  /**
   * Build the current snapshot for a symbol, or null when nothing has been
   * cached yet (a cold symbol → the caller should fall back to a REST bootstrap).
   */
  snapshotFor(symbol: string): MarketSnapshot | null {
    const state = this.symbols.get(symbol.toUpperCase());
    if (!state) return null;
    if (!state.trade && !state.quote && state.bars.size === 0) return null;
    return {
      symbol: symbol.toUpperCase(),
      trade: state.trade,
      quote: state.quote,
      bars: [...state.bars.values()].sort((a, b) => a.timestampMs - b.timestampMs),
      origin: 'cache',
      asOfMs: this.now(),
    };
  }

  /** Drop a symbol's cached state (e.g. once no client is subscribed to it). */
  forget(symbol: string): void {
    this.symbols.delete(symbol.toUpperCase());
  }

  private stateFor(symbol: string): SymbolState {
    const key = symbol.toUpperCase();
    let state = this.symbols.get(key);
    if (!state) {
      state = { trade: null, quote: null, bars: new Map() };
      this.symbols.set(key, state);
    }
    return state;
  }

  private recordBar(state: SymbolState, bar: NormalizedBar): void {
    state.bars.set(bar.timestampMs, bar);
    if (state.bars.size <= this.maxBars) return;
    const keys = [...state.bars.keys()].sort((a, b) => a - b);
    const excess = state.bars.size - this.maxBars;
    for (let index = 0; index < excess; index += 1) state.bars.delete(keys[index]);
  }
}
