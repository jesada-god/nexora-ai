import { z } from 'zod';
import {
  apiErrorSchema,
  companyProfileSchema,
  historicalPricesSchema,
  quoteSchema,
  responseMetaSchema,
} from '@/src/lib/market-data/types';
import { symbolSchema } from '@/src/lib/market-data/validation';

function marketEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    data: dataSchema.nullable(),
    error: apiErrorSchema.optional(),
    meta: responseMetaSchema,
  });
}

export const quoteEnvelopeSchema = marketEnvelopeSchema(quoteSchema);
export const profileEnvelopeSchema = marketEnvelopeSchema(companyProfileSchema).extend({
  status: z.enum(['fresh', 'cached', 'stale', 'unavailable']),
  providerUsed: z.string().nullable(),
  fallbackUsed: z.boolean(),
  cachedAt: z.iso.datetime().nullable(),
  retryAfterSeconds: z.number().int().nonnegative(),
  reasonCode: z.string().nullable(),
});
export const historyEnvelopeSchema = marketEnvelopeSchema(historicalPricesSchema);

export const companyProfileTranslationRequestSchema = z.object({
  symbol: symbolSchema,
  sourceText: z.string().trim().min(1).max(6_000),
  targetLanguage: z.literal('th'),
}).strict();

export const companyProfileTranslationDataSchema = z.object({
  symbol: symbolSchema,
  sourceText: z.string().min(1).max(6_000),
  translatedText: z.string().min(1).max(8_000),
  targetLanguage: z.literal('th'),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const companyProfileTranslationResponseSchema = z.object({
  data: companyProfileTranslationDataSchema.nullable(),
  error: z.object({
    code: z.enum([
      'invalid-request',
      'provider-not-configured',
      'model-unavailable',
      'rate-limited',
      'upstream-unavailable',
      'invalid-provider-response',
    ]),
    message: z.string(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }).optional(),
  meta: z.object({
    cached: z.boolean(),
    timestamp: z.iso.datetime(),
  }),
});

export type CompanyProfileTranslationRequest = z.infer<typeof companyProfileTranslationRequestSchema>;
export type CompanyProfileTranslationResponse = z.infer<typeof companyProfileTranslationResponseSchema>;
