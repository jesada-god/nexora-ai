import type { HistoricalPrice } from '@/src/lib/market-data/types';
import type {
  BollingerPoint,
  IndicatorPoint,
  IndicatorResult,
  MacdPoint,
  TechnicalAnalysis,
  TechnicalCandles,
  TechnicalContext,
  TechnicalParameters,
} from './types';
import { DEFAULT_TECHNICAL_PARAMETERS, technicalParametersSchema } from './validation';

const METHODOLOGY = 'Deterministic technical indicators calculated from daily OHLCV' as const;
const LIMITATIONS = [
  'Indicators describe historical price and volume; they do not predict future returns.',
  'Daily candles can omit intraday movement and provider adjustments may affect values.',
  'The latest value may change when the provider publishes a newer or adjusted candle.',
];

function unavailable(actualDataPoints: number, minimumDataPoints: number, reason?: string) {
  return {
    status: 'unavailable' as const,
    reason: reason ?? `ต้องมีข้อมูลอย่างน้อย ${minimumDataPoints} แท่ง แต่มี ${actualDataPoints} แท่ง`,
    minimumDataPoints,
    actualDataPoints,
  };
}

function available<T>(points: T[]): IndicatorResult<T> {
  if (!points.length) return unavailable(0, 1, 'ไม่สามารถคำนวณผลลัพธ์ที่เป็นค่าจำกัดได้');
  return { status: 'available', points, latest: points[points.length - 1] };
}

function assertPeriod(period: number) {
  if (!Number.isInteger(period) || period < 2) throw new RangeError('Period must be an integer of at least 2');
}

export function sma(values: readonly number[], period: number): Array<number | null> {
  assertPeriod(period);
  const result = Array<number | null>(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) result[index] = sum / period;
  }
  return result;
}

export function ema(values: readonly number[], period: number): Array<number | null> {
  assertPeriod(period);
  const result = Array<number | null>(values.length).fill(null);
  if (values.length < period) return result;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  result[period - 1] = seed;
  for (let index = period; index < values.length; index += 1) {
    result[index] = values[index] * multiplier + (result[index - 1] as number) * (1 - multiplier);
  }
  return result;
}

export function rsiWilder(values: readonly number[], period: number): Array<number | null> {
  assertPeriod(period);
  const result = Array<number | null>(values.length).fill(null);
  if (values.length <= period) return result;
  let gains = 0; let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0); losses += Math.max(-change, 0);
  }
  let averageGain = gains / period; let averageLoss = losses / period;
  const value = () => averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - (100 / (1 + averageGain / averageLoss));
  result[period] = value();
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
    result[index] = value();
  }
  return result;
}

export function macd(values: readonly number[], fastPeriod: number, slowPeriod: number, signalPeriod: number) {
  if (fastPeriod >= slowPeriod) throw new RangeError('Fast period must be less than slow period');
  const fast = ema(values, fastPeriod); const slow = ema(values, slowPeriod);
  const macdLine = values.map((_, index) => fast[index] == null || slow[index] == null ? null : (fast[index] as number) - (slow[index] as number));
  const availableMacd = macdLine.slice(slowPeriod - 1) as number[];
  const compactSignal = ema(availableMacd, signalPeriod);
  const signal = Array<number | null>(values.length).fill(null);
  compactSignal.forEach((value, index) => { signal[index + slowPeriod - 1] = value; });
  return { macd: macdLine, signal, histogram: macdLine.map((value, index) => value == null || signal[index] == null ? null : value - (signal[index] as number)) };
}

export function bollingerBands(values: readonly number[], period: number, standardDeviations: number) {
  assertPeriod(period);
  const middle = sma(values, period);
  return values.map((_, index) => {
    if (index < period - 1) return null;
    const mean = middle[index] as number;
    const variance = values.slice(index - period + 1, index + 1).reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period;
    const offset = Math.sqrt(variance) * standardDeviations;
    return { upper: mean + offset, middle: mean, lower: mean - offset };
  });
}

