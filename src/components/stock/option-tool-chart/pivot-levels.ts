import { z } from 'zod';

const finitePrice = z.number().finite();

export const optionToolPivotLevelsSchema = z.object({
  symbol: z.string().min(1),
  basisInterval: z.enum(['1D', 'Week']),
  sourceTime: z.number().int().positive(),
  provider: z.string().min(1),
  pivot: finitePrice,
  resistance: z.tuple([finitePrice, finitePrice, finitePrice]),
  support: z.tuple([finitePrice, finitePrice, finitePrice]),
});

export type OptionToolPivotLevels = z.infer<typeof optionToolPivotLevelsSchema>;

export interface PivotSourceBar {
  high: number;
  low: number;
  close: number;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Classic floor-trader pivots used by option-tool-invest-bigdata-main.
 * The caller is responsible for supplying the previous completed D1/Week bar.
 */
export function calculateClassicPivotLevels(bar: PivotSourceBar): Pick<OptionToolPivotLevels, 'pivot' | 'resistance' | 'support'> {
  const pivot = (bar.high + bar.low + bar.close) / 3;
  return {
    pivot: roundPrice(pivot),
    resistance: [
      roundPrice(2 * pivot - bar.low),
      roundPrice(pivot + bar.high - bar.low),
      roundPrice(bar.high + 2 * (pivot - bar.low)),
    ],
    support: [
      roundPrice(2 * pivot - bar.high),
      roundPrice(pivot - (bar.high - bar.low)),
      roundPrice(bar.low - 2 * (bar.high - pivot)),
    ],
  };
}

export function distancePercent(level: number, currentPrice: number | null | undefined): number | null {
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  return Math.abs(level - currentPrice) / currentPrice * 100;
}
