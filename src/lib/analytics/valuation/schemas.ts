import { z } from 'zod';
import { symbolSchema } from '@/src/lib/market-data/validation';

const finite = z.number().finite();
export const dcfAssumptionsSchema = z.object({
  forecastHorizon: z.number().int().min(1).max(10), revenueGrowth: finite.min(-.5).max(1), operatingMargin: finite.min(-1).max(1), taxRate: finite.min(0).max(.6), depreciationPercentRevenue: finite.min(0).max(.5), capexPercentRevenue: finite.min(0).max(1), workingCapitalPercentRevenue: finite.min(-.5).max(.5), wacc: finite.gt(0).max(.5), terminalGrowth: finite.min(-.1).max(.1), dilutionRate: finite.min(-.2).max(.5),
}).refine((value) => value.wacc > value.terminalGrowth, { message: 'WACC must be greater than terminal growth', path: ['wacc'] });

export const fairValueRequestSchema = z.object({ symbol: symbolSchema, scenario: z.enum(['conservative', 'base', 'optimistic', 'user-defined']), assumptions: dcfAssumptionsSchema.optional() }).refine((value) => value.scenario !== 'user-defined' || Boolean(value.assumptions), { message: 'User-defined scenario requires explicit assumptions', path: ['assumptions'] });