export function atrWilder(candles: TechnicalCandles, period: number): Array<number | null> {
  assertPeriod(period);
  const result = Array<number | null>(candles.length).fill(null);
  if (candles.length < period) return result;
  const trueRanges = candles.map((candle, index) => index === 0
    ? candle.high - candle.low
    : Math.max(candle.high - candle.low, Math.abs(candle.high - candles[index - 1].close), Math.abs(candle.low - candles[index - 1].close)));
  result[period - 1] = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < candles.length; index += 1) result[index] = (((result[index - 1] as number) * (period - 1)) + trueRanges[index]) / period;
  return result;
}

function points(candles: TechnicalCandles, values: Array<number | null>): IndicatorPoint[] {
  return values.flatMap((value, index) => value == null || !Number.isFinite(value) ? [] : [{ date: candles[index].date, value }]);
}

function calculate<T>(candles: TechnicalCandles, minimum: number, build: () => T[]): IndicatorResult<T> {
  if (candles.length < minimum) return unavailable(candles.length, minimum);
  return available(build().filter((point) => Object.values(point as object).every((value) => typeof value !== 'number' || Number.isFinite(value))));
}

function candlesAreValid(candles: TechnicalCandles) {
  return candles.every((candle, index) =>
    [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    && candle.high >= candle.low && candle.volume >= 0
    && (index === 0 || candle.date > candles[index - 1].date));
}

export function calculateTechnicalAnalysis(
  candles: TechnicalCandles,
  context: TechnicalContext,
  input: Partial<TechnicalParameters> = {},
): TechnicalAnalysis {
  const parameters = technicalParametersSchema.parse({ ...DEFAULT_TECHNICAL_PARAMETERS, ...input });
  const calculatedAt = context.calculatedAt ?? new Date().toISOString();
  const base = {
    symbol: context.symbol,
    input: { priceField: parameters.priceField, candleCount: candles.length, interval: '1d' as const },
    dataSource: context.source,
    dataPoints: candles.length,
    latestDataAt: candles.at(-1)?.date ?? null,
    calculatedAt,
    methodology: METHODOLOGY,
    parameters,
    freshness: context.freshness,
    limitations: LIMITATIONS,
  };
  if (!candles.length || !candlesAreValid(candles)) {
    return { status: 'unavailable', ...base, reason: candles.length ? 'ข้อมูล OHLCV ไม่ถูกต้องหรือไม่ได้เรียงตามเวลา' : 'ไม่มีข้อมูล OHLCV สำหรับคำนวณ' };
  }
  const values = candles.map((candle) => candle[parameters.priceField]);
  const macdValues = macd(values, parameters.macdFastPeriod, parameters.macdSlowPeriod, parameters.macdSignalPeriod);
  const bandValues = bollingerBands(values, parameters.bollingerPeriod, parameters.bollingerStdDev);
  const macdMinimum = parameters.macdSlowPeriod + parameters.macdSignalPeriod - 1;
  return {
    status: 'available',
    ...base,
    latestDataAt: candles[candles.length - 1].date,
    indicators: {
      sma: calculate(candles, parameters.smaPeriod, () => points(candles, sma(values, parameters.smaPeriod))),
      ema: calculate(candles, parameters.emaPeriod, () => points(candles, ema(values, parameters.emaPeriod))),
      rsi: calculate(candles, parameters.rsiPeriod + 1, () => points(candles, rsiWilder(values, parameters.rsiPeriod))),
      macd: calculate(candles, macdMinimum, () => macdValues.macd.flatMap((value, index): MacdPoint[] => value == null ? [] : [{ date: candles[index].date, value, signal: macdValues.signal[index], histogram: macdValues.histogram[index] }])),
      bollinger: calculate(candles, parameters.bollingerPeriod, () => bandValues.flatMap((value, index): BollingerPoint[] => value == null ? [] : [{ date: candles[index].date, value: value.middle, ...value }])),
      atr: calculate(candles, parameters.atrPeriod, () => points(candles, atrWilder(candles, parameters.atrPeriod))),
      averageVolume: calculate(candles, parameters.averageVolumePeriod, () => points(candles, sma(candles.map((candle) => candle.volume), parameters.averageVolumePeriod))),
    },
  };
}

