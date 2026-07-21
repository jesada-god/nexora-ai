/**
 * Visible Range Volume Profile (VRVP).
 *
 * Computed from the chart's *visible* OHLCV slice only. Because tick data is
 * unavailable, each candle's volume is distributed deterministically across its
 * [low, high] range in proportion to the overlap with each price bin — an OHLCV
 * approximation, marked as such in `provenance`. No market data is fetched here;
 * a viewport change only re-slices the already-loaded candles.
 */

export interface VrvpInputCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface VrvpBin {
  index: number;
  priceLow: number;
  priceHigh: number;
  midpoint: number;
  volume: number;
  normalizedVolume: number;
}

export interface VrvpNode {
  priceLow: number;
  priceHigh: number;
  volume: number;
  binIndexes: number[];
}

export interface VrvpConfig {
  /** Number of price bins (deterministic; clamped to [8, 200]). */
  bins?: number;
  /** Value-area share of total volume (documented default 70%). */
  valueAreaPercent?: number;
  /** Normalized-volume threshold for a High Volume Node (default 0.70). */
  hvnThreshold?: number;
  /** Normalized-volume threshold for a Low Volume Node (default 0.20). */
  lvnThreshold?: number;
}

export interface VrvpMeta {
  provenance: 'ohlcv-approximation';
  methodology: string;
  bins: number;
  valueAreaPercent: number;
  visibleFrom: string | null;
  visibleTo: string | null;
  candleCount: number;
  coverage: number;
}

export type VisibleRangeVolumeProfile =
  | (VrvpMeta & {
      status: 'available';
      profile: VrvpBin[];
      poc: number;
      vah: number;
      val: number;
      hvn: VrvpNode[];
      lvn: VrvpNode[];
      totalVolume: number;
    })
  | (VrvpMeta & {
      status: 'unavailable';
      reason: string;
    });

const METHODOLOGY =
  'Each visible candle distributes its volume across fixed price bins proportional to the bin overlap with [low, high]; POC is the peak-volume bin and the value area expands from the POC to the configured share of total volume. Estimated from OHLCV, not order-book tick data.';

const clampBins = (value: number | undefined, fallback: number): number => {
  const requested = Number.isInteger(value) ? (value as number) : fallback;
  return Math.max(8, Math.min(200, requested));
};

function finite(candle: VrvpInputCandle): boolean {
  return [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) && candle.high >= candle.low;
}

function cluster(bins: VrvpBin[], selected: (bin: VrvpBin, index: number) => boolean): VrvpNode[] {
  const nodes: VrvpNode[] = [];
  bins.forEach((bin, index) => {
    if (!selected(bin, index)) return;
    const previous = nodes.at(-1);
    if (previous && previous.binIndexes.at(-1) === index - 1) {
      previous.priceHigh = bin.priceHigh;
      previous.volume += bin.volume;
      previous.binIndexes.push(index);
    } else {
      nodes.push({ priceLow: bin.priceLow, priceHigh: bin.priceHigh, volume: bin.volume, binIndexes: [index] });
    }
  });
  return nodes;
}

export function calculateVisibleRangeVolumeProfile(
  visible: readonly VrvpInputCandle[],
  config: VrvpConfig = {},
): VisibleRangeVolumeProfile {
  const valid = visible.filter(finite);
  const withVolume = valid.filter((candle) => candle.volume != null && Number.isFinite(candle.volume) && (candle.volume as number) >= 0);
  const coverage = valid.length ? withVolume.length / valid.length : 0;
  const binCount = clampBins(config.bins, Math.max(24, Math.min(120, Math.round(Math.sqrt(Math.max(valid.length, 1)) * 3))));
  const valueAreaPercent = Number.isFinite(config.valueAreaPercent) ? Math.min(0.99, Math.max(0.5, config.valueAreaPercent as number)) : 0.7;
  const hvnThreshold = Number.isFinite(config.hvnThreshold) ? (config.hvnThreshold as number) : 0.7;
  const lvnThreshold = Number.isFinite(config.lvnThreshold) ? (config.lvnThreshold as number) : 0.2;

  const meta: VrvpMeta = {
    provenance: 'ohlcv-approximation',
    methodology: METHODOLOGY,
    bins: binCount,
    valueAreaPercent,
    visibleFrom: valid.at(0)?.date ?? null,
    visibleTo: valid.at(-1)?.date ?? null,
    candleCount: valid.length,
    coverage,
  };

  if (valid.length < 2) return { ...meta, status: 'unavailable', reason: 'Visible range has fewer than 2 valid candles' };
  if (!withVolume.length) return { ...meta, status: 'unavailable', reason: 'Volume is unavailable across the visible range' };

  let minimum = Math.min(...valid.map((candle) => candle.low));
  let maximum = Math.max(...valid.map((candle) => candle.high));
  if (maximum === minimum) {
    const padding = Math.max(Math.abs(minimum) * 0.001, 1e-6);
    minimum -= padding;
    maximum += padding;
  }
  const width = (maximum - minimum) / binCount;
  const volumes = Array<number>(binCount).fill(0);
  let totalVolume = 0;
  for (const candle of withVolume) {
    const volume = candle.volume as number;
    totalVolume += volume;
    if (candle.high === candle.low) {
      const index = Math.min(binCount - 1, Math.max(0, Math.floor((candle.low - minimum) / width)));
      volumes[index] += volume;
      continue;
    }
    for (let index = 0; index < binCount; index += 1) {
      const binLow = minimum + index * width;
      const binHigh = index === binCount - 1 ? maximum : binLow + width;
      const overlap = Math.max(0, Math.min(candle.high, binHigh) - Math.max(candle.low, binLow));
      if (overlap > 0) volumes[index] += (volume * overlap) / (candle.high - candle.low);
    }
  }

  const peak = Math.max(...volumes);
  const bins: VrvpBin[] = volumes.map((volume, index) => {
    const priceLow = minimum + index * width;
    const priceHigh = index === binCount - 1 ? maximum : priceLow + width;
    return { index, priceLow, priceHigh, midpoint: (priceLow + priceHigh) / 2, volume, normalizedVolume: peak ? volume / peak : 0 };
  });

  const pocBin = bins.reduce((best, bin) => (bin.volume > best.volume ? bin : best));
  const target = totalVolume * valueAreaPercent;
  let included = pocBin.volume;
  let lowIndex = pocBin.index;
  let highIndex = pocBin.index;
  while (included < target && (lowIndex > 0 || highIndex < bins.length - 1)) {
    const below = lowIndex > 0 ? bins[lowIndex - 1].volume : -1;
    const above = highIndex < bins.length - 1 ? bins[highIndex + 1].volume : -1;
    if (above >= below) {
      highIndex += 1;
      included += bins[highIndex].volume;
    } else {
      lowIndex -= 1;
      included += bins[lowIndex].volume;
    }
  }

  const hvn = cluster(bins, (bin) => bin.normalizedVolume >= hvnThreshold);
  const lvn = cluster(
    bins,
    (bin, index) =>
      index > 0 &&
      index < bins.length - 1 &&
      bin.normalizedVolume <= lvnThreshold &&
      Math.max(...bins.slice(0, index).map((item) => item.normalizedVolume)) >= 0.4 &&
      Math.max(...bins.slice(index + 1).map((item) => item.normalizedVolume)) >= 0.4,
  );

  return {
    ...meta,
    status: 'available',
    profile: bins,
    poc: pocBin.midpoint,
    vah: bins[highIndex].priceHigh,
    val: bins[lowIndex].priceLow,
    hvn,
    lvn,
    totalVolume,
  };
}
