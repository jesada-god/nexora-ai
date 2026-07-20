import type { LineStyle } from 'lightweight-charts';
import type { ChartLevel } from '@/src/lib/analytics/support-resistance/levels';
import type { ChartPriceLine } from './chart-types';

export function supportResistancePriceLines(levels: readonly ChartLevel[]): ChartPriceLine[] {
  return levels.map((level) => ({
    id: level.id,
    price: level.price,
    title: level.label,
    color: level.side === 'support' ? '#34d399' : '#fb7185',
    lineStyle: 2,
  }));
}

export function currentQuotePriceLine(price: number | null | undefined): ChartPriceLine[] {
  return Number.isFinite(price) && Number(price) > 0
    ? [{ id: 'current-quote', price: Number(price), title: 'Quote', color: '#D4FF00', lineStyle: 2 }]
    : [];
}

export function asLineStyle(value: number | undefined): LineStyle {
  return (value ?? 2) as LineStyle;
}

