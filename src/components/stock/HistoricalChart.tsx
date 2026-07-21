'use client';

import type { OhlcvInputBar } from '@/src/lib/analytics/chart-data/timeline';
import type { TechnicalAnalysis, TechnicalIndicatorId } from '@/src/lib/analytics/technical/types';
import type { AdvancedChartType } from '@/src/lib/analytics/chart-types/types';
import type { SupportResistanceResult } from '@/src/lib/analytics/support-resistance/types';
import type { VolumeProfileResult } from '@/src/lib/analytics/volume-profile/types';
import type { FibonacciResult } from '@/src/lib/analytics/fibonacci/types';
import type { MarketDataLabel } from '@/src/lib/stock-detail/market-source';
import { StockChart } from './chart/StockChart';
import type { ChartTooltipContext } from './chart/chart-types';

export function formatChartTime(time: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(time);
  const parsed = new Date(dateOnly ? `${time}T00:00:00.000Z` : time);
  if (Number.isNaN(parsed.valueOf())) return time;
  return new Intl.DateTimeFormat('en-US', dateOnly
    ? { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }
    : { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(parsed);
}

interface Props {
  prices: readonly OhlcvInputBar[];
  symbol?: string;
  /** Selected candle interval; forwarded so D1 institutional zones only build on '1D'. */
  interval?: string;
  visibleBarCount?: number;
  technical?: TechnicalAnalysis;
  enabledIndicators?: TechnicalIndicatorId[];
  chartType?: AdvancedChartType;
  supportResistance?: SupportResistanceResult;
  volumeProfile?: VolumeProfileResult;
  fibonacci?: FibonacciResult;
  showVolume?: boolean;
  onToggleVolume?: () => void;
  showVpvr?: boolean;
  showFibonacci?: boolean;
  currentPrice?: number | null;
  /** Provenance of the accepted price for the decision panel (never REAL-TIME). */
  marketLabel?: MarketDataLabel | null;
  datasetKey?: string;
  tooltipContext?: ChartTooltipContext;
}

/**
 * Compatibility boundary for analytics controls. The retired Recharts renderer,
 * custom viewport, wheel, pinch, pan, and crosshair engines no longer live here.
 */
export default function HistoricalChart(props: Props) {
  return <StockChart {...props}/>;
}
