import { z } from 'zod';
import { fixed } from '../../money/fixed';

export const currencySchema = z.enum(['USD', 'THB']);
export type SupportedCurrency = z.infer<typeof currencySchema>;

export const fxQuoteSchema = z.object({
  base: currencySchema,
  quote: currencySchema,
  rate: z.string().regex(/^\d+(?:\.\d{1,8})?$/).refine((value) => fixed(value) > 0n),
  asOf: z.iso.datetime(),
  fetchedAt: z.iso.datetime(),
  source: z.string().min(1),
  cached: z.boolean(),
  stale: z.boolean(),
});

export type FxQuote = z.infer<typeof fxQuoteSchema>;

export const fxApiDataSchema = fxQuoteSchema.extend({
  warning: z.string().nullable(),
});

export const fxApiEnvelopeSchema = z.object({
  data: fxApiDataSchema.nullable(),
  error: z.string().optional(),
});

export type FxApiData = z.infer<typeof fxApiDataSchema>;
export type FxApiEnvelope = z.infer<typeof fxApiEnvelopeSchema>;

export const alphaVantageFxSchema = z.object({
  'Realtime Currency Exchange Rate': z.object({
    '1. From_Currency Code': z.string(),
    '3. To_Currency Code': z.string(),
    '5. Exchange Rate': z.string(),
    '6. Last Refreshed': z.string(),
  }),
});

export const frankfurterFxSchema = z.object({
  date: z.iso.date(),
  base: currencySchema,
  quote: currencySchema,
  rate: z.number().positive().finite(),
});
