import type { VolumeProfileBin, VolumeProfileCluster, VolumeProfileInputCandle, VolumeProfileResult } from './types';

const VERSION = 'nexora-vpvr-v1' as const;
const METHODOLOGY = 'Volume is allocated proportionally across price-bin overlap for each historical OHLCV candle; this is estimated from historical OHLCV, not order-book data.';

function finiteCandle(candle: VolumeProfileInputCandle) {
  return [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) && candle.high >= candle.low;
}

export function normalizeVolumeCandles(input: readonly VolumeProfileInputCandle[]): VolumeProfileInputCandle[] {
  const byTimestamp = new Map<string, VolumeProfileInputCandle>();
  input.forEach((candle) => {
    if (!finiteCandle(candle) || !candle.date) return;
    const volume = candle.volume == null || !Number.isFinite(candle.volume) || candle.volume < 0 ? null : candle.volume;
    byTimestamp.set(candle.date, { ...candle, volume });
  });
  return [...byTimestamp.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function clusterBins(bins: VolumeProfileBin[], selected: (bin: VolumeProfileBin, index: number) => boolean): VolumeProfileCluster[] {
  const clusters: VolumeProfileCluster[] = [];
  bins.forEach((bin, index) => {
    if (!selected(bin, index)) return;
    const previous = clusters.at(-1);
    if (previous && previous.binIndexes.at(-1) === index - 1) {
      previous.priceHigh = bin.priceHigh; previous.volume += bin.volume; previous.binIndexes.push(index);
    } else clusters.push({ priceLow: bin.priceLow, priceHigh: bin.priceHigh, volume: bin.volume, binIndexes: [index] });
  });
  return clusters;
}

export function calculateVolumeProfile(input: readonly VolumeProfileInputCandle[], requestedBins?: number): VolumeProfileResult {
  const candles = normalizeVolumeCandles(input);
  const withVolume = candles.filter((candle) => candle.volume != null);
  const coverage = candles.length ? withVolume.length / candles.length : 0;
  if (!candles.length || !withVolume.length) return { status: 'unavailable', version: VERSION, methodology: METHODOLOGY, reason: candles.length ? 'Volume unavailable' : 'No valid OHLCV candles', coverage };
  let minimum = Math.min(...candles.map((candle) => candle.low));
  let maximum = Math.max(...candles.map((candle) => candle.high));
  if (maximum === minimum) {
    const padding = Math.max(Math.abs(minimum) * 0.001, 0.000001);
    minimum -= padding; maximum += padding;
  }
  const binCount = Math.max(12, Math.min(64, Number.isInteger(requestedBins) ? requestedBins! : Math.round(Math.sqrt(candles.length) * 2)));
  const width = (maximum - minimum) / binCount;
  const volumes = Array<number>(binCount).fill(0);
  let totalInputVolume = 0;
  withVolume.forEach((candle) => {
    const volume = candle.volume as number; totalInputVolume += volume;
    if (candle.high === candle.low) {
      const index = Math.min(binCount - 1, Math.max(0, Math.floor((candle.low - minimum) / width)));
      volumes[index] += volume; return;
    }
    for (let index = 0; index < binCount; index += 1) {
      const low = minimum + index * width; const high = index === binCount - 1 ? maximum : low + width;
      const overlap = Math.max(0, Math.min(candle.high, high) - Math.max(candle.low, low));
      if (overlap > 0) volumes[index] += volume * overlap / (candle.high - candle.low);
    }
  });
  const maximumVolume = Math.max(...volumes);
  const bins = volumes.map((volume, index): VolumeProfileBin => ({ index, priceLow: minimum + index * width, priceHigh: index === binCount - 1 ? maximum : minimum + (index + 1) * width, volume, normalizedVolume: maximumVolume ? volume / maximumVolume : 0 }));
  const latest = candles.at(-1)!.close;
  const poc = bins.reduce((best, bin) => bin.volume > best.volume || (bin.volume === best.volume && Math.abs((bin.priceLow + bin.priceHigh) / 2 - latest) < Math.abs((best.priceLow + best.priceHigh) / 2 - latest)) ? bin : best);
  const target = totalInputVolume * 0.7; let included = poc.volume; let lowIndex = poc.index; let highIndex = poc.index;
  while (included < target && (lowIndex > 0 || highIndex < bins.length - 1)) {
    const below = lowIndex > 0 ? bins[lowIndex - 1].volume : -1; const above = highIndex < bins.length - 1 ? bins[highIndex + 1].volume : -1;
    if (above > below) { highIndex += 1; included += bins[highIndex].volume; } else { lowIndex -= 1; included += bins[lowIndex].volume; }
  }
  const hvnClusters = clusterBins(bins, (bin, index) => bin.normalizedVolume >= 0.7 && bin.volume >= (bins[index - 1]?.volume ?? -1) && bin.volume >= (bins[index + 1]?.volume ?? -1));
  const lvnClusters = clusterBins(bins, (bin, index) => index > 0 && index < bins.length - 1 && bin.normalizedVolume <= 0.2 && Math.max(...bins.slice(0, index).map((item) => item.normalizedVolume)) >= 0.4 && Math.max(...bins.slice(index + 1).map((item) => item.normalizedVolume)) >= 0.4);
  return { status: 'available', version: VERSION, methodology: METHODOLOGY, bins, poc, vah: bins[highIndex].priceHigh, val: bins[lowIndex].priceLow, hvnClusters, lvnClusters, totalInputVolume, totalAllocatedVolume: volumes.reduce((sum, volume) => sum + volume, 0), coverage };
}
