import { z } from 'zod';
import { intradayIntervalSchema, intradayRangeSchema, intradaySessionModeSchema } from '../validation';
import { marketDataStatusSchema } from '../options/contracts';

export const intradaySessionTypeSchema = z.enum(['premarket', 'regular', 'afterhours']);

export const canonicalIntradayBarSchema = z.object({
  timestamp: z.iso.datetime(),
  sessionDate: z.iso.date(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().int().nonnegative().nullable(),
  interval: intradayIntervalSchema,
  exchangeTimezone: z.string().min(1),
  sessionType: intradaySessionTypeSchema,
  provider: z.string().min(1),
  asOf: z.iso.datetime(),
}).superRefine((bar, context) => {
  if (bar.high < Math.max(bar.open, bar.close, bar.low)) {
    context.addIssue({ code: 'custom', path: ['high'], message: 'high is below another OHLC field' });
  }
  if (bar.low > Math.min(bar.open, bar.close, bar.high)) {
    context.addIssue({ code: 'custom', path: ['low'], message: 'low is above another OHLC field' });
  }
});

export const canonicalIntradaySeriesSchema = z.object({
  symbol: z.string().min(1),
  interval: intradayIntervalSchema,
  range: intradayRangeSchema,
  sessionMode: intradaySessionModeSchema,
  bars: z.array(canonicalIntradayBarSchema),
  exchangeTimezone: z.string().min(1),
  provider: z.string().min(1),
  asOf: z.iso.datetime(),
  status: marketDataStatusSchema,
  delayedMinutes: z.number().int().nonnegative().nullable(),
  warnings: z.array(z.string()),
});

export type IntradayInterval = z.infer<typeof intradayIntervalSchema>;
export type IntradayRange = z.infer<typeof intradayRangeSchema>;
export type IntradaySessionMode = z.infer<typeof intradaySessionModeSchema>;
export type IntradaySessionType = z.infer<typeof intradaySessionTypeSchema>;
export type CanonicalIntradayBar = z.infer<typeof canonicalIntradayBarSchema>;
export type CanonicalIntradaySeries = z.infer<typeof canonicalIntradaySeriesSchema>;

export interface IntradayProviderResult {
  symbol: string;
  interval: IntradayInterval;
  sessionMode: IntradaySessionMode;
  bars: CanonicalIntradayBar[];
  exchangeTimezone: string;
  provider: string;
  asOf: string;
  status: 'live' | 'delayed';
  delayedMinutes: number | null;
  warnings: string[];
}
