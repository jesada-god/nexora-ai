import { z } from 'zod';

export const supportResistanceParametersSchema = z.object({
  pivotWindow: z.number().int().min(1).max(10).default(3),
  atrPeriod: z.number().int().min(2).max(100).default(14),
  atrTolerance: z.number().finite().min(0.1).max(3).default(0.6),
  minimumTouches: z.number().int().min(2).max(10).default(2),
  maximumPerSide: z.number().int().min(1).max(3).default(3),
  useVolumeConfirmation: z.boolean().default(true),
  useConsolidation: z.boolean().default(true),
  usePsychologicalLevels: z.boolean().default(true),
});

export const DEFAULT_SUPPORT_RESISTANCE_PARAMETERS = supportResistanceParametersSchema.parse({});
