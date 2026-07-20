import { z } from 'zod';

export const symbolSchema = z
  .string()
  .trim()
  .min(1, 'Symbol is required')
  .max(20, 'Symbol must be at most 20 characters')
  .regex(/^(?:\^[A-Za-z0-9]+|[A-Za-z0-9][A-Za-z0-9.\-]*)$/, 'Symbol contains unsupported characters')
  .transform((symbol) => symbol.toUpperCase());

export const searchQuerySchema = z
  .string()
  .trim()
  .min(1, 'Query is required')
  .max(80, 'Query must be at most 80 characters');

export const historicalRangeSchema = z.enum(['1m', '3m', '6m', '1y', '5y', 'max']);

export const historyQuerySchema = z.object({
  range: historicalRangeSchema.default('3m'),
});

export const optionExpirationSchema = z.iso.date();

export const optionExpirationsQuerySchema = z.object({
  symbol: symbolSchema,
});

export const optionsChainQuerySchema = z.object({
  symbol: symbolSchema,
  expiration: optionExpirationSchema,
});

export const intradayIntervalSchema = z.enum(['1m', '5m', '15m', '30m', '60m']);
export const intradayRangeSchema = z.enum(['1d', '5d', '1m']);
export const intradaySessionModeSchema = z.enum(['regular', 'extended']);

export const intradayQuerySchema = z.object({
  symbol: symbolSchema,
  interval: intradayIntervalSchema,
  range: intradayRangeSchema.default('5d'),
  session: intradaySessionModeSchema.default('regular'),
});

export const searchParamsSchema = z.object({
  q: searchQuerySchema,
  assetType: z.enum(['Stock', 'ETF']).optional(),
  includeDelisted: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
  limit: z.coerce.number().int().min(1).max(20).default(15),
});
